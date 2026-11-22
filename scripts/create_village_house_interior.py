"""Create a furnished, low-poly WandWars village house as a separate Blender file."""

from pathlib import Path
import math

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "art" / "wandwars-village-house-interior.blend"
PREVIEW = ROOT / "art" / "wandwars-village-house-interior-preview.png"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for collection in list(bpy.data.collections):
    if collection.name != "Collection":
        bpy.data.collections.remove(collection)


def collection(name):
    group = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(group)
    return group


shell = collection("01 House shell and flooring")
furniture = collection("02 Furniture")
details = collection("03 Hearth and small details")
roof = collection("04 Removable roof - show to see exterior")


def mat(name, color, roughness=0.82, metallic=0.0, emission=None, strength=0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return material


oak = mat("Warm oak", (0.34, 0.19, 0.09))
oak_light = mat("Light floorboards", (0.52, 0.32, 0.16))
oak_dark = mat("Dark structural timber", (0.19, 0.10, 0.05))
plaster = mat("Cream plaster", (0.79, 0.68, 0.49))
stone = mat("Warm hearth stone", (0.42, 0.39, 0.34))
stone_dark = mat("Fireplace opening", (0.09, 0.09, 0.09))
blue = mat("Village blue cloth", (0.08, 0.22, 0.41))
red = mat("Terracotta cloth", (0.55, 0.16, 0.08))
linen = mat("Cream linen", (0.86, 0.79, 0.61))
glass = mat("Pale blue window glass", (0.26, 0.51, 0.62), roughness=0.25)
iron = mat("Wrought iron", (0.11, 0.12, 0.13), metallic=0.6)
gold = mat("Warm brass", (0.60, 0.39, 0.12), metallic=0.55)
fire = mat("Magical hearth glow", (1.0, 0.28, 0.04), emission=(1.0, 0.21, 0.02), strength=3)
roof_blue = mat("Blue village roof", (0.09, 0.25, 0.43))
earth = mat("Ground outside", (0.27, 0.37, 0.19))


def link(obj, group, material):
    for source in list(obj.users_collection):
        source.objects.unlink(obj)
    group.objects.link(obj)
    if material:
        obj.data.materials.append(material)
    return obj


def cube(name, loc, size, material, group, bevel=0.0, rotation=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = link(bpy.context.object, group, material)
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler.z = rotation
    if bevel:
        modifier = obj.modifiers.new("Softened corners", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return obj


def cylinder(name, loc, radius, depth, material, group, vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    obj = link(bpy.context.object, group, material)
    obj.name = name
    return obj


def cone(name, loc, radius, depth, material, group, vertices=9):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=0, depth=depth, location=loc)
    obj = link(bpy.context.object, group, material)
    obj.name = name
    return obj


# The floor measures 7 x 6 Blender units. The front and right walls are low
# cutaways; the full pitched roof remains in its own hidden collection.
cube("Village green", (0, 0, -0.26), (10, 9, 0.25), earth, shell)
cube("Stone foundation", (0, 0, -0.10), (7.4, 6.4, 0.30), stone, shell, 0.06)
for index in range(14):
    x = -3.25 + index * 0.5
    cube(f"Floorboard {index + 1:02d}", (x, 0, 0.09), (0.46, 5.9, 0.16),
         oak_light if index % 3 else oak, shell, 0.015)

# Back wall and left wall have timber framing and two blue-glass windows.
cube("Back plaster wall", (0, 3.0, 1.7), (7.2, 0.25, 3.4), plaster, shell)
cube("Left plaster wall", (-3.5, 0, 1.7), (0.25, 6.0, 3.4), plaster, shell)
cube("Right cutaway wall", (3.5, 0.15, 0.36), (0.25, 5.7, 0.72), plaster, shell)
for x in (-3.5, 3.5):
    cube("Corner timber post", (x, 3.0, 1.85), (0.23, 0.23, 3.7), oak_dark, shell)
for y in (-3.0, 3.0):
    cube("Left timber post", (-3.5, y, 1.85), (0.23, 0.23, 3.7), oak_dark, shell)
cube("Back top beam", (0, 3.0, 3.43), (7.3, 0.28, 0.30), oak_dark, shell)
cube("Left top beam", (-3.5, 0, 3.43), (0.28, 6.2, 0.30), oak_dark, shell)
cube("Back lower beam", (0, 3.0, 0.72), (7.2, 0.30, 0.18), oak_dark, shell)
cube("Left lower beam", (-3.5, 0, 0.72), (0.30, 6.0, 0.18), oak_dark, shell)

for x in (-1.65, 2.15):
    cube("Window glass", (x, 2.84, 2.18), (1.05, 0.07, 0.92), glass, shell)
    for offset in (-0.55, 0.55):
        cube("Window side frame", (x + offset, 2.76, 2.18), (0.10, 0.15, 1.10), oak_dark, shell)
    for height in (1.66, 2.70):
        cube("Window horizontal frame", (x, 2.76, height), (1.20, 0.15, 0.10), oak_dark, shell)
    cube("Window crossbar", (x, 2.74, 2.18), (0.10, 0.13, 1.00), oak_dark, shell)

# A low front facade leaves the furnished room visible from the render camera.
for x, width in ((-2.38, 2.25), (2.38, 2.25)):
    cube("Front low plaster wall", (x, -3.0, 0.63), (width, 0.25, 1.25), plaster, shell)
    cube("Front timber cap", (x, -3.0, 1.27), (width + 0.06, 0.29, 0.15), oak_dark, shell)
cube("Open doorway left jamb", (-1.18, -3.0, 0.68), (0.15, 0.30, 1.35), oak_dark, shell)
cube("Open doorway right jamb", (1.18, -3.0, 0.68), (0.15, 0.30, 1.35), oak_dark, shell)
cube("Open wooden door", (1.75, -3.02, 0.68), (1.05, 0.12, 1.30), oak, shell,
     bevel=0.04, rotation=math.radians(68))
cylinder("Door brass knob", (1.28, -3.22, 0.72), 0.08, 0.08, gold, details)

# Fireplace and its glowing hearth sit against the back-left wall.
cube("Hearth slab", (-2.30, 2.10, 0.22), (1.65, 1.25, 0.22), stone, details, 0.04)
cube("Fireplace left pier", (-3.04, 2.52, 1.12), (0.28, 0.72, 1.80), stone, details)
cube("Fireplace right pier", (-1.56, 2.52, 1.12), (0.28, 0.72, 1.80), stone, details)
cube("Fireplace dark recess", (-2.30, 2.73, 0.96), (1.16, 0.12, 1.15), stone_dark, details)
cube("Fireplace mantel", (-2.30, 2.35, 2.05), (1.92, 0.75, 0.22), stone, details, 0.04)
for side in (-1, 1):
    log = cylinder("Fireplace log", (-2.30 + side * 0.22, 2.26, 0.45), 0.13, 0.80, oak_dark, details, 10)
    log.rotation_euler.x = math.pi / 2
for x, size in ((-2.48, 0.62), (-2.16, 0.82), (-1.93, 0.45)):
    cone("Orange fire tongue", (x, 2.27, 0.53 + size * 0.45), 0.15, size, fire, details)

# Dining area: a stout table, two chairs, tableware and a woven rug.
cube("Woven village rug", (-0.35, -0.35, 0.19), (3.0, 2.45, 0.04), blue, furniture, 0.08)
for x in (-1.52, 0.82):
    cube("Rug border", (x, -0.35, 0.22), (0.08, 2.45, 0.03), linen, furniture)
for y in (-1.50, 0.80):
    cube("Rug border", (-0.35, y, 0.22), (3.0, 0.08, 0.03), linen, furniture)
cube("Dining table top", (-0.35, -0.35, 1.10), (2.10, 1.27, 0.19), oak, furniture, 0.07)
for x in (-1.22, 0.52):
    for y in (-0.78, 0.08):
        cube("Dining table leg", (x, y, 0.62), (0.18, 0.18, 0.92), oak_dark, furniture)
for y, back_y in ((-1.53, -1.88), (0.85, 1.20)):
    cube("Dining chair seat", (-0.35, y, 0.55), (0.72, 0.70, 0.15), oak, furniture, 0.03)
    cube("Dining chair back", (-0.35, back_y, 0.96), (0.72, 0.12, 0.95), oak, furniture, 0.03)
    for x in (-0.63, -0.07):
        cube("Dining chair leg", (x, y, 0.28), (0.12, 0.12, 0.45), oak_dark, furniture)
cylinder("Blue pottery bowl", (-0.72, -0.30, 1.23), 0.19, 0.12, blue, details, 12)
cylinder("Wooden mug", (0.16, -0.38, 1.24), 0.11, 0.20, oak_light, details, 10)

# Bed and storage along the right wall.
cube("Bed frame", (2.12, 1.30, 0.42), (1.95, 2.55, 0.42), oak_dark, furniture, 0.06)
cube("Bed mattress", (2.12, 1.30, 0.70), (1.73, 2.33, 0.23), linen, furniture, 0.08)
cube("Blue bed blanket", (2.12, 0.88, 0.85), (1.77, 1.38, 0.11), blue, furniture, 0.05)
cube("Bed pillow", (2.12, 2.18, 0.85), (1.30, 0.38, 0.13), linen, furniture, 0.08)
cube("Bed headboard", (2.12, 2.59, 0.87), (1.95, 0.18, 1.25), oak, furniture, 0.04)
for number, (x, y) in enumerate(((2.20, -0.75), (-2.76, 0.95), (0.20, 2.36)), start=1):
    cube(f"Wall chest {number} body", (x, y, 0.53), (1.20, 0.78, 0.72),
         oak, furniture, 0.04)
    cube(f"Wall chest {number} lid", (x, y, 0.94), (1.28, 0.86, 0.18),
         oak_dark, furniture, 0.05)
    for offset in (-0.43, 0.43):
        cube(f"Wall chest {number} iron band", (x + offset, y, 0.96),
             (0.09, 0.89, 0.08), iron, details)
    cylinder(f"Wall chest {number} brass clasp", (x, y - 0.43, 0.69),
             0.08, 0.08, gold, details)

# Shelves, books, supplies and a hanging lantern complete the lived-in room.
for height in (1.25, 2.12):
    cube("Left wall shelf", (-3.02, -0.95, height), (0.78, 2.12, 0.12), oak_dark, furniture)
for index, y in enumerate((-1.65, -1.36, -1.07, -0.78)):
    cube(f"Shelf book {index + 1}", (-3.02, y, 1.49),
         (0.28, 0.20, 0.34 + 0.05 * (index % 2)),
         red if index % 2 else blue, details, 0.02)
for x, y in ((-2.90, -2.22), (-2.36, -2.39)):
    cylinder("Clay storage jar", (x, y, 0.45), 0.23, 0.54, red, details, 10)

cube("Lantern crossbeam", (0.45, 2.10, 3.34), (3.8, 0.18, 0.17), oak_dark, shell)
cylinder("Lantern chain", (0.45, 0.97, 2.76), 0.025, 0.96, iron, details, 8)
cylinder("Lantern body", (0.45, 0.97, 2.24), 0.18, 0.36, gold, details, 10)
cylinder("Lantern glow", (0.45, 0.97, 2.24), 0.14, 0.30, fire, details, 10)

# Complete blue gable roof, initially hidden so the saved file opens on the
# furnished room. Users can enable collection 04 to inspect the exterior.
for side in (-1, 1):
    panel = cube("Blue gable roof panel", (side * 1.77, 0, 4.02),
                 (3.94, 6.56, 0.18), roof_blue, roof, 0.04)
    panel.rotation_euler.y = side * math.radians(30)
cube("Roof ridge cap", (0, 0, 5.0), (0.31, 6.72, 0.30), oak_dark, roof)
roof.hide_render = True
roof.hide_viewport = True

# Soft, warm isometric render that clearly shows the floor plan and furniture.
world = bpy.context.scene.world or bpy.data.worlds.new("Warm daylight")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.42, 0.51, 0.65, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.65

def area_light(name, location, power, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    direction = Vector((0, 0, 0.8)) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


area_light("Warm sun", (2, -4, 9), 1700, 7)
area_light("Firelight", (-2.4, 1.1, 2.0), 180, 2)

camera_data = bpy.data.cameras.new("House cutaway camera")
camera = bpy.data.objects.new("House cutaway camera", camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location = (9.2, -10.5, 8.4)
camera.rotation_euler = (Vector((0, 0, 1.25)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera_data.type = "ORTHO"
camera_data.ortho_scale = 11.8
bpy.context.scene.camera = camera

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1400
scene.render.resolution_y = 1050
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(PREVIEW)
scene.view_settings.view_transform = "AgX"
scene.camera.data.lens = 38

bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
bpy.ops.render.render(write_still=True)
print(f"Saved {OUTPUT}")
print(f"Rendered {PREVIEW}")
