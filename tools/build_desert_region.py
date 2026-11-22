import bpy
import math
import random
from mathutils import Vector

ROOT = "/Users/michaelcaras/Desktop/new-game"
BLEND = f"{ROOT}/art/desert-region-detailed.blend"
GLB = f"{ROOT}/public/models/desert-region-detailed.glb"
PREVIEW = f"{ROOT}/art/desert-region-detailed-preview.png"
TOPDOWN = f"{ROOT}/art/desert-region-topdown-preview.png"
RNG = random.Random(918273)
MODEL = []
M = {}
COLS = {}


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for c in list(bpy.data.collections):
        if c.name != "Collection": bpy.data.collections.remove(c)
    base = bpy.data.collections.get("Collection")
    if base: base.name = "Desert Region"
    for name in ["Terrain", "Mesas & Cliffs", "Frontier Town", "Ruins & Camps", "Roads", "Vegetation", "Gameplay Cover"]:
        c = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c); COLS[name] = c


def material(name, color, rough=.85, metal=0, emission=None, scale=5):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    nodes=m.node_tree.nodes; links=m.node_tree.links; bs=nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value=(*color,1); bs.inputs["Roughness"].default_value=rough; bs.inputs["Metallic"].default_value=metal
    if emission:
        bs.inputs["Emission Color"].default_value=(*emission[0],1); bs.inputs["Emission Strength"].default_value=emission[1]
    if name not in ("Window Glass","Void","Ember Crystal"):
        noise=nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value=scale; noise.inputs["Detail"].default_value=5; noise.inputs["Roughness"].default_value=.72
        ramp=nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color=(*(v*.70 for v in color),1)
        ramp.color_ramp.elements[1].color=(*(min(1,v*1.22+.02) for v in color),1)
        bump=nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value=.20; bump.inputs["Distance"].default_value=.10
        links.new(noise.outputs["Fac"],ramp.inputs["Fac"]); links.new(ramp.outputs["Color"],bs.inputs["Base Color"])
        links.new(noise.outputs["Fac"],bump.inputs["Height"]); links.new(bump.outputs["Normal"],bs.inputs["Normal"])
    M[name]=m


def materials():
    material("Pale Sand",(.66,.42,.19),.98,scale=7)
    material("Red Sand",(.52,.20,.075),.98,scale=8)
    material("Sandstone",(.54,.27,.105),.95,scale=4)
    material("Light Sandstone",(.72,.47,.22),.95,scale=4)
    material("Cliff Shadow",(.25,.115,.055),1,scale=6)
    material("Road Dirt",(.38,.20,.09),1,scale=10)
    material("Old Wood",(.25,.105,.035),.92,scale=6)
    material("Dark Wood",(.12,.045,.018),.96,scale=7)
    material("Adobe",(.66,.43,.24),.96,scale=5)
    material("Roof Rust",(.40,.10,.035),.78,.12,scale=5)
    material("Copper",(.43,.19,.07),.35,.72,scale=4)
    material("Iron",(.08,.075,.07),.48,.72,scale=5)
    material("Window Glass",(.025,.18,.26),.15,.12)
    material("Void",(.008,.005,.004),1)
    material("Cactus",(.15,.31,.105),.96,scale=8)
    material("Dry Grass",(.52,.39,.12),1,scale=10)
    material("Canvas",(.68,.52,.30),.95,scale=4)
    material("Bone",(.72,.65,.47),.93,scale=5)
    material("Oasis Water",(.025,.32,.48),.12,.05,scale=3)
    material("Ember Crystal",(.80,.12,.025),.2,.08,((1,.045,.005),5))
    material("Magic Blue",(.06,.28,.85),.24,.06,((.05,.20,1),3))


def move(o, group):
    for c in list(o.users_collection): c.objects.unlink(o)
    COLS[group].objects.link(o)


def reg(o, mat=None, name=None, group="Gameplay Cover"):
    if name: o.name=name
    if mat: o.data.materials.append(M[mat])
    move(o,group); MODEL.append(o); return o


def cube(name,loc,scale,mat,group="Gameplay Cover",rot=0,bevel=.02):
    bpy.ops.mesh.primitive_cube_add(location=loc,rotation=(0,0,rot)); o=reg(bpy.context.object,mat,name,group); o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel: mod=o.modifiers.new("Weathered edges","BEVEL"); mod.width=bevel; mod.segments=2
    return o


