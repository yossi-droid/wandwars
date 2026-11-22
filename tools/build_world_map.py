import bpy
import math
import random
from mathutils import Vector

ROOT = "/Users/michaelcaras/Desktop/new-game"
BLEND = f"{ROOT}/art/wandwars-new-island.blend"
GLB = f"{ROOT}/public/models/wandwars-new-island.glb"
PREVIEW = f"{ROOT}/art/wandwars-new-island-preview.png"
RNG = random.Random(74291)
MODEL = []


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for data in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        pass


def mat(name, color, rough=0.75, metal=0.0, emission=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*color, 1)
    bs.inputs["Roughness"].default_value = rough
    bs.inputs["Metallic"].default_value = metal
    if emission:
        bs.inputs["Emission Color"].default_value = (*emission[0], 1)
        bs.inputs["Emission Strength"].default_value = emission[1]
    # Subtle procedural variation makes the Blender materials read as stone,
    # cloth, soil, bark, and foliage instead of perfectly flat colors.
    if name not in ("purple", "black", "gold", "white"):
        nodes = m.node_tree.nodes
        links = m.node_tree.links
        noise = nodes.new("ShaderNodeTexNoise")
        noise.name = f"{name} fine texture"
        noise.inputs["Scale"].default_value = 7.0 if name in ("grass", "sand", "beach", "rock", "stone") else 4.0
        noise.inputs["Detail"].default_value = 4.0
        noise.inputs["Roughness"].default_value = .72
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.name = f"{name} color variation"
        dark = tuple(max(0, v*.72) for v in color)
        light = tuple(min(1, v*1.18+.015) for v in color)
        ramp.color_ramp.elements[0].color = (*dark, 1)
        ramp.color_ramp.elements[1].color = (*light, 1)
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = .16 if name not in ("water", "river") else .08
        bump.inputs["Distance"].default_value = .08
        links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], bs.inputs["Base Color"])
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bs.inputs["Normal"])
    return m


M = {}


def materials():
    colors = {
        "grass": ((0.20, 0.38, 0.12), .9, 0), "forest": ((0.075, 0.20, 0.07), .95, 0),
        "lightgrass": ((0.34, 0.50, 0.16), .9, 0), "sand": ((0.63, 0.39, 0.16), 1, 0),
        "beach": ((0.74, 0.60, 0.34), 1, 0), "rock": ((0.25, 0.25, 0.23), .95, 0),
        "snow": ((0.88, 0.92, 0.94), .7, 0), "water": ((0.02, 0.28, 0.47), .22, .08),
        "river": ((0.02, 0.46, 0.72), .18, .05), "road": ((0.48, 0.33, 0.18), 1, 0),
        "stone": ((0.42, 0.44, 0.42), .95, 0), "darkstone": ((0.15, 0.16, 0.16), 1, 0),
        "wood": ((0.25, 0.11, 0.045), .9, 0), "plaster": ((0.69, 0.62, 0.46), .9, 0),
        "roofred": ((0.46, 0.09, 0.045), .9, 0), "roofblue": ((0.07, 0.16, 0.35), .7, .05),
        "roofgreen": ((0.08, 0.28, 0.17), .8, 0), "gold": ((0.69, 0.39, 0.06), .35, .65),
        "leaf": ((0.10, 0.29, 0.075), 1, 0), "pine": ((0.035, 0.17, 0.08), 1, 0),
        "cactus": ((0.12, 0.36, 0.16), 1, 0), "purple": ((0.43, 0.04, 0.78), .22, .1),
        "black": ((0.012, 0.012, 0.015), 1, 0), "white": ((.9, .9, .83), .75, 0),
        "glass": ((0.05, 0.28, 0.48), .18, .15), "iron": ((0.10, 0.11, 0.12), .42, .72),
        "flowerblue": ((0.10, 0.30, 0.88), .65, 0), "flowergold": ((0.95, 0.56, 0.06), .65, 0),
        "flowerpink": ((0.77, 0.12, 0.42), .65, 0),
        "crystalground": ((0.16, 0.20, 0.34), .82, .04), "emberground": ((0.47, 0.20, 0.08), .96, 0),
        "moss": ((0.12, 0.31, 0.10), .96, 0), "swamp": ((0.13, 0.20, 0.09), 1, 0),
        "swampwater": ((0.08, 0.20, 0.16), .28, .02), "lava": ((0.95, 0.12, 0.015), .2, 0),
    }
    for n, (c, r, me) in colors.items():
        M[n] = mat(n, c, r, me, ((.55, .08, 1.0), 4.0) if n == "purple" else None)


def reg(o, material=None, name=None):
    if name: o.name = name
    if material:
        o.data.materials.append(M[material] if isinstance(material, str) else material)
    MODEL.append(o)
    return o


def cube(name, loc, scale, material, bevel=0.0, rot=0):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=(0, 0, rot))
    o = reg(bpy.context.object, material, name)
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = o.modifiers.new("Soft edges", "BEVEL"); mod.width = bevel; mod.segments = 2
    return o


def cyl(name, loc, radius, depth, material, vertices=12, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot)
    return reg(bpy.context.object, material, name)


def cone(name, loc, r1, r2, depth, material, vertices=10):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r2, depth=depth, location=loc)
    return reg(bpy.context.object, material, name)


def sphere(name, loc, scale, material):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=loc)
    o = reg(bpy.context.object, material, name); o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o


def curve(name, pts, material, bevel=.035, cyclic=False):
    cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"; cu.resolution_u = 2
    sp = cu.splines.new("BEZIER"); sp.bezier_points.add(len(pts)-1)
    for p, co in zip(sp.bezier_points, pts):
        p.co = co; p.handle_left_type = "AUTO"; p.handle_right_type = "AUTO"
    sp.use_cyclic_u = cyclic; cu.bevel_depth = bevel; cu.bevel_resolution = 2
    return reg(bpy.data.objects.new(name, cu), material, name)


def add_curve_to_scene(o):
    bpy.context.collection.objects.link(o)
    return o


def height(x, y):
    # An irregular oval coastline rather than a rectangular terrain slab.
    edge = math.sqrt((x/7.65)**2 + (y/4.8)**2) + .025*math.sin(x*1.7+y*.8) + .018*math.sin(y*2.6-x*.35)
    coast = max(0, 1 - max(0, edge-.78)/.22)
    rolling = .20*math.sin(x*.92)*math.cos(y*1.18) + .11*math.sin(x*2.0+y*.72)
    forest_hills = .68*math.exp(-((x+4.15)/2.35)**2-((y-1.75)/1.9)**2)
    north = 2.45*math.exp(-((y-3.62)/.82)**2) * math.exp(-((x+1.55)/3.25)**4)
    east = 2.05*math.exp(-((x-4.72)/1.35)**2-((y-.05)/1.45)**2)
    mesas = .72*math.exp(-((x-3.15)/2.9)**2-((y+3.0)/1.45)**2)
    volcano_base = 1.05*math.exp(-((x+.35)/1.18)**2-((y+2.78)/1.05)**2)
    swamp_basin = -.44*math.exp(-((x+4.35)/1.35)**2-((y+3.25)/.92)**2)
    central_valley = -.28*math.exp(-((x+.35)/2.4)**2-((y-.05)/1.65)**2)
    west_cliffs = .48*math.exp(-((x+6.0)/.75)**2-((y+.3)/2.0)**2)
    return (-.18 + (0.46 + rolling + forest_hills + north + east + mesas + volcano_base + swamp_basin + central_valley + west_cliffs)*coast) if edge < 1 else -.52


