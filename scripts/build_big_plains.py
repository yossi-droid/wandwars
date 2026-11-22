import bpy, math, random
from mathutils import Vector
from pathlib import Path
ROOT=Path('/Users/michaelcaras/Desktop/new-game');rng=random.Random(72)
col=bpy.data.collections.new('Plains — Great Greenfields');bpy.context.scene.collection.children.link(col)
def mat(n,c):
 m=bpy.data.materials.new(n);m.diffuse_color=(*c,1);m.use_nodes=True;m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*c,1);return m
grass=[mat('Meadow grass '+str(i),c) for i,c in enumerate([(.36,.53,.15),(.39,.56,.18),(.42,.58,.2),(.37,.54,.17)])]
wood=mat('Plains oak wood',(.28,.14,.06));leaf=mat('Plains oak foliage',(.2,.38,.08));rock=mat('Plains weathered stone',(.42,.44,.35));dirt=mat('Plains worn paths',(.53,.37,.2));cream=mat('Windmill plaster',(.78,.72,.53));roof=mat('Farm red roof',(.38,.15,.08));cloth=mat('Windmill canvas',(.9,.83,.63))
def link(o,n,m):
 o.name=n
 for c in list(o.users_collection):c.objects.unlink(o)
 col.objects.link(o);o.data.materials.append(m);return o
def cube(n,p,s,m):
 bpy.ops.mesh.primitive_cube_add(size=1,location=p);o=link(bpy.context.object,n,m);o.scale=s;return o
def ico(n,p,s,m):
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1,location=p);o=link(bpy.context.object,n,m);o.scale=s;return o
def cyl(n,p,r,d,m):
 bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=r,depth=d,location=p);return link(bpy.context.object,n,m)
def height(x,y):
 fade=min(1,max(0,(y-10.25)/5))
 return .32+fade*(.28+.38*math.sin(x*.14)*math.sin(y*.18)+1.25*math.exp(-((x+26)**2+(y-33)**2)/75)+.9*math.exp(-((x-1)**2+(y-32)**2)/45))
# 45 by 30: more than three times the castle region's footprint.
verts=[(x,y,height(x,y)) for y in [10.25+j*.5 for j in range(61)] for x in [-36+i*.5 for i in range(91)]]
faces=[(j*91+i,j*91+i+1,(j+1)*91+i+1,(j+1)*91+i) for j in range(60) for i in range(90)]
m=bpy.data.meshes.new('Rolling plains mesh');m.from_pydata(verts,[],faces);m.update();o=bpy.data.objects.new('Great Greenfields — 45m x 30m',m);col.objects.link(o)
for material in grass:m.materials.append(material)
for p in m.polygons:p.material_index=rng.randrange(4);p.use_smooth=True
# Earth skirts keep the map tile substantial when viewed obliquely.
for a,b in [((-36,10.25),(-36,40.25)),((-36,40.25),(9,40.25)),((9,40.25),(9,10.25))]:
 mesh=bpy.data.meshes.new('Meadow edge');mesh.from_pydata([(a[0],a[1],height(*a)),(b[0],b[1],height(*b)),(b[0],b[1],-.45),(a[0],a[1],-.45)],[],[(0,1,2,3)]);ob=bpy.data.objects.new('Plains soil edge',mesh);col.objects.link(ob);mesh.materials.append(dirt)
paths=[[(-12,10.25),(-12,15),(-17,21),(-14,28),(-10,35),(-7,40)], [(-35,19),(-27,20),(-17,21),(-7,23),(2,20),(9,18)]]
def road(points):
 vv=[]
 for a,b in zip(points,points[1:]):
  for i in range(12):
   t=i/12;x=a[0]*(1-t)+b[0]*t;y=a[1]*(1-t)+b[1]*t;dx=b[0]-a[0];dy=b[1]-a[1];l=math.hypot(dx,dy)
   for side in [-1,1]:
    xx=x+side*dy/l*.48;yy=y-side*dx/l*.48;vv.append((xx,yy,height(xx,yy)+.035))
 mm=bpy.data.meshes.new('Path');mm.from_pydata(vv,[],[(2*i,2*i+1,2*i+3,2*i+2) for i in range(len(vv)//2-1)]);ob=bpy.data.objects.new('Meandering plains path',mm);col.objects.link(ob);mm.materials.append(dirt)
for p in paths:road(p)
# Small groves mostly around the perimeter leave the central meadow open.
for cx,cy in [(-32,30),(-27,37),(4,34),(5,13),(-31,13),(-3,38)]:
 for i in range(6):
  x=cx+rng.uniform(-2,2);y=cy+rng.uniform(-2,2);z=height(x,y);h=rng.uniform(1.5,2.5)
  cyl('Oak trunk',(x,y,z+h/2),.14,h,wood);ico('Broad oak canopy',(x,y,z+h),(1.1,.95,.9),leaf)
for i in range(35):
 x=rng.uniform(-35,8);y=rng.uniform(12,39)
 if -24<x<-4 and 17<y<31:continue
 ico('Meadow boulder',(x,y,height(x,y)+.16),(.3+rng.random()*.4,.35,.35),rock)
# A single windmill farm is the plains landmark.
x,y=-23,27;z=height(x,y)
cyl('Windmill tower',(x,y,z+1.8),.8,3.6,cream)
bpy.ops.mesh.primitive_cone_add(vertices=16,radius1=1.05,radius2=0,depth=1.2,location=(x,y,z+4));link(bpy.context.object,'Windmill roof',roof)
for angle in [math.pi/4,math.pi*3/4]:
 arm=cube('Windmill sail',(x,y-.86,z+3),(4,.1,.18),wood);arm.rotation_euler.y=angle
 for sign in [-1,1]:
  panel=cube('Canvas sail',(x+sign*1.3*math.cos(angle),y-.94,z+3-sign*1.3*math.sin(angle)),(1.25,.07,.42),cloth);panel.rotation_euler.y=angle
for i in range(2):
 xx=x+3+i*2.5;yy=y+1;zz=height(xx,yy);cube('Farm cottage',(xx,yy,zz+.55),(1.7,1.4,1.1),cream)
 bpy.ops.mesh.primitive_cone_add(vertices=4,radius1=1.4,depth=.85,location=(xx,yy,zz+1.45),rotation=(0,0,math.pi/4));link(bpy.context.object,'Farm roof',roof)
for i in range(7):cube('Cultivated field strip',(-20+i*.38,30,height(-20+i*.38,30)+.04),(.17,3,.05),dirt)
# Frame the expanded world for the saved file and preview.
scene=bpy.context.scene;bpy.ops.object.camera_add(location=(-7,-56,85));cam=bpy.context.object;cam.name='Five Region Overview';cam.rotation_euler=(Vector((-10,14,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=88;scene.camera=cam
for screen in bpy.data.screens:
 for area in screen.areas:
  if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA'
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/wizard-royale-five-region-map.blend'))
scene.render.filepath=str(ROOT/'art/big-plains-map-preview.png');bpy.ops.render.render(write_still=True)
