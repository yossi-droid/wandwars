import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
BLEND_PATH = ROOT / "art" / "wizard-royale-horizontal-map.blend"
PREVIEW_PATH = ROOT / "art" / "wizard-royale-horizontal-map-mine-preview.png"
GLB_PATH = ROOT / "public" / "models" / "wizard-royale-horizontal-map.glb"
MINE_X = 19.92
MINE_Y = 2.7
MINE_SCALE = 2.5  # castle-scale landmark while keeping the entrance grounded


def material(name, color, metallic=0.0, roughness=0.75, emission=None, strength=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def link_object(obj, collection):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def ground_height(x, y):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    hit, location, _normal, _face, obj, _matrix = bpy.context.scene.ray_cast(
        depsgraph, Vector((x, y, 20.0)), Vector((0.0, 0.0, -1.0))
    )
    if not hit:
        return 0.0
    # The track should hug the desert terrain rather than climb loose props.
    if obj and obj.name != "Detailed Ember Dunes Terrain":
        terrain = bpy.data.objects.get("Detailed Ember Dunes Terrain")
        if terrain:
            hidden = []
            for candidate in bpy.context.scene.objects:
                if candidate != terrain and not candidate.hide_viewport:
                    candidate.hide_viewport = True
                    hidden.append(candidate)
            depsgraph.update()
            hit, location, *_ = bpy.context.scene.ray_cast(
                depsgraph, Vector((x, y, 20.0)), Vector((0.0, 0.0, -1.0))
            )
            for candidate in hidden:
                candidate.hide_viewport = False
            depsgraph.update()
    return location.z if hit else 0.0


def add_cube(name, location, scale, mat, collection, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    link_object(obj, collection)
    return obj


def add_cylinder(name, location, radius, depth, mat, collection, rotation=(0.0, 0.0, 0.0), vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    link_object(obj, collection)
    return obj


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def main():
    collection = bpy.data.collections.get("Desert — Eastern Mine")
    if collection:
        for obj in list(collection.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
    else:
        collection = bpy.data.collections.new("Desert — Eastern Mine")
        bpy.context.scene.collection.children.link(collection)

    # Remove only the small props that would block the entrance and rails.
    remove_names = {
        "Saguaro trunk.003",
        "Saguaro arm.006",
        "Saguaro branch.006",
        "Saguaro arm.007",
        "Saguaro branch.007",
        "Cactus flower.003",
        "Saguaro trunk.004",
        "Saguaro arm.008",
        "Saguaro branch.008",
        "Saguaro arm.009",
        "Saguaro branch.009",
        "Cactus flower.004",
        "Desert cover boulder.005",
        "Desert cover boulder.008",
    }
    for name in remove_names:
        obj = bpy.data.objects.get(name)
        if obj:
            bpy.data.objects.remove(obj, do_unlink=True)

    dark = material("Mine tunnel darkness", (0.008, 0.006, 0.009), roughness=1.0)
    timber = material("Mine aged timber", (0.19, 0.075, 0.025), roughness=0.92)
    timber_light = material("Mine cut timber", (0.36, 0.17, 0.06), roughness=0.88)
    iron = material("Mine dark iron", (0.075, 0.085, 0.095), metallic=0.75, roughness=0.42)
    cart_iron = material("Mine cart iron", (0.14, 0.16, 0.18), metallic=0.68, roughness=0.5)
    gold = material(
        "Mine lantern glow",
        (1.0, 0.32, 0.035),
        roughness=0.3,
        emission=(1.0, 0.12, 0.008),
        strength=8.0,
    )
    rock_dark = material("Mine entrance dark rock", (0.095, 0.075, 0.065), roughness=0.97)
    rock_warm = material("Mine entrance warm rock", (0.25, 0.12, 0.055), roughness=0.94)
    ore = material(
        "Mine arcane ore",
        (0.17, 0.03, 0.33),
        roughness=0.28,
        emission=(0.25, 0.015, 0.65),
        strength=4.5,
    )

    base_z = ground_height(19.55, MINE_Y) + 0.02

    # Tall arched black doorway set against the west face of the boundary cliff.
    vertices = [
        (MINE_X, MINE_Y - 0.82, base_z),
        (MINE_X, MINE_Y - 0.82, base_z + 1.05),
    ]
    for step in range(9):
        angle = math.pi - step * math.pi / 8
        vertices.append(
            (
                MINE_X,
                MINE_Y + math.cos(angle) * 0.82,
                base_z + 1.05 + math.sin(angle) * 0.82,
            )
        )
    vertices.append((MINE_X, MINE_Y + 0.82, base_z))
    mesh = bpy.data.meshes.new("Eastern Arcane Mine entrance mesh")
    mesh.from_pydata(vertices, [], [tuple(range(len(vertices)))])
    entrance = bpy.data.objects.new("Eastern Arcane Mine black entrance", mesh)
    entrance.data.materials.append(dark)
    collection.objects.link(entrance)

    # Timber portal frame and braces.
    add_cube(
        "Mine left support",
        (MINE_X - 0.05, MINE_Y - 0.91, base_z + 0.82),
        (0.25, 0.25, 1.75),
        timber,
        collection,
        rotation=(0.0, -0.03, 0.02),
    )
    add_cube(
        "Mine right support",
        (MINE_X - 0.05, MINE_Y + 0.91, base_z + 0.82),
        (0.25, 0.25, 1.75),
        timber,
        collection,
        rotation=(0.0, 0.035, -0.025),
    )
    add_cube(
        "Mine entrance lintel",
        (MINE_X - 0.08, MINE_Y, base_z + 1.66),
        (0.3, 2.15, 0.27),
        timber_light,
        collection,
    )
    for index, side in enumerate((-1, 1), 1):
        add_cube(
            f"Mine diagonal brace {index}",
            (MINE_X - 0.13, MINE_Y + side * 0.64, base_z + 1.48),
            (0.22, 0.78, 0.18),
            timber,
            collection,
            rotation=(side * 0.52, 0.0, 0.0),
        )

    # Broken cliff rocks frame the opening while leaving the doorway clear.
    rock_specs = [
        (-1.18, 0.52, 0.46),
        (1.2, 0.48, 0.5),
        (-1.08, 1.32, 0.58),
        (1.1, 1.25, 0.54),
        (-0.75, 1.92, 0.48),
        (0.72, 1.95, 0.52),
        (0.0, 2.08, 0.6),
    ]
    for index, (offset_y, offset_z, radius) in enumerate(rock_specs, 1):
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=1,
            radius=radius,
            location=(MINE_X + 0.08, MINE_Y + offset_y, base_z + offset_z),
        )
        rock = bpy.context.object
        rock.name = f"Eastern Mine cliff rock {index:02d}"
        rock.scale = (0.7, 1.1, 0.9 + index * 0.025)
        rock.rotation_euler = (0.13 * index, 0.19 * index, 0.31 * index)
        rock.data.materials.append(rock_warm if index % 3 == 0 else rock_dark)
        link_object(rock, collection)

    # Twin rails descend gently from the entrance into the open desert.
    rail_start = 17.1
    rail_end = 19.75
    rail_length = rail_end - rail_start
    center_x = (rail_start + rail_end) / 2
    center_z = (ground_height(rail_start, MINE_Y) + ground_height(rail_end, MINE_Y)) / 2 + 0.12
    slope = math.atan2(
        ground_height(rail_end, MINE_Y) - ground_height(rail_start, MINE_Y), rail_length
    )
    for side in (-0.3, 0.3):
        add_cube(
            "Eastern Mine rail",
            (center_x, MINE_Y + side, center_z),
            (rail_length, 0.065, 0.075),
            iron,
            collection,
            rotation=(0.0, -slope, 0.0),
        )
    for index in range(9):
        x = rail_start + index * rail_length / 8
        z = ground_height(x, MINE_Y) + 0.065
        add_cube(
            f"Eastern Mine sleeper {index + 1:02d}",
            (x, MINE_Y, z),
            (0.16, 0.93, 0.09),
            timber,
            collection,
        )

    # Loaded ore cart parked beside the open end of the track.
    cart_x = 17.75
    cart_z = ground_height(cart_x, MINE_Y)
    add_cube(
        "Eastern Mine ore cart body",
        (cart_x, MINE_Y, cart_z + 0.48),
        (0.85, 0.72, 0.55),
        cart_iron,
        collection,
        rotation=(0.0, -0.03, 0.0),
    )
    add_cube(
        "Eastern Mine ore cart rim",
        (cart_x, MINE_Y, cart_z + 0.78),
        (1.0, 0.85, 0.1),
        iron,
        collection,
    )
    for index, (dx, dy) in enumerate(((-0.28, -0.4), (-0.28, 0.4), (0.28, -0.4), (0.28, 0.4)), 1):
        add_cylinder(
            f"Eastern Mine cart wheel {index}",
            (cart_x + dx, MINE_Y + dy, cart_z + 0.2),
            0.18,
            0.09,
            iron,
            collection,
            rotation=(math.pi / 2, 0.0, 0.0),
            vertices=12,
        )
    for index, (dx, dy, dz, scale) in enumerate(
        ((-0.2, -0.1, 0.85, 0.17), (0.12, 0.08, 0.88, 0.2), (0.28, -0.12, 0.83, 0.15)),
        1,
    ):
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=1,
            radius=scale,
            location=(cart_x + dx, MINE_Y + dy, cart_z + dz),
        )
        crystal = bpy.context.object
        crystal.name = f"Eastern Mine arcane ore {index}"
        crystal.scale.z = 1.45
        crystal.data.materials.append(ore)
        link_object(crystal, collection)

    # Hanging lantern and readable landmark sign.
    add_cube(
        "Eastern Mine sign",
        (MINE_X - 0.32, MINE_Y, base_z + 2.28),
        (0.17, 1.65, 0.4),
        timber_light,
        collection,
    )
    add_cube(
        "Eastern Mine lantern bracket",
        (MINE_X - 0.38, MINE_Y - 1.05, base_z + 1.75),
        (0.5, 0.08, 0.08),
        iron,
        collection,
    )
    add_cylinder(
        "Eastern Mine lantern",
        (MINE_X - 0.62, MINE_Y - 1.05, base_z + 1.48),
        0.13,
        0.28,
        gold,
        collection,
        vertices=12,
    )
    bpy.ops.object.light_add(
        type="POINT", location=(MINE_X - 0.72, MINE_Y - 1.05, base_z + 1.48)
    )
    light = bpy.context.object
    light.name = "Eastern Mine lantern light"
    light.data.color = (1.0, 0.18, 0.025)
    light.data.energy = 120.0
    light.data.shadow_soft_size = 0.65
    link_object(light, collection)

    # Enlarge the entire landmark around its terrain contact point. Scaling the
    # finished collection keeps the tunnel frame, cliff rocks, track, cart,
    # lantern, and sign aligned as one architectural feature.
    anchor = Vector((MINE_X, MINE_Y, base_z))
    for obj in collection.objects:
        obj.location = anchor + (obj.location - anchor) * MINE_SCALE
        obj.scale *= MINE_SCALE

    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.ops.export_scene.gltf(filepath=str(GLB_PATH), export_format="GLB", export_yup=True)

    scene = bpy.context.scene
    camera = scene.camera
    camera.location = (13.0, -3.7, 5.8)
    look_at(camera, (19.0, MINE_Y, base_z + 0.8))
    camera.data.lens = 58
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW_PATH)
    scene.render.film_transparent = False
    bpy.ops.render.render(write_still=True)
    print(f"MINE_BASE={base_z:.3f}")
    print(f"SAVED={BLEND_PATH}")
    print(f"PREVIEW={PREVIEW_PATH}")
    print(f"EXPORTED={GLB_PATH}")


if __name__ == "__main__":
    main()