def cyl(name,loc,radius,depth,mat,group="Gameplay Cover",vertices=12,rot=(0,0,0),bevel=0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc,rotation=rot)
    o=reg(bpy.context.object,mat,name,group)
    if bevel: mod=o.modifiers.new("Worn rim","BEVEL"); mod.width=bevel; mod.segments=2
    return o


def cone(name,loc,r1,r2,depth,mat,group="Gameplay Cover",vertices=10,rot=0):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r1,radius2=r2,depth=depth,location=loc,rotation=(0,0,rot))
    return reg(bpy.context.object,mat,name,group)


def sphere(name,loc,scale,mat,group="Gameplay Cover",sub=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=1,location=loc); o=reg(bpy.context.object,mat,name,group); o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); return o


def curve(name,pts,mat,bevel,group="Roads",cyclic=False):
    cu=bpy.data.curves.new(name,"CURVE"); cu.dimensions="3D"; cu.resolution_u=3; cu.bevel_depth=bevel; cu.bevel_resolution=2
    sp=cu.splines.new("BEZIER"); sp.bezier_points.add(len(pts)-1)
    for p,co in zip(sp.bezier_points,pts): p.co=co; p.handle_left_type="AUTO"; p.handle_right_type="AUTO"
    sp.use_cyclic_u=cyclic; o=bpy.data.objects.new(name,cu); COLS[group].objects.link(o); o.data.materials.append(M[mat]); MODEL.append(o); return o


def road_ribbon(name,path,width=.45,mat="Road Dirt",group="Roads",z_offset=.035):
    # Chaikin subdivision turns a few control points into a smooth flat road.
    smooth=[Vector((x,y)) for x,y in path]
    for _ in range(3):
        refined=[smooth[0]]
        for a,b in zip(smooth,smooth[1:]):
            refined.extend((a*.75+b*.25,a*.25+b*.75))
        refined.append(smooth[-1]); smooth=refined
    vs=[]; fs=[]
    for i,p in enumerate(smooth):
        before=smooth[max(0,i-1)]; after=smooth[min(len(smooth)-1,i+1)]
        tangent=(after-before).normalized(); side=Vector((-tangent.y,tangent.x))*width
        z=terrain_height(p.x,p.y)+z_offset
        vs.extend(((p.x-side.x,p.y-side.y,z),(p.x+side.x,p.y+side.y,z)))
    for i in range(len(smooth)-1):
        a=i*2; fs.append((a,a+1,a+3,a+2))
    me=bpy.data.meshes.new(name+" mesh"); me.from_pydata(vs,[],fs)
    o=bpy.data.objects.new(name,me); COLS[group].objects.link(o); o.data.materials.append(M[mat]); MODEL.append(o)
    return o


def raw_terrain_height(x,y):
    dunes=.16*math.sin(x*.55+y*.20)+.10*math.sin(x*1.25-y*.43)+.07*math.cos(y*1.8)
    high_north=.55*math.exp(-((y-6.7)/1.6)**2)
    east_plateau=.65*math.exp(-((x-9.6)/1.8)**2-((y-2.0)/4.4)**2)
    west_rise=.35*math.exp(-((x+9.8)/1.3)**2)
    arroyo=-.42*math.exp(-((y-(.24*x-1.0))/.52)**2)
    valley=-.28*math.exp(-((x+1.2)/2.8)**2-((y+1.1)/2.0)**2)
    western_river=-.58*math.exp(-((x-(-10.15-.20*math.sin(y*.65)))/.62)**2)
    return .10+dunes+high_north+east_plateau+west_rise+arroyo+valley+western_river


