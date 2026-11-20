"""Rendu de contrôle de l'assemblage (Blender, Cycles sur processeur).

    blender -b -P cao/rendu_blender.py          (sur un nœud qui a Blender ; ~/Projets est partagé)
Entrée : cao/sortie/rendu/<matière>.stl (cao/construire.py) ; sortie : cao/sortie/rendu/vue_*.png
"""
import math
import os

import bpy
from mathutils import Vector

ICI = os.path.dirname(os.path.abspath(__file__))
R = os.path.join(ICI, "sortie", "rendu")
COUL = {"bois": (0.62, 0.45, 0.28, 1), "imprime": (0.49, 0.42, 0.72, 1), "achat": (0.85, 0.2, 0.15, 1),
        "metal": (0.75, 0.76, 0.78, 1), "verre": (0.7, 0.85, 0.95, 0.15), "dessous": (0.2, 0.6, 0.35, 1)}

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 48
sc.render.resolution_x, sc.render.resolution_y = 1400, 1050
sc.world = bpy.data.worlds.new("monde")
sc.world.use_nodes = True
sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.93, 0.92, 0.9, 1)
sc.world.node_tree.nodes["Background"].inputs[1].default_value = 0.9

objs = []
for cat, col in COUL.items():
    f = os.path.join(R, f"{cat}.stl")
    if not os.path.exists(f):
        continue
    bpy.ops.wm.stl_import(filepath=f, global_scale=0.001)
    o = bpy.context.selected_objects[0]
    o.name = cat
    m = bpy.data.materials.new(cat); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = col
    b.inputs["Roughness"].default_value = 0.5
    if cat == "verre":
        b.inputs["Alpha"].default_value = col[3]
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else None
    if cat == "metal":
        b.inputs["Metallic"].default_value = 0.9
    o.data.materials.append(m)
    objs.append(o)

soleil = bpy.data.objects.new("soleil", bpy.data.lights.new("soleil", "SUN"))
soleil.data.energy = 3.0
soleil.rotation_euler = (math.radians(40), math.radians(15), math.radians(30))
bpy.context.collection.objects.link(soleil)

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
bpy.context.collection.objects.link(cam)
sc.camera = cam


def viser(pos, cible, lens=35):
    cam.location = Vector(pos)
    cam.rotation_euler = (Vector(cible) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens


vues = {
    "vue_ensemble": ((2.3, -1.6, 1.9), (0.28, 0.65, 0.45), 32),
    "vue_plateau": ((0.28, 0.45, 2.6), (0.28, 0.62, 0.40), 40),
    "vue_cote": ((2.6, 0.65, 0.5), (0.28, 0.65, 0.5), 28),
    "vue_dessous": ((1.4, -0.5, -0.4), (0.28, 0.55, 0.30), 35),
}
for nom, (pos, cible, lens) in vues.items():
    if nom == "vue_plateau":
        for o in objs:
            o.hide_render = o.name in ("verre",)
    viser(pos, cible, lens)
    sc.render.filepath = os.path.join(R, f"{nom}.png")
    bpy.ops.render.render(write_still=True)
    print("rendu", nom, flush=True)