def terrain():
    nx, ny = 96, 64; verts=[]; faces=[]
    for j in range(ny+1):
        y=-5.25+10.5*j/ny
        for i in range(nx+1):
            x=-8.1+16.2*i/nx; verts.append((x,y,height(x,y)))
    for j in range(ny):
        for i in range(nx):
            a=j*(nx+1)+i; faces.append((a,a+1,a+nx+2,a+nx+1))
    me=bpy.data.meshes.new("Island terrain mesh"); me.from_pydata(verts,[],faces); me.materials.clear()
    for k in ("grass","forest","sand","beach","rock","snow","swamp","emberground","moss"): me.materials.append(M[k])
    o=reg(bpy.data.objects.new("Wizard Royale Island",me)); bpy.context.collection.objects.link(o)
    for p in me.polygons:
        c=p.center; x,y=c.x,c.y; z=sum(me.vertices[v].co.z for v in p.vertices)/4
        edge=math.sqrt((x/7.65)**2+(y/4.8)**2)
        if edge>.84: idx=3
        elif x < -2.75 and y < -2.15: idx=6
        elif y<-1.45 and x>-.1: idx=7 if x<.9 else 2
        elif y>2.55 and z>.92: idx=5 if z>1.35 else 4
        elif x>3.25 and -.9<y<1.65: idx=4
        elif x<-2.25 and y>1.05: idx=8 if x>-4.2 else 1
        else: idx=0
        p.material_index=idx
    bpy.ops.mesh.primitive_plane_add(size=90, location=(0,0,-.42)); ocean=reg(bpy.context.object,"water","Ocean")
    bev=o.modifiers.new("Terrain smoothing","BEVEL"); bev.width=.035; bev.segments=2
    return o


def roof(name, x,y,z,w,d,h,material="roofred",rot=0):
    verts=[(-w,-d,0),(w,-d,0),(w,d,0),(-w,d,0),(0,-d,h),(0,d,h)]
    faces=[(0,1,4),(3,5,2),(0,4,5,3),(1,2,5,4)]
    me=bpy.data.meshes.new(name+" mesh"); me.from_pydata(verts,[],faces)
    o=reg(bpy.data.objects.new(name,me),material,name); bpy.context.collection.objects.link(o)
    o.location=(x,y,z); o.rotation_euler.z=rot
    # Wooden ridge and eave trim gives every roof a constructed silhouette.
    cyl(name+" ridge",(x,y,z+h+.012),.018,d*2.02,"wood",8,rot=(math.pi/2,0,rot))
    right=Vector((math.cos(rot),math.sin(rot)))
    for side in (-1,1):
        p=Vector((x,y))+right*(side*w)
        cube(name+" eave",(p.x,p.y,z+.015),(.022,d*1.02,.025),"wood",.006,rot)
    return o


def house(x,y,s=.22,roofmat="roofred",rot=0,name="House"):
    z=height(x,y)
    cube(name+" foundation",(x,y,z+s*.10),(s*1.08,s*.78,s*.10),"stone",.018,rot)
    cube(name+" walls",(x,y,z+s*.75),(s,s*.72,s*.72),"plaster",.025,rot)
    roof(name+" roof",x,y,z+s*1.42,s*1.22,s*.92,s*.68,roofmat,rot)
    # dark door as slightly raised panel
    dx,dy=math.sin(rot)*s*.73,-math.cos(rot)*s*.73
    cube(name+" door",(x+dx,y+dy,z+s*.47),(s*.22,.018,s*.4),"wood",.01,rot)
    front=Vector((math.sin(rot),-math.cos(rot))); right=Vector((math.cos(rot),math.sin(rot)))
    # Two framed front windows, a side window, timber trim, and chimney.
    for side in (-1,1):
        p=Vector((x,y))+front*(s*.735)+right*(side*s*.55)
        cube(name+" glass",(p.x,p.y,z+s*.82),(s*.13,.015,s*.14),"glass",.008,rot)
        cube(name+" window sill",(p.x,p.y,z+s*.66),(s*.17,.022,s*.025),"wood",.005,rot)
    p=Vector((x,y))+right*(s*1.015)
    cube(name+" side window",(p.x,p.y,z+s*.82),(s*.12,.015,s*.14),"glass",.008,rot+math.pi/2)
    cube(name+" timber beam",(x+dx*1.02,y+dy*1.02,z+s*1.12),(s*.88,.018,s*.035),"wood",.005,rot)
    cp=Vector((x,y))+right*(s*.58)-front*(s*.08)
    cube(name+" chimney",(cp.x,cp.y,z+s*1.78),(s*.10,s*.10,s*.35),"darkstone",.015,rot)


def tree(x,y,s=1,pine=True):
    z=height(x,y)
    cyl("Tree trunk",(x,y,z+.18*s),.045*s,.36*s,"wood",8)
    if pine:
        cone("Pine crown",(x,y,z+.52*s),.24*s,.025*s,.66*s,"pine",9)
        cone("Pine crown",(x,y,z+.78*s),.19*s,.02*s,.56*s,"pine",9)
    else:
        sphere("Tree crown",(x,y,z+.58*s),(.27*s,.25*s,.30*s),"leaf")


def is_open_battle_area(x,y):
    # Three deliberately uncluttered spaces for ranged fights and team battles.
    return any((x-cx)**2+(y-cy)**2 < r*r for cx,cy,r in [(-3.1,-.55,1.15),(1.15,-.15,1.05),(3.05,2.15,.82)])


def mountain(x,y,s=1):
    z=height(x,y)-.08
    cone("Mountain",(x,y,z+.7*s),.62*s,.02,1.4*s,"rock",8)
    cone("Snow cap",(x,y,z+1.25*s),.27*s,.015,.48*s,"snow",8)


def tower(x,y,r=.19,h=.7,roofmat="roofblue",name="Tower"):
    z=height(x,y)
    cyl(name,(x,y,z+h/2),r,h,"stone",12)
    cone(name+" roof",(x,y,z+h+.18),r*1.38,.015,.38,roofmat,10)
    cube(name+" window",(x,y-r-.006,z+h*.62),(r*.18,.012,h*.13),"black")


