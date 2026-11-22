"""Create a game-ready, fully 3D magical blue flame in Blender.

Run with:
  Blender --background --factory-startup --python tools/build_blue_flame.py

Outputs:
  public/models/blue-flame.glb
  art/blue-flame.blend
  art/blue-flame-preview.png
"""

import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "public" / "models"
ART_DIR = ROOT / "art"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
ART_DIR.mkdir(parents=True, exist_ok=True)

GLB_PATH = MODEL_DIR / "blue-flame.glb"
BLEND_PATH = ART_DIR / "blue-flame.blend"
PREVIEW_PATH = ART_DIR / "blue-flame-preview.png"

MODEL_OBJECTS = []
FLAME_CONTROLS = {}


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def set_input(node, name, value):
    socket = node.inputs.get(name)
    if socket is not None:
        socket.default_value = value


def flame_material(name, color, emission_strength, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, alpha)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    set_input(bsdf, "Base Color", (*color, 1.0))
    set_input(bsdf, "Emission Color", (*color, 1.0))
    set_input(bsdf, "Emission Strength", emission_strength)
    set_input(bsdf, "Roughness", 0.18)
    set_input(bsdf, "Metallic", 0.0)
    set_input(bsdf, "Alpha", alpha)
    if alpha < 1:
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "DITHERED"
        elif hasattr(mat, "blend_method"):
            mat.blend_method = "BLEND"
        mat.use_transparency_overlap = False
    return mat


def register(obj, mat):
    obj.data.materials.append(mat)
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    MODEL_OBJECTS.append(obj)
    return obj


def tongue_center(base, height, bend, phase, twist, t):
    # Curves begin together at the hot base, then peel outward and curl toward
    # their tips. A small second harmonic prevents a perfect corkscrew shape.
    curl = math.sin(math.pi * t) * bend
    angle = phase + twist * t
    return Vector(
        (
            base[0] * (1 - t * 0.3)
            + math.cos(angle) * curl
            + math.sin(phase * 1.7 + t * math.pi * 2) * bend * 0.12 * t,
            base[1] * (1 - t * 0.3)
            + math.sin(angle) * curl
            + math.cos(phase * 1.3 + t * math.pi * 1.5) * bend * 0.1 * t,
            0.08 + height * t,
        )
    )


def create_flame_tongue(
    name,
    base,
    height,
    width,
    bend,
    phase,
    twist,
    mat,
    rings=25,
    sides=18,
    flatten=0.82,
):
    centers = [tongue_center(base, height, bend, phase, twist, i / rings) for i in range(rings + 1)]
    vertices = []
    faces = []

    for ring, center in enumerate(centers):
        t = ring / rings
        # Wide and energetic at the base, pinched to a sharp flame tip. Subtle
        # waves along the length create organic folds in the silhouette.
        taper = max(0.018, (1 - t) ** 0.7)
        pulse = 0.9 + math.sin(t * math.pi * 5 + phase) * 0.1 * (1 - t)
        radius = width * taper * pulse
        tangent = centers[min(rings, ring + 1)] - centers[max(0, ring - 1)]
        tangent.normalize()
        side_axis = tangent.cross(Vector((0, 0, 1)))
        if side_axis.length < 0.001:
            side_axis = Vector((math.cos(phase), math.sin(phase), 0))
        side_axis.normalize()
        other_axis = tangent.cross(side_axis).normalized()
        # Slowly rotate the oval cross-section so highlights spiral upward.
        roll = phase * 0.35 + t * twist * 0.55
        rolled_side = side_axis * math.cos(roll) + other_axis * math.sin(roll)
        rolled_other = -side_axis * math.sin(roll) + other_axis * math.cos(roll)
        for side in range(sides):
            angle = side / sides * math.tau
            offset = rolled_side * (math.cos(angle) * radius)
            offset += rolled_other * (math.sin(angle) * radius * flatten)
            vertices.append(center + offset)

    for ring in range(rings):
        for side in range(sides):
            nxt = (side + 1) % sides
            a = ring * sides + side
            b = ring * sides + nxt
            c = (ring + 1) * sides + side
            d = (ring + 1) * sides + nxt
            faces.append((a, b, d, c))
    faces.append(tuple(reversed(range(sides))))
    top = rings * sides
    faces.append(tuple(top + i for i in range(sides)))

    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return register(obj, mat)


