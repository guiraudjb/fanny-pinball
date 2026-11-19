#!/usr/bin/env python3
"""Fondu Krea 2 (ComfyUI, inpainting à faible débruitage) des retouches du plateau :
la cigale collée dans l'arbre et son ancienne place comblée par la lavande.

Chaque zone : découpe 256 × 256 autour du masque, agrandie à 1024, VAEEncode → SetLatentNoiseMask →
KSampler (débruitage partiel) → VAEDecode ; seule la zone masquée (bords fondus) est recollée,
ramenée à sa taille, le reste du plateau reste au pixel près.

    python3 outils/lissage_krea2.py [--noeud http://192.168.1.210:8188] [--graine 5]
Entrée : assets/brut/plateau_11c.png + masques (outils/retouche_plateau.py) ; sortie : plateau_11k.png
"""
import argparse
import numpy as np
import io
import json
import os
import sys
import time
import urllib.request
import uuid
from pathlib import Path

from PIL import Image, ImageFilter

STUDIO = Path(os.environ.get("CHAT_STUDIO_DIR", "~/Projets/Dépots_Privés/chat-studio")).expanduser()
sys.path.insert(0, str(STUDIO))
import comfyui_client as cc  # noqa: E402
from presets.dict_styles import STYLE_PRESETS  # noqa: E402

BRUT = Path(__file__).resolve().parent.parent / "assets" / "brut"
STYLE = STYLE_PRESETS["🎨 [Comics] Moderne Cell-Shading (Défaut)"]
ZONES = [
    # (masque, dilatation px, érosion px (0 = disque plein ; > 0 = anneau sur le bord seulement), débruitage, description)
    ("haut", 10, 9, 0.70, "a funny cartoon cicada wearing black sunglasses sitting on a leafy green plane tree branch, "
                       "bright summer sunlight and yellow sun rays behind, flat vintage 1970s pinball art"),
    ("bas", 10, 0, 0.55, "lavender sprigs and long green olive leaves, flat vintage 1970s pinball art"),
]
TAILLE, ECHELLE = 256, 4


def envoyer(base, img, nom):
    """POST /upload/image (multipart) ; renvoie le nom côté ComfyUI."""
    buf = io.BytesIO(); img.save(buf, "PNG")
    limite = uuid.uuid4().hex
    corps = (f"--{limite}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{nom}\"\r\n"
             f"Content-Type: image/png\r\n\r\n").encode() + buf.getvalue() + \
            f"\r\n--{limite}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n--{limite}--\r\n".encode()
    req = urllib.request.Request(f"{base}/upload/image", data=corps,
                                 headers={"Content-Type": f"multipart/form-data; boundary={limite}"})
    return json.load(urllib.request.urlopen(req, timeout=60))["name"]


def graphe(image, masque, texte, graine, debruitage):
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "krea2_turbo_fp8_scaled.safetensors", "weight_dtype": "default"}},
        "3": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": 1.15}},
        "4": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_4b_fp8_scaled.safetensors", "type": "krea2", "device": "default"}},
        "5": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": texte, "clip": ["4", 0]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["4", 0]}},
        "8": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["7", 0]}},
        "13": {"class_type": "LoadImage", "inputs": {"image": image}},
        "14": {"class_type": "LoadImageMask", "inputs": {"image": masque, "channel": "red"}},
        "15": {"class_type": "VAEEncode", "inputs": {"pixels": ["13", 0], "vae": ["5", 0]}},
        "16": {"class_type": "SetLatentNoiseMask", "inputs": {"samples": ["15", 0], "mask": ["14", 0]}},
        "10": {"class_type": "KSampler", "inputs": {"model": ["3", 0], "positive": ["6", 0], "negative": ["8", 0],
                                                   "latent_image": ["16", 0], "seed": graine, "steps": 8, "cfg": 1.0,
                                                   "sampler_name": "euler", "scheduler": "simple", "denoise": debruitage}},
        "11": {"class_type": "VAEDecode", "inputs": {"samples": ["10", 0], "vae": ["5", 0]}},
        "12": {"class_type": "SaveImage", "inputs": {"images": ["11", 0], "filename_prefix": "fanny-pinball/lissage"}},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--noeud", default="http://192.168.1.210:8188")
    ap.add_argument("--graine", type=int, default=5)
    ap.add_argument("--zones", nargs="*", default=[], help="haut, bas (défaut : les deux)")
    ap.add_argument("--depart", default="plateau_11c.png", help="image de départ dans assets/brut")
    a = ap.parse_args()
    plateau = Image.open(BRUT / a.depart).convert("RGB")
    zones = [z for z in ZONES if not a.zones or z[0] in a.zones]
    for nom, dil, ero, deb, desc in zones:
        m = Image.open(BRUT / f"plateau_11c_masque_{nom}.png").convert("L")
        x0, y0, x1, y1 = m.getbbox()
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        box = (max(0, cx - TAILLE // 2), max(0, cy - TAILLE // 2))
        box = (min(box[0], plateau.width - TAILLE), min(box[1], plateau.height - TAILLE))
        box = (*box, box[0] + TAILLE, box[1] + TAILLE)
        mc = m.crop(box).point(lambda v: 255 if v > 128 else 0)
        zone = mc.filter(ImageFilter.MaxFilter(2 * (dil // 2) + 1)).filter(ImageFilter.MaxFilter(2 * (dil // 2) + 1))
        if ero:   # anneau : on garde intact le cœur du motif, on ne repeint que son bord (liseré, raccord)
            coeur = mc.filter(ImageFilter.MinFilter(2 * (ero // 2) + 1)).filter(ImageFilter.MinFilter(2 * (ero // 2) + 1))
            zone = Image.fromarray(np.minimum(np.asarray(zone), 255 - np.asarray(coeur)))
        big = plateau.crop(box).resize((TAILLE * ECHELLE,) * 2, Image.LANCZOS)
        bigm = zone.filter(ImageFilter.GaussianBlur(3)).resize((TAILLE * ECHELLE,) * 2, Image.LANCZOS)
        img_n = envoyer(a.noeud, big, f"fanny_lissage_{nom}.png")
        msk_n = envoyer(a.noeud, bigm.convert("RGB"), f"fanny_lissage_{nom}_masque.png")
        t0 = time.time()
        pid = cc._queue_prompt(graphe(img_n, msk_n, f"{desc}. {STYLE}", a.graine, deb), base=a.noeud)
        res = cc._wait_for_result(pid, timeout=1800, base=a.noeud)
        info = res["outputs"]["12"]["images"][0]
        out = Image.open(io.BytesIO(cc._fetch_image(info["filename"], info.get("subfolder", ""), info.get("type", "output"),
                                                    base=a.noeud))).convert("RGB")
        out.save(BRUT / f"_lissage_{nom}_1024.png")
        petit = out.resize((TAILLE, TAILLE), Image.LANCZOS)
        plateau.paste(petit, box[:2], zone.filter(ImageFilter.GaussianBlur(5)))
        print(f"zone {nom} : {box}, débruitage {deb}, {time.time() - t0:.0f} s", flush=True)
    plateau.save(BRUT / "plateau_11k.png")
    print("ok", BRUT / "plateau_11k.png")


if __name__ == "__main__":
    main()