def castle():
    first=len(MODEL)
    cx,cy=-.55,.10; z=height(cx,cy)
    # circular crenellated city wall
    for i in range(28):
        a=2*math.pi*i/28; x=cx+1.12*math.cos(a); y=cy+.83*math.sin(a)
        wz=height(x,y)
        cube("Castle wall",(x,y,wz+.22),(.20,.085,.25),"stone",.025,a+math.pi/2)
        along=Vector((math.cos(a+math.pi/2),math.sin(a+math.pi/2)))
        for offset in (-.14,0,.14):
            p=Vector((x,y))+along*offset
            cube("Castle battlement",(p.x,p.y,wz+.51),(.042,.09,.075),"stone",.012,a+math.pi/2)
    for i in range(8):
        a=2*math.pi*i/8; tower(cx+1.13*math.cos(a),cy+.84*math.sin(a),.19,.62,"roofblue","Castle turret")
    cube("Central keep",(cx,cy,z+.62),(.43,.36,.62),"stone",.04)
    roof("Keep roof",cx,cy,z+1.20,.52,.45,.42,"roofblue")
    for px in (-.24,0,.24):
        cube("Keep arched window",(cx+px,cy-.365,z+.72),(.055,.014,.13),"glass",.01)
    cube("Keep gate",(cx,cy-.37,z+.23),(.13,.018,.22),"wood",.025)
    for dx,dy in [(-.55,.22),(.52,.20),(-.36,-.34),(.38,-.35)]:
        tower(cx+dx,cy+dy,.15,.70,"roofblue","Inner tower")
    # castle banners
    for dx in (-.25,.25):
        cyl("Banner pole",(cx+dx,cy,z+1.63),.012,.6,"gold",8)
    # Make the central castle a dominant, long-distance landmark.
    for o in MODEL[first:]:
        o.location.x=cx+(o.location.x-cx)*1.62
        o.location.y=cy+(o.location.y-cy)*1.62
        o.scale.x*=1.42; o.scale.y*=1.42; o.scale.z*=1.52


def lighthouse():
    x,y=-6.72,-.65; z=height(x,y)
    cone("Lighthouse",(x,y,z+.48),.20,.14,.92,"white",16)
    cyl("Lighthouse red band",(x,y,z+.46),.205,.14,"roofred",16)
    cyl("Lantern room",(x,y,z+1.00),.18,.20,"gold",12)
    cone("Lighthouse roof",(x,y,z+1.18),.24,.01,.25,"roofred",12)


def bridge(x,y,rot=0):
    z=height(x,y)+.13
    cube("Stone bridge",(x,y,z),(.42,.12,.08),"stone",.035,rot)
    for side in (-1,1):
        dx=-math.sin(rot)*side*.13; dy=math.cos(rot)*side*.13
        cube("Bridge rail",(x+dx,y+dy,z+.10),(.42,.025,.07),"stone",.02,rot)


def windmill(x,y):
    z=height(x,y); tower(x,y,.20,.72,"roofgreen","Windmill tower")
    hub=(x,y-.23,z+.64); cyl("Windmill hub",hub,.06,.10,"wood",12,rot=(math.pi/2,0,0))
    for a in (math.pi/4,3*math.pi/4):
        cube("Windmill blade",hub,(.035,.025,.43),"wood",.01,a)


def cactus(x,y,s=1):
    z=height(x,y); cyl("Cactus",(x,y,z+.22*s),.06*s,.44*s,"cactus",9)
    for side in (-1,1):
        cyl("Cactus arm",(x+side*.09*s,y,z+.27*s),.035*s,.20*s,"cactus",8)


def mesa(x,y,s=1):
    z=height(x,y); cone("Desert mesa",(x,y,z+.24*s),.42*s,.30*s,.48*s,"sand",8)
    cyl("Mesa cap",(x,y,z+.49*s),.34*s,.10*s,"sand",8)


def mine(x,y,s=1):
    z=height(x,y)
    for ox in (-.32,0,.32): cone("Mine crag",(x+ox,y,z+.55*s),.42*s,.02,1.1*s,"rock",7)
    cube("Mine entrance",(x,y-.43,z+.22),(.24,.035,.24),"black",.03)
    for ox in (-.27,.27): cube("Mine support",(x+ox,y-.47,z+.25),(.035,.045,.30),"wood",.012)
    cube("Mine lintel",(x,y-.47,z+.52),(.31,.05,.045),"wood",.012)
    curve_obj=curve("Mine rails",[(x-.12,y-.45,z+.03),(x-.25,y-1.05,height(x-.25,y-1.05)+.04),(x-.45,y-1.65,height(x-.45,y-1.65)+.04)],"darkstone",.018)
    add_curve_to_scene(curve_obj)


def volcano(x,y,s=1):
    """A broad layered volcano with a visible crater and branching lava flows."""
    z=height(x,y)-.18
    cone("Volcano outer cone",(x,y,z+.78*s),1.12*s,.25*s,1.56*s,"darkstone",18)
    cone("Volcano ember slope",(x,y,z+.91*s),.78*s,.21*s,1.18*s,"emberground",18)
    cyl("Volcano crater",(x,y,z+1.48*s),.27*s,.09*s,"black",18)
    cyl("Volcano lava lake",(x,y,z+1.53*s),.20*s,.045*s,"lava",18)
    for i,angle in enumerate((-.15,2.05,4.15)):
        points=[]
        for step in range(5):
            distance=.18*s+step*.22*s
            px=x+math.cos(angle)*distance
            py=y+math.sin(angle)*distance
            points.append((px,py,height(px,py)+.10+i*.004))
        add_curve_to_scene(curve(f"Volcano lava flow {i+1}",points,"lava",.055*s))


def dead_tree(x,y,s=1,rot=0):
    z=height(x,y)
    cyl("Swamp dead trunk",(x,y,z+.30*s),.045*s,.60*s,"wood",7,rot=(0,0,rot))
    for side in (-1,1):
        branch_angle=rot+side*.68
        bx=x+math.cos(branch_angle)*.12*s
        by=y+math.sin(branch_angle)*.12*s
        cyl("Swamp dead branch",(bx,by,z+.53*s),.022*s,.34*s,"wood",6,rot=(0,math.pi/3,branch_angle))


