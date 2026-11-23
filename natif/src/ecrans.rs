// Dessin des écrans de menu par-dessus la scène 3D : menu principal, réglages, partie libre et meilleurs scores,
// choix de la vue, pause, fin de partie, saisie des initiales. Couleurs du plateau : rouge Fanny, jaune soleil,
// bleu volet, crème.

use crate::reglages::{points, Reglages, Tableau};
use crate::ui::{rgba, Align, Police, Rgba, Ui};

pub const CREME: Rgba = rgba(255, 246, 225, 1.0);
pub const JAUNE: Rgba = rgba(255, 210, 63, 1.0);
pub const ROUGE: Rgba = rgba(232, 57, 44, 1.0);
pub const BLEU_NUIT: Rgba = rgba(14, 30, 58, 0.86);
pub const GRIS: Rgba = rgba(200, 190, 170, 1.0);

/// voile sombre en dégradé sur la scène, pour la lisibilité des menus
pub fn voile(ui: &mut Ui, force: f32) {
    let (w, h) = (ui.w, ui.h);
    ui.panneau(0.0, 0.0, w, h, 0.0, [0.03, 0.02, 0.05, 0.10 * force], [0.03, 0.02, 0.05, 0.55 * force]);
}

/// titre « Fanny Pinball » en haut de l'écran, avec sous-titre
pub fn titre(ui: &mut Ui, sous_titre: &str) {
    let (w, k) = (ui.w, ui.h / 1080.0);
    ui.texte_ombre(Police::Titre, 118.0 * k, w / 2.0, 170.0 * k, JAUNE, Align::Centre, "Fanny Pinball");
    ui.texte_ombre(Police::Texte, 34.0 * k, w / 2.0, 222.0 * k, CREME, Align::Centre, sous_titre);
}

/// liste de boutons centrés ; renvoie rien, sel = bouton en surbrillance
pub fn boutons(ui: &mut Ui, x: f32, y0: f32, largeur: f32, items: &[&str], sel: usize) {
    let k = ui.h / 1080.0;
    let (h, pas) = (70.0 * k, 88.0 * k);
    for (i, it) in items.iter().enumerate() {
        let y = y0 + i as f32 * pas;
        let actif = i == sel;
        let (fond, lis, coul) = if actif { (ROUGE, JAUNE, CREME) } else { (BLEU_NUIT, rgba(255, 246, 225, 0.35), CREME) };
        ui.cadre(x - largeur / 2.0, y, largeur, h, h / 2.0, fond, lis);
        ui.texte(Police::Texte, 36.0 * k, x, y + h * 0.66, coul, Align::Centre, it);
    }
}

pub fn aide(ui: &mut Ui, texte: &str) {
    let k = ui.h / 1080.0;
    ui.texte_ombre(Police::Texte, 24.0 * k, ui.w / 2.0, ui.h - 30.0 * k, GRIS, Align::Centre, texte);
}

pub fn menu_principal(ui: &mut Ui, sel: usize) {
    voile(ui, 1.0);
    titre(ui, "Pétanque World Tour");
    let k = ui.h / 1080.0;
    boutons(ui, ui.w / 2.0, 430.0 * k, 520.0 * k, &["Partie libre", "Réglages", "Quitter"], sel);
    aide(ui, "Palettes : choisir   ·   Lanceur ou Entrée : valider   ·   Échap : quitter");
}

pub const NB_REGLAGES: usize = 7;

