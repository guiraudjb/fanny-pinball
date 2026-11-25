"""Studio de flippers (Gradio, depot :7905) : de la table universelle au .vpx essayé et installé.

    cd tables && ~/.venvs/chat-studio/bin/python3 -m studio.interface

Toute table part de la table universelle (moteur/nouvelle_table.py) avec le cadrage validé ; seul le haut du plateau
se compose (éditeur 2D → composition.json). Fabrication sur cette machine (moteur/construire.sh), essais dans le Visual
Pinball de Pilote2 (moteur/essai.sh s'y relance par ssh), installation sur la Batocera par Pilote2.
"""
import json
import os
import subprocess
import sys
import threading
import time

import gradio as gr

ICI = os.path.dirname(os.path.abspath(__file__))
TABLES = os.path.dirname(ICI)
MOTEUR = os.path.join(TABLES, 'moteur')
sys.path.insert(0, MOTEUR)
import plan            # noqa: E402
import nouvelle_table  # noqa: E402
import verifier        # noqa: E402

PORT = int(os.environ.get('STUDIO_FLIPPER_PORT', 7905))
PILOTE2 = os.environ.get('PILOTE2', '192.168.1.207')
BATOCERA = os.environ.get('BATOCERA', 'root@192.168.1.143')
VERROU = threading.Lock()                 # une fabrication ou un essai à la fois
ENV = dict(os.environ, PATH=os.path.dirname(sys.executable) + os.pathsep + os.path.expanduser('~/.cargo/bin')
           + os.pathsep + os.environ.get('PATH', ''))


# ---------------------------------------------------------------- tables
def tables_studio():
    # la table universelle est le modèle : elle ne se compose pas
    return sorted(d for d in os.listdir(TABLES) if d != 't0_universelle' and os.path.exists(os.path.join(TABLES, d, 'fiche.json')))


def dossier(nom):
    return os.path.join(TABLES, nom)


def lire_fiche(nom):
    return json.load(open(os.path.join(dossier(nom), 'fiche.json')))


def base_editeur(nom):
    """géométrie fixe de la base universelle, pour le fond de l'éditeur"""
    t, _, _, base = plan.table_studio(dossier('t0_universelle'))      # même base pour toutes les tables
    cx, cy, rx, ry = t.arche
    pal = []
    for p in t.palettes[:base['palettes']]:
        dx, dy = plan.direction(p['debut'])
        pal.append([p['x'], p['y'], round(p['x'] + dx * p['long'], 1), round(p['y'] + dy * p['long'], 1)])
    return dict(W=plan.W, H=plan.H, XD=plan.XD, haut_libre=plan.HAUT_LIBRE,
                hors_arche=f'M0 0 L{plan.W} 0 L{plan.W} {cy} A{rx} {ry} 0 0 0 0 {cy} Z',
                murs=[m['pts'] for m in t.murs[:base['murs']] if not (m['nom'] or '').startswith(('Tablier', 'BordBas'))],
                lance_pierres=[s['pts'] for s in t.lance_pierres[:base['lance_pierres']]],
                palettes=pal, couloirs=[[c['x'], c['y']] for c in t.couloirs[:base['couloirs']]])


def charger(nom):
    """→ champs de la fiche + données de l'éditeur"""
    if not nom:
        return [gr.update()] * 9
    F = lire_fiche(nom)
    d = F.get('deco', {})
    compo = json.load(open(os.path.join(dossier(nom), 'composition.json'))) if os.path.exists(
        os.path.join(dossier(nom), 'composition.json')) else {'elements': []}
    pont = json.dumps(dict(base=base_editeur(nom), elements=compo.get('elements', []), jeton=time.time()))
    vue = os.path.join(dossier(nom), 'sortie', 'essai_vue.png')
    return (F['titre'], F.get('sous_titre', ''), '\n'.join(F.get('regles', [])), F.get('blurb') or '',
            d.get('c1', '#d0d4da'), d.get('c2', '#2b2f36'), d.get('c3', '#5e6672'), pont,
            vue if os.path.exists(vue) else None)


def enregistrer_fiche(nom, titre, sous_titre, regles, blurb, c1, c2, c3):
    if not nom:
        return 'Aucune table choisie.'
    F = lire_fiche(nom)
    F.update(titre=titre, sous_titre=sous_titre, regles=[l for l in regles.splitlines() if l.strip()], blurb=blurb)
    F['deco'] = dict(F.get('deco', {}), c1=c1, c2=c2, c3=c3, titre=titre.upper())
    json.dump(F, open(os.path.join(dossier(nom), 'fiche.json'), 'w'), ensure_ascii=False, indent=1)
    return f'Fiche de {nom} enregistrée.'


