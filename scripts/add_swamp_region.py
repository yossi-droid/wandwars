from pathlib import Path
import math

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "art" / "wizard-royale-with-swamp.blend"
PREVIEW = ROOT / "art" / "wizard-royale-with-swamp-preview.png"


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
        modifier = obj.modifiers.new("Soft swamp edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 5
    return obj


def cylinder(name, location, radius, depth, mat, collection, vertices=20):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    relink(obj, collection)
    obj.data.materials.append(mat)
    return obj


collection = bpy.data.collections.get("Swamp — Murkmire")
if collection:
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
else:
    collection = bpy.data.collections.new("Swamp — Murkmire")
    bpy.context.scene.collection.children.link(collection)
collection["region"] = "Swamp below the forest"
collection["neighbors"] = "Forest — Whispering Pines; Town — Crossroads Borough"

mud = material("Swamp dark mud", (0.13, 0.20, 0.10))
edge = material("Swamp peat edge", (0.11, 0.075, 0.035))
water = material("Swamp murky water", (0.055, 0.24, 0.21), roughness=0.28)
water_light = material("Swamp water highlights", (0.10, 0.38, 0.31), roughness=0.24)
moss = material("Swamp moss islands", (0.25, 0.34, 0.10))
wood = material("Swamp boardwalk wood", (0.25, 0.12, 0.045))
deadwood = material("Swamp dead trees", (0.18, 0.10, 0.045))
reed = material("Swamp reeds", (0.33, 0.39, 0.08))
roof = material("Swamp hut roof", (0.19, 0.11, 0.04))
glow = material("Swamp lantern glow", (0.95, 0.42, 0.06), roughness=0.35)

cx, cy = -33.2, -45.0
width, height = 22.5, 16.5
cube("Murkmire swamp terrain", (cx, cy, -0.32), (width, height, 0.60), mud, collection, bevel=2.4)
cube("Murkmire peat base", (cx, cy, -0.62), (width + 0.18, height + 0.18, 0.12), edge, collection, bevel=2.5)

# Pools form one readable wetland instead of scattered decorations.
pools = [
    (-39.0, -44.0, 3.5, 2.2),
    (-31.7, -42.1, 3.0, 1.8),
    (-35.5, -49.3, 4.0, 2.0),
    (-26.7, -47.8, 2.5, 1.6),
]
for i, (x, y, sx, sy) in enumerate(pools):
    pool = cylinder(f"Swamp pool {i + 1}", (x, y, 0.02), 1.0, 0.09, water, collection, vertices=28)
    pool.scale.x = sx
    pool.scale.y = sy
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    inner = cylinder(f"Swamp pool glint {i + 1}", (x - 0.3, y + 0.2, 0.08), 1.0, 0.035, water_light, collection, vertices=28)
    inner.scale.x = sx * 0.55
    inner.scale.y = sy * 0.42
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# Mossy islands keep the region navigable.
for i, (x, y, sx, sy) in enumerate([
    (-36.0, -41.2, 2.0, 1.2), (-28.0, -43.2, 1.8, 1.0),
    (-40.2, -48.4, 1.7, 1.1), (-29.0, -50.6, 2.1, 1.0),
]):
    island = cylinder(f"Swamp moss island {i + 1}", (x, y, 0.11), 1.0, 0.18, moss, collection, vertices=18)
    island.scale.x = sx
    island.scale.y = sy
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# A boardwalk links the forest edge to the town side.
for i in range(10):
    x = -38.2 + i * 1.45
    y = -39.0 - i * 1.0
    cube(f"Swamp boardwalk plank {i + 1:02d}", (x, y, 0.30), (1.65, 0.95, 0.18), wood, collection, bevel=0.07, rotation=math.radians(-7))
for i in range(5):
    cube(f"Swamp forest bridge {i + 1:02d}", (-37.8 + i * 1.05, -36.9, 0.30), (0.92, 1.65, 0.18), wood, collection, bevel=0.06)

# Crooked dead trees and reeds make the biome obvious from above.
tree_sites = [(-41.0, -41.0), (-34.4, -39.5), (-25.3, -42.0), (-39.6, -51.0), (-31.0, -48.0), (-24.7, -51.0)]
for i, (x, y) in enumerate(tree_sites):
    trunk = cylinder(f"Swamp dead tree {i + 1}", (x, y, 1.25), 0.24, 2.5, deadwood, collection, vertices=8)
    trunk.rotation_euler[1] = math.radians(8 if i % 2 else -10)
    cube(f"Swamp dead branch {i + 1}", (x + 0.35, y, 2.0), (0.8, 0.16, 0.16), deadwood, collection, rotation=math.radians(20 if i % 2 else -20))
for i, (x, y) in enumerate([(-42,-46),(-37,-46),(-32,-45),(-28,-40),(-25,-45),(-34,-52),(-27,-52)]):
    for j in range(3):
        cylinder(f"Swamp reed {i + 1}-{j + 1}", (x + j * 0.22, y + (j % 2) * 0.20, 0.48), 0.07, 0.9 + j * 0.18, reed, collection, vertices=6)

# Small stilt hut and lantern landmark.
cube("Swamp stilt hut", (-29.0, -46.2, 1.05), (3.0, 2.4, 1.6), deadwood, collection, bevel=0.10)
cube("Swamp stilt hut roof", (-29.0, -46.2, 2.08), (3.5, 2.9, 0.45), roof, collection, bevel=0.08)
for x in (-30.1, -27.9):
    for y in (-47.0, -45.4):
        cylinder("Swamp hut stilt", (x, y, 0.05), 0.10, 1.5, wood, collection, vertices=8)
cylinder("Swamp lantern post", (-31.2, -46.8, 1.05), 0.09, 1.9, wood, collection, vertices=8)
cylinder("Swamp lantern", (-31.2, -46.8, 2.05), 0.23, 0.42, glow, collection, vertices=12)

root = bpy.data.objects.get("REGION — Swamp Below Forest")
if not root:
    root = bpy.data.objects.new("REGION — Swamp Below Forest", None)
    bpy.context.scene.collection.objects.link(root)
root["region_note"] = "Murkmire swamp placed below the forest and connected toward town"

scene = bpy.context.scene
camera = scene.camera
if camera:
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 142.0
    camera.location.x = -12.0
    camera.location.y = -13.0
    camera.location.z = 90.0
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