BUILDING_SITES=[
    (.55,-3.15,1.45),(4.20,-2.00,1.25),(-2.55,-2.70,1.20),(2.05,-6.10,1.45),
    (6.15,-4.00,1.20),(-3.55,-5.75,1.50),(-6.00,-3.80,1.05),(4.80,-7.00,1.05),
    (8.00,-2.30,1.05),(-.75,-7.15,1.05),(10.50,-.80,1.05),(9.30,-7.00,1.10),
    (-1.20,-5.30,.75),(7.20,-6.80,.65),(-4.50,-1.20,.60),(3.20,-4.00,.60)
]
CAMP_SITES=[(10.35,-2.95,1.0),(9.00,-4.65,1.0),(11.20,-5.10,1.0)]
STATIC_COVER_SITES=[
    (-7.15,-2.55,1.0),(7.45,-.65,1.0),(-8.8,.1,1.0),
    (-6.2,-2.0,.9),(3.9,4.65,.9),(8.6,.15,.9),
    (-6.85,.65,1.25),(-7.25,1.05,.85),(-7.7,-.5,.75),
    (-6.4,-5.85,1.35),(6.9,-7.45,1.35),(7.0,0,1.35)
]
RESERVED_SITES=BUILDING_SITES+CAMP_SITES+STATIC_COVER_SITES+[
    (-4.75,1.85,1.80),(.35,2.85,1.70),(5.35,.95,1.90),
    (-6.85,.65,1.25),(-10.12,.75,1.45),(3.20,-4.00,.75)
]
ROAD_PATHS=[
    [(-10.15,.75),(-8.4,.70),(-6.2,.55),(-3.8,-.35),(-1.0,-2.1),(1.8,-3.6),(4.3,-3.2),(7.2,-2.0),(9.3,-1.55)],
    [(-7.8,-5.0),(-4.7,-4.2),(-1.2,-3.7),(2.0,-4.1),(5.3,-4.5),(8.0,-3.2)],
    [(-6.8,1.0),(-5.8,2.4),(-3.0,3.5),(-1.2,3.9),(1.8,3.8),(4.0,2.6),(6.8,2.0),(8.2,1.2)],
    [(2.0,-4.0),(2.2,-1.3),(2.1,.7),(2.8,2.0),(3.8,4.0),(4.8,6.5)]
]
SCATTER_OCCUPIED=[]


def is_reserved_space(x,y,extra=0):
    return any((x-sx)**2+(y-sy)**2 < (r+extra)**2 for sx,sy,r in RESERVED_SITES)


def segment_distance(px,py,a,b):
    ax,ay=a; bx,by=b; dx=bx-ax; dy=by-ay
    if dx*dx+dy*dy==0: return math.hypot(px-ax,py-ay)
    t=max(0,min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)))
    return math.hypot(px-(ax+t*dx),py-(ay+t*dy))


def is_near_road(x,y,clearance):
    return any(segment_distance(x,y,a,b)<clearance for path in ROAD_PATHS for a,b in zip(path,path[1:]))


def is_in_western_river(x,y,clearance=.95):
    center=-10.15-.20*math.sin(y*.65)
    return abs(x-center)<clearance


def reserve_scatter(x,y,radius):
    if any((x-ox)**2+(y-oy)**2 < (radius+other+.08)**2 for ox,oy,other in SCATTER_OCCUPIED): return False
    SCATTER_OCCUPIED.append((x,y,radius)); return True


def terrain_height(x,y):
    h=raw_terrain_height(x,y)
    # Smooth, level construction pads prevent foundations and porches from
    # entering sloped terrain. The blend at each edge avoids visible plateaus.
    for sx,sy,r in BUILDING_SITES:
        d=math.hypot(x-sx,y-sy)
        if d<r:
            t=1-d/r; t=t*t*(3-2*t)
            h=h*(1-t)+raw_terrain_height(sx,sy)*t
    return h


def is_open_battle_basin(x,y):
    # A broad central arena plus a smaller western clearing. Roads may cross it,
    # but decorative objects and hard cover are kept around the perimeter.
    central=((x+.25)/4.35)**2+((y+.10)/2.45)**2 < 1
    western=((x+8.0)/2.0)**2+((y-2.8)/1.45)**2 < 1
    return central or western


def terrain():
    nx,ny=150,104; verts=[]; faces=[]
    for j in range(ny+1):
        y=-8+16*j/ny
        for i in range(nx+1):
            x=-12+24*i/nx; verts.append((x,y,terrain_height(x,y)))
    for j in range(ny):
        for i in range(nx):
            a=j*(nx+1)+i; faces.append((a,a+1,a+nx+2,a+nx+1))
    me=bpy.data.meshes.new("Desert terrain mesh"); me.from_pydata(verts,[],faces)
    for n in ("Pale Sand","Red Sand","Sandstone","Cliff Shadow","Road Dirt"): me.materials.append(M[n])
    o=bpy.data.objects.new("Detailed Ember Dunes Terrain",me); COLS["Terrain"].objects.link(o); MODEL.append(o)
    for p in me.polygons:
        c=p.center; x,y=c.x,c.y; z=sum(me.vertices[v].co.z for v in p.vertices)/len(p.vertices)
        if x>7.7 or y>6.1: p.material_index=2 if z>.45 else 1
        elif y<-.2 and x>-.5: p.material_index=1
        elif abs(y-(.24*x-1.0))<.65: p.material_index=4
        elif x<-9.0: p.material_index=3
        else: p.material_index=0
    bev=o.modifiers.new("Eroded terrain","BEVEL"); bev.width=.035; bev.segments=2


