"""Arrange the Crossroads Borough village around its well, using the supplied top view."""

from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "art" / "wizard-royale-village-reference.blend"
PREVIEW = ROOT / "art" / "wizard-royale-village-reference-preview.png"
COLLECTION = bpy.data.collections["Town — Crossroads Borough"]

# The reference has a clear circular square, a blue-roof landmark on its east
# edge, and small homes scattered outside the square on both sides of the road.
for obj in list(COLLECTION.objects):
    if obj.name.startswith(("Town market stall", "Town market canopy")):
        bpy.data.objects.remove(obj, do_unlink=True)

house_sites = [
    (-15.6, -11.1),
    (-7.1, -11.4),
    (-3.8, -11.2),
    (-15.6, -14.2),
    (-15.8, -17.1),
    (-15.5, -19.4),
    (-13.2, -20.8),
    (-10.7, -20.9),
    (-8.1, -20.9),
    (-6.5, -19.2),
    (-6.7, -17.0),
    (-3.7, -19.0),
]

roof_mats = [
    bpy.data.materials["Town blue roofs"],
    bpy.data.materials["Town red roofs"],
    bpy.data.materials["Town blue roofs"],
    bpy.data.materials["Town red roofs"],
    bpy.data.materials["Town red roofs"],
    bpy.data.materials["Town red roofs"],
    bpy.data.materials["Town blue roofs"],
    bpy.data.materials["Town timber walls"],
    bpy.data.materials["Town red roofs"],
    bpy.data.materials["Town red roofs"],
    bpy.data.materials["Town timber walls"],
    bpy.data.materials["Town blue roofs"],
]

for index, (x, y) in enumerate(house_sites, start=1):
    suffix = f"{index:02d}"
    if index <= 8:
        house = bpy.data.objects[f"Town house {suffix}"]
        roof = bpy.data.objects[f"Town roof {suffix}"]
        door = bpy.data.objects[f"Town door {suffix}"]
    else:
        for label, template in (
            ("house", bpy.data.objects["Town house 01"]),
            ("roof", bpy.data.objects["Town roof 01"]),
            ("door", bpy.data.objects["Town door 01"]),
        ):
            obj = template.copy()
            obj.data = template.data.copy()
            obj.name = f"Town {label} {suffix}"
            COLLECTION.objects.link(obj)
        house = bpy.data.objects[f"Town house {suffix}"]
        roof = bpy.data.objects[f"Town roof {suffix}"]
        door = bpy.data.objects[f"Town door {suffix}"]
    house.location.x, house.location.y = x, y
    roof.location.x, roof.location.y = x, y
    door.location.x, door.location.y = x, y - 0.55
    roof.data.materials.clear()
    roof.data.materials.append(roof_mats[index - 1])

# Save a full-map view as before, plus a close view for checking the new layout.
scene = bpy.context.scene
camera = scene.camera
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
if camera:
    previous_location = camera.location.copy()
    previous_scale = camera.data.ortho_scale
    previous_path = scene.render.filepath
    previous_percentage = scene.render.resolution_percentage
    camera.location.x = -10.6
    camera.location.y = -15.0
    camera.data.ortho_scale = 22.0
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(PREVIEW)
    bpy.ops.render.render(write_still=True)
    camera.location = previous_location
    camera.data.ortho_scale = previous_scale
    scene.render.filepath = previous_path
    scene.render.resolution_percentage = previous_percentage

print(f"Saved {OUTPUT}")
print(f"Rendered {PREVIEW}")
