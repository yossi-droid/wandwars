import bpy, math
from mathutils import Vector
from pathlib import Path
ROOT=Path('/Users/michaelcaras/Desktop/new-game')
terrain=bpy.data.objects['Great Greenfields — 45m x 30m']
# Round each corner by smoothly remapping its square patch to a circular arc.
xmin,xmax,ymin,ymax=-36,9,10.25,40.25
radius=4.5
for v in terrain.data.vertices:
 x,y,z=v.co
 cx=xmin+radius if x<xmin+radius else xmax-radius if x>xmax-radius else None
 cy=ymin+radius if y<ymin+radius else ymax-radius if y>ymax-radius else None
 if cx is not None and cy is not None:
  dx,dy=x-cx,y-cy
  dist=math.hypot(dx,dy)
  if dist>0:
   factor=max(abs(dx),abs(dy))/dist
   v.co.x=cx+dx*factor;v.co.y=cy+dy*factor
terrain.data.update()
col=bpy.data.collections['Plains — Great Greenfields']
for o in list(col.objects):
 if o.name.startswith('Plains soil edge'):bpy.data.objects.remove(o,do_unlink=True)
# Rebuild the edge skirt to follow the new rounded boundary exactly.
verts=terrain.data.vertices
indices=list(range(91))+[j*91+90 for j in range(1,61)]+list(range(60*91+89,60*91-1,-1))+[j*91 for j in range(59,0,-1)]
vv=[]
for i in indices:
 p=verts[i].co;vv.extend([tuple(p),(p.x,p.y,-.45)])
faces=[(2*i,2*i+1,(2*((i+1)%len(indices)))+1,2*((i+1)%len(indices))) for i in range(len(indices))]
m=bpy.data.meshes.new('Rounded meadow bank');m.from_pydata(vv,[],faces);m.update();o=bpy.data.objects.new('Rounded plains soil edge',m);col.objects.link(o);m.materials.append(bpy.data.materials['Plains worn paths'])
# Fill the formerly empty inside junction with a curved grass shoulder.
# A broad curved tongue meets desert north edge and mine west edge.
outline=[(-3,10.5),(-1,10.3),(1,10.1),(3,9.8),(5,9.3),(6.5,8.5),(7.5,7.1),(9.4,6.8),(10.0,8.3),(9.8,10.5),(9.6,12.5),(9.4,15),(9.1,18),(8.7,20),(7.8,18),(6.6,15),(4.5,12.5),(1,11.5)]
center=(5.5,11.7,.34)
vv=[center]+[(x,y,.34) for x,y in outline]
faces=[(0,i+1,(i+1)%len(outline)+1) for i in range(len(outline))]
m=bpy.data.meshes.new('Soft region junction');m.from_pydata(vv,[],faces);m.update();o=bpy.data.objects.new('Rounded plains desert mine junction',m);col.objects.link(o);m.materials.append(bpy.data.materials['Meadow grass 1'])
# Keep a non-destructive version of the previous map and save this refinement separately.
scene=bpy.context.scene
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/wizard-royale-five-region-rounded.blend'))
scene.render.filepath=str(ROOT/'art/rounded-regions-preview.png');bpy.ops.render.render(write_still=True)