def irregular_layer(name,x,y,z,radius,height,mat,seed,verts=14):
    rr=random.Random(seed); vs=[]; fs=[]
    rings=[(0,1.0),(.45,.90),(1,.78)]
    radii=[radius*(1+rr.uniform(-.12,.12)) for _ in range(verts)]
    for rz,mul in rings:
        for i in range(verts):
            a=math.tau*i/verts; r=radii[i]*mul*(1+rr.uniform(-.045,.045)); vs.append((x+r*math.cos(a),y+r*math.sin(a),z+height*rz))
    for ring in range(2):
        for i in range(verts):
            a=ring*verts+i; b=ring*verts+(i+1)%verts; c=(ring+1)*verts+(i+1)%verts; d=(ring+1)*verts+i; fs.append((a,b,c,d))
    fs.append(tuple(range(2*verts,3*verts))); me=bpy.data.meshes.new(name+" mesh"); me.from_pydata(vs,[],fs)
    o=bpy.data.objects.new(name,me); COLS["Mesas & Cliffs"].objects.link(o); o.data.materials.append(M[mat]); MODEL.append(o); return o


def mesa(name,x,y,r=1.5,h=2.4,seed=1):
    z=terrain_height(x,y)
    irregular_layer(name+" lower strata",x,y,z,r,h*.42,"Cliff Shadow",seed)
    irregular_layer(name+" middle strata",x,y,z+h*.35,r*.84,h*.40,"Sandstone",seed+1)
    irregular_layer(name+" sunlit crown",x,y,z+h*.69,r*.62,h*.31,"Light Sandstone",seed+2)
    # Smaller eroded needles make each mesa unique from long range.
    rr=random.Random(seed+10)
    for i in range(3):
        a=rr.random()*math.tau; d=rr.uniform(.15,r*.38); sr=rr.uniform(.18,.34)*r
        irregular_layer(name+" rock needle",x+math.cos(a)*d,y+math.sin(a)*d,z+h*.90,sr,h*rr.uniform(.35,.62),"Sandstone",seed+20+i,9)


def cliffs_and_mesas():
    # Three enormous landmark pillars dominate the desert, matching the map.
    # Their different heights and silhouettes make them easy navigation points.
    mesa("Western Great Rock Pillar",-4.75,1.85,1.28,4.20,101)
    mesa("Central Great Rock Pillar",.35,2.85,1.16,3.75,202)
    mesa("Eastern Great Rock Pillar",5.35,.95,1.32,4.45,303)
    mesa("Western Butte",-7.1,3.9,1.05,1.80,404)
    # Northern and eastern cliff walls frame the region without closing it off.
    for i,(x,y,r,h) in enumerate([(-9.4,6.5,1.0,1.5),(-6.8,6.8,1.25,1.8),(-4.2,6.7,.9,1.4),(7.8,5.3,1.1,1.7),(9.5,3.8,1.35,2.1),(10.1,1.5,1.25,1.9)]):
        irregular_layer("Boundary cliff",x,y,terrain_height(x,y),r,h,"Sandstone",500+i)


def roof_mesh(name,x,y,z,w,d,h,mat,group,rot=0):
    vs=[(-w,-d,0),(w,-d,0),(w,d,0),(-w,d,0),(0,-d,h),(0,d,h)]; fs=[(0,1,4),(1,2,5,4),(2,3,5),(3,0,4,5)]
    me=bpy.data.meshes.new(name+" mesh"); me.from_pydata(vs,[],fs); o=bpy.data.objects.new(name,me); COLS[group].objects.link(o); o.data.materials.append(M[mat]); o.location=(x,y,z); o.rotation_euler.z=rot; MODEL.append(o)
    cyl(name+" ridge",(x,y,z+h+.02),.035,d*2.05,"Dark Wood",group,8,rot=(math.pi/2,0,rot))


