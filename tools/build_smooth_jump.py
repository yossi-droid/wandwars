"""Build a short, symmetric jump clip from the clean imported JumpUp action."""

from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
SOURCE_BLEND = ROOT / "art" / "wizard-advanced-animations.blend"
OUTPUT_BLEND = ROOT / "art" / "wizard-advanced-animations-smooth.blend"
OUTPUT_GLB = ROOT / "public" / "models" / "wizard-advanced-animations-smooth.glb"
ACTION_NAME = "JumpSmooth"
FRAME_COUNT = 25

bpy.ops.wm.open_mainfile(filepath=str(SOURCE_BLEND))
scene = bpy.context.scene
scene.render.fps = 30
arm = bpy.data.objects["WizardSkeleton"]
source = bpy.data.actions["JumpUp"]

arm.animation_data_create()
arm.animation_data.action = None
old = bpy.data.actions.get(ACTION_NAME)
if old:
    bpy.data.actions.remove(old)
smooth = bpy.data.actions.new(ACTION_NAME)
smooth.use_fake_user = True

bone_names = [bone.name for bone in arm.pose.bones]
source_start, source_end = source.frame_range
half = (FRAME_COUNT + 1) // 2

for output_frame in range(1, FRAME_COUNT + 1):
    if output_frame <= half:
        progress = (output_frame - 1) / (half - 1)
    else:
        progress = (FRAME_COUNT - output_frame) / (half - 1)
    source_frame = source_start + (source_end - source_start) * progress
    whole = int(source_frame)
    subframe = source_frame - whole

    arm.animation_data.action = source
    scene.frame_set(whole, subframe=subframe)
    bpy.context.view_layer.update()
    sampled = {
        name: (
            arm.pose.bones[name].location.copy(),
            arm.pose.bones[name].rotation_quaternion.copy(),
            arm.pose.bones[name].scale.copy(),
        )
        for name in bone_names
    }

    arm.animation_data.action = smooth
    scene.frame_set(output_frame)
    for name, (location, rotation, scale) in sampled.items():
        bone = arm.pose.bones[name]
        bone.rotation_mode = "QUATERNION"
        bone.location = location
        bone.rotation_quaternion = rotation
        bone.scale = scale
        bone.keyframe_insert("location", frame=output_frame, group=name)
        bone.keyframe_insert("rotation_quaternion", frame=output_frame, group=name)
        bone.keyframe_insert("scale", frame=output_frame, group=name)

scene.frame_start = 1
scene.frame_end = FRAME_COUNT
arm.animation_data.action = smooth
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT_BLEND))

bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
for obj in arm.children_recursive:
    obj.select_set(True)
bpy.context.view_layer.objects.active = arm
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