def create_base_aura(mat, center_mat=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, location=(0, 0, 0.18))
    core = bpy.context.object
    core.name = "WhiteHotFlameCore"
    core.scale = (0.48, 0.4, 0.2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return register(core, center_mat or mat)


def create_sparks(cyan, blue):
    rng = random.Random(94721)
    for i in range(30):
        angle = rng.uniform(0, math.tau)
        radius = rng.uniform(0.38, 1.05)
        height = rng.uniform(0.2, 2.45)
        # Higher sparks drift farther from the central plume.
        radius *= 0.65 + height * 0.22
        location = (
            math.cos(angle) * radius,
            math.sin(angle) * radius * 0.78,
            height,
        )
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=2,
            radius=rng.uniform(0.008, 0.026),
            location=location,
        )
        spark = bpy.context.object
        spark.name = f"MagicSpark.{i:02d}"
        spark.scale.z = rng.uniform(1.1, 2.0)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        register(spark, cyan if i % 3 else blue)


def parent_to_bone(obj, armature, bone_name):
    """Attach an already-positioned mesh to a control bone without moving it."""
    world_transform = obj.matrix_world.copy()
    obj.parent = armature
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    obj.matrix_world = world_transform


def create_flicker_rig():
    """Create layer controls plus one control for every individual flame tongue."""
    armature_data = bpy.data.armatures.new("BlueMagicFlameRig")
    armature = bpy.data.objects.new("BlueMagicFlame", armature_data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)

    bpy.ops.object.mode_set(mode="EDIT")
    root_bone = armature_data.edit_bones.new("root")
    root_bone.head = (0, 0, 0)
    root_bone.tail = (0, 0, 0.35)
    plume_bone = armature_data.edit_bones.new("plume")
    plume_bone.head = (0.01, 0, 0.01)
    plume_bone.tail = (0.01, 0, 0.52)
    plume_bone.parent = root_bone
    for index, name in enumerate(("core", "middle", "outer", "sparks")):
        bone = armature_data.edit_bones.new(name)
        # Slightly offset duplicate controls so Blender keeps every bone valid.
        bone.head = (index * 0.015, 0, 0.02)
        bone.tail = (index * 0.015, 0, 0.55)
        bone.parent = root_bone if name == "sparks" else plume_bone

    tongue_objects = [
        obj
        for obj in MODEL_OBJECTS
        if obj.name.startswith(("CoreFlame", "CyanFlame", "OuterBlueFlame"))
    ]
    for index, obj in enumerate(tongue_objects):
        if obj.name.startswith("CoreFlame"):
            layer_name = "core"
        elif obj.name.startswith("CyanFlame"):
            layer_name = "middle"
        else:
            layer_name = "outer"
        bone_name = f"tongue_{index:02d}"
        bone = armature_data.edit_bones.new(bone_name)
        offset = 0.08 + index * 0.012
        bone.head = (offset, 0.01, 0.02)
        bone.tail = (offset, 0.01, 0.42)
        bone.parent = armature_data.edit_bones[layer_name]
        FLAME_CONTROLS[obj.name] = (bone_name, layer_name)
    bpy.ops.object.mode_set(mode="OBJECT")

    armature["assetType"] = "magical-blue-flame"
    armature["forwardAxis"] = "+Y"
    armature["animationClip"] = "FlameFlicker"
    MODEL_OBJECTS.append(armature)

    for obj in MODEL_OBJECTS:
        if obj is armature:
            continue
        if obj.name in FLAME_CONTROLS:
            control = FLAME_CONTROLS[obj.name][0]
        elif obj.name.startswith("MagicSpark"):
            control = "sparks"
        elif obj.name.startswith(("CoreFlame", "WhiteHotFlameCore")):
            control = "core"
        else:
            control = "root"
        parent_to_bone(obj, armature, control)

    return armature


