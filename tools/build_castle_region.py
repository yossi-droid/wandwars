import bpy
import math
import random
from mathutils import Vector


ROOT = "/Users/michaelcaras/Desktop/new-game"
BLEND = f"{ROOT}/art/castle-region-detailed.blend"
GLB = f"{ROOT}/public/models/castle-region-detailed.glb"
PREVIEW = f"{ROOT}/art/castle-region-detailed-preview.png"
TOPDOWN = f"{ROOT}/art/castle-region-topdown-preview.png"
RNG = random.Random(418327)
MODEL = []
M = {}
COLS = {}
SCATTER_OCCUPIED = []
MAJOR_SITES = []


RIVER_PATH = [
    (-2.55, 9.2), (-2.85, 7.1), (-3.75, 5.1), (-5.05, 3.05),
    (-5.45, 1.05), (-5.35, -1.25), (-4.55, -3.45), (-2.65, -5.25),
    (-0.25, -5.9), (2.15, -5.45), (4.35, -4.1), (6.2, -2.15), (8.8, -1.35),
]
RIVER_BRANCH = [
    (-0.25, -5.9), (1.05, -6.9), (3.25, -7.5), (6.0, -7.25), (9.5, -6.2),
]
ROAD_PATHS = [
    [(-11.7, 0.0), (-8.9, 0.15), (-6.8, 0.0), (-4.25, 0.0)],
    [(0.0, -8.8), (-0.1, -7.1), (0.0, -5.2), (0.0, -3.65)],
    [(11.7, 0.6), (9.4, 0.2), (7.0, 0.05), (4.25, 0.0)],
    [(-8.6, 6.8), (-6.5, 5.2), (-5.4, 3.4), (-4.0, 2.35)],
    [(8.5, 6.8), (7.0, 5.4), (5.8, 3.8), (3.7, 2.5)],
]


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for c in list(bpy.data.collections):
        if c.name != "Collection":
            bpy.data.collections.remove(c)
    base = bpy.data.collections.get("Collection")
    if base:
        base.name = "Castle Region"
    names = [
        "Terrain & Water", "Outer Walls", "Towers & Gates", "Central Keep",
        "Inner Ward", "Roads & Bridges", "Props & Cover", "Vegetation",
    ]
    for name in names:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
        COLS[name] = c


def material(name, color, rough=.86, metal=0.0, emission=None, scale=5.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    bs = nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*color, 1)
    bs.inputs["Roughness"].default_value = rough
    bs.inputs["Metallic"].default_value = metal
    if emission:
        bs.inputs["Emission Color"].default_value = (*emission[0], 1)
        bs.inputs["Emission Strength"].default_value = emission[1]
    if name not in ("Window Glass", "Deep Shadow", "River Water", "Magic Blue"):
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = scale
        noise.inputs["Detail"].default_value = 5.0
        noise.inputs["Roughness"].default_value = .72
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (*(v * .70 for v in color), 1)
        ramp.color_ramp.elements[1].color = (*(min(1, v * 1.20 + .02) for v in color), 1)
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = .20
        bump.inputs["Distance"].default_value = .08
        links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], bs.inputs["Base Color"])
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bs.inputs["Normal"])
    M[name] = m


def materials():
    material("Meadow Grass", (.18, .34, .105), .98, scale=9)
    material("Light Grass", (.31, .47, .15), .98, scale=8)
    material("Moss", (.10, .26, .075), 1.0, scale=10)
    material("Rich Soil", (.25, .15, .065), 1.0, scale=10)
    material("River Bank", (.32, .24, .12), 1.0, scale=8)
    material("River Water", (.018, .31, .52), .12, .05)
    material("Castle Stone", (.43, .45, .44), .94, scale=5)
    material("Light Stone", (.60, .59, .53), .92, scale=5)
    material("Dark Stone", (.18, .20, .21), .98, scale=6)
    material("Cobblestone", (.34, .35, .33), .98, scale=13)
    material("Blue Slate", (.035, .095, .24), .72, .06, scale=7)
    material("Deep Blue Slate", (.018, .045, .13), .80, .05, scale=8)
    material("Plaster", (.70, .65, .52), .94, scale=5)
    material("Old Wood", (.25, .105, .035), .92, scale=7)
    material("Dark Wood", (.105, .038, .014), .96, scale=7)
    material("Iron", (.075, .085, .09), .40, .76, scale=5)
    material("Gold Trim", (.66, .36, .055), .30, .75, scale=4)
    material("Royal Purple", (.28, .035, .55), .54, .05, scale=6)
    material("Window Glass", (.018, .13, .25), .13, .18)
    material("Deep Shadow", (.004, .006, .008), 1.0)
    material("Magic Blue", (.04, .34, 1.0), .18, .08, ((.02, .18, 1.0), 4.0))
    material("Tree Bark", (.18, .075, .027), .98, scale=9)
    material("Pine Needles", (.025, .15, .06), 1.0, scale=10)
    material("Leaf", (.08, .26, .055), 1.0, scale=10)
    material("Flowers", (.65, .33, .05), .84, scale=8)