def portal_beacon(name,x,y):
    """One of the five readable destination markers shown in the new map."""
    z=height(x,y)
    cyl(name+" rune base",(x,y,z+.035),.24,.07,"darkstone",20)
    cyl(name+" magic pool",(x,y,z+.085),.18,.025,"purple",20)
    cone(name+" crystal",(x,y,z+.43),.105,.025,.68,"purple",6)
    for i in range(8):
        a=math.tau*i/8
        cube(name+" rune",(x+.25*math.cos(a),y+.25*math.sin(a),z+.075),(.035,.012,.018),"purple",.006,a)
    for i in range(11):
        yy=y-.5-i*.11; xx=x-.02-i*.018
        cube("Railroad tie",(xx,yy,height(xx,yy)+.035),(.22,.025,.018),"wood",.006,-.16)
    curve_obj=curve("Mine rails",[(x+.12,y-.45,z+.03),(x-.01,y-1.05,height(x-.01,y-1.05)+.04),(x-.21,y-1.65,height(x-.21,y-1.65)+.04)],"darkstone",.018)
    add_curve_to_scene(curve_obj)


def water_tower(x,y):
    z=height(x,y)
    for dx,dy in [(-.12,-.12),(.12,-.12),(-.12,.12),(.12,.12)]:
        cyl("Water tower leg",(x+dx,y+dy,z+.33),.018,.66,"wood",6)
    cyl("Water tank",(x,y,z+.72),.24,.34,"wood",14)
    cone("Water tank roof",(x,y,z+.94),.28,.02,.20,"roofred",14)


def boat(x,y):
    z=-.12
    cone("Boat hull",(x,y,z),.22,.06,.65,"wood",6).rotation_euler=(math.pi/2,0,0)
    cyl("Boat mast",(x,y,z+.35),.018,.8,"wood",8)
    # sail triangle
    verts=[(x,y,z+.72),(x,y,z+.15),(x+.42,y,z+.22)]; me=bpy.data.meshes.new("Sail mesh"); me.from_pydata(verts,[],[(0,1,2)])
    o=reg(bpy.data.objects.new("Boat sail",me),"white"); bpy.context.collection.objects.link(o)


