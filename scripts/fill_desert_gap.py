import bpy
from pathlib import Path
from mathutils import Vector
ROOT=Path('/Users/michaelcaras/Desktop/new-game')
col=bpy.data.collections['Plains — Great Greenfields']
# Replace the narrow curved shoulder with a full terrain patch across the gap.
old=bpy.data.objects.get('Rounded plains desert mine junction')
if old:bpy.data.objects.remove(old,do_unlink=True)
castle=bpy.data.objects['Castle Valley Terrain'];desert=bpy.data.objects['Detailed Ember Dunes Terrain']
def ground(o,x,y):
 hit,p,_,_=o.ray_cast(o.matrix_world.inverted() @ Vector((x,y,20)),Vector((0,0,-1)))
 return (o.matrix_world @ p).z if hit else .34
# Overlap the bordering tiles slightly so there is no exposed sky seam.
verts=[];nx=60;ny=24
for j in range(ny+1):
 y=6.55+(11.6-6.55)*j/ny
 for i in range(nx+1):
  x=-2.0+12.0*i/nx;t=min(1,max(0,(y-6.8)/3.4))
  z=(1-t)*ground(desert if x>=0 else castle,x,6.65)+t*.34
  verts.append((x,y,z+.018))
faces=[(j*(nx+1)+i,j*(nx+1)+i+1,(j+1)*(nx+1)+i+1,(j+1)*(nx+1)+i) for j in range(ny) for i in range(nx)]
m=bpy.data.meshes.new('Continuous plains desert terrain');m.from_pydata(verts,[],faces);m.update()
o=bpy.data.objects.new('Filled plains desert junction',m);col.objects.link(o)
green=bpy.data.materials['Meadow grass 1'];m.materials.append(green)
# A sandy fringe makes the connection read as a biome transition.
sand=desert.data.materials[0];m.materials.append(sand)
for p in m.polygons:
 p.use_smooth=True;p.material_index=1 if p.center.y<7.55 and p.center.x>0 else 0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/wizard-royale-five-region-rounded.blend'))
scene=bpy.context.scene;scene.render.filepath=str(ROOT/'art/filled-desert-gap-preview.png');bpy.ops.render.render(write_still=True)
