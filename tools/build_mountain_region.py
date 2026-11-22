import bpy
import math
import random
from mathutils import Vector


ROOT = "/Users/michaelcaras/Desktop/new-game"
BLEND = f"{ROOT}/art/mountain-region-detailed.blend"
GLB = f"{ROOT}/public/models/mountain-region-detailed.glb"
PREVIEW = f"{ROOT}/art/mountain-region-detailed-preview.png"
TOPDOWN = f"{ROOT}/art/mountain-region-topdown-preview.png"
RNG = random.Random(842671)
MODEL = []
M = {}
COLS = {}
SCATTER = []
MAJOR = []


RIVER_PATH = [
    (-2.4, 8.9), (-2.05, 7.25), (-1.35, 5.75), (-.65, 4.15),
    (-1.05, 2.65), (-.45, 1.05), (.15, -.55), (1.15, -2.1),
    (1.55, -3.85), (2.75, -5.65), (3.15, -8.8),
]
TRAILS = [
    [(-10.8, -5.7), (-8.1, -4.2), (-5.7, -2.6), (-3.6, -.9), (-1.2, .15), (1.5, .2), (4.7, .7)],
    [(9.9, -6.5), (7.4, -4.9), (5.7, -3.0), (3.5, -1.5), (1.1, -.45), (-1.2, .15)],
    [(-8.8, 1.15), (-6.7, 1.5), (-4.8, 2.2), (-3.4, 3.25), (-2.05, 4.25), (-1.25, 5.65)],
    [(4.7, .7), (5.4, 2.0), (4.9, 3.1), (3.4, 4.05), (2.1, 5.0)],
]
BUILDING_SITES = [
    (4.7, .75, 1.75), (-7.1, -2.8, 1.15), (-3.15, -5.0, 1.10),
    (5.95, -3.15, 1.10), (-6.45, 1.75, 1.05), (7.1, 2.1, .95),
]
OPEN_AREAS = [(-.35, -2.45, 2.35), (-7.0, -.05, 1.65), (6.5, -5.75, 1.55)]


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection":
            bpy.data.collections.remove(collection)
    base = bpy.data.collections.get("Collection")
    if base:
        base.name = "Mountain Region"
    for name in [
        "Mountain Terrain", "Major Peaks", "River & Waterfalls", "Mountain Buildings",
        "Trails & Bridges", "Ruins & Cover", "Alpine Forest", "Snow & Details",
    ]:
        collection = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(collection)
        COLS[name] = collection


def material(name, color, rough=.9, metal=0.0, emission=None, scale=6.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bs = nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*color, 1)
    bs.inputs["Roughness"].default_value = rough
    bs.inputs["Metallic"].default_value = metal
    if emission:
        bs.inputs["Emission Color"].default_value = (*emission[0], 1)
        bs.inputs["Emission Strength"].default_value = emission[1]
    if name not in ("Mountain Water", "Window Glass", "Deep Shadow", "Magic Crystal"):
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = scale
        noise.inputs["Detail"].default_value = 5.0
        noise.inputs["Roughness"].default_value = .74
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (*(v * .68 for v in color), 1)
        ramp.color_ramp.elements[1].color = (*(min(1, v * 1.22 + .02) for v in color), 1)
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = .22
        bump.inputs["Distance"].default_value = .09
        links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], bs.inputs["Base Color"])
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bs.inputs["Normal"])
    M[name] = mat