def animate_flicker(armature):
    """Build a long, fast, irregular loop with independently moving tongues."""
    scene = bpy.context.scene
    # Higher playback rate makes the small tongue changes snap like real fire.
    scene.render.fps = 36
    scene.frame_start = 1
    # An eight-second loop makes repetition practically invisible during play.
    scene.frame_end = 193

    action = bpy.data.actions.new("FlameFlicker")
    action.use_fake_user = True
    armature.animation_data_create()
    armature.animation_data.action = action

    rng = random.Random(603941)

    def irregular_frames(min_step, max_step):
        frames = [1]
        while frames[-1] + min_step < scene.frame_end:
            next_frame = frames[-1] + rng.randint(min_step, max_step)
            if next_frame >= scene.frame_end:
                break
            frames.append(next_frame)
        frames.append(scene.frame_end)
        return frames

    # The broad layers only drift slightly. Their uneven key spacing prevents a
    # synchronized breathing effect while the individual licks flutter faster.
    layer_settings = {
        # The entire plume changes height while keeping a steady overall width.
        "plume": ((1.0, 1.0), (0.76, 1.28), 0.018, (2, 5)),
        "core": ((0.98, 1.02), (0.96, 1.05), 0.014, (3, 6)),
        "middle": ((0.97, 1.03), (0.95, 1.06), 0.025, (4, 8)),
        "outer": ((0.96, 1.04), (0.94, 1.07), 0.035, (5, 10)),
        "sparks": ((0.76, 1.24), (0.90, 1.10), 0.07, (2, 6)),
    }
    for bone_name, (width_range, height_range, turn, steps) in layer_settings.items():
        bone = armature.pose.bones[bone_name]
        bone.rotation_mode = "XYZ"
        frames = irregular_frames(*steps)
        first = (1.0, 1.0, 0.0, 0.0)
        samples = [first]
        for _ in frames[1:-1]:
            height = rng.uniform(*height_range)
            width = 1.0 if bone_name == "plume" else rng.uniform(*width_range)
            samples.append(
                (
                    width,
                    height,
                    rng.uniform(-turn, turn),
                    rng.uniform(-turn, turn),
                )
            )
        samples.append(first)
        for frame, (width, height, turn_x, turn_z) in zip(frames, samples):
            bone.scale = (width, width, height)
            bone.rotation_euler = (turn_x, -turn_x * 0.6, turn_z)
            rise = 0.12 * (height - 1) if bone_name == "sparks" else 0
            bone.location = (turn_z * 0.08, -turn_x * 0.08, rise)
            bone.keyframe_insert(data_path="scale", frame=frame, group=bone_name)
            bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone_name)
            bone.keyframe_insert(data_path="location", frame=frame, group=bone_name)

    # Every lick uses its own freshly generated uneven frame spacing. Core licks
    # can change every 2-4 frames, producing the quick, chaotic fire flutter.
    for _, (bone_name, layer_name) in FLAME_CONTROLS.items():
        bone = armature.pose.bones[bone_name]
        bone.rotation_mode = "XYZ"
        if layer_name == "core":
            width_range, height_range, sway, steps = (0.93, 1.07), (0.89, 1.13), 0.04, (2, 4)
        elif layer_name == "middle":
            width_range, height_range, sway, steps = (0.90, 1.10), (0.86, 1.16), 0.06, (2, 5)
        else:
            width_range, height_range, sway, steps = (0.88, 1.12), (0.84, 1.18), 0.08, (3, 7)

        tongue_frames = irregular_frames(*steps)
        first = (
            1.0,
            1.0,
            0.0,
            0.0,
            0.0,
            False,
        )
        samples = [first]
        for _ in tongue_frames[1:-1]:
            # A real flame constantly sheds little licks. Occasionally collapse
            # one almost to nothing while lifting it upward, then let the next
            # irregular key bring a fresh tongue back from the base.
            vanish_chance = 0.12 if layer_name == "core" else 0.09 if layer_name == "middle" else 0.07
            vanish = rng.random() < vanish_chance
            samples.append(
                (
                    0.035 if vanish else rng.uniform(*width_range),
                    0.14 if vanish else rng.uniform(*height_range),
                    rng.uniform(-sway, sway),
                    rng.uniform(-sway, sway),
                    rng.uniform(-sway * 0.7, sway * 0.7),
                    vanish,
                )
            )
        samples.append(first)

        for frame, (width, height, rot_x, rot_y, rot_z, vanish) in zip(tongue_frames, samples):
            bone.scale = (width, width, height)
            bone.rotation_euler = (rot_x, rot_y, rot_z)
            lift = 0.28 if vanish else (height - 1) * 0.025
            bone.location = (rot_y * 0.12, -rot_x * 0.12, lift)
            bone.keyframe_insert(data_path="scale", frame=frame, group=bone_name)
            bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone_name)
            bone.keyframe_insert(data_path="location", frame=frame, group=bone_name)

    scene.frame_set(1)
    return action