def move_to(o, group):
    for c in list(o.users_collection):
        c.objects.unlink(o)
    COLS[group].objects.link(o)


def reg(o, mat=None, name=None, group="Props & Cover"):
    if name:
        o.name = name
    if mat:
        o.data.materials.append(M[mat])
    move_to(o, group)
    MODEL.append(o)
    return o


def cube(name, loc, scale, mat, group="Props & Cover", rot=0.0, bevel=.025):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=(0, 0, rot))
    o = reg(bpy.context.object, mat, name, group)
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = o.modifiers.new("Worn edges", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    return o


def cyl(name, loc, radius, depth, mat, group="Props & Cover", vertices=12, rot=(0, 0, 0), bevel=0):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot
    )
    o = reg(bpy.context.object, mat, name, group)
    if bevel:
        mod = o.modifiers.new("Worn rim", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    return o


def cone(name, loc, r1, r2, depth, mat, group="Props & Cover", vertices=12, rot=0):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices, radius1=r1, radius2=r2, depth=depth,
        location=loc, rotation=(0, 0, rot),
    )
    return reg(bpy.context.object, mat, name, group)


def sphere(name, loc, scale, mat, group="Props & Cover", sub=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=1, location=loc)
    o = reg(bpy.context.object, mat, name, group)
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o


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
    me = bpy.data.meshes.new(name + " mesh")
    me.from_pydata(verts, [], faces)
    o = bpy.data.objects.new(name, me)
    COLS[group].objects.link(o)
    o.data.materials.append(M[mat])
    o.location = (x, y, z)
    o.rotation_euler.z = rot
    MODEL.append(o)
    # Ridge and fascia make the silhouette readable without tiny roof tiles.
    ridge = local_point(x, y, rot, 0, 0)
    cyl(name + " ridge", (ridge[0], ridge[1], z + height + .018), .025, half_d * 2.06,
        "Gold Trim", group, 8, rot=(math.pi / 2, 0, rot))
    for side in (-1, 1):
        px, py = local_point(x, y, rot, side * half_w, 0)
        cube(name + " fascia", (px, py, z + .025), (.025, half_d * 1.04, .035),
             "Dark Wood", group, rot, .006)
    return o


def smooth_points(path, iterations=3):
    pts = [Vector((x, y)) for x, y in path]
    for _ in range(iterations):
        refined = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            refined.extend((a * .75 + b * .25, a * .25 + b * .75))
        refined.append(pts[-1])
        pts = refined
    return pts


def ribbon(name, path, width, mat, group="Roads & Bridges", z_offset=.04, height_func=None):
    pts = smooth_points(path)
    verts = []
    faces = []
    height_func = height_func or terrain_height
    for i, p in enumerate(pts):
        before = pts[max(0, i - 1)]
        after = pts[min(len(pts) - 1, i + 1)]
        tangent = (after - before).normalized()
        side = Vector((-tangent.y, tangent.x)) * width
        z = height_func(p.x, p.y) + z_offset
        verts.extend(((p.x - side.x, p.y - side.y, z), (p.x + side.x, p.y + side.y, z)))
    for i in range(len(pts) - 1):
        a = i * 2
        faces.append((a, a + 1, a + 3, a + 2))
    me = bpy.data.meshes.new(name + " mesh")
    me.from_pydata(verts, [], faces)
    o = bpy.data.objects.new(name, me)
    COLS[group].objects.link(o)
    o.data.materials.append(M[mat])
    MODEL.append(o)
    return o


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


def raw_terrain_height(x, y):
    rolling = .16 * math.sin(x * .63) * math.cos(y * .52) + .08 * math.sin(x * 1.24 + y * .35)
    north_hills = .65 * math.exp(-((y - 7.1) / 2.1) ** 2) * (.65 + .35 * math.cos(x * .48))
    east_hill = .42 * math.exp(-((x - 8.8) / 2.5) ** 2 - ((y - 3.8) / 3.1) ** 2)
    west_hill = .36 * math.exp(-((x + 9.2) / 2.1) ** 2 - ((y + 3.5) / 3.2) ** 2)
    river_cut = -.42 * math.exp(-(path_distance(x, y, RIVER_PATH) / .95) ** 2)
    branch_cut = -.36 * math.exp(-(path_distance(x, y, RIVER_BRANCH) / .85) ** 2)
    return .14 + rolling + north_hills + east_hill + west_hill + river_cut + branch_cut


def terrain_height(x, y):
    raw = raw_terrain_height(x, y)
    d = math.hypot(x, y)
    # A broad, subtly crowned island supports the entire castle without buried foundations.
    if d < 5.35:
        t = max(0, min(1, (5.35 - d) / .85))
        t = t * t * (3 - 2 * t)
        island = .58 + .025 * math.cos(d * 1.6)
        raw = raw * (1 - t) + island * t
    return raw


