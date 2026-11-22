from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "art" / "wizard-royale-fields-fully-attached.blend"
PREVIEW = ROOT / "art" / "wizard-royale-fields-fully-attached-preview.png"


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


collection = bpy.data.collections.get("Transition — Fields to Mountains")
if collection:
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
else:
    collection = bpy.data.collections.new("Transition — Fields to Mountains")
    bpy.context.scene.collection.children.link(collection)

meadow = material("Fields mountain blended meadow", (0.39, 0.56, 0.25))
soil = material("Fields mountain seam soil", (0.20, 0.13, 0.055))
stone = material("Fields mountain seam stone", (0.36, 0.40, 0.39))
trunk = material("Fields mountain seam trunks", (0.22, 0.115, 0.04))
leaf = material("Fields mountain seam trees", (0.10, 0.29, 0.105))

# A full-width underlay closes the mountain seam and the remaining gap above the castle.
bpy.ops.mesh.primitive_cube_add(location=(-18.5, 12.05, -0.46))
fill = bpy.context.object
fill.name = "Filled fields mountain seam"
fill.dimensions = (49.4, 3.3, 0.52)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
relink(fill, collection)
fill.data.materials.append(meadow)
bevel = fill.modifiers.new("Rounded transition edge", "BEVEL")
bevel.width = 0.9
bevel.segments = 6

bpy.ops.mesh.primitive_cube_add(location=(-18.5, 12.02, -0.74))
base = bpy.context.object
base.name = "Fields mountain seam foundation"
base.dimensions = (49.6, 3.45, 0.12)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
relink(base, collection)
base.data.materials.append(soil)
bevel = base.modifiers.new("Rounded seam foundation", "BEVEL")
bevel.width = 0.95
bevel.segments = 6

# Details disguise the join and visually carry the mountain forest into the fields.
for index, (x, y) in enumerate([(-40.2, 12.2), (-36.1, 11.9), (-29.0, 12.25), (-25.7, 12.0)]):
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.18, depth=1.4, location=(x, y, 0.55))
    tree_trunk = bpy.context.object
    tree_trunk.name = f"Seam tree trunk {index + 1}"
    relink(tree_trunk, collection)
    tree_trunk.data.materials.append(trunk)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.82, location=(x, y, 1.42))
    canopy = bpy.context.object
    canopy.name = f"Seam tree canopy {index + 1}"
    canopy.scale = (1.0, 0.82, 0.72)
    relink(canopy, collection)
    canopy.data.materials.append(leaf)

for index, (x, y, size) in enumerate([(-38.2, 12.0, 0.48), (-31.7, 12.35, 0.58), (-27.2, 11.85, 0.42)]):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=size, location=(x, y, 0.18))
    rock = bpy.context.object
    rock.name = f"Seam rock {index + 1}"
    rock.scale.z = 0.62
    relink(rock, collection)
    rock.data.materials.append(stone)

collection["transition_note"] = "Continuous terrain closes the entire lower edge of the fields against the map"

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