def frontier_building(name,x,y,w=.72,d=.55,h=.90,rot=0,roof="Roof Rust",sign=True):
    group="Frontier Town"; z=terrain_height(x,y); front=Vector((math.sin(rot),-math.cos(rot))); right=Vector((math.cos(rot),math.sin(rot)))
    cube(name+" stone foundation",(x,y,z+.16),(w*1.12,d*1.12,.16),"Sandstone",group,rot,.035)
    cube(name+" adobe walls",(x,y,z+.20+h/2),(w,d,h/2),"Adobe",group,rot,.035)
    roof_mesh(name+" roof",x,y,z+h+.20,w*1.12,d*1.12,.40,roof,group,rot)
    # Porch, steps, awning, posts, door, windows, and timber framing.
    fp=Vector((x,y))+front*(d+.23)
    cube(name+" porch",(fp.x,fp.y,z+.21),(w*1.04,.24,.06),"Old Wood",group,rot,.015)
    cube(name+" porch step",(fp.x+front.x*.24,fp.y+front.y*.24,z+.10),(w*.65,.10,.10),"Old Wood",group,rot,.012)
    cube(name+" door",(x+front.x*(d+.015),y+front.y*(d+.015),z+.58),(.19,.025,.38),"Dark Wood",group,rot,.015)
    for side in (-1,1):
        p=Vector((x,y))+front*(d+.025)+right*(side*w*.56)
        cube(name+" window",(p.x,p.y,z+.70),(.16,.018,.19),"Window Glass",group,rot,.012)
        cube(name+" window trim",(p.x,p.y,z+.48),(.20,.030,.025),"Dark Wood",group,rot,.006)
        pp=Vector((x,y))+front*(d+.18)+right*(side*w*.88)
        cyl(name+" porch post",(pp.x,pp.y,z+.58),.035,.74,"Old Wood",group,8)
    cube(name+" awning",(x+front.x*(d+.17),y+front.y*(d+.17),z+.94),(w*1.04,.28,.045),roof,group,rot,.02)
    if sign:
        cube(name+" signboard",(x+front.x*(d+.06),y+front.y*(d+.06),z+h+.33),(w*.52,.035,.16),"Dark Wood",group,rot,.018)
        for i in range(4):
            p=Vector((x,y))+front*(d+.10)+right*((i-1.5)*w*.22)
            cube(name+" sign lettering",(p.x,p.y,z+h+.33),(.045,.018,.075),"Bone",group,rot,.006)
    cp=Vector((x,y))-right*(w*.62)-front*(d*.15)
    cube(name+" chimney",(cp.x,cp.y,z+h+.58),(.13,.13,.45),"Cliff Shadow",group,rot,.025)


def water_tower(x,y,scale=1):
    z=terrain_height(x,y); g="Frontier Town"
    for dx,dy in [(-.26,-.26),(.26,-.26),(-.26,.26),(.26,.26)]:
        cyl("Water tower timber leg",(x+dx*scale,y+dy*scale,z+.70*scale),.045*scale,1.4*scale,"Dark Wood",g,8)
    cyl("Water tower tank",(x,y,z+1.52*scale),.48*scale,.70*scale,"Old Wood",g,18,bevel=.035)
    for i in range(5): cyl("Tank iron band",(x,y,z+(1.28+i*.13)*scale),.495*scale,.027*scale,"Iron",g,18)
    cone("Water tower roof",(x,y,z+1.98*scale),.57*scale,.02,.34*scale,"Roof Rust",g,16)


def wind_pump(x,y):
    z=terrain_height(x,y); g="Frontier Town"
    for ox in (-.22,.22): cube("Wind pump leg",(x+ox,y,z+.78),(.025,.025,.78),"Iron",g,0,.005)
    cube("Wind pump crossbar",(x,y,z+1.48),(.28,.03,.03),"Iron",g,0,.005)
    hub=(x,y-.06,z+1.58); cyl("Wind pump hub",hub,.10,.08,"Copper",g,12,rot=(math.pi/2,0,0))
    for i in range(12):
        a=math.tau*i/12; bx=x+math.cos(a)*.38; bz=z+1.58+math.sin(a)*.38
        cube("Wind pump blade",(bx,y-.11,bz),(.18,.025,.035),"Iron",g,a,.006)


def town():
    frontier_building("Ember Saloon",.55,-3.15,1.0,.66,1.15,0,"Roof Rust")
    frontier_building("Potion General Store",4.20,-2.00,.82,.58,.95,.10,"Copper")
    frontier_building("Sheriff and Bounty Office",-2.55,-2.70,.76,.56,.92,-.08,"Roof Rust")
    frontier_building("Desert Inn",2.05,-6.10,.98,.68,1.12,-.04,"Roof Rust")
    frontier_building("Blacksmith",6.15,-4.00,.78,.60,.90,.15,"Copper")
    frontier_building("Stable",-3.55,-5.75,1.05,.66,.78,-.08,"Old Wood",False)
    for x,y,r in [(-6.00,-3.80,.1),(4.80,-7.00,-.15),(8.00,-2.30,.12),(-.75,-7.15,-.1)]: frontier_building("Frontier home",x,y,.58,.46,.72,r,"Roof Rust",False)
    frontier_building("Eastern trail cabin",10.50,-.80,.62,.48,.76,-.12,"Old Wood",False)
    frontier_building("Southeast homestead",9.30,-7.00,.66,.50,.80,.10,"Roof Rust",False)
    water_tower(-1.20,-5.30,1.05); water_tower(7.20,-6.80,.80); wind_pump(-4.50,-1.20)
    # Town well and central market shade.
    z=terrain_height(3.20,-4.00); cyl("Town well",(3.20,-4.00,z+.16),.34,.30,"Sandstone","Frontier Town",18,bevel=.03)
    for ox in (-.30,.30): cyl("Well timber",(3.20+ox,-4.00,z+.58),.035,.90,"Dark Wood","Frontier Town",8)
    cube("Well beam",(3.20,-4.00,z+1.0),(.40,.04,.04),"Dark Wood","Frontier Town",0,.01)