def terrain():
    nx, ny = 168, 124
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
    me = bpy.data.meshes.new("Castle valley terrain mesh")
    me.from_pydata(verts, [], faces)
    for name in ("Meadow Grass", "Light Grass", "Moss", "Rich Soil", "River Bank", "Dark Stone"):
        me.materials.append(M[name])
    o = bpy.data.objects.new("Castle Valley Terrain", me)
    COLS["Terrain & Water"].objects.link(o)
    MODEL.append(o)
    for p in me.polygons:
        c = p.center
        x, y = c.x, c.y
        rd = min(path_distance(x, y, RIVER_PATH), path_distance(x, y, RIVER_BRANCH))
        if rd < .72:
            p.material_index = 4
        elif math.hypot(x, y) < 5.3:
            p.material_index = 1 if (int((x + 12) * 2) + int((y + 9) * 2)) % 3 else 2
        elif y > 6.2 and terrain_height(x, y) > .55:
            p.material_index = 5
        elif abs(math.sin(x * .7 + y)) > .82:
            p.material_index = 0
        else:
            p.material_index = 1
    bevel = o.modifiers.new("Soft natural ground", "BEVEL")
    bevel.width = .025
    bevel.segments = 2


def rivers_and_roads():
    # Wide brown bank under the water keeps the edges natural and visible from above.
    ribbon("Main river banks", RIVER_PATH, .92, "River Bank", z_offset=.035)
    ribbon("Main blue river", RIVER_PATH, .69, "River Water", z_offset=.10)
    ribbon("South river branch banks", RIVER_BRANCH, .80, "River Bank", z_offset=.035)
    ribbon("South river branch", RIVER_BRANCH, .58, "River Water", z_offset=.10)
    for i, path in enumerate(ROAD_PATHS):
        ribbon(f"Winding approach road {i + 1}", path, .34, "Rich Soil", z_offset=.055)


def reserve_major(name, x, y, radius, category):
    MAJOR_SITES.append((name, x, y, radius, category))


def reserve_scatter(x, y, radius):
    if any((x - ox) ** 2 + (y - oy) ** 2 < (radius + other + .10) ** 2
           for ox, oy, other in SCATTER_OCCUPIED):
        return False
    SCATTER_OCCUPIED.append((x, y, radius))
    return True


def crenellated_tower(name, x, y, radius=.46, wall_h=1.75, roof=True, group="Towers & Gates"):
    z = terrain_height(x, y)
    cyl(name + " stone body", (x, y, z + wall_h / 2), radius, wall_h,
        "Castle Stone", group, 16, bevel=.025)
    cyl(name + " upper rim", (x, y, z + wall_h - .03), radius * 1.08, .16,
        "Light Stone", group, 16, bevel=.02)
    for i in range(10):
        a = math.tau * i / 10
        px = x + math.cos(a) * radius * .91
        py = y + math.sin(a) * radius * .91
        cube(name + " battlement", (px, py, z + wall_h + .15),
             (.085, .085, .16), "Light Stone", group, a, .012)
    for i in range(4):
        a = math.tau * i / 4
        px = x + math.cos(a) * (radius + .012)
        py = y + math.sin(a) * (radius + .012)
        cube(name + " arrow slit", (px, py, z + wall_h * .57),
             (.055, .016, .16), "Deep Shadow", group, a + math.pi / 2, .006)
    if roof:
        cone(name + " blue roof", (x, y, z + wall_h + .58), radius * 1.25, .018, .86,
             "Blue Slate", group, 16)
        cyl(name + " roof finial", (x, y, z + wall_h + 1.12), .035, .35,
            "Gold Trim", group, 8)
        cone(name + " roof point", (x, y, z + wall_h + 1.33), .10, 0, .22,
             "Gold Trim", group, 8)
    return z


def outer_walls():
    rx, ry = 4.45, 3.72
    count = 44
    gates = [0, math.pi, -math.pi / 2]
    for i in range(count):
        a = math.tau * i / count
        if any(abs(math.atan2(math.sin(a - g), math.cos(a - g))) < .115 for g in gates):
            continue
        x, y = rx * math.cos(a), ry * math.sin(a)
        z = terrain_height(x, y)
        tangent = math.atan2(ry * math.cos(a), -rx * math.sin(a))
        cube("Outer curtain wall", (x, y, z + .67), (.37, .17, .67),
             "Castle Stone", "Outer Walls", tangent, .025)
        for off in (-.22, .22):
            px, py = local_point(x, y, tangent, off, 0)
            cube("Wall battlement", (px, py, z + 1.47), (.085, .19, .15),
                 "Light Stone", "Outer Walls", tangent, .012)
        # Buttresses read from the ground and stop the wall looking like a smooth ring.
        if i % 2 == 0:
            ox, oy = math.cos(a) * .22, math.sin(a) * .22
            cube("Wall buttress", (x + ox, y + oy, z + .41), (.12, .24, .41),
                 "Dark Stone", "Outer Walls", tangent, .018)
    tower_angles = [math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4]
    for idx, a in enumerate(tower_angles):
        x, y = rx * math.cos(a), ry * math.sin(a)
        crenellated_tower(f"Outer corner tower {idx + 1}", x, y, .50, 1.9, True)


