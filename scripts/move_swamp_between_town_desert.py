from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "art" / "wizard-royale-swamp-between-town-desert.blend"
PREVIEW = ROOT / "art" / "wizard-royale-swamp-between-town-desert-preview.png"

collection = bpy.data.collections.get("Swamp — Murkmire")
if collection is None:
    raise RuntimeError("Swamp collection was not found")

# Move Murkmire from below the forest to the corner shared by the town and desert.
# The new position places it directly east of town and directly south of desert.
dx = 40.2
dy = 27.0
for obj in collection.objects:
    obj.location.x += dx
    obj.location.y += dy

collection["region"] = "Swamp between the town and desert"
collection["neighbors"] = "Town — Crossroads Borough; Desert — Terrain"

root = bpy.data.objects.get("REGION — Swamp Below Forest")
if root:
    root.name = "REGION — Swamp Between Town and Desert"
    root["region_note"] = "Murkmire placed east of town and south of desert"

scene = bpy.context.scene
camera = scene.camera
if camera:
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 112.0
    camera.location.x = -9.0
    camera.location.y = -1.5
    camera.location.z = 86.0
    camera.rotation_euler = (0.0, 0.0, 0.0)
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW)

bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
if camera:
    bpy.ops.render.render(write_still=True)
print(f"Saved {OUTPUT}")
