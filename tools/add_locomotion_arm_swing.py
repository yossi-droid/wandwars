"""Build clean walk, run, jump, and climb motion for the fitted wizard rig."""

from math import pi, sin
from pathlib import Path

import bpy
from mathutils import Quaternion


ROOT = Path(__file__).resolve().parents[1]
SOURCE_BLEND = ROOT / "art" / "wizard-advanced-animations-smooth.blend"
OUTPUT_BLEND = ROOT / "art" / "wizard-advanced-armswing.blend"


def remove_bone_curves(action, bone_names):
    paths = {f'pose.bones["{name}"]' for name in bone_names}
    for layer in action.layers:
        for strip in layer.strips:
            for channelbag in strip.channelbags:
                for curve in list(channelbag.fcurves):
                    if any(path in curve.data_path for path in paths):
                        channelbag.fcurves.remove(curve)


def set_rotation(bone_name, angle, frame):
    bone = armature.pose.bones[bone_name]
    bone.rotation_mode = "QUATERNION"
    bone.location = (0.0, 0.0, 0.0)
    bone.scale = (1.0, 1.0, 1.0)
    bone.rotation_quaternion = Quaternion((0.0, 0.0, 1.0), angle)
    bone.keyframe_insert("rotation_quaternion", frame=frame, group=bone_name)


def add_finger_part(parent, name, location, scale, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=8)
    part = bpy.context.object
    part.name = name
    part.parent = parent
    part.location = location
    part.rotation_euler = rotation
    part.scale = scale
    if parent.data.materials:
        part.data.materials.append(parent.data.materials[0])
    for polygon in part.data.polygons:
        polygon.use_smooth = True
    return part


def add_detailed_hands():
    for side in ("L", "R"):
        palm = bpy.data.objects[f"Hand.{side}"]
        # Turn the original round mitten into a more hand-shaped palm.
        palm.data = palm.data.copy()
        for vertex in palm.data.vertices:
            vertex.co.x *= 0.90
            vertex.co.y *= 0.78
            vertex.co.z *= 0.76

        # Four two-joint fingers. On the weapon hand they curl around the wand
        # shaft, whose authored grip passes directly beside the palm origin.
        for index, z in enumerate((-0.046, -0.016, 0.016, 0.046), start=1):
            y_sign = -1.0 if side == "R" else 1.0
            add_finger_part(
                palm,
                f"Finger.{side}.{index}.Base",
                (0.010, y_sign * 0.046, z),
                (0.017, 0.037, 0.015),
                (0.18 * y_sign, 0.0, 0.06 * (index - 2.5)),
            )
            add_finger_part(
                palm,
                f"Finger.{side}.{index}.Tip",
                (0.014, -y_sign * 0.014, z - 0.004),
                (0.016, 0.027, 0.014),
                (0.62 * y_sign, 0.0, 0.08 * (index - 2.5)),
            )

        # Angled thumb closes the weapon hand's grip and gives the open hand a
        # recognizable silhouette from the gameplay camera.
        thumb_sign = -1.0 if side == "R" else 1.0
        add_finger_part(
            palm,
            f"Thumb.{side}.Base",
            (-0.040, thumb_sign * 0.020, 0.050),
            (0.035, 0.019, 0.020),
            (0.35 * thumb_sign, 0.35, 0.58 * thumb_sign),
        )
        add_finger_part(
            palm,
            f"Thumb.{side}.Tip",
            (-0.008, -thumb_sign * 0.006, 0.056),
            (0.025, 0.017, 0.018),
            (0.65 * thumb_sign, 0.25, 0.78 * thumb_sign),
        )


bpy.ops.wm.open_mainfile(filepath=str(SOURCE_BLEND))
scene = bpy.context.scene
armature = bpy.data.objects["WizardSkeleton"]
armature.animation_data_create()
add_detailed_hands()

limbs = (
    "upper_arm.L",
    "upper_arm.R",
    "forearm.L",
    "forearm.R",
    "hand.L",
    "hand.R",
    "thigh.L",
    "thigh.R",
    "shin.L",
    "shin.R",
    "foot.L",
    "foot.R",
)

