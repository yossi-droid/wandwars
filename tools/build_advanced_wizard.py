"""Build the browser-ready Wizard Royale hero in Blender.

Run with:
  Blender --background --factory-startup --python tools/build_advanced_wizard.py

Outputs:
  public/models/wizard-advanced.glb
  art/wizard-advanced.blend
  art/wizard-advanced-preview.png
"""

import math
import os
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "public" / "models"
TEXTURE_DIR = MODEL_DIR / "textures"
ART_DIR = ROOT / "art"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
TEXTURE_DIR.mkdir(parents=True, exist_ok=True)
ART_DIR.mkdir(parents=True, exist_ok=True)

GLB_PATH = MODEL_DIR / "wizard-advanced.glb"
BLEND_PATH = ART_DIR / "wizard-advanced.blend"
PREVIEW_PATH = ART_DIR / "wizard-advanced-preview.png"

MODEL_OBJECTS = []


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.armatures,
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


def material(name, color, roughness=0.7, metallic=0.0, coat=0.0, sheen=0.0, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, 1.0)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    set_input(bsdf, "Base Color", (*color, 1.0))
    set_input(bsdf, "Roughness", roughness)
    set_input(bsdf, "Metallic", metallic)
    set_input(bsdf, "Coat Weight", coat)
    set_input(bsdf, "Coat Roughness", max(0.1, roughness * 0.7))
    set_input(bsdf, "Sheen Weight", sheen)
    if emission:
        set_input(bsdf, "Emission Color", (*emission, 1.0))
        set_input(bsdf, "Emission Strength", 3.0)
    return mat


def create_woven_texture(image_name, filename, base_color):
    size = 256
    path = TEXTURE_DIR / filename
    image = bpy.data.images.new(image_name, width=size, height=size, alpha=True)
    pixels = [0.0] * (size * size * 4)
    for y in range(size):
        for x in range(size):
            warp = 0.5 + 0.5 * math.sin(x * math.pi / 3.0)
            weft = 0.5 + 0.5 * math.sin(y * math.pi / 3.0)
            broad = 0.5 + 0.5 * math.sin((x + y) * math.pi / 34.0)
            thread = warp * 0.055 + weft * 0.04 + broad * 0.025
            shade = 0.88 + thread
            i = (y * size + x) * 4
            pixels[i] = min(1.0, base_color[0] * shade)
            pixels[i + 1] = min(1.0, base_color[1] * shade)
            pixels[i + 2] = min(1.0, base_color[2] * shade)
            pixels[i + 3] = 1.0
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    return image


def woven_material(name, image, base_color, roughness=0.88):
    mat = material(name, base_color, roughness=roughness, sheen=0.22)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.interpolation = "Linear"
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def smooth(obj):
    if obj.type == "MESH":
        for poly in obj.data.polygons:
            poly.use_smooth = True
    return obj