pub fn reglages(ui: &mut Ui, r: &Reglages, sel: usize, resolutions: &[(u32, u32)]) {
    voile(ui, 1.2);
    titre(ui, "Réglages");
    let k = ui.h / 1080.0;
    let (lw, x) = (940.0 * k, ui.w / 2.0);
    let (x0, y0, hl, pas) = (x - lw / 2.0, 300.0 * k, 72.0 * k, 90.0 * k);
    let res = format!("{} × {}{}", r.resolution.0, r.resolution.1,
        if resolutions.first() == Some(&r.resolution) { "  (écran)" } else { "" });
    let lignes: [(&str, String); 7] = [
        ("Affichage", if r.plein_ecran { "Plein écran".into() } else { "Fenêtré".into() }),
        (if r.plein_ecran { "Définition de l'image" } else { "Taille de la fenêtre" }, res),
        ("Niveau de détail", r.detail.nom().into()),
        ("Volume des effets", String::new()),
        ("Volume de la musique", String::new()),
        ("Écran vertical", if r.vertical_horaire { "Haut de l'écran à droite".into() } else { "Haut de l'écran à gauche".into() }),
        ("Retour", String::new()),
    ];
    for (i, (nom, val)) in lignes.iter().enumerate() {
        let y = y0 + i as f32 * pas;
        let actif = i == sel;
        if i == 6 {
            boutons(ui, x, y + 20.0 * k, 360.0 * k, &["Retour"], if actif { 0 } else { 9 });
            continue;
        }
        let (fond, lis) = if actif { (rgba(120, 30, 24, 0.92), JAUNE) } else { (BLEU_NUIT, rgba(255, 246, 225, 0.25)) };
        ui.cadre(x0, y, lw, hl, 18.0 * k, fond, lis);
        ui.texte(Police::Texte, 34.0 * k, x0 + 36.0 * k, y + hl * 0.66, CREME, Align::Gauche, nom);
        let xv = x0 + lw - 40.0 * k;
        match i {
            3 | 4 => {
                let v = if i == 3 { r.volume_effets } else { r.volume_musique };
                let (bw, bh) = (300.0 * k, 16.0 * k);
                let bx = xv - bw - 60.0 * k;
                ui.panneau(bx, y + hl / 2.0 - bh / 2.0, bw, bh, bh / 2.0, rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.45));
                ui.panneau(bx, y + hl / 2.0 - bh / 2.0, bw * v as f32 / 10.0, bh, bh / 2.0, JAUNE, rgba(240, 140, 28, 1.0));
                ui.texte(Police::Texte, 32.0 * k, xv, y + hl * 0.66, CREME, Align::Droite, &format!("{}", v * 10));
            }
            _ => {
                let c = if actif { JAUNE } else { CREME };
                let l = ui.texte(Police::Texte, 32.0 * k, xv - 30.0 * k, y + hl * 0.66, c, Align::Droite, val);
                if actif {
                    ui.texte(Police::Texte, 32.0 * k, xv - 30.0 * k - l - 18.0 * k, y + hl * 0.66, JAUNE, Align::Droite, "‹");
                    ui.texte(Police::Texte, 32.0 * k, xv, y + hl * 0.66, JAUNE, Align::Droite, "›");
                }
            }
        }
    }
    aide(ui, "Palettes : choisir   ·   Lanceur : changer la valeur (← → au clavier)   ·   Échap : retour");
}

/// tableau des meilleurs scores ; surligne le rang « nouveau »
pub fn tableau(ui: &mut Ui, t: &Tableau, x: f32, y: f32, w: f32, nouveau: Option<usize>) {
    let k = ui.h / 1080.0;
    let hl = 50.0 * k;
    let h = 90.0 * k + hl * t.scores.len() as f32 + 20.0 * k;
    ui.cadre(x, y, w, h, 26.0 * k, rgba(253, 240, 212, 0.96), ROUGE);
    ui.texte(Police::Titre, 50.0 * k, x + w / 2.0, y + 64.0 * k, ROUGE, Align::Centre, "Meilleurs scores");
    let encre = rgba(43, 26, 16, 1.0);
    for (i, s) in t.scores.iter().enumerate() {
        let yl = y + 90.0 * k + i as f32 * hl;
        if nouveau == Some(i) { ui.panneau(x + 16.0 * k, yl + 4.0 * k, w - 32.0 * k, hl - 6.0 * k, 12.0 * k, JAUNE, rgba(255, 180, 40, 1.0)); }
        else if i % 2 == 0 { ui.panneau(x + 16.0 * k, yl + 4.0 * k, w - 32.0 * k, hl - 6.0 * k, 12.0 * k, rgba(232, 57, 44, 0.08), rgba(232, 57, 44, 0.08)); }
        let b = yl + hl * 0.72;
        let c = if i == 0 { ROUGE } else { encre };
        ui.texte(Police::Texte, 30.0 * k, x + 70.0 * k, b, c, Align::Droite, &format!("{}.", i + 1));
        ui.texte(Police::Texte, 32.0 * k, x + 100.0 * k, b, c, Align::Gauche, &s.nom);
        ui.texte(Police::Texte, 32.0 * k, x + w - 190.0 * k, b, c, Align::Droite, &points(s.points));
        ui.texte(Police::Texte, 22.0 * k, x + w - 36.0 * k, b, rgba(120, 100, 80, 1.0), Align::Droite, &s.date);
    }
}

