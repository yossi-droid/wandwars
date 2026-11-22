import bpy
import math
from mathutils import Vector
from mathutils.bvhtree import BVHTree


ROOT = "/Users/michaelcaras/Desktop/new-game"
CASTLE_BLEND = f"{ROOT}/art/castle-region-detailed.blend"
DESERT_BLEND = f"{ROOT}/art/desert-region-detailed.blend"
OUTPUT_BLEND = f"{ROOT}/art/castle-desert-combined.blend"
OUTPUT_GLB = f"{ROOT}/public/models/castle-desert-combined.glb"
PREVIEW = f"{ROOT}/art/castle-desert-combined-preview.png"
TOPDOWN = f"{ROOT}/art/castle-desert-combined-topdown.png"

CASTLE_COLLECTIONS = [
    "Terrain & Water", "Outer Walls", "Towers & Gates", "Central Keep",
    "Inner Ward", "Roads & Bridges", "Props & Cover", "Vegetation",
]
DESERT_COLLECTIONS = [
    "Terrain", "Mesas & Cliffs", "Frontier Town", "Ruins & Camps",
    "Roads", "Vegetation", "Gameplay Cover",
]
CASTLE_OFFSET = Vector((-12.2, 1.1, 0.0))
DESERT_OFFSET = Vector((12.0, -1.1, 0.0))
MODEL = []


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection":
            bpy.data.collections.remove(collection)
    base = bpy.data.collections.get("Collection")
    if base:
        base.name = "Combined Castle and Desert"


def append_region(source, collection_names, prefix, offset):
    with bpy.data.libraries.load(source, link=False) as (data_from, data_to):
        available = set(data_from.collections)
        data_to.collections = [name for name in collection_names if name in available]

    loaded = []
    shifted = set()
    for collection in data_to.collections:
        if collection is None:
            continue
        original_name = collection.name
        collection.name = f"{prefix} — {original_name}"
        collection["region_module"] = prefix
        collection["source_blend"] = source
        bpy.context.scene.collection.children.link(collection)
        loaded.append(collection)
        for obj in collection.all_objects:
            key = obj.as_pointer()
            if key in shifted:
                continue
            obj.location += offset
            obj["region_module"] = prefix
            MODEL.append(obj)
            shifted.add(key)
    if len(loaded) != len(collection_names):
        missing = sorted(set(collection_names) - {c.name.split(" — ", 1)[-1] for c in loaded})
        raise RuntimeError(f"Missing collections in {source}: {missing}")
    return loaded


def transition_materials():
    specs = {
        "Transition Soil": ((.31, .20, .085), .98, 0.0),
        "Transition Stone": ((.34, .30, .25), .96, 0.0),
        "Transition Grass": ((.22, .35, .11), .98, 0.0),
        "Transition Dry Meadow": ((.39, .39, .14), .98, 0.0),
        "Transition Scrub": ((.48, .34, .12), .98, 0.0),
        "Transition Sand": ((.60, .38, .16), .98, 0.0),
        "Transition River Bank": ((.27, .20, .105), 1.0, 0.0),
        "Transition Water": ((.018, .34, .54), .14, .04),
    }
    for name, (color, rough, metal) in specs.items():
        mat = bpy.data.materials.new(name)
        mat.diffuse_color = (*color, 1)
        mat.use_nodes = True
        bs = mat.node_tree.nodes.get("Principled BSDF")
        bs.inputs["Base Color"].default_value = (*color, 1)
        bs.inputs["Roughness"].default_value = rough
        bs.inputs["Metallic"].default_value = metal
        noise = mat.node_tree.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 7.0
        noise.inputs["Detail"].default_value = 5.0
        ramp = mat.node_tree.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (*(v * .72 for v in color), 1)
        ramp.color_ramp.elements[1].color = (*(min(1, v * 1.2 + .02) for v in color), 1)
        bump = mat.node_tree.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = .18
        bump.inputs["Distance"].default_value = .08
        mat.node_tree.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        mat.node_tree.links.new(ramp.outputs["Color"], bs.inputs["Base Color"])
        mat.node_tree.links.new(noise.outputs["Fac"], bump.inputs["Height"])
        mat.node_tree.links.new(bump.outputs["Normal"], bs.inputs["Normal"])


def register(obj, material, name, collection):
    obj.name = name
    obj.data.materials.append(bpy.data.materials[material])
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    collection.objects.link(obj)
    obj["region_module"] = "Transition"
    MODEL.append(obj)
    return obj


