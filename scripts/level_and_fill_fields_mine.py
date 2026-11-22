from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "art" / "wizard-royale-fields-mine-level.blend"
PREVIEW = ROOT / "art" / "wizard-royale-fields-mine-level-preview.png"


# Remove the earlier narrow connector so the field itself can form the join.
old = bpy.data.collections.get("Transition — Fields to Mine")
if old:
    for obj in list(old.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def extend_right_edge(obj, cutoff_x, amount):
    """Move only the rightmost mesh vertices in world X, preserving the left edge."""
    world = obj.matrix_world.copy()
    inverse = world.inverted()
    for vertex in obj.data.vertices:
        point = world @ vertex.co
        if point.x >= cutoff_x:
            point.x += amount
            vertex.co = inverse @ point
    obj.data.update()


# Extend the actual field surface and its soil rim at their existing elevation.
for name in ("Great Greenfields — 45m x 30m", "Rounded plains soil edge"):
    obj = bpy.data.objects.get(name)
    if obj and obj.type == "MESH":
        extend_right_edge(obj, 4.55, 2.45)

# Extend the low underlay to the mine too, closing the last lower notch.
for name in ("Filled fields mountain seam", "Fields mountain seam foundation"):
    obj = bpy.data.objects.get(name)
    if obj:
        obj.dimensions.x += 1.35
        obj.location.x += 0.675

fields = bpy.data.collections.get("Plains — Great Greenfields")
if fields:
    fields["region_note"] = "Field surface extended at its own level to meet the mine; lower notch fully filled"

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