def build_flame():
    clear_scene()
    # Keep the core bright but strongly blue; the earlier near-white cyan was
    # washing out most of the flame's color in the game and model viewer.
    white = flame_material("CobaltCore", (0.002, 0.018, 0.58), 2.6, 0.84)
    cyan = flame_material("MidnightBlue", (0.001, 0.012, 0.7), 2.5, 0.64)
    blue = flame_material("ArcaneNavy", (0.001, 0.004, 0.4), 2.15, 0.44)
    deep = flame_material("DeepNavyGlow", (0.0005, 0.001, 0.18), 1.45, 0.3)

    create_base_aura(white)

    # White-hot heart: broad enough to glow through the surrounding layers.
    create_flame_tongue("CoreFlame", (0, 0), 2.45, 0.38, 0.24, 0.4, 1.5, white, flatten=0.9)
    create_flame_tongue("CoreFlameLeft", (-0.14, 0.03), 1.72, 0.25, 0.34, 2.5, -1.7, white)
    create_flame_tongue("CoreFlameRight", (0.15, -0.02), 1.92, 0.24, 0.38, 5.5, 1.8, cyan)

    # Cyan middle licks produce the recognizable split flame silhouette.
    middle_specs = [
        ((-0.28, 0.04), 2.25, 0.25, 0.5, 2.4, -1.7),
        ((0.3, -0.05), 2.12, 0.24, 0.48, 5.3, 1.8),
        ((0.0, 0.24), 1.82, 0.23, 0.4, 1.35, 1.5),
        ((0.02, -0.28), 1.68, 0.22, 0.38, 4.15, -1.6),
        ((-0.42, -0.2), 1.48, 0.2, 0.52, 3.05, 1.8),
        ((0.43, 0.17), 1.55, 0.2, 0.5, 0.1, -1.8),
    ]
    for i, (base, height, width, bend, phase, twist) in enumerate(middle_specs):
        create_flame_tongue(
            f"CyanFlame.{i:02d}", base, height, width, bend, phase, twist, cyan, flatten=0.72
        )

    # Thin outer blue tongues curl farther away like the reference image.
    outer_specs = [
        ((-0.58, 0.05), 1.55, 0.15, 0.58, 2.8, -2.2),
        ((0.58, -0.03), 1.62, 0.15, 0.6, 5.9, 2.1),
        ((-0.46, 0.38), 1.32, 0.14, 0.48, 2.0, 2.2),
        ((0.5, 0.34), 1.2, 0.14, 0.5, 0.55, -2.3),
        ((-0.32, -0.48), 1.24, 0.13, 0.55, 3.75, -2.0),
        ((0.34, -0.5), 1.38, 0.14, 0.52, 4.7, 2.2),
        ((-0.72, -0.28), 0.92, 0.12, 0.48, 3.15, 2.4),
        ((0.72, 0.24), 0.98, 0.12, 0.5, 0.05, -2.4),
    ]
    for i, (base, height, width, bend, phase, twist) in enumerate(outer_specs):
        create_flame_tongue(
            f"OuterBlueFlame.{i:02d}",
            base,
            height,
            width,
            bend,
            phase,
            twist,
            blue if i % 2 == 0 else deep,
            rings=22,
            sides=16,
            flatten=0.58,
        )

    root = create_flicker_rig()
    animate_flicker(root)
    return root


def export_model(root):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in MODEL_OBJECTS:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_range=False,
        export_skins=True,
        export_def_bones=True,
        export_leaf_bone=False,
        export_lights=False,
        export_cameras=False,
        export_materials="EXPORT",
        export_normals=True,
        export_tangents=True,
        export_extras=True,
    )


def point_camera(camera, target):
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def render_preview():
    dark = flame_material("PreviewFloor", (0.003, 0.006, 0.018), 0.0, 1.0)
    bpy.ops.mesh.primitive_plane_add(size=16, location=(0, 0, 0))
    floor = bpy.context.object
    floor.name = "PreviewFloor"
    floor.data.materials.append(dark)

    bpy.ops.object.camera_add(location=(4.1, -5.2, 2.75))
    camera = bpy.context.object
    camera.name = "PreviewCamera"
    point_camera(camera, (0, 0, 1.25))
    camera.data.lens = 62
    bpy.context.scene.camera = camera

    for name, location, energy, color in (
        ("BlueBounce", (0, -1.4, 1.3), 700, (0.04, 0.35, 1.0)),
        ("CyanFill", (1.8, 0.8, 2.2), 500, (0.05, 0.8, 1.0)),
    ):
        data = bpy.data.lights.new(name, "POINT")
        data.energy = energy
        data.color = color
        data.shadow_soft_size = 2.0
        light = bpy.data.objects.new(name, data)
        light.location = location
        bpy.context.collection.objects.link(light)

    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW_PATH)
    scene.world.color = (0.0, 0.0, 0.004)
    scene.view_settings.look = "AgX - Medium High Contrast"

    # Use a stretched pose for the still image while keeping the saved clip
    # positioned at its seamless first frame.
    scene.frame_set(20)

    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.ops.render.render(write_still=True)
    scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))


if __name__ == "__main__":
    flame_root = build_flame()
    export_model(flame_root)
    render_preview()
    print(f"GLB: {GLB_PATH}")
    print(f"Blend source: {BLEND_PATH}")
    print(f"Preview: {PREVIEW_PATH}")