def materials():
    material("Alpine Grass", (.16, .31, .09), .98, scale=10)
    material("Light Alpine Grass", (.29, .43, .13), .98, scale=9)
    material("Mossy Ground", (.08, .22, .065), 1.0, scale=10)
    material("Mountain Dirt", (.28, .18, .08), 1.0, scale=11)
    material("River Gravel", (.31, .31, .27), 1.0, scale=12)
    material("Granite", (.30, .32, .34), .98, scale=7)
    material("Dark Granite", (.13, .15, .17), 1.0, scale=8)
    material("Sunlit Rock", (.47, .46, .42), .96, scale=6)
    material("Snow", (.82, .87, .91), .72, scale=5)
    material("Blue Ice", (.25, .55, .72), .28, .03, scale=5)
    material("Mountain Water", (.015, .31, .52), .12, .04)
    material("Pine Needles", (.018, .13, .048), 1.0, scale=11)
    material("Snowy Pine", (.62, .70, .68), .88, scale=7)
    material("Tree Bark", (.16, .065, .024), .98, scale=9)
    material("Old Wood", (.24, .10, .035), .94, scale=7)
    material("Dark Wood", (.09, .032, .012), .98, scale=8)
    material("Cabin Plaster", (.60, .54, .41), .96, scale=6)
    material("Blue Roof", (.035, .085, .22), .74, .04, scale=7)
    material("Stone Roof", (.20, .22, .24), .94, scale=9)
    material("Iron", (.07, .08, .09), .42, .76, scale=5)
    material("Gold", (.65, .36, .055), .30, .76, scale=4)
    material("Royal Purple", (.30, .035, .57), .56, .03, scale=6)
    material("Window Glass", (.018, .12, .22), .14, .16)
    material("Deep Shadow", (.004, .006, .008), 1.0)
    material("Magic Crystal", (.04, .28, 1.0), .18, .05, ((.02, .15, 1.0), 4.2))


def move_to(obj, group):
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    COLS[group].objects.link(obj)


def reg(obj, mat=None, name=None, group="Ruins & Cover"):
    if name:
        obj.name = name
    if mat:
        obj.data.materials.append(M[mat])
    move_to(obj, group)
    MODEL.append(obj)
    return obj


def cube(name, loc, scale, mat, group="Ruins & Cover", rot=0, bevel=.025):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=(0, 0, rot))
    obj = reg(bpy.context.object, mat, name, group)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new("Weathered edges", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    return obj


def cyl(name, loc, radius, depth, mat, group="Ruins & Cover", vertices=12, rot=(0, 0, 0), bevel=0):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot
    )
    obj = reg(bpy.context.object, mat, name, group)
    if bevel:
        mod = obj.modifiers.new("Worn rim", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    return obj


def cone(name, loc, r1, r2, depth, mat, group="Ruins & Cover", vertices=12, rot=0):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices, radius1=r1, radius2=r2, depth=depth,
        location=loc, rotation=(0, 0, rot),
    )
    return reg(bpy.context.object, mat, name, group)


def sphere(name, loc, scale, mat, group="Ruins & Cover", sub=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=1, location=loc)
    obj = reg(bpy.context.object, mat, name, group)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def local_point(x, y, rot, lx, ly):
    return (
        x + lx * math.cos(rot) - ly * math.sin(rot),
        y + lx * math.sin(rot) + ly * math.cos(rot),
    )


def roof_mesh(name, x, y, z, half_w, half_d, height, mat, group, rot=0):
    verts = [
        (-half_w, -half_d, 0), (half_w, -half_d, 0),
        (half_w, half_d, 0), (-half_w, half_d, 0),
        (0, -half_d, height), (0, half_d, height),
    ]
    faces = [(0, 1, 4), (3, 5, 2), (0, 4, 5, 3), (1, 2, 5, 4)]
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    COLS[group].objects.link(obj)
    obj.data.materials.append(M[mat])
    obj.location = (x, y, z)
    obj.rotation_euler.z = rot
    MODEL.append(obj)
    cyl(name + " ridge", (x, y, z + height + .018), .025, half_d * 2.05,
        "Dark Wood", group, 8, rot=(math.pi / 2, 0, rot))
    return obj


def smooth_points(path, iterations=3):
    points = [Vector((x, y)) for x, y in path]
    for _ in range(iterations):
        refined = [points[0]]
        for a, b in zip(points, points[1:]):
            refined.extend((a * .75 + b * .25, a * .25 + b * .75))
        refined.append(points[-1])
        points = refined
    return points


def ribbon(name, path, width, mat, group, z_offset=.045):
    points = smooth_points(path)
    verts = []
    faces = []
    for i, point in enumerate(points):
        before = points[max(0, i - 1)]
        after = points[min(len(points) - 1, i + 1)]
        tangent = (after - before).normalized()
        side = Vector((-tangent.y, tangent.x)) * width
        z = terrain_height(point.x, point.y) + z_offset
        verts.extend([
            (point.x - side.x, point.y - side.y, z),
            (point.x + side.x, point.y + side.y, z),
        ])
    for i in range(len(points) - 1):
        a = i * 2
        faces.append((a, a + 1, a + 3, a + 2))
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    COLS[group].objects.link(obj)
    obj.data.materials.append(M[mat])
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


