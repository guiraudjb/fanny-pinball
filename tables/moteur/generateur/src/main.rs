// Fabrique une table Visual Pinball vierge (.vpx) à partir de son plan.
//
//   generateur-tables <dossier de la table>
//
// Entrées (python3 <dossier>/table.py les écrit dans <dossier>/sortie/) :
//   table.json            géométrie en mm (repère du plateau : x à droite, y vers le joueur)
//   entete.vbs            noms, évènements, lampes, éjections, points d'essai (généré)
//   images/plateau.jpg, images/fond.jpg, images/inserts/<lampe>.png
// et : moteur/commun.vbs (boucle de jeu commune), <dossier>/regles.vbs (règles de la table), moteur/sons/*.wav
//
// Sortie : <dossier>/sortie/<nom>.vpx
//
// Mêmes conventions que le générateur de Fanny Pinball (outils/vpx/generateur) : 1 unité VP = 0,54 mm, éléments
// partant des valeurs par défaut de vpinball (bibliothèque vpin, celle de vpxtool), tous visibles (pas de décor 3D).
mod decor;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use vpin::vpx::gamedata::{ToneMapper, ViewLayoutMode, ViewSetupId};
use vpin::vpx::{
    self, VPX,
    color::Color,
    gameitem::{
        GameItemEnum, bumper::Bumper, dragpoint::DragPoint, flasher::{Filter, Flasher}, flipper::Flipper, font::Font,
        gate::Gate, hittarget::{HitTarget, TargetType}, kicker::{Kicker, KickerType}, light::Light, plunger::Plunger,
        ramp::{Ramp, RampType}, ramp_image_alignment::RampImageAlignment, spinner::Spinner, textbox::{TextAlignment, TextBox},
        timer::Timer, trigger::{Trigger, TriggerShape}, vertex2d::Vertex2D, vertex3d::Vertex3D, wall::Wall,
    },
    image::ImageData,
    material::{SaveMaterial, SavePhysicsMaterial},
    model::StringWithEncoding,
    pinbinary::PinBinary,
    sound::{OutputTarget, SoundData, WaveForm, read_sound},
};

const MM: f32 = 1.0 / 0.54;
/// frappe propre du lanceur de vpinball : presque nulle, la vitesse vient du script (LacherLanceur), comme Fanny Pinball
const TIR_LANCEUR: f32 = 5.0;
const TIRAGE_LANCEUR: f32 = 0.1;
/// place du fronton sur le fond de la vue bureau : gauche, haut, largeur (fractions de l'écran) ; plan.py dessine le cadre
const FRONTON_BUREAU: [f32; 3] = [0.64, 0.04, 0.34];
/// caméra de la vue bureau (celle de Fanny Pinball, même plateau) : visée, champ, recul, x, y, z, échelle x, mode, décalage
/// (10e valeur, décalage vertical : le haut du châssis touche le haut de l'écran, lanceur visible en bas)
const VUE_BUREAU: [f32; 10] = [52.0, 46.0, 0.0, 0.0, 700.0, 1600.0, 1.0, 1.0, -20.0, -14.0];

fn f(v: &Value) -> f32 { v.as_f64().unwrap_or(0.0) as f32 }
fn s(v: &Value) -> String { v.as_str().unwrap_or("").to_string() }
fn p2(x: f32, y: f32) -> Vertex2D { Vertex2D::new(x * MM, y * MM) }
fn dp(x: f32, y: f32) -> DragPoint { DragPoint { x: x * MM, y: y * MM, z: 0.0, ..Default::default() } }
fn couleur(hex: &str) -> Color { Color::from_rgb(u32::from_str_radix(hex.trim_start_matches('#'), 16).unwrap_or(0xffffff)) }
fn angle_vp(x: f32, y: f32) -> f32 { x.atan2(-y).to_degrees() }
fn points(v: &Value) -> Vec<(f32, f32)> { v.as_array().unwrap().iter().map(|p| (f(&p[0]), f(&p[1]))).collect() }

fn image(nom: &str, chemin: &Path) -> ImageData {
    let data = fs::read(chemin).unwrap_or_else(|e| panic!("{} : {e}", chemin.display()));
    let (w, h) = image::image_dimensions(chemin).expect("dimensions de l'image");
    let fichier = chemin.file_name().unwrap().to_string_lossy().to_string();
    ImageData {
        name: nom.into(), internal_name: None, path: fichier.clone(), width: w, height: h, link: None,
        alpha_test_value: -1.0, is_opaque: None, is_signed: None,
        jpeg: Some(PinBinary { name: nom.into(), internal_name: None, path: fichier, data }), bits: None, md5_hash: None,
    }
}