def cactus(x,y,s=1):
    z=terrain_height(x,y); g="Vegetation"
    cyl("Saguaro trunk",(x,y,z+.52*s),.095*s,1.04*s,"Cactus",g,10,bevel=.018*s)
    for side,h in [(-1,.66),(1,.82)]:
        cyl("Saguaro arm",(x+side*.22*s,y,z+h*s),.065*s,.42*s,"Cactus",g,9)
        cyl("Saguaro branch",(x+side*.12*s,y,z+(h-.17)*s),.065*s,.28*s,"Cactus",g,9,rot=(0,math.pi/2,0))
    sphere("Cactus flower",(x,y,z+1.06*s),(.06*s,.06*s,.035*s),"Ember Crystal",g)


def wagon(x,y,rot=0,broken=False):
    z=terrain_height(x,y); g="Gameplay Cover"
    cube("Broken wagon" if broken else "Covered wagon",(x,y,z+.32),(.62,.34,.24),"Old Wood",g,rot,.035)
    right=Vector((-math.sin(rot),math.cos(rot)))
    for side in (-1,1):
        p=Vector((x,y))+right*(side*.40)
        cyl("Wagon wheel",(p.x,p.y,z+.25),.29,.08,"Iron",g,14,rot=(math.pi/2,0,rot))
        for i in range(8):
            a=math.tau*i/8; cube("Wheel spoke",(p.x+.13*math.cos(a),p.y,z+.25+.13*math.sin(a)),(.14,.025,.018),"Old Wood",g,a,.004)
    front=Vector((math.cos(rot),math.sin(rot))); p=Vector((x,y))+front*1.0
    cube("Wagon shafts",(p.x,p.y,z+.22),(.78,.035,.035),"Dark Wood",g,rot,.008)
    if not broken:
        for i in range(5):
            a=math.pi*i/4; px=x+right.x*math.cos(a)*.34; py=y+right.y*math.cos(a)*.34
            cyl("Wagon canopy rib",(px,py,z+.66+math.sin(a)*.34),.025,.72,"Iron",g,8,rot=(math.pi/2,0,rot))


def broken_wall(x,y,rot=0,n=6):
    z=terrain_height(x,y); g="Ruins & Camps"
    for i in range(n):
        p=(i-(n-1)/2)*.25; h=.30+RNG.random()*.55
        cube("Ruined adobe wall",(x+math.cos(rot)*p,y+math.sin(rot)*p,z+h/2),(.14,.18,h/2),"Adobe",g,rot,.035)


def ruins_and_camps():
    # Small weathered ruins sit beside the western road, as in the map.
    broken_wall(-7.25,1.05,.35,5); broken_wall(-7.7,-.5,-.2,4)
    x,y=-6.85,.65; z=terrain_height(x,y); g="Ruins & Camps"
    for ox in (-.42,.42): cyl("Weathered ruin pillar",(x+ox,y,z+.55),.13,1.10,"Light Sandstone",g,10,bevel=.025)
    cube("Weathered ruin lintel",(x,y,z+1.06),(.56,.15,.13),"Sandstone",g,0,.03)
    # Caravan tents belong on the southeastern edge of the reference desert.
    for tx,ty,rot in [(10.35,-2.95,.2),(9.00,-4.65,-.25),(11.20,-5.10,.1)]:
        z=terrain_height(tx,ty); cone("Canvas caravan tent",(tx,ty,z+.52),.72,.03,1.04,"Canvas",g,4,rot)
        cube("Tent bedroll",(tx+.45,ty,z+.10),(.34,.18,.10),"Roof Rust",g,rot,.015)
    fx,fy=10.00,-4.00; fz=terrain_height(fx,fy)
    for i in range(10):
        a=math.tau*i/10; sphere("Campfire ring stone",(fx+.36*math.cos(a),fy+.36*math.sin(a),fz+.08),(.11,.09,.07),"Cliff Shadow",g)
    cone("Campfire ember",(fx,fy,fz+.25),.20,.02,.45,"Ember Crystal",g,7)