def path_distance(x, y, path):
    return min(segment_distance(x, y, a, b) for a, b in zip(path, path[1:]))


PEAKS = [
    (-8.0, 5.0, 3.4, 1.8, 2.1), (-5.6, 6.15, 4.4, 1.55, 1.65),
    (-2.95, 6.55, 5.25, 1.45, 1.45), (-.10, 5.85, 4.75, 1.60, 1.55),
    (2.85, 5.75, 4.55, 1.52, 1.55), (5.75, 4.75, 3.90, 1.65, 1.75),
    (8.25, 3.35, 3.15, 1.80, 1.90),
]


def raw_height(x, y):
    rolling = .15 * math.sin(x * .57) * math.cos(y * .61) + .08 * math.sin(x * 1.3 + y * .42)
    height = .10 + rolling
    for px, py, power, sx, sy in PEAKS:
        # The broad base only lifts the ridge slightly. The visible summit is
        # one continuous jagged cone rather than a cone stacked on a second hill.
        height += power * .38 * math.exp(-((x - px) / sx) ** 2 - ((y - py) / sy) ** 2)
    ridge = 1.05 * math.exp(-((y - (5.5 - .12 * x)) / 1.7) ** 2) * math.exp(-(x / 10.5) ** 6)
    foothills = .48 * math.exp(-((y - 1.3) / 2.6) ** 2) * (.65 + .35 * math.sin(x * .74) ** 2)
    river_cut = -.48 * math.exp(-(path_distance(x, y, RIVER_PATH) / .74) ** 2)
    south_valley = -.28 * math.exp(-((y + 2.3) / 2.0) ** 2 - ((x + .2) / 4.5) ** 2)
    return height + ridge + foothills + river_cut + south_valley


def terrain_height(x, y):
    height = raw_height(x, y)
    for sx, sy, radius in BUILDING_SITES:
        distance = math.hypot(x - sx, y - sy)
        if distance < radius:
            t = 1 - distance / radius
            t = t * t * (3 - 2 * t)
            height = height * (1 - t) + raw_height(sx, sy) * t
    return height


def terrain():
    nx, ny = 176, 132
    verts = []
    faces = []
    for j in range(ny + 1):
        y = -9.2 + 18.4 * j / ny
        for i in range(nx + 1):
            x = -12.2 + 24.4 * i / nx
            verts.append((x, y, terrain_height(x, y)))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    mesh = bpy.data.meshes.new("Alpine mountain terrain mesh")
    mesh.from_pydata(verts, [], faces)
    names = [
        "Alpine Grass", "Light Alpine Grass", "Mossy Ground", "Mountain Dirt",
        "River Gravel", "Granite", "Dark Granite", "Snow",
    ]
    for name in names:
        mesh.materials.append(M[name])
    obj = bpy.data.objects.new("Detailed Alpine Mountain Terrain", mesh)
    COLS["Mountain Terrain"].objects.link(obj)
    MODEL.append(obj)
    for polygon in mesh.polygons:
        center = polygon.center
        x, y = center.x, center.y
        z = sum(mesh.vertices[v].co.z for v in polygon.vertices) / len(polygon.vertices)
        river_distance = path_distance(x, y, RIVER_PATH)
        dx = abs(terrain_height(x + .10, y) - terrain_height(x - .10, y))
        dy = abs(terrain_height(x, y + .10) - terrain_height(x, y - .10))
        slope = dx + dy
        if river_distance < .68:
            polygon.material_index = 4
        elif z > 4.15:
            polygon.material_index = 7
        elif z > 2.25 and slope > .22:
            polygon.material_index = 6 if slope > .50 else 5
        elif z > 1.25:
            polygon.material_index = 5 if slope > .30 else 2
        elif y < -1.5 and abs(math.sin(x * .7 + y * .4)) > .72:
            polygon.material_index = 1
        elif any(path_distance(x, y, trail) < .45 for trail in TRAILS):
            polygon.material_index = 3
        else:
            polygon.material_index = 0
    bevel = obj.modifiers.new("Natural terrain smoothing", "BEVEL")
    bevel.width = .022
    bevel.segments = 2