fn son(nom: &str, chemin: &Path) -> SoundData {
    let data = fs::read(chemin).unwrap();
    let mut s = SoundData {
        name: nom.into(), path: chemin.file_name().unwrap().to_string_lossy().to_string(), wave_form: WaveForm::new(),
        data: vec![], internal_name: nom.into(), fade: 0, volume: 0, balance: 0, output_target: OutputTarget::Table,
    };
    read_sound(&data, &mut s).expect("son");
    s
}

/// polygone dans le sens attendu par vpinball (aire signée < 0, y vers le bas ; sinon la bille entre dans le mur)
fn sens_vp(pts: &[(f32, f32)]) -> Vec<(f32, f32)> {
    let aire: f32 = (0..pts.len()).map(|i| { let (a, b) = (pts[i], pts[(i + 1) % pts.len()]); a.0 * b.1 - b.0 * a.1 }).sum();
    let mut p = pts.to_vec();
    if aire > 0.0 { p.reverse(); }
    p
}

fn mur(nom: &str, pts: &[(f32, f32)], haut: f32, visible: bool, mat: &str) -> Wall {
    Wall { name: nom.into(), height_top: haut * MM, height_bottom: 0.0, is_top_bottom_visible: visible, is_side_visible: visible,
        drag_points: sens_vp(pts).iter().map(|&(x, y)| dp(x, y)).collect(), top_material: mat.into(), side_material: mat.into(),
        ..Default::default() }
}

/// polygone de détection d'un capteur : rectangle (demi-largeur, demi-longueur) tourné de `angle`
fn rect(x: f32, y: f32, dx: f32, dy: f32, angle: f32) -> Vec<DragPoint> {
    let (sa, ca) = angle.to_radians().sin_cos();
    let pts: Vec<(f32, f32)> = [(-1.0f32, -1.0f32), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)].iter()
        .map(|(a, b)| { let (u, v) = (a * dx, b * dy); (x + u * ca - v * sa, y + u * sa + v * ca) }).collect();
    sens_vp(&pts).iter().map(|&(x, y)| dp(x, y)).collect()
}

