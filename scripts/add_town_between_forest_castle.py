from pathlib import Path
import math

import bpy

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "art" / "wizard-royale-town-between-forest-castle.blend"
PREVIEW = ROOT / "art" / "wizard-royale-town-between-forest-castle-preview.png"


def material(name, color, roughness=0.82, metallic=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return mat


def relink(obj, collection):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def cube(name, location, dimensions, mat, collection, bevel=0.0, rotation=0.0):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=(0.0, 0.0, rotation))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    relink(obj, collection)
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("Rounded town edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 5
    return obj


def cylinder(name, location, radius, depth, mat, collection, vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    relink(obj, collection)
    obj.data.materials.append(mat)
    return obj


collection = bpy.data.collections.get("Town — Crossroads Borough")
if collection:
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
else:
    collection = bpy.data.collections.new("Town — Crossroads Borough")
    bpy.context.scene.collection.children.link(collection)
collection["region"] = "Town between forest and castle"
collection["neighbors"] = "Forest — Whispering Pines; Castle — Terrain & Water"

grass = material("Town meadow ground", (0.24, 0.43, 0.16))
soil = material("Town soil edge", (0.24, 0.13, 0.055))
road = material("Town packed roads", (0.47, 0.32, 0.17))
stone = material("Town plaza stone", (0.42, 0.43, 0.39))
wall = material("Town warm plaster", (0.72, 0.55, 0.32))
wall_dark = material("Town timber walls", (0.31, 0.15, 0.055))
roof_red = material("Town red roofs", (0.49, 0.09, 0.035))
roof_blue = material("Town blue roofs", (0.07, 0.20, 0.40))
wood = material("Town wood", (0.28, 0.12, 0.035))
metal = material("Town iron", (0.10, 0.12, 0.14), metallic=0.65)

center_x, center_y = -12.6, -17.0
width, height = 20.2, 17.2
cube("Crossroads town terrain", (center_x, center_y, -0.30), (width, height, 0.58), grass, collection, bevel=1.8)
cube("Crossroads town soil base", (center_x, center_y, -0.58), (width + 0.16, height + 0.16, 0.12), soil, collection, bevel=1.9)

# Main roads reach the forest on the left and the castle above.
cube("Town east-west road", (center_x, center_y, 0.04), (width + 1.0, 1.25, 0.10), road, collection, bevel=0.18)
cube("Town castle road", (center_x, center_y + 4.2, 0.05), (1.25, 9.8, 0.11), road, collection, bevel=0.18)
cube("Town forest connector", (-23.15, center_y, 0.05), (2.2, 1.25, 0.11), road, collection, bevel=0.18)
cube("Town castle connector", (center_x, -8.55, 0.05), (1.25, 2.0, 0.11), road, collection, bevel=0.18)

# Central market plaza and well.
cylinder("Town market plaza", (center_x, center_y, 0.10), 3.0, 0.16, stone, collection, vertices=24)
cylinder("Town well wall", (center_x, center_y, 0.45), 0.72, 0.75, stone, collection, vertices=16)
cylinder("Town well water", (center_x, center_y, 0.84), 0.52, 0.06, roof_blue, collection, vertices=20)
for side in (-1, 1):
    cube("Town well post", (center_x + side * 0.72, center_y, 1.25), (0.16, 0.16, 1.7), wood, collection)
cube("Town well beam", (center_x, center_y, 2.02), (1.7, 0.18, 0.18), wood, collection)

house_sites = [
    (-19.0, -12.3, 0.10),
    (-15.8, -12.1, -0.08),
    (-9.4, -12.2, 0.08),
    (-6.0, -13.0, -0.12),
    (-19.2, -21.6, -0.10),
    (-15.6, -22.1, 0.10),
    (-9.0, -21.8, -0.08),
    (-5.6, -20.8, 0.12),
]
for index, (x, y, rotation) in enumerate(house_sites):
    house_mat = wall if index % 3 else wall_dark
    roof_mat = roof_red if index % 2 == 0 else roof_blue
    cube(f"Town house {index + 1:02d}", (x, y, 0.78), (2.4, 1.9, 1.65), house_mat, collection, bevel=0.10, rotation=rotation)
    roof = cube(f"Town roof {index + 1:02d}", (x, y, 1.86), (2.85, 2.25, 0.55), roof_mat, collection, bevel=0.08, rotation=rotation)
    roof.rotation_euler[1] = math.radians(9 if index % 2 == 0 else -9)
    cube(f"Town door {index + 1:02d}", (x, y - 1.0, 0.62), (0.52, 0.10, 1.05), wood, collection, rotation=rotation)

# Clock tower landmark near the castle road.
cube("Town clock tower", (-9.4, -16.0, 1.8), (2.5, 2.5, 3.8), stone, collection, bevel=0.14)
roof = cube("Town clock tower roof", (-9.4, -16.0, 4.0), (3.0, 3.0, 0.75), roof_blue, collection, bevel=0.08)
roof.rotation_euler[1] = math.radians(14)
cylinder("Town clock face", (-9.4, -17.27, 2.75), 0.48, 0.10, metal, collection, vertices=20)

# Market stalls make the town read clearly from above.
for index, (x, y) in enumerate([(-14.8, -15.0), (-15.0, -19.0), (-10.3, -19.3)]):
    cube(f"Town market stall {index + 1}", (x, y, 0.55), (1.8, 1.25, 0.9), wood, collection, bevel=0.08)
    cube(f"Town market canopy {index + 1}", (x, y, 1.18), (2.0, 1.45, 0.18), roof_red if index % 2 == 0 else roof_blue, collection)

root = bpy.data.objects.new("REGION — Town Between Forest and Castle", None)
bpy.context.scene.collection.objects.link(root)
root["region_note"] = "Crossroads Borough placed between the forest and castle"

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