def gatehouse(name, x, y, rot, approach):
    # rot points across the gate opening; the tunnel runs on the local Y axis.
    z = terrain_height(x, y)
    for side in (-1, 1):
        tx, ty = local_point(x, y, rot, side * .72, 0)
        crenellated_tower(name + (" left tower" if side < 0 else " right tower"), tx, ty, .43, 1.78, True)
    cube(name + " upper gatehouse", (x, y, z + 1.35), (.42, .34, .36),
         "Castle Stone", "Towers & Gates", rot, .035)
    cube(name + " gate shadow", (x, y, z + .48), (.34, .025, .50),
         "Deep Shadow", "Towers & Gates", rot, .015)
    # Visible portcullis bars sit just inside the dark arch.
    for side in (-.25, -.125, 0, .125, .25):
        px, py = local_point(x, y, rot, side, -.03)
        cube(name + " portcullis", (px, py, z + .48), (.014, .025, .46),
             "Iron", "Towers & Gates", rot, .004)
    for h in (.25, .48, .71):
        cube(name + " gate crossbar", (x, y, z + h), (.33, .028, .014),
             "Iron", "Towers & Gates", rot, .003)
    cube(name + " heraldic panel", (x, y, z + 1.40), (.16, .035, .24),
         "Royal Purple", "Towers & Gates", rot, .008)
    cyl(name + " banner spear", (*local_point(x, y, rot, 0, .05), z + 1.95), .025, .60,
        "Gold Trim", "Towers & Gates", 8)
    reserve_major(name, x, y, 1.18, "gate")


def gates():
    gatehouse("West Gate", -4.45, 0.0, math.pi / 2, "west")
    gatehouse("East Gate", 4.45, 0.0, math.pi / 2, "east")
    gatehouse("South Gate", 0.0, -3.72, 0.0, "south")


def arched_window(name, x, y, z, rot, scale=.16, group="Central Keep"):
    cube(name + " glass", (x, y, z), (scale * .55, .022, scale),
         "Window Glass", group, rot, .008)
    for side in (-1, 1):
        px, py = local_point(x, y, rot, side * scale * .68, 0)
        cube(name + " stone frame", (px, py, z), (.022, .035, scale * 1.18),
             "Light Stone", group, rot, .006)
    cube(name + " sill", (x, y, z - scale * 1.18), (scale * .78, .04, .025),
         "Light Stone", group, rot, .006)
    # A flattened round top gives the window an arched medieval outline.
    sphere(name + " arch", (x, y, z + scale * .98), (scale * .68, .035, scale * .42),
           "Window Glass", group, 2)


def banner(name, x, y, z, rot, group="Central Keep", height=.72):
    cyl(name + " pole", (*local_point(x, y, rot, 0, -.025), z + height * .55), .018, height * 1.25,
        "Gold Trim", group, 8)
    cube(name + " cloth", (x, y, z + height * .42), (.18, .018, height * .42),
         "Royal Purple", group, rot, .008)
    cone(name + " tassel", (x, y, z - .03), .045, 0, .18,
         "Gold Trim", group, 8)


