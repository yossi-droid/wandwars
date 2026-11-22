import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
REGION_SOURCE = ROOT / "art" / "wizard-royale-mine-region.blend"
BASE_MAP = ROOT / "art" / "wizard-royale-horizontal-map.blend"
MINE_BLEND = ROOT / "art" / "mine-region-detailed.blend"
MINE_GLB = ROOT / "public" / "models" / "mine-region-detailed.glb"
MINE_PREVIEW = ROOT / "art" / "mine-region-detailed-preview.png"
COMBINED_BLEND = ROOT / "art" / "wizard-royale-four-region-map.blend"
COMBINED_GLB = ROOT / "public" / "models" / "wizard-royale-four-region-map.glb"
COMBINED_PREVIEW = ROOT / "art" / "wizard-royale-four-region-map-preview.png"
DISTRICT = "Mine Region — Deepstone District"
GRAND_MINE = "Mine Region — Grand Mine"


def material(name, color, metallic=0.0, roughness=0.85, emission=None, strength=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission:
        shader.inputs["Emission Color"].default_value = (*emission, 1.0)
        shader.inputs["Emission Strength"].default_value = strength
    return mat


def relink(obj, collection):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def cube(name, location, dimensions, mat, collection, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    relink(obj, collection)
    return obj


def rock(name, location, scale, mat, collection, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    relink(obj, collection)
    return obj


def cylinder(name, location, radius, depth, mat, collection, rotation=(0, 0, 0), vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    relink(obj, collection)
    return obj


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_camera_and_lights(collection, center, preview_path, scale=18, wide=False):
    bpy.ops.object.camera_add(location=(center.x - scale * 0.72, center.y - scale, center.z + scale * 0.9))
    camera = bpy.context.object
    camera.name = "Preview Camera"
    camera.data.lens = 55 if not wide else 62
    look_at(camera, center)
    relink(camera, collection)
    bpy.context.scene.camera = camera
    bpy.ops.object.light_add(type="AREA", location=(center.x - 5, center.y - 7, center.z + 18))
    key = bpy.context.object
    key.name = "Preview Sunlight"
    key.data.energy = 1500
    key.data.shape = "DISK"
    key.data.size = 14
    look_at(key, center)
    relink(key, collection)
    bpy.ops.object.light_add(type="AREA", location=(center.x + 9, center.y + 6, center.z + 10))
    fill = bpy.context.object
    fill.name = "Preview Fill Light"
    fill.data.energy = 800
    fill.data.color = (0.45, 0.55, 1.0)
    fill.data.size = 10
    look_at(fill, center)
    relink(fill, collection)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1100 if not wide else 1500
    scene.render.resolution_y = 800 if not wide else 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(preview_path)
    scene.world.color = (0.025, 0.035, 0.06)


def create_standalone_mine():
    bpy.ops.wm.open_mainfile(filepath=str(REGION_SOURCE))
    district = bpy.data.collections.get(DISTRICT)
    if district is None:
        raise RuntimeError(f"Missing source collection: {DISTRICT}")
    keep = set(district.all_objects)
    for obj in list(bpy.data.objects):
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    for collection in list(bpy.data.collections):
        if collection != district:
            bpy.data.collections.remove(collection)
    if district.name not in {child.name for child in bpy.context.scene.collection.children}:
        bpy.context.scene.collection.children.link(district)

    # Recenter the extracted district so it can be attached anywhere as a module.
    source_center = Vector((19.92, 3.9, 0.0))
    for obj in district.all_objects:
        obj.location -= source_center
        obj["region_module"] = "Grand Mine"

    grand = bpy.data.collections.new(GRAND_MINE)
    bpy.context.scene.collection.children.link(grand)
    grand["region_module"] = "Grand Mine"
    dark = material("Grand Mine tunnel darkness", (0.004, 0.003, 0.005), roughness=1.0)
    stone = material("Grand Mine volcanic stone", (0.055, 0.045, 0.04), roughness=0.98)
    warm = material("Grand Mine ironstone", (0.24, 0.075, 0.022), roughness=0.95)
    timber = material("Grand Mine structural timber", (0.16, 0.045, 0.012), roughness=0.92)
    iron = material("Grand Mine rail iron", (0.055, 0.065, 0.075), metallic=0.78, roughness=0.4)
    ore = material("Grand Mine glowing ore", (0.18, 0.015, 0.42), roughness=0.22, emission=(0.5, 0.02, 1.0), strength=7.0)

    # Castle-sized rock mountain with a central arched opening facing west.
    mountain_specs = [
        (5.2, 0.0, 3.6, 4.8),
        (6.1, -2.4, 3.1, 4.0),
        (6.0, 2.5, 3.2, 4.2),
        (7.2, -0.8, 2.7, 4.6),
        (4.5, -3.1, 2.2, 3.1),
        (4.6, 3.3, 2.3, 3.2),
    ]
    for index, (x, y, radius, height) in enumerate(mountain_specs, 1):
        rock(
            f"Grand Mine mountain mass {index}",
            (x, y, height * 0.58),
            (radius, radius * 0.85, height),
            stone if index % 3 else warm,
            grand,
            rotation=(0.13 * index, 0.08 * index, 0.29 * index),
        )

    entrance_x = 2.75
    width, wall_height, arch_radius = 4.8, 3.6, 2.4
    verts = [(entrance_x, -width / 2, 0), (entrance_x, -width / 2, wall_height)]
    for step in range(13):
        angle = math.pi - step * math.pi / 12
        verts.append((entrance_x, math.cos(angle) * arch_radius, wall_height + math.sin(angle) * arch_radius))
    verts.append((entrance_x, width / 2, 0))
    mesh = bpy.data.meshes.new("Grand Mine arched portal mesh")
    mesh.from_pydata(verts, [], [tuple(range(len(verts)))])
    entrance = bpy.data.objects.new("Grand Mine enormous black entrance", mesh)
    entrance.data.materials.append(dark)
    grand.objects.link(entrance)

    for side in (-1, 1):
        cube("Grand Mine gate post", (entrance_x - 0.25, side * 2.65, 2.25), (0.7, 0.75, 4.8), timber, grand, rotation=(0, side * 0.05, side * 0.025))
        cube("Grand Mine diagonal brace", (entrance_x - 0.45, side * 1.85, 4.1), (0.45, 2.2, 0.4), timber, grand, rotation=(side * 0.45, 0, 0))
    cube("Grand Mine gate lintel", (entrance_x - 0.3, 0, 4.65), (0.8, 6.2, 0.7), timber, grand)

    # Long double track and cross ties create a readable route into the entrance.
    rail_start, rail_end = -6.8, entrance_x + 0.3
    for side in (-0.58, 0.58):
        cube("Grand Mine main rail", ((rail_start + rail_end) / 2, side, 0.18), (rail_end - rail_start, 0.13, 0.15), iron, grand)
    for index in range(18):
        x = rail_start + index * (rail_end - rail_start) / 17
        cube(f"Grand Mine sleeper {index + 1:02d}", (x, 0, 0.1), (0.32, 2.0, 0.16), timber, grand)

    # Ore tower and carts make the separate region unmistakably mine-themed.
    for index, (x, y) in enumerate([(-3.8, -3.0), (-1.4, 3.5), (0.8, -4.0)], 1):
        cube(f"Grand Mine ore cart {index}", (x, y, 0.65), (1.55, 1.1, 0.8), iron, grand)
        for side in (-0.48, 0.48):
            cylinder(f"Grand Mine cart wheel {index}", (x + side, y - 0.58, 0.28), 0.28, 0.16, iron, grand, rotation=(math.pi / 2, 0, 0))
        for shard in range(3):
            cylinder(f"Grand Mine cart ore {index}-{shard}", (x - 0.4 + shard * 0.4, y, 1.18 + 0.08 * (shard % 2)), 0.2, 0.72, ore, grand, vertices=6)

    presentation = bpy.data.collections.new("Mine Region Preview")
    bpy.context.scene.collection.children.link(presentation)
    add_camera_and_lights(presentation, Vector((0, 0, 1.4)), MINE_PREVIEW, scale=18)
    bpy.ops.wm.save_as_mainfile(filepath=str(MINE_BLEND))
    bpy.ops.export_scene.gltf(filepath=str(MINE_GLB), export_format="GLB", export_yup=True)
    bpy.ops.render.render(write_still=True)


def collection_bounds(collections):
    points = []
    for collection in collections:
        for obj in collection.all_objects:
            if obj.type != "MESH":
                continue
            for corner in obj.bound_box:
                points.append(obj.matrix_world @ Vector(corner))
    if not points:
        return Vector((-10, -10, 0)), Vector((10, 10, 5))
    return Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points))), Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))


