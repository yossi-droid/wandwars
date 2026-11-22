import bpy, os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.path.join(ROOT, "art", "magic-items-pack.blend")
OUT = os.path.join(ROOT, "art", "magic-items")
os.makedirs(OUT, exist_ok=True)

# These are the top-level modeled item objects in the pack.
ITEM_NAMES = [
    "Catalyst_Shards", "Great_Protection_Potion", "Golden_Wizard_Cake",
    "Fairy_Fizz", "Small_Protection_Potion", "Healing_Leaves",
    "Tier_I_Attack_Scroll", "Tier_II_Attack_Scroll", "Elemental_Essences",
    "Burst_Runes", "Cosmic_Orbs", "Calamity_Cores",
    "Common_Rune", "Rare_Rune", "Super_Rare_Rune", "Epic_Rune", "Legendary_Rune",
]

def descendants(root):
    return [root] + list(root.children_recursive)

def studio_material():
    m = bpy.data.materials.new("Studio Ground")
    m.diffuse_color = (0.008, 0.004, 0.025, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (0.008, 0.004, 0.025, 1)
    bs.inputs["Roughness"].default_value = 0.74
    return m

def add_studio():
    ground_mat = studio_material()
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=3.1, depth=0.22, location=(0, 0, -0.18))
    ground = bpy.context.object
    ground.name = "Studio_Plinth"
    ground.data.materials.append(ground_mat)
    bevel = ground.modifiers.new("Rounded plinth edge", "BEVEL")
    bevel.width = 0.12
    bevel.segments = 4

    bpy.ops.object.light_add(type="AREA", location=(0, -4.5, 7))
    key = bpy.context.object
    key.name = "Studio_Key"
    key.data.energy = 900
    key.data.shape = "DISK"
    key.data.size = 4.5
    key.rotation_euler = (0.35, 0, 0)

    bpy.ops.object.light_add(type="AREA", location=(3.5, 2.5, 3.5))
    fill = bpy.context.object
    fill.name = "Studio_Fill"
    fill.data.energy = 500
    fill.data.color = (0.18, 0.25, 1.0)
    fill.data.size = 3.0
    fill.rotation_euler = (-0.7, 0, 2.5)

    bpy.ops.object.light_add(type="POINT", location=(-2, 0, 2.5))
    rim = bpy.context.object
    rim.name = "Studio_Rim"
    rim.data.energy = 220
    rim.data.color = (0.55, 0.08, 1.0)

    bpy.ops.object.camera_add(location=(0, -5.7, 3.6))
    cam = bpy.context.object
    cam.name = "Item_Camera"
    cam.data.lens = 58
    cam.rotation_euler = (Vector((0, 0, 0.75)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam

def build_one(name):
    bpy.ops.wm.open_mainfile(filepath=MASTER)
    root = bpy.data.objects.get(name)
    if root is None:
        raise RuntimeError("Missing item root: " + name)
    keep = set(descendants(root))
    # Remove the display grid, other items, and the pack camera/lights.
    for obj in list(bpy.data.objects):
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    root.location = (0, 0, 0)
    add_studio()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = os.path.join(OUT, name.lower() + "-preview.png")
    scene.world.color = (0.002, 0.001, 0.012)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, name.lower() + ".blend"))
    bpy.ops.render.render(write_still=True)

for item in ITEM_NAMES:
    build_one(item)
print("Created", len(ITEM_NAMES), "individual Blender files in", OUT)
