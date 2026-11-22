"""Retarget a supplied Mixamo animation onto the Wizard Royale hero.

Run with:
  Blender --background --factory-startup --python tools/import_running_animation.py

By default this imports Running.fbx as a looping ``Run`` action. Arguments
after Blender's ``--`` separator can reuse the same retargeter for other clips.
"""

import argparse
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source-blend", default=str(ROOT / "art" / "wizard-advanced.blend")
    )
    parser.add_argument(
        "--source-fbx", default="/Users/michaelcaras/Downloads/Running.fbx"
    )
    parser.add_argument(
        "--output-blend",
        default=str(ROOT / "art" / "wizard-advanced-with-run.blend"),
    )
    parser.add_argument(
        "--output-glb",
        default=str(ROOT / "public" / "models" / "wizard-advanced-with-run.glb"),
    )
    parser.add_argument("--action", default="Run")
    parser.add_argument(
        "--loop", action=argparse.BooleanOptionalAction, default=True
    )
    parser.add_argument(
        "--keep-vertical", action=argparse.BooleanOptionalAction, default=True
    )
    blender_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(blender_args)


ARGS = parse_args()
SOURCE_BLEND = Path(ARGS.source_blend)
SOURCE_FBX = Path(ARGS.source_fbx)
OUTPUT_BLEND = Path(ARGS.output_blend)
OUTPUT_GLB = Path(ARGS.output_glb)
ACTION_NAME = ARGS.action

BONE_MAP = {
    "hips": "mixamorig:Hips",
    "spine": "mixamorig:Spine",
    "chest": "mixamorig:Spine2",
    "neck": "mixamorig:Neck",
    "head": "mixamorig:Head",
    "upper_arm.L": "mixamorig:LeftArm",
    "forearm.L": "mixamorig:LeftForeArm",
    "hand.L": "mixamorig:LeftHand",
    "upper_arm.R": "mixamorig:RightArm",
    "forearm.R": "mixamorig:RightForeArm",
    "hand.R": "mixamorig:RightHand",
    "thigh.L": "mixamorig:LeftUpLeg",
    "shin.L": "mixamorig:LeftLeg",
    "foot.L": "mixamorig:LeftFoot",
    "thigh.R": "mixamorig:RightUpLeg",
    "shin.R": "mixamorig:RightLeg",
    "foot.R": "mixamorig:RightFoot",
}


def require(path):
    if not path.exists():
        raise FileNotFoundError(path)


def rotation_only(matrix):
    """Return a normalized 4x4 rotation matrix, dropping scale and translation."""
    return matrix.to_quaternion().normalized().to_matrix().to_4x4()


def hierarchy_depth(pose_bone):
    depth = 0
    parent = pose_bone.parent
    while parent:
        depth += 1
        parent = parent.parent
    return depth


require(SOURCE_BLEND)
require(SOURCE_FBX)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE_BLEND))

target = bpy.data.objects.get("WizardSkeleton")
if target is None or target.type != "ARMATURE":
    raise RuntimeError("WizardSkeleton armature was not found")

original_objects = set(bpy.data.objects)
original_actions = {action.name for action in bpy.data.actions}

bpy.ops.import_scene.fbx(filepath=str(SOURCE_FBX), use_anim=True)
imported_objects = [obj for obj in bpy.data.objects if obj not in original_objects]
source = next(
    (
        obj
        for obj in imported_objects
        if obj.type == "ARMATURE" and obj.pose.bones.get("mixamorig:Hips")
    ),
    None,
)
if source is None:
    raise RuntimeError("The FBX did not contain the expected Mixamo armature")

source_action = source.animation_data.action if source.animation_data else None
if source_action is None:
    imported_actions = [action for action in bpy.data.actions if action.name not in original_actions]
    source_action = imported_actions[0] if imported_actions else None
if source_action is None:
    raise RuntimeError("The FBX did not contain an animation action")

missing_target = [name for name in BONE_MAP if target.pose.bones.get(name) is None]
missing_source = [name for name in BONE_MAP.values() if source.pose.bones.get(name) is None]
if missing_target or missing_source:
    raise RuntimeError(
        f"Bone mapping is incomplete; target={missing_target}, source={missing_source}"
    )

scene = bpy.context.scene
scene.render.fps = 30
source.animation_data_create()
source.animation_data.action = source_action
frame_start = int(round(source_action.frame_range[0]))
frame_end = int(round(source_action.frame_range[1]))

# Capture rest transforms in world space before posing either rig. The Mixamo
# bone axes differ from the wizard's axes, so transferring world-space rotation
# deltas keeps shoulders, knees, and feet aligned with their anatomical motion.
source_rest_world = {
    source_name: source.matrix_world @ source.data.bones[source_name].matrix_local
    for source_name in BONE_MAP.values()
}
target_rest_world = {
    target_name: target.matrix_world @ target.data.bones[target_name].matrix_local
    for target_name in BONE_MAP
}