pub fn libre(ui: &mut Ui, t: &Tableau, sel: usize, nouveau: Option<usize>) {
    voile(ui, 1.0);
    let k = ui.h / 1080.0;
    ui.texte_ombre(Police::Titre, 84.0 * k, ui.w / 2.0, 120.0 * k, JAUNE, Align::Centre, "Partie libre");
    ui.texte_ombre(Police::Texte, 28.0 * k, ui.w / 2.0, 165.0 * k, CREME, Align::Centre, "Parties gratuites, sans monnayeur · 3 billes");
    let w = 720.0 * k;
    let xt = ui.w / 2.0 - w - 40.0 * k;
    tableau(ui, t, xt.max(30.0 * k), 210.0 * k, w, nouveau);
    let xb = (ui.w / 2.0 + 300.0 * k).min(ui.w - 270.0 * k);
    boutons(ui, xb, 420.0 * k, 480.0 * k, &["Commencer une partie", "Retour"], sel);
    aide(ui, "Palettes : choisir   ·   Lanceur ou Entrée : valider   ·   Échap : retour");
}

pub fn libelle_vue(nom: &str) -> &str {
    match nom {
        "tour" => "Tour de la machine",
        "lilliputien" => "Lilliputien, au ras du plateau",
        "joueur" => "Joueur debout",
        "haute" => "Vue haute",
        "plateau" => "Plateau de face",
        "vertical" => "Plateau 3D, écran vertical",
        "plan" => "Plateau 2D, écran horizontal",
        "plan_vertical" => "Plateau 2D, écran vertical",
        "machine" => "Machine entière",
        n => n,
    }
}

pub fn vues(ui: &mut Ui, noms: &[String], sel: usize) {
    let k = ui.h / 1080.0;
    ui.panneau(0.0, ui.h - 250.0 * k, ui.w, 250.0 * k, 0.0, [0.0, 0.0, 0.0, 0.0], [0.03, 0.02, 0.05, 0.85]);
    ui.texte_ombre(Police::Titre, 64.0 * k, ui.w / 2.0, ui.h - 160.0 * k, JAUNE, Align::Centre, "Choisissez votre vue");
    let nom = noms.get(sel).map(|s| libelle_vue(s)).unwrap_or("");
    let (bw, bh) = (620.0 * k, 66.0 * k);
    let y = ui.h - 130.0 * k;
    ui.cadre(ui.w / 2.0 - bw / 2.0, y, bw, bh, bh / 2.0, ROUGE, JAUNE);
    ui.texte(Police::Texte, 36.0 * k, ui.w / 2.0, y + bh * 0.66, CREME, Align::Centre, nom);
    ui.texte(Police::Texte, 44.0 * k, ui.w / 2.0 - bw / 2.0 - 40.0 * k, y + bh * 0.7, JAUNE, Align::Centre, "‹");
    ui.texte(Police::Texte, 44.0 * k, ui.w / 2.0 + bw / 2.0 + 40.0 * k, y + bh * 0.7, JAUNE, Align::Centre, "›");
    ui.texte_ombre(Police::Texte, 24.0 * k, ui.w / 2.0, ui.h - 28.0 * k, GRIS, Align::Centre,
        &format!("← → ou palettes : changer de vue ({}/{})   ·   Lanceur ou Entrée : lancer la partie   ·   Échap : retour", sel + 1, noms.len()));
}

pub fn pause(ui: &mut Ui, sel: usize) {
    voile(ui, 1.3);
    let k = ui.h / 1080.0;
    ui.texte_ombre(Police::Titre, 96.0 * k, ui.w / 2.0, 300.0 * k, JAUNE, Align::Centre, "Pause");
    boutons(ui, ui.w / 2.0, 400.0 * k, 520.0 * k, &["Reprendre", "Changer de vue", "Abandonner la partie"], sel);
}

pub fn fin_partie(ui: &mut Ui, score: u64, record: bool) {
    voile(ui, 0.9);
    let k = ui.h / 1080.0;
    ui.texte_ombre(Police::Titre, 104.0 * k, ui.w / 2.0, 420.0 * k, JAUNE, Align::Centre, "Fin de partie");
    ui.texte_ombre(Police::Texte, 64.0 * k, ui.w / 2.0, 520.0 * k, CREME, Align::Centre, &format!("{} points", points(score)));
    if record { ui.texte_ombre(Police::Texte, 40.0 * k, ui.w / 2.0, 590.0 * k, ROUGE, Align::Centre, "Vous entrez au tableau !"); }
}

pub const ALPHABET: &[char] = &['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
    'U', 'V', 'W', 'X', 'Y', 'Z', ' ', '.', '!', '?'];