def jagged_spire(name, x, y, radius, height, seed):
    randomizer = random.Random(seed)
    z = terrain_height(x, y) - .08
    sides = 11
    # The outer toe is much wider than the summit and every one of its vertices
    # sits on the terrain beneath it. This turns the cone into part of the
    # landscape instead of leaving a flat circular base on top of the ground.
    rings = [(0, 1.55), (.16, 1.04), (.40, .76), (.67, .43), (.86, .20), (1.0, .02)]
    verts = []
    for ring_index, (rz, multiplier) in enumerate(rings):
        for i in range(sides):
            angle = math.tau * i / sides
            jitter = 1 + randomizer.uniform(-.15, .15)
            r = radius * multiplier * jitter
            vx = x + math.cos(angle) * r
            vy = y + math.sin(angle) * r
            if ring_index == 0:
                vz = terrain_height(vx, vy) - .035
            elif ring_index == 1:
                vz = max(terrain_height(vx, vy) + .02, z + height * rz)
            else:
                vz = z + height * rz
            verts.append((vx, vy, vz))
    faces = []
    for ring in range(len(rings) - 1):
        for i in range(sides):
            a = ring * sides + i
            faces.append((a, ring * sides + (i + 1) % sides,
                          (ring + 1) * sides + (i + 1) % sides, (ring + 1) * sides + i))
    mesh = bpy.data.meshes.new(name + " rock mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(M["Dark Granite"])
    mesh.materials.append(M["Granite"])
    mesh.materials.append(M["Snow"])
    mesh.materials.append(M["Mossy Ground"])
    mesh.materials.append(M["Alpine Grass"])
    obj = bpy.data.objects.new(name, mesh)
    COLS["Major Peaks"].objects.link(obj)
    MODEL.append(obj)
    for polygon_index, polygon in enumerate(mesh.polygons):
        average_z = sum(mesh.vertices[v].co.z for v in polygon.vertices) / len(polygon.vertices)
        fraction = (average_z - z) / height
        ring_index = polygon_index // sides
        # Snow crosses the same cone in an uneven line, so it reads as snow on
        # rock instead of a separate white cone placed on top.
        snow_line = .72 + .10 * math.sin((polygon_index % sides) * 1.73 + seed * .19)
        if ring_index == 0:
            toe_pattern = (polygon_index + seed) % 5
            polygon.material_index = 1 if toe_pattern == 0 else (4 if toe_pattern == 1 else 3)
        elif ring_index == 1:
            polygon.material_index = 0 if (polygon_index + seed) % 4 == 0 else 1
        elif fraction > snow_line:
            polygon.material_index = 2
        else:
            polygon.material_index = 1 if (polygon_index + seed) % 4 else 0
    return obj


def major_peaks():
    spires = [
        ("Western Sentinel Peak", -8.05, 5.05, 1.05, 2.25, 11),
        ("Frostfang Peak", -5.62, 6.15, 1.00, 2.65, 21),
        ("High Crown Peak", -2.95, 6.55, 1.08, 3.05, 31),
        ("Silver Needle Peak", -.10, 5.85, .95, 2.80, 41),
        ("Twin Moon Peak", 2.85, 5.75, 1.02, 2.65, 51),
        ("Eastern Rampart Peak", 5.75, 4.75, 1.05, 2.35, 61),
        ("Watcher's Peak", 8.25, 3.35, .92, 2.05, 71),
    ]
    for values in spires:
        jagged_spire(*values)
    # Smaller rock teeth connect the large peaks into one readable range.
    for index in range(22):
        x = -9.5 + index * .88
        y = 5.25 + .65 * math.sin(index * .68)
        if min(math.hypot(x - px, y - py) for px, py, *_ in PEAKS) < .8:
            continue
        jagged_spire(f"Mountain ridge tooth {index + 1}", x, y, RNG.uniform(.28, .52),
                     RNG.uniform(.65, 1.35), 100 + index)


def rivers():
    ribbon("Mountain river gravel banks", RIVER_PATH, .62, "River Gravel", "River & Waterfalls", .055)
    ribbon("Cold mountain river", RIVER_PATH, .42, "Mountain Water", "River & Waterfalls", .105)
    # Broad stepping stones at a shallow southern crossing.
    for i in range(-4, 5):
        x = 1.30 + i * .20
        y = -3.08 + math.sin(i * .78) * .09
        sphere("River stepping stone", (x, y, terrain_height(x, y) + .17),
               (.17, .13, .08), "Sunlit Rock", "River & Waterfalls")
    # Two vertical sheets make the steep upper river read as waterfalls.
    for index, (x, y, width, drop) in enumerate([(-1.12, 3.18, .48, .82), (-1.78, 6.35, .38, .68)], 1):
        top = terrain_height(x, y) + .18
        cube(f"Mountain waterfall {index}", (x, y, top - drop / 2), (width, .035, drop / 2),
             "Mountain Water", "River & Waterfalls", -.12, .01)
        for j in range(3):
            sphere(f"Waterfall mist {index}", (x + (j - 1) * .17, y - .08, top - drop + .06),
                   (.18, .13, .08), "Blue Ice", "River & Waterfalls")


def reserve_major(name, x, y, radius):
    MAJOR.append((name, x, y, radius))


def arched_window(name, x, y, z, rot, scale, group):
    cube(name + " glass", (x, y, z), (scale * .52, .018, scale),
         "Window Glass", group, rot, .006)
    cube(name + " sill", (x, y, z - scale * 1.12), (scale * .70, .03, .022),
         "Sunlit Rock", group, rot, .005)


def cabin(name, x, y, w=.72, d=.52, h=.82, rot=0, roof="Stone Roof"):
    z = terrain_height(x, y)
    reserve_major(name, x, y, math.hypot(w, d) + .12)
    cube(name + " foundation", (x, y, z + .10), (w * 1.08, d * 1.08, .10),
         "Granite", "Mountain Buildings", rot, .025)
    cube(name + " walls", (x, y, z + .20 + h / 2), (w, d, h / 2),
         "Cabin Plaster", "Mountain Buildings", rot, .035)
    for side in (-.72, 0, .72):
        px, py = local_point(x, y, rot, side * w, -d - .012)
        cube(name + " timber", (px, py, z + .20 + h / 2), (.032, .025, h / 2),
             "Dark Wood", "Mountain Buildings", rot, .006)
    roof_mesh(name + " roof", x, y, z + .21 + h, w * 1.20, d * 1.18, h * .55,
              roof, "Mountain Buildings", rot)
    dx, dy = local_point(x, y, rot, 0, -d - .028)
    cube(name + " door", (dx, dy, z + .43), (w * .19, .026, .32),
         "Dark Wood", "Mountain Buildings", rot, .018)
    for side in (-.58, .58):
        wx, wy = local_point(x, y, rot, side * w, -d - .035)
        arched_window(name + " window", wx, wy, z + .64, rot, .105, "Mountain Buildings")
    cx, cy = local_point(x, y, rot, w * .55, d * .18)
    cube(name + " chimney", (cx, cy, z + h + .45), (.11, .11, .48),
         "Dark Granite", "Mountain Buildings", rot, .018)


def monastery():
    x, y = 4.7, .75
    z = terrain_height(x, y)
    reserve_major("Stormwatch Monastery", x, y, 1.68)
    cube("Monastery mountain plinth", (x, y, z + .18), (1.58, 1.18, .18),
         "Dark Granite", "Mountain Buildings", -.08, .045)
    cube("Monastery great hall", (x, y, z + 1.02), (1.12, .72, .82),
         "Sunlit Rock", "Mountain Buildings", -.08, .045)
    roof_mesh("Monastery blue roof", x, y, z + 1.84, 1.30, .88, .78,
              "Blue Roof", "Mountain Buildings", -.08)
    for side in (-1, 1):
        tx, ty = local_point(x, y, -.08, side * 1.05, .34)
        cyl("Monastery corner tower", (tx, ty, z + 1.20), .34, 2.05,
            "Granite", "Mountain Buildings", 14, bevel=.02)
        cone("Monastery tower roof", (tx, ty, z + 2.53), .46, .018, .78,
             "Blue Roof", "Mountain Buildings", 14)
        cyl("Monastery gold finial", (tx, ty, z + 3.04), .025, .38,
            "Gold", "Mountain Buildings", 8)
    cyl("Monastery observatory tower", (x, y + .25, z + 1.80), .48, 3.10,
        "Granite", "Mountain Buildings", 14, bevel=.025)
    cone("Monastery observatory spire", (x, y + .25, z + 3.82), .66, .02, 1.12,
         "Blue Roof", "Mountain Buildings", 16)
    cone("Monastery magic crystal", (x, y + .25, z + 4.55), .15, .015, .38,
         "Magic Crystal", "Mountain Buildings", 6, math.pi / 6)
    for level in (z + 1.3, z + 2.15):
        for angle in (0, math.pi / 2, math.pi, 3 * math.pi / 2):
            wx = x + math.cos(angle) * .49
            wy = y + .25 + math.sin(angle) * .49
            arched_window("Observatory arched window", wx, wy, level,
                          angle + math.pi / 2, .11, "Mountain Buildings")
    # Entry stairs and banners face the main pass.
    for i in range(5):
        cube("Monastery entry stair", (x - .1, y - .90 - i * .13, z + .04 + i * .055),
             (.55 + i * .08, .12, .045), "Sunlit Rock", "Mountain Buildings", -.08, .012)
    for side in (-1, 1):
        bx, by = local_point(x, y, -.08, side * .68, -.74)
        cube("Monastery banner", (bx, by, z + 1.13), (.16, .018, .42),
             "Royal Purple", "Mountain Buildings", -.08, .006)


def buildings():
    monastery()
    cabin("Western Ranger Cabin", -7.1, -2.8, .78, .54, .86, .24, "Stone Roof")
    cabin("South Pass Lodge", -3.15, -5.0, .86, .58, .92, -.16, "Blue Roof")
    cabin("River Hunter Cabin", 5.95, -3.15, .72, .50, .82, .30, "Stone Roof")
    cabin("High Trail Shelter", -6.45, 1.75, .62, .45, .72, -.28, "Stone Roof")
    cabin("Eastern Shepherd Hut", 7.1, 2.1, .58, .42, .70, .18, "Stone Roof")


def bridge(name, x, y, rot, length=1.1, width=.48):
    z = terrain_height(x, y) + .30
    for i in range(8):
        along = (i - 3.5) * length * 2 / 8
        px, py = local_point(x, y, rot, along, 0)
        cube(name + " deck", (px, py, z), (length / 7.7, width, .09),
             "Old Wood", "Trails & Bridges", rot, .012)
    for side in (-1, 1):
        sx, sy = local_point(x, y, rot, 0, side * width)
        cube(name + " rail", (sx, sy, z + .42), (length, .035, .055),
             "Dark Wood", "Trails & Bridges", rot, .010)
        for i in range(5):
            px, py = local_point(x, y, rot, (i - 2) * length * .42, side * width)
            cyl(name + " post", (px, py, z + .24), .030, .48,
                "Dark Wood", "Trails & Bridges", 8)
    reserve_major(name, x, y, length + .12)


def trails_and_bridges():
    for index, trail in enumerate(TRAILS, 1):
        ribbon(f"Mountain trail {index}", trail, .28 if index < 3 else .22,
               "Mountain Dirt", "Trails & Bridges", .060)
    bridge("Lower Valley Bridge", .05, -.25, -.55, 1.12, .48)
    bridge("High Pass Bridge", -1.18, 2.25, -.44, .88, .40)


def pine_tree(name, x, y, scale=1.0, snowy=False):
    z = terrain_height(x, y)
    cyl(name + " trunk", (x, y, z + .32 * scale), .065 * scale, .64 * scale,
        "Tree Bark", "Alpine Forest", 8)
    crown = "Snowy Pine" if snowy else "Pine Needles"
    cone(name + " lower branches", (x, y, z + .70 * scale), .39 * scale, .035,
         .78 * scale, crown, "Alpine Forest", 10)
    cone(name + " middle branches", (x, y, z + 1.03 * scale), .31 * scale, .025,
         .73 * scale, crown, "Alpine Forest", 10)
    cone(name + " upper branches", (x, y, z + 1.36 * scale), .22 * scale, .018,
         .64 * scale, crown, "Alpine Forest", 10)


def boulder(name, x, y, scale=1.0, snow=False):
    z = terrain_height(x, y)
    sphere(name, (x, y, z + .25 * scale), (.45 * scale, .35 * scale, .32 * scale),
           "Granite", "Ruins & Cover")
    if snow:
        sphere(name + " snow cap", (x - .03, y, z + .48 * scale),
               (.34 * scale, .27 * scale, .08 * scale), "Snow", "Snow & Details")


def reserve_scatter(x, y, radius):
    if any((x - ox) ** 2 + (y - oy) ** 2 < (radius + other + .10) ** 2
           for ox, oy, other in SCATTER):
        return False
    SCATTER.append((x, y, radius))
    return True


def is_open(x, y, extra=0):
    return any((x - cx) ** 2 + (y - cy) ** 2 < (radius + extra) ** 2
               for cx, cy, radius in OPEN_AREAS)


def is_protected(x, y, radius):
    if path_distance(x, y, RIVER_PATH) < .90 + radius:
        return True
    if any(path_distance(x, y, trail) < .48 + radius for trail in TRAILS):
        return True
    if any((x - sx) ** 2 + (y - sy) ** 2 < (sr + radius + .12) ** 2
           for sx, sy, sr in BUILDING_SITES):
        return True
    if is_open(x, y, radius):
        return True
    return False


def ruins_and_forest():
    # Ruined gate and a broken signal tower frame the western open pass.
    z = terrain_height(-8.5, -.1)
    for side in (-1, 1):
        cube("Ancient pass gate pillar", (-8.5 + side * .52, -.1, z + .72),
             (.16, .20, .72), "Dark Granite", "Ruins & Cover", .08, .025)
    cube("Ancient pass gate lintel", (-8.5, -.1, z + 1.48), (.68, .22, .16),
         "Dark Granite", "Ruins & Cover", .08, .025)
    reserve_major("Ancient Pass Gate", -8.5, -.1, .90)

    tx, ty = 8.4, -1.1
    tz = terrain_height(tx, ty)
    cyl("Broken signal tower", (tx, ty, tz + .74), .46, 1.48,
        "Granite", "Ruins & Cover", 12, bevel=.025)
    for i in range(7):
        angle = math.tau * i / 7
        if i in (2, 3):
            continue
        cube("Signal tower battlement", (tx + math.cos(angle) * .39, ty + math.sin(angle) * .39, tz + 1.62),
             (.09, .09, .16), "Sunlit Rock", "Ruins & Cover", angle, .012)
    reserve_major("Broken Signal Tower", tx, ty, .70)

    # Forest density fades as elevation rises. All positions are spacing checked.
    trees = 0
    attempts = 0
    while trees < 112 and attempts < 2400:
        attempts += 1
        x = RNG.uniform(-11.3, 11.1)
        y = RNG.uniform(-7.7, 4.25)
        z = terrain_height(x, y)
        if z > 2.25:
            continue
        scale = RNG.uniform(.72, 1.34)
        radius = .34 * scale
        if is_protected(x, y, radius) or not reserve_scatter(x, y, radius):
            continue
        pine_tree(f"Alpine pine {trees + 1}", x, y, scale, z > 1.35)
        trees += 1

    rocks = 0
    attempts = 0
    while rocks < 72 and attempts < 1800:
        attempts += 1
        x = RNG.uniform(-11.4, 11.4)
        y = RNG.uniform(-7.9, 7.7)
        scale = RNG.uniform(.25, .72)
        radius = .43 * scale
        if is_protected(x, y, radius) or not reserve_scatter(x, y, radius):
            continue
        boulder(f"Mountain cover boulder {rocks + 1}", x, y, scale, terrain_height(x, y) > 2.2)
        rocks += 1

    # Fallen trees and short walls provide readable cover around, not inside, open spaces.
    for index, (x, y, rot) in enumerate([(-2.8, -2.6, .35), (2.5, -2.9, -.22),
                                         (-6.2, -.9, .18), (6.9, -6.7, -.42)], 1):
        z = terrain_height(x, y)
        cyl(f"Fallen pine trunk {index}", (x, y, z + .18), .12, 1.55,
            "Tree Bark", "Ruins & Cover", 9, rot=(0, math.pi / 2, rot))
        reserve_major(f"Fallen pine trunk {index}", x, y, .90)
    for index, (x, y, rot) in enumerate([(-.65, -4.15, .16), (4.3, -4.9, -.31)], 1):
        z = terrain_height(x, y)
        for i in range(5):
            px, py = local_point(x, y, rot, (i - 2) * .29, 0)
            height = .28 + .10 * ((i + 1) % 3)
            cube(f"Broken mountain wall {index}", (px, py, z + height / 2),
                 (.16, .13, height / 2), "Granite", "Ruins & Cover", rot, .018)
        reserve_major(f"Broken mountain wall {index}", x, y, .88)


def validate_clearances():
    worst = 999.0
    pair = None
    for i, a in enumerate(MAJOR):
        for b in MAJOR[i + 1:]:
            gap = math.hypot(a[1] - b[1], a[2] - b[2]) - a[3] - b[3]
            if gap < worst:
                worst = gap
                pair = (a[0], b[0])
    if worst < .08:
        raise RuntimeError(f"Major clearance failed: {pair} gap={worst:.3f}")
    scatter_worst = 999.0
    for i, a in enumerate(SCATTER):
        for b in SCATTER[i + 1:]:
            scatter_worst = min(scatter_worst,
                                math.hypot(a[0] - b[0], a[1] - b[1]) - a[2] - b[2])
    if SCATTER and scatter_worst < .09:
        raise RuntimeError(f"Scatter clearance failed: {scatter_worst:.3f}")
    print(f"CLEARANCE VERIFIED major_min={worst:.3f} scatter_min={scatter_worst:.3f} scatter_items={len(SCATTER)}")


def export_glb():
    bpy.ops.object.select_all(action="DESELECT")
    for obj in MODEL:
        if obj and obj.name in bpy.context.scene.objects:
            obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=GLB, export_format="GLB", use_selection=True, export_apply=True,
        export_yup=True, export_materials="EXPORT", export_extras=True,
    )