def cube(name, loc, scale, material, collection, rot=0, bevel=.02):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=(0, 0, rot))
    obj = register(bpy.context.object, material, name, collection)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new("Weathered edges", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    return obj


def sphere(name, loc, scale, material, collection):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=loc)
    obj = register(bpy.context.object, material, name, collection)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def smooth_points(path, iterations=3):
    points = [Vector((x, y, z)) for x, y, z in path]
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
    for i, point in enumerate(points):
        before = points[max(0, i - 1)]
        after = points[min(len(points) - 1, i + 1)]
        tangent = Vector((after.x - before.x, after.y - before.y)).normalized()
        side = Vector((-tangent.y, tangent.x)) * width
        verts.extend([
            (point.x - side.x, point.y - side.y, point.z),
            (point.x + side.x, point.y + side.y, point.z),
        ])
    for i in range(len(points) - 1):
        a = i * 2
        faces.append((a, a + 1, a + 3, a + 2))
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.data.materials.append(bpy.data.materials[material])
    obj["region_module"] = "Transition"
    MODEL.append(obj)
    return obj


def segment_distance(px, py, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    if dx * dx + dy * dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def polyline_distance(x, y, path):
    xy = [(p[0], p[1]) for p in path]
    return min(segment_distance(x, y, a, b) for a, b in zip(xy, xy[1:]))


def terrain_sampler(object_name):
    obj = bpy.data.objects.get(object_name)
    if obj is None:
        raise RuntimeError(f"Could not find terrain object {object_name}")
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(obj.evaluated_get(depsgraph), depsgraph)
    inverse = obj.matrix_world.inverted()

    def sample(x, y):
        origin = inverse @ Vector((x, y, 20.0))
        direction = (inverse.to_3x3() @ Vector((0, 0, -1))).normalized()
        location, _normal, _index, _distance = tree.ray_cast(origin, direction, 50.0)
        if location is None:
            return 0.0
        return (obj.matrix_world @ location).z

    return sample


def make_transition():
    transition = bpy.data.collections.new("Transition — Castle to Desert")
    transition["region_module"] = "Transition"
    bpy.context.scene.collection.children.link(transition)

    castle_height = terrain_sampler("Castle Valley Terrain")
    desert_height = terrain_sampler("Detailed Ember Dunes Terrain")
    link_river = [
        (-3.45, -.25, .34), (-2.70, -.08, .30), (-1.78, .18, .25),
        (-.78, .48, .20), (.18, .52, .16), (.92, .18, .13), (1.86, -.34, .11),
    ]

    # A broad irregular mesh overlaps both source terrains and replaces the
    # ruler-straight biome boundary with grass, dry meadow, scrub, then sand.
    nx, ny = 32, 94
    verts = []
    faces = []
    material_indices = []
    for j in range(ny + 1):
        y = -8.10 + 15.15 * j / ny
        left = -3.35 + .30 * math.sin(y * .63) + .11 * math.sin(y * 1.71)
        right = .78 + .24 * math.sin(y * .51 + 1.2) + .10 * math.sin(y * 1.43)
        left_z = castle_height(left, y)
        right_z = desert_height(right, y)
        for i in range(nx + 1):
            u = i / nx
            smooth = u * u * (3 - 2 * u)
            x = left * (1 - u) + right * u
            crown = .045 * math.sin(math.pi * u) * (
                math.sin(y * .83 + u * 4.2) + .45 * math.sin(y * 1.77 - u * 3.0)
            )
            z = left_z * (1 - smooth) + right_z * smooth + .032 + crown
            verts.append((x, y, z))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            center = Vector((
                sum(verts[k][0] for k in (a, a + 1, a + nx + 2, a + nx + 1)) / 4,
                sum(verts[k][1] for k in (a, a + 1, a + nx + 2, a + nx + 1)) / 4,
            ))
            # Leave a genuine channel for the connecting river rather than
            # painting water on top of solid terrain.
            if polyline_distance(center.x, center.y, link_river) < .67:
                continue
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
            u = (i + .5) / nx
            wobble = .07 * math.sin(center.y * 1.31 + i * .47)
            if u < .30 + wobble:
                material_indices.append(0)
            elif u < .52 + wobble:
                material_indices.append(1)
            elif u < .76 + wobble:
                material_indices.append(2)
            else:
                material_indices.append(3)
    mesh = bpy.data.meshes.new("Natural blended biome transition mesh")
    mesh.from_pydata(verts, [], faces)
    seam = bpy.data.objects.new("Wide natural grass to desert transition", mesh)
    transition.objects.link(seam)
    for material in (
        "Transition Grass", "Transition Dry Meadow", "Transition Scrub", "Transition Sand"
    ):
        seam.data.materials.append(bpy.data.materials[material])
    for polygon, material_index in zip(seam.data.polygons, material_indices):
        polygon.material_index = material_index
    seam["region_module"] = "Transition"
    MODEL.append(seam)

    # The castle water now flows into the desert's north-south river. Its broad
    # earthy banks hide the remaining height difference between the source maps.
    bank_path = [(x, y, z - .025) for x, y, z in link_river]
    water_path = [(x, y, z + .025) for x, y, z in link_river]
    surface_ribbon("Connecting river banks", bank_path, .82,
                   "Transition River Bank", transition)
    surface_ribbon("Castle to desert river", water_path, .53,
                   "Transition Water", transition)

    # The castle's eastern road now bends naturally into the desert's western bridge road.
    surface_ribbon(
        "Castle to desert trade road",
        [(-.58, 1.72, .38), (-.02, 1.42, .34), (.56, 1.05, .29),
         (1.10, .55, .23), (1.50, .08, .18), (1.86, -.34, .16)],
        .34,
        "Transition Soil",
        transition,
    )

    # Sparse stones and scrub are staggered across the blend, never in a line.
    stones = [
        (-2.45, -6.65, .12, .31), (-.88, -5.20, .06, .25), (-2.05, -3.20, .14, .28),
        (-1.15, 2.95, .18, .24), (-2.52, 4.62, .22, .30), (-.62, 6.18, .16, .25),
    ]
    for index, (x, y, z, scale) in enumerate(stones, 1):
        sphere(
            f"Transition boundary rock {index}", (x, y, z + scale * .40),
            (scale * 1.25, scale, scale * .72), "Transition Stone", transition,
        )

    scrub = [(-2.70, -5.7, .18), (-1.55, -4.35, .16), (-2.25, 1.8, .20),
             (-.85, 3.85, .18), (-1.70, 5.65, .21), (.18, -2.65, .16)]
    for index, (x, y, scale) in enumerate(scrub, 1):
        sphere(f"Transition scrub bush {index}", (x, y, .17 + scale * .36),
               (scale * 1.35, scale, scale * .76), "Transition Dry Meadow", transition)


def validate_layout():
    castle_min_x = CASTLE_OFFSET.x - 12.2
    castle_max_x = CASTLE_OFFSET.x + 12.2
    desert_min_x = DESERT_OFFSET.x - 12.0
    desert_max_x = DESERT_OFFSET.x + 12.0
    seam_gap = desert_min_x - castle_max_x
    if abs(seam_gap) > .01:
        raise RuntimeError(f"Region terrain edges do not meet: gap={seam_gap:.3f}")
    castle_objects = [o for o in MODEL if o.get("region_module") == "Castle"]
    desert_objects = [o for o in MODEL if o.get("region_module") == "Desert"]
    transition_objects = [o for o in MODEL if o.get("region_module") == "Transition"]
    if not castle_objects or not desert_objects or not transition_objects:
        raise RuntimeError("A region module did not load correctly")
    print(
        f"LAYOUT VERIFIED seam_gap={seam_gap:.3f} "
        f"castle_objects={len(castle_objects)} desert_objects={len(desert_objects)} "
        f"transition_objects={len(transition_objects)}"
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
    bpy.ops.object.camera_add(location=(38, -48, 39))
    camera = bpy.context.object
    camera.name = "Combined Regions Preview Camera"
    target = Vector((0, 0, .55))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 41.5
    bpy.context.scene.camera = camera

    bpy.ops.object.light_add(type="SUN", location=(-8, -12, 22))
    sun = bpy.context.object
    sun.name = "Combined Map Sun"
    sun.data.energy = 3.2
    sun.data.angle = math.radians(8)
    sun.rotation_euler = (math.radians(30), math.radians(-18), math.radians(-32))
    bpy.ops.object.light_add(type="AREA", location=(-8, -10, 20))
    fill = bpy.context.object
    fill.name = "Combined Map Sky Fill"
    fill.data.energy = 1200
    fill.data.shape = "DISK"
    fill.data.size = 12

    world = bpy.context.scene.world or bpy.data.worlds.new("Combined Daylight World")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (.30, .49, .76, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = .70

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
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
    camera.location = (0, 0, 48)
    camera.rotation_euler = (Vector((0, 0, 0)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.ortho_scale = 50.0
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 760
    scene.render.filepath = TOPDOWN
    bpy.ops.render.render(write_still=True)
    camera.location = original_location
    camera.rotation_euler = original_rotation
    camera.data.ortho_scale = original_scale
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.filepath = PREVIEW
    bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND)


reset()
append_region(CASTLE_BLEND, CASTLE_COLLECTIONS, "Castle", CASTLE_OFFSET)
append_region(DESERT_BLEND, DESERT_COLLECTIONS, "Desert", DESERT_OFFSET)
transition_materials()
make_transition()
validate_layout()
export_glb()
render_and_save()
print(
    f"CREATED {OUTPUT_BLEND}\nEXPORTED {OUTPUT_GLB}\nRENDERED {PREVIEW}\n"
    f"TOPDOWN {TOPDOWN}\nOBJECTS {len(MODEL)}"
)
