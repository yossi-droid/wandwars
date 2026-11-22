import bpy, math, os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "art")
OUT = os.path.join(ROOT, "public", "models", "items")
os.makedirs(OUT, exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

def mat(name, color, metal=0.0, rough=0.45, emission=None, strength=0.0):
    m=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color=(*color,1); m.use_nodes=True
    b=m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value=(*color,1)
    b.inputs["Metallic"].default_value=metal; b.inputs["Roughness"].default_value=rough
    if emission:
        b.inputs["Emission Color"].default_value=(*emission,1)
        b.inputs["Emission Strength"].default_value=strength
    return m

GOLD=mat("Gold",(0.85,0.38,0.04),.85,.2,(1,.2,.01),1.2)
SILVER=mat("Silver",(.58,.64,.74),.9,.2)
PAPER=mat("Aged Paper",(.72,.53,.30),0,.72)
VIOLET=mat("Violet Rune",(.42,.02,.9),.2,.18,(.55,.02,1),4)
BLUE=mat("Mana Blue",(.02,.18,.9),.35,.16,(0,.25,1),3.4)
CYAN=mat("Crystal Cyan",(.03,.7,1),.2,.12,(0,.7,1),3)
GREEN=mat("Healing Green",(.04,.58,.08),.1,.2,(.04,1,.08),3)
RED=mat("Calamity Red",(.55,.03,.01),.2,.22,(1,.05,.01),4)
ORANGE=mat("Element Orange",(.95,.2,.01),.2,.2,(1,.1,.01),3)
BLACK=mat("Rune Stone",(.02,.025,.06),.05,.8)
GLASS_BLUE=mat("Potion Blue",(.02,.25,.95),.15,.12,(0,.25,1),2)
GLASS_CLEAR=mat("Fairy Glass",(.25,.8,1),.1,.1,(.4,.15,1),2)
CAKE=mat("Golden Cake",(.98,.5,.02),0,.34,(1,.14,.01),.6)
LEAF=mat("Leaves",(.03,.45,.06),0,.6,(.03,.3,.01),.5)

def add(o, m, parent=None, bevel=0):
    if m: o.data.materials.append(m)
    if bevel:
        mod=o.modifiers.new("Soft bevel","BEVEL"); mod.width=bevel; mod.segments=3
    if parent:
        o.parent = parent
    return o

def root(name, loc):
    o=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(o); o.location=loc; return o

def cube(name, loc, scale, m, parent=None):
    bpy.ops.mesh.primitive_cube_add(location=loc); o=bpy.context.object; o.name=name; o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); return add(o,m,parent,.03)

def sphere(name, loc, scale, m, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, location=loc)
    o=bpy.context.object; o.name=name; o.scale=scale; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); return add(o,m,parent)

def ico(name, loc, scale, m, parent=None, rot=(0,0,0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=loc,rotation=rot)
    o=bpy.context.object; o.name=name; o.scale=scale; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); return add(o,m,parent)

def cyl(name, loc, r, depth, m, parent=None, verts=24, rot=(0,0,0), scale=(1,1,1)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=r,depth=depth,location=loc,rotation=rot)
    o=bpy.context.object; o.name=name; o.scale=scale; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); return add(o,m,parent,.02)

def cone(name, loc, r1, r2, depth, m, parent=None, verts=16, rot=(0,0,0), scale=(1,1,1)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts,radius1=r1,radius2=r2,depth=depth,location=loc,rotation=rot)
    o=bpy.context.object; o.name=name; o.scale=scale; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); return add(o,m,parent,.02)

