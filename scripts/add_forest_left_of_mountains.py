from pathlib import Path
import math

import bpy

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "art" / "wizard-royale-forest-under-mountains.blend"
PREVIEW = ROOT / "art" / "wizard-royale-forest-under-mountains-preview.png"


def material(name, color, roughness=0.85):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    return mat


def link(obj, collection):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def cube(name, location, dimensions, mat, collection, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    link(obj, collection)
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("Soft forest edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 6
    return obj


def cone(name, location, radius, depth, mat, collection):
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=radius, radius2=radius * 0.12, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    link(obj, collection)
    obj.data.materials.append(mat)
    return obj


def cylinder(name, location, radius, depth, mat, collection):
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    link(obj, collection)
    obj.data.materials.append(mat)
    return obj


def ico(name, location, scale, mat, collection):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    link(obj, collection)
    obj.data.materials.append(mat)
    return obj


collection = bpy.data.collections.get("Forest — Whispering Pines")
if collection:
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
else:
    collection = bpy.data.collections.new("Forest — Whispering Pines")
    bpy.context.scene.collection.children.link(collection)
collection["region"] = "Dedicated forest region"
collection["placement"] = "Below Mountains — Mountain Terrain in top-down view"

ground = material("Whispering forest ground", (0.12, 0.29, 0.12))
soil = material("Whispering forest soil", (0.20, 0.12, 0.045))
trunk = material("Whispering pine trunks", (0.19, 0.07, 0.025))
needles = material("Whispering pine needles", (0.025, 0.19, 0.055))
tips = material("Whispering pine tips", (0.08, 0.31, 0.09))
stone = material("Whispering forest stones", (0.26, 0.29, 0.27))
hut_wall = material("Ranger hut wall", (0.40, 0.22, 0.08))
hut_roof = material("Ranger hut roof", (0.16, 0.055, 0.025))
path = material("Forest path", (0.42, 0.28, 0.13))

center_x, center_y = -54.0, 0.0
width, height = 21.0, 24.0
cube("Whispering forest terrain", (center_x, center_y, -0.32), (width, height, 0.62), ground, collection, bevel=2.2)
cube("Whispering forest soil rim", (center_x, center_y, -0.57), (width + 0.18, height + 0.18, 0.12), soil, collection, bevel=2.0)
connector = cube("Forest to mountain path", (-43.35, 0.0, 0.08), (2.7, 1.2, 0.14), path, collection, bevel=0.18)

tree_positions = [(-44.8, -8.6), (-45.2, 7.8), (-50.2, -9.0), (-58.5, 8.8), (-62.0, -3.0), (-48.3, 2.8), (-60.0, 5.1), (-64.0, -8.0), (-51.5, 10.0)]
for index, (x, y) in enumerate(tree_positions):
    cylinder(f"Forest pine trunk {index + 1:02d}", (x, y, 0.75), 0.18, 1.8, trunk, collection)
    cone(f"Forest pine lower boughs {index + 1:02d}", (x, y, 1.65), 1.05, 2.2, needles, collection)
    cone(f"Forest pine upper boughs {index + 1:02d}", (x, y, 2.75), 0.72, 1.8, tips, collection)
    cone(f"Forest pine crown {index + 1:02d}", (x, y, 3.55), 0.42, 1.3, needles, collection)

for index, (x, y, radius) in enumerate([(-47.0, -4.0, 0.65), (-56.5, -8.6, 0.8), (-61.5, 2.1, 0.55), (-51.0, 9.4, 0.7), (-64.0, 8.0, 0.5)]):
    ico(f"Forest standing stone {index + 1}", (x, y, radius * 0.55), (radius, radius * 0.82, radius * 0.72), stone, collection)

cube("Forest ranger hut", (-56.0, -1.5, 0.75), (3.1, 2.6, 1.6), hut_wall, collection, bevel=0.12)
roof = cube("Forest ranger hut roof", (-56.0, -1.5, 1.8), (3.7, 3.1, 0.55), hut_roof, collection, bevel=0.08)
roof.rotation_euler[1] = math.radians(8)
cube("Forest ranger hut door", (-56.0, -2.85, 0.65), (0.62, 0.08, 1.05), path, collection)

# Move the complete forest from the mountain's left side to directly below it
# in the user's top-down viewing angle. The mountain footprint ends near y=-12.2.
for obj in collection.objects:
    obj.location.x += 20.4
    obj.location.y -= 24.3
connector.location = (-33.6, -12.65, 0.08)
connector.dimensions = (1.2, 2.3, 0.14)

root = bpy.data.objects.new("REGION — Forest Left of Mountains", None)
bpy.context.scene.collection.objects.link(root)
root["neighbor"] = "Mountains — Mountain Terrain"
root["region_note"] = "Dedicated forest region placed below the mountain region in top-down view"

scene = bpy.context.scene
camera = scene.camera
if camera:
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 115.0
    camera.location.x = -12.0
    camera.location.y = -3.0
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
