import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
BLEND_PATH = ROOT / "art" / "wizard-royale-horizontal-map.blend"
PREVIEW_PATH = ROOT / "art" / "wizard-royale-horizontal-map-volcano-preview.png"
GLB_PATH = ROOT / "public" / "models" / "wizard-royale-horizontal-map.glb"
VOLCANO_X = 2.8
VOLCANO_Y = -6.2


def material(name, color, metallic=0.0, roughness=0.75, emission=None, strength=0.0):
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    mat = bpy.data.materials.new(name)
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


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_irregular_ring_mesh(name, rings, segments, collection, materials, seed):
    rng = random.Random(seed)
    phases = [rng.random() * math.tau for _ in rings]
    vertices = []
    for ring_index, (radius, z) in enumerate(rings):
        for index in range(segments):
            angle = index * math.tau / segments
            jagged = 1.0 + 0.085 * math.sin(angle * 5 + phases[ring_index])
            jagged += 0.045 * math.sin(angle * 11 + phases[ring_index] * 0.7)
            vertices.append(
                (
                    VOLCANO_X + math.cos(angle) * radius * jagged,
                    VOLCANO_Y + math.sin(angle) * radius * jagged,
                    z + 0.05 * math.sin(angle * 7 + phases[ring_index]),
                )
            )
    faces = []
    for ring_index in range(len(rings) - 1):
        for index in range(segments):
            nxt = (index + 1) % segments
            a = ring_index * segments + index
            b = ring_index * segments + nxt
            c = (ring_index + 1) * segments + nxt
            d = (ring_index + 1) * segments + index
            faces.append((a, b, c, d))
    mesh = bpy.data.meshes.new(name + " Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.clear()
    for mat in materials:
        mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    for index, polygon in enumerate(mesh.polygons):
        polygon.material_index = 1 if (index * 17 + index // segments) % 9 < 2 else 0
    return obj


def add_curve(name, points, bevel, mat, collection):
    curve = bpy.data.curves.new(name + " Curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = bevel
    curve.bevel_resolution = 2
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def main():
    collection = bpy.data.collections.get("Desert — Volcano")
    if collection:
        for obj in list(collection.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
    else:
        collection = bpy.data.collections.new("Desert — Volcano")
        bpy.context.scene.collection.children.link(collection)

    # Clear the one cactus sitting inside the chosen open-space footprint.
    for obj in list(bpy.data.objects):
        if obj.name.startswith(("Saguaro trunk.006", "Saguaro arm.012", "Saguaro arm.013", "Saguaro branch.012", "Saguaro branch.013", "Cactus flower.006")):
            bpy.data.objects.remove(obj, do_unlink=True)

    depsgraph = bpy.context.evaluated_depsgraph_get()
    hit, location, _normal, _face, _obj, _matrix = bpy.context.scene.ray_cast(
        depsgraph, Vector((VOLCANO_X, VOLCANO_Y, 30.0)), Vector((0.0, 0.0, -1.0))
    )
    ground = location.z if hit else 0.0

    basalt = material("Volcano basalt", (0.075, 0.055, 0.05), roughness=0.94)
    warm_rock = material("Volcano warm rock", (0.19, 0.085, 0.045), roughness=0.88)
    crater_rock = material("Volcano crater interior", (0.025, 0.018, 0.018), roughness=1.0)
    sand = material("Volcano sand skirt", (0.48, 0.25, 0.105), roughness=0.97)
    lava = material(
        "Volcano molten lava",
        (1.0, 0.09, 0.005),
        roughness=0.25,
        emission=(1.0, 0.035, 0.0),
        strength=8.0,
    )
    hot_lava = material(
        "Volcano hot lava",
        (1.0, 0.5, 0.015),
        roughness=0.2,
        emission=(1.0, 0.17, 0.005),
        strength=13.0,
    )

    # A broad irregular sand apron makes the mountain grow naturally out of the desert.
    add_irregular_ring_mesh(
        "Volcano sand-blended foothills",
        [(2.95, ground + 0.03), (2.28, ground + 0.5)],
        48,
        collection,
        [sand, warm_rock],
        19,
    )
    mountain = add_irregular_ring_mesh(
        "Ashen Crown Volcano",
        [
            (2.38, ground + 0.28),
            (2.04, ground + 1.05),
            (1.65, ground + 2.05),
            (1.24, ground + 3.15),
            (0.88, ground + 4.15),
            (0.72, ground + 4.55),
        ],
        48,
        collection,
        [basalt, warm_rock],
        41,
    )
    mountain["landmark_type"] = "volcano"
    mountain["region"] = "desert"

    # Crater funnel: connect the rim to a lower, tighter inner ring.
    crater = add_irregular_ring_mesh(
        "Ashen Crown crater walls",
        [(0.73, ground + 4.56), (0.43, ground + 4.12)],
        48,
        collection,
        [crater_rock],
        73,
    )
    for polygon in crater.data.polygons:
        polygon.material_index = 0

    bpy.ops.mesh.primitive_cylinder_add(
        vertices=48,
        radius=0.43,
        depth=0.055,
        location=(VOLCANO_X, VOLCANO_Y, ground + 4.13),
    )
    lava_pool = bpy.context.object
    lava_pool.name = "Ashen Crown glowing lava crater"
    lava_pool.data.materials.append(hot_lava)
    link_object(lava_pool, collection)

    # Three asymmetrical lava streams follow different slopes down the cone.
    stream_data = [
        (0.2, 2.15, 0.10),
        (2.35, 1.82, 0.075),
        (4.42, 1.55, 0.065),
    ]
    for index, (angle, reach, width) in enumerate(stream_data, 1):
        points = []
        for step in range(6):
            t = step / 5
            radius = 0.43 + reach * t
            bend = 0.12 * math.sin(t * math.pi * 2 + index)
            a = angle + bend
            z = ground + 4.17 - (3.68 * t) + 0.1 * math.sin(t * math.pi)
            points.append((VOLCANO_X + math.cos(a) * radius, VOLCANO_Y + math.sin(a) * radius, z))
        add_curve(f"Ashen Crown lava stream {index}", points, width, lava, collection)

    # Broken black rocks around the base make the silhouette less cone-like.
    rng = random.Random(20260907)
    for index in range(16):
        angle = rng.random() * math.tau
        radius = rng.uniform(2.05, 2.72)
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=1,
            radius=rng.uniform(0.13, 0.29),
            location=(
                VOLCANO_X + math.cos(angle) * radius,
                VOLCANO_Y + math.sin(angle) * radius,
                ground + rng.uniform(0.13, 0.32),
            ),
        )
        rock = bpy.context.object
        rock.name = f"Ashen Crown fallen basalt {index + 1:02d}"
        rock.scale = (rng.uniform(0.7, 1.35), rng.uniform(0.7, 1.35), rng.uniform(0.65, 1.4))
        rock.rotation_euler = (rng.random(), rng.random(), rng.random() * math.tau)
        rock.data.materials.append(basalt if index % 3 else warm_rock)
        link_object(rock, collection)

    # Soft smoke puffs above the crater, kept sparse for browser-friendly export.
    smoke = material("Volcano smoke", (0.095, 0.085, 0.09), roughness=1.0)
    for index, (dx, dy, dz, scale) in enumerate(
        [
            (0.0, 0.0, 5.0, 0.45),
            (0.18, -0.08, 5.55, 0.58),
            (-0.12, 0.12, 6.2, 0.72),
            (0.25, 0.08, 6.95, 0.88),
        ],
        1,
    ):
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=2,
            radius=scale,
            location=(VOLCANO_X + dx, VOLCANO_Y + dy, ground + dz),
        )
        puff = bpy.context.object
        puff.name = f"Ashen Crown smoke plume {index}"
        puff.scale = (1.15, 0.9, 0.72)
        puff.data.materials.append(smoke)
        link_object(puff, collection)

    bpy.ops.object.light_add(
        type="POINT", location=(VOLCANO_X, VOLCANO_Y, ground + 4.65)
    )
    light = bpy.context.object
    light.name = "Ashen Crown lava glow"
    light.data.color = (1.0, 0.055, 0.01)
    light.data.energy = 430.0
    light.data.shadow_soft_size = 2.2
    link_object(light, collection)

    # Save the editable map, then make a focused preview for verification.
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.ops.export_scene.gltf(filepath=str(GLB_PATH), export_format="GLB", export_yup=True)
    scene = bpy.context.scene
    camera = scene.camera
    camera.location = (VOLCANO_X - 9.8, VOLCANO_Y - 11.0, ground + 8.7)
    look_at(camera, (VOLCANO_X, VOLCANO_Y, ground + 2.2))
    camera.data.lens = 58
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW_PATH)
    scene.render.film_transparent = False
    bpy.ops.render.render(write_still=True)
    print(f"VOLCANO_GROUND={ground:.3f}")
    print(f"SAVED={BLEND_PATH}")
    print(f"PREVIEW={PREVIEW_PATH}")
    print(f"EXPORTED={GLB_PATH}")


if __name__ == "__main__":
    main()
