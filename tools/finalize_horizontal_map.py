import bpy
from mathutils import Vector


ROOT = "/Users/michaelcaras/Desktop/new-game"
OUTPUT = f"{ROOT}/art/wizard-royale-horizontal-map.blend"
GLB = f"{ROOT}/public/models/wizard-royale-horizontal-map.glb"
PREVIEW = f"{ROOT}/art/wizard-royale-horizontal-map-topdown.png"


def tagged_objects(tag):
    return [
        obj
        for obj in bpy.context.scene.objects
        if obj.get("region_module") == tag and obj.type in {"MESH", "CURVE"}
    ]


def bounds(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        min(point.x for point in points),
        max(point.x for point in points),
        min(point.y for point in points),
        max(point.y for point in points),
    )


mountains = tagged_objects("Mountains")
castle = tagged_objects("Castle")
desert = tagged_objects("Desert")
mountain_transition = tagged_objects("Castle Mountain Transition")

if not all((mountains, castle, desert, mountain_transition)):
    raise RuntimeError("One or more horizontal-map regions are missing")

mountain_bounds = bounds(mountains)
castle_bounds = bounds(castle)
desert_bounds = bounds(desert)
transition_bounds = bounds(mountain_transition)

# Required layout: mountains left, castle center, desert right.
if mountain_bounds[1] > castle_bounds[0] + 0.05:
    raise RuntimeError("Mountain region overlaps too far into the castle region")
if abs(mountain_bounds[1] - castle_bounds[0]) > 0.05:
    raise RuntimeError("Mountain and castle terrain edges do not meet")
if abs(castle_bounds[1] - desert_bounds[0]) > 0.05:
    raise RuntimeError("Castle and desert terrain edges do not meet")
if transition_bounds[0] > mountain_bounds[1] or transition_bounds[1] < castle_bounds[0]:
    raise RuntimeError("Mountain-to-castle transition does not bridge both regions")

scene = bpy.context.scene
camera = scene.camera
if camera is None:
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    scene.camera = camera
camera.name = "Wizard Royale Horizontal Map Camera"
camera.data.type = "ORTHO"
camera.data.ortho_scale = 35
camera.location = (-9.4, 0.0, 64.0)
camera.rotation_euler = (Vector((-9.4, 0.0, 0.0)) - camera.location).to_track_quat(
    "-Z", "Y"
).to_euler()

scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1800
scene.render.resolution_y = 760
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = PREVIEW
scene.view_settings.look = "AgX - Medium High Contrast"

bpy.ops.wm.save_as_mainfile(filepath=OUTPUT)
bpy.ops.render.render(write_still=True)

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

bpy.ops.wm.save_as_mainfile(filepath=OUTPUT)
print(
    "HORIZONTAL MAP VERIFIED "
    f"mountains={tuple(round(value, 2) for value in mountain_bounds)} "
    f"castle={tuple(round(value, 2) for value in castle_bounds)} "
    f"desert={tuple(round(value, 2) for value in desert_bounds)} "
    f"transition={tuple(round(value, 2) for value in transition_bounds)}"
)
print(f"SAVED {OUTPUT}\nEXPORTED {GLB}\nRENDERED {PREVIEW}")
