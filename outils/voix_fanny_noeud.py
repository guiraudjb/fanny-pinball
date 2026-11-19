#!/usr/bin/env python3
"""Tourne SUR le nœud GPU (VoiceStudio en 127.0.0.1:3900), lancé par outils/voix_fanny.py depuis Pilote2.

1. demucs isole la voix chantée du générique YuE2 (piste « vocals ») ;
2. le premier couplet chanté est repéré par les silences ; ses deux premiers vers servent de référence ;
3. profil VoiceStudio « clone » (voix de synthèse YuE2, aucune personne réelle : déclaration d'origine) ;
4. chaque réplique de outils/voix_fanny.json est générée → assets/sons/00NN.mp3.
"""
import json, os, re, subprocess, sys, time
import requests

VS = "http://127.0.0.1:3900"
ICI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRUT = f"{ICI}/assets/brut/voix"
SONS = f"{ICI}/assets/sons"
CHANSON = f"{ICI}/assets/brut/musique/generique_1970/yue2/fanny_generique_1970/audio.flac"
VS_PY = os.path.expanduser("~/VoiceStudio/.venv/bin/python")
NOM = "FannyPinball_Fanny"
REF_TEXTE = "Sous les platanes il fait si chaud. Les cigales chantent tout là-haut."
CONSENTEMENT = ("Voix de synthèse : chant généré par YuE2 (générique Fanny Pinball, graine 1970), aucune personne "
                "réelle. Usage : annonces du jeu Fanny Pinball, à partir du 20/11/26.")
os.makedirs(BRUT, exist_ok=True)


def ff(*a):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *a], check=True)


def isoler_voix():
    voc = f"{BRUT}/htdemucs/audio/vocals.wav"
    if not os.path.exists(voc):
        print("demucs : séparation de la voix…", flush=True)
        subprocess.run([VS_PY, "-m", "demucs", "-n", "htdemucs", "--two-stems", "vocals", "-o", BRUT, CHANSON], check=True)
    return voc


def premier_couplet(voc):
    """(début, fin) des deux premiers vers : premières phrases chantées séparées par des silences ≥ 0,25 s."""
    p = subprocess.run(["ffmpeg", "-i", voc, "-af", "silencedetect=noise=-35dB:d=0.25", "-f", "null", "-"],
                       capture_output=True, text=True)
    fins = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", p.stderr)]
    debuts = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", p.stderr)]
    # phrases chantées = intervalles entre une fin de silence et le début du silence suivant
    phrases = []
    for d in debuts:
        f = next((x for x in fins if x > d), None)
        if f and f - d > 1.0:
            phrases.append((d, f))
    if len(phrases) < 2:
        raise SystemExit(f"phrases chantées introuvables : {phrases}")
    debut, fin = phrases[0][0], phrases[1][1]
    if fin - debut > 14:          # deux vers ≈ 5 à 10 s à 118 BPM ; sinon on garde 10 s
        fin = debut + 10
    print(f"référence : {debut:.2f} → {fin:.2f} s ({fin - debut:.1f} s) ; phrases repérées : "
          + ", ".join(f"{a:.1f}-{b:.1f}" for a, b in phrases[:6]), flush=True)
    return max(0, debut - 0.1), fin + 0.15


def profil(voc):
    existant = [p for p in requests.get(f"{VS}/profiles", timeout=10).json() if p.get("name") == NOM]
    if existant:
        print("profil existant :", existant[0]["id"], flush=True)
        return existant[0]["id"]
    a, b = premier_couplet(voc)
    ref = f"{BRUT}/reference.wav"
    ff("-ss", f"{a:.2f}", "-to", f"{b:.2f}", "-i", voc, "-ac", "1", "-ar", "24000",
       "-af", "highpass=f=80,loudnorm=I=-18:TP=-2", ref)
    r = requests.post(f"{VS}/profiles", data={"name": NOM, "ref_text": REF_TEXTE, "language": "fr", "kind": "clone"},
                      files={"ref_audio": ("reference.wav", open(ref, "rb"), "audio/wav")}, timeout=300)
    r.raise_for_status()
    pid = r.json()["id"]
    print("profil créé :", pid, flush=True)
    c = generer("Je suis une voix de synthèse, créée pour le flipper Fanny Pinball.", pid)
    fc = f"{BRUT}/consentement.wav"
    open(fc, "wb").write(c)
    r = requests.post(f"{VS}/profiles/{pid}/consent", data={"consent_text": CONSENTEMENT},
                      files={"consent_audio": ("consentement.wav", open(fc, "rb"), "audio/wav")}, timeout=300)
    r.raise_for_status()
    print("déclaration d'origine enregistrée", flush=True)
    return pid


def generer(texte, pid):
    for essai in range(3):
        try:
            r = requests.post(f"{VS}/generate", data={"text": texte, "profile_id": pid, "language": "fr",
                                                     "num_step": 32, "effect_preset": "raw"}, timeout=900)
            r.raise_for_status()
            return r.content
        except requests.RequestException as e:
            if essai == 2:
                raise
            print(f"   nouvelle tentative ({e})", flush=True)
            time.sleep(10)


def main():
    refaire = "--refaire" in sys.argv
    pid = profil(isoler_voix())
    json.dump({"profile_id": pid}, open(f"{BRUT}/profil.json", "w"))
    repliques = {k: v for k, v in json.load(open(f"{ICI}/outils/voix_fanny.json", encoding="utf-8")).items()
                 if not k.startswith("_")}
    bord = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05"
    for nom, r in repliques.items():
        dest = f"{SONS}/{r['piste']:04d}.mp3"
        if os.path.exists(dest) and not refaire:
            continue
        t0 = time.time()
        brut = f"{BRUT}/{nom}.wav"
        open(brut, "wb").write(generer(r["texte"], pid))
        # coupe les silences de bord, voix un peu « radio des années 70 » (bande 120 Hz – 7 kHz), volume harmonisé
        ff("-i", brut, "-af", f"{bord},areverse,{bord},areverse,highpass=f=120,lowpass=f=7000,"
           "loudnorm=I=-15:TP=-1.5", "-ar", "44100", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "128k", dest)
        print(f"{r['piste']:04d}.mp3  {nom}  « {r['texte']} »  ({time.time() - t0:.0f} s)", flush=True)


if __name__ == "__main__":
    main()
