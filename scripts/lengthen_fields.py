from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "art" / "wizard-royale-longer-fields.blend"
PREVIEW = ROOT / "art" / "wizard-royale-longer-fields-preview.png"

collection = bpy.data.collections.get("Plains — Great Greenfields")
if collection is None:
    raise RuntimeError("Great Greenfields collection was not found")

# Stretch the whole farming region sideways around its existing center.
center_x = -13.0
stretch = 1.58
for obj in collection.objects:
    obj.location.x = center_x + (obj.location.x - center_x) * stretch
    if obj.type in {"MESH", "CURVE"}:
        obj.scale.x *= stretch

collection["region_note"] = "Great Greenfields widened into a longer northern farming region"

scene = bpy.context.scene
camera = scene.camera
if camera:
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 102.0
    camera.location.x = -10.0
    camera.location.y = 1.0
    camera.location.z = 88.0
    camera.rotation_euler = (0.0, 0.0, 0.0)
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 1100
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW)

bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
if camera:
    bpy.ops.render.render(write_still=True)
print(f"Saved {OUTPUT}")
