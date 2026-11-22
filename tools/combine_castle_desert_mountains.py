import bpy
import math
from mathutils import Vector
from mathutils.bvhtree import BVHTree


ROOT = "/Users/michaelcaras/Desktop/new-game"
COMBINED_BLEND = f"{ROOT}/art/castle-desert-combined.blend"
MOUNTAIN_BLEND = f"{ROOT}/art/mountain-region-detailed.blend"
OUTPUT_BLEND = f"{ROOT}/art/castle-desert-mountains-combined.blend"
OUTPUT_GLB = f"{ROOT}/public/models/castle-desert-mountains-combined.glb"
PREVIEW = f"{ROOT}/art/castle-desert-mountains-combined-preview.png"
TOPDOWN = f"{ROOT}/art/castle-desert-mountains-combined-topdown.png"

COMBINED_PREFIXES = ("Castle —", "Desert —", "Transition — Castle to Desert")
MOUNTAIN_COLLECTIONS = [
    "Mountain Terrain", "Major Peaks", "River & Waterfalls", "Mountain Buildings",
    "Trails & Bridges", "Ruins & Cover", "Alpine Forest", "Snow & Details",
]
MOUNTAIN_OFFSET = Vector((-12.2, 19.5, 0.0))
MODEL = []


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection":
            bpy.data.collections.remove(collection)
    base = bpy.data.collections.get("Collection")
    if base:
        base.name = "Wizard Royale Three Region World"


def append_existing_world():
    with bpy.data.libraries.load(COMBINED_BLEND, link=False) as (data_from, data_to):
        names = [
            name for name in data_from.collections
            if any(name.startswith(prefix) for prefix in COMBINED_PREFIXES)
        ]
        data_to.collections = names

    seen = set()
    loaded = []
    for collection in data_to.collections:
        if collection is None:
            continue
        bpy.context.scene.collection.children.link(collection)
        loaded.append(collection)
        for obj in collection.all_objects:
            key = obj.as_pointer()
            if key in seen:
                continue
            seen.add(key)
            MODEL.append(obj)
    if len(loaded) != 16:
        raise RuntimeError(f"Expected 16 castle/desert collections, found {len(loaded)}")


def append_mountains():
    with bpy.data.libraries.load(MOUNTAIN_BLEND, link=False) as (data_from, data_to):
        available = set(data_from.collections)
        data_to.collections = [name for name in MOUNTAIN_COLLECTIONS if name in available]

    shifted = set()
    loaded = []
    for collection in data_to.collections:
        if collection is None:
            continue
        original = collection.name
        collection.name = f"Mountains — {original}"
        collection["region_module"] = "Mountains"
        collection["source_blend"] = MOUNTAIN_BLEND
        bpy.context.scene.collection.children.link(collection)
        loaded.append(original)
        for obj in collection.all_objects:
            key = obj.as_pointer()
            if key in shifted:
                continue
            shifted.add(key)
            obj.location += MOUNTAIN_OFFSET
            obj["region_module"] = "Mountains"
            MODEL.append(obj)
    missing = sorted(set(MOUNTAIN_COLLECTIONS) - set(loaded))
    if missing:
        raise RuntimeError(f"Missing mountain collections: {missing}")


def make_material(name, color, roughness=.96, metallic=0.0, scale=8.0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 5.0
    noise.inputs["Roughness"].default_value = .72
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*(value * .68 for value in color), 1)
    ramp.color_ramp.elements[1].color = (*(min(1, value * 1.22 + .02) for value in color), 1)
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = .18
    bump.inputs["Distance"].default_value = .08
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return material


def transition_materials():
    make_material("Castle Mountain Meadow", (.19, .35, .10), scale=10)
    make_material("Castle Mountain Alpine Grass", (.12, .28, .075), scale=11)
    make_material("Castle Mountain Moss", (.075, .21, .055), 1.0, scale=12)
    make_material("Castle Mountain Gravel", (.31, .30, .25), 1.0, scale=13)
    make_material("Castle Mountain Dirt", (.25, .15, .065), 1.0, scale=12)
    make_material("Castle Mountain River Bank", (.27, .22, .14), 1.0, scale=13)
    water = make_material("Castle Mountain Water", (.012, .30, .54), .12, .04, 5.0)
    shader = water.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Metallic"].default_value = .08
    make_material("Castle Mountain Stone", (.30, .31, .30), .98, scale=8)
    make_material("Castle Mountain Bark", (.15, .065, .025), .98, scale=9)
    make_material("Castle Mountain Pine", (.018, .13, .045), 1.0, scale=11)


