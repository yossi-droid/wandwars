"""Thin the dense forest slightly and place small cabins in clearings."""

from pathlib import Path
import math
import random

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "art" / "wizard-royale-forest-hamlet-map.blend"
PREVIEW = ROOT / "art" / "wizard-royale-forest-hamlet-map-preview.png"
CLOSEUP = ROOT / "art" / "wizard-royale-forest-hamlet-closeup.png"
forest = bpy.data.collections["Forest — Whispering Pines"]
canopy = bpy.data.collections["Forest — Dense Pine Canopy"]

center = Vector((-31.6, -17.8, -0.01))
house_parts = [bpy.data.objects[name] for name in (
    "Forest ranger hut", "Forest ranger hut roof", "Forest ranger hut door",
)]
for obj in house_parts:
    obj.location = center + (obj.location - center) * 0.55
    obj.scale *= 0.55

# Add four similarly small homes, each with its own open space around it.
sites = [
    (-38.0, -15.7, 0.92, -0.09, "Town red roofs"),
    (-24.7, -21.5, 0.85, 0.14, "Town blue roofs"),
    (-35.1, -24.2, 0.90, -0.12, "Ranger hut roof"),
    (-29.3, -24.4, 0.84, 0.09, "Town red roofs"),
]
for index, (x, y, scale, angle, roof_material) in enumerate(sites, start=1):
    for source, label in zip(house_parts, ("walls", "roof", "door")):
        obj = source.copy()
        obj.data = source.data.copy()
        obj.name = f"Forest cabin {index:02d} {label}"
        forest.objects.link(obj)
        local = (source.location - center) * scale
        rotated = Vector((local.x * math.cos(angle) - local.y * math.sin(angle),
                          local.x * math.sin(angle) + local.y * math.cos(angle),
                          local.z))
        obj.location = Vector((x, y, -0.01)) + rotated
        obj.scale *= scale
        obj.rotation_euler.z += angle
        if label == "roof":
            obj.data.materials.clear()
            obj.data.materials.append(next(material for material in bpy.data.materials
                                           if material.name.startswith(roof_material)))

clearings = [(x, y, 1.65) for x, y, *_ in sites]
for obj in list(canopy.objects):
    if any(math.hypot(obj.location.x - x, obj.location.y - y) < radius
           for x, y, radius in clearings):
        bpy.data.objects.remove(obj, do_unlink=True)

remaining = sorted(list(canopy.objects), key=lambda obj: obj.name)
target = 150
if len(remaining) > target:
    for obj in random.Random(831).sample(remaining, len(remaining) - target):
        bpy.data.objects.remove(obj, do_unlink=True)
canopy["added_tree_count"] = len(canopy.objects)

bpy.ops.object.select_all(action="DESELECT")
scene = bpy.context.scene
camera = scene.camera
scene.render.filepath = str(PREVIEW)
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
bpy.ops.render.render(write_still=True)
camera.location.x = -31.5
camera.location.y = -20
camera.data.ortho_scale = 29
scene.render.filepath = str(CLOSEUP)
bpy.ops.render.render(write_still=True)
print(f"Forest has {len(canopy.objects)} added pines and five small houses")
print(f"Saved {OUTPUT}")