def central_keep():
    z = terrain_height(0, 0)
    reserve_major("Central Keep", 0, .28, 2.25, "keep")
    # Raised stone plinth and broad stairs.
    cube("Keep foundation", (0, .22, z + .18), (1.62, 1.28, .18),
         "Dark Stone", "Central Keep", 0, .045)
    for i in range(5):
        cube("Keep entrance stair", (0, -1.12 - i * .14, z + .04 + i * .055),
             (.56 + i * .09, .12, .045 + i * .006), "Light Stone", "Central Keep", 0, .015)
    # Main keep is layered rather than a single block.
    cube("Great Keep lower walls", (0, .25, z + 1.02), (1.30, .92, .84),
         "Castle Stone", "Central Keep", 0, .055)
    cube("Great Keep upper hall", (0, .34, z + 2.02), (1.00, .73, .36),
         "Light Stone", "Central Keep", 0, .045)
    roof_mesh("Great Keep blue roof", 0, .34, z + 2.39, 1.16, .90, .72,
              "Blue Slate", "Central Keep", 0)
    # Four tall corner towers anchor the keep.
    for idx, (x, y) in enumerate([(-1.22, -.63), (1.22, -.63), (-1.22, 1.10), (1.22, 1.10)]):
        crenellated_tower(f"Keep corner tower {idx + 1}", x, y, .37, 2.52, True, "Central Keep")
    # Central mage tower is the strongest long-distance landmark.
    cyl("Mage tower octagonal base", (0, .46, z + 2.10), .58, 3.68,
        "Castle Stone", "Central Keep", 12, bevel=.025)
    cyl("Mage tower upper crown", (0, .46, z + 3.88), .66, .28,
        "Light Stone", "Central Keep", 12, bevel=.018)
    for i in range(12):
        a = math.tau * i / 12
        px, py = math.cos(a) * .57, .46 + math.sin(a) * .57
        cube("Mage tower crown battlement", (px, py, z + 4.18), (.08, .08, .17),
             "Light Stone", "Central Keep", a, .010)
    cone("Mage tower grand blue spire", (0, .46, z + 4.78), .82, .025, 1.35,
         "Deep Blue Slate", "Central Keep", 16)
    cyl("Mage tower golden finial", (0, .46, z + 5.66), .040, .48,
        "Gold Trim", "Central Keep", 8)
    cone("Mage tower crystal", (0, .46, z + 6.00), .15, .015, .38,
         "Magic Blue", "Central Keep", 6, math.pi / 6)
    # Keep windows, door, buttresses, and banners.
    for x in (-.76, 0, .76):
        arched_window("Keep front arched window", x, -.69, z + 1.33, 0, .15)
    cube("Great Keep oak door", (0, -.705, z + .54), (.28, .035, .50),
         "Dark Wood", "Central Keep", 0, .025)
    for side in (-1, 1):
        cube("Keep door iron hinge", (side * .16, -.745, z + .55), (.075, .012, .025),
             "Iron", "Central Keep", 0, .005)
        banner("Keep royal banner", side * .92, -.715, z + 1.52, 0)
    for x in (-1.18, 1.18):
        for y in (-.48, .90):
            cube("Keep stone buttress", (x, y, z + .65), (.13, .16, .65),
                 "Dark Stone", "Central Keep", 0, .018)
    for level in (z + 1.40, z + 2.15, z + 3.00):
        for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2):
            px = math.cos(a) * .59
            py = .46 + math.sin(a) * .59
            arched_window("Mage tower window", px, py, level, a + math.pi / 2, .11)


def ward_building(name, x, y, w, d, h, rot=0, roof="Blue Slate", kind="house"):
    z = terrain_height(x, y)
    # The collision footprint follows the building's broad side. Using the
    # diagonal here would falsely report neighboring, rotated houses as touching.
    reserve_major(name, x, y, max(w, d) * .72 + .12, "ward")
    cube(name + " stone foundation", (x, y, z + .11), (w * 1.08, d * 1.08, .11),
         "Dark Stone", "Inner Ward", rot, .025)
    cube(name + " plaster walls", (x, y, z + .22 + h / 2), (w, d, h / 2),
         "Plaster", "Inner Ward", rot, .035)
    # Exposed timber grid gives each ward structure a recognizable facade.
    for side in (-.66, 0, .66):
        px, py = local_point(x, y, rot, side * w, -d - .012)
        cube(name + " front timber", (px, py, z + .22 + h / 2), (.028, .025, h / 2),
             "Dark Wood", "Inner Ward", rot, .006)
    cube(name + " cross beam", (*local_point(x, y, rot, 0, -d - .018), z + .22 + h * .62),
         (w, .025, .035), "Dark Wood", "Inner Ward", rot, .006)
    roof_mesh(name + " roof", x, y, z + .24 + h, w * 1.20, d * 1.17, h * .52,
              roof, "Inner Ward", rot)
    door_x, door_y = local_point(x, y, rot, 0, -d - .028)
    cube(name + " oak door", (door_x, door_y, z + .43), (w * .20, .028, .32),
         "Old Wood", "Inner Ward", rot, .018)
    for side in (-.58, .58):
        wx, wy = local_point(x, y, rot, side * w, -d - .035)
        arched_window(name + " front window", wx, wy, z + .68, rot, min(w, h) * .13, "Inner Ward")
    # Chimney, sign, or forge stack makes silhouettes distinct.
    if kind in ("forge", "kitchen"):
        cx, cy = local_point(x, y, rot, w * .55, d * .25)
        cube(name + " chimney", (cx, cy, z + h + .43), (.12, .12, .52),
             "Dark Stone", "Inner Ward", rot, .018)
    elif kind == "library":
        banner(name + " scholar banner", *local_point(x, y, rot, 0, -d - .05), z + .75, rot,
               "Inner Ward", .55)
    return z