def register(obj, material, name, collection):
    obj.name = name
    if material:
        obj.data.materials.append(bpy.data.materials[material])
    for old_collection in list(obj.users_collection):
        old_collection.objects.unlink(obj)
    collection.objects.link(obj)
    obj["region_module"] = "Castle Mountain Transition"
    MODEL.append(obj)
    return obj


def smooth_points(path, iterations=3):
    points = [Vector(point) for point in path]
    for _ in range(iterations):
        refined = [points[0]]
        for a, b in zip(points, points[1:]):
            refined.extend((a * .75 + b * .25, a * .25 + b * .75))
        refined.append(points[-1])
        points = refined
    return points


def surface_ribbon(name, path, width, material, collection):
    points = smooth_points(path)
    verts = []
    faces = []
    for index, point in enumerate(points):
        before = points[max(0, index - 1)]
        after = points[min(len(points) - 1, index + 1)]
        tangent = Vector((after.x - before.x, after.y - before.y)).normalized()
        side = Vector((-tangent.y, tangent.x)) * width
        verts.extend([
            (point.x - side.x, point.y - side.y, point.z),
            (point.x + side.x, point.y + side.y, point.z),
        ])
    for index in range(len(points) - 1):
        a = index * 2
        faces.append((a, a + 1, a + 3, a + 2))
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.data.materials.append(bpy.data.materials[material])
    obj["region_module"] = "Castle Mountain Transition"
    MODEL.append(obj)
    return obj


def segment_distance(px, py, a, b):
    ax, ay = a[0], a[1]
    bx, by = b[0], b[1]
    dx, dy = bx - ax, by - ay
    if dx * dx + dy * dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def polyline_distance(x, y, path):
    return min(segment_distance(x, y, a, b) for a, b in zip(path, path[1:]))


def terrain_sampler(object_name):
    obj = bpy.data.objects.get(object_name)
    if obj is None:
        raise RuntimeError(f"Could not find terrain object {object_name}")
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(obj.evaluated_get(depsgraph), depsgraph)
    inverse = obj.matrix_world.inverted()

    def sample(x, y):
        origin = inverse @ Vector((x, y, 30.0))
        direction = (inverse.to_3x3() @ Vector((0, 0, -1))).normalized()
        location, _normal, _index, _distance = tree.ray_cast(origin, direction, 80.0)
        if location is None:
            return None
        return (obj.matrix_world @ location).z

    return sample


def add_boulder(name, location, scale, collection, rotation=0):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=location,
                                         rotation=(0, 0, rotation))
    obj = register(bpy.context.object, "Castle Mountain Stone", name, collection)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def add_transition_pine(name, x, y, z, scale, collection):
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=.11 * scale, depth=.82 * scale,
                                        location=(x, y, z + .41 * scale))
    register(bpy.context.object, "Castle Mountain Bark", name + " trunk", collection)
    for index, (height, radius) in enumerate(((.75, .46), (1.03, .36), (1.28, .26)), 1):
        bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=radius * scale, radius2=.025 * scale,
                                       depth=.72 * scale,
                                       location=(x, y, z + height * scale))
        register(bpy.context.object, "Castle Mountain Pine",
                 f"{name} foliage {index}", collection)


