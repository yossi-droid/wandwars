from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "art" / "wizard-royale-circular-map.blend"
PREVIEW = ROOT / "art" / "wizard-royale-circular-map-preview.png"


def move_collections(names, dx=0.0, dy=0.0):
    moved = set()
    for name in names:
        collection = bpy.data.collections.get(name)
        if not collection:
            continue
        for obj in collection.objects:
            if obj.name in moved:
                continue
            obj.location.x += dx
            obj.location.y += dy
            moved.add(obj.name)


# Tighten the spokes around the central castle into a round arrangement.
move_collections(["Plains — Great Greenfields"], dy=-3.0)
move_collections([
    "Mine Region — Deepstone District",
    "Mine Region — Grand Mine",
    "Mine — Clean Desert Connection",
], dx=-2.0, dy=-2.0)
move_collections(["Transition — Desert to Grand Mine"], dx=-1.0, dy=-1.0)
move_collections(["Forest — Whispering Pines"], dx=4.0, dy=8.0)
move_collections(["Town — Crossroads Borough"], dx=2.0, dy=2.0)
move_collections(["Swamp — Murkmire"], dx=-2.0, dy=2.0)


def material(name, color, roughness=0.75, metallic=0.0, emission=None):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if emission:
        shader.inputs["Emission Color"].default_value = (*emission, 1.0)
        shader.inputs["Emission Strength"].default_value = 3.2
    return mat


circle_collection = bpy.data.collections.get("Circular World Base")
if circle_collection:
    for obj in list(circle_collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
else:
    circle_collection = bpy.data.collections.new("Circular World Base")
    bpy.context.scene.collection.children.link(circle_collection)

ocean = material("Circular world deep ocean", (0.025, 0.12, 0.20), roughness=0.35)
rim = material("Circular world magic rim", (0.34, 0.02, 0.72), roughness=0.28, emission=(0.48, 0.04, 1.0))
earth = material("Circular world underside", (0.14, 0.075, 0.025), roughness=0.9)

# The ocean disk fills small gaps between regions and gives the board one silhouette.
bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=40.5, depth=0.55, location=(-10.0, 1.0, -1.18))
disk = bpy.context.object
disk.name = "Circular world ocean base"
for current in list(disk.users_collection):
    current.objects.unlink(disk)
circle_collection.objects.link(disk)
disk.data.materials.append(ocean)

bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=41.2, depth=0.34, location=(-10.0, 1.0, -1.46))
under = bpy.context.object
under.name = "Circular world earth edge"
for current in list(under.users_collection):
    current.objects.unlink(under)
circle_collection.objects.link(under)
under.data.materials.append(earth)

bpy.ops.mesh.primitive_torus_add(
    major_radius=40.65,
    minor_radius=0.48,
    major_segments=128,
    minor_segments=12,
    location=(-10.0, 1.0, -0.78),
)
border = bpy.context.object
border.name = "Circular world glowing border"
for current in list(border.users_collection):
    current.objects.unlink(border)
circle_collection.objects.link(border)
border.data.materials.append(rim)

root = bpy.data.objects.get("WORLD — Circular Layout")
if not root:
    root = bpy.data.objects.new("WORLD — Circular Layout", None)
    bpy.context.scene.collection.objects.link(root)
root["layout_note"] = "Regions tightened around the castle on a circular ocean platform"

scene = bpy.context.scene
camera = scene.camera
if camera:
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 102.0
    camera.location.x = -10.0
    camera.location.y = 1.0
    camera.location.z = 88.0
    camera.rotation_euler = (0.0, 0.0, 0.0)
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 1100
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW)

bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
if camera:
    bpy.ops.render.render(write_still=True)
print(f"Saved {OUTPUT}")
