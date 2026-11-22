from pathlib import Path
import math

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "art" / "wizard-royale-detailed-plains.blend"
PREVIEW = ROOT / "art" / "wizard-royale-detailed-plains-preview.png"


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


def cube(name, location, dimensions, mat, collection, bevel=0.0, rotation=0.0):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=(0.0, 0.0, rotation))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    relink(obj, collection)
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("Soft detail edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 4
    return obj


def cylinder(name, location, radius, depth, mat, collection, vertices=16, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    relink(obj, collection)
    obj.data.materials.append(mat)
    return obj


collection = bpy.data.collections.get("Plains — Farming Details")
if collection:
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
else:
    collection = bpy.data.collections.new("Plains — Farming Details")
    bpy.context.scene.collection.children.link(collection)

dark_soil = material("Plains cultivated soil", (0.28, 0.16, 0.065))
wheat = material("Plains golden wheat", (0.72, 0.49, 0.10))
crop_green = material("Plains green crops", (0.16, 0.39, 0.09))
wood = material("Plains fence wood", (0.30, 0.16, 0.055))
hay = material("Plains hay bales", (0.78, 0.55, 0.12))
pond = material("Plains pond water", (0.07, 0.38, 0.55), roughness=0.25)
pond_edge = material("Plains pond bank", (0.24, 0.32, 0.10))
barn_wall = material("Plains barn red", (0.52, 0.10, 0.045))
barn_roof = material("Plains barn roof", (0.22, 0.08, 0.035))
flower_yellow = material("Plains yellow flowers", (0.95, 0.68, 0.04))
flower_white = material("Plains white flowers", (0.92, 0.90, 0.70))

# Three cultivated plots with alternating crop colors.
plots = [
    (-18.5, 23.4, 6.4, 3.6, 0.06),
    (-10.8, 25.2, 5.6, 2.9, -0.04),
    (-34.0, 19.1, 5.8, 3.2, -0.08),
]
for plot_index, (cx, cy, width, height, rotation) in enumerate(plots):
    cube(f"Cultivated plot {plot_index + 1}", (cx, cy, 0.79), (width, height, 0.09), dark_soil, collection, bevel=0.24, rotation=rotation)
    rows = 7
    for row in range(rows):
        x = cx - width * 0.40 + row * (width * 0.80 / (rows - 1))
        cube(
            f"Crop row {plot_index + 1}-{row + 1}",
            (x, cy, 0.90),
            (0.18, height * 0.82, 0.13),
            wheat if (plot_index + row) % 2 == 0 else crop_green,
            collection,
            bevel=0.05,
            rotation=rotation,
        )

# Fence runs divide the farms without blocking the existing roads.
for index in range(10):
    x = -40.0 + index * 1.25
    cylinder(f"West fence post {index + 1}", (x, 17.0, 1.12), 0.09, 0.72, wood, collection, vertices=8)
    if index < 9:
        cube(f"West fence rail {index + 1}", (x + 0.625, 17.0, 1.18), (1.30, 0.10, 0.12), wood, collection)
for index in range(8):
    x = -4.0 + index * 1.1
    cylinder(f"East fence post {index + 1}", (x, 20.7, 1.12), 0.09, 0.72, wood, collection, vertices=8)
    if index < 7:
        cube(f"East fence rail {index + 1}", (x + 0.55, 20.7, 1.18), (1.15, 0.10, 0.12), wood, collection)

# Hay bales beside the crop fields.
for index, (x, y, angle) in enumerate([
    (-22.5, 20.5, 0.0), (-20.9, 20.1, 0.18), (-13.6, 22.2, -0.12),
    (-8.3, 23.0, 0.10), (-31.0, 17.9, -0.16),
]):
    cylinder(
        f"Hay bale {index + 1}",
        (x, y, 1.15),
        0.46,
        0.85,
        hay,
        collection,
        vertices=16,
        rotation=(0.0, math.radians(90), angle),
    )

# A small pond adds a natural landmark on the quieter eastern side.
bank = cylinder("Plains pond bank", (-3.6, 24.0, 0.80), 1.0, 0.10, pond_edge, collection, vertices=28)
bank.scale.x = 2.5
bank.scale.y = 1.6
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
water = cylinder("Plains pond", (-3.6, 24.0, 0.87), 1.0, 0.06, pond, collection, vertices=28)
water.scale.x = 2.05
water.scale.y = 1.20
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# Barn beside the central farms.
cube("Plains red barn", (-25.0, 26.2, 1.55), (3.4, 2.7, 1.75), barn_wall, collection, bevel=0.12)
roof = cube("Plains barn roof", (-25.0, 26.2, 2.70), (4.0, 3.2, 0.55), barn_roof, collection, bevel=0.09)
roof.rotation_euler[1] = math.radians(12)
cube("Plains barn door", (-25.0, 24.82, 1.48), (1.10, 0.10, 1.45), wood, collection, bevel=0.05)

# Small flower clusters fill otherwise empty grass without becoming visual noise.
flower_sites = [
    (-39.0, 25.8), (-36.8, 21.8), (-29.0, 18.0), (-16.0, 18.8),
    (-7.0, 17.0), (2.0, 25.8), (3.4, 18.5), (-14.0, 27.2),
]
for index, (x, y) in enumerate(flower_sites):
    for petal in range(3):
        cylinder(
            f"Wildflower {index + 1}-{petal + 1}",
            (x + petal * 0.18, y + (petal % 2) * 0.14, 0.94),
            0.085,
            0.12,
            flower_yellow if index % 2 == 0 else flower_white,
            collection,
            vertices=8,
        )

collection["detail_note"] = "Crop fields, fences, hay, pond, barn, and wildflowers added to Great Greenfields"

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