# Straight fore/aft gait. The planted leg travels backward relative to the
# moving character at the same time that the other leg advances, which stops
# the foot from skating while keeping the legs in separate left/right lanes.
for action_name, arm_amplitude, leg_amplitude, knee_bend, resting_knee_bend in (
    ("Walk", 1.12, 0.58, 0.62, 0.14),
    ("Run", 1.30, 0.82, 0.92, 0.20),
):
    action = bpy.data.actions[action_name]
    armature.animation_data.action = action
    start, end = (int(round(value)) for value in action.frame_range)
    span = max(1, end - start)
    remove_bone_curves(action, limbs)

    for frame in range(start, end + 1):
        phase = 2.0 * pi * (frame - start) / span
        stride = sin(phase)
        set_rotation("upper_arm.L", arm_amplitude * stride, frame)
        set_rotation("upper_arm.R", -arm_amplitude * stride, frame)
        set_rotation("forearm.L", 0.18, frame)
        set_rotation("forearm.R", 0.18, frame)
        set_rotation("hand.L", 0.28 * stride, frame)
        # Turn the weapon wrist through the stride as well as the shoulder.
        # This makes the held item visibly travel with the hand from the game's
        # rear camera instead of only moving toward/away from the camera.
        set_rotation("hand.R", -0.58 * stride, frame)

        for side, direction in (("L", 1.0), ("R", -1.0)):
            signed_stride = direction * stride
            lift = max(0.0, signed_stride)
            set_rotation(f"thigh.{side}", -leg_amplitude * signed_stride, frame)
            # Keep both knees softly flexed throughout locomotion, then add
            # the larger lift bend to the advancing leg. This avoids a stiff,
            # locked-knee walk without making the wizard look crouched.
            set_rotation(f"shin.{side}", resting_knee_bend + knee_bend * lift, frame)
            set_rotation(
                f"foot.{side}",
                -resting_knee_bend * 0.45 - (knee_bend - leg_amplitude * 0.55) * lift,
                frame,
            )

# Upright athletic jump. Game physics supplies the height; this clip keeps the
# body long in the air with only a small knee bend, avoiding the deep squat
# silhouette that made the old jump look awkward.
jump = bpy.data.actions["JumpSmooth"]
armature.animation_data.action = jump
jump_start, jump_end = (int(round(value)) for value in jump.frame_range)
remove_bone_curves(jump, limbs + ("hips", "spine", "chest", "neck", "head"))
for frame in range(jump_start, jump_end + 1):
    progress = (frame - jump_start) / max(1, jump_end - jump_start)
    airborne = sin(pi * progress)
    for name in ("hips", "spine", "chest", "neck", "head"):
        set_rotation(name, 0.0, frame)
    set_rotation("upper_arm.L", -0.68 * airborne, frame)
    set_rotation("upper_arm.R", -0.68 * airborne, frame)
    set_rotation("forearm.L", 0.20 * airborne, frame)
    set_rotation("forearm.R", 0.20 * airborne, frame)
    set_rotation("hand.L", 0.0, frame)
    set_rotation("hand.R", 0.0, frame)
    for side in ("L", "R"):
        set_rotation(f"thigh.{side}", -0.16 * airborne, frame)
        set_rotation(f"shin.{side}", 0.27 * airborne, frame)
        set_rotation(f"foot.{side}", -0.10 * airborne, frame)

# Clean looping wall climb: opposite hand and foot reach together, with all
# motion confined to the forward/back plane of each limb.
climb = bpy.data.actions["Climb"]
armature.animation_data.action = climb
climb_start, climb_end = (int(round(value)) for value in climb.frame_range)
remove_bone_curves(climb, limbs + ("hips", "spine", "chest", "neck", "head"))
for frame in range(climb_start, climb_end + 1):
    phase = 2.0 * pi * (frame - climb_start) / max(1, climb_end - climb_start)
    stride = sin(phase)
    left_reach = 0.5 + 0.5 * stride
    right_reach = 1.0 - left_reach
    set_rotation("hips", 0.0, frame)
    set_rotation("spine", -0.10, frame)
    set_rotation("chest", -0.12, frame)
    set_rotation("neck", 0.08, frame)
    set_rotation("head", 0.04, frame)
    set_rotation("upper_arm.L", -(1.15 + 1.0 * left_reach), frame)
    set_rotation("upper_arm.R", -(1.15 + 1.0 * right_reach), frame)
    set_rotation("forearm.L", 0.48 + 0.42 * right_reach, frame)
    set_rotation("forearm.R", 0.48 + 0.42 * left_reach, frame)
    set_rotation("hand.L", 0.0, frame)
    set_rotation("hand.R", 0.0, frame)
    for side, lift in (("L", right_reach), ("R", left_reach)):
        set_rotation(f"thigh.{side}", -0.98 * lift, frame)
        set_rotation(f"shin.{side}", 1.34 * lift, frame)
        set_rotation(f"foot.{side}", -0.44 * lift, frame)

armature.animation_data.action = bpy.data.actions["Idle"]
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT_BLEND))
print(f"Saved {OUTPUT_BLEND}")