def attach_to_desert():
    bpy.ops.wm.open_mainfile(filepath=str(BASE_MAP))
    # Remove any earlier small mine collection so the map has exactly one mine region.
    for collection in list(bpy.data.collections):
        if collection.name in {"Desert — Eastern Mine", DISTRICT, GRAND_MINE}:
            bpy.data.collections.remove(collection)

    desert = [collection for collection in bpy.data.collections if collection.name.startswith("Desert —")]
    dmin, dmax = collection_bounds(desert)
    desert_center_y = (dmin.y + dmax.y) * 0.5
    region_center = Vector((dmax.x + 8.2, desert_center_y, 0.0))

    with bpy.data.libraries.load(str(MINE_BLEND), link=False) as (data_from, data_to):
        data_to.collections = [name for name in (DISTRICT, GRAND_MINE) if name in data_from.collections]
    loaded = [collection for collection in data_to.collections if collection]
    if len(loaded) != 2:
        raise RuntimeError("Could not append both standalone mine collections")
    shifted = set()
    for collection in loaded:
        bpy.context.scene.collection.children.link(collection)
        for obj in collection.all_objects:
            pointer = obj.as_pointer()
            if pointer in shifted:
                continue
            shifted.add(pointer)
            obj.location += region_center
            obj["region_module"] = "Grand Mine"

    transition = bpy.data.collections.new("Transition — Desert to Grand Mine")
    bpy.context.scene.collection.children.link(transition)
    path_mat = material("Mine transition path", (0.48, 0.23, 0.07), roughness=0.96)
    transition_length = max(1.0, region_center.x - 7.5 - dmax.x + 1.0)
    cube("Desert mine connecting road", (dmax.x + transition_length / 2, desert_center_y, 0.08), (transition_length + 1.0, 2.3, 0.15), path_mat, transition)
    for index, y in enumerate((-3.0, -1.8, 1.8, 3.0), 1):
        rock("Mine border rock", (dmax.x + 0.7, desert_center_y + y, 0.45), (0.75, 0.55, 0.65), bpy.data.materials["Grand Mine ironstone"], transition, rotation=(0.1, 0.2, index))

    # Fit a clean overview camera to all four playable regions.
    playable = [
        collection
        for collection in bpy.data.collections
        if collection.name.startswith(("Castle", "Desert", "Mountains", "Transition", "Mine Region"))
    ]
    world_min, world_max = collection_bounds(playable)
    center = (world_min + world_max) * 0.5
    size = max(world_max.x - world_min.x, (world_max.y - world_min.y) * 1.7)
    presentation = bpy.data.collections.new("Four Region Preview")
    bpy.context.scene.collection.children.link(presentation)
    bpy.ops.object.camera_add(location=(center.x, center.y - size * 0.18, world_max.z + size * 0.9))
    camera = bpy.context.object
    camera.name = "Four Region Map Camera"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = size * 0.69
    look_at(camera, (center.x, center.y, 0))
    relink(camera, presentation)
    bpy.context.scene.camera = camera
    bpy.ops.object.light_add(type="AREA", location=(center.x - 10, center.y - 20, world_max.z + 30))
    sun = bpy.context.object
    sun.name = "Four Region Sunlight"
    sun.data.energy = 1800
    sun.data.size = 25
    look_at(sun, center)
    relink(sun, presentation)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1500
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(COMBINED_PREVIEW)
    bpy.ops.wm.save_as_mainfile(filepath=str(COMBINED_BLEND))
    bpy.ops.export_scene.gltf(filepath=str(COMBINED_GLB), export_format="GLB", export_yup=True)
    bpy.ops.render.render(write_still=True)
    print(f"MINE={MINE_BLEND}")
    print(f"COMBINED={COMBINED_BLEND}")
    print(f"MINE_CENTER={tuple(round(value, 2) for value in region_center)}")


if __name__ == "__main__":
    create_standalone_mine()
    attach_to_desert()
