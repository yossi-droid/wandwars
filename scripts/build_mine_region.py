import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "art" / "wizard-royale-horizontal-map.blend"
OUTPUT = ROOT / "art" / "wizard-royale-mine-region.blend"
GLB = ROOT / "public" / "models" / "wizard-royale-mine-region.glb"
PREVIEW = ROOT / "art" / "wizard-royale-mine-region-preview.png"
MINE_X, MINE_Y = 19.92, 2.7


def mat(name, color, metallic=0.0, roughness=0.85, emission=None, strength=0.0):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission:
        shader.inputs["Emission Color"].default_value = (*emission, 1)
        shader.inputs["Emission Strength"].default_value = strength
    return material


def link(obj, collection):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    collection.objects.link(obj)


def cube(name, location, dimensions, material, collection, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    link(obj, collection)
    return obj


def rock(name, location, scale, material, collection, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.rotation_euler = rotation
    obj.data.materials.append(material)
    link(obj, collection)
    return obj


def cylinder(name, location, radius, depth, material, collection, vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    link(obj, collection)
    return obj


def cone(name, location, radius, depth, material, collection, vertices=7):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=radius * 0.28, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    link(obj, collection)
    return obj


def surface_z(x, y):
    terrain = bpy.data.objects.get("Detailed Ember Dunes Terrain")
    if terrain is None:
        return 0.0
    hidden = []
    for obj in bpy.context.scene.objects:
        if obj != terrain and not obj.hide_viewport:
            obj.hide_viewport = True
            hidden.append(obj)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    hit, location, *_ = bpy.context.scene.ray_cast(depsgraph, Vector((x, y, 30)), Vector((0, 0, -1)))
    for obj in hidden:
        obj.hide_viewport = False
    return location.z if hit else 0.0


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def main():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    collection = bpy.data.collections.get("Mine Region — Deepstone District")
    if collection:
        for obj in list(collection.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
    else:
        collection = bpy.data.collections.new("Mine Region — Deepstone District")
        bpy.context.scene.collection.children.link(collection)
    collection["region"] = "Dedicated Mine Region"
    collection["landmark"] = "Eastern Arcane Mine"

    sand = mat("Deepstone quarry sand", (0.30, 0.12, 0.045), roughness=0.98)
    sand_light = mat("Deepstone worn paths", (0.50, 0.25, 0.08), roughness=0.94)
    rock_dark = mat("Deepstone black rock", (0.055, 0.045, 0.04), roughness=0.98)
    rock_warm = mat("Deepstone red rock", (0.23, 0.075, 0.025), roughness=0.96)
    timber = mat("Deepstone timber", (0.18, 0.055, 0.018), roughness=0.92)
    iron = mat("Deepstone iron", (0.07, 0.075, 0.085), metallic=0.7, roughness=0.43)
    ore = mat("Deepstone violet ore", (0.13, 0.018, 0.34), roughness=0.25, emission=(0.34, 0.02, 0.9), strength=5)
    fire = mat("Deepstone furnace glow", (0.9, 0.08, 0.01), roughness=0.3, emission=(1, 0.04, 0.005), strength=7)

    base = surface_z(MINE_X, MINE_Y)
    # A broad, stepped quarry floor leaves a large open battle space around the mine.
    cube("Deepstone quarry floor", (MINE_X, MINE_Y + 1.2, base - 0.12), (15.5, 13.5, 0.24), sand, collection)
    for index, (x, y, w, d, z) in enumerate(
        [
            (13.6, -1.0, 3.0, 2.0, 0.45),
            (26.3, -1.4, 3.2, 2.4, 0.75),
            (13.2, 8.1, 3.6, 2.0, 0.65),
            (26.7, 8.4, 3.1, 2.4, 0.95),
        ],
        1,
    ):
        cube(f"Deepstone quarry terrace {index}", (x, y, base + z), (w, d, z + 0.18), rock_warm, collection)

    # Three monumental spoil heaps make the district readable from a distance.
    for index, (x, y, radius, height) in enumerate(
        [(13.5, 5.8, 1.45, 2.6), (26.5, 5.7, 1.65, 3.1), (24.9, -2.4, 1.25, 2.4)],
        1,
    ):
        cone(f"Deepstone spoil heap {index}", (x, y, base + height / 2), radius, height, rock_dark, collection)
        for shard in range(3):
            angle = shard * math.tau / 3 + index
            rock(
                f"Deepstone heap boulder {index}-{shard}",
                (x + math.cos(angle) * radius * 0.7, y + math.sin(angle) * radius * 0.7, base + 0.35),
                (0.45, 0.34, 0.32),
                rock_warm,
                collection,
                rotation=(0.2 * shard, 0.3 * index, angle),
            )

    # Main road and two branch roads connect the mine to the region edge.
    cube("Deepstone main haul road", (MINE_X - 3.6, MINE_Y + 1.25, base + 0.04), (7.3, 1.5, 0.08), sand_light, collection)
    cube("Deepstone north road", (MINE_X + 1.5, MINE_Y + 4.8, base + 0.05), (1.2, 5.0, 0.09), sand_light, collection)
    cube("Deepstone west road", (MINE_X - 4.7, MINE_Y - 2.7, base + 0.05), (5.5, 1.1, 0.09), sand_light, collection, rotation=(0, 0, -0.28))

    # A processing yard sits beside the open mine approach.
    cube("Deepstone processing yard", (MINE_X + 4.0, MINE_Y + 2.1, base + 0.16), (4.4, 3.4, 0.22), rock_dark, collection)
    for index, x in enumerate((MINE_X + 2.5, MINE_X + 4.0, MINE_X + 5.5), 1):
        cylinder(f"Deepstone ore crusher {index}", (x, MINE_Y + 2.3, base + 0.75), 0.55, 1.25, iron, collection)
        cylinder(f"Deepstone ore crystal {index}", (x, MINE_Y + 2.3, base + 1.45), 0.22, 0.85, ore, collection, vertices=6)
    for index in range(4):
        cube(
            f"Deepstone timber trestle {index + 1}",
            (MINE_X + 3.0 + index * 0.8, MINE_Y - 0.3, base + 1.0 + index * 0.08),
            (0.18, 2.5, 2.0),
            timber,
            collection,
            rotation=(0, 0, (index % 2) * 0.08),
        )

    # Worker camp and blacksmith huts give the new region a human-scale landmark.
    for index, (x, y, size) in enumerate([(14.0, 1.0, 1.25), (15.2, 3.0, 1.0), (25.8, 1.0, 1.35)], 1):
        z = base + size / 2
        cube(f"Deepstone worker hut {index}", (x, y, z), (size * 1.4, size, size), timber, collection)
        cone(f"Deepstone hut roof {index}", (x, y, base + size + 0.45), size * 0.9, 0.9, rock_dark, collection, vertices=4)
        cube(f"Deepstone hut doorway {index}", (x - size * 0.71, y, base + 0.45), (0.05, 0.32, 0.65), iron, collection)

    # Sparse cover keeps the region playable rather than filling the combat lanes.
    for index, (x, y, scale) in enumerate(
        [(12.5, 2.0, 0.7), (17.0, 8.2, 0.85), (22.2, 8.0, 0.75), (28.1, 2.8, 0.8), (29.0, 6.7, 0.65)],
        1,
    ):
        rock(f"Deepstone cover rock {index}", (x, y, base + scale * 0.45), (scale, scale * 0.75, scale * 0.65), rock_dark, collection, rotation=(0.1 * index, 0.2, 0.3 * index))

    # A tall ore beacon marks the district from across the desert.
    cylinder("Deepstone beacon pillar", (MINE_X + 0.6, MINE_Y + 6.0, base + 2.3), 0.28, 4.4, iron, collection)
    cylinder("Deepstone beacon crystal", (MINE_X + 0.6, MINE_Y + 6.0, base + 4.8), 0.48, 1.1, ore, collection, vertices=6)
    bpy.ops.object.light_add(type="POINT", location=(MINE_X + 0.6, MINE_Y + 6.0, base + 4.8))
    light = bpy.context.object
    light.name = "Deepstone beacon light"
    light.data.color = (0.42, 0.05, 1.0)
    light.data.energy = 240
    light.data.shadow_soft_size = 1.4
    link(light, collection)

    scene = bpy.context.scene
    camera = scene.camera
    camera.location = (MINE_X + 15, MINE_Y - 18, base + 25)
    look_at(camera, (MINE_X, MINE_Y + 2.5, base + 0.8))
    camera.data.lens = 52
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW)
    scene.render.film_transparent = False
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
    bpy.ops.export_scene.gltf(filepath=str(GLB), export_format="GLB", export_yup=True)
    bpy.ops.render.render(write_still=True)
    print(f"SAVED={OUTPUT}")
    print(f"EXPORTED={GLB}")
    print(f"PREVIEW={PREVIEW}")


if __name__ == "__main__":
    main()
