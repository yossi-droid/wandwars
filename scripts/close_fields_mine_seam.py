from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "art" / "wizard-royale-fields-mine-attached.blend"
PREVIEW = ROOT / "art" / "wizard-royale-fields-mine-attached-preview.png"


def material(name, color, roughness=0.82):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    return mat


def relink(obj, collection):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


collection = bpy.data.collections.get("Transition — Fields to Mine")
if collection:
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
else:
    collection = bpy.data.collections.new("Transition — Fields to Mine")
    bpy.context.scene.collection.children.link(collection)

meadow = material("Fields mine seam meadow", (0.39, 0.55, 0.24))
soil = material("Fields mine seam earth", (0.25, 0.14, 0.065))
rock_mat = material("Fields mine seam rocks", (0.32, 0.33, 0.31))

# The gap is only about one metre wide; overlap both edges slightly to remove it.
bpy.ops.mesh.primitive_cube_add(location=(6.56, 15.45, -0.45))
patch = bpy.context.object
patch.name = "Closed fields mine seam"
patch.dimensions = (1.75, 11.8, 0.50)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
relink(patch, collection)
patch.data.materials.append(meadow)
bevel = patch.modifiers.new("Soft seam edge", "BEVEL")
bevel.width = 0.48
bevel.segments = 5

bpy.ops.mesh.primitive_cube_add(location=(6.56, 15.45, -0.73))
base = bpy.context.object
base.name = "Fields mine seam base"
base.dimensions = (1.9, 12.0, 0.10)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
relink(base, collection)
base.data.materials.append(soil)
bevel = base.modifiers.new("Soft seam foundation", "BEVEL")
bevel.width = 0.52
bevel.segments = 5

for index, (x, y, size) in enumerate([(6.55, 12.7, 0.28), (6.62, 16.2, 0.34), (6.48, 19.4, 0.25)]):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=size, location=(x, y, 0.10))
    rock = bpy.context.object
    rock.name = f"Fields mine seam rock {index + 1}"
    rock.scale.z = 0.62
    relink(rock, collection)
    rock.data.materials.append(rock_mat)

collection["transition_note"] = "Tiny remaining field-to-mine gap closed"

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