def western_river_and_bridge():
    # The reference desert meets the main river along its western border.
    river=[(-10.45,7.8),(-10.0,5.8),(-10.35,3.6),(-9.95,1.2),(-10.28,-1.2),(-9.92,-3.6),(-10.2,-7.7)]
    road_ribbon("Western border river",river,.72,"Oasis Water","Terrain",.12)
    # Natural rock banks follow both sides without filling the crossing.
    for side in (-1,1):
        bank=[(x+side*.78,y,terrain_height(x+side*.78,y)+.10) for x,y in river]
        curve("Western riverbank",bank,"Sandstone",.075,"Terrain")
    # Main stone-and-timber bridge at the same western entrance shown on the map.
    x,y=-10.12,.75; z=terrain_height(x,y)+.32
    cube("Western river bridge deck",(x,y,z),(1.15,.48,.12),"Old Wood","Roads",0,.03)
    for side in (-1,1):
        cube("Western bridge rail",(x,y+side*.50,z+.28),(1.15,.045,.22),"Sandstone","Roads",0,.025)
        for i in range(6): cyl("Bridge post",(x-1.0+i*.40,y+side*.50,z+.40),.045,.52,"Dark Wood","Roads",8)
    # A second informal stepping-stone crossing south of the bridge.
    for i in range(-4,5):
        px=-10.15+i*.24; py=-2.55+math.sin(i*.8)*.10
        sphere("River stepping stone",(px,py,terrain_height(px,py)+.22),(.20,.16,.09),"Sandstone","Roads")


def roads_and_cover():
    # Broad winding roads and two parallel ruts on the busiest route.
    for i,path in enumerate(ROAD_PATHS): road_ribbon(f"Main desert road {i+1}",path,.38 if i else .52)
    main=ROAD_PATHS[0]
    for side in (-1,1): curve("Wagon rut",[(x,y+side*.27,terrain_height(x,y+side*.27)+.045) for x,y in main],"Cliff Shadow",.018)

    # Cacti are clustered near roads and around mesas, leaving large combat lanes open.
    for _ in range(68):
        x=RNG.uniform(-10.5,10.2); y=RNG.uniform(-6.8,6.2)
        s=RNG.uniform(.65,1.35)
        if ((x-1.5)**2+(y+3.8)**2<8 or is_open_battle_basin(x,y) or is_reserved_space(x,y,.45)
                or is_near_road(x,y,.62) or is_in_western_river(x,y) or not reserve_scatter(x,y,.38*s)): continue
        cactus(x,y,s)
    # Medium rocks are cover, not tiny decoration.
    for _ in range(95):
        x=RNG.uniform(-10.8,10.5); y=RNG.uniform(-6.8,6.5)
        s=RNG.uniform(.16,.48)
        if ((x-1.8)**2+(y+3.8)**2<7 or is_open_battle_basin(x,y) or is_reserved_space(x,y,.38)
                or is_near_road(x,y,.58+s) or is_in_western_river(x,y,.9+s) or not reserve_scatter(x,y,1.38*s)): continue
        sphere("Desert cover boulder",(x,y,terrain_height(x,y)+s*.55),(s*1.35,s,s*.78),"Sandstone","Gameplay Cover")
    wagon(-7.15,-2.55,.15); wagon(7.45,-.65,-.28,True); wagon(-8.8,.1,.38,True)
    for x,y,r in [(-6.2,-2.0,.15),(3.9,4.65,-.35),(8.6,.15,.2)]: broken_wall(x,y,r,5)
    # Fence lines around town and mine create additional chest-high cover.
    for x0,y0,rot,count in [(-6.4,-5.85,.03,5),(6.9,-7.45,-.03,5),(7.0,.0,.12,5)]:
        for i in range(count):
            x=x0+math.cos(rot)*i*.48; y=y0+math.sin(rot)*i*.48; z=terrain_height(x,y)
            cyl("Fence post",(x,y,z+.34),.035,.68,"Dark Wood","Gameplay Cover",7)
        mid=(count-1)*.48/2; mx=x0+math.cos(rot)*mid; my=y0+math.sin(rot)*mid
        cube("Fence rail",(mx,my,terrain_height(mx,my)+.42),(count*.25,.035,.035),"Dark Wood","Gameplay Cover",rot,.008)


