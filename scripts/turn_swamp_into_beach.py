"""Replace Murkmire in the latest saved map with a connected coastal beach."""

from pathlib import Path
import math

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
VILLAGE_REFERENCE = ROOT / "art" / "wizard-royale-village-reference.blend"
OUTPUT = ROOT / "art" / "wizard-royale-beach-map.blend"
MAP_PREVIEW = ROOT / "art" / "wizard-royale-beach-map-preview.png"
BEACH_PREVIEW = ROOT / "art" / "wizard-royale-beach-closeup.png"

# Carry forward the user's newer village layout while retaining the latest
# saved map for every other region and the rivers.
old_town = bpy.data.collections["Town — Crossroads Borough"]
for obj in list(old_town.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
bpy.data.collections.remove(old_town)
with bpy.data.libraries.load(str(VILLAGE_REFERENCE), link=False) as (source, loaded):
    loaded.collections = ["Town — Crossroads Borough"]
bpy.context.scene.collection.children.link(loaded.collections[0])

swamp = bpy.data.collections["Swamp — Murkmire"]
swamp.name = "Beach — Sunshore Coast"
swamp["region"] = "Beach beside the town and desert"
swamp["neighbors"] = "Town — Crossroads Borough; Desert — Frontier Town; World Ocean"
for obj in list(swamp.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

for obj in bpy.data.objects:
    if obj.name.startswith("REGION — Swamp"):
        obj.name = "REGION — Sunshore Beach"
        obj["region_note"] = "Coastal beach at the former Murkmire location"


def material(name, color, roughness=0.85, metallic=0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return mat


sand = material("Beach warm sand", (0.65, 0.48, 0.26))
sand_edge = material("Beach sandstone edge", (0.49, 0.36, 0.19))
wet_sand = material("Beach wet sand", (0.53, 0.43, 0.29))
water = material("Beach shallow turquoise water", (0.08, 0.43, 0.55), roughness=0.26)
foam = material("Beach seafoam", (0.75, 0.86, 0.80), roughness=0.42)
dune = material("Beach dune sand", (0.70, 0.55, 0.33))
path_sand = material("Beach packed path sand", (0.58, 0.44, 0.24))
pebble = material("Beach pale pebble", (0.68, 0.64, 0.52))
wood = material("Beach weathered pier wood", (0.34, 0.25, 0.14))
wood_dark = material("Beach dark driftwood", (0.23, 0.17, 0.10))
leaf = material("Beach palm green", (0.18, 0.42, 0.18))
leaf_light = material("Beach palm sunlit green", (0.29, 0.53, 0.23))
shell = material("Beach shell ivory", (0.85, 0.76, 0.58))
red_roof = material("Beach cabana terracotta", (0.49, 0.16, 0.08))
blue_roof = material("Beach cabana blue", (0.10, 0.29, 0.45))

# Earlier rectangle work placed extra swamp pieces in a separate extension
# collection. Convert its ground and remove the remaining pools and reeds too.
for obj in list(bpy.data.objects):
    if not obj.name.startswith("Swamp "):
        continue
    if "to map edge" in obj.name:
        obj.name = obj.name.replace("Swamp", "Sunshore beach", 1)
        obj.data.materials.clear()
        obj.data.materials.append(sand)
    else:
        bpy.data.objects.remove(obj, do_unlink=True)


def relink(obj, mat):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    swamp.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def cube(name, loc, dimensions, mat, bevel=0, rotation=0):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    obj = relink(bpy.context.object, mat)
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler.z = rotation
    if bevel:
        modifier = obj.modifiers.new("Soft beach edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 4
    return obj


def cylinder(name, loc, radius, depth, mat, vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    obj = relink(bpy.context.object, mat)
    obj.name = name
    return obj


def ico(name, loc, scale, mat, subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=loc)
    obj = relink(bpy.context.object, mat)
    obj.name = name
    obj.scale = scale
    return obj


def flat_mesh(name, points, z, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(x, y, z) for x, y in points], [], [tuple(range(len(points)))])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    swamp.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


cx, cy = 5.0, -16.0
cube("Sunshore sand terrain", (cx, cy, -0.32), (22.5, 16.5, 0.60), sand, bevel=2.4)
cube("Sunshore sandstone base", (cx, cy, -0.62), (22.68, 16.68, 0.12), sand_edge, bevel=2.5)

# One continuous curved water edge replaces the old disconnected swamp pools.
# It reaches the southern ocean at y=-28.5 and bends around the town corner.
shore = [
    (-6.15, -23.85), (-4.0, -23.45), (-1.5, -22.90), (1.0, -22.15),
    (3.5, -21.85), (6.0, -21.45), (8.7, -21.75), (11.2, -22.30),
    (13.5, -22.05), (16.1, -21.35), (18.7, -21.70),
    (21.2, -22.40), (24.0, -22.10),
]
flat_mesh("Shallow coastal water", shore + [(24.0, -28.50), (-6.15, -28.50)], 0.025, water)
flat_mesh("Curved wet-sand margin",
          [(x, y + 0.70) for x, y in shore] + list(reversed(shore)), 0.030, wet_sand)
foam_land, foam_sea = [], []
for index, (x, y) in enumerate(shore):
    before = shore[max(index - 1, 0)]
    after = shore[min(index + 1, len(shore) - 1)]
    dx, dy = after[0] - before[0], after[1] - before[1]
    distance = math.hypot(dx, dy)
    nx, ny = -dy / distance * 0.055, dx / distance * 0.055
    foam_land.append((x + nx, y + ny))
    foam_sea.append((x - nx, y - ny))
flat_mesh("Continuous seafoam shoreline", foam_land + list(reversed(foam_sea)), 0.060, foam)

# A sandy path keeps the beach connected to the town and runs to the pier.
path = [(-5.0, -15.8), (-2.0, -17.0), (0.8, -18.9), (3.4, -21.5)]
left, right = [], []
for index, (x, y) in enumerate(path):
    before = path[max(index - 1, 0)]
    after = path[min(index + 1, len(path) - 1)]
    dx, dy = after[0] - before[0], after[1] - before[1]
    distance = math.hypot(dx, dy)
    nx, ny = -dy / distance * 0.36, dx / distance * 0.36
    left.append((x + nx, y + ny))
    right.append((x - nx, y - ny))
flat_mesh("Continuous packed-sand beach path", left + list(reversed(right)), 0.060, path_sand)

# A short pier reaches into the ocean, replacing the swamp boardwalk.
for index in range(7):
    y = -21.4 - index * 0.49
    cube(f"Sunshore pier plank {index + 1:02d}", (3.6, y, 0.20),
         (2.15, 0.43, 0.15), wood, bevel=0.04)
for x in (2.70, 4.50):
    for y in (-21.45, -23.90):
        cylinder("Sunshore pier post", (x, y, 0.09), 0.11, 0.64, wood_dark, 8)

# Dunes cluster inland, leaving a broad clean beach at the waterline.
for index, (x, y, sx, sy) in enumerate([
    (-3.2, -10.0, 2.1, 0.85), (0.7, -9.5, 2.6, 0.9),
    (6.7, -9.2, 3.2, 0.75), (13.0, -10.8, 2.4, 0.8),
    (-1.2, -18.8, 2.1, 0.55), (10.5, -18.4, 2.0, 0.58),
], start=1):
    ico(f"Sunshore dune {index}", (x, y, 0.08), (sx, sy, 0.21), dune, subdivisions=2)


def palm(number, x, y, height, lean):
    trunk = cylinder(f"Palm {number} trunk", (x, y, height / 2 + 0.03),
                     0.14, height, wood_dark, 9)
    trunk.rotation_euler.y = lean
    crown_x = x + math.sin(lean) * height * 0.35
    crown_z = height + 0.02
    for leaf_index in range(8):
        theta = 2 * math.pi * leaf_index / 8
        length = 1.20 + (leaf_index % 3) * 0.13
        side = 0.26
        points = [
            (crown_x, y, crown_z),
            (crown_x + math.cos(theta + 0.32) * length * 0.60,
             y + math.sin(theta + 0.32) * length * 0.60, crown_z + 0.12),
            (crown_x + math.cos(theta) * length,
             y + math.sin(theta) * length, crown_z - 0.28),
            (crown_x + math.cos(theta - 0.32) * length * 0.60,
             y + math.sin(theta - 0.32) * length * 0.60, crown_z + 0.12),
        ]
        mesh = bpy.data.meshes.new(f"Palm {number} frond {leaf_index + 1}")
        mesh.from_pydata(points, [], [(0, 1, 2), (0, 2, 3)])
        mesh.update()
        obj = bpy.data.objects.new(mesh.name, mesh)
        swamp.objects.link(obj)
        mesh.materials.append(leaf_light if leaf_index % 2 else leaf)


for index, (x, y, height, lean) in enumerate([
    (-4.2, -18.1, 1.65, 0.11), (-1.8, -12.9, 1.9, -0.13),
    (2.2, -11.5, 1.7, 0.10), (7.0, -13.5, 2.0, -0.08),
    (11.5, -14.1, 1.85, 0.12), (14.5, -19.5, 1.55, -0.08),
], start=1):
    palm(index, x, y, height, lean)

# One pair of small coastal cabanas retains the map's village-roof colors.
for index, (x, y, roof_mat) in enumerate([
    (8.2, -16.8, blue_roof), (13.2, -16.5, red_roof),
], start=1):
    cube(f"Beach cabana {index}", (x, y, 0.54), (1.70, 1.32, 1.05), wood, bevel=0.07)
    cube(f"Beach cabana roof {index}", (x, y, 1.16),
         (2.0, 1.58, 0.22), roof_mat, bevel=0.05)
    cube(f"Beach cabana door {index}", (x, y - 0.69, 0.48),
         (0.42, 0.06, 0.66), wood_dark)

for index, (x, y, size) in enumerate([
    (-3.6, -20.7, 0.32), (-0.6, -19.9, 0.27), (5.8, -18.8, 0.33),
    (9.5, -20.0, 0.30), (14.7, -11.0, 0.41), (12.7, -19.8, 0.25),
], start=1):
    ico(f"Beach shoreline rock {index}", (x, y, 0.17),
        (size, size * 0.75, size * 0.62), pebble)
for index, (x, y) in enumerate([
    (-2.7, -21.4), (-0.9, -20.9), (1.7, -20.9), (5.6, -20.5),
    (8.4, -20.4), (11.3, -21.0), (14.9, -20.3),
], start=1):
    ico(f"Beach shell {index}", (x, y, 0.060), (0.13, 0.09, 0.045), shell)
for index, (x, y, angle) in enumerate([
    (-3.1, -19.4, 0.28), (10.8, -20.1, -0.18),
], start=1):
    log = cylinder(f"Sunshore driftwood {index}", (x, y, 0.16), 0.11, 1.1, wood_dark, 8)
    log.rotation_euler = (math.pi / 2, 0, angle)

scene = bpy.context.scene
camera = scene.camera
if camera:
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(MAP_PREVIEW)

bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
if camera:
    original_location = camera.location.copy()
    original_scale = camera.data.ortho_scale
    original_path = scene.render.filepath
    bpy.ops.render.render(write_still=True)
    camera.location.x = cx
    camera.location.y = cy
    camera.data.ortho_scale = 27.5
    scene.render.filepath = str(BEACH_PREVIEW)
    bpy.ops.render.render(write_still=True)
    camera.location = original_location
    camera.data.ortho_scale = original_scale
    scene.render.filepath = original_path

print(f"Saved {OUTPUT}")
print(f"Rendered {MAP_PREVIEW} and {BEACH_PREVIEW}")