def landmarks():
    castle(); lighthouse(); mine(4.72,.18,1.45); mine(5.20,-.48,.92); windmill(2.65,1.65)
    bridge(-1.45,-.28,.15); bridge(-.55,-1.02,-.25); bridge(-2.05,1.55,.35)
    water_tower(3.0,-3.45); water_tower(5.15,-3.65)
    boat(-6.35,-3.15)
    # harbor docks
    for x in (-6.3,-5.85): cube("Harbor dock",(x,-2.50,-.06),(.08,.55,.05),"wood",.015)
    cube("Harbor pier",(-6.08,-2.05,-.06),(.55,.08,.05),"wood",.015)
    for i in range(9):
        x=-6.5+(i%3)*.16; y=-1.92-(i//3)*.14
        if i%2: cyl("Harbor barrel",(x,y,height(x,y)+.09),.065,.18,"wood",10)
        else: cube("Harbor crate",(x,y,height(x,y)+.07),(.07,.07,.07),"wood",.01)
    # houses by region
    settlements=[
      [(-5.8,-.65),(-5.45,-.85),(-5.9,-1.18),(-5.35,-1.35),(-6.2,-1.65),(-5.65,-1.85),(-4.95,-1.65),(-4.7,-1.15)],
      [(1.75,2.15),(2.30,2.45),(3.15,2.72),(3.85,2.32),(4.85,2.65),(5.55,2.15)],
      [(1.85,1.15),(2.25,.75),(2.95,1.02),(3.45,.68)],
      [(2.1,-2.55),(2.85,-2.65),(3.5,-2.92),(4.35,-2.42),(5.05,-2.82),(5.65,-2.40)],
      [(-3.05,1.60),(-3.55,.95),(-2.75,.55)],
    ]
    roofs=["roofred","roofgreen","roofblue"]
    for si, group in enumerate(settlements):
        for i,(x,y) in enumerate(group): house(x,y,.20+RNG.random()*.05,roofs[(i+si)%3],RNG.uniform(-.4,.4),"Village house")
    # farm rows
    for i in range(8):
        cube("Crop row",(1.32+i*.12,1.60,height(1.32+i*.12,1.6)+.035),(.035,.50,.035),"leaf",.012,-.05)
    for side in (-1,1):
        for i in range(9):
            x=1.72+i*.12; y=1.60+side*.58
            cyl("Farm fence post",(x,y,height(x,y)+.10),.018,.20,"wood",6)
        cube("Farm fence rail",(2.20,1.60+side*.58,height(2.20,1.60+side*.58)+.11),(.54,.018,.025),"wood",.008)
    # ruined watchtowers
    tower(6.15,2.72,.18,.58,"roofgreen","Watchtower"); tower(-4.15,2.75,.16,.52,"roofred","Forest lookout")


def scenery():
    # Northwest mountain chain: a layered wall behind the forest, as in the new map.
    for x in [-4.35,-3.75,-3.15,-2.55,-1.95,-1.35,-.75]:
        mountain(x,3.48,.82+RNG.random()*.48)
    for x in [-4.0,-3.4,-2.8,-2.2,-1.6,-1.0]: mountain(x,4.03,.66+RNG.random()*.38)
    # dense northwest forest
    for _ in range(88):
        x=RNG.uniform(-6.7,-2.45); y=RNG.uniform(.75,4.15)
        if ((x+1.7)/2.7)**2+((y-3.5)/1.0)**2 > .75:
            tree(x,y,RNG.uniform(.65,1.25),True)
    # scattered trees in green regions
    for _ in range(34):
        x=RNG.uniform(-4.8,5.9); y=RNG.uniform(-1.25,3.65)
        if math.hypot(x+.55,(y-.1)*1.25)>1.55 and not (x>3.5 and y<1.4) and not is_open_battle_area(x,y):
            tree(x,y,RNG.uniform(.55,1.05),RNG.random()<.55)
    # desert mesas and cacti
    for x,y,s in [(1.1,-3.35,1.1),(1.75,-3.0,.75),(4.05,-2.05,.8),(5.55,-3.25,.65),(6.25,-2.35,.9)]: mesa(x,y,s)
    for _ in range(24):
        x=RNG.uniform(.5,6.7); y=RNG.uniform(-4.45,-1.55); cactus(x,y,RNG.uniform(.6,1.15))
    # Swamp island/peninsula in the southwest.
    swamp_z=height(-4.45,-3.28)
    sphere("Swamp island",(-4.45,-3.28,swamp_z+.03),(1.52,.92,.18),"swamp")
    for px,py,scale in [(-5.15,-3.45,1.25),(-4.75,-3.0,1.45),(-4.25,-3.55,1.15),(-3.8,-3.15,1.30),(-4.55,-3.72,1.0)]:
        dead_tree(px,py,scale,RNG.uniform(-.5,.5))
    for px,py,sx,sy in [(-4.8,-3.32,.34,.19),(-4.2,-3.05,.28,.16),(-3.9,-3.48,.22,.14)]:
        sphere("Swamp pool",(px,py,height(px,py)+.08),(sx,sy,.025),"swampwater")
    for px,py in [(-4.7,-3.55),(-4.05,-3.25)]:
        z=height(px,py)
        cube("Swamp hut",(px,py,z+.18),(.22,.18,.18),"wood",.025,RNG.uniform(-.25,.25))
        cone("Swamp hut roof",(px,py,z+.43),.34,.02,.30,"moss",6)
    for px,py,rot,length in [(-4.75,-3.16,.15,.65),(-4.15,-3.42,-.25,.55)]:
        z=height(px,py)+.14
        cube("Swamp boardwalk",(px,py,z),(length,.10,.035),"wood",.012,rot)

    # A few low coastal rocks separate the swamp from the open sea.
    for px,py,s in [(-5.55,-3.55,.18),(-5.25,-3.88,.14),(-3.65,-3.72,.16)]:
        sphere("Swamp coast rock",(px,py,-.12),(s*1.3,s,s*.65),"rock")


def world_details():
    """Small props that make each biome feel inhabited and hand-built."""
    # Rocky shoreline, mountain scree, and desert stones.
    for _ in range(125):
        a=RNG.uniform(0,math.tau); radius=RNG.uniform(.82,.98)
        x=7.5*radius*math.cos(a); y=4.68*radius*math.sin(a)
        if height(x,y)>-.38:
            s=RNG.uniform(.045,.13)
            sphere("Shoreline rock",(x,y,height(x,y)+s*.35),(s*1.35,s,s*.65),"rock")
    for _ in range(75):
        if RNG.random()<.55:
            x=RNG.uniform(-4.2,.8); y=RNG.uniform(2.75,4.25)
        else:
            x=RNG.uniform(.4,6.2); y=RNG.uniform(-4.0,-1.65)
        s=RNG.uniform(.035,.12)
        sphere("Ground stone",(x,y,height(x,y)+s*.35),(s*1.25,s,s*.72),"rock" if y>0 else "darkstone")

    # Bushes and colorful wildflowers across the grassy center and villages.
    for _ in range(90):
        x=RNG.uniform(-5.2,5.7); y=RNG.uniform(-1.2,3.0)
        if math.hypot(x+.55,(y-.1)*1.2)<1.42 or (x>3.7 and y<1.25): continue
        z=height(x,y); s=RNG.uniform(.07,.15)
        sphere("Low bush",(x,y,z+s*.48),(s,s*.82,s*.62),"leaf")
    flower_mats=("flowerblue","flowergold","flowerpink")
    for _ in range(85):
        x=RNG.uniform(-4.8,4.1); y=RNG.uniform(-1.05,2.9)
        if math.hypot(x+.55,(y-.1)*1.2)<1.3: continue
        z=height(x,y)
        cyl("Flower stem",(x,y,z+.045),.006,.09,"leaf",5)
        sphere("Wildflower",(x,y,z+.095),(.025,.025,.018),RNG.choice(flower_mats))

    # Castle courtyard paving and fountain.
    cx,cy=-.55,.10
    for ring in (.28,.55,.78):
        count=int(ring*32)
        for i in range(count):
            a=math.tau*i/count; x=cx+ring*math.cos(a); y=cy+ring*.72*math.sin(a)
            cube("Courtyard paving",(x,y,height(x,y)+.025),(.055,.042,.018),"stone",.008,a)
    z=height(cx,cy)
    cyl("Castle fountain basin",(cx,cy-.58,z+.08),.18,.08,"stone",16)
    cyl("Castle fountain",(cx,cy-.58,z+.18),.045,.24,"stone",12)
    sphere("Fountain water",(cx,cy-.58,z+.31),(.055,.055,.09),"river")

    # Village wells, signs, log piles, and roadside props.
    for x,y in [(-5.55,-1.25),(2.55,2.18),(2.65,.82),(3.75,-2.65)]:
        z=height(x,y)
        cyl("Village well",(x,y,z+.09),.14,.16,"stone",14)
        for ox in (-.13,.13): cyl("Well post",(x+ox,y,z+.25),.018,.34,"wood",7)
        cube("Well crossbeam",(x,y,z+.41),(.18,.025,.025),"wood",.008)
    for x,y,rot in [(-4.25,-.45,.3),(1.05,1.05,-.3),(3.3,-1.55,.15),(4.0,2.25,-.2)]:
        z=height(x,y); cyl("Road sign post",(x,y,z+.20),.018,.40,"wood",7)
        cube("Road sign",(x,y,z+.34),(.16,.025,.055),"wood",.012,rot)
    for x,y in [(-5.0,-1.0),(2.0,2.38),(4.62,-2.62)]:
        for i in range(5):
            cyl("Stacked log",(x,y+i*.045,height(x,y)+.035+i*.028),.025,.32,"wood",8,rot=(0,math.pi/2,0))

    # Ancient stone circle and broken ruins on the eastern plains.
    rx,ry=5.55,1.55
    for i in range(9):
        a=math.tau*i/9; x=rx+.52*math.cos(a); y=ry+.36*math.sin(a); z=height(x,y)
        h=RNG.uniform(.22,.48)
        cube("Ancient standing stone",(x,y,z+h/2),(.075,.055,h/2),"darkstone",.025,a)
    for x,y,h in [(1.05,-.75,.35),(1.35,-.82,.22),(1.65,-.68,.40)]:
        z=height(x,y); cube("Broken ruin",(x,y,z+h/2),(.10,.10,h/2),"stone",.02,RNG.uniform(-.3,.3))

    # Dock posts and a hanging rope improve the harbor silhouette.
    for x in (-6.3,-5.85):
        for y in (-2.0,-2.45,-2.95): cyl("Dock piling",(x,y,-.01),.035,.55,"wood",8)
    add_curve_to_scene(curve("Harbor rope",[(-6.3,-2.0,.18),(-6.08,-2.08,.12),(-5.85,-2.0,.18)],"wood",.009))


def grass_field():
    """One efficient mesh containing hundreds of crossed grass blades."""
    verts=[]; faces=[]
    for _ in range(520):
        x=RNG.uniform(-6.4,6.4); y=RNG.uniform(-3.9,3.65)
        edge=math.sqrt((x/7.3)**2+(y/4.5)**2)
        if edge>.91 or (y<-1.45 and x>.05) or (x>3.35 and -.95<y<1.4): continue
        if math.hypot(x+.55,(y-.1)*1.25)<1.25: continue
        z=height(x,y)+.018; h=RNG.uniform(.045,.11); w=h*.18; a=RNG.random()*math.tau
        for da in (0,math.pi/2):
            dx=math.cos(a+da)*w; dy=math.sin(a+da)*w; base=len(verts)
            verts.extend([(x-dx,y-dy,z),(x+dx,y+dy,z),(x+dx*.2,y+dy*.2,z+h),(x-dx*.2,y-dy*.2,z+h)])
            faces.append((base,base+1,base+2,base+3))
    me=bpy.data.meshes.new("Detailed grass field mesh"); me.from_pydata(verts,[],faces)
    o=reg(bpy.data.objects.new("Detailed grass fields",me),"lightgrass"); bpy.context.collection.objects.link(o)


def market_stall(x,y,rot=0,color="roofred"):
    z=height(x,y)
    for ox in (-.13,.13):
        p=Vector((x,y))+Vector((math.cos(rot),math.sin(rot)))*ox
        cyl("Market stall post",(p.x,p.y,z+.18),.014,.36,"wood",6)
    cube("Market counter",(x,y,z+.15),(.17,.10,.025),"wood",.008,rot)
    cube("Market canopy",(x,y,z+.38),(.20,.14,.025),color,.015,rot)
    for i in range(5):
        px=x+math.cos(rot)*(i-2)*.055; py=y+math.sin(rot)*(i-2)*.055
        sphere("Market goods",(px,py,z+.19),(.025,.025,.025),"flowergold" if i%2 else "leaf")


def detailed_landscape():
    grass_field()

    # Denser settlements matching the many villages in the reference map.
    extra_houses=[
      (-6.15,-.92,"roofred"),(-5.72,-1.52,"roofblue"),(-5.12,-.72,"roofgreen"),(-4.68,-1.88,"roofred"),
      (1.20,2.48,"roofgreen"),(1.68,2.82,"roofblue"),(2.65,2.86,"roofred"),(3.55,3.15,"roofgreen"),
      (4.25,2.95,"roofblue"),(5.15,2.25,"roofred"),(5.88,1.78,"roofgreen"),
      (.55,.92,"roofred"),(.72,-.05,"roofblue"),(.28,-.55,"roofgreen"),(-1.92,.55,"roofred"),
      (1.52,-2.18,"roofblue"),(2.48,-3.25,"roofgreen"),(3.18,-2.20,"roofred"),(4.02,-3.35,"roofblue"),
      (4.78,-3.18,"roofgreen"),(5.58,-3.32,"roofred"),(6.05,-2.72,"roofblue")]
    for i,(x,y,rmat) in enumerate(extra_houses):
        house(x,y,.17+RNG.random()*.045,rmat,RNG.uniform(-.45,.45),"Detailed cottage")

    # Market squares and village street furniture.
    for x,y,rot,c in [(-5.35,-1.05,.1,"roofred"),(-5.12,-1.15,.1,"roofblue"),(2.25,1.92,-.2,"roofgreen"),(2.48,1.85,-.2,"roofred"),
                      (3.52,-2.45,.25,"roofblue"),(3.75,-2.38,.25,"roofred")]: market_stall(x,y,rot,c)
    for x,y in [(-5.4,-.75),(2.35,2.18),(3.65,-2.68)]:
        z=height(x,y)
        cyl("Village lantern pole",(x,y,z+.27),.013,.54,"iron",7)
        cube("Village lantern",(x,y,z+.56),(.035,.035,.055),"flowergold",.01)

    # Riverbank stones, reeds, and a foaming mountain waterfall.
    banks=[(-.9,3.2),(-1.25,2.45),(-1.38,1.55),(-.95,.75),(-.85,-.55),(-1.65,-1.12),(-2.7,-1.47),(-4.0,-1.7),(-5.2,-2.12)]
    for bx,by in banks:
        for side in (-1,1):
            for j in range(5):
                x=bx+side*(.14+j*.025)+RNG.uniform(-.035,.035); y=by+RNG.uniform(-.16,.16); z=height(x,y)
                if j%2:
                    cyl("River reed",(x,y,z+.075),.009,.15,"leaf",6)
                else:
                    sphere("Riverbank pebble",(x,y,z+.025),(.05,.035,.025),"rock")
    for i in range(16):
        x=-.92+RNG.uniform(-.13,.13); y=3.0+i*.075; z=height(x,y)+.10
        sphere("Waterfall foam",(x,y,z),(.06,.035,.025),"white")

    # Layered mountain ridges and rocky foothills.
    for x,y,s in [(-3.55,3.25,.46),(-2.85,3.12,.52),(-2.15,3.22,.48),(-1.48,3.08,.42),(-.78,3.16,.45),
                  (4.0,.55,.42),(4.45,.78,.38),(5.0,.62,.46),(5.42,.25,.34)]:
        z=height(x,y); cone("Mountain ridge",(x,y,z+.34*s),.38*s,.02,.68*s,"darkstone",7)
    for _ in range(55):
        x=RNG.uniform(-4.0,.4); y=RNG.uniform(2.55,3.35); s=RNG.uniform(.04,.11)
        sphere("Mountain scree",(x,y,height(x,y)+s*.4),(s*1.2,s,s*.75),"rock")

    # Mine carts, ore piles, timber scaffolding, and a crane.
    for x,y in [(4.42,-.92),(5.12,-1.35)]:
        z=height(x,y)
        cube("Mine cart",(x,y,z+.11),(.16,.10,.10),"iron",.018)
        for ox in (-.11,.11):
            cyl("Mine cart wheel",(x+ox,y-.105,z+.055),.045,.025,"darkstone",10,rot=(math.pi/2,0,0))
        for i in range(6): sphere("Ore chunk",(x+RNG.uniform(-.11,.11),y+RNG.uniform(-.06,.06),z+.22),(.035,.03,.04),"purple")
    x,y=4.95,-.05; z=height(x,y)
    for ox in (-.24,.24): cube("Mine scaffold",(x+ox,y,z+.34),(.025,.025,.34),"wood",.008)
    cube("Mine scaffold beam",(x,y,z+.67),(.30,.025,.025),"wood",.008)
    add_curve_to_scene(curve("Mine crane rope",[(x+.22,y,z+.66),(x+.22,y-.18,z+.30)],"iron",.008))

    # Desert camps, wagons, bones, and low stone walls.
    for x,y in [(1.55,-3.65),(4.72,-3.75),(5.95,-2.05)]:
        z=height(x,y); cone("Desert tent",(x,y,z+.16),.22,.01,.32,"roofred",4)
        cyl("Campfire ring",(x+.28,y,z+.025),.10,.035,"darkstone",10)
        for i in range(5):
            a=math.tau*i/5; sphere("Campfire stone",(x+.28+.10*math.cos(a),y+.10*math.sin(a),z+.035),(.035,.03,.025),"rock")
    for x,y in [(2.25,-3.65),(5.15,-2.05)]:
        z=height(x,y); cube("Wooden wagon",(x,y,z+.15),(.22,.12,.10),"wood",.02)
        for ox in (-.16,.16): cyl("Wagon wheel",(x+ox,y-.13,z+.10),.10,.025,"wood",12,rot=(math.pi/2,0,0))

    # A second fishing boat, mooring buoys, and dock ladders.
    boat(-5.55,-3.05)
    for x,y in [(-6.55,-2.75),(-6.0,-3.05),(-5.45,-2.62)]: sphere("Harbor buoy",(x,y,-.08),(.055,.055,.075),"roofred")
    for y in (-2.3,-2.72):
        for i in range(4): cube("Dock ladder rung",(-6.22,y,-.02-i*.07),(.09,.012,.012),"iron",.004)

    # Extra footpaths connect the denser points of interest.
    paths=[
      [(-6.0,-.8),(-5.3,-1.1),(-4.6,-1.7)],[(.2,.75),(1.1,1.55),(2.1,2.25),(3.4,2.8)],
      [(1.1,-.65),(2.0,-1.35),(3.2,-2.3),(4.8,-3.2)],[(3.2,.8),(4.1,1.35),(5.5,1.55)],
      [(-3.8,.9),(-3.1,.45),(-2.1,.25),(-1.5,.1)]]
    for i,pts in enumerate(paths):
        add_curve_to_scene(curve(f"Footpath {i+1}",[(x,y,height(x,y)+.045) for x,y in pts],"road",.032))


def broken_wall(x,y,rot=0,length=.72):
    z=height(x,y)
    for i in range(4):
        along=(i-1.5)*length/4; h=.18+(.12 if i in (1,2) else 0)
        px=x+math.cos(rot)*along; py=y+math.sin(rot)*along
        cube("Broken cover wall",(px,py,z+h/2),(length/9,.09,h/2),"stone",.025,rot)


def cover_wagon(x,y,rot=0):
    z=height(x,y)
    cube("Abandoned wagon",(x,y,z+.18),(.30,.16,.12),"wood",.025,rot)
    right=Vector((-math.sin(rot),math.cos(rot)))
    for side in (-1,1):
        p=Vector((x,y))+right*(side*.18)
        cyl("Wagon wheel",(p.x,p.y,z+.13),.13,.035,"iron",12,rot=(math.pi/2,0,rot))
    front=Vector((math.cos(rot),math.sin(rot)))
    p=Vector((x,y))+front*.48
    cube("Wagon shaft",(p.x,p.y,z+.12),(.35,.025,.025),"wood",.008,rot)


def giant_mushroom(x,y,s=1,color="roofred"):
    z=height(x,y)
    cone("Giant mushroom stem",(x,y,z+.30*s),.10*s,.075*s,.60*s,"white",10)
    sphere("Giant mushroom cap",(x,y,z+.64*s),(.34*s,.34*s,.14*s),color)
    for a in range(5):
        ang=math.tau*a/5
        sphere("Mushroom spot",(x+.18*s*math.cos(ang),y+.18*s*math.sin(ang),z+.75*s),(.035*s,.035*s,.018*s),"white")


def fallen_tree(x,y,rot=0,s=1):
    z=height(x,y)
    cyl("Fallen tree trunk",(x,y,z+.13*s),.11*s,1.15*s,"wood",10,rot=(0,math.pi/2,rot))
    for side in (-1,1):
        p=Vector((x,y))+Vector((math.cos(rot),math.sin(rot)))*(side*.48*s)
        cyl("Fallen tree root",(p.x,p.y,z+.12*s),.055*s,.45*s,"wood",7,rot=(0,math.pi/3,rot+side*.55))


def gameplay_world():
    # MISTWOOD: giant mushrooms, fallen trees, and a ruined forest shrine.
    for x,y,s,c in [(-5.7,1.30,.95,"roofred"),(-5.2,1.75,1.25,"roofblue"),(-4.75,1.18,.82,"roofred"),(-5.85,2.05,.72,"roofblue")]:
        giant_mushroom(x,y,s,c)
    for x,y,r in [(-4.45,.85,.15),(-5.15,2.55,-.45),(-3.85,1.45,.72),(-5.75,.65,-.2)]: fallen_tree(x,y,r,.9)
    broken_wall(-4.85,2.85,.12,.95); broken_wall(-4.15,2.72,-.45,.72)
    for x,y in [(-4.65,2.62),(-4.35,2.95)]:
        z=height(x,y); cyl("Forest shrine pillar",(x,y,z+.43),.12,.86,"moss",10)

    # IRONVEIN MINE: one massive, readable rocky landmark with several tunnels.
    for x,y,s in [(3.75,.78,.78),(4.20,1.08,.92),(4.75,1.02,1.08),(5.30,.78,.86),(5.72,.35,.70)]:
        z=height(x,y)
        cone("Mine mountain ridge",(x,y,z+.52*s),.50*s,.025,1.04*s,"rock",8)
    for x,y in [(4.12,-.08),(4.75,.18),(5.28,-.38)]:
        z=height(x,y)
        cube("Mine tunnel mouth",(x,y-.18,z+.22),(.20,.035,.22),"black",.035)
        for ox in (-.23,.23): cube("Mine tunnel post",(x+ox,y-.20,z+.26),(.035,.04,.28),"wood",.012)
        cube("Mine tunnel lintel",(x,y-.20,z+.53),(.28,.045,.045),"wood",.012)
    broken_wall(3.55,1.55,.3,.85); broken_wall(5.45,1.45,-.25,.85); cover_wagon(4.0,-1.45,.15)

    # EMBER DUNES: a large desert temple plus mesas, wagons, and ruined walls.
    tx,ty=2.75,-3.35; z=height(tx,ty)
    cube("Ember temple base",(tx,ty,z+.18),(.72,.55,.18),"sand",.035)
    for level in range(3):
        cube("Ember temple step",(tx,ty,z+.34+level*.18),(.58-level*.10,.43-level*.08,.09),"emberground",.025)
    for ox in (-.42,.42): cyl("Ember temple pillar",(tx+ox,ty-.30,z+.70),.09,.72,"sand",10)
    cone("Ember beacon",(tx,ty,z+1.16),.18,.01,.55,"roofred",8)
    for x,y,r in [(1.25,-2.65,.1),(1.55,-3.9,-.25),(4.2,-2.55,.35),(5.35,-3.05,-.2)]: broken_wall(x,y,r,.8)
    cover_wagon(1.65,-2.25,-.3); cover_wagon(4.65,-3.65,.25)

    # CINDER CROWN: the southern volcano is visible from every major region.
    volcano(-.38,-2.72,1.18)
    for x,y,s in [(-1.25,-2.58,.22),(.55,-2.45,.20),(-.95,-3.55,.18),(.48,-3.38,.16)]:
        sphere("Volcanic boulder",(x,y,height(x,y)+s*.55),(s*1.3,s,s*.85),"darkstone")

    # ARCANE HEARTLAND and coastal approaches: larger cover with open gaps.
    for x,y,r in [(-2.15,-.85,.1),(-1.85,.95,-.2),(.75,1.35,.45),(1.8,.55,-.4),(2.05,-1.15,.2)]: broken_wall(x,y,r,.75)
    cover_wagon(-2.25,.45,.15); cover_wagon(1.95,1.25,-.35)
    for x,y,s in [(-3.75,-1.65,.18),(-2.1,-1.55,.22),(.25,-1.35,.20),(2.0,.15,.24),(3.0,-1.25,.20),(5.8,1.85,.26)]:
        sphere("Battlefield boulder",(x,y,height(x,y)+s*.55),(s*1.3,s,s*.8),"rock")

    # Wide river crossings: large bridges and obvious stepping stones.
    bridge(-3.45,-1.55,.10); bridge(-5.0,-2.05,-.18)
    for cx,cy,rot in [(-1.18,.92,.15),(-2.45,.52,-.35)]:
        across=Vector((-math.sin(rot),math.cos(rot)))
        for i in range(-3,4):
            p=Vector((cx,cy))+across*(i*.14)
            sphere("River stepping stone",(p.x,p.y,height(p.x,p.y)+.10),(.13,.10,.055),"stone")


def expand_and_emphasize():
    """Spread locations 2.4x apart without making ordinary props oversized."""
    factor=2.4
    for o in MODEL:
        if o.type=="CURVE":
            for sp in o.data.splines:
                for p in sp.bezier_points:
                    p.co.x*=factor; p.co.y*=factor
        elif o.name.startswith("Wizard Royale Island") or o.name.startswith("Boat sail"):
            for v in o.data.vertices:
                v.co.x*=factor; v.co.y*=factor
        elif o.name != "Ocean":
            o.location.x*=factor; o.location.y*=factor

        # Important silhouettes stay readable from across the expanded map.
        if o.name.startswith(("Lighthouse","Windmill","Watchtower","Forest lookout","Mine crag","Mine entrance","Ember temple","Ember beacon")):
            o.scale.x*=1.28; o.scale.y*=1.28; o.scale.z*=1.35


def paths_and_water():
    river_xy=[(-.75,4.55),(-.95,3.4),(-1.55,2.30),(-1.25,1.25),(-.65,.25),(-1.0,-.75),(-2.15,-1.38),(-3.5,-1.55),(-5.0,-2.05),(-6.6,-2.5)]
    river=[(x,y,height(x,y)+.075) for x,y in river_xy]
    add_curve_to_scene(curve("Main river",river,"river",.34))
    # Separate natural banks make the broad river read as part of the terrain.
    for side in (-1,1):
        bank=[(x,y+side*.22,height(x,y+side*.22)+.06) for x,y in river_xy]
        add_curve_to_scene(curve("Natural river bank",bank,"moss" if side>0 else "rock",.055))
    branch_xy=[(-1.3,1.25),(-2.45,.55),(-3.8,.10),(-5.3,-.3)]
    add_curve_to_scene(curve("River branch",[(x,y,height(x,y)+.07) for x,y in branch_xy],"river",.22))
    # northeast lake
    sphere("Enchanted lake",(4.85,3.15,height(4.85,3.15)+.02),(.75,.47,.035),"river")
    road_xy=[
      [(-5.9,-1.1),(-4.2,-.5),(-2.4,-.1),(-1.55,.05)],
      [(-.1,.4),(1.2,1.1),(2.6,1.65),(4.4,2.4),(5.8,2.25)],
      [(-.25,-.45),(1.0,-1.35),(2.2,-2.4),(3.4,-3.0),(5.6,-2.6)],
      [(2.65,1.65),(3.2,.5),(4.45,-.4),(4.9,-1.6)],
    ]
    road_xy.extend([
      [(-6.0,-1.1),(-5.2,.1),(-4.4,1.4),(-3.2,2.1),(-2.1,1.4),(-1.2,.3)],
      [(-.4,.1),(.7,.7),(1.8,1.8),(3.2,2.7),(4.8,2.5),(5.8,1.7)],
      [(.2,-.5),(1.0,-1.6),(2.0,-2.6),(3.2,-3.3),(4.8,-3.0),(5.8,-2.3)]])
    for i,pts in enumerate(road_xy): add_curve_to_scene(curve(f"Winding road {i+1}",[(x,y,height(x,y)+.075) for x,y in pts],"road",.095))
    # The shrinking purple storm is intentionally created by game code, not Blender.


def labels():
    # Exactly five destination beacons, placed to match the new reference map.
    for name,x,y in [
        ("Mistwood Portal",-2.55,1.45),
        ("Castle East Portal",1.55,-.15),
        ("Cinder Portal",.85,-1.65),
        ("Swamp Portal",-3.35,-3.18),
        ("Dune Portal",3.85,-3.45),
    ]:
        portal_beacon(name,x,y)


def camera_and_render():
    bpy.ops.object.camera_add(location=(25.5,-33.0,25.0)); cam=bpy.context.object; cam.name="Map Preview Camera"
    target=Vector((0,0,.45)); cam.rotation_euler=(target-cam.location).to_track_quat("-Z","Y").to_euler(); cam.data.type="ORTHO"; cam.data.ortho_scale=42.0
    bpy.context.scene.camera=cam
    bpy.ops.object.light_add(type="SUN", location=(-4,-6,12)); sun=bpy.context.object; sun.data.energy=3.0; sun.rotation_euler=(math.radians(28),math.radians(-18),math.radians(-28))
    bpy.ops.object.light_add(type="AREA", location=(-4,-3,10)); bpy.context.object.data.energy=1100; bpy.context.object.data.shape="DISK"; bpy.context.object.data.size=8
    world=bpy.context.scene.world or bpy.data.worlds.new("Daylight World"); bpy.context.scene.world=world; world.use_nodes=True
    world.node_tree.nodes["Background"].inputs["Color"].default_value=(.32,.52,.82,1); world.node_tree.nodes["Background"].inputs["Strength"].default_value=.65
    scene=bpy.context.scene; scene.render.engine="BLENDER_EEVEE"; scene.render.resolution_x=1400; scene.render.resolution_y=900; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG"; scene.render.filepath=PREVIEW; scene.render.film_transparent=False
    scene.view_settings.look="AgX - Medium High Contrast"
    scene.render.image_settings.color_mode="RGBA"
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    bpy.ops.render.render(write_still=True)


def export_glb():
    bpy.ops.object.select_all(action="DESELECT")
    for o in MODEL:
        if o and o.name in bpy.context.scene.objects: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=GLB, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_materials="EXPORT", export_extras=True)


reset(); materials(); terrain(); paths_and_water(); scenery(); landmarks(); gameplay_world(); labels(); expand_and_emphasize(); export_glb(); camera_and_render()
print(f"CREATED {BLEND}\nEXPORTED {GLB}\nRENDERED {PREVIEW}\nOBJECTS {len(MODEL)}")