def dry_grass_mesh():
    vs=[]; fs=[]
    for _ in range(620):
        x=RNG.uniform(-11.2,11.2); y=RNG.uniform(-7.2,7.2)
        if ((x-1.8)**2+(y+3.8)**2<8 or is_open_battle_basin(x,y) or is_reserved_space(x,y,.22)
                or is_near_road(x,y,.25) or is_in_western_river(x,y,.75)
                or any((x-ox)**2+(y-oy)**2 < (other+.10)**2 for ox,oy,other in SCATTER_OCCUPIED)): continue
        z=terrain_height(x,y)+.02; h=RNG.uniform(.06,.17); w=.018
        a=RNG.random()*math.tau; dx=math.cos(a)*w; dy=math.sin(a)*w; b=len(vs)
        vs.extend([(x-dx,y-dy,z),(x+dx,y+dy,z),(x,y,z+h)]); fs.append((b,b+1,b+2))
    me=bpy.data.meshes.new("Dry grass scatter mesh"); me.from_pydata(vs,[],fs); o=bpy.data.objects.new("Optimized dry grass patches",me)
    COLS["Vegetation"].objects.link(o); o.data.materials.append(M["Dry Grass"]); MODEL.append(o)


def export_glb():
    bpy.ops.object.select_all(action="DESELECT")
    for o in MODEL:
        if o.name in bpy.context.scene.objects: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=GLB,export_format="GLB",use_selection=True,export_apply=True,export_yup=True,export_materials="EXPORT",export_extras=True)


def validate_clearances():
    major=BUILDING_SITES+CAMP_SITES
    minimum=999
    for i,a in enumerate(major):
        for b in major[i+1:]:
            gap=math.hypot(a[0]-b[0],a[1]-b[1])-a[2]-b[2]
            minimum=min(minimum,gap)
            if gap<0: raise RuntimeError(f"Major footprint overlap at {a} and {b}: {gap:.3f}")
    for i,a in enumerate(SCATTER_OCCUPIED):
        for b in SCATTER_OCCUPIED[i+1:]:
            gap=math.hypot(a[0]-b[0],a[1]-b[1])-a[2]-b[2]
            if gap<.075: raise RuntimeError(f"Scatter overlap at {a} and {b}: {gap:.3f}")
    print(f"CLEARANCE VERIFIED major_min={minimum:.3f} scatter_items={len(SCATTER_OCCUPIED)}")


def render():
    bpy.ops.object.camera_add(location=(20,-24,19)); cam=bpy.context.object; cam.name="Desert Region Preview Camera"
    target=Vector((0,-.2,.65)); cam.rotation_euler=(target-cam.location).to_track_quat("-Z","Y").to_euler(); cam.data.type="ORTHO"; cam.data.ortho_scale=29
    bpy.context.scene.camera=cam
    bpy.ops.object.light_add(type="SUN",location=(-10,-12,20)); sun=bpy.context.object; sun.data.energy=3.2; sun.rotation_euler=(math.radians(27),math.radians(-20),math.radians(-32))
    bpy.ops.object.light_add(type="AREA",location=(-5,-4,16)); bpy.context.object.data.energy=1250; bpy.context.object.data.size=12
    world=bpy.context.scene.world or bpy.data.worlds.new("Desert Daylight"); bpy.context.scene.world=world; world.use_nodes=True
    world.node_tree.nodes["Background"].inputs["Color"].default_value=(.42,.59,.80,1); world.node_tree.nodes["Background"].inputs["Strength"].default_value=.72
    scene=bpy.context.scene; scene.render.engine="BLENDER_EEVEE"; scene.render.resolution_x=1500; scene.render.resolution_y=1000; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG"; scene.render.filepath=PREVIEW; scene.view_settings.look="AgX - Medium High Contrast"
    bpy.ops.wm.save_as_mainfile(filepath=BLEND); bpy.ops.render.render(write_still=True)
    # A true top-down verification render makes footprint overlaps obvious.
    cam.location=(0,0,34); cam.rotation_euler=(0,0,0); cam.data.ortho_scale=28
    scene.render.filepath=TOPDOWN; bpy.ops.render.render(write_still=True)


reset(); materials(); terrain(); cliffs_and_mesas(); western_river_and_bridge(); roads_and_cover(); town(); ruins_and_camps(); dry_grass_mesh(); validate_clearances(); export_glb(); render()
print(f"CREATED {BLEND}\nEXPORTED {GLB}\nRENDERED {PREVIEW}\nTOPDOWN {TOPDOWN}\nOBJECTS {len(MODEL)}")