pub fn initiales(ui: &mut Ui, lettres: &[usize; 3], pos: usize, score: u64, rang: usize, temps: f64) {
    voile(ui, 1.2);
    let k = ui.h / 1080.0;
    ui.texte_ombre(Police::Titre, 92.0 * k, ui.w / 2.0, 250.0 * k, JAUNE, Align::Centre, "Bravo !");
    ui.texte_ombre(Police::Texte, 40.0 * k, ui.w / 2.0, 320.0 * k, CREME, Align::Centre,
        &format!("{} points · {}{} place du tableau", points(score), rang + 1, if rang == 0 { "re" } else { "e" }));
    ui.texte_ombre(Police::Texte, 32.0 * k, ui.w / 2.0, 380.0 * k, GRIS, Align::Centre, "Inscrivez vos initiales");
    let (cw, ch, ecart) = (150.0 * k, 190.0 * k, 40.0 * k);
    let x0 = ui.w / 2.0 - (3.0 * cw + 2.0 * ecart) / 2.0;
    for i in 0..3 {
        let x = x0 + i as f32 * (cw + ecart);
        let actif = i == pos;
        let clign = actif && (temps * 2.5) as i64 % 2 == 0;
        ui.cadre(x, 430.0 * k, cw, ch, 24.0 * k, if actif { ROUGE } else { BLEU_NUIT }, if clign { CREME } else { JAUNE });
        let c = ALPHABET[lettres[i]];
        ui.texte(Police::Texte, 130.0 * k, x + cw / 2.0, 430.0 * k + ch * 0.75, CREME, Align::Centre, &if c == ' ' { "_".to_string() } else { c.to_string() });
    }
    aide(ui, "Palettes ou ← → : changer la lettre   ·   Lanceur ou Entrée : lettre suivante   ·   Retour arrière : lettre précédente");
}

pub fn chargement(ui: &mut Ui, texte: &str) {
    voile(ui, 1.5);
    let k = ui.h / 1080.0;
    ui.texte_ombre(Police::Titre, 70.0 * k, ui.w / 2.0, ui.h / 2.0, JAUNE, Align::Centre, texte);
}

/// bandeau discret de la cinématique (passer)
pub fn cinematique(ui: &mut Ui, t: f64) {
    let k = ui.h / 1080.0;
    let a = (t.min(1.0) * 0.8) as f32;
    let bande = 90.0 * k;
    ui.panneau(0.0, 0.0, ui.w, bande, 0.0, [0.0, 0.0, 0.0, 1.0], [0.0, 0.0, 0.0, 1.0]);
    ui.panneau(0.0, ui.h - bande, ui.w, bande, 0.0, [0.0, 0.0, 0.0, 1.0], [0.0, 0.0, 0.0, 1.0]);
    ui.texte(Police::Texte, 24.0 * k, ui.w - 40.0 * k, ui.h - 36.0 * k, [GRIS[0], GRIS[1], GRIS[2], a], Align::Droite, "Entrée : passer");
}

/// vue verticale : le fronton est hors champ, le score et l'information sont repris en haut de l'image
pub fn bandeau_score(ui: &mut Ui, score: &str, info: &str) {
    let k = ui.h / 1080.0;
    let hb = 30.0 * k;
    ui.panneau(0.0, 0.0, ui.w, hb, 0.0, [0.02, 0.01, 0.01, 0.92], [0.02, 0.01, 0.01, 0.75]);
    ui.texte(Police::Texte, 24.0 * k, 16.0 * k, hb * 0.75, rgba(255, 120, 40, 1.0), Align::Gauche, score.trim());
    ui.texte(Police::Texte, 20.0 * k, ui.w - 16.0 * k, hb * 0.75, JAUNE, Align::Droite, info.trim());
}

/// vue 2D sur écran horizontal : la table occupe la hauteur au centre ; score et information à gauche, en grand
pub fn score_lateral(ui: &mut Ui, score: &str, info: &str) {
    let k = ui.h / 1080.0;
    let x = ui.w * 0.17;
    ui.texte_ombre(Police::Titre, 54.0 * k, x, 140.0 * k, JAUNE, Align::Centre, "Fanny Pinball");
    ui.cadre(x - 220.0 * k, 200.0 * k, 440.0 * k, 190.0 * k, 24.0 * k, rgba(20, 8, 6, 0.92), ROUGE);
    ui.texte(Police::Texte, 30.0 * k, x, 250.0 * k, GRIS, Align::Centre, "Score");
    ui.texte(Police::Texte, 80.0 * k, x, 350.0 * k, rgba(255, 120, 40, 1.0), Align::Centre, score.trim());
    ui.texte(Police::Texte, 44.0 * k, x, 460.0 * k, JAUNE, Align::Centre, info.trim());
}