def inner_ward():
    # Buildings hug the inside wall while keeping a broad navigable courtyard around the keep.
    ward_building("Royal Library", -2.72, 1.55, .78, .52, 1.00, -.34, "Blue Slate", "library")
    ward_building("Knight Barracks", 2.72, 1.50, .86, .50, .92, .34, "Blue Slate", "house")
    ward_building("Castle Forge", -2.72, -1.52, .72, .52, .84, .30, "Deep Blue Slate", "forge")
    ward_building("Alchemy House", 2.78, -1.46, .72, .54, .98, -.28, "Blue Slate", "kitchen")
    ward_building("Gate Guard Hall", -3.32, .02, .64, .45, .82, math.pi / 2, "Blue Slate", "house")
    ward_building("Healers Hall", 3.34, .04, .64, .45, .86, math.pi / 2, "Blue Slate", "house")

    z = terrain_height(0, 0)
    # Courtyard paving is a few broad sections, not hundreds of tiny stones.
    cyl("Central courtyard paving", (0, -.38, z + .055), 1.78, .09,
        "Cobblestone", "Inner Ward", 40)
    cyl("Runic fountain basin", (0, -1.16, z + .15), .38, .18,
        "Light Stone", "Inner Ward", 20, bevel=.025)
    cyl("Runic fountain pedestal", (0, -1.16, z + .39), .12, .46,
        "Castle Stone", "Inner Ward", 12)
    sphere("Runic fountain orb", (0, -1.16, z + .72), (.16, .16, .20),
           "Magic Blue", "Inner Ward")
    # A few market stalls leave the rest of the ward open for combat.
    for idx, (x, y, rot) in enumerate([(-1.95, -2.55, .12), (1.95, -2.52, -.14)]):
        for side in (-1, 1):
            px, py = local_point(x, y, rot, side * .42, 0)
            cyl(f"Market stall {idx + 1} post", (px, py, z + .42), .035, .84,
                "Old Wood", "Inner Ward", 8)
        cube(f"Market stall {idx + 1} counter", (x, y, z + .37), (.48, .25, .08),
             "Old Wood", "Inner Ward", rot, .015)
        roof_mesh(f"Market stall {idx + 1} awning", x, y, z + .86, .55, .34, .18,
                  "Royal Purple", "Inner Ward", rot)


def bridge(name, x, y, rot, length=2.0, width=.72):
    z = terrain_height(x, y) + .34
    # Broad supports and segmented deck give the bridge a believable arch profile.
    for i in range(9):
        along = (i - 4) * (length * 2 / 9)
        px, py = local_point(x, y, rot, along, 0)
        rise = .18 * (1 - (abs(i - 4) / 4) ** 1.8)
        cube(name + " deck stone", (px, py, z + rise), (length / 8.8, width, .11),
             "Light Stone", "Roads & Bridges", rot, .020)
    for side in (-1, 1):
        for i in range(5):
            along = (i - 2) * length * .42
            px, py = local_point(x, y, rot, along, side * width)
            cyl(name + " rail post", (px, py, z + .43), .045, .66,
                "Castle Stone", "Roads & Bridges", 8)
        sx, sy = local_point(x, y, rot, 0, side * width)
        cube(name + " stone rail", (sx, sy, z + .58), (length, .055, .10),
             "Castle Stone", "Roads & Bridges", rot, .018)
    reserve_major(name, x, y, max(length, width) + .15, "bridge")


def bridges_and_inner_paths():
    bridge("West River Bridge", -5.85, 0.0, 0, 1.45, .58)
    bridge("South River Bridge", 0.0, -5.65, math.pi / 2, 1.48, .58)
    # A smaller northeastern crossing links the hill road to the city.
    bridge("Northwest Stone Bridge", -4.10, 3.75, -.68, 1.08, .48)
    inner_paths = [
        [(-4.25, 0), (-3.0, 0), (-1.6, -.25), (0, -.48)],
        [(4.25, 0), (3.0, 0), (1.6, -.20), (0, -.48)],
        [(0, -3.65), (0, -2.6), (0, -1.65), (0, -.48)],
        [(-2.5, 2.4), (-1.55, 1.7), (-.8, .9)],
        [(2.5, 2.4), (1.55, 1.7), (.8, .9)],
    ]
    for i, path in enumerate(inner_paths):
        ribbon(f"Castle cobbled path {i + 1}", path, .24, "Cobblestone", z_offset=.075)


def cart(name, x, y, rot=0, broken=False):
    z = terrain_height(x, y)
    cube(name + " bed", (x, y, z + .28), (.46, .25, .10),
         "Old Wood", "Props & Cover", rot, .015)
    for side in (-1, 1):
        px, py = local_point(x, y, rot, 0, side * .29)
        cyl(name + " wheel", (px, py, z + .24), .24, .07,
            "Dark Wood", "Props & Cover", 12, rot=(math.pi / 2, 0, rot))
        cyl(name + " iron wheel rim", (px, py, z + .24), .255, .035,
            "Iron", "Props & Cover", 12, rot=(math.pi / 2, 0, rot))
    for side in (-1, 1):
        px, py = local_point(x, y, rot, .78, side * .10)
        cube(name + " shaft", (px, py, z + .23), (.75, .035, .035),
             "Old Wood", "Props & Cover", rot, .008)
    reserve_major(name, x, y, .72, "cover")


