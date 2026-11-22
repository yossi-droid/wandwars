import bpy
import math
from mathutils import Matrix, Vector


ROOT = "/Users/michaelcaras/Desktop/new-game"
SOURCE = f"{ROOT}/art/castle-desert-mountains-line.blend"
OUTPUT = f"{ROOT}/art/castle-desert-mountains-circle.blend"
GLB = f"{ROOT}/public/models/castle-desert-mountains-circle.glb"
PREVIEW = f"{ROOT}/art/castle-desert-mountains-circle-preview.png"
TOPDOWN = f"{ROOT}/art/castle-desert-mountains-circle-topdown.png"

PIVOT = Vector((-12.2, 0.0, 0.0))
ROTATION = -math.pi / 2
MOVE_TAGS = {"Mountains", "Castle Mountain Transition"}


def bounds(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        min(point.x for point in points),
        max(point.x for point in points),
        min(point.y for point in points),
        max(point.y for point in points),
    )


moving = [obj for obj in bpy.context.scene.objects if obj.get("region_module") in MOVE_TAGS]
if len(moving) != 778:
    raise RuntimeError(f"Expected 778 mountain/transition objects, found {len(moving)}")
if any(obj.parent for obj in moving):
    raise RuntimeError("Mountain move expects unparented region objects")

transform = (
    Matrix.Translation(PIVOT)
    @ Matrix.Rotation(ROTATION, 4, "Z")
    @ Matrix.Translation(-PIVOT)
)
for obj in moving:
    obj.matrix_world = transform @ obj.matrix_world

mountains = [obj for obj in moving if obj.get("region_module") == "Mountains"]
transition = [
    obj for obj in moving if obj.get("region_module") == "Castle Mountain Transition"
]
castle = [
    obj
    for obj in bpy.context.scene.objects
    if obj.get("region_module") == "Castle" and obj.type in {"MESH", "CURVE"}
]
mountain_bounds = bounds(mountains)
transition_bounds = bounds(transition)
castle_bounds = bounds(castle)

# The rotated module should now be north of the castle. Its southern terrain
# edge and the transition overlap the castle edge slightly to avoid a crack.
mountain_center_x = (mountain_bounds[0] + mountain_bounds[1]) / 2
if abs(mountain_center_x - PIVOT.x) > 0.05:
    raise RuntimeError(f"Mountain center missed target: x={mountain_center_x:.3f}")
if transition_bounds[2] > castle_bounds[3] + 0.05:
    raise RuntimeError("Transition no longer meets the castle terrain")
if transition_bounds[3] < mountain_bounds[2] - 0.05:
    raise RuntimeError("Transition no longer reaches the mountain terrain")

# Refresh the preview camera around the new three-region footprint.
camera = bpy.context.scene.camera
if camera is None:
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    bpy.context.scene.camera = camera
camera.name = "Three Region Circle Layout Camera"
camera.data.type = "ORTHO"
camera.data.ortho_scale = 56
camera.location = (0.0, 12.5, 64.0)
camera.rotation_euler = (Vector((0.0, 12.5, 0.0)) - camera.location).to_track_quat(
    "-Z", "Y"
).to_euler()

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1500
scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = TOPDOWN
scene.view_settings.look = "AgX - Medium High Contrast"

bpy.ops.wm.save_as_mainfile(filepath=OUTPUT)
bpy.ops.render.render(write_still=True)

# Export gameplay-ready geometry separately without cameras and lights.
bpy.ops.object.select_all(action="DESELECT")
for obj in bpy.context.scene.objects:
    if obj.type in {"MESH", "CURVE"} and obj.get("region_module"):
        obj.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=GLB,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_materials="EXPORT",
    export_extras=True,
)

# Save an angled overview as well, then restore the top-down editing view.
camera.location = (44.0, -48.0, 51.0)
camera.rotation_euler = (Vector((0.0, 12.0, 1.0)) - camera.location).to_track_quat(
    "-Z", "Y"
).to_euler()
camera.data.ortho_scale = 61
scene.render.resolution_x = 1600
scene.render.resolution_y = 1000
scene.render.filepath = PREVIEW
bpy.ops.render.render(write_still=True)
camera.location = (0.0, 12.5, 64.0)
camera.rotation_euler = (Vector((0.0, 12.5, 0.0)) - camera.location).to_track_quat(
    "-Z", "Y"
).to_euler()
camera.data.ortho_scale = 56
scene.render.resolution_x = 1500
scene.render.resolution_y = 1200
scene.render.filepath = TOPDOWN
bpy.ops.wm.save_as_mainfile(filepath=OUTPUT)

print(
    "MOUNTAIN MOVE VERIFIED "
    f"mountains={tuple(round(value, 2) for value in mountain_bounds)} "
    f"transition={tuple(round(value, 2) for value in transition_bounds)} "
    f"castle={tuple(round(value, 2) for value in castle_bounds)}"
)
print(f"SAVED {OUTPUT}\nEXPORTED {GLB}\nRENDERED {PREVIEW}\nTOPDOWN {TOPDOWN}")