def make_castle_mountain_transition():
    collection = bpy.data.collections.new("Transition — Castle to Mountains")
    collection["region_module"] = "Castle Mountain Transition"
    bpy.context.scene.collection.children.link(collection)

    castle_height = terrain_sampler("Castle Valley Terrain")
    mountain_height = terrain_sampler("Detailed Alpine Mountain Terrain")
    river_xy = [
        (-14.75, 10.25), (-13.90, 10.48), (-12.55, 10.62),
        (-11.20, 10.55), (-10.05, 10.48), (-9.05, 10.70),
    ]

    lower_y = lambda x: 8.05 + .24 * math.sin(x * .41) + .09 * math.sin(x * 1.13)
    upper_y = lambda x: 12.55 + .27 * math.sin(x * .36 + 1.0) + .08 * math.sin(x * 1.27)

    def blend_height(x, y):
        low = lower_y(x)
        high = upper_y(x)
        castle_z = castle_height(x, min(y, 10.26))
        mountain_z = mountain_height(x, max(y, 10.34))
        castle_z = 0.0 if castle_z is None else castle_z
        mountain_z = castle_z if mountain_z is None else mountain_z
        t = max(0.0, min(1.0, (y - low) / max(.01, high - low)))
        smooth = t * t * (3 - 2 * t)
        undulation = .05 * math.sin(math.pi * t) * (
            math.sin(x * .73 + y * .51) + .35 * math.sin(x * 1.37 - y * .42)
        )
        return castle_z * (1 - smooth) + mountain_z * smooth + undulation

    nx, ny = 122, 30
    verts = []
    faces = []
    material_indices = []
    for j in range(ny + 1):
        v = j / ny
        for i in range(nx + 1):
            x = -24.15 + 23.90 * i / nx
            y = lower_y(x) * (1 - v) + upper_y(x) * v
            verts.append((x, y, blend_height(x, y) + .025))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            center_x = sum(verts[k][0] for k in (a, a + 1, a + nx + 2, a + nx + 1)) / 4
            center_y = sum(verts[k][1] for k in (a, a + 1, a + nx + 2, a + nx + 1)) / 4
            if polyline_distance(center_x, center_y, river_xy) < .70:
                continue
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
            v = (j + .5) / ny
            wobble = .07 * math.sin(center_x * .58 + center_y * .92)
            if v < .34 + wobble:
                material_indices.append(0)
            elif v < .68 + wobble:
                material_indices.append(1)
            elif v < .87 + wobble:
                material_indices.append(2)
            else:
                material_indices.append(3)

    mesh = bpy.data.meshes.new("Castle to mountain blended foothills mesh")
    mesh.from_pydata(verts, [], faces)
    terrain = bpy.data.objects.new("Natural castle valley to mountain foothills", mesh)
    collection.objects.link(terrain)
    for material in (
        "Castle Mountain Meadow", "Castle Mountain Alpine Grass",
        "Castle Mountain Moss", "Castle Mountain Gravel",
    ):
        terrain.data.materials.append(bpy.data.materials[material])
    for polygon, material_index in zip(terrain.data.polygons, material_indices):
        polygon.material_index = material_index
    terrain["region_module"] = "Castle Mountain Transition"
    MODEL.append(terrain)

    river_path = []
    for x, y in river_xy:
        river_path.append((x, y, blend_height(x, y) + .075))
    surface_ribbon("Castle mountain river banks",
                   [(x, y, z - .045) for x, y, z in river_path], .86,
                   "Castle Mountain River Bank", collection)
    surface_ribbon("Connected mountain river", river_path, .55,
                   "Castle Mountain Water", collection)

    trail_paths = [
        [(-20.80, 7.90), (-21.35, 9.20), (-21.80, 10.55), (-22.35, 12.05), (-23.0, 13.80)],
        [(-3.70, 7.90), (-3.45, 9.15), (-3.12, 10.45), (-2.72, 11.75), (-2.30, 13.00)],
    ]
    for index, xy_path in enumerate(trail_paths, 1):
        path = [(x, y, blend_height(x, y) + .075) for x, y in xy_path]
        surface_ribbon(f"Connected castle mountain trail {index}", path, .31,
                       "Castle Mountain Dirt", collection)

    # A few deliberately spaced foothill props break up the seam without filling
    # the open approaches needed for combat and distant views.
    boulders = [
        (-18.7, 10.75, .38, .28, .24, .2), (-16.8, 11.72, .46, .34, .28, 1.0),
        (-7.0, 9.25, .34, .25, .23, .5), (-5.4, 11.65, .43, .32, .26, 1.5),
        (-1.35, 9.65, .31, .23, .20, .8), (-11.9, 12.05, .36, .28, .23, 1.2),
    ]
    for index, (x, y, sx, sy, sz, rotation) in enumerate(boulders, 1):
        z = blend_height(x, y)
        add_boulder(f"Foothill boulder {index}", (x, y, z + sz * .55),
                    (sx, sy, sz), collection, rotation)

    pines = [(-19.65, 11.45, .82), (-17.75, 12.25, .72), (-6.25, 12.15, .88),
             (-4.55, 10.15, .70), (-.95, 11.90, .76)]
    for index, (x, y, scale) in enumerate(pines, 1):
        add_transition_pine(f"Foothill pine {index}", x, y, blend_height(x, y), scale, collection)


