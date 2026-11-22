from pathlib import Path
import math
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
items = bpy.data.collections.new('WandWars Shovel Item')
bpy.context.scene.collection.children.link(items)

def material(name, color, metal=0, rough=.45, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    p.inputs['Emission Color'].default_value = (*color, 1)
    p.inputs['Emission Strength'].default_value = emission
    return m

wood = material('Warm carved walnut', (.24,.085,.025), rough=.55)
steel = material('Forged blue steel', (.12,.20,.26), .8, .32)
edge = material('Polished cutting edge', (.5,.64,.7), .85, .25)
gold = material('Antique brass fittings', (.58,.33,.09), .75, .3)
leather = material('Dark leather grip', (.045,.022,.014), rough=.8)
magic = material('Cyan rune inlay', (.015,.64,.82), .2, .3, 1.3)

def finish(obj, name, mat):
    obj.name = name
    for c in list(obj.users_collection): c.objects.unlink(obj)
    items.objects.link(obj)
    obj.data.materials.append(mat)
    return obj

def bar(name, a, b, radius, mat):
    a,b = Vector(a),Vector(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=radius, depth=(b-a).length, location=(a+b)/2)
    o = finish(bpy.context.object,name,mat)
    o.rotation_euler = (b-a).to_track_quat('Z','Y').to_euler()
    bevel=o.modifiers.new('Soft manufactured edges','BEVEL'); bevel.width=.008; bevel.segments=3
    o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return o

bar('Long wooden shaft',(0,0,.53),(0,0,1.78),.042,wood)
bar('Blade socket',(0,0,.43),(0,0,.76),.06,steel)
for z in [.70,.76,1.58]:
    bar('Brass collar',(0,0,z),(0,0,z+.038),.05,gold)
bar('Leather hand rest',(0,0,1.29),(0,0,1.56),.047,leather)
for i in range(9):
    z=1.30+i*.029
    bpy.ops.mesh.primitive_torus_add(major_radius=.047,minor_radius=.0025,major_segments=24,minor_segments=6,location=(0,0,z))
    finish(bpy.context.object,'Grip stitching',gold)

# A broad curved spade with shoulders and a pointed cutting edge.
rows=[(.65,.235),(.54,.255),(.24,.22),(.09,.14),(.015,.018)]
verts=[]
for z,w in rows:
    for j in range(7):
        u=j/3-1
        verts.append((u*w,-.045+.095*u*u+.025*(.65-z),z))
faces=[]
for r in range(4):
    for j in range(6):
        a=r*7+j; faces.append((a,a+1,a+8,a+7))
mesh=bpy.data.meshes.new('Curved spade surface'); mesh.from_pydata(verts,[],faces);mesh.update()
blade=bpy.data.objects.new('Broad forged shovel blade',mesh); items.objects.link(blade);blade.data.materials.append(steel)
solid=blade.modifiers.new('Steel thickness','SOLIDIFY');solid.thickness=.018
bevel=blade.modifiers.new('Rounded blade edge','BEVEL');bevel.width=.007;bevel.segments=3
blade.modifiers.new('Blade normals','WEIGHTED_NORMAL')
for p in mesh.polygons:p.use_smooth=True
for side in [-1,1]:
    for i in range(1,len(rows)-1):
        z,w=rows[i];nz,nw=rows[i+1]
        bar('Bright sharpened edge',(side*w,.05+.025*(.65-z),z),(side*nw,.05+.025*(.65-nz),nz),.009,edge)
    bar('Boot tread',(side*.07,.012,.65),(side*.24,.04,.65),.029,steel)
    bar('D handle side',(0,0,1.7),(side*.14,0,1.9),.029,steel)
    bar('D handle shoulder',(side*.14,0,1.9),(side*.14,0,2.04),.029,steel)
bar('D handle top',(-.14,0,2.04),(.14,0,2.04),.038,wood)
bar('D handle leather',(-.105,0,2.04),(.105,0,2.04),.04,leather)
for z in [.50,.61]:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=.019,location=(0,-.06,z))
    finish(bpy.context.object,'Brass socket rivet',gold)
# Small diamond-shaped magical engraving on the face of the blade.
points=[(0,-.061,.40),(.047,-.057,.34),(0,-.058,.28),(-.047,-.057,.34),(0,-.061,.40)]
for a,b in zip(points,points[1:]):bar('Inlaid digging rune',a,b,.005,magic)

# Export just the usable item, with its origin at the hand position.
root=bpy.data.objects.new('Shovel',None);items.objects.link(root)
for o in list(items.objects):
    if o!=root:o.parent=root
root['item_type']='Permanent zero-mana digging tool'
bpy.ops.object.select_all(action='DESELECT')
for o in items.objects:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/shovel.glb'),export_format='GLB',use_selection=True)

scene=bpy.context.scene
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.055,.075,.10,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.45
bpy.ops.object.camera_add(location=(2,-5,2.45))
cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,1.02))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type='ORTHO';cam.data.ortho_scale=2.55;scene.camera=cam
for loc,power,size,color in [((-3,-4,4),450,4,(1,.83,.65)),((3,1,3),650,3,(.4,.75,1)),((0,-3,1),80,2,(.8,.9,1))]:
    bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.data.color=color
    o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=800;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ROOT/'art/shovel-item-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/shovel-item.blend'))
bpy.ops.render.render(write_still=True)
