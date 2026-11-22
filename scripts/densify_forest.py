"""Add a dense, shared-mesh pine canopy to the forest in the beach map."""

from pathlib import Path
import math
import random

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "art" / "wizard-royale-dense-forest-map.blend"
PREVIEW = ROOT / "art" / "wizard-royale-dense-forest-map-preview.png"
CLOSEUP = ROOT / "art" / "wizard-royale-dense-forest-closeup.png"

name = "Forest — Dense Pine Canopy"
old = bpy.data.collections.get(name)
if old:
    for obj in list(old.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(old)
trees = bpy.data.collections.new(name)
bpy.context.scene.collection.children.link(trees)

# Reuse the original forest tree's silhouette, then share its joined mesh
# between all added trees so the dense canopy stays easy to work with.
source_parts = [bpy.data.objects[label] for label in (
    "Forest pine trunk 01", "Forest pine lower boughs 01",
    "Forest pine upper boughs 01", "Forest pine crown 01",
)]
cx, cy = source_parts[0].location.x, source_parts[0].location.y
bpy.ops.object.select_all(action="DESELECT")
parts = []
for source in source_parts:
    obj = source.copy()
    obj.data = source.data.copy()
    obj.location.x -= cx
    obj.location.y -= cy
    trees.objects.link(obj)
    obj.select_set(True)
    parts.append(obj)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
template = bpy.context.object
bpy.context.scene.cursor.location = (0, 0, 0)
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
mesh = template.data
mesh.name = "Shared forest pine mesh"

variants = [mesh]
for variant, factor in ((1, 0.86), (2, 1.13)):
    data = mesh.copy()
    data.name = f"Shared forest pine shade {variant}"
    for index, material in enumerate(data.materials):
        if "needles" not in material.name and "tips" not in material.name:
            continue
        shade = material.copy()
        shade.name = f"Dense pine shade {variant} {index}"
        color = material.diffuse_color
        adjusted = tuple(min(1, channel * factor) for channel in color[:3])
        shade.diffuse_color = (*adjusted, 1)
        bsdf = shade.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (*adjusted, 1)
        data.materials[index] = shade
    variants.append(data)

forest = bpy.data.collections["Forest — Whispering Pines"]
existing = [(o.location.x, o.location.y) for o in forest.objects
            if o.name.startswith("Forest pine trunk")]
stones = [(o.location.x, o.location.y, max(o.dimensions.x, o.dimensions.y) / 2)
          for o in forest.objects if o.name.startswith("Forest standing stone")]
rng = random.Random(71204)
positions = []
for attempt in range(30000):
    if len(positions) >= 180:
        break
    x = rng.uniform(-42.25, -21.45)
    y = rng.uniform(-27.55, -12.80)
    # Keep the hut and its south-facing entrance clear, plus narrow access
    # routes toward the mountain edge and the town on the east.
    if math.hypot(x + 31.6, y + 17.8) < 2.65:
        continue
    if abs(x + 31.6) < 0.68 and y > -17.8:
        continue
    if abs(y + 19.5) < 0.58 and x > -31.6:
        continue
    if any(math.hypot(x - ex, y - ey) < 1.45 for ex, ey in existing):
        continue
    if any(math.hypot(x - sx, y - sy) < radius + 0.55
           for sx, sy, radius in stones):
        continue
    if any(math.hypot(x - px, y - py) < 1.03 for px, py in positions):
        continue
    positions.append((x, y))

for index, (x, y) in enumerate(positions, start=1):
    obj = bpy.data.objects.new(f"Dense forest pine {index:03d}", rng.choice(variants))
    trees.objects.link(obj)
    obj.location = (x, y, 0)
    width = rng.uniform(0.58, 0.80)
    obj.scale = (width, width, rng.uniform(0.62, 0.88))
    obj.rotation_euler.z = rng.uniform(0, math.tau)
bpy.data.objects.remove(template, do_unlink=True)
trees["added_tree_count"] = len(positions)

scene = bpy.context.scene
camera = scene.camera
scene.render.resolution_x = 1600
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(PREVIEW)
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
bpy.ops.render.render(write_still=True)
if camera:
    camera.location.x = -31.5
    camera.location.y = -20.0
    camera.data.ortho_scale = 29
    scene.render.filepath = str(CLOSEUP)
    bpy.ops.render.render(write_still=True)
print(f"Added {len(positions)} trees")
print(f"Saved {OUTPUT}")