def validate_layout():
    castle_top = 1.1 + 9.2
    mountain_bottom = MOUNTAIN_OFFSET.y - 9.2
    gap = mountain_bottom - castle_top
    modules = {
        "castle": [obj for obj in MODEL if obj.get("region_module") == "Castle"],
        "desert": [obj for obj in MODEL if obj.get("region_module") == "Desert"],
        "mountains": [obj for obj in MODEL if obj.get("region_module") == "Mountains"],
        "transition": [obj for obj in MODEL if obj.get("region_module") == "Castle Mountain Transition"],
    }
    if abs(gap) > .01:
        raise RuntimeError(f"Castle and mountain terrain edges do not meet: gap={gap:.3f}")
    if any(not objects for objects in modules.values()):
        raise RuntimeError(f"A map module did not load: {[(name, len(items)) for name, items in modules.items()]}")
    print(
        f"THREE REGION LAYOUT VERIFIED seam_gap={gap:.3f} "
        + " ".join(f"{name}_objects={len(items)}" for name, items in modules.items())
    )


def export_glb():
    bpy.ops.object.select_all(action="DESELECT")
    for obj in MODEL:
        if obj and obj.name in bpy.context.scene.objects and obj.type in {"MESH", "CURVE"}:
            obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=OUTPUT_GLB,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_extras=True,
    )


def render_and_save():
    bpy.ops.object.camera_add(location=(44, -55, 49))
    camera = bpy.context.object
    camera.name = "Three Region World Preview Camera"
    target = Vector((-4.0, 9.0, 1.3))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 55.5
    bpy.context.scene.camera = camera

    bpy.ops.object.light_add(type="SUN", location=(-8, -12, 28))
    sun = bpy.context.object
    sun.name = "Three Region World Sun"
    sun.data.energy = 3.2
    sun.data.angle = math.radians(8)
    sun.rotation_euler = (math.radians(30), math.radians(-18), math.radians(-32))
    bpy.ops.object.light_add(type="AREA", location=(-7, 4, 28))
    fill = bpy.context.object
    fill.name = "Three Region World Sky Fill"
    fill.data.energy = 1300
    fill.data.shape = "DISK"
    fill.data.size = 14

    world = bpy.context.scene.world or bpy.data.worlds.new("Three Region Daylight World")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (.30, .50, .78, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = .72

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.filepath = PREVIEW
    bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND)
    bpy.ops.render.render(write_still=True)

    original_location = camera.location.copy()
    original_rotation = camera.rotation_euler.copy()
    original_scale = camera.data.ortho_scale
    camera.location = (-3.0, 9.5, 62)
    camera.rotation_euler = (Vector((-3.0, 9.5, 0)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.ortho_scale = 48.5
    scene.render.resolution_x = 1500
    scene.render.resolution_y = 1200
    scene.render.filepath = TOPDOWN
    bpy.ops.render.render(write_still=True)
    camera.location = original_location
    camera.rotation_euler = original_rotation
    camera.data.ortho_scale = original_scale
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1000
    scene.render.filepath = PREVIEW
    bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND)


reset()
append_existing_world()
append_mountains()
transition_materials()
make_castle_mountain_transition()
validate_layout()
export_glb()
render_and_save()
print(
    f"CREATED {OUTPUT_BLEND}\nEXPORTED {OUTPUT_GLB}\nRENDERED {PREVIEW}\n"
    f"TOPDOWN {TOPDOWN}\nOBJECTS {len(MODEL)}"
)
