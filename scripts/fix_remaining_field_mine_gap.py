from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "art" / "wizard-royale-gap-fixed.blend"
PREVIEW = ROOT / "art" / "wizard-royale-gap-fixed-preview.png"


def relink(obj, collection):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


collection = bpy.data.collections.get("Transition — Final Fields Mine Fill")
if collection:
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
else:
    collection = bpy.data.collections.new("Transition — Final Fields Mine Fill")
    bpy.context.scene.collection.children.link(collection)

field = bpy.data.objects.get("Great Greenfields — 45m x 30m")
soil_source = bpy.data.objects.get("Rounded plains soil edge")
if field is None or not field.data.materials:
    raise RuntimeError("Field terrain was not found")

field_mat = field.data.materials[0]
soil_mat = soil_source.data.materials[0] if soil_source and soil_source.data.materials else field_mat

# Exact empty rectangle: castle/desert end at x=0, mine begins at x=7.06,
# desert ends near y=6.9, and the fields begin near y=12.1.
bpy.ops.mesh.primitive_cube_add(location=(3.48, 9.55, 0.0))
fill = bpy.context.object
fill.name = "Final level terrain fill"
fill.dimensions = (7.55, 5.95, 1.50)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
relink(fill, collection)
fill.data.materials.append(field_mat)
bevel = fill.modifiers.new("Matched field corners", "BEVEL")
bevel.width = 1.15
bevel.segments = 8

# Matching soil beneath it prevents any blue sliver around the beveled edge.
bpy.ops.mesh.primitive_cube_add(location=(3.48, 9.55, -0.18))
base = bpy.context.object
base.name = "Final terrain fill soil"
base.dimensions = (7.75, 6.15, 1.82)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
relink(base, collection)
base.data.materials.append(soil_mat)
bevel = base.modifiers.new("Matched soil corners", "BEVEL")
bevel.width = 1.25
bevel.segments = 8

collection["transition_note"] = "Fully fills the former blue gap between fields, castle, desert, and mine at field level"

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