def broken_wall(name, x, y, rot=0, pieces=5):
    z = terrain_height(x, y)
    for i in range(pieces):
        off = (i - (pieces - 1) / 2) * .30
        px, py = local_point(x, y, rot, off, 0)
        h = .28 + .18 * ((i * 7 + pieces) % 3)
        cube(name + " fallen masonry", (px, py, z + h / 2), (.16, .12, h / 2),
             "Castle Stone", "Props & Cover", rot + RNG.uniform(-.08, .08), .018)
    reserve_major(name, x, y, pieces * .18, "cover")


def standing_arch(name, x, y, rot=0):
    z = terrain_height(x, y)
    for side in (-1, 1):
        px, py = local_point(x, y, rot, side * .45, 0)
        cube(name + " pillar", (px, py, z + .65), (.14, .18, .65),
             "Dark Stone", "Props & Cover", rot, .025)
    cube(name + " lintel", (x, y, z + 1.35), (.62, .20, .15),
         "Dark Stone", "Props & Cover", rot, .025)
    reserve_major(name, x, y, .78, "cover")


def tree(name, x, y, scale=1.0, pine=False):
    z = terrain_height(x, y)
    cyl(name + " trunk", (x, y, z + .34 * scale), .075 * scale, .68 * scale,
        "Tree Bark", "Vegetation", 9)
    if pine:
        cone(name + " lower crown", (x, y, z + .82 * scale), .42 * scale, .035,
             .95 * scale, "Pine Needles", "Vegetation", 10)
        cone(name + " upper crown", (x, y, z + 1.27 * scale), .31 * scale, .025,
             .82 * scale, "Pine Needles", "Vegetation", 10)
    else:
        sphere(name + " crown", (x, y, z + .87 * scale),
               (.47 * scale, .42 * scale, .48 * scale), "Leaf", "Vegetation", 2)
        sphere(name + " crown side", (x + .20 * scale, y - .04 * scale, z + .91 * scale),
               (.34 * scale, .31 * scale, .36 * scale), "Leaf", "Vegetation", 2)


def boulder(name, x, y, scale=1.0):
    z = terrain_height(x, y)
    sphere(name, (x, y, z + .24 * scale), (.42 * scale, .34 * scale, .31 * scale),
           "Dark Stone", "Props & Cover", 2)


def protected_space(x, y, radius):
    # Keep clear of the castle, buildings, bridges, roads, and water.
    if math.hypot(x, y) < 5.15:
        return True
    if min(path_distance(x, y, RIVER_PATH), path_distance(x, y, RIVER_BRANCH)) < 1.18 + radius:
        return True
    if any(path_distance(x, y, path) < .62 + radius for path in ROAD_PATHS):
        return True
    if any((x - sx) ** 2 + (y - sy) ** 2 < (sr + radius + .12) ** 2
           for _, sx, sy, sr, _ in MAJOR_SITES):
        return True
    return False


def surrounding_gameplay():
    # Hand-placed cover frames two large open combat fields rather than filling them.
    cart("Western supply wagon", -8.25, -2.15, .18)
    cart("Eastern broken wagon", 8.00, 3.65, -.35, True)
    broken_wall("North ruined wall", 1.7, 6.75, -.18, 7)
    broken_wall("Eastern ruined wall", 7.4, -3.35, .32, 6)
    broken_wall("Western ruined wall", -8.1, 3.9, -.42, 5)
    standing_arch("Ancient northeast arch", 7.35, 5.5, .24)
    standing_arch("Old western arch", -9.2, -4.4, -.34)

    # Deliberately sparse, evenly-spaced perimeter scenery.
    created = 0
    attempts = 0
    while created < 64 and attempts < 1200:
        attempts += 1
        x = RNG.uniform(-11.4, 11.4)
        y = RNG.uniform(-8.5, 8.5)
        # Broad western and eastern arenas remain uncluttered in their centers.
        open_west = ((x + 8.0) / 2.25) ** 2 + ((y + .1) / 2.0) ** 2 < 1
        open_east = ((x - 8.1) / 2.3) ** 2 + ((y - .2) / 2.05) ** 2 < 1
        if open_west or open_east:
            continue
        radius = RNG.uniform(.34, .52)
        if protected_space(x, y, radius) or not reserve_scatter(x, y, radius):
            continue
        if RNG.random() < .64:
            tree(f"Valley tree {created + 1}", x, y, RNG.uniform(.82, 1.35), RNG.random() < .52)
        else:
            boulder(f"Valley boulder {created + 1}", x, y, RNG.uniform(.65, 1.20))
        created += 1

    # One efficient mesh of grass tufts and flowers, kept away from paths and castle.
    verts = []
    faces = []
    for i in range(300):
        x = RNG.uniform(-11.5, 11.5)
        y = RNG.uniform(-8.5, 8.5)
        if protected_space(x, y, .08):
            continue
        z = terrain_height(x, y) + .02
        h = RNG.uniform(.10, .24)
        w = RNG.uniform(.018, .035)
        a = RNG.uniform(0, math.tau)
        right = Vector((math.cos(a), math.sin(a))) * w
        base = len(verts)
        verts.extend([
            (x - right.x, y - right.y, z), (x + right.x, y + right.y, z),
            (x + right.x * .25, y + right.y * .25, z + h),
            (x - right.x * .25, y - right.y * .25, z + h),
        ])
        faces.append((base, base + 1, base + 2, base + 3))
    me = bpy.data.meshes.new("Efficient meadow details mesh")
    me.from_pydata(verts, [], faces)
    o = bpy.data.objects.new("Meadow grass and flowers", me)
    COLS["Vegetation"].objects.link(o)
    o.data.materials.append(M["Flowers"])
    MODEL.append(o)


