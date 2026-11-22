import bpy
from pathlib import Path
from mathutils import Vector
ROOT=Path('/Users/michaelcaras/Desktop/new-game')
plains=bpy.data.objects['Great Greenfields — 45m x 30m'];mine=bpy.data.objects['Deepstone quarry floor']
def height(o,x,y,fallback):
 hit,p,_,_=o.ray_cast(o.matrix_world.inverted() @ Vector((x,y,30)),Vector((0,0,-1)))
 return (o.matrix_world @ p).z if hit else fallback
# Overlap both banks, including the rounded southern plains corner.
verts=[];nx,ny=12,64
for j in range(ny+1):
 y=6.65+(22.35-6.65)*j/ny
 for i in range(nx+1):
  x=7.6+2.4*i/nx;t=i/nx
  z=(1-t)*height(plains,7.6,max(y,10.3),.34)+t*height(mine,10,y,.42)
  verts.append((x,y,z+.025))
faces=[(j*(nx+1)+i,j*(nx+1)+i+1,(j+1)*(nx+1)+i+1,(j+1)*(nx+1)+i) for j in range(ny) for i in range(nx)]
m=bpy.data.meshes.new('Mine plains seamless bank');m.from_pydata(verts,[],faces);m.update();o=bpy.data.objects.new('Closed mine plains seam',m);bpy.data.collections['Plains — Great Greenfields'].objects.link(o);m.materials.append(bpy.data.materials['Meadow grass 1'])
for p in m.polygons:p.use_smooth=True
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/wizard-royale-five-region-rounded.blend'))
bpy.context.scene.render.filepath=str(ROOT/'art/closed-mine-seam-preview.png');bpy.ops.render.render(write_still=True)