def render_and_save():
    bpy.ops.object.camera_add(location=(20.5, -27.5, 21.5))
    camera = bpy.context.object
    camera.name = "Mountain Isometric Preview Camera"
    target = Vector((0, 0, 1.75))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 31.5
    bpy.context.scene.camera = camera

    bpy.ops.object.light_add(type="SUN", location=(-8, -10, 24))
    sun = bpy.context.object
    sun.name = "Cold Mountain Sun"
    sun.data.energy = 3.4
    sun.data.angle = math.radians(6)
    sun.rotation_euler = (math.radians(27), math.radians(-20), math.radians(-34))
    bpy.ops.object.light_add(type="AREA", location=(-6, -8, 17))
    fill = bpy.context.object
    fill.name = "Mountain Sky Fill"
    fill.data.energy = 1050
    fill.data.shape = "DISK"
    fill.data.size = 10

    world = bpy.context.scene.world or bpy.data.worlds.new("Clear Alpine Daylight")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (.28, .47, .74, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = .72

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1500
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.filepath = PREVIEW
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    bpy.ops.render.render(write_still=True)

    original_location = camera.location.copy()
    original_rotation = camera.rotation_euler.copy()
    original_scale = camera.data.ortho_scale
    camera.location = (0, 0, 38)
    camera.rotation_euler = (Vector((0, 0, 0)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.ortho_scale = 25.2
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 1050
    scene.render.filepath = TOPDOWN
    bpy.ops.render.render(write_still=True)
    camera.location = original_location
    camera.rotation_euler = original_rotation
    camera.data.ortho_scale = original_scale
    scene.render.resolution_x = 1500
    scene.render.resolution_y = 1000
    scene.render.filepath = PREVIEW
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)


reset()
materials()
terrain()
major_peaks()
rivers()
buildings()
trails_and_bridges()
ruins_and_forest()
validate_clearances()
export_glb()
render_and_save()
print(
    f"CREATED {BLEND}\nEXPORTED {GLB}\nRENDERED {PREVIEW}\n"
    f"TOPDOWN {TOPDOWN}\nOBJECTS {len(MODEL)}"
)
