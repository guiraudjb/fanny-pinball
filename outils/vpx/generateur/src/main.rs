// Fabrique la table Visual Pinball (.vpx) de Fanny Pinball.
//
// Entrées (outils/vpx/exporter_vpx.mjs les prépare depuis la version web) :
//   donnees/table.json   géométrie en mm (repère du plateau : x à droite, y vers le joueur)
//   donnees/plateau.png  plateau peint par le moteur 2D du jeu, lampes éteintes
//   table.vbs            règles du jeu (portage de js/rules.js)
//   ../../assets/fronton.jpg, ../../assets/sons/*.mp3
//
// Sortie : sortie/FannyPinball.vpx
//
// Les éléments partent des valeurs par défaut de vpinball (bibliothèque vpin, celle de vpxtool) : on ne fixe que
// la position, les dimensions et les noms utilisés par le script. 1 unité VP = 0,54 mm (bille de 27 mm = 50 u).
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
        GameItemEnum, bumper::Bumper, dragpoint::DragPoint, flasher::{Filter, Flasher}, flipper::Flipper, ramp_image_alignment::RampImageAlignment, gate::Gate, hittarget::{HitTarget, TargetType},
        kicker::{Kicker, KickerType}, light::Light, plunger::Plunger, ramp::{Ramp, RampType}, spinner::Spinner,
        textbox::{TextAlignment, TextBox}, font::Font, timer::Timer, trigger::{Trigger, TriggerShape}, vertex2d::Vertex2D, vertex3d::Vertex3D, wall::Wall,
    },
    image::ImageData,
    material::{SaveMaterial, SavePhysicsMaterial},
    model::StringWithEncoding,
    pinbinary::PinBinary,
    sound::{OutputTarget, SoundData, WaveForm, read_sound},
};

const MM: f32 = 1.0 / 0.54; // mm → unités VP
// Frappe propre du lanceur de vpinball : presque nulle. Au clavier il partait tout ou rien (rien sous 0,45 s d'appui,
// pleine vitesse au-delà de 0,7 s) ; la vitesse de la bille est donnée par le script (LacherLanceur : durée d'appui,
// ressort précomprimé, comme le jeu web), le lanceur de vpinball ne sert plus qu'au geste. TIR_LANCEUR=… pour essayer.
const TIR_LANCEUR: f32 = 5.0;
/// vitesse de tirage du lanceur (vpinball speed_pull, 0,5 par défaut : pleine course en moins de 0,3 s) : le geste
/// suit l'appui, pleine course en 0,7 à 0,9 s comme TIRAGE_MS du script.
const TIRAGE_LANCEUR: f32 = 0.1;
/// luminosité de l'afficheur à points (1 = vpinball par défaut)
const LUMINOSITE_AFFICHEUR: f32 = 1.0;
/// force des reflets sur le plateau (0 à 1 ; la table minimale de vpin met 1, trop fort : effet miroir)
const REFLET_PLATEAU: f32 = 0.12;
/// opacité des inserts allumés (flashers F_<nom>, 0–100) ; INSERT=… pour essayer
static INTENSITE_INSERT: std::sync::LazyLock<f32> = std::sync::LazyLock::new(|| std::env::var("INSERT").ok().and_then(|s| s.parse().ok()).unwrap_or(100.0));
/// Panneaux animés du fond (vue bureau) : GIF, flasher, centre x, y, hauteur et côté en mm (repère du plateau), tournés
/// de 45° vers la caméra ; ils recouvrent les cadres dessinés par fond.py sous l'afficheur (réglés à l'écran).
/// Dernières valeurs : largeur et hauteur (dans le plan du panneau, mm).
const PANNEAUX: [(&str, &str, f32, f32, f32, f32, f32); 3] = [
    ("chassis", "GifChassis", 552.5, 1217.5, 332.5, 110.0, 110.0),
    ("articulation", "GifArticulation", 673.0, 1217.5, 332.5, 112.0, 112.0),
    ("tourniquet", "GifTourniquet", -191.0, 732.0, 118.0, 207.0, 350.0),
];
/// place du fronton sur le fond de la vue bureau : gauche, haut, largeur (fractions de l'écran)
const FRONTON_BUREAU: [f32; 3] = [0.64, 0.04, 0.34];
/// caméra de la vue bureau (mode caméra) : visée, champ, recul, position x/y/z, échelle x, mode, décalage horizontal
const VUE_BUREAU: [f32; 9] = [45.0, 45.0, 0.0, 0.0, 600.0, 1500.0, 1.0, 1.0, -15.0];

fn f(v: &Value) -> f32 { v.as_f64().unwrap_or(0.0) as f32 }
fn p2(x: f32, y: f32) -> Vertex2D { Vertex2D::new(x * MM, y * MM) }
fn dp(x: f32, y: f32, z: f32) -> DragPoint { DragPoint { x: x * MM, y: y * MM, z: z * MM, ..Default::default() } }
fn couleur(hex: &str) -> Color { Color::from_rgb(u32::from_str_radix(hex.trim_start_matches('#'), 16).unwrap_or(0xffffff)) }
/// angle vpinball (degrés, 0 = vers le haut de l'écran, sens horaire) d'un vecteur du plateau (y vers le joueur)
fn angle_vp(x: f32, y: f32) -> f32 { x.atan2(-y).to_degrees() }