def creer(dos, titre, sous_titre):
    dos = (dos or '').strip()
    if not dos or not titre.strip():
        return gr.update(), 'Il faut un dossier et un titre.'
    try:
        nouvelle_table.creer(dos, titre.strip(), sous_titre.strip())
    except SystemExit as e:
        return gr.update(), str(e)
    return gr.update(choices=tables_studio(), value=dos), f'Table {dos} créée à partir de la table universelle.'


# ---------------------------------------------------------------- composition
def enregistrer_compo(nom, pont):
    if not nom:
        return 'Aucune table choisie.'
    try:
        elements = json.loads(pont).get('elements', [])
    except Exception as e:
        return f'Données de l\'éditeur illisibles : {e}'
    json.dump({'elements': elements}, open(os.path.join(dossier(nom), 'composition.json'), 'w'), ensure_ascii=False, indent=1)
    try:
        msgs = verifier.verifier(dossier(nom))
    except Exception as e:
        return f'**Composition enregistrée** ({len(elements)} éléments), mais la vérification a échoué : `{e}`'
    erreurs = [m for n, m in msgs if n == 'erreur']
    lignes = [f'- ❌ {m}' for n, m in msgs if n == 'erreur'] + [f'- ⚠️ {m}' for n, m in msgs if n == 'alerte']
    tete = '**Composition enregistrée** (%d éléments). ' % len(elements) + (
        '**Erreurs à corriger avant de fabriquer.**' if erreurs else 'Vérification : OK.')
    return tete + ('\n\n' + '\n'.join(lignes) if lignes else '')


