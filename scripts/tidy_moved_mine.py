import bpy, math
from mathutils import Matrix, Vector
floor=bpy.data.objects['Deepstone quarry floor']
old=floor.matrix_world.copy()
new=Matrix.Translation(Vector((old.translation.x,14.45,0.3))) @ Matrix.Rotation(math.pi/2,4,'Z')
change=new @ old.inverted()
objects=[o for o in bpy.data.objects if any(c.name.startswith('Mine Region') or c.name=='Transition — Desert to Grand Mine' for c in o.users_collection)]
for o in objects:o.matrix_world=change @ o.matrix_world
bpy.context.view_layer.update()
collection=bpy.data.collections.new('Mine — Clean Desert Connection');bpy.context.scene.collection.children.link(collection)
terrain=bpy.data.objects['Detailed Ember Dunes Terrain']
def height(x,y):
 hit,pt,_,_=terrain.ray_cast(terrain.matrix_world.inverted() @ Vector((x,y,20)),Vector((0,0,-1)))
 return (terrain.matrix_world @ pt).z if hit else .35
mat=floor.data.materials[0]
def mesh(name,verts,faces,material):
 m=bpy.data.meshes.new(name);m.from_pydata(verts,[],faces);m.update();o=bpy.data.objects.new(name,m);collection.objects.link(o);o.data.materials.append(material);return o
# A wide graded strip bridges the sand to the level quarry without a hard lip.
x0=old.translation.x-6.75;x1=old.translation.x+6.75
verts=[]
for j,y in enumerate((5.75,6.35,6.9,7.5)):
 for i in range(25):
  x=x0+(x1-x0)*i/24;t=j/3
  verts.append((x,y,(1-t)*height(x,5.75)+t*.42+.012))
faces=[(j*25+i,j*25+i+1,(j+1)*25+i+1,(j+1)*25+i) for j in range(3) for i in range(24)]
mesh('Graded sand into quarry',verts,faces,mat)
road=bpy.data.objects['Desert mine connecting road'];road.hide_render=True;road.hide_set(True)
roadmat=road.data.materials[0]
x=old.translation.x
verts=[]
for y in (3.8,4.7,5.75,6.35,6.9,7.5,8.2):
 z=height(x,y)+.03 if y<5.75 else ((1-min(1,(y-5.75)/1.75))*height(x,5.75)+min(1,(y-5.75)/1.75)*.42+.03)
 verts.extend([(x-1.15,y,z),(x+1.15,y,z)])
mesh('Aligned mine approach road',verts,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(6)],roadmat)
# Border stones frame the entrance rather than obstructing the road.
for o in objects:
 if o.name.startswith('Mine border rock'):
  o.location.z=height(o.location.x,min(o.location.y,6.8))+.32
bpy.context.view_layer.update()
# Leave a clear close overview of the tidied region.
for area in bpy.context.screen.areas:
 if area.type=='CONSOLE':
  area.type='VIEW_3D';space=area.spaces.active
  space.region_3d.view_distance=35
  space.region_3d.view_location=Vector((15,9,1))
  space.region_3d.view_rotation=(Vector((32,-24,29))-Vector((15,9,1))).to_track_quat('Z','Y')
  space.overlay.show_extras=False
bpy.ops.wm.save_as_mainfile(filepath='/Users/michaelcaras/Desktop/new-game/art/wizard-royale-four-region-map.blend')