/// rectangle de détection d'un capteur (demi-largeur, demi-hauteur en mm), sens attendu par vpinball
fn rect_capteur(x: f32, y: f32, dx: f32, dy: f32) -> Vec<DragPoint> {
    [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)].iter()
        .map(|(a, b): &(f32, f32)| DragPoint { x: (x + a * dx) * MM, y: (y + b * dy) * MM, ..Default::default() }).collect()
}

fn image(nom: &str, chemin: &Path) -> ImageData { image_a(nom, chemin, false) }

/// masque : les pixels presque transparents sont jetés (feuillages, découpes) au lieu d'être mélangés
fn image_a(nom: &str, chemin: &Path, masque: bool) -> ImageData {
    let data = fs::read(chemin).unwrap_or_else(|e| panic!("{} : {e}", chemin.display()));
    let (w, h) = image::image_dimensions(chemin).expect("dimensions de l'image");
    let fichier = chemin.file_name().unwrap().to_string_lossy().to_string();
    ImageData {
        name: nom.into(), internal_name: None, path: fichier.clone(), width: w, height: h, link: None,
        alpha_test_value: if masque { 128.0 } else { -1.0 }, is_opaque: None, is_signed: None,
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

fn mur(nom: &str, pts: &[(f32, f32)], haut: f32, visible: bool) -> Wall {
    let mut w = Wall { name: nom.into(), height_top: haut * MM, height_bottom: 0.0, is_top_bottom_visible: visible,
        is_side_visible: visible, ..Default::default() };
    // vpinball attend ses polygones dans le sens horaire mathématique (aire signée < 0, y vers le bas) : dans l'autre
    // sens, les normales de collision pointent vers l'intérieur et la bille entre dans le mur (et y reste coincée).
    let aire: f32 = (0..pts.len()).map(|i| { let (a, b) = (pts[i], pts[(i + 1) % pts.len()]); a.0 * b.1 - b.0 * a.1 }).sum();
    let mut pts = pts.to_vec();
    if aire > 0.0 { pts.reverse(); }
    w.drag_points = pts.iter().map(|&(x, y)| dp(x, y, 0.0)).collect();
    w
}

fn main() {
    let ici = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let racine = ici.join("../..");
    let t: Value = serde_json::from_str(&fs::read_to_string(ici.join("donnees/table.json")).expect("donnees/table.json (node outils/vpx/exporter_vpx.mjs)")).unwrap();
    let sortie = ici.join("sortie");
    fs::create_dir_all(&sortie).unwrap();

    // table minimale officielle (version, infos, données de jeu par défaut), relue puis complétée
    let base = sortie.join(".minimale.vpx");
    vpx::new_minimal_vpx(&base).unwrap();
    let mut v: VPX = vpx::read(&base).unwrap();
    fs::remove_file(&base).ok();

    let (w, h) = (f(&t["W"]), f(&t["H"]));
    {
        let g = &mut v.gamedata;
        g.name = "Table1".into();
        g.left = 0.0; g.top = 0.0; g.right = w * MM; g.bottom = h * MM;
        g.angle_tilt_min = f(&t["pente_deg"]);
        g.angle_tilt_max = f(&t["pente_deg"]);
        g.image = "plateau".into();
        // vue « bureau » (écran unique paysage, comme les autres tables de la Batocera) : plateau en perspective depuis
        // le joueur, décalé à gauche ; le fond (fond_bureau.jpg : salle sombre, fronton et afficheur à droite) remplit l'écran.
        // VUE="inclinaison,champ,recul,x,y,z,échelle_x" pour essayer d'autres réglages sans recompiler.
        let vue: Vec<f32> = std::env::var("VUE").ok().map(|s| s.split(',').filter_map(|x| x.trim().parse().ok()).collect())
            .filter(|v: &Vec<f32>| v.len() >= 7).unwrap_or(VUE_BUREAU.to_vec());
        let d = &mut g.view_setups[ViewSetupId::Desktop];
        // 8e valeur : 1 = mode caméra (position depuis le bas du plateau, sans déformation) ; 9e : décalage horizontal du cadrage
        d.mode = Some(if vue.get(7).copied().unwrap_or(0.0) > 0.5 { ViewLayoutMode::Camera } else { ViewLayoutMode::Legacy });
        d.view_horizontal_offset = vue.get(8).copied();
        d.viewport_rotation = Some(0.0);
        d.look_at = Some(vue[0]); d.fov = Some(vue[1]); d.layback = Some(vue[2]);
        d.view_x = Some(vue[3]); d.view_y = Some(vue[4]); d.view_z = Some(vue[5]);
        d.scene_scale_x = Some(vue[6]); d.scene_scale_y = Some(1.0); d.scene_scale_z = Some(1.0);
        g.backglass_image_full_desktop = "fond_bureau".into();
        g.display_backdrop = true;
        g.glass_top_height = 210.0;
        g.glass_bottom_height = Some(210.0);
        g.ball_spherical_mapping = Some(false);
    }
    v.info.table_name = Some("Fanny Pinball — Pétanque World Tour".into());
    v.info.author_name = Some("Fanny Pinball".into());
    v.info.table_version = Some("1.0".into());
    v.info.table_blurb = Some("Flipper des années 70 à la provençale, porté de la version web".into());
    v.info.table_rules = Some("F-A-N-N-Y allume le Cercle : multiball. En multiball, la rampe vaut JACKPOT. T-O-U-R : bonus ×2 à ×5, puis extra ball au Cercle. Rampe : escales du World Tour, 7 escales = Grand Chelem.".into());

    // matières (format 10.7 : MATE + PHMA)
    let matiere = |nom: &str, coul: u32, brillance: u32, metal: bool, opacite: f32, rugosite: f32| SaveMaterial {
        name: nom.into(), base_color: Color::from_rgb(coul), glossy_color: Color::from_rgb(brillance), clearcoat_color: Color::from_rgb(0),
        wrap_lighting: 0.25, is_metal: metal, roughness: rugosite, glossy_image_lerp: 255, edge: 1.0, thickness: 13, opacity: opacite,
        opacity_active_edge_alpha: if opacite < 1.0 { 255 } else { 254 },
    };
    let mats = vec![
        matiere("Bois", 0x7a4a26, 0x101010, false, 1.0, 0.45),
        // plateau peint : gris très clair (vpinball multiplie l'image par la couleur de la matière ; « Bois » le rendait
        // brun et terne, le blanc pur brûle les clairs) ; MATPLATEAU=rrggbb pour essayer
        matiere("Plateau", std::env::var("MATPLATEAU").ok().and_then(|s| u32::from_str_radix(&s, 16).ok()).unwrap_or(0xe6e6e6), 0x202020, false, 1.0, 0.35),
        matiere("Plastique", 0xfff4dc, 0x5a5a5a, false, 0.55, 0.9),
        matiere("Metal", 0xb8bcc4, 0x9a9aa0, true, 1.0, 0.8),
        matiere("Palette", 0xf6f1e6, 0x404040, false, 1.0, 0.7),
        matiere("Caoutchouc", 0xc8121d, 0x101010, false, 1.0, 0.2),
        matiere("Chapeau", 0xd8261e, 0x606060, false, 0.85, 0.9),
        matiere("Cible", 0xf0c030, 0x404040, false, 1.0, 0.7),
    ];
    // décor 3D de la version d'origine (python3 decor_glb.py) : s'il est là, les éléments VPX ne servent qu'à la physique
    let pal = &t["palettes"];
    let pivots = [("PrimPaletteG", f(&pal[0]["px"]) * MM, f(&pal[0]["py"]) * MM), ("PrimPaletteD", f(&pal[1]["px"]) * MM, f(&pal[1]["py"]) * MM)];
    let mut decor = ici.join("donnees/decor").join("decor.json").exists()
        .then(|| decor::charger(&ici.join("donnees/decor"), &pivots, image_a));
    let vu = decor.is_none();
    let mut mats = mats;
    let mut physiques_decor: Vec<SavePhysicsMaterial> = vec![];
    if let Some(d) = &mut decor { mats.append(&mut d.materiaux); physiques_decor.append(&mut d.physiques); }
    let n_decor = physiques_decor.len();
    v.gamedata.materials_physics_old = Some(mats.iter().take(mats.len() - n_decor).map(|m| SavePhysicsMaterial { name: m.name.clone(), elasticity: 0.3,
        elasticity_falloff: 0.0, friction: 0.3, scatter_angle: 0.0 }).chain(physiques_decor).collect());
    v.gamedata.materials_size = mats.len() as u32;
    v.gamedata.materials_old = mats;
    v.gamedata.playfield_material = "Plateau".into();
    // rendu des couleurs : Reinhard, le plus fidèle au plateau peint à l'essai (Neutral et AgX voilent les couleurs) ;
    // TONE=agx|punchy|filmic|neutral pour essayer
    v.gamedata.tone_mapper = Some(match std::env::var("TONE").as_deref() {
        Ok("agx") => ToneMapper::AgX, Ok("punchy") => ToneMapper::AgXPunchy, Ok("filmic") => ToneMapper::Filmic,
        Ok("neutral") => ToneMapper::Neutral, _ => ToneMapper::Reinhard });
    // reflets du plateau : discrets (le plateau peint d'origine est mat, sous une vitre)
    v.gamedata.playfield_reflection_strength = REFLET_PLATEAU;
    v.gamedata.ball_playfield_reflection_strength = Some(0.5);

    match &mut decor {
        Some(d) => {
            // plateau aux inserts éteints assombris (inserts.py), sinon celui du décor
            let eteint = ici.join("donnees/decor/plateau_eteint.jpg");
            v.add_or_replace_image(image("plateau", if eteint.exists() { &eteint } else { &d.plateau })); for im in std::mem::take(&mut d.images) { v.add_or_replace_image(im); } }
        None => { v.add_or_replace_image(image("plateau", &ici.join("donnees/plateau.png"))); }
    }
    v.add_or_replace_image(image("fronton", &racine.join("assets/fronton.jpg")));
    // fond de la vue bureau (16:10) : salle sombre, fronton en haut à droite ; l'afficheur se place dessous
    {
        let (lw, lh) = (1680u32, 1050u32);
        // décor du World Tour (python3 fond.py) s'il est là, sinon un dégradé sombre
        let mut fond = match image::open(ici.join("donnees/fond/fond.jpg")) {
            Ok(im) => image::imageops::resize(&im.to_rgb8(), lw, lh, image::imageops::FilterType::Lanczos3),
            Err(_) => image::RgbImage::from_fn(lw, lh, |_, y| { let k = 1.0 - 0.5 * y as f32 / lh as f32;
                image::Rgb([(34.0 * k) as u8, (26.0 * k) as u8, (22.0 * k) as u8]) }),
        };
        let fr = image::open(racine.join("assets/fronton.jpg")).unwrap().to_rgb8();
        let fw = (lw as f32 * FRONTON_BUREAU[2]) as u32;
        let fh = fw * fr.height() / fr.width();
        let fr = image::imageops::resize(&fr, fw, fh, image::imageops::FilterType::Lanczos3);
        image::imageops::overlay(&mut fond, &fr, (lw as f32 * FRONTON_BUREAU[0]) as i64, (lh as f32 * FRONTON_BUREAU[1]) as i64);
        let chemin = sortie.join(".fond_bureau.jpg");
        fond.save(&chemin).unwrap();
        v.add_or_replace_image(image("fond_bureau", &chemin));
        fs::remove_file(&chemin).ok();
    }

    let mut items: Vec<GameItemEnum> = vec![];

    // ---------------------------------------------------------------- collisions
    // Les colliders 3D de la version d'origine (python3 collisions.py) remplacent les murs du plan 2D et la rampe :
    // le plan 2D ignorait des volumes (pattes et flancs de la rampe, bloc F-A-N-N-Y…) où la bille se coinçait.
    let col_dir = ici.join("donnees/collisions");
    let colliders_origine = col_dir.join("collisions.json").exists();
    if colliders_origine { items.extend(decor::collisions(&col_dir)); }
    for (i, m) in t["murs"].as_array().unwrap().iter().enumerate() {
        if colliders_origine { break; }
        let pts: Vec<(f32, f32)> = m["pts"].as_array().unwrap().iter().map(|p| (f(&p[0]), f(&p[1]))).collect();
        let genre = m["genre"].as_str().unwrap_or("mur");
        let visible = vu && m["visible"].as_bool().unwrap_or(true) && genre != "apron";
        let haut = match genre { "plastique" => 38.0, "flanc" => 60.0, _ => 32.0 };
        let mut wl = mur(&format!("Mur{i:03}"), &pts, haut, visible);
        wl.image = "plateau".into();          // le dessus reprend le plateau peint (projection monde)
        wl.side_material = if genre == "plastique" { "Plastique" } else { "Bois" }.into();
        wl.top_material = "Bois".into();
        items.push(GameItemEnum::Wall(wl));
    }

    // ---------------------------------------------------------------- lance-pierres : face de frappe A → C
    for (i, s) in t["lance_pierres"].as_array().unwrap().iter().enumerate() {
        let (ax, ay, cx, cy) = (f(&s["A"][0]), f(&s["A"][1]), f(&s["C"][0]), f(&s["C"][1]));
        let pts: Vec<(f32, f32)> = s["pts"].as_array().unwrap().iter().map(|p| (f(&p[0]), f(&p[1]))).collect();
        let (dx, dy) = (cx - ax, cy - ay);
        let l = (dx * dx + dy * dy).sqrt();
        let dist = |x: f32, y: f32| ((x - ax) * dy - (y - ay) * dx).abs() / l;
        let mut wl = mur(if i == 0 { "LanceG" } else { "LanceD" }, &pts, 32.0, vu);
        wl.image = "plateau".into(); wl.side_material = "Caoutchouc".into(); wl.top_material = "Bois".into();
        let n = wl.drag_points.len();
        let pts: Vec<(f32, f32)> = wl.drag_points.iter().map(|d| (d.x / MM, d.y / MM)).collect();   // ordre vpinball
        for k in 0..n {
            let (a, b) = (pts[k], pts[(k + 1) % n]);
            if dist(a.0, a.1) < 2.5 && dist(b.0, b.1) < 2.5 { wl.drag_points[k].is_slingshot = Some(true); }
        }
        wl.hit_event = true;
        wl.slingshot_force = 80.0;
        wl.slingshot_threshold = 2.0;
        wl.slingshot_animation = true;
        items.push(GameItemEnum::Wall(wl));
    }

    // ---------------------------------------------------------------- palettes
    for p in t["palettes"].as_array().unwrap() {
        let gauche = p["side"] == "L";
        let (repos, levee) = (f(&p["rest"]).to_degrees(), f(&p["up"]).to_degrees());
        // jeu web : angle sous l'horizontale, palette gauche vers la droite ; vpinball : 0 = vers le haut, sens horaire
        let (a0, a1) = if gauche { (90.0 + repos, 90.0 + levee) } else { (-90.0 + repos, -90.0 + levee) };
        items.push(GameItemEnum::Flipper(Flipper {
            name: if gauche { "LeftFlipper" } else { "RightFlipper" }.into(),
            center: p2(f(&p["px"]), f(&p["py"])),
            base_radius: f(&p["r1"]) * MM, end_radius: f(&p["r2"]) * MM, flipper_radius_max: f(&p["len"]) * MM,
            start_angle: a0, end_angle: a1, is_visible: vu, material: "Palette".into(), rubber_material: "Caoutchouc".into(), ..Default::default()
        }));
    }

    // ---------------------------------------------------------------- bumpers
    for (i, b) in t["bumpers"].as_array().unwrap().iter().enumerate() {
        items.push(GameItemEnum::Bumper(Bumper { name: format!("Bumper{}", i + 1), center: p2(f(&b["x"]), f(&b["y"])),
            radius: f(&b["r"]) * MM, hit_event: Some(true), cap_material: "Chapeau".into(), base_material: "Metal".into(),
            socket_material: "Metal".into(), ring_material: Some("Metal".into()), is_cap_visible: vu, is_base_visible: vu,
            is_ring_visible: Some(vu), is_socket_visible: Some(vu), ..Default::default() }));
    }

    // ---------------------------------------------------------------- cibles
    let cible = |nom: String, x: f32, y: f32, nx: f32, ny: f32, genre: TargetType, r: f32| {
        let mut c = HitTarget { name: nom, position: Vertex3D::new(x * MM, y * MM, 0.0), target_type: genre,
            rot_z: angle_vp(nx, ny) - 180.0, use_hit_event: true, material: "Cible".into(), is_visible: vu, ..Default::default() };
        // cible ronde au diamètre d'origine : plus petite, la bille touchait le bord du logement sans l'atteindre
        if matches!(c.target_type, TargetType::HitTargetRound) { let d = 2.0 * r * MM; c.size = Vertex3D::new(d, d, d); }
        GameItemEnum::HitTarget(c)
    };
    let dn = &t["cibles_tombantes"];
    let bank_n = (f(&dn[0]["x"]) - f(&dn[1]["x"]), 0.0); // inutilisé : la normale est dans la direction de la banque
    let _ = bank_n;
    for (i, d) in dn.as_array().unwrap().iter().enumerate() {
        let a = f(&d["angle"]);
        // face tournée vers le plateau : normale perpendiculaire à la banque (angle = direction de la banque)
        let (nx, ny) = (-a.sin(), a.cos());
        let nom = ["DT_F", "DT_A", "DT_N1", "DT_N2", "DT_Y"][i];
        items.push(cible(nom.into(), f(&d["x"]), f(&d["y"]), -nx.abs(), ny, TargetType::DropTargetSimple, 0.0));
    }
    for s in t["cibles_fixes"].as_array().unwrap() {
        let id = s["id"].as_str().unwrap();
        // TIRER est tourné comme POINTER (son logement s'ouvre vers le bas à droite)
        let pointer = &t["cibles_fixes"][0]["n"];
        let (nx, ny) = match id { "pointer" | "tirer" => (f(&pointer["x"]), f(&pointer["y"])), _ => (0.35, 0.94) };
        let nom = match id { "pointer" => "Pointer", "tirer" => "Tirer", _ => "Bouchon" };
        items.push(cible(nom.into(), f(&s["x"]), f(&s["y"]), nx, ny, TargetType::HitTargetRound, f(&s["r"])));
    }
    for (i, c) in t["cibles_gauche"].as_array().unwrap().iter().enumerate() {
        items.push(cible(format!("Boule{}", i + 1), f(&c["x"]) + 4.0, f(&c["y"]), 1.0, 0.0, TargetType::HitTargetRound, f(&c["r"])));
    }

    // ---------------------------------------------------------------- couloirs (fils de détection)
    // Un capteur VPX détecte la bille dans le polygone de ses points : sans points, le fil se déclenchait en boucle
    // (des dizaines de fois par passage) ; points dans le sens horaire mathématique, comme les murs.
    let fil = |nom: String, x: f32, y: f32| GameItemEnum::Trigger(Trigger { name: nom, center: p2(x, y), radius: 25.0,
        shape: TriggerShape::WireA, drag_points: rect_capteur(x, y, 7.0, 12.0), is_visible: vu, ..Default::default() });
    for (i, c) in t["couloirs"].as_array().unwrap().iter().enumerate() {
        items.push(fil(format!("Couloir{}", ["T", "O", "U", "R"][i]), f(&c["x"]), f(&c["y"])));
    }
    for c in t["couloirs_bas"].as_array().unwrap() {
        let id = c["id"].as_str().unwrap();
        items.push(fil(format!("Bas_{id}"), f(&c["x"]), f(&c["y"])));
    }
    // les déclencheurs ont besoin d'un contour : carré autour du centre
    for it in items.iter_mut() {
        if let GameItemEnum::Trigger(tr) = it {
            let (cx, cy, r) = (tr.center.x, tr.center.y, 14.0 * MM);
            tr.drag_points = [(-0.5, -1.0), (0.5, -1.0), (0.5, 1.0), (-0.5, 1.0)].iter()
                .map(|(a, b)| DragPoint { x: cx + a * r, y: cy + b * r, ..Default::default() }).collect();
        }
    }

    // ---------------------------------------------------------------- Cercle, évacuation, distributeur, lanceur
    let c = &t["cercle"];
    items.push(GameItemEnum::Kicker(Kicker { name: "Cercle".into(), center: p2(f(&c["x"]), f(&c["y"])), radius: f(&c["ring"]) * MM * 0.9,
        kicker_type: KickerType::Hole, ..Default::default() }));
    // évacuation : toute la largeur sous le tablier (trou central et couloirs extérieurs y mènent), comme la ligne
    // d'évacuation du jeu d'origine ; un simple trou laissait des billes s'arrêter contre le bas de la caisse.
    // Il commence au-dessus du bord du tablier (seule l'ouverture centrale y est accessible) : sinon une bille posée
    // sur le coin de l'ouverture restait au bord sans tomber (balayage : x=203 y=1144 mm).
    let front = f(&t["tablier"]["front"]);
    let mut drain = Trigger { name: "Drain".into(), center: p2(240.0, (front + f(&t["H"])) / 2.0), radius: 25.0,
        shape: TriggerShape::None, is_visible: false, ..Default::default() };
    drain.drag_points = [(0.0, front - 18.0), (480.0, front - 18.0), (480.0, f(&t["H"])), (0.0, f(&t["H"]))].iter()
        .map(|&(x, y)| dp(x, y, 0.0)).rev().collect();
    items.push(GameItemEnum::Trigger(drain));
    let l = &t["lanceur"];
    items.push(GameItemEnum::Kicker(Kicker { name: "Distributeur".into(), center: p2(f(&l["x"]), f(&l["ballY"]) - 30.0), radius: 25.0,
        kicker_type: KickerType::Invisible, ..Default::default() }));
    // pointe au repos (center.y − course) sous la bille posée à ballY, comme dans le jeu d'origine
    let course = 80.0;
    let tir: f32 = std::env::var("TIR_LANCEUR").ok().and_then(|s| s.parse().ok()).unwrap_or(TIR_LANCEUR);
    items.push(GameItemEnum::Plunger(Plunger { name: "Plunger".into(),
        center: Vertex2D::new(f(&l["x"]) * MM, (f(&l["ballY"]) + f(&t["BALL_R"])) * MM + course),
        width: 22.0 * MM * 0.5, stroke: course, speed_fire: tir, mech_strength: tir, is_visible: vu,
        speed_pull: std::env::var("TIRAGE_LANCEUR").ok().and_then(|s| s.parse().ok()).unwrap_or(TIRAGE_LANCEUR), ..Default::default() }));
    // contact SHOOTER : bille posée sur le lanceur
    let mut capt = Trigger { name: "CapteurLanceur".into(), center: p2(f(&l["x"]), f(&l["ballY"])), radius: 25.0,
        shape: TriggerShape::None, is_visible: false, ..Default::default() };
    let rr = 9.0 * MM;
    capt.drag_points = [(-1.0, -1.0), (-1.0, 1.0), (1.0, 1.0), (1.0, -1.0)].iter()
        .map(|(a, b)| DragPoint { x: capt.center.x + a * rr, y: capt.center.y + b * rr, ..Default::default() }).collect();
    items.push(GameItemEnum::Trigger(capt));
    // portillon du haut du couloir : il s'ouvre vers le plateau, la bille ne redescend pas dans le couloir
    let pg = &t["portillon"];
    let (gx1, gx2, gy, gd) = (f(&pg["x1"]), f(&pg["x2"]), f(&pg["y"]), f(&pg["drop"]));
    items.push(GameItemEnum::Gate(Gate { name: "Portillon".into(), center: p2((gx1 + gx2) / 2.0, gy - gd / 2.0),
        length: ((gx2 - gx1).powi(2) + gd * gd).sqrt() * MM, rotation: angle_vp(gx2 - gx1, -gd) - 90.0, two_way: false, ..Default::default() }));

    // ---------------------------------------------------------------- tourniquet
    let sp = &t["tourniquet"];
    items.push(GameItemEnum::Spinner(Spinner { name: "Tourniquet".into(), center: p2(f(&sp["x"]), f(&sp["y"])),
        rotation: angle_vp(f(&sp["u"]["x"]), f(&sp["u"]["y"])), length: 2.0 * f(&sp["half"]) * MM, ..Default::default() }));

    // ---------------------------------------------------------------- rampe : montée, palier, descente (cao/modele.py)
    let r = &t["rampe"];
    let pts: Vec<(f32, f32, f32)> = r["pts"].as_array().unwrap().iter().map(|p| (f(&p[0]), f(&p[1]), f(&p[2]))).collect();
    let longueur = f(&r["longueur"]);
    let (zh, zf, pente) = (f(&r["z_haut"]), f(&r["z_fin"]), f(&r["pente_entree_deg"]).to_radians().tan());
    let s_montee = (zh + (pente - 0.1) * 20.0) / pente;
    let s_palier = longueur / 3.0;
    let troncons = [("RampeMontee", 0.0, s_montee, 0.0, zh), ("RampePalier", s_montee, s_palier, zh, zh), ("RampeDescente", s_palier, longueur + 1.0, zh, zf)];
    for (nom, s0, s1, z0, z1) in troncons {
        if colliders_origine { break; }
        let mut dpts: Vec<DragPoint> = vec![];
        let mut dernier = -1e9f32;
        for &(x, y, s) in &pts {
            if s < s0 - 0.01 || s > s1 { continue; }
            if s - dernier >= 18.0 || (s1 - s) < 0.5 { dpts.push(DragPoint { smooth: true, ..dp(x, y, 0.0) }); dernier = s; }
        }
        if let Some(&(x, y, _)) = pts.iter().rev().find(|p| p.2 <= s1) {
            if dpts.last().map(|d| (d.x - x * MM).abs() + (d.y - y * MM).abs() > 1.0).unwrap_or(true) { dpts.push(DragPoint { smooth: true, ..dp(x, y, 0.0) }); }
        }
        let largeur = (f(&r["largeur"]) + 6.0) * MM;
        items.push(GameItemEnum::Ramp(Ramp {
            name: nom.into(), ramp_type: RampType::Flat, height_bottom: z0 * MM, height_top: z1 * MM, width_bottom: largeur, width_top: largeur,
            left_wall_height: f(&r["flanc"]) * MM, right_wall_height: f(&r["flanc"]) * MM,
            left_wall_height_visible: f(&r["flanc"]) * MM, right_wall_height_visible: f(&r["flanc"]) * MM,
            drag_points: dpts, material: "Plastique".into(), is_visible: vu, ..Default::default()
        }));
    }
    // passage réussi : capteur en bout de rampe, assez haut pour voir la bille sur la rampe
    if let Some(&(x, y, _)) = pts.iter().rev().nth(12) {
        let mut tr = Trigger { name: "CapteurRampe".into(), center: p2(x, y), radius: 25.0, shape: TriggerShape::None,
            hit_height: (zf + 30.0) * MM, is_visible: false, ..Default::default() };
        let rr = 12.0 * MM;
        tr.drag_points = [(-1.0, -1.0), (-1.0, 1.0), (1.0, 1.0), (1.0, -1.0)].iter()
            .map(|(a, b)| DragPoint { x: x * MM + a * rr, y: y * MM + b * rr, ..Default::default() }).collect();
        items.push(GameItemEnum::Trigger(tr));
    }

    // capteurs : réglages par défaut de vpinball (vpin met 0 à l'échelle et à la vitesse d'animation des fils)
    for it in items.iter_mut() {
        if let GameItemEnum::Trigger(tr) = it {
            tr.scale_x = 1.0; tr.scale_y = 1.0; tr.anim_speed = 1.0; tr.wire_thickness = Some(0.0);
        }
    }

    // ---------------------------------------------------------------- lampes (inserts peints sur le plateau)
    // Éteint, l'insert est celui du plateau peint (pastille sombre et sa lettre). Allumé, un flasher plat F_<nom>
    // posé dessus montre l'insert allumé (inserts.py : plastique coloré éclairé, lettre, halo) ; le script le rend
    // visible selon l'état de la lampe (MajLampes, clignotement compris). La lampe L_<nom>, invisible, garde l'état.
    // (Les lampes en mode image montraient la même image allumées ou éteintes : on ne voyait plus les cibles touchées.)
    for lp in t["lampes"].as_array().unwrap() {
        let n = lp["nom"].as_str().unwrap();
        let (x, y, r) = (f(&lp["x"]), f(&lp["y"]), f(&lp["r"]));
        let mut li = Light { name: format!("L_{n}"), center: p2(x, y), falloff_radius: r * MM,
            color: couleur(lp["couleur"].as_str().unwrap_or("#ffffff")), intensity: 0.0, state_u32: 0, state: Some(0.0),
            visible: Some(false), ..Default::default() };
        li.color2 = li.color;
        li.drag_points = (0..8).map(|k| {
            let a = -(k as f32) * std::f32::consts::TAU / 8.0;
            DragPoint { x: li.center.x + r * MM * a.cos(), y: li.center.y + r * MM * a.sin(), ..Default::default() }
        }).collect();
        items.push(GameItemEnum::Light(li));
        let png = ici.join(format!("donnees/decor/inserts/{n}.png"));
        if !png.exists() { continue; }
        v.add_or_replace_image(image(&format!("insert_{n}"), &png));
        let demi = r * 1.35 * 1.0 + 0.6;          // HALO de inserts.py (+ la marge de l'image)
        let mut fl = Flasher { name: format!("F_{n}"), image_a: format!("insert_{n}"), height: std::env::var("HINSERT").ok().and_then(|s| s.parse().ok()).unwrap_or(1.5) * MM, pos_x: Some(x * MM), pos_y: Some(y * MM),
            display_texture: true, alpha: *INTENSITE_INSERT as i32, is_visible: false, filter: Filter::None,
            image_alignment: RampImageAlignment::Wrap, color: Color::from_rgb(0xffffff), modulate_vs_add: 1.0, ..Default::default() };
        fl.drag_points = [(-1.0, 1.0), (1.0, 1.0), (1.0, -1.0), (-1.0, -1.0)].iter().map(|&(a, b)| dp(x + a * demi, y + b * demi, 0.0)).collect();
        items.push(GameItemEnum::Flasher(fl));
    }

    // ---------------------------------------------------------------- afficheurs (fronton) et horloge du script
    // Sans écran de fronton (Batocera, écran unique), les boîtes de texte se dessinent par-dessus le plateau :
    // fond transparent, en haut de l'écran, police lisible (taille OLE en 1/10 000 de point).
    let police = |pt: u32| Font::new(0, HashSet::new(), 700, pt * 10000, "Arial".into());
    let haut_aff = (FRONTON_BUREAU[1] + FRONTON_BUREAU[2] * 1680.0 / 1050.0 * 832.0 / 1216.0) * 750.0 + 14.0;
    let (g_aff, d_aff) = (FRONTON_BUREAU[0] * 1000.0, (FRONTON_BUREAU[0] + FRONTON_BUREAU[2]) * 1000.0);
    // Afficheur à points (DMD 128 x 32) sous le fronton : le VPX de la Batocera ne dessine pas le texte des boîtes de
    // texte (pas de polices hors PinUP), le script fournit donc lui-même les points (DMDPixels, police 5 x 7 du script).
    // Rapport 4:1 sur l'écran 16:10 : hauteur en unités du fond (1000 x 750).
    let h_aff = (d_aff - g_aff) / 1000.0 * 1680.0 / 4.0 / 1050.0 * 750.0;
    let mut score = TextBox { name: "Afficheur".into(), ver1: Vertex2D::new(g_aff, haut_aff), ver2: Vertex2D::new(d_aff, haut_aff + h_aff),
        text: "".into(), is_transparent: false, is_dmd: Some(true), align: TextAlignment::Center, font: police(20), ..Default::default() };
    score.back_color = Color::from_rgb(0x0a0604); score.font_color = Color::from_rgb(0xffffff);
    score.intensity_scale = LUMINOSITE_AFFICHEUR;
    items.push(GameItemEnum::TextBox(score));
    // GIF animés du décor (châssis, articulation de la boule) : une image VPX par vue, jouées par le script sur deux
    // flashers tournés vers la caméra devant les cadres du fond (fond.py, CADRES). Position réglée sur la Batocera.
    let mut gifs = String::new();
    for &(nom, flasher, x, y, z, larg, haut) in PANNEAUX.iter() {
        let chemin = ici.join("donnees/fond").join(format!("{nom}.gif"));
        let Ok(fichier) = fs::File::open(&chemin) else { continue };
        use image::AnimationDecoder;
        let dec = image::codecs::gif::GifDecoder::new(std::io::BufReader::new(fichier)).unwrap();
        let vues = dec.into_frames().collect_frames().unwrap();
        let ms = { let (n, d) = vues[0].delay().numer_denom_ms(); (n / d.max(1)).max(20) };
        for (k, v_) in vues.iter().enumerate() {
            let tmp = sortie.join(format!(".{nom}_{k:02}.jpg"));
            image::DynamicImage::ImageRgba8(v_.buffer().clone()).to_rgb8().save(&tmp).unwrap();
            v.add_or_replace_image(image(&format!("{nom}_{k:02}"), &tmp));
            fs::remove_file(&tmp).ok();
        }
        let mut fl = Flasher { name: flasher.into(), image_a: format!("{nom}_00"), height: z * MM, pos_x: Some(x * MM), pos_y: Some(y * MM),
            rot_x: -45.0, display_texture: true, alpha: 100, is_visible: true, filter: Filter::None, image_alignment: RampImageAlignment::Wrap,
            color: Color::from_rgb(0xffffff), modulate_vs_add: 1.0, ..Default::default() };
        // ordre des points inverse (sinon la face est tournée vers le dessous et n'est pas dessinée)
        fl.drag_points = [(-1.0, 1.0), (1.0, 1.0), (1.0, -1.0), (-1.0, -1.0)].iter().map(|&(a, b)| dp(x + a * larg / 2.0, y + b * haut / 2.0, 0.0)).collect();
        items.push(GameItemEnum::Flasher(fl));
        gifs += &format!("Array({flasher}, \"{nom}_\", {}, {ms}), ", vues.len());
    }
    let mut horloge = Timer { name: "Horloge".into(), center: Vertex2D::new(20.0, 20.0), ..Default::default() };
    horloge.timer.is_enabled = true; horloge.timer.interval = 20;
    items.push(GameItemEnum::Timer(horloge));
    let mut anim = Timer { name: "Anim".into(), center: Vertex2D::new(60.0, 20.0), ..Default::default() };
    anim.timer.is_enabled = true; anim.timer.interval = -1;   // à chaque image
    items.push(GameItemEnum::Timer(anim));

    // pièces du décor animées par le script (palettes, cibles tombantes, lanceur) : tableaux VBScript générés
    let mut entete = String::from("' ---- généré par outils/vpx/generateur : pièces du décor d'origine animées par le script\n");
    let mut noms: std::collections::BTreeMap<String, Vec<String>> = ["PrimPaletteG", "PrimPaletteD", "PrimCible0", "PrimCible1",
        "PrimCible2", "PrimCible3", "PrimCible4", "PrimLanceur"].iter().map(|n| (n.to_string(), vec![])).collect();
    if let Some(d) = decor {
        for it in &d.items {
            if let GameItemEnum::Primitive(p) = it { if let Some((base, _)) = p.name.rsplit_once('_') { if base.starts_with("Prim") { noms.entry(base.to_string()).or_default().push(p.name.clone()); } } }
        }
        items.extend(d.items);
    }
    for (base, liste) in &noms { entete += &format!("Dim {base} : {base} = Array({})\n", liste.join(", ")); }
    // GIF du décor : (flasher, préfixe des images, nombre de vues, durée d'une vue en ms)
    entete += &format!("Dim GIFS : GIFS = Array({})\n", gifs.trim_end_matches(", "));
    // points du balayage des zones de blocage (-c1 balayage) : x, y, z en unités VP (python3 collisions.py)
    let pts_essai: Vec<f64> = fs::read_to_string(ici.join("donnees/collisions/points_essai.json")).ok()
        .and_then(|s| serde_json::from_str::<Vec<Vec<f64>>>(&s).ok()).unwrap_or_default().into_iter().flatten().collect();
    let lignes: Vec<String> = pts_essai.chunks(24).map(|c| c.iter().map(|v| format!("{v}")).collect::<Vec<_>>().join(", ")).collect();
    entete += &format!("Dim POINTS_ESSAI : POINTS_ESSAI = Array({})\n", lignes.join(", _\n  "));
    for it in items { v.add_game_item(it); }

    // ---------------------------------------------------------------- sons (pistes du DFPlayer, mêmes numéros)
    let mut sons: Vec<PathBuf> = fs::read_dir(racine.join("assets/sons")).unwrap().filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "mp3")).collect();
    sons.sort();
    for s in &sons {
        let nom = format!("s{}", s.file_stem().unwrap().to_string_lossy());
        let mut sd = son(&nom, s);
        // musiques (stéréo) : sur les haut-parleurs du fronton, comme une vraie machine
        if sd.wave_form.channels > 1 || nom == "s0022" || nom == "s0023" { sd.output_target = OutputTarget::Backglass; }
        v.sounds.push(sd);
    }
    v.gamedata.sounds_size = v.sounds.len() as u32;

    // ---------------------------------------------------------------- script
    let script = fs::read_to_string(ici.join("table.vbs")).expect("table.vbs");
    // l'en-tête généré se place après Option Explicit (qui doit rester la première instruction)
    let script = script.replacen("Randomize\n", &format!("Randomize\n{entete}"), 1);
    v.gamedata.code = StringWithEncoding::from(script.as_str());

    let cible = sortie.join("FannyPinball.vpx");
    vpx::write(&cible, &v).unwrap();
    println!("{} : {} éléments, {} images, {} sons", cible.display(), v.gameitems.len(), v.images.len(), v.sounds.len());
}