# ---------------------------------------------------------------- fabrication, essais, installation
def lancer(cmd, journal, cwd=TABLES):
    p = subprocess.Popen(cmd, cwd=cwd, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for ligne in p.stdout:
        journal.append(ligne.rstrip())
        yield '\n'.join(journal[-400:])
    p.wait()
    journal.append(f'→ fin (code {p.returncode})')
    yield '\n'.join(journal[-400:])


def fabriquer(nom):
    if not nom:
        yield 'Aucune table choisie.'
        return
    if not VERROU.acquire(blocking=False):
        yield 'Une fabrication ou un essai est déjà en cours.'
        return
    try:
        msgs = verifier.verifier(dossier(nom))
        erreurs = [m for n, m in msgs if n == 'erreur']
        if erreurs:
            yield 'Fabrication refusée, la composition a des erreurs :\n' + '\n'.join(erreurs)
            return
        journal = [f'== fabrication de {nom}']
        yield from lancer([os.path.join(dossier(nom), 'construire.sh')], journal)
    finally:
        VERROU.release()


def essayer(nom, essais):
    if not nom:
        yield 'Aucune table choisie.', None
        return
    if not VERROU.acquire(blocking=False):
        yield 'Une fabrication ou un essai est déjà en cours.', None
        return
    try:
        journal = []
        for e in essais:
            journal.append(f'== essai {e} (Visual Pinball de Pilote2)')
            for txt in lancer([os.path.join(MOTEUR, 'essai.sh'), dossier(nom), e, '900'], journal):
                yield txt, None
        vue = os.path.join(dossier(nom), 'sortie', 'essai_vue.png')
        yield '\n'.join(journal[-400:]), vue if 'vue' in essais and os.path.exists(vue) else None
    finally:
        VERROU.release()


def installer(nom):
    """copie du .vpx sur la Batocera, par Pilote2 (seule machine autorisée), sans toucher à une partie en cours"""
    if not nom:
        return 'Aucune table choisie.'
    sortie = os.path.join(dossier(nom), 'sortie')
    vpx = next((f for f in os.listdir(sortie) if f.endswith('.vpx')), None) if os.path.isdir(sortie) else None
    if not vpx:
        return 'Pas de .vpx : fabriquer d\'abord.'
    titre = lire_fiche(nom)['titre']
    cible = f'/userdata/roms/vpinball/{titre} (Fanny 2026)/{titre} (Fanny 2026).vpx'
    src = os.path.join(sortie, vpx)
    script = (f"ssh -o BatchMode=yes {BATOCERA} \"mkdir -p '{os.path.dirname(cible)}' && cat > '{cible}'\" < '{src}' && "
              f"ssh -o BatchMode=yes {BATOCERA} 'curl -s http://127.0.0.1:1234/reloadgames >/dev/null' && echo OK")
    r = subprocess.run(['ssh', '-o', 'BatchMode=yes', PILOTE2, script], capture_output=True, text=True, timeout=300)
    if r.returncode == 0 and 'OK' in r.stdout:
        return f'Installée sur la Batocera : « {titre} (Fanny 2026) » (liste des jeux rechargée).'
    return f'Échec de l\'installation : {r.stderr or r.stdout}'


# ---------------------------------------------------------------- interface
CSS = open(os.path.join(ICI, 'editeur.css')).read()
HEAD = '<script>' + open(os.path.join(ICI, 'editeur.js')).read() + '</script>'


def construire_interface():
    with gr.Blocks(title='Studio de flippers') as demo:
        gr.Markdown('# Studio de flippers · base Fanny Pinball\nToute table part de la **table universelle** '
                    '(châssis, planche et bas de Fanny, écran et cadrage validés) : seul le haut du plateau se compose.')
        with gr.Row():
            choix = gr.Dropdown(tables_studio(), label='Table', value='t9_demo' if 't9_demo' in tables_studio() else None, scale=3)
            recharger = gr.Button('↻ Recharger', scale=0)
        with gr.Tabs():
            with gr.Tab('Tables'):
                with gr.Row():
                    with gr.Column():
                        gr.Markdown('### Fiche')
                        titre = gr.Textbox(label='Titre')
                        sous_titre = gr.Textbox(label='Sous-titre')
                        regles = gr.Textbox(label='Règles (une par ligne)', lines=4)
                        blurb = gr.Textbox(label='Présentation', lines=2)
                        with gr.Row():
                            c1 = gr.ColorPicker(label='Couleur 1')
                            c2 = gr.ColorPicker(label='Couleur 2')
                            c3 = gr.ColorPicker(label='Couleur 3')
                        b_fiche = gr.Button('Enregistrer la fiche', variant='primary')
                        m_fiche = gr.Markdown()
                    with gr.Column():
                        gr.Markdown('### Nouvelle table\nClone de la table universelle (cadrage validé, haut vierge).')
                        n_dos = gr.Textbox(label='Dossier', placeholder='t6_tracteur')
                        n_titre = gr.Textbox(label='Titre', placeholder='Tracteur')
                        n_sous = gr.Textbox(label='Sous-titre')
                        b_creer = gr.Button('Créer la table')
                        m_creer = gr.Markdown()
            with gr.Tab('Composition'):
                gr.HTML('<div id="editeur-flipper"></div>')
                pont = gr.Textbox(elem_id='compo_pont', elem_classes=['cache'], show_label=False, lines=1)
                b_compo = gr.Button('Enregistrer et vérifier', variant='primary')
                m_compo = gr.Markdown()
            with gr.Tab('Fabrication et essais'):
                with gr.Row():
                    with gr.Column():
                        b_fab = gr.Button('Fabriquer le .vpx', variant='primary')
                        essais = gr.CheckboxGroup(['lanceur', 'rampe', 'balayage', 'logique', 'vue'], value=['lanceur', 'vue'],
                                                  label='Essais (Visual Pinball de Pilote2)')
                        b_ess = gr.Button('Lancer les essais')
                        b_inst = gr.Button('Installer sur la Batocera')
                        m_inst = gr.Markdown()
                    with gr.Column(scale=2):
                        journal = gr.Textbox(label='Journal', lines=22, max_lines=22, autoscroll=True)
                        capture = gr.Image(label='Capture « vue »', type='filepath')
        champs = [titre, sous_titre, regles, blurb, c1, c2, c3, pont, capture]
        choix.change(charger, choix, champs)
        recharger.click(lambda n: (gr.update(choices=tables_studio(), value=n),) + tuple(charger(n)), choix, [choix] + champs)
        demo.load(charger, choix, champs)
        b_fiche.click(enregistrer_fiche, [choix, titre, sous_titre, regles, blurb, c1, c2, c3], m_fiche)
        b_creer.click(creer, [n_dos, n_titre, n_sous], [choix, m_creer])
        b_compo.click(enregistrer_compo, [choix, pont], m_compo)
        b_fab.click(fabriquer, choix, journal)
        b_ess.click(essayer, [choix, essais], [journal, capture])
        b_inst.click(installer, choix, m_inst)
    return demo


if __name__ == '__main__':
    construire_interface().queue().launch(server_name='0.0.0.0', server_port=PORT, css=CSS, head=HEAD,
                                          allowed_paths=[TABLES], show_error=True)