def add_bevel(obj, width=0.01, segments=3):
    if obj.type != "MESH":
        return
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new("Soft bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)


def register(obj, mat=None):
    if mat is not None:
        obj.data.materials.append(mat)
    smooth(obj)
    MODEL_OBJECTS.append(obj)
    return obj


def ellipsoid(name, location, scale, mat, segments=40, rings=24):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return register(obj, mat)


def rounded_box(name, location, scale, mat, bevel=0.035):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    register(obj, mat)
    add_bevel(obj, bevel, 4)
    return obj


def cylinder_between(name, start, end, radius, mat, vertices=28):
    start = Vector(start)
    end = Vector(end)
    direction = end - start
    length = direction.length
    midpoint = (start + end) * 0.5
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=length,
        location=midpoint,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return register(obj, mat)


def torus(name, location, major, minor, mat, rotation=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        major_segments=48,
        minor_segments=12,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return register(obj, mat)


def create_profile_mesh(name, rings, sides, mat):
    vertices = []
    faces = []
    for z, rx, ry in rings:
        for i in range(sides):
            a = i / sides * math.tau
            vertices.append((math.cos(a) * rx, math.sin(a) * ry, z))
    for ring in range(len(rings) - 1):
        for side in range(sides):
            n = (side + 1) % sides
            a = ring * sides + side
            b = ring * sides + n
            c = (ring + 1) * sides + side
            d = (ring + 1) * sides + n
            faces.append((a, b, d, c))
    faces.append(tuple(reversed(range(sides))))
    top = (len(rings) - 1) * sides
    faces.append(tuple(top + i for i in range(sides)))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    register(obj, mat)
    return obj


def create_open_skirt(name, mat):
    sides = 44
    levels = 8
    gap = math.radians(34)
    vertices = []
    faces = []
    for level in range(levels):
        t = level / (levels - 1)
        z = 0.38 + t * 0.68
        rx = 0.31 - t * 0.105
        ry = 0.41 - t * 0.145
        for i in range(sides):
            a = gap + (math.tau - gap * 2) * i / (sides - 1)
            # Slight folds keep the hem from reading as a perfect cone.
            fold = 1 + math.sin(a * 6) * 0.035 * (1 - t)
            vertices.append((math.cos(a) * rx * fold, math.sin(a) * ry * fold, z))
    for level in range(levels - 1):
        for side in range(sides - 1):
            a = level * sides + side
            b = a + 1
            c = (level + 1) * sides + side
            d = c + 1
            faces.append((a, b, d, c))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    register(obj, mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    solid = obj.modifiers.new("Cloth thickness", "SOLIDIFY")
    solid.thickness = 0.018
    solid.offset = 0
    bpy.ops.object.modifier_apply(modifier=solid.name)
    add_bevel(obj, 0.008, 3)
    return obj


def create_back_cape(name, mat):
    rows = [
        (1.49, -0.205, 0.285),
        (1.26, -0.225, 0.31),
        (0.98, -0.25, 0.345),
        (0.68, -0.275, 0.37),
        (0.43, -0.29, 0.39),
    ]
    columns = 11
    vertices = []
    faces = []
    for z, base_x, half_width in rows:
        for column in range(columns):
            u = column / (columns - 1)
            y = (u * 2 - 1) * half_width
            fold = math.cos(u * math.pi * 6) * 0.012
            vertices.append((base_x + fold, y, z))
    for row in range(len(rows) - 1):
        for column in range(columns - 1):
            a = row * columns + column
            b = a + 1
            c = (row + 1) * columns + column
            d = c + 1
            faces.append((a, b, d, c))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    register(obj, mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    solid = obj.modifiers.new("Cape thickness", "SOLIDIFY")
    solid.thickness = 0.016
    solid.offset = 0
    bpy.ops.object.modifier_apply(modifier=solid.name)
    add_bevel(obj, 0.007, 3)
    return obj


def create_bent_hat(name, mat):
    centers = [
        Vector((0.00, 0.00, 1.91)),
        Vector((-0.01, 0.00, 2.02)),
        Vector((-0.035, 0.00, 2.14)),
        Vector((-0.085, 0.015, 2.24)),
        Vector((-0.16, 0.035, 2.31)),
        Vector((-0.23, 0.06, 2.35)),
    ]
    samples = 36
    sides = 36
    curve = []
    for i in range(samples + 1):
        t = i / samples
        scaled = t * (len(centers) - 1)
        idx = min(len(centers) - 2, int(scaled))
        f = scaled - idx
        p = centers[idx].lerp(centers[idx + 1], f)
        curve.append(p)
    vertices = []
    faces = []
    for ring, center in enumerate(curve):
        t = ring / samples
        radius = 0.012 + 0.18 * math.pow(1 - t, 0.82)
        tangent = (
            curve[min(samples, ring + 1)] - curve[max(0, ring - 1)]
        ).normalized()
        side_axis = tangent.cross(Vector((0, 1, 0)))
        if side_axis.length < 0.001:
            side_axis = Vector((1, 0, 0))
        side_axis.normalize()
        other_axis = tangent.cross(side_axis).normalized()
        for side in range(sides):
            a = side / sides * math.tau
            offset = side_axis * (math.cos(a) * radius) + other_axis * (math.sin(a) * radius)
            vertices.append(center + offset)
    for ring in range(samples):
        for side in range(sides):
            n = (side + 1) % sides
            a = ring * sides + side
            b = ring * sides + n
            c = (ring + 1) * sides + side
            d = (ring + 1) * sides + n
            faces.append((a, b, d, c))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return register(obj, mat)


def create_star(name, location, size, depth, mat, face_back=False):
    # Five-point star extruded along X, suitable for the coat front/back.
    points = []
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5
        radius = size if i % 2 == 0 else size * 0.42
        points.append((math.cos(a) * radius, math.sin(a) * radius))
    x0 = -depth / 2
    x1 = depth / 2
    verts = [(x0, y, z) for y, z in points] + [(x1, y, z) for y, z in points]
    faces = [tuple(reversed(range(10))), tuple(range(10, 20))]
    for i in range(10):
        n = (i + 1) % 10
        faces.append((i, n, 10 + n, 10 + i))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    if face_back:
        obj.rotation_euler.z = math.pi
    register(obj, mat)
    add_bevel(obj, depth * 0.3, 2)
    return obj


def create_armature():
    arm_data = bpy.data.armatures.new("WizardSkeleton")
    arm = bpy.data.objects.new("WizardSkeleton", arm_data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    bones = {}

    def add(name, head, tail, parent=None):
        bone = arm_data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        bone.use_deform = True
        if parent:
            bone.parent = bones[parent]
        bones[name] = bone

    add("root", (0, 0, 0), (0, 0, 0.18))
    add("hips", (0, 0, 0.82), (0, 0, 1.06), "root")
    add("spine", (0, 0, 1.02), (0, 0, 1.34), "hips")
    add("chest", (0, 0, 1.31), (0, 0, 1.56), "spine")
    add("neck", (0, 0, 1.54), (0, 0, 1.68), "chest")
    add("head", (0, 0, 1.66), (0, 0, 1.9), "neck")
    for side, y in (("L", 0.31), ("R", -0.31)):
        add(f"upper_arm.{side}", (0, y, 1.49), (0, y, 1.21), "chest")
        add(f"forearm.{side}", (0, y, 1.21), (0.025, y, 0.96), f"upper_arm.{side}")
        add(f"hand.{side}", (0.025, y, 0.96), (0.12, y, 0.86), f"forearm.{side}")
    for side, y in (("L", 0.135), ("R", -0.135)):
        add(f"thigh.{side}", (0, y, 0.93), (0, y, 0.55), "hips")
        add(f"shin.{side}", (0, y, 0.55), (0.025, y, 0.19), f"thigh.{side}")
        add(f"foot.{side}", (0.025, y, 0.19), (0.25, y, 0.09), f"shin.{side}")

    bpy.ops.object.mode_set(mode="OBJECT")
    arm.show_in_front = True
    MODEL_OBJECTS.append(arm)
    return arm


def parent_to_bone(obj, arm, bone_name):
    world = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    obj.matrix_world = world


def reset_pose(arm):
    for bone in arm.pose.bones:
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = (0, 0, 0)
        bone.location = (0, 0, 0)
        bone.scale = (1, 1, 1)


def key_pose(arm, frame, rotations=None, locations=None):
    rotations = rotations or {}
    locations = locations or {}
    for name, value in rotations.items():
        bone = arm.pose.bones[name]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = value
        bone.keyframe_insert("rotation_euler", frame=frame, group=name)
    for name, value in locations.items():
        bone = arm.pose.bones[name]
        bone.location = value
        bone.keyframe_insert("location", frame=frame, group=name)


def make_action(arm, name, frame_end, poses):
    reset_pose(arm)
    action = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = action
    action.use_fake_user = True
    for frame, rotations, locations in poses:
        key_pose(arm, frame, rotations, locations)
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = frame_end
    return action


def create_animations(arm):
    idle = make_action(
        arm,
        "Idle",
        60,
        [
            (1, {"chest": (0, 0.015, 0), "head": (0, 0, -0.025)}, {"hips": (0, 0, 0)}),
            (30, {"chest": (0, -0.015, 0), "head": (0, 0, 0.025)}, {"hips": (0, 0, 0.012)}),
            (60, {"chest": (0, 0.015, 0), "head": (0, 0, -0.025)}, {"hips": (0, 0, 0)}),
        ],
    )
    # A complete heel-to-toe gait instead of simply swinging straight limbs.
    # The contact, down, passing, and up poses give each leg a planted phase and
    # a bent-knee recovery phase. Pelvis sway, shoulder counter-rotation, elbow
    # flex, and foot roll keep the upper body balanced and remove the robotic
    # marching look. Frame 33 exactly matches frame 1 for a seamless loop.
    def walk_pose(
        frame,
        left_thigh,
        right_thigh,
        left_knee,
        right_knee,
        left_foot,
        right_foot,
        left_arm,
        right_arm,
        left_elbow,
        right_elbow,
        hip_height,
        hip_sway,
        hip_turn,
    ):
        return (
            frame,
            {
                "hips": (hip_sway * 0.9, 0.035, hip_turn),
                "spine": (-hip_sway * 0.28, 0.028, -hip_turn * 0.42),
                "chest": (-hip_sway * 0.42, 0.022, -hip_turn * 0.72),
                "neck": (hip_sway * 0.12, -0.01, hip_turn * 0.18),
                "head": (hip_sway * 0.12, -0.012, hip_turn * 0.2),
                "thigh.L": (0.018, left_thigh, 0),
                "thigh.R": (-0.018, right_thigh, 0),
                "shin.L": (0, left_knee, 0),
                "shin.R": (0, right_knee, 0),
                "foot.L": (0, left_foot, 0),
                "foot.R": (0, right_foot, 0),
                "upper_arm.L": (0.075, left_arm, hip_turn * 0.22),
                "upper_arm.R": (-0.075, right_arm, hip_turn * 0.22),
                "forearm.L": (0, left_elbow, 0),
                "forearm.R": (0, right_elbow, 0),
            },
            {"hips": (0, hip_sway, hip_height)},
        )

    walk_poses = [
        # Left heel contact / right toe push-off.
        walk_pose(1, -0.48, 0.39, -0.12, -0.16, 0.20, -0.20, 0.33, -0.38, -0.22, -0.38, 0.0, 0.012, 0.045),
        # Weight settles over the planted left foot.
        walk_pose(5, -0.29, 0.31, -0.35, -0.20, 0.06, -0.28, 0.25, -0.29, -0.25, -0.43, -0.018, 0.018, 0.035),
        # Right leg passes underneath with the knee tucked for clearance.
        walk_pose(9, 0.02, 0.02, -0.10, -0.82, -0.08, 0.30, 0.03, -0.04, -0.31, -0.52, 0.005, 0.014, 0.0),
        # Body rises as the right leg reaches for its next step.
        walk_pose(13, 0.34, -0.35, -0.10, -0.50, -0.18, 0.22, -0.27, 0.31, -0.39, -0.27, 0.026, -0.006, -0.038),
        # Right heel contact / left toe push-off (mirror of frame 1).
        walk_pose(17, 0.39, -0.48, -0.16, -0.12, -0.20, 0.20, -0.38, 0.33, -0.38, -0.22, 0.0, -0.012, -0.045),
        # Weight settles over the planted right foot.
        walk_pose(21, 0.31, -0.29, -0.20, -0.35, -0.28, 0.06, -0.29, 0.25, -0.43, -0.25, -0.018, -0.018, -0.035),
        # Left leg passes underneath with a bent knee.
        walk_pose(25, 0.02, 0.02, -0.82, -0.10, 0.30, -0.08, -0.04, 0.03, -0.52, -0.31, 0.005, -0.014, 0.0),
        # Body rises as the left leg reaches forward.
        walk_pose(29, -0.35, 0.34, -0.50, -0.10, 0.22, -0.18, 0.31, -0.27, -0.27, -0.39, 0.026, 0.006, 0.038),
        walk_pose(33, -0.48, 0.39, -0.12, -0.16, 0.20, -0.20, 0.33, -0.38, -0.22, -0.38, 0.0, 0.012, 0.045),
    ]
    walk = make_action(arm, "Walk", 33, walk_poses)
    cast = make_action(
        arm,
        "Cast",
        30,
        [
            (1, {"upper_arm.R": (0, 0, 0), "forearm.R": (0, 0, 0), "chest": (0, 0, 0)}, {}),
            (
                9,
                {
                    "upper_arm.R": (0.05, -1.35, -0.08),
                    "forearm.R": (0, -0.42, 0),
                    "chest": (0, -0.1, 0.16),
                    "head": (0, 0.06, -0.08),
                },
                {},
            ),
            (
                16,
                {
                    "upper_arm.R": (-0.05, -1.72, -0.05),
                    "forearm.R": (0, -0.12, 0),
                    "chest": (0, 0.06, -0.12),
                },
                {},
            ),
            (30, {"upper_arm.R": (0, 0, 0), "forearm.R": (0, 0, 0), "chest": (0, 0, 0)}, {}),
        ],
    )
    climb = make_action(
        arm,
        "Climb",
        32,
        [
            (
                1,
                {
                    "upper_arm.L": (0.08, 2.75, 0.12),
                    "upper_arm.R": (-0.08, 2.2, -0.12),
                    "forearm.L": (0, -0.55, 0),
                    "forearm.R": (0, -1.0, 0),
                    "thigh.L": (0, -0.75, 0),
                    "thigh.R": (0, 0.25, 0),
                },
                {},
            ),
            (
                16,
                {
                    "upper_arm.L": (0.08, 2.2, 0.12),
                    "upper_arm.R": (-0.08, 2.75, -0.12),
                    "forearm.L": (0, -1.0, 0),
                    "forearm.R": (0, -0.55, 0),
                    "thigh.L": (0, 0.25, 0),
                    "thigh.R": (0, -0.75, 0),
                },
                {"hips": (0, 0, 0.035)},
            ),
            (
                32,
                {
                    "upper_arm.L": (0.08, 2.75, 0.12),
                    "upper_arm.R": (-0.08, 2.2, -0.12),
                    "forearm.L": (0, -0.55, 0),
                    "forearm.R": (0, -1.0, 0),
                    "thigh.L": (0, -0.75, 0),
                    "thigh.R": (0, 0.25, 0),
                },
                {},
            ),
        ],
    )
    jump = make_action(
        arm,
        "Jump",
        24,
        [
            (1, {}, {}),
            (
                6,
                {
                    "thigh.L": (0, -0.52, 0),
                    "thigh.R": (0, -0.52, 0),
                    "shin.L": (0, 0.85, 0),
                    "shin.R": (0, 0.85, 0),
                    "upper_arm.L": (0, 0.3, 0),
                    "upper_arm.R": (0, 0.3, 0),
                },
                {"hips": (0, 0, -0.04)},
            ),
            (
                13,
                {
                    "thigh.L": (0, -0.22, 0),
                    "thigh.R": (0, -0.22, 0),
                    "shin.L": (0, 0.45, 0),
                    "shin.R": (0, 0.45, 0),
                },
                {"hips": (0, 0, 0.11)},
            ),
            (24, {}, {}),
        ],
    )
    arm.animation_data.action = idle
    return [idle, walk, cast, climb, jump]


def build_model():
    clear_scene()
    linen_image = create_woven_texture(
        "LinenTunicTexture",
        "linen_tunic.png",
        (0.56, 0.48, 0.37),
    )
    olive_image = create_woven_texture(
        "OliveTrouserTexture",
        "olive_trousers.png",
        (0.13, 0.205, 0.055),
    )

    linen = woven_material("LinenTunic", linen_image, (0.56, 0.48, 0.37), roughness=0.92)
    linen_dark = material("LinenCuffs", (0.38, 0.31, 0.23), roughness=0.94, sheen=0.12)
    olive = woven_material("OliveTrousers", olive_image, (0.13, 0.205, 0.055), roughness=0.9)
    olive_dark = material("OliveCuffs", (0.075, 0.12, 0.035), roughness=0.95)
    hat_felt = material("WizardHatFelt", (0.018, 0.028, 0.065), roughness=0.96, sheen=0.12)
    gold = material("AntiqueGold", (0.72, 0.42, 0.055), roughness=0.28, metallic=0.88, coat=0.25)
    leather = material("DarkLeather", (0.055, 0.028, 0.018), roughness=0.55, coat=0.18)
    skin = material("WarmSkin", (0.58, 0.31, 0.19), roughness=0.62, sheen=0.08)
    hair = material("ChestnutHair", (0.055, 0.025, 0.012), roughness=0.88)
    beard = material("WizardBeard", (0.12, 0.065, 0.034), roughness=0.92)
    eye_white = material("EyeWhite", (0.85, 0.82, 0.73), roughness=0.35)
    iris = material("HazelEyes", (0.08, 0.035, 0.012), roughness=0.25, coat=0.25)
    wood = material("WandWood", (0.12, 0.045, 0.014), roughness=0.58, coat=0.2)
    glow = material(
        "WandGlow",
        (1.0, 0.55, 0.08),
        roughness=0.2,
        emission=(1.0, 0.25, 0.025),
    )

    arm = create_armature()

    # Loose olive trousers: full through the seat, thighs, and knees, then
    # gathered down into narrow ankle cuffs. Each articulated section overlaps
    # its neighbour so bent knees do not expose a gap.
    for side, y in (("L", 0.135), ("R", -0.135)):
        thigh = create_profile_mesh(
            f"LooseTrouserThigh.{side}",
            [
                (0.52, 0.115, 0.11),
                (0.58, 0.135, 0.13),
                (0.72, 0.145, 0.145),
                (0.86, 0.135, 0.135),
                (0.95, 0.12, 0.12),
            ],
            40,
            olive,
        )
        thigh.location.y = y
        shin = create_profile_mesh(
            f"TaperedTrouserLeg.{side}",
            [
                (0.18, 0.085, 0.08),
                (0.24, 0.1, 0.1),
                (0.39, 0.12, 0.125),
                (0.52, 0.13, 0.135),
                (0.58, 0.115, 0.115),
            ],
            40,
            olive,
        )
        shin.location.y = y
        foot = ellipsoid(f"Boot.{side}", (0.12, y, 0.105), (0.165, 0.105, 0.085), leather)
        parent_to_bone(thigh, arm, f"thigh.{side}")
        parent_to_bone(shin, arm, f"shin.{side}")
        parent_to_bone(foot, arm, f"foot.{side}")
        ankle_cuff = torus(
            f"TrouserCuff.{side}",
            (0.025, y, 0.19),
            0.105,
            0.017,
            olive_dark,
            scale=(0.9, 1, 1),
        )
        parent_to_bone(ankle_cuff, arm, f"shin.{side}")

    pelvis = create_profile_mesh(
        "OliveTrouserWaist",
        [
            (0.82, 0.145, 0.245),
            (0.9, 0.155, 0.265),
            (0.99, 0.14, 0.235),
            (1.04, 0.125, 0.205),
        ],
        44,
        olive,
    )
    parent_to_bone(pelvis, arm, "hips")

    # Untucked linen tunic hanging past the waist. The oval rings create a
    # recognisably human ribcage and a relaxed hem without the old puffy robe.
    torso = create_profile_mesh(
        "LooseLinenTunic",
        [
            (0.86, 0.165, 0.285),
            (0.91, 0.175, 0.3),
            (1.04, 0.16, 0.26),
            (1.2, 0.155, 0.25),
            (1.36, 0.17, 0.275),
            (1.43, 0.18, 0.3),
            (1.46, 0.175, 0.31),
            (1.5, 0.14, 0.215),
            (1.54, 0.105, 0.13),
        ],
        48,
        linen,
    )
    add_bevel(torso, 0.008, 3)
    parent_to_bone(torso, arm, "chest")

    # Folded standing collar around the open lace-up neckline.
    for side, y in (("L", 0.075), ("R", -0.075)):
        collar = rounded_box(
            f"LinenCollar.{side}",
            (0.202, y, 1.51),
            (0.02, 0.075, 0.043),
            linen_dark,
            0.012,
        )
        collar.rotation_euler.x = 0.2 if side == "L" else -0.2
        collar.rotation_euler.y = -0.16
        parent_to_bone(collar, arm, "chest")

    # Crossed leather laces and two loose hanging ends.
    for i, z in enumerate((1.46, 1.405, 1.35)):
        lace_a = cylinder_between(
            f"TunicLaceA.{i}",
            (0.224, -0.052, z + 0.018),
            (0.224, 0.052, z - 0.018),
            0.006,
            leather,
            16,
        )
        lace_b = cylinder_between(
            f"TunicLaceB.{i}",
            (0.226, 0.052, z + 0.018),
            (0.226, -0.052, z - 0.018),
            0.006,
            leather,
            16,
        )
        parent_to_bone(lace_a, arm, "chest")
        parent_to_bone(lace_b, arm, "chest")
    for side, y in (("L", 0.025), ("R", -0.025)):
        loose_lace = cylinder_between(
            f"LooseTunicLace.{side}",
            (0.224, y, 1.33),
            (0.23, y * 1.8, 1.19),
            0.006,
            leather,
            16,
        )
        parent_to_bone(loose_lace, arm, "chest")

    # Relaxed linen sleeves. Their broad, low tops tuck inward beneath the
    # widened tunic shoulder, making one smooth low-profile join instead of a
    # raised cap or a separate shoulder pad.
    for side, y in (("L", 0.31), ("R", -0.31)):
        upper = create_profile_mesh(
            f"LooseUpperSleeve.{side}",
            [
                (1.18, 0.077, 0.077),
                (1.23, 0.09, 0.09),
                (1.34, 0.1, 0.1),
                (1.39, 0.105, 0.105),
                (1.42, 0.11, 0.11),
                (1.43, 0.105, 0.105),
            ],
            36,
            linen,
        )
        upper.location.y = y * 0.92
        elbow = ellipsoid(f"LinenElbow.{side}", (0.005, y, 1.2), (0.084, 0.085, 0.082), linen)
        forearm = create_profile_mesh(
            f"LooseForeSleeve.{side}",
            [
                (0.96, 0.068, 0.068),
                (1.0, 0.086, 0.087),
                (1.09, 0.09, 0.095),
                (1.18, 0.083, 0.085),
                (1.23, 0.073, 0.075),
            ],
            36,
            linen,
        )
        forearm.location.y = y
        hand = ellipsoid(f"Hand.{side}", (0.075, y, 0.91), (0.063, 0.052, 0.076), skin)
        parent_to_bone(upper, arm, f"upper_arm.{side}")
        parent_to_bone(elbow, arm, f"forearm.{side}")
        parent_to_bone(forearm, arm, f"forearm.{side}")
        parent_to_bone(hand, arm, f"hand.{side}")
        cuff = torus(
            f"GatheredLinenCuff.{side}",
            (0.045, y, 0.975),
            0.085,
            0.016,
            linen_dark,
            scale=(0.86, 1, 1),
        )
        parent_to_bone(cuff, arm, f"forearm.{side}")

    neck = cylinder_between("Neck", (0, 0, 1.54), (0, 0, 1.68), 0.065, skin, 32)
    parent_to_bone(neck, arm, "neck")
    head = ellipsoid("Head", (0.015, 0, 1.77), (0.112, 0.097, 0.135), skin, 48, 32)
    parent_to_bone(head, arm, "head")
    for side, y in (("L", 0.108), ("R", -0.108)):
        ear = ellipsoid(f"Ear.{side}", (0, y, 1.77), (0.022, 0.014, 0.034), skin, 24, 16)
        parent_to_bone(ear, arm, "head")
        eye = ellipsoid(f"EyeWhite.{side}", (0.119, y * 0.35, 1.795), (0.012, 0.017, 0.01), eye_white, 24, 16)
        pupil = ellipsoid(f"Iris.{side}", (0.129, y * 0.35, 1.795), (0.006, 0.008, 0.006), iris, 20, 12)
        parent_to_bone(eye, arm, "head")
        parent_to_bone(pupil, arm, "head")
        brow = ellipsoid(
            f"Eyebrow.{side}",
            (0.126, y * 0.35, 1.818),
            (0.01, 0.022, 0.006),
            hair,
            20,
            12,
        )
        brow.rotation_euler.x = 0.12 if side == "L" else -0.12
        parent_to_bone(brow, arm, "head")
    nose = ellipsoid("Nose", (0.13, 0, 1.755), (0.025, 0.021, 0.032), skin, 28, 18)
    parent_to_bone(nose, arm, "head")
    hair_cap = ellipsoid("HairCap", (-0.025, 0, 1.805), (0.13, 0.116, 0.135), hair, 40, 24)
    parent_to_bone(hair_cap, arm, "head")
    beard_main = ellipsoid("Beard", (0.085, 0, 1.65), (0.067, 0.082, 0.135), beard, 36, 24)
    parent_to_bone(beard_main, arm, "head")
    for side, y in (("L", 0.04), ("R", -0.04)):
        mustache = ellipsoid(f"Mustache.{side}", (0.126, y, 1.71), (0.035, 0.027, 0.014), beard, 24, 14)
        mustache.rotation_euler.x = 0.2 if side == "L" else -0.2
        parent_to_bone(mustache, arm, "head")

    brim = ellipsoid("HatBrim", (0, 0, 1.91), (0.31, 0.31, 0.026), hat_felt, 64, 20)
    parent_to_bone(brim, arm, "head")
    crown = create_bent_hat("BentWizardHat", hat_felt)
    parent_to_bone(crown, arm, "head")
    hat_band = torus("HatBand", (0, 0, 1.91), 0.184, 0.014, gold)
    parent_to_bone(hat_band, arm, "head")

    # Wand, grip, and luminous tip attached to the right hand.
    wand_start = (0.095, -0.31, 0.9)
    wand_end = (0.61, -0.31, 1.18)
    wand = cylinder_between("WizardWand", wand_start, wand_end, 0.018, wood, 28)
    parent_to_bone(wand, arm, "hand.R")
    direction = (Vector(wand_end) - Vector(wand_start)).normalized()
    for i, t in enumerate((0.16, 0.42, 0.68)):
        center = Vector(wand_start).lerp(Vector(wand_end), t)
        ring = torus(
            f"WandGrip.{i}",
            center,
            0.024,
            0.006,
            gold,
        )
        ring.rotation_mode = "QUATERNION"
        ring.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction)
        parent_to_bone(ring, arm, "hand.R")
    tip = ellipsoid("WandGem", wand_end, (0.045, 0.045, 0.045), glow, 32, 20)
    parent_to_bone(tip, arm, "hand.R")

    actions = create_animations(arm)
    arm["animationClips"] = [action.name for action in actions]
    # Narrow the complete rig laterally while preserving height, limb length,
    # animation, and the +X forward direction. Because every mesh is bone-
    # parented, this produces a consistently slimmer body and outfit without
    # pulling the shoulders or hands away from their joints.
    arm.scale.y = 0.84
    arm["modelVersion"] = "1.1-thinner"
    arm["forwardAxis"] = "+X"
    return arm


def export_model(arm):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in MODEL_OBJECTS:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = arm
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
        export_morph=False,
        export_lights=False,
        export_cameras=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
        export_tangents=True,
        export_extras=True,
    )


def point_camera(camera, target):
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_preview(arm):
    reset_pose(arm)
    # Preview stage is not part of the selected/exported asset.
    ground_mat = material("PreviewGround", (0.018, 0.024, 0.04), roughness=0.82)
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
    ground = bpy.context.object
    ground.data.materials.append(ground_mat)

    bpy.ops.object.camera_add(location=(4.0, -3.7, 2.65))
    camera = bpy.context.object
    point_camera(camera, (0, 0, 1.15))
    camera.data.lens = 68
    bpy.context.scene.camera = camera

    for name, loc, energy, size, color in (
        ("Key", (3.5, -3.0, 5.0), 1100, 4.0, (1.0, 0.78, 0.58)),
        ("Fill", (1.2, 4.0, 2.8), 780, 3.2, (0.35, 0.55, 1.0)),
        ("Rim", (-3.0, -1.2, 4.0), 900, 2.5, (0.58, 0.35, 1.0)),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        data.color = color
        light = bpy.data.objects.new(name, data)
        light.location = loc
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
    scene.render.film_transparent = False
    scene.world.color = (0.006, 0.008, 0.02)
    scene.view_settings.look = "AgX - Medium High Contrast"
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    wizard_armature = build_model()
    export_model(wizard_armature)
    render_preview(wizard_armature)
    print(f"GLB: {GLB_PATH}")
    print(f"Blend source: {BLEND_PATH}")
    print(f"Preview: {PREVIEW_PATH}")