def torus(name, loc, major, minor, m, parent=None, rot=(0,0,0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=28,minor_segments=8,location=loc,rotation=rot)
    return add(bpy.context.object,m,parent)

def potion(name, glass, gem, loc):
    r=root(name,loc); sphere("Bottle",(0,0,.62),(.68,.58,.72),glass,r)
    cyl("Neck",(0,0,1.38),.25,.42,glass,r); torus("NeckGold",(0,0,1.2),.3,.05,GOLD,r)
    cone("Cork",(0,0,1.7),.26,.2,.34,PAPER,r,12); torus("Base",(0,0,.1),.55,.06,GOLD,r)
    ico("ShieldGem",(0,-.58,.65),(.2,.04,.26),gem,r,(math.pi/2,0,0)); return r

def crystals(name, m, loc):
    r=root(name,loc)
    specs=[(-.7,0,.35,.35,.8),(-.35,0,.3,.4,1.05),(0,0,.4,.52,1.5),(.4,0,.28,.4,1.0),(.75,0,.24,.3,.7)]
    for i,(x,y,z,w,h) in enumerate(specs): ico("Shard_%02d"%i,(x,y,z),(w,.34,h),m,r,(0.1*i,.25,0))
    return r

def cake(loc):
    r=root("Golden_Wizard_Cake",loc); cyl("Cake",(0,0,.52),.9,.75,CAKE,r,40); torus("Plate",(0,0,.1),.92,.1,GOLD,r)
    torus("Frosting",(0,0,.92),.78,.15,CAKE,r)
    for i in range(8):
        a=math.tau*i/8; sphere("Drip",(math.cos(a)*.8,math.sin(a)*.8,.78),(.12,.12,.25),CAKE,r)
    cone("Wizard_Hat",(0,0,1.55),.32,.02,.82,BLUE,r,24); torus("HatBand",(0,0,1.28),.27,.05,GOLD,r); return r

def leaves(loc):
    r=root("Healing_Leaves",loc)
    for i,a in enumerate((-.6,-.2,.2,.6)): cone("Leaf_%02d"%i,(math.cos(a)*.3,0,.55),.25,.02,1.2,LEAF,r,8,rot=(0,a,0),scale=(1,.18,1))
    cyl("Stem",(0,0,.18),.1,.5,LEAF,r); torus("Rope",(0,0,.28),.2,.06,PAPER,r); return r

def scroll(name, seal, loc):
    r=root(name,loc); cyl("Scroll",(0,0,0),.45,1.6,PAPER,r,32,rot=(0,math.pi/2,0))
    for x in (-.8,.8): cyl("Roll",(x,0,0),.3,.2,PAPER,r,24,rot=(0,math.pi/2,0)); torus("Band",(x,0,0),.33,.045,GOLD,r,rot=(0,math.pi/2,0))
    torus("Seal",(0,-.47,0),.28,.06,seal,r,rot=(math.pi/2,0,0)); ico("SealGem",(0,-.54,0),(.16,.04,.16),seal,r,(math.pi/2,0,0)); return r

def rune(name, frame, loc):
    r=root(name,loc); cyl("RuneBody",(0,0,0),.82,.22,BLACK,r,8,rot=(math.pi/2,0,0)); torus("Frame",(0,-.14,0),.78,.09,frame,r,rot=(math.pi/2,0,0))
    for i in range(8):
        a=math.tau*i/8; cone("Star_%02d"%i,(math.cos(a)*.46,-.2,math.sin(a)*.46),.14,0,.55,VIOLET,r,4,rot=(math.pi/2,a,0))
    ico("Core",(0,-.3,0),(.14,.04,.14),VIOLET,r,(math.pi/2,0,0)); return r

def mana(name, m, loc, count=3, crystals=False):
    r=root(name,loc)
    for i in range(count):
        a=math.tau*i/count; p=(math.cos(a)*.38,0,.45+math.sin(a)*.25)
        ico("Mana_%02d"%i,p,(.3,.3,.48) if crystals else (.36,.36,.36),m,r,(0,i*.5,0))
        torus("Ring_%02d"%i,p,.4,.03,GOLD if crystals else CYAN,r,rot=(math.pi/2,0,a))
    return r

assets=[]
assets += [crystals("Catalyst_Shards",VIOLET,(-8,0,0)),potion("Great_Protection_Potion",GLASS_BLUE,BLUE,(-4,0,0)),cake((0,0,0)),potion("Fairy_Fizz",GLASS_CLEAR,VIOLET,(4,0,0)),potion("Small_Protection_Potion",GLASS_BLUE,CYAN,(8,0,0)),leaves((-8,4,0)),scroll("Tier_I_Attack_Scroll",VIOLET,(-4,4,0)),scroll("Tier_II_Attack_Scroll",BLUE,(0,4,0)),mana("Elemental_Essences",ORANGE,(4,4,0),3,True),mana("Burst_Runes",GOLD,(8,4,0),3,True),mana("Cosmic_Orbs",BLUE,(-8,8,0)),mana("Calamity_Cores",RED,(-4,8,0),2)]
for i,(n,m) in enumerate([("Common_Rune",SILVER),("Rare_Rune",GREEN),("Super_Rare_Rune",BLUE),("Epic_Rune",VIOLET),("Legendary_Rune",GOLD)]):
    assets.append(rune(n,m,(i*4-8,8,0)))

cube("DisplayGround",(0,0,-.8),(11,10,.2),BLACK)
bpy.ops.object.light_add(type="AREA",location=(0,-7,14)); bpy.context.object.data.energy=1700; bpy.context.object.data.size=12
bpy.ops.object.light_add(type="AREA",location=(0,5,7)); bpy.context.object.data.energy=850; bpy.context.object.data.color=(.2,.2,1); bpy.context.object.data.size=10
bpy.ops.object.camera_add(location=(0,-30,23)); cam=bpy.context.object; cam.data.lens=48; cam.rotation_euler=(Vector((0,4,0))-cam.location).to_track_quat("-Z","Y").to_euler(); bpy.context.scene.camera=cam
scene=bpy.context.scene; scene.render.engine="BLENDER_EEVEE"; scene.render.resolution_x=1200; scene.render.resolution_y=900; scene.render.resolution_percentage=100; scene.render.image_settings.file_format="PNG"; scene.render.filepath=os.path.join(ART,"magic-items-pack-preview.png"); scene.world.color=(.003,.001,.015)

def export(o):
    bpy.ops.object.select_all(action="DESELECT")
    for x in [o]+list(o.children_recursive): x.select_set(True)
    bpy.context.view_layer.objects.active=o
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,o.name.lower()+".glb"),export_format="GLB",use_selection=True,export_apply=True)

for a in assets: export(a)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ART,"magic-items-pack.blend"))
bpy.ops.render.render(write_still=True)
print("Built",len(assets),"magic item models")
