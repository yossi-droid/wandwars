"""Give the finished wizard a Mixamo-compatible skeleton without changing his body."""

from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
SOURCE_BLEND = ROOT / "art" / "wizard-advanced-armswing.blend"
OUTPUT_BLEND = ROOT / "art" / "wizard-mixamo-compatible.blend"
OUTPUT_GLB = ROOT / "public" / "models" / "wizard-mixamo-compatible.glb"

BONE_NAMES = {
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


bpy.ops.wm.open_mainfile(filepath=str(SOURCE_BLEND))
armature = bpy.data.objects["WizardSkeleton"]

# Blender updates action data paths and bone-parented object references when a
# bone is renamed through the armature API. The wizard therefore keeps his
# fitted proportions while exposing the same principal bone names as the FBXs.
for old_name, new_name in BONE_NAMES.items():
    bone = armature.data.bones.get(old_name)
    if bone is None:
        raise RuntimeError(f"Missing wizard bone: {old_name}")
    bone.name = new_name

# Blender 5 stores action curves in layered channel bags. Bone renaming keeps
# pose data intact but does not rewrite those curve paths, so update them here.
for action in bpy.data.actions:
    for layer in action.layers:
        for strip in layer.strips:
            for channelbag in strip.channelbags:
                for curve in channelbag.fcurves:
                    for old_name, new_name in BONE_NAMES.items():
                        old_path = f'pose.bones["{old_name}"]'
                        if old_path in curve.data_path:
                            curve.data_path = curve.data_path.replace(
                                old_path, f'pose.bones["{new_name}"]'
                            )

armature.name = "WizardMixamoSkeleton"
armature.data.name = "WizardMixamoSkeleton"
armature["animation_skeleton"] = "Mixamo"
armature["source_animation_files"] = ", ".join(
    ["Walking.fbx", "Running.fbx", "Jumping Up.fbx", "Jumping.fbx", "Jumping Down.fbx", "Climbing Up Wall.fbx"]
)

bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT_BLEND))

bpy.ops.object.select_all(action="DESELECT")
armature.select_set(True)
for obj in armature.children_recursive:
    obj.select_set(True)
bpy.context.view_layer.objects.active = armature
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

print(f"Saved {OUTPUT_BLEND}")
print(f"Exported {OUTPUT_GLB}")
