"""Reduce the forest trees by fifteen percent, keeping their feet on the ground."""

from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "art" / "wizard-royale-forest-smaller-trees.blend"
PREVIEW = ROOT / "art" / "wizard-royale-forest-smaller-trees-preview.png"
CLOSEUP = ROOT / "art" / "wizard-royale-forest-smaller-trees-closeup.png"
factor = 0.85

canopy = bpy.data.collections["Forest — Dense Pine Canopy"]
for obj in canopy.objects:
    obj.scale *= factor

forest = bpy.data.collections["Forest — Whispering Pines"]
for obj in forest.objects:
    if obj.name.startswith("Forest pine "):
        obj.location.z *= factor
        obj.scale *= factor

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
print(f"Saved {OUTPUT}; forest trees are 15 percent smaller")
