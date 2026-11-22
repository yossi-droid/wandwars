from pathlib import Path
import math

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "art" / "wizard-royale-plains-village.blend"
PREVIEW = ROOT / "art" / "wizard-royale-plains-village-preview.png"


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
        modifier = obj.modifiers.new("Soft village edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 4
    return obj


collection = bpy.data.collections.get("Plains — Scattered Village")
if collection:
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
else:
    collection = bpy.data.collections.new("Plains — Scattered Village")
    bpy.context.scene.collection.children.link(collection)

plaster = material("Plains house cream walls", (0.68, 0.50, 0.28))
stone_wall = material("Plains house stone walls", (0.42, 0.40, 0.34))
timber = material("Plains house timber", (0.25, 0.105, 0.035))
roof_red = material("Plains village red roofs", (0.50, 0.075, 0.025))
roof_blue = material("Plains village blue roofs", (0.065, 0.18, 0.34))
roof_brown = material("Plains village brown roofs", (0.28, 0.105, 0.035))
trunk_mat = material("Plains scattered tree trunks", (0.22, 0.105, 0.035))
leaf_dark = material("Plains scattered dark leaves", (0.07, 0.25, 0.075))
leaf_mid = material("Plains scattered green leaves", (0.12, 0.36, 0.105))
leaf_light = material("Plains scattered light leaves", (0.25, 0.47, 0.14))

# Houses follow the open grass pockets and keep the main roads unobstructed.
house_sites = [
    (-39.2, 22.0, 0.10), (-35.0, 26.1, -0.12), (-31.0, 18.6, 0.08),
    (-27.7, 27.0, -0.08), (-22.0, 18.0, 0.12), (-17.0, 27.0, -0.10),
    (-13.2, 19.4, 0.08), (-8.4, 27.0, 0.10), (-6.6, 17.0, -0.08),
    (-2.0, 20.1, 0.12), (1.7, 26.5, -0.12), (3.5, 16.0, 0.08),
    (-19.0, 15.3, -0.06), (-10.3, 15.0, 0.06),
]
roof_mats = [roof_red, roof_blue, roof_brown]
for index, (x, y, rotation) in enumerate(house_sites):
    width = 1.45 + (index % 3) * 0.18
    depth = 1.20 + (index % 2) * 0.18
    wall_mat = plaster if index % 4 else stone_wall
    cube(
        f"Plains scattered house {index + 1:02d}",
        (x, y, 1.35),
        (width, depth, 1.20),
        wall_mat,
        collection,
        bevel=0.08,
        rotation=rotation,
    )
    roof = cube(
        f"Plains scattered roof {index + 1:02d}",
        (x, y, 2.12),
        (width + 0.35, depth + 0.38, 0.42),
        roof_mats[index % len(roof_mats)],
        collection,
        bevel=0.06,
        rotation=rotation,
    )
    roof.rotation_euler[1] = math.radians(10 if index % 2 == 0 else -10)
    cube(
        f"Plains scattered door {index + 1:02d}",
        (x, y - depth * 0.52, 1.25),
        (0.32, 0.08, 0.58),
        timber,
        collection,
        bevel=0.03,
        rotation=rotation,
    )

# Trees are scattered in loose groups so the plains still read as open land.
tree_sites = [
    (-41.0, 24.8, 0), (-38.3, 19.1, 1), (-36.8, 27.2, 2),
    (-33.0, 22.7, 1), (-30.0, 26.0, 0), (-28.8, 16.3, 2),
    (-25.2, 20.0, 1), (-23.4, 26.0, 0), (-20.0, 21.0, 2),
    (-18.5, 24.8, 1), (-15.2, 17.0, 0), (-14.0, 23.8, 2),
    (-11.0, 27.2, 1), (-9.0, 21.5, 0), (-5.2, 25.0, 2),
    (-4.0, 15.2, 1), (-0.2, 18.0, 0), (2.8, 23.5, 2),
    (4.2, 27.0, 1), (4.5, 19.0, 0), (-33.2, 15.3, 2),
    (-26.0, 24.0, 1), (-16.0, 14.5, 0), (0.5, 14.8, 2),
]
leaf_mats = [leaf_dark, leaf_mid, leaf_light]
for index, (x, y, variant) in enumerate(tree_sites):
    height = 1.45 + (index % 3) * 0.18
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.15, depth=height, location=(x, y, 0.82 + height / 2))
    trunk = bpy.context.object
    trunk.name = f"Plains scattered tree trunk {index + 1:02d}"
    relink(trunk, collection)
    trunk.data.materials.append(trunk_mat)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.72 + (index % 2) * 0.12, location=(x, y, 1.72 + height * 0.45))
    canopy = bpy.context.object
    canopy.name = f"Plains scattered tree canopy {index + 1:02d}"
    canopy.scale = (1.0, 0.88, 0.78)
    relink(canopy, collection)
    canopy.data.materials.append(leaf_mats[variant])

collection["detail_note"] = "Fourteen scattered houses and twenty-four trees added across the plains"

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