if bpy.data.actions.get(ACTION_NAME):
    bpy.data.actions.remove(bpy.data.actions[ACTION_NAME])
retargeted_action = bpy.data.actions.new(ACTION_NAME)
retargeted_action.use_fake_user = True
target.animation_data_create()
target.animation_data.action = retargeted_action

ordered_targets = sorted(BONE_MAP, key=lambda name: hierarchy_depth(target.pose.bones[name]))
target_world_inverse = target.matrix_world.inverted()

scene.frame_set(frame_start)
source_hip_start = (
    source.matrix_world @ source.pose.bones[BONE_MAP["hips"]].matrix
).translation.copy()
source_height = max(
    0.001,
    (
        source_rest_world[BONE_MAP["head"]].translation
        - source_rest_world[BONE_MAP["hips"]].translation
    ).length,
)
target_height = max(
    0.001,
    (
        target_rest_world["head"].translation
        - target_rest_world["hips"].translation
    ).length,
)
hip_scale = target_height / source_height

for output_frame, source_frame in enumerate(range(frame_start, frame_end + 1), start=1):
    scene.frame_set(source_frame)
    bpy.context.view_layer.update()

    for target_name in ordered_targets:
        source_name = BONE_MAP[target_name]
        source_pose_world = source.matrix_world @ source.pose.bones[source_name].matrix
        source_delta = source_pose_world @ source_rest_world[source_name].inverted()
        desired_world_rotation = (
            rotation_only(source_delta) @ rotation_only(target_rest_world[target_name])
        )

        target_bone = target.pose.bones[target_name]
        current_world = target.matrix_world @ target_bone.matrix
        desired_world = Matrix.Translation(current_world.translation) @ desired_world_rotation
        target_bone.matrix = target_world_inverse @ desired_world
        bpy.context.view_layer.update()

        target_bone.rotation_mode = "QUATERNION"
        target_bone.keyframe_insert("rotation_quaternion", frame=output_frame, group=target_name)

    # Keep the clip in place. Only the source's vertical hip bounce is retained;
    # horizontal FBX root motion would otherwise fight the game's physics.
    source_hip_world = (
        source.matrix_world @ source.pose.bones[BONE_MAP["hips"]].matrix
    ).translation
    vertical_bob = (
        (source_hip_world.z - source_hip_start.z) * hip_scale
        if ARGS.keep_vertical
        else 0.0
    )
    hips = target.pose.bones["hips"]
    hips.location = Vector((0.0, 0.0, vertical_bob))
    hips.keyframe_insert("location", frame=output_frame, group="hips")

# Force repeating locomotion clips to close seamlessly. One-shot clips such as
# Jump preserve their final imported pose for a clean cross-fade back to Idle.
if ARGS.loop:
    for target_name in ordered_targets:
        bone = target.pose.bones[target_name]
        scene.frame_set(1)
        first_rotation = bone.rotation_quaternion.copy()
        first_location = bone.location.copy()
        scene.frame_set(frame_end - frame_start + 1)
        bone.rotation_quaternion = first_rotation
        bone.keyframe_insert(
            "rotation_quaternion", frame=frame_end - frame_start + 1, group=target_name
        )
        if target_name == "hips":
            bone.location = first_location
            bone.keyframe_insert(
                "location", frame=frame_end - frame_start + 1, group="hips"
            )

# Remove every imported FBX object and action after the motion has been baked.
source.animation_data.action = None
bpy.ops.object.select_all(action="DESELECT")
for obj in imported_objects:
    obj.select_set(True)
bpy.ops.object.delete(use_global=False)
for action in list(bpy.data.actions):
    if action.name not in original_actions and action != retargeted_action:
        bpy.data.actions.remove(action)

scene.frame_start = 1
scene.frame_end = frame_end - frame_start + 1
target.animation_data.action = retargeted_action
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT_BLEND))

# Export only the wizard hierarchy. Cameras, lights, and preview props from the
# authoring scene are intentionally excluded from the runtime asset.
bpy.ops.object.select_all(action="DESELECT")
target.select_set(True)
for obj in target.children_recursive:
    obj.select_set(True)
bpy.context.view_layer.objects.active = target
bpy.ops.export_scene.gltf(
    filepath=str(OUTPUT_GLB),
    export_format="GLB",
    use_selection=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_frame_range=False,
    export_force_sampling=True,
    export_skins=True,
    export_morph=False,
)

print(
    f"Retargeted {SOURCE_FBX.name} frames {frame_start}-{frame_end} "
    f"as {ACTION_NAME}"
)
print(f"Saved {OUTPUT_BLEND}")
print(f"Exported {OUTPUT_GLB}")