fn main() {
    let dossier = PathBuf::from(std::env::args().nth(1).expect("usage : generateur-tables <dossier de la table>"));
    let dossier = fs::canonicalize(&dossier).unwrap();
    let moteur = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let sortie = dossier.join("sortie");
    let imgs = sortie.join("images");
    let t: Value = serde_json::from_str(&fs::read_to_string(sortie.join("table.json")).expect("sortie/table.json (python3 table.py)")).unwrap();

    let base = sortie.join(".minimale.vpx");
    vpx::new_minimal_vpx(&base).unwrap();
    let mut v: VPX = vpx::read(&base).unwrap();
    fs::remove_file(&base).ok();

    let (w, h) = (f(&t["W"]), f(&t["H"]));
    {
        let g = &mut v.gamedata;
        g.name = "Table1".into();
        g.left = 0.0; g.top = 0.0; g.right = w * MM; g.bottom = h * MM;
        g.angle_tilt_min = f(&t["pente_deg"]); g.angle_tilt_max = f(&t["pente_deg"]);
        g.image = "plateau".into();
        // tables du studio : cadrage validé imposé (VUE ignorée, réservée aux essais de cadrage du moteur)
        let studio = t["studio"].as_bool().unwrap_or(false);
        if studio && !t["bas_fanny"].as_bool().unwrap_or(false) { panic!("table du studio sans la base universelle"); }
        let vue: Vec<f32> = std::env::var("VUE").ok().filter(|_| !studio).map(|s| s.split(',').filter_map(|x| x.trim().parse().ok()).collect())
            .filter(|v: &Vec<f32>| v.len() >= 9).unwrap_or(VUE_BUREAU.to_vec());
        let d = &mut g.view_setups[ViewSetupId::Desktop];
        d.mode = Some(if vue[7] > 0.5 { ViewLayoutMode::Camera } else { ViewLayoutMode::Legacy });
        d.view_horizontal_offset = Some(vue[8]);
        d.view_vertical_offset = Some(vue.get(9).copied().unwrap_or(0.0));   // 10e valeur : décalage vertical du cadrage
        d.viewport_rotation = Some(0.0);
        d.look_at = Some(vue[0]); d.fov = Some(vue[1]); d.layback = Some(vue[2]);
        d.view_x = Some(vue[3]); d.view_y = Some(vue[4]); d.view_z = Some(vue[5]);
        d.scene_scale_x = Some(vue[6]); d.scene_scale_y = Some(1.0); d.scene_scale_z = Some(1.0);
        g.backglass_image_full_desktop = "fond_bureau".into();
        g.display_backdrop = true;
        g.glass_top_height = 210.0;
        g.glass_bottom_height = Some(210.0);
        g.ball_spherical_mapping = Some(false);
        g.tone_mapper = Some(ToneMapper::Reinhard);
        // image nette : bloom réduit (1,8 par défaut : halo laiteux autour des zones claires, planche vierge surtout)
        // et reflet du plateau discret
        g.bloom_strength = std::env::var("BLOOM").ok().and_then(|v| v.parse().ok()).unwrap_or(0.25);
        g.playfield_reflection_strength = 0.05;
        g.ball_playfield_reflection_strength = Some(0.5);
    }
    v.info.table_name = Some(s(&t["titre"]));
    v.info.author_name = Some("Arducible".into());
    v.info.table_version = Some("0.1".into());
    v.info.table_blurb = Some(t["blurb"].as_str().map(String::from).unwrap_or(format!("Table vierge (sans habillage) : {}", s(&t["sous_titre"]))));

    // finition mécanique (moteur/decor.py) : chapeaux de bumpers, plastrons des lance-pierres, chapeaux d'axe
    let dfin = sortie.join("decor");
    let mut finition = dfin.join("decor.json").exists().then(|| decor::charger(&dfin, "Finition", &[], |nom, chemin, _| image(nom, chemin)));
    // châssis de Fanny Pinball (caisse, baguettes, barre, boîtier du lanceur, boutons ; moteur/chassis, extrait par
    // outils/vpx/decor_glb.py --chassis) : toutes les tables ont les dimensions de Fanny et s'y logent
    let dch = moteur.join("chassis");
    let mut chassis = dch.join("decor.json").exists().then(|| decor::charger(&dch, "Chassis", &[], |nom, chemin, _| image(nom, chemin)));
    if let Some(ch) = &chassis { for im in &ch.images { v.add_or_replace_image(im.clone()); } }
    // base universelle : bas de table de Fanny à l'identique (tablier en V et ses cartes, guides, poteaux, plastiques et
    // élastiques ronds des lance-pierres ; moteur/bas_fanny, extrait par outils/vpx/decor_glb.py --bas)
    let dbas = moteur.join("bas_fanny");
    let mut bas = (t["bas_fanny"].as_bool().unwrap_or(false) && dbas.join("decor.json").exists())
        .then(|| decor::charger(&dbas, "BasFanny", &[], |nom, chemin, _| image(nom, chemin)));
    if let Some(b) = &bas { for im in &b.images { v.add_or_replace_image(im.clone()); } }
    if let Some(fi) = &finition {
        v.add_or_replace_image(image("palette", &dfin.join("palette.png")));
        v.add_or_replace_image(image("tourniquet", &dfin.join("tourniquet.png")));
        for im in &fi.images { v.add_or_replace_image(im.clone()); }
    }

    // matières (format 10.7 : MATE + PHMA)
    let matiere = |nom: &str, coul: u32, brillance: u32, metal: bool, opacite: f32, rugosite: f32| SaveMaterial {
        name: nom.into(), base_color: Color::from_rgb(coul), glossy_color: Color::from_rgb(brillance), clearcoat_color: Color::from_rgb(0),
        wrap_lighting: 0.25, is_metal: metal, roughness: rugosite, glossy_image_lerp: 255, edge: 1.0, thickness: 13, opacity: opacite,
        opacity_active_edge_alpha: if opacite < 1.0 { 255 } else { 254 },
    };
    let mats = vec![
        matiere("Plateau", 0xe6e6e6, 0x202020, false, 1.0, 0.35),
        matiere("Mur", 0x3b4049, 0x303030, false, 1.0, 0.5),
        matiere("Guide", 0xb8bcc4, 0x9a9aa0, true, 1.0, 0.8),
        matiere("Caoutchouc", 0x1b1d21, 0x101010, false, 1.0, 0.2),
        matiere("Tablier", 0x2f343c, 0x202020, false, 1.0, 0.4),
        matiere("Palette", 0xf2f2f2, 0x404040, false, 1.0, 0.7),
        matiere("Chapeau", 0xe8e8e8, 0x606060, false, 0.85, 0.9),
        matiere("Metal", 0xb8bcc4, 0x9a9aa0, true, 1.0, 0.8),
        matiere("Cible", 0xf0c030, 0x404040, false, 1.0, 0.7),
        matiere("Rampe", 0xdfeaff, 0xb0c0d0, false, 0.32, 0.95),     // plexi clair : on voit le plateau dessous
        matiere("Inox", 0xe6eaef, 0xffffff, true, 1.0, 0.92),
    ];
    let mut mats = mats;
    let elastique = u32::from_str_radix(s(&t["couleur_elastique"]).trim_start_matches('#'), 16).unwrap_or(0xc01c28);
    mats.push(matiere("CaoutchoucPalette", elastique, 0x202020, false, 1.0, 0.25));
    if let Some(fi) = finition.as_mut() { mats.extend(fi.materiaux.drain(..)); }
    if let Some(ch) = chassis.as_mut() { mats.extend(ch.materiaux.drain(..)); }
    if let Some(b) = bas.as_mut() { mats.extend(b.materiaux.drain(..)); }
    v.gamedata.materials_physics_old = Some(mats.iter().map(|m| SavePhysicsMaterial { name: m.name.clone(), elasticity: 0.3,
        elasticity_falloff: 0.0, friction: 0.3, scatter_angle: 0.0 }).collect());
    v.gamedata.materials_size = mats.len() as u32;
    v.gamedata.materials_old = mats;
    v.gamedata.playfield_material = "Plateau".into();

    v.add_or_replace_image(image("plateau", &imgs.join("plateau.jpg")));
    v.add_or_replace_image(image("fond_bureau", &imgs.join("fond.jpg")));

    let mut items: Vec<GameItemEnum> = vec![];

    // ---------------------------------------------------------------- murs (bords, guides, îlots, jupes des rampes)
    for m in t["murs"].as_array().unwrap() {
        // bords extérieurs du plateau : cachés dans le châssis (les flancs de la caisse les remplacent à l'image)
        let bord = ["BordG", "BordD", "BordHaut", "BordBas", "CoinG", "CoinD"].contains(&s(&m["nom"]).as_str())
            || s(&m["nom"]).starts_with("Arche");
        let visible = m["visible"].as_bool().unwrap_or(true) && !(bord && chassis.is_some());
        let mut wl = mur(&s(&m["nom"]), &points(&m["pts"]), f(&m["haut"]), visible, &s(&m["mat"]));
        wl.is_collidable = m["collision"].as_bool().unwrap_or(true);
        items.push(GameItemEnum::Wall(wl));
    }

    // ---------------------------------------------------------------- lance-pierres : face de frappe a → c
    for sl in t["lance_pierres"].as_array().unwrap() {
        let (ax, ay, cx, cy) = (f(&sl["a"][0]), f(&sl["a"][1]), f(&sl["c"][0]), f(&sl["c"][1]));
        let (dx, dy) = (cx - ax, cy - ay);
        let l = (dx * dx + dy * dy).sqrt();
        let dist = |x: f32, y: f32| ((x - ax) * dy - (y - ay) * dx).abs() / l;
        // avec la finition, le bloc est invisible : élastique, montants et plastron sont des primitives (decor.py)
        let mut wl = mur(&s(&sl["nom"]), &points(&sl["pts"]), 35.0, finition.is_none(), "Mur");
        wl.side_material = "Caoutchouc".into();
        let n = wl.drag_points.len();
        let pts: Vec<(f32, f32)> = wl.drag_points.iter().map(|d| (d.x / MM, d.y / MM)).collect();
        for k in 0..n {
            let (a, b) = (pts[k], pts[(k + 1) % n]);
            if dist(a.0, a.1) < 1.0 && dist(b.0, b.1) < 1.0 { wl.drag_points[k].is_slingshot = Some(true); }
        }
        wl.hit_event = true; wl.slingshot_force = 80.0; wl.slingshot_threshold = 2.0; wl.slingshot_animation = true;
        items.push(GameItemEnum::Wall(wl));
    }

    // ---------------------------------------------------------------- palettes
    for p in t["palettes"].as_array().unwrap() {
        items.push(GameItemEnum::Flipper(Flipper {
            name: s(&p["nom"]), center: p2(f(&p["x"]), f(&p["y"])),
            base_radius: f(&p["r1"]) * MM, end_radius: f(&p["r2"]) * MM, flipper_radius_max: f(&p["long"]) * MM,
            start_angle: f(&p["debut"]), end_angle: f(&p["fin"]), material: "Palette".into(), rubber_material: "CaoutchoucPalette".into(),
            // élastique : 7 u d'épaisseur, 19 u du plateau, 24 u de haut (valeurs de vpinball) ; dessus décoré
            rubber_thickness_int: 7, rubber_thickness: Some(7.0), rubber_height_int: 19, rubber_height: Some(19.0),
            rubber_width_int: 24, rubber_width: Some(24.0), image: finition.as_ref().map(|_| "palette".to_string()),
            ..Default::default()
        }));
    }

    // ---------------------------------------------------------------- bumpers
    for b in t["bumpers"].as_array().unwrap() {
        items.push(GameItemEnum::Bumper(Bumper { name: s(&b["nom"]), center: p2(f(&b["x"]), f(&b["y"])), radius: f(&b["r"]) * MM,
            hit_event: Some(true), cap_material: "Chapeau".into(), base_material: "Metal".into(), socket_material: "Metal".into(),
            ring_material: Some("Metal".into()), is_cap_visible: finition.is_none(), ..Default::default() }));
    }

    // ---------------------------------------------------------------- cibles (face tournée vers la bille)
    for c in t["cibles"].as_array().unwrap() {
        let genre = match c["genre"].as_str().unwrap_or("") {
            "tombante" => TargetType::DropTargetSimple, "ronde" => TargetType::HitTargetRound, _ => TargetType::HitFatTargetRectangle };
        let mut ht = HitTarget { name: s(&c["nom"]), position: Vertex3D::new(f(&c["x"]) * MM, f(&c["y"]) * MM, 0.0), target_type: genre,
            rot_z: angle_vp(f(&c["nx"]), f(&c["ny"])) - 180.0, use_hit_event: true, material: "Cible".into(), is_visible: true, ..Default::default() };
        if matches!(ht.target_type, TargetType::HitTargetRound) { let d = 22.0 * MM; ht.size = Vertex3D::new(d, d, d); }
        items.push(GameItemEnum::HitTarget(ht));
    }

    // ---------------------------------------------------------------- capteurs (couloirs, contacts de rampe)
    for c in t["couloirs"].as_array().unwrap() {
        let forme = match c["forme"].as_str().unwrap_or("fil") {
            "etoile" => TriggerShape::Star, "bouton" => TriggerShape::Button, "invisible" => TriggerShape::None, _ => TriggerShape::WireA };
        let (x, y, a) = (f(&c["x"]), f(&c["y"]), f(&c["angle"]));
        let mut tr = Trigger { name: s(&c["nom"]), center: p2(x, y), radius: 25.0, rotation: a, shape: forme,
            drag_points: rect(x, y, f(&c["dx"]), f(&c["dy"]), a), surface: s(&c["surface"]), is_visible: true, ..Default::default() };
        if f(&c["haut"]) > 0.0 { tr.hit_height = f(&c["haut"]) * MM; }
        items.push(GameItemEnum::Trigger(tr));
    }

    // ---------------------------------------------------------------- trous (saucers, kickback)
    for k in t["trous"].as_array().unwrap() {
        let genre = match k["genre"].as_str().unwrap_or("") { "kickback" => KickerType::Invisible, _ => KickerType::Hole };
        items.push(GameItemEnum::Kicker(Kicker { name: s(&k["nom"]), center: p2(f(&k["x"]), f(&k["y"])), radius: f(&k["r"]) * MM,
            kicker_type: genre, surface: s(&k["surface"]), is_enabled: k["genre"] != "kickback", ..Default::default() }));
    }

    // ---------------------------------------------------------------- tourniquets et portes
    for sp in t["tourniquets"].as_array().unwrap() {
        items.push(GameItemEnum::Spinner(Spinner { name: s(&sp["nom"]), center: p2(f(&sp["x"]), f(&sp["y"])), rotation: f(&sp["angle"]),
            length: f(&sp["long"]) * MM, material: if finition.is_some() { "Inox".into() } else { String::new() },
            image: if finition.is_some() { "tourniquet".into() } else { String::new() }, show_bracket: true, ..Default::default() }));
    }
    for g in t["portes"].as_array().unwrap() {
        let (x1, y1, x2, y2) = (f(&g["x1"]), f(&g["y1"]), f(&g["x2"]), f(&g["y2"]));
        items.push(GameItemEnum::Gate(Gate { name: s(&g["nom"]), center: p2((x1 + x2) / 2.0, (y1 + y2) / 2.0),
            length: ((x2 - x1).powi(2) + (y2 - y1).powi(2)).sqrt() * MM, rotation: angle_vp(x2 - x1, y2 - y1) - 90.0,
            two_way: g["double"].as_bool().unwrap_or(false), ..Default::default() }));
    }

    // ---------------------------------------------------------------- rampes : une section VPX par pente
    for r in t["rampes"].as_array().unwrap() {
        let flanc = f(&r["flanc"]) * MM;
        for sc in r["sections"].as_array().unwrap() {
            let pts = points(&sc["pts"]);
            if pts.len() < 2 { continue; }
            items.push(GameItemEnum::Ramp(Ramp {
                name: s(&sc["nom"]), ramp_type: RampType::Flat, height_bottom: f(&sc["z0"]) * MM, height_top: f(&sc["z1"]) * MM,
                width_bottom: f(&sc["l0"]) * MM, width_top: f(&sc["l1"]) * MM,
                left_wall_height: flanc, right_wall_height: flanc, left_wall_height_visible: flanc, right_wall_height_visible: flanc,
                drag_points: pts.iter().map(|&(x, y)| DragPoint { smooth: true, ..dp(x, y) }).collect(),
                material: "Rampe".into(), is_visible: true, ..Default::default()
            }));
        }
    }

    // ---------------------------------------------------------------- guides en fil d'acier (wireform de Fanny Pinball)
    // deux tiges horizontales (rampes « un fil » non touchables) : Ø 4 mm au centre de la bille, Ø 3 mm à 23 mm ;
    // bouts coudés plantés dans le plateau (montants aux extrémités), rondelles, montants tous les ~130 mm
    let tige = |nom: String, pts: &[(f32, f32)], z: f32, d: f32| GameItemEnum::Ramp(Ramp {
        name: nom, ramp_type: RampType::OneWire, height_bottom: z * MM, height_top: z * MM, width_bottom: d * MM, width_top: d * MM,
        wire_diameter: d * MM, left_wall_height: 0.0, right_wall_height: 0.0, left_wall_height_visible: 0.0, right_wall_height_visible: 0.0,
        drag_points: pts.iter().map(|&(x, y)| DragPoint { smooth: true, ..dp(x, y) }).collect(),
        material: "Inox".into(), is_visible: true, is_collidable: false, ..Default::default()
    });
    let rond = |x: f32, y: f32, r: f32| -> Vec<(f32, f32)> { (0..12).map(|k| { let a = k as f32 * std::f32::consts::TAU / 12.0;
        (x + r * a.cos(), y + r * a.sin()) }).collect() };
    let montant = |nom: String, x: f32, y: f32, r: f32, h: f32| { let mut w = mur(&nom, &rond(x, y, r), h, true, "Inox"); w.is_collidable = false; GameItemEnum::Wall(w) };
    for (k, fl) in t["fils"].as_array().cloned().unwrap_or_default().iter().enumerate() {
        let pts = points(&fl["pts"]);
        if pts.len() < 2 { continue; }
        items.push(tige(format!("Fil{k}_bas"), &pts, 13.5, 4.0));
        items.push(tige(format!("Fil{k}_haut"), &pts, 23.0, 3.0));
        // montants : extrémités (bouts coudés) puis jalons réguliers le long du tracé
        let lg: Vec<f32> = pts.windows(2).map(|p| ((p[1].0 - p[0].0).powi(2) + (p[1].1 - p[0].1).powi(2)).sqrt()).collect();
        let total: f32 = lg.iter().sum();
        let n = ((total / 130.0).round() as usize).max(1);
        let mut jalons = vec![pts[0], *pts.last().unwrap()];
        for i in 1..n {
            let mut c = total * i as f32 / n as f32;
            for (j, l) in lg.iter().enumerate() {
                if c <= *l { let u = c / l.max(1e-3); jalons.push((pts[j].0 + u * (pts[j + 1].0 - pts[j].0), pts[j].1 + u * (pts[j + 1].1 - pts[j].1))); break; }
                c -= l;
            }
        }
        for (m, &(x, y)) in jalons.iter().enumerate() {
            items.push(montant(format!("Fil{k}_montant{m}"), x, y, 1.6, 23.0));
            items.push(montant(format!("Fil{k}_rondelle{m}"), x, y, 3.4, 1.8));
        }
    }

    // ---------------------------------------------------------------- évacuation, distributeur, lanceur
    let mut drain = Trigger { name: "Drain".into(), center: p2(w / 2.0, h - 50.0), radius: 25.0, shape: TriggerShape::None, is_visible: false, ..Default::default() };
    drain.drag_points = sens_vp(&points(&t["drain"])).iter().map(|&(x, y)| dp(x, y)).collect();
    items.push(GameItemEnum::Trigger(drain));
    let l = &t["lanceur"];
    let (lx, ly, br) = (f(&l["x"]), f(&l["y"]), f(&t["BALL_R"]));
    items.push(GameItemEnum::Kicker(Kicker { name: "Distributeur".into(), center: p2(lx, ly - 30.0), radius: 25.0,
        kicker_type: KickerType::Invisible, ..Default::default() }));
    let course = 80.0;
    items.push(GameItemEnum::Plunger(Plunger { name: "Plunger".into(), center: Vertex2D::new(lx * MM, (ly + br) * MM + course),
        width: 22.0 * MM * 0.5, stroke: course, speed_fire: TIR_LANCEUR, mech_strength: TIR_LANCEUR, speed_pull: TIRAGE_LANCEUR, ..Default::default() }));
    let mut capt = Trigger { name: "CapteurLanceur".into(), center: p2(lx, ly), radius: 25.0, shape: TriggerShape::None, is_visible: false, ..Default::default() };
    capt.drag_points = rect(lx, ly, 9.0, 9.0, 0.0);
    items.push(GameItemEnum::Trigger(capt));
    for it in items.iter_mut() {
        if let GameItemEnum::Trigger(tr) = it { tr.scale_x = 1.0; tr.scale_y = 1.0; tr.anim_speed = 1.0; tr.wire_thickness = Some(0.0); }
    }

    // ---------------------------------------------------------------- lampes : état (L_, invisible) et insert allumé (F_)
    for lp in t["lampes"].as_array().unwrap() {
        let n = s(&lp["nom"]);
        let (x, y, r) = (f(&lp["x"]), f(&lp["y"]), f(&lp["r"]));
        let mut li = Light { name: format!("L_{n}"), center: p2(x, y), falloff_radius: r * MM, color: couleur(&s(&lp["couleur"])),
            intensity: 0.0, state_u32: 0, state: Some(0.0), visible: Some(false), ..Default::default() };
        li.color2 = li.color;
        li.drag_points = (0..8).map(|k| { let a = -(k as f32) * std::f32::consts::TAU / 8.0;
            DragPoint { x: li.center.x + r * MM * a.cos(), y: li.center.y + r * MM * a.sin(), ..Default::default() } }).collect();
        items.push(GameItemEnum::Light(li));
        v.add_or_replace_image(image(&format!("insert_{n}"), &imgs.join("inserts").join(format!("{n}.png"))));
        let demi = r * 1.35 + 0.6;
        let mut fl = Flasher { name: format!("F_{n}"), image_a: format!("insert_{n}"), height: 1.5 * MM, pos_x: Some(x * MM), pos_y: Some(y * MM),
            display_texture: true, alpha: 100, is_visible: false, filter: Filter::None, image_alignment: RampImageAlignment::Wrap,
            color: Color::from_rgb(0xffffff), modulate_vs_add: 1.0, ..Default::default() };
        fl.drag_points = [(-1.0, 1.0), (1.0, 1.0), (1.0, -1.0), (-1.0, -1.0)].iter().map(|&(a, b)| dp(x + a * demi, y + b * demi)).collect();
        items.push(GameItemEnum::Flasher(fl));
    }

    // ---------------------------------------------------------------- afficheur à points sous le fronton, horloge
    let police = |pt: u32| Font::new(0, HashSet::new(), 700, pt * 10000, "Arial".into());
    let haut_aff = (FRONTON_BUREAU[1] + FRONTON_BUREAU[2] * 1680.0 / 1050.0 * 832.0 / 1216.0) * 750.0 + 14.0;
    let (g_aff, d_aff) = (FRONTON_BUREAU[0] * 1000.0, (FRONTON_BUREAU[0] + FRONTON_BUREAU[2]) * 1000.0);
    let h_aff = (d_aff - g_aff) / 1000.0 * 1680.0 / 4.0 / 1050.0 * 750.0;
    let mut aff = TextBox { name: "Afficheur".into(), ver1: Vertex2D::new(g_aff, haut_aff), ver2: Vertex2D::new(d_aff, haut_aff + h_aff),
        text: "".into(), is_transparent: false, is_dmd: Some(true), align: TextAlignment::Center, font: police(20), ..Default::default() };
    aff.back_color = Color::from_rgb(0x0a0604); aff.font_color = Color::from_rgb(0xffffff); aff.intensity_scale = 1.0;
    items.push(GameItemEnum::TextBox(aff));
    // panneaux animés du fond (GIF de l'habillage, vues déjà en JPEG par plan.py) : flashers tournés vers la caméra
    for p in t["panneaux"].as_array().cloned().unwrap_or_default() {
        let nom = s(&p["nom"]);
        let (x, y, z, larg, haut) = (f(&p["x"]), f(&p["y"]), f(&p["z"]), f(&p["larg"]), f(&p["haut"]));
        for (k, vue) in p["vues"].as_array().unwrap().iter().enumerate() {
            v.add_or_replace_image(image(&format!("{nom}_{k:02}"), Path::new(&s(vue))));
        }
        let mut fl = Flasher { name: format!("Gif{nom}"), image_a: format!("{nom}_00"), height: z * MM, pos_x: Some(x * MM), pos_y: Some(y * MM),
            rot_x: -45.0, display_texture: true, alpha: 100, is_visible: true, filter: Filter::None, image_alignment: RampImageAlignment::Wrap,
            color: Color::from_rgb(0xffffff), modulate_vs_add: 1.0, ..Default::default() };
        fl.drag_points = [(-1.0, 1.0), (1.0, 1.0), (1.0, -1.0), (-1.0, -1.0)].iter().map(|&(a, b)| dp(x + a * larg / 2.0, y + b * haut / 2.0)).collect();
        items.push(GameItemEnum::Flasher(fl));
    }
    let mut horloge = Timer { name: "Horloge".into(), center: Vertex2D::new(20.0, 20.0), ..Default::default() };
    horloge.timer.is_enabled = true; horloge.timer.interval = 20;
    items.push(GameItemEnum::Timer(horloge));
    if let Some(fi) = finition.as_mut() { items.extend(fi.items.drain(..)); }
    if let Some(ch) = chassis.as_mut() { items.extend(ch.items.drain(..)); }
    if let Some(b) = bas.as_mut() { items.extend(b.items.drain(..)); }
    let prim_lanceur: Vec<String> = items.iter().filter_map(|it| match it {
        GameItemEnum::Primitive(p) if p.name.starts_with("PrimLanceur_") => Some(p.name.clone()), _ => None }).collect();
    for it in items { v.add_game_item(it); }

    // ---------------------------------------------------------------- sons (moteur/sons/*.wav, synthétisés par sons.py)
    // sons neutres du moteur, remplacés par ceux de l'habillage (<table>/sons/*.wav|mp3, même nom) ; musiques sur le fronton
    let lister = |d: PathBuf| -> Vec<PathBuf> { fs::read_dir(d).map(|r| r.filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "wav" || x == "mp3" || x == "ogg")).collect()).unwrap_or_default() };
    let mut parnom: std::collections::BTreeMap<String, PathBuf> = std::collections::BTreeMap::new();
    for sp in lister(moteur.join("sons")).into_iter().chain(lister(dossier.join("sons"))) {
        parnom.insert(sp.file_stem().unwrap().to_string_lossy().to_string(), sp);
    }
    let musiques: Vec<String> = t["musiques"].as_array().cloned().unwrap_or_default().iter().map(s).collect();
    for (nom, sp) in &parnom {
        let mut sd = son(nom, sp);
        if musiques.contains(nom) { sd.output_target = OutputTarget::Backglass; }
        v.sounds.push(sd);
    }
    v.gamedata.sounds_size = v.sounds.len() as u32;

    // ---------------------------------------------------------------- script : commun + en-tête généré + règles
    let commun = fs::read_to_string(moteur.join("commun.vbs")).expect("moteur/commun.vbs");
    let entete = fs::read_to_string(sortie.join("entete.vbs")).expect("sortie/entete.vbs");
    let regles = fs::read_to_string(dossier.join("regles.vbs")).expect("regles.vbs");
    // pièces mobiles du châssis (pommeau et tige du lanceur de Fanny) : tableau animé par commun.vbs
    let entete = format!("{entete}Dim PrimLanceur : PrimLanceur = Array({})\n", prim_lanceur.join(", "));
    let script = commun.replacen("' ==== EN-TETE ====\n", &entete, 1).replacen("' ==== REGLES ====\n", &regles, 1);
    v.gamedata.code = StringWithEncoding::from(script.as_str());

    let cible = sortie.join(format!("{}.vpx", s(&t["nom"])));
    vpx::write(&cible, &v).unwrap();
    println!("{} : {} éléments, {} images, {} sons", cible.display(), v.gameitems.len(), v.images.len(), v.sounds.len());
}