def validate_clearances():
    # Intentional structural connections (walls/towers/gates) are excluded.
    independent = [s for s in MAJOR_SITES if s[4] in ("ward", "cover")]
    worst = 999.0
    worst_pair = None
    for i, a in enumerate(independent):
        for b in independent[i + 1:]:
            gap = math.hypot(a[1] - b[1], a[2] - b[2]) - a[3] - b[3]
            if gap < worst:
                worst = gap
                worst_pair = (a[0], b[0])
    if worst < .08:
        raise RuntimeError(f"Major object clearance failed: {worst_pair} gap={worst:.3f}")
    scatter_worst = 999.0
    for i, a in enumerate(SCATTER_OCCUPIED):
        for b in SCATTER_OCCUPIED[i + 1:]:
            scatter_worst = min(scatter_worst, math.hypot(a[0] - b[0], a[1] - b[1]) - a[2] - b[2])
    if SCATTER_OCCUPIED and scatter_worst < .09:
        raise RuntimeError(f"Scatter clearance failed: {scatter_worst:.3f}")
    print(f"CLEARANCE VERIFIED major_min={worst:.3f} scatter_min={scatter_worst:.3f} scatter_items={len(SCATTER_OCCUPIED)}")


def export_glb():
    bpy.ops.object.select_all(action="DESELECT")
    for o in MODEL:
        if o and o.name in bpy.context.scene.objects:
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=GLB, export_format="GLB", use_selection=True, export_apply=True,
        export_yup=True, export_materials="EXPORT", export_extras=True,
    )


def setup_scene_and_render():
    bpy.ops.object.camera_add(location=(17.8, -23.8, 16.8))
    cam = bpy.context.object
    cam.name = "Castle Isometric Preview Camera"
    target = Vector((0, 0, 1.05))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 23.8
    bpy.context.scene.camera = cam

    bpy.ops.object.light_add(type="SUN", location=(-8, -10, 18))
    sun = bpy.context.object
    sun.name = "Warm Afternoon Sun"
    sun.data.energy = 3.2
    sun.data.angle = math.radians(7)
    sun.rotation_euler = (math.radians(28), math.radians(-18), math.radians(-32))
    bpy.ops.object.light_add(type="AREA", location=(-5, -8, 13))
    fill = bpy.context.object
    fill.name = "Soft Sky Fill"
    fill.data.energy = 950
    fill.data.shape = "DISK"
    fill.data.size = 9

    world = bpy.context.scene.world or bpy.data.worlds.new("Castle Daylight World")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (.28, .48, .78, 1)
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

    # A second straight-down render is specifically for finding accidental overlaps.
    original_loc = cam.location.copy()
    original_rot = cam.rotation_euler.copy()
    original_scale = cam.data.ortho_scale
    cam.location = (0, 0, 31)
    cam.rotation_euler = (0, 0, 0)
    cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = 25.2
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 1050
    scene.render.filepath = TOPDOWN
    bpy.ops.render.render(write_still=True)
    cam.location = original_loc
    cam.rotation_euler = original_rot
    cam.data.ortho_scale = original_scale
    scene.render.resolution_x = 1500
    scene.render.resolution_y = 1000
    scene.render.filepath = PREVIEW
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)


reset()
materials()
terrain()
rivers_and_roads()
outer_walls()
gates()
central_keep()
inner_ward()
bridges_and_inner_paths()
surrounding_gameplay()
validate_clearances()
export_glb()
setup_scene_and_render()
print(
    f"CREATED {BLEND}\nEXPORTED {GLB}\nRENDERED {PREVIEW}\n"
    f"TOPDOWN {TOPDOWN}\nOBJECTS {len(MODEL)}"
)
