// pas de fenêtre de console sous Windows (version publiée)
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
// Fanny Pinball, version native (Rust) : même physique que la version web (monde exporté), mêmes règles, scène 3D
// exportée du jeu web avec l'habillage de la caisse, dans un café provençal (js/salle.js).
//
// Déroulé : menu principal (partie libre, réglages) → partie libre et tableau des meilleurs scores → cinématique
// (la machine, posée au sol, fronton rabattu, se déplie sur ses pieds puis se met sous tension) → choix de la vue →
// partie → fin de partie et saisie des initiales.
//
// Commandes de jeu identiques à la version web et au contrôleur Pro Micro (controleur/fanny_pincab) :
//   Maj gauche / Maj droite : palettes ; Bas (maintenir puis relâcher) : lanceur ; S ou Entrée : départ ; 5 : pièce
//   Espace / Haut : bourrage frontal ; Ctrl gauche / droit : bourrage latéral ; Échap : pause ; F11 : plein écran
//   C : caméra suivante ; M : son coupé ; + / − : pente du plateau
// Dans les menus : ↑ ↓ ou palettes pour choisir, ← → pour modifier, Entrée ou départ pour valider, Échap pour revenir.

mod audio;
mod ecrans;
mod physique;
mod reglages;
mod regles;
mod rendu;
mod ui;
mod banc;

use nalgebra::{Matrix4, Point3, UnitQuaternion, Vector3, Vector4};
use reglages::{Detail, Reglages, Tableau};
use sdl2::keyboard::Scancode;
use std::path::{Path, PathBuf};
use std::time::Instant;

const TIRAGE_S: f64 = 0.9;
const FIN_CINEMATIQUE: f64 = 10.6;

fn racine() -> PathBuf {
    // donnees/ à côté de l'exécutable, sinon dans le dossier du crate (cargo run)
    let exe = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf()));
    for d in exe.iter().flat_map(|e| [e.clone(), e.join(".."), e.join("../..")]).chain([PathBuf::from(env!("CARGO_MANIFEST_DIR"))]) {
        if d.join("donnees/monde.json").exists() { return d; }
    }
    PathBuf::from(".")
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Ecran { Menu, Reglages, Libre, Cinematique, Vues, Jeu, Pause, FinPartie, Initiales }

struct Anim { noeud: usize, t0: Vector3<f32>, r0: UnitQuaternion<f32> }

/// pièces animées de la scène (recalculées quand la scène est rechargée)
struct Pieces {
    palettes: Vec<(char, Option<Anim>)>,
    cibles: Vec<Option<Anim>>,
    anneaux: Vec<Option<Anim>>,
    chapeaux: Vec<Option<Anim>>,
    tourniquet: Option<Anim>,
    tige: Option<Anim>,
    lanceur: Vec<Anim>,
    fronton: Option<Anim>,
    pieds: Vec<(Anim, f32)>,       // pied et sens de repli (gauche : +1, droite : −1, autour de l'axe Y de la caisse)
    table: Option<usize>,
    lampes_mats: Vec<String>,
}

fn pieces(scene: &rendu::Scene, nb_cibles: usize) -> Pieces {
    let anim = |nom: &str| scene.noeud(nom).map(|i| Anim { noeud: i, t0: scene.noeuds[i].t0, r0: scene.noeuds[i].r0 });
    Pieces {
        palettes: vec![('L', anim("dyn_palette_L")), ('R', anim("dyn_palette_R"))],
        cibles: (0..nb_cibles).map(|i| anim(&format!("dyn_cible_{i}"))).collect(),
        anneaux: (0..3).map(|i| anim(&format!("dyn_bumper_anneau_{i}"))).collect(),
        chapeaux: (0..3).map(|i| anim(&format!("dyn_bumper_chapeau_{i}"))).collect(),
        tourniquet: anim("dyn_tourniquet"),
        tige: anim("dyn_tige_lanceur"),
        lanceur: (0..8).filter_map(|i| anim(&format!("dyn_lanceur_{i}"))).collect(),
        fronton: anim("dyn_fronton"),
        pieds: ["AVG", "ARG", "AVD", "ARD"].iter().filter_map(|c| anim(&format!("dyn_pied_{c}")).map(|a| (a, if c.ends_with('G') { 1.0 } else { -1.0 }))).collect(),
        table: scene.noeud("table"),
        lampes_mats: scene.materiaux.iter().filter(|m| m.nom.starts_with("lampe_")).map(|m| m.nom.clone()).collect(),
    }
}

fn charger_scene(base: &Path, detail: Detail, aniso_force: Option<f32>) -> Result<rendu::Scene, String> {
    let leger = base.join("donnees/scene_leger.glb");
    let chemin = if detail.scene_legere() && leger.exists() { leger } else { base.join("donnees/scene.glb") };
    rendu::Scene::charger(chemin.to_str().unwrap(), aniso_force.unwrap_or(detail.aniso()))
        .map_err(|e| format!("{e}\n(scène absente : node outils/exporter_scene_natif.mjs)"))
}

fn lisse(t: f64, a: f64, b: f64) -> f32 {
    let x = ((t - a) / (b - a)).clamp(0.0, 1.0);
    (x * x * (3.0 - 2.0 * x)) as f32
}

/// cinématique, au temps t (s) : (pieds dépliés 0→1, fronton levé 0→1, tension 0→1)
fn cinematique(t: f64) -> (f32, f32, f32) {
    let pieds = lisse(t, 1.0, 3.6);
    let fronton = lisse(t, 4.0, 6.2);
    // mise sous tension : les tubes et les ampoules hésitent, comme à l'allumage d'une vraie machine
    const CLIGNE: [f32; 18] = [0.0, 0.7, 0.05, 0.0, 0.9, 0.15, 0.0, 0.0, 0.55, 1.0, 0.3, 1.0, 1.0, 0.7, 1.0, 1.0, 1.0, 1.0];
    let tension = if t < 6.8 { 0.0 } else { CLIGNE.get(((t - 6.8) * 13.0) as usize).copied().unwrap_or(1.0) };
    (pieds, fronton, tension)
}

/// caméra orbitale dans le repère de la caisse (lacet depuis l'avant, tangage, distance), gardée dans la salle
fn camera_orbite(d: &rendu::Deplie, lacet: f32, tangage: f32, dist: f32, cible_z: f32, fov: f32) -> rendu::Camera {
    let c = Vector3::new(d.largeur / 2.0, d.longueur * 0.45, cible_z);
    let mut o = c + Vector3::new(lacet.sin() * tangage.cos(), -lacet.cos() * tangage.cos(), tangage.sin()) * dist;
    let s = d.salle;
    o.x = o.x.clamp(s[0] + 250.0, s[1] - 250.0);
    o.y = o.y.clamp(s[2] + 250.0, s[3] - 250.0);
    o.z = o.z.clamp(s[4] + 300.0, s[5] - 250.0);
    let m = d.machine_monde;
    let p = |v: Vector3<f32>| { let q = m * Vector4::new(v.x, v.y, v.z, 1.0); Point3::new(q.x, q.y, q.z) };
    let haut = (m * Vector4::new(0.0, 0.0, 1.0, 0.0)).xyz().normalize();
    let vue = Matrix4::look_at_rh(&p(o), &p(c), &haut);
    rendu::Camera { nom: "orbite".into(), format: "paysage".into(), matrice: vue.try_inverse().unwrap_or_else(Matrix4::identity),
        fov, near: 20.0, far: 30000.0 }
}

/// caméra orbitale qui cadre la machine entière, des pieds au haut du fronton levé : la cible est le centre de la
/// caisse dépliée, et l'angle de champ s'ouvre au besoin (au moins fov_min) pour que les huit coins de la boîte
/// englobante tiennent dans l'image avec une marge, même quand les murs de la salle rapprochent la caméra
fn camera_cadree(d: &rendu::Deplie, lacet: f32, tangage: f32, dist: f32, fov_min: f32, aspect: f32) -> rendu::Camera {
    let (z0, z1) = (-d.h_sol, d.haut);
    let c = Vector3::new(d.largeur / 2.0, d.longueur * 0.5, (z0 + z1) / 2.0);
    let mut o = c + Vector3::new(lacet.sin() * tangage.cos(), -lacet.cos() * tangage.cos(), tangage.sin()) * dist;
    let s = d.salle;
    o.x = o.x.clamp(s[0] + 250.0, s[1] - 250.0);
    o.y = o.y.clamp(s[2] + 250.0, s[3] - 250.0);
    o.z = o.z.clamp(s[4] + 300.0, s[5] - 250.0);
    let vue_caisse = Matrix4::look_at_rh(&Point3::from(o), &Point3::from(c), &Vector3::z());
    let (mut tv, mut th) = (0.0f32, 0.0f32);
    for k in 0..8 {
        let p = Vector3::new(if k & 1 == 0 { -40.0 } else { d.largeur + 40.0 }, if k & 2 == 0 { -40.0 } else { d.longueur + 40.0 },
                             if k & 4 == 0 { z0 } else { z1 + 30.0 });
        let q = vue_caisse * Vector4::new(p.x, p.y, p.z, 1.0);
        let prof = (-q.z).max(1.0);
        tv = tv.max(q.y.abs() / prof);
        th = th.max(q.x.abs() / prof);
    }
    let demi = (tv.max(th / aspect.max(0.1)) * 1.10).atan();
    let fov = (2.0 * demi.to_degrees()).max(fov_min).min(75.0);
    let m = d.machine_monde;
    let p = |v: Vector3<f32>| { let q = m * Vector4::new(v.x, v.y, v.z, 1.0); Point3::new(q.x, q.y, q.z) };
    let haut = (m * Vector4::new(0.0, 0.0, 1.0, 0.0)).xyz().normalize();
    let vue = Matrix4::look_at_rh(&p(o), &p(c), &haut);
    rendu::Camera { nom: "orbite".into(), format: "paysage".into(), matrice: vue.try_inverse().unwrap_or_else(Matrix4::identity),
        fov, near: 20.0, far: 30000.0 }
}

/// mélange de deux caméras (position et orientation), u de 0 à 1
fn camera_melange(a: &rendu::Camera, b: &rendu::Camera, u: f32) -> rendu::Camera {
    let pos = |m: &Matrix4<f32>| Vector3::new(m[(0, 3)], m[(1, 3)], m[(2, 3)]);
    let rot = |m: &Matrix4<f32>| UnitQuaternion::from_matrix(&m.fixed_view::<3, 3>(0, 0).into_owned());
    let p = pos(&a.matrice).lerp(&pos(&b.matrice), u);
    let r = rot(&a.matrice).slerp(&rot(&b.matrice), u);
    let mut m = r.to_homogeneous();
    m[(0, 3)] = p.x; m[(1, 3)] = p.y; m[(2, 3)] = p.z;
    rendu::Camera { nom: b.nom.clone(), format: b.format.clone(), matrice: m, fov: a.fov + (b.fov - a.fov) * u,
        near: a.near.min(b.near), far: a.far.max(b.far) }
}

fn liste_resolutions(video: &sdl2::VideoSubsystem) -> Vec<(u32, u32)> {
    let mut v: Vec<(u32, u32)> = vec![];
    if let Ok(m) = video.desktop_display_mode(0) { v.push((m.w as u32, m.h as u32)); }
    for i in 0..video.num_display_modes(0).unwrap_or(0) {
        if let Ok(m) = video.display_mode(0, i) {
            let r = (m.w as u32, m.h as u32);
            if r.0 >= 800 && r.1 >= 600 && !v.contains(&r) { v.push(r); }
        }
    }
    for r in [(1280, 800), (1280, 720), (1024, 768)] { if !v.contains(&r) { v.push(r); } }
    let ecran = v[0];
    v[1..].sort_by(|a, b| (b.0 * b.1).cmp(&(a.0 * a.1)));
    v.retain(|r| r.0 <= ecran.0 && r.1 <= ecran.1);
    v
}

fn main() -> Result<(), String> {
    let base = racine();
    let mut sim = physique::Sim::charger(base.join("donnees/monde.json").to_str().unwrap())?;
    let graine = || std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(7);
    let mut regles = regles::Regles::new(graine());
    let mut reg = Reglages::charger();
    let mut tableau = Tableau::charger();

    // options d'essai : --leger (détail bas), --echelle f, --msaa n, --profil, --plein-ecran ; --auto (partie
    // automatique, sans menus), --capture fichier.ppm [--apres ms] [--camera n] [--orbite l,t,d] ;
    // --ecran menu|reglages|libre|vues|jeu|cinematique:t (écran de départ, pour les captures)
    let args: Vec<String> = std::env::args().collect();
    let opt = |n: &str| args.iter().position(|a| a == n).and_then(|i| args.get(i + 1)).cloned();
    let drapeau = |n: &str| args.iter().any(|a| a == n);
    if drapeau("--leger") { reg.detail = Detail::Bas; }
    if drapeau("--plein-ecran") { reg.plein_ecran = true; }
    let profil = drapeau("--profil");
    let msaa_force: Option<i32> = opt("--msaa").and_then(|v| v.parse().ok());
    let echelle_force: Option<f32> = opt("--echelle").and_then(|v| v.parse().ok());
    let auto = drapeau("--auto");
    let capture = opt("--capture");
    let apres: f64 = opt("--apres").and_then(|v| v.parse().ok()).unwrap_or(3000.0);

    let sdl = sdl2::init()?;
    let video = sdl.video()?;
    let gla = video.gl_attr();
    gla.set_context_profile(sdl2::video::GLProfile::Core);
    gla.set_context_version(3, 3);
    gla.set_framebuffer_srgb_compatible(false);
    let resolutions = liste_resolutions(&video);
    // plein écran : fenêtre sans bordure à la taille de l'écran, posée en (0, 0). Sans gestionnaire de fenêtres (borne :
    // X seul), personne n'agrandit une fenêtre qui demande le plein écran ; elle doit naître à la bonne taille.
    let ecran = video.desktop_display_mode(0).map(|m| (m.w as u32, m.h as u32)).unwrap_or((1280, 800));
    let mut fenetre = if reg.plein_ecran {
        video.window("Fanny Pinball", ecran.0, ecran.1).opengl().borderless().position(0, 0).build()
    } else {
        video.window("Fanny Pinball", reg.resolution.0, reg.resolution.1).opengl().resizable().position_centered().build()
    }.map_err(|e| e.to_string())?;
    let _ctx = fenetre.gl_create_context()?;
    gl::load_with(|s| video.gl_get_proc_address(s) as *const _);
    let _ = video.gl_set_swap_interval(if profil { 0 } else { 1 });   // --profil : sans synchro verticale, coût réel
    let appliquer_affichage = |f: &mut sdl2::video::Window, r: &Reglages| {
        if r.plein_ecran {
            f.set_bordered(false);
            let _ = f.set_size(ecran.0, ecran.1);
            f.set_position(sdl2::video::WindowPos::Positioned(0), sdl2::video::WindowPos::Positioned(0));
            let _ = f.set_fullscreen(sdl2::video::FullscreenType::Desktop);
        } else {
            let _ = f.set_fullscreen(sdl2::video::FullscreenType::Off);
            f.set_bordered(true);
            let _ = f.set_size(r.resolution.0, r.resolution.1);
            f.set_position(sdl2::video::WindowPos::Centered, sdl2::video::WindowPos::Centered);
        }
    };
    appliquer_affichage(&mut fenetre, &reg);

    let mut ui = ui::Ui::new(&base.join("donnees/polices"))?;
    let aniso_force = if drapeau("--leger") { Some(4.0) } else { None };
    let mut scene = charger_scene(&base, reg.detail, aniso_force)?;
    let mut detail_charge = reg.detail;
    let mut pc = pieces(&scene, sim.drops_up.len());
    let mut son = audio::Audio::init(&base.join("../assets"));
    if !base.join("../assets/sons").exists() { son = audio::Audio::init(&base.join("assets")); }
    son.set_volumes(reg.volume_effets, reg.volume_musique);

    // caméras « paysage » du jeu (choix de la vue)
    // deux vues de jeu : le joueur debout (écran en paysage) ou le plateau sur toute la hauteur d'un écran posé à la
    // verticale (image calculée en portrait puis tournée d'un quart de tour, voir rendu::Tourne)
    let noms_vues = |_scene: &rendu::Scene| -> Vec<String> { ["joueur", "vertical", "plan", "plan_vertical"].iter().map(|s| s.to_string()).collect() };
    let mut vues = noms_vues(&scene);
    let mut vue_sel = vues.iter().position(|n| *n == reg.vue).or_else(|| vues.iter().position(|n| n == "joueur")).unwrap_or(0);

    // écran de départ
    let mut ecran = if auto { Ecran::Jeu } else { Ecran::Menu };
    let mut t_cine0 = 0.0f64;            // horloge de la cinématique (s)
    if let Some(e) = opt("--ecran") {
        ecran = match e.split(':').next().unwrap_or("") {
            "reglages" => Ecran::Reglages, "libre" => Ecran::Libre, "vues" => Ecran::Vues, "jeu" => Ecran::Jeu,
            "cinematique" => { t_cine0 = e.split(':').nth(1).and_then(|v| v.parse().ok()).unwrap_or(0.0); Ecran::Cinematique }
            "pause" => Ecran::Pause, "initiales" => Ecran::Initiales, "fin" => Ecran::FinPartie, _ => Ecran::Menu,
        };
    }
    // état de la machine : dépliée et sous tension dès qu'on a vu la cinématique (ou en partie directe)
    let deplie_depart = matches!(ecran, Ecran::Jeu | Ecran::Vues | Ecran::Pause | Ecran::FinPartie | Ecran::Initiales);
    let mut machine = if deplie_depart { (1.0f32, 1.0f32, 1.0f32) } else { (0.0, 0.0, 0.0) };   // pieds, fronton, tension
    let mut sel = 0usize;                // bouton en surbrillance de l'écran courant
    let mut nouveau_rang: Option<usize> = None;
    let mut lettres = [0usize; 3];
    let mut pos_lettre = 0usize;
    let mut score_fin = 0u64;
    let mut t_ecran = Instant::now();    // entrée dans l'écran courant
    let mut en_partie = false;
    let mut cine_prec = -1.0f64;
    let cam_jeu: Option<usize> = opt("--camera").and_then(|v| v.parse().ok());

    let mut orbite: Option<(f32, f32, f32)> = None;
    if let Some(o) = opt("--orbite") {
        let v: Vec<f32> = o.split(',').filter_map(|x| x.parse().ok()).collect();
        if v.len() == 3 { orbite = Some((v[0], v[1], v[2])); }
    }
    let mut glisse = false;
    let mut code_sortie = 0;
    let mut maj_menu = [false, false];
    let mut pause_physique = false;
    let mut tirage_debut: Option<Instant> = None;
    let mut ev = sdl.event_pump()?;
    let mut avant = Instant::now();
    let t_depart = Instant::now();
    let mut fps = (0u32, Instant::now(), 0.0f32);
    let mut etape_auto = 0;
    let mut saccades = (0u32, 0u32, 0.0f64);           // images après 3 s, images de plus de 20 ms, pire image (ms)
    let mut cible = rendu::Cible::default();
    let mut tourne = rendu::Tourne::default();
    let mut mesure = (0.0f64, 0.0f64, 0u32, Instant::now(), 0.0f64);   // --profil : ms de physique, ms de rendu, images
    let mut cam_courante = Matrix4::<f32>::identity();

    // nouvelle partie : physique et règles remises à zéro
    let nouvelle_partie = |sim: &mut physique::Sim, regles: &mut regles::Regles| -> Result<(), String> {
        *sim = physique::Sim::charger(base.join("donnees/monde.json").to_str().unwrap())?;
        *regles = regles::Regles::new(graine());
        Ok(())
    };

    'jeu: loop {
        // ------------------------------------------------ événements
        let mut aller: Option<Ecran> = None;
        let mut regl_change = false;
        for e in ev.poll_iter() {
            use sdl2::event::Event;
            let menu = !matches!(ecran, Ecran::Jeu);
            match e {
                Event::Quit { .. } => { code_sortie = 2; break 'jeu }   // fenêtre fermée ou signal : pas un « Quitter »
                Event::KeyDown { scancode: Some(Scancode::F11), repeat: false, .. } => {
                    reg.plein_ecran = !reg.plein_ecran;
                    appliquer_affichage(&mut fenetre, &reg);
                    reg.enregistrer();
                }
                Event::KeyDown { scancode: Some(sc), repeat, .. } if menu => {
                    let haut = matches!(sc, Scancode::Up | Scancode::LShift);
                    let bas = matches!(sc, Scancode::RShift);
                    let gauche = matches!(sc, Scancode::Left);
                    let droite = matches!(sc, Scancode::Right);
                    let ok = matches!(sc, Scancode::Return | Scancode::KpEnter | Scancode::S | Scancode::Down);
                    // manette (controleur/fanny_rp2040) : palettes pour choisir, lanceur (Bas) pour valider ;
                    // les deux palettes d'un accord s'annulent (monter puis descendre)
                    if sc == Scancode::LShift { maj_menu[0] = true; }
                    if sc == Scancode::RShift { maj_menu[1] = true; }
                    let retour = matches!(sc, Scancode::Escape | Scancode::Backspace);
                    if repeat && !(haut || bas || gauche || droite) { continue; }
                    let bip = |son: &mut audio::Audio| son.play(regles::snd::LANE);
                    match ecran {
                        Ecran::Menu => {
                            if haut { sel = (sel + 2) % 3; bip(&mut son); }
                            if bas { sel = (sel + 1) % 3; bip(&mut son); }
                            if retour && sc == Scancode::Escape { sel = 2; bip(&mut son); }   // Échap désigne « Quitter »
                            if ok {
                                son.play(regles::snd::STANDUP);
                                match sel { 0 => aller = Some(Ecran::Libre), 1 => aller = Some(Ecran::Reglages), _ => { code_sortie = 0; break 'jeu } }
                            }
                        }
                        Ecran::Reglages => {
                            if haut { sel = (sel + ecrans::NB_REGLAGES - 1) % ecrans::NB_REGLAGES; bip(&mut son); }
                            if bas { sel = (sel + 1) % ecrans::NB_REGLAGES; bip(&mut son); }
                            let d = if gauche { -1 } else if droite || (ok && sel < 6) { 1 } else { 0 };
                            if d != 0 {
                                match sel {
                                    0 => { reg.plein_ecran = !reg.plein_ecran; appliquer_affichage(&mut fenetre, &reg); }
                                    1 => {
                                        let i = resolutions.iter().position(|r| *r == reg.resolution).unwrap_or(0) as i32;
                                        // la liste va de la plus grande à la plus petite : → agrandit
                                        let n = resolutions.len() as i32;
                                        let j = if ok { (i + 1) % n } else { (i - d).clamp(0, n - 1) };   // valider : fait le tour
                                        reg.resolution = resolutions[j as usize];
                                        if !reg.plein_ecran { appliquer_affichage(&mut fenetre, &reg); }
                                    }
                                    2 => reg.detail = if ok && reg.detail == Detail::Eleve { Detail::Bas } else { reg.detail.suivant(d) },
                                    3 => { reg.volume_effets = if ok && reg.volume_effets >= 10 { 0 } else { (reg.volume_effets as i32 + d).clamp(0, 10) as u8 }; son.set_volumes(reg.volume_effets, reg.volume_musique); son.play(regles::snd::BUMPER); }
                                    5 => reg.vertical_horaire = !reg.vertical_horaire,
                                    4 => { reg.volume_musique = if ok && reg.volume_musique >= 10 { 0 } else { (reg.volume_musique as i32 + d).clamp(0, 10) as u8 }; son.set_volumes(reg.volume_effets, reg.volume_musique); }
                                    _ => {}
                                }
                                regl_change = true;
                            }
                            if retour || (ok && sel == 6) { aller = Some(Ecran::Menu); }
                        }
                        Ecran::Libre => {
                            if haut || bas { sel = 1 - sel.min(1); bip(&mut son); }
                            if retour { aller = Some(Ecran::Menu); }
                            if ok {
                                son.play(regles::snd::STANDUP);
                                aller = Some(if sel == 1 { Ecran::Menu } else if machine.2 < 1.0 { Ecran::Cinematique } else { Ecran::Vues });
                            }
                        }
                        Ecran::Cinematique => { if ok || retour { t_cine0 = FIN_CINEMATIQUE; } }
                        Ecran::Vues => {
                            let n = vues.len().max(1);
                            if gauche || haut { vue_sel = (vue_sel + n - 1) % n; bip(&mut son); }
                            if droite || bas { vue_sel = (vue_sel + 1) % n; bip(&mut son); }
                            if retour { aller = Some(Ecran::Libre); }
                            if ok {
                                reg.vue = vues.get(vue_sel).cloned().unwrap_or_default();
                                reg.enregistrer();
                                if !en_partie {
                                    nouvelle_partie(&mut sim, &mut regles)?;
                                    regles.on_switch(regles::sw::START, true);
                                    en_partie = true;
                                }
                                aller = Some(Ecran::Jeu);
                            }
                        }
                        Ecran::Pause => {
                            if haut { sel = (sel + 2) % 3; bip(&mut son); }
                            if bas { sel = (sel + 1) % 3; bip(&mut son); }
                            if retour { aller = Some(Ecran::Jeu); }
                            if ok {
                                match sel {
                                    0 => aller = Some(Ecran::Jeu),
                                    1 => aller = Some(Ecran::Vues),
                                    _ => { en_partie = false; nouvelle_partie(&mut sim, &mut regles)?; aller = Some(Ecran::Libre); }
                                }
                            }
                        }
                        Ecran::FinPartie => { if ok && t_ecran.elapsed().as_secs_f32() > 1.0 { t_ecran = Instant::now() - std::time::Duration::from_secs(10); } }
                        Ecran::Initiales => {
                            let n = ecrans::ALPHABET.len();
                            if gauche || haut { lettres[pos_lettre] = (lettres[pos_lettre] + n - 1) % n; bip(&mut son); }
                            if droite || bas { lettres[pos_lettre] = (lettres[pos_lettre] + 1) % n; bip(&mut son); }
                            if sc == Scancode::Backspace && pos_lettre > 0 { pos_lettre -= 1; }
                            if ok {
                                son.play(regles::snd::STANDUP);
                                if pos_lettre < 2 { pos_lettre += 1; lettres[pos_lettre] = lettres[pos_lettre - 1]; }
                                else {
                                    let nom: String = lettres.iter().map(|&i| ecrans::ALPHABET[i]).collect();
                                    nouveau_rang = tableau.ajouter(nom.trim_end(), score_fin);
                                    son.play(regles::snd::V_RECORD);
                                    aller = Some(Ecran::Libre);
                                }
                            }
                        }
                        Ecran::Jeu => {}
                    }
                }
                // ------------------------------------------------ partie en cours
                Event::KeyDown { scancode: Some(sc), repeat: false, .. } => match sc {
                    Scancode::Escape => { aller = Some(Ecran::Pause); }
                    Scancode::LShift | Scancode::Z | Scancode::Left => { sim.held[0] = true; regles.on_switch(regles::sw::FLIP_L, true); son.play(regles::snd::FLIP); }
                    Scancode::RShift | Scancode::Slash | Scancode::Right => { sim.held[1] = true; regles.on_switch(regles::sw::FLIP_R, true); son.play(regles::snd::FLIP); }
                    Scancode::Down => { if tirage_debut.is_none() { tirage_debut = Some(Instant::now()); } }
                    Scancode::S | Scancode::Return => regles.on_switch(regles::sw::START, true),
                    Scancode::Num5 => regles.on_switch(regles::sw::COIN, true),
                    Scancode::Space | Scancode::Up => { if sim.nudge(0.0) { son.play(regles::snd::NUDGE); } }
                    Scancode::LCtrl => { if sim.nudge(-1.0) { son.play(regles::snd::NUDGE); } }
                    Scancode::RCtrl => { if sim.nudge(1.0) { son.play(regles::snd::NUDGE); } }
                    Scancode::P => pause_physique = !pause_physique,
                    Scancode::M => { son.toggle_mute(); }
                    Scancode::C => {
                        if orbite.take().is_none() && !vues.is_empty() { vue_sel = (vue_sel + 1) % vues.len(); reg.vue = vues[vue_sel].clone(); }
                    }
                    Scancode::Equals | Scancode::KpPlus => { let d = sim.pente_deg + 0.5; sim.set_pente(d); }
                    Scancode::Minus | Scancode::KpMinus => { let d = sim.pente_deg - 0.5; sim.set_pente(d); }
                    _ => {}
                },
                Event::KeyUp { scancode: Some(Scancode::LShift), .. } if ecran != Ecran::Jeu => maj_menu[0] = false,
                Event::KeyUp { scancode: Some(Scancode::RShift), .. } if ecran != Ecran::Jeu => maj_menu[1] = false,
                Event::KeyUp { scancode: Some(sc), .. } if ecran == Ecran::Jeu => match sc {
                    Scancode::LShift | Scancode::Z | Scancode::Left => { sim.held[0] = false; regles.on_switch(regles::sw::FLIP_L, false); }
                    Scancode::RShift | Scancode::Slash | Scancode::Right => { sim.held[1] = false; regles.on_switch(regles::sw::FLIP_R, false); }
                    Scancode::Down => if let Some(t) = tirage_debut.take() {
                        let p = (t.elapsed().as_secs_f64() / TIRAGE_S).min(1.0) as f32;
                        sim.tirage = 0.0;
                        sim.force = physique::force_lanceur(p);
                        regles.on_switch(regles::sw::LAUNCH, true);
                    },
                    _ => {}
                },
                Event::MouseButtonDown { mouse_btn: sdl2::mouse::MouseButton::Left, .. } if ecran == Ecran::Jeu => glisse = true,
                Event::MouseButtonUp { mouse_btn: sdl2::mouse::MouseButton::Left, .. } => glisse = false,
                Event::MouseMotion { xrel, yrel, .. } if glisse => {
                    let o = orbite.get_or_insert(orbite_depuis(&cam_courante));
                    o.0 -= xrel as f32 * 0.005;
                    o.1 = (o.1 + yrel as f32 * 0.005).clamp(0.05, 1.5);
                }
                Event::MouseWheel { y, .. } if ecran == Ecran::Jeu => {
                    let o = orbite.get_or_insert(orbite_depuis(&cam_courante));
                    o.2 = (o.2 * 0.9f32.powi(y)).clamp(250.0, 4000.0);
                }
                _ => {}
            }
        }
        if regl_change { reg.enregistrer(); }
        // changement d'écran
        if let Some(e) = aller {
            if e == Ecran::Menu && ecran == Ecran::Reglages && reg.detail != detail_charge {
                // niveau de détail changé : la scène est rechargée (textures allégées ou non)
                draw_chargement(&mut ui, &mut fenetre);
                scene = charger_scene(&base, reg.detail, None)?;
                detail_charge = reg.detail;
                pc = pieces(&scene, sim.drops_up.len());
                vues = noms_vues(&scene);
                vue_sel = vue_sel.min(vues.len().saturating_sub(1));
            }
            if e == Ecran::Cinematique { t_cine0 = 0.0; cine_prec = -1.0; son.arreter_musique(); }
            if e == Ecran::Libre && ecran != Ecran::Initiales { nouveau_rang = None; }
            if e == Ecran::Jeu || e == Ecran::Pause { sim.held = [false, false]; }
            if e != Ecran::Jeu { tirage_debut = None; sim.tirage = 0.0; }   // lanceur tiré puis pause : tir annulé
            maj_menu = [false, false];
            sel = 0;
            ecran = e;
            t_ecran = Instant::now();
        }

        let ecoule = t_depart.elapsed().as_secs_f64() * 1000.0;
        if auto {
            if etape_auto == 0 && ecoule > 300.0 { regles.on_switch(regles::sw::START, true); en_partie = true; etape_auto = 1; }
            if etape_auto == 1 && ecoule > 1200.0 { tirage_debut = Some(Instant::now()); etape_auto = 2; }
            if etape_auto == 2 && ecoule > 2100.0 {
                tirage_debut = None; sim.tirage = 0.0; sim.force = 1.1; regles.on_switch(regles::sw::LAUNCH, true); etape_auto = 3;
            }
        }
        let dt = avant.elapsed().as_secs_f64() * 1000.0;
        if ecoule > 3000.0 { saccades.0 += 1; if dt > 20.0 { saccades.1 += 1; } saccades.2 = saccades.2.max(dt); }
        avant = Instant::now();
        if let Some(t) = tirage_debut { sim.tirage = (t.elapsed().as_secs_f64() / TIRAGE_S).min(1.0) as f32; }

        // ------------------------------------------------ cinématique : machine qui se déplie et s'allume
        if ecran == Ecran::Cinematique {
            t_cine0 += (dt / 1000.0).min(0.1);
            let t = t_cine0;
            machine = cinematique(t);
            // bruitages : verrouillage des pieds, du fronton, relais de mise sous tension, jingle
            for (seuil, s) in [(1.0, regles::snd::CLAC), (3.6, regles::snd::CLAC), (6.2, regles::snd::DROP), (6.8, regles::snd::CLAC), (8.1, regles::snd::START)] {
                if cine_prec < seuil && t >= seuil { son.play(s); }
            }
            cine_prec = t;
            if t >= FIN_CINEMATIQUE { machine = (1.0, 1.0, 1.0); ecran = Ecran::Vues; t_ecran = Instant::now(); sel = 0; }
        }

        // ------------------------------------------------ physique et règles
        let t_phys = Instant::now();
        let jeu_actif = matches!(ecran, Ecran::Jeu) && !pause_physique;
        if jeu_actif {
            sim.step(dt);
            for (id, ferme) in std::mem::take(&mut sim.contacts) { regles.on_switch(&id, ferme); }
        }
        if machine.2 > 0.5 { regles.tick(if jeu_actif { sim.time } else { regles_temps(&regles, dt) }); }
        let sorties = std::mem::take(&mut regles.sorties);
        for b in sorties.bobines { sim.coil(b); }
        if machine.2 > 0.5 { for s in sorties.sons { son.play(s); } }
        if machine.2 >= 1.0 && ecran != Ecran::Cinematique { son.set_music(regles.mode == regles::Mode::Play && ecran == Ecran::Jeu); }
        mesure.0 += t_phys.elapsed().as_secs_f64() * 1000.0;

        // fin de partie : score, puis initiales si le score entre au tableau
        if en_partie && ecran == Ecran::Jeu && matches!(regles.mode, regles::Mode::Over | regles::Mode::Attract) && !auto {
            en_partie = false;
            score_fin = regles.last_score;
            ecran = Ecran::FinPartie;
            t_ecran = Instant::now();
        }
        if ecran == Ecran::FinPartie && t_ecran.elapsed().as_secs_f32() > 4.0 {
            if let Some(r) = tableau.rang(score_fin) {
                nouveau_rang = Some(r);
                lettres = [0; 3];
                pos_lettre = 0;
                ecran = Ecran::Initiales;
            } else {
                nouveau_rang = None;
                ecran = Ecran::Libre;
            }
            t_ecran = Instant::now();
            sel = 0;
        }

        // ------------------------------------------------ animation de la scène
        let now = sim.time;
        let age = |k: &str| now - sim.flash.get(k).copied().unwrap_or(-1e9);
        for (c, a) in &pc.palettes {
            if let Some(a) = a { scene.noeuds[a.noeud].r = a.r0 * UnitQuaternion::from_axis_angle(&Vector3::z_axis(), sim.angle_palette(*c)); }
        }
        for (i, a) in pc.cibles.iter().enumerate() {
            if let Some(a) = a {
                let n = &mut scene.noeuds[a.noeud];
                let bas = !sim.drops_up[i];
                n.t = a.t0 + Vector3::new(0.0, 0.0, if bas { 34.0 } else { 0.0 });
                n.visible = !bas;
            }
        }
        for i in 0..3 {
            let ag = age(&format!("bumper{i}"));
            let stroke = if ag < 26.0 { (ag / 26.0 * std::f64::consts::FRAC_PI_2).sin() }
                else if ag < 145.0 { let u = (ag - 26.0) / 119.0; (-u * 4.2).exp() * (u * std::f64::consts::PI * 1.35).cos() * (1.0 - u) } else { 0.0 };
            if let Some(a) = &pc.anneaux[i] { scene.noeuds[a.noeud].t = a.t0 + Vector3::new(0.0, 0.0, (stroke * 10.5) as f32); }
            if let Some(a) = &pc.chapeaux[i] {
                let z = if ag < 90.0 { 0.7 * (std::f64::consts::PI * ag / 90.0).sin() } else { 0.0 };
                scene.noeuds[a.noeud].t = a.t0 + Vector3::new(0.0, 0.0, z as f32);
            }
            let flash = if ag < 190.0 { (1.0 - ag / 190.0).powf(1.5) as f32 } else { 0.0 };
            for (nom, base, k) in [("chapeau", 0.0, 0.65), ("flanc", 0.08, 1.1), ("corps", 0.1, 1.6), ("ampoule", 0.4, 2.4)] {
                if let Some(m) = scene.mat(&format!("emis_bumper_{nom}_{i}")) { m.intensite = base + flash * k; }
            }
        }
        for i in 0..2 {
            let hit = age(&format!("sling{i}")) < 90.0;
            if let Some(m) = scene.mat(&format!("emis_sling_{i}")) { m.intensite = if hit { 1.0 } else { 0.0 }; }
        }
        let lampes = regles.lamps();
        let clign = (t_depart.elapsed().as_millis() / 220) % 2 == 0;
        for nom in &pc.lampes_mats {
            let st = lampes.iter().find(|(k, _)| format!("lampe_{k}") == *nom).map_or(0, |e| e.1);
            let allume = st == 1 || (st == 2 && clign);
            if let Some(m) = scene.mat(nom) { m.intensite = if allume { 1.55 } else { 0.0 }; }
        }
        for i in 0..3 {
            let hit = age(&format!("target{i}")) < 150.0;
            let allume = lampes.iter().any(|(k, v)| *k == format!("cible{i}") && *v > 0);
            if let Some(m) = scene.mat(&format!("emis_cible_gauche_{i}")) { m.intensite = if hit { 0.9 } else if allume { 0.5 } else { 0.0 }; }
        }
        if let Some(a) = &pc.tourniquet { scene.noeuds[a.noeud].r = a.r0 * UnitQuaternion::from_axis_angle(&Vector3::x_axis(), sim.spinner.angle); }
        // tige : tirée vers le joueur (recule hors de la caisse), puis frappe vers l'intérieur au relâchement
        let kick = (if age("plunger") < 60.0 { 6.0 } else { 0.0 }) - sim.tirage * physique::COURSE_LANCEUR;
        if let Some(a) = &pc.tige { scene.noeuds[a.noeud].t = a.t0 + Vector3::new(0.0, kick, 0.0); }
        for a in &pc.lanceur { scene.noeuds[a.noeud].t = a.t0 + Vector3::new(0.0, 1.0, 0.0) * kick; }
        // machine : pieds, fronton, hauteur de la caisse (les pieds la soulèvent, leur bout restant au sol)
        let (pieds_u, fronton_u, tension) = machine;
        let angle_pied = (1.0 - pieds_u) * std::f32::consts::FRAC_PI_2;
        for (a, sens) in &pc.pieds { scene.noeuds[a.noeud].r = a.r0 * UnitQuaternion::from_axis_angle(&Vector3::y_axis(), sens * angle_pied); }
        let mut m_machine = Matrix4::<f32>::identity();
        if let Some(d) = &scene.deplie {
            if let Some(a) = &pc.fronton { scene.noeuds[a.noeud].r = a.r0 * UnitQuaternion::from_axis_angle(&Vector3::x_axis(), d.fronton_plie * (1.0 - fronton_u)); }
            let haut = (d.machine_monde * Vector4::new(0.0, 0.0, 1.0, 0.0)).xyz();
            m_machine = Matrix4::new_translation(&(haut * -(d.h_sol * (1.0 - angle_pied.cos()))));
        }
        scene.mettre_a_jour();
        {
            let (sc, inf) = if tension >= 0.5 { regles.display() } else { ("        ".into(), "    ".into()) };
            if let Some(a) = scene.afficheurs.as_mut() { a.ecrire(&sc, &inf); }
        }

        // ------------------------------------------------ caméra
        let (w, h) = fenetre.drawable_size();
        let en_jeu = orbite.is_none() && matches!(ecran, Ecran::Vues | Ecran::Jeu | Ecran::Pause | Ecran::FinPartie | Ecran::Initiales);
        let vertical = en_jeu && w > h && (reg.vue == "vertical" || reg.vue == "plan_vertical");
        let plan = en_jeu && (reg.vue == "plan" || reg.vue == "plan_vertical");   // vue 2D : plateau vu de dessus
        let (ew, eh) = if vertical { (h, w) } else { (w, h) };     // taille logique de l'image (portrait si vertical)
        let aspect = ew as f32 / eh.max(1) as f32;
        let format = if aspect >= 1.0 { "paysage" } else { "portrait" };
        let cams: Vec<&rendu::Camera> = scene.cameras.iter().filter(|c| c.format == format).collect();
        let defaut = rendu::Camera { nom: "défaut".into(), format: format.into(),
            matrice: Matrix4::look_at_rh(&Point3::new(0.0, 1500.0, 1400.0), &Point3::origin(), &Vector3::y()).try_inverse().unwrap(),
            fov: 34.0, near: 10.0, far: 12000.0 };
        let nom_cam = if format == "portrait" { "plateau" } else { "joueur" };
        let idx_jeu = cam_jeu.unwrap_or_else(|| cams.iter().position(|c| c.nom == nom_cam).unwrap_or(0));
        let fixe: rendu::Camera = if cams.is_empty() { defaut.clone() } else { cams[idx_jeu % cams.len()].clone() };
        // écran vertical : la caméra plateau resserrée pour que la table occupe toute la hauteur de l'écran
        let fixe = if vertical && cam_jeu.is_none() { rendu::Camera { fov: fixe.fov * 0.80, ..fixe } } else { fixe };
        let horloge = t_depart.elapsed().as_secs_f32();
        let cam: rendu::Camera = match (&scene.deplie, ecran) {
            (_, Ecran::Jeu | Ecran::Pause) if orbite.is_some() => {
                let (lacet, tangage, d) = orbite.unwrap();
                let centre = centre_plateau(&scene, pc.table, &sim);
                let oeil = centre + Vector3::new(lacet.sin() * tangage.cos(), tangage.sin(), lacet.cos() * tangage.cos()) * d;
                rendu::Camera { nom: "orbite".into(), format: format.into(),
                    matrice: Matrix4::look_at_rh(&Point3::from(oeil), &Point3::from(centre), &Vector3::y()).try_inverse().unwrap(),
                    fov: fixe.fov, near: 10.0, far: 30000.0 }
            }
            (Some(d), Ecran::Menu | Ecran::Reglages | Ecran::Libre | Ecran::Initiales | Ecran::FinPartie) if !matches!(ecran, Ecran::FinPartie) => {
                // menus : la caméra flâne autour de la machine, dans la salle
                let lacet = -0.55 + 0.45 * (horloge * 0.06).sin();
                camera_orbite(d, lacet, 0.30, 2500.0, 250.0 * pieds_u - 150.0, 40.0)
            }
            (Some(d), Ecran::Cinematique) => {
                let t = t_cine0 as f32;
                // la machine entière reste dans l'image (fronton levé compris) pendant le dépliage et l'allumage,
                // puis la caméra rejoint la vue de jeu
                let u = lisse(t as f64, 0.0, 8.6);
                let o = camera_cadree(d, -1.05 + 0.85 * u, 0.30 - 0.12 * u, 2800.0 - 250.0 * u, 40.0, aspect);
                camera_melange(&o, &fixe, lisse(t as f64, 8.6, 10.6))
            }
            _ => fixe.clone(),
        };
        let cam = if plan { camera_plan(&scene, pc.table, &sim, aspect).unwrap_or(cam) } else { cam };
        cam_courante = cam.matrice;
        let billes: Vec<(Vector3<f32>, UnitQuaternion<f32>)> = (0..sim.billes.len()).filter(|&i| !sim.billes[i].retiree).map(|i| {
            let (x, y) = sim.position(i);
            let hz = if sim.billes[i].mode == physique::ModeBille::Saucer { -7.0 } else { sim.hauteur(i).min(200.0) };
            (Vector3::new(x, y, -(sim.ball_r + hz)), sim.rotation(i))
        }).collect();

        // ------------------------------------------------ dessin : scène hors écran (définition et anticrénelage
        // réglables), agrandie à l'écran, puis l'interface à la définition de l'écran
        let t_rendu = Instant::now();
        let echelle = echelle_force.unwrap_or(if reg.detail == Detail::Bas { 0.75 } else { 1.0 }).clamp(0.25, 1.0);
        let (mut rw, mut rh) = (ew, eh);
        if reg.plein_ecran && echelle_force.is_none() {
            let (a, b) = if vertical { (reg.resolution.1, reg.resolution.0) } else { reg.resolution };
            rw = a.min(ew); rh = b.min(eh);
        }
        rw = ((rw as f32 * echelle) as u32).max(1);
        rh = ((rh as f32 * echelle) as u32).max(1);
        let msaa = msaa_force.unwrap_or(reg.detail.msaa());
        unsafe {
            cible.preparer(rw, rh, msaa);
            gl::Viewport(0, 0, rw as i32, rh as i32);
            gl::ClearColor(0.09, 0.05, 0.027, 1.0);
            gl::Clear(gl::COLOR_BUFFER_BIT | gl::DEPTH_BUFFER_BIT);
        }
        // détail Bas : la salle (≈ 6 ms par image sur une GT 710) n'est dessinée que dans les menus et la cinématique
        scene.sans_salle = vertical || plan || drapeau("--sans-salle")
            || (reg.detail == Detail::Bas && matches!(ecran, Ecran::Jeu | Ecran::Pause));
        scene.dessiner(&cam, aspect, &billes, pc.table, &m_machine, tension);
        if vertical {
            // l'interface est dessinée dans l'image portrait, puis le tout est tourné
            ui.debut(rw, rh);
        } else {
            unsafe {
                cible.afficher(w, h);
                gl::Viewport(0, 0, w as i32, h as i32);
            }
            ui.debut(w, h);
        }
        let te = t_ecran.elapsed().as_secs_f64();
        match ecran {
            Ecran::Menu => ecrans::menu_principal(&mut ui, sel),
            Ecran::Reglages => ecrans::reglages(&mut ui, &reg, sel, &resolutions),
            Ecran::Libre => ecrans::libre(&mut ui, &tableau, sel, nouveau_rang),
            Ecran::Cinematique => ecrans::cinematique(&mut ui, t_cine0),
            Ecran::Vues => ecrans::vues(&mut ui, &vues, vue_sel),
            Ecran::Pause => ecrans::pause(&mut ui, sel),
            Ecran::FinPartie => ecrans::fin_partie(&mut ui, score_fin, tableau.rang(score_fin).is_some()),
            Ecran::Initiales => ecrans::initiales(&mut ui, &lettres, pos_lettre, score_fin, nouveau_rang.unwrap_or(0), te),
            Ecran::Jeu => {}
        }
        if matches!(ecran, Ecran::Jeu) {
            let (sc, inf) = regles.display();
            if plan && !vertical && ui.w > ui.h { ecrans::score_lateral(&mut ui, &sc, &inf); }
            else if vertical { ecrans::bandeau_score(&mut ui, &sc, &inf); }
        }
        ui.dessiner();
        if vertical { unsafe { tourne.afficher(&cible, w, h, if reg.vertical_horaire { 1 } else { -1 }); } }
        if profil {
            mesure.4 += t_rendu.elapsed().as_secs_f64() * 1000.0;
            unsafe { gl::Finish(); }
            mesure.1 += t_rendu.elapsed().as_secs_f64() * 1000.0;
            mesure.2 += 1;
            if mesure.3.elapsed().as_secs_f32() >= 2.0 {
                let n = mesure.2.max(1) as f64;
                println!("{:.0} i/s : physique {:.1} ms, rendu {:.1} ms par image dont {:.1} ms de préparation ({rw}×{rh}, msaa {msaa})",
                    n / mesure.3.elapsed().as_secs_f64(), mesure.0 / n, mesure.1 / n, mesure.4 / n);
                mesure = (0.0, 0.0, 0, Instant::now(), 0.0);
            }
        } else { mesure.0 = 0.0; }
        if let (Some(f), true) = (&capture, ecoule > apres) {
            let mut px = vec![0u8; (w * h * 3) as usize];
            unsafe {
                gl::PixelStorei(gl::PACK_ALIGNMENT, 1);
                gl::ReadPixels(0, 0, w as i32, h as i32, gl::RGB, gl::UNSIGNED_BYTE, px.as_mut_ptr() as *mut _);
            }
            let mut out = format!("P6\n{w} {h}\n255\n").into_bytes();
            for y in (0..h as usize).rev() { out.extend_from_slice(&px[y * w as usize * 3..(y + 1) * w as usize * 3]); }
            std::fs::write(f, out).map_err(|e| e.to_string())?;
            let (sc, inf) = regles.display();
            println!("capture {f} ({w}×{h}), écran {ecran:?}, caméra {}, billes {}, afficheur [{sc}] [{inf}], {:.0} i/s, {} images dont {} de plus de 20 ms (pire {:.1} ms)",
                cam.nom, billes.len(), fps.2, saccades.0, saccades.1, saccades.2);
            break 'jeu;
        }
        fenetre.gl_swap_window();
        // faible latence : le pilote ne garde pas d'images d'avance (sinon, sur une carte lente, l'appui sur une palette
        // n'apparaît à l'écran que deux ou trois images plus tard)
        if !profil || drapeau("--finish") { unsafe { gl::Finish(); } }

        fps.0 += 1;
        if fps.1.elapsed().as_secs_f32() >= 0.25 {
            fps.2 = fps.0 as f32 / fps.1.elapsed().as_secs_f32();
            fps.0 = 0;
            fps.1 = Instant::now();
            let (s, i) = regles.display();
            let _ = fenetre.set_title(&format!("Fanny Pinball  [{s}] [{i}]  — {:.0} i/s", fps.2));
        }
    }
    reg.enregistrer();
    // code de sortie : 0 = « Quitter » choisi dans le menu (la borne s'éteint), 2 = fenêtre fermée ou processus arrêté
    // de l'extérieur (la borne relance le jeu)
    if code_sortie != 0 { std::process::exit(code_sortie); }
    Ok(())
}

/// temps des règles hors partie (mode attraction des lampes) : l'horloge de la physique n'avance pas dans les menus
fn regles_temps(regles: &regles::Regles, dt: f64) -> f64 { regles.now + dt }

/// vue 2D : caméra orthographique perpendiculaire au plateau, le haut de la table en haut de l'image, la table entière
/// cadrée (hauteur ou largeur, selon le format de l'image)
fn camera_plan(scene: &rendu::Scene, table: Option<usize>, sim: &physique::Sim, aspect: f32) -> Option<rendu::Camera> {
    let m = scene.noeuds[table?].monde;
    let p = |x: f32, y: f32, z: f32| { let v = m * rendu::v4(x, y, z); Vector3::new(v.x, v.y, v.z) };
    let (w, h) = (sim.w, sim.h);
    let centre = p(w / 2.0, h / 2.0, 0.0);
    let dessus = (p(w / 2.0, h / 2.0, -1.0) - centre).normalize();     // −z de la table : côté vitre
    let haut = (p(w / 2.0, 0.0, 0.0) - centre).normalize();             // vers le fronton
    let oeil = centre + dessus * 3000.0;
    let vue = Matrix4::look_at_rh(&Point3::from(oeil), &Point3::from(centre), &haut);
    let marge = 1.03;
    let hh = (h / 2.0).max(w / 2.0 / aspect) * marge;
    Some(rendu::Camera { nom: "plan".into(), format: "paysage".into(), matrice: vue.try_inverse()?, fov: -hh, near: 100.0, far: 6000.0 })
}

fn centre_plateau(scene: &rendu::Scene, table: Option<usize>, sim: &physique::Sim) -> Vector3<f32> {
    table.map(|t| {
        let p = scene.noeuds[t].monde * rendu::v4(sim.w / 2.0, sim.h / 2.0, 0.0);
        Vector3::new(p.x, p.y, p.z)
    }).unwrap_or_else(Vector3::zeros)
}

fn draw_chargement(ui: &mut ui::Ui, fenetre: &mut sdl2::video::Window) {
    let (w, h) = fenetre.drawable_size();
    unsafe {
        gl::BindFramebuffer(gl::FRAMEBUFFER, 0);
        gl::Viewport(0, 0, w as i32, h as i32);
        gl::ClearColor(0.05, 0.03, 0.02, 1.0);
        gl::Clear(gl::COLOR_BUFFER_BIT);
    }
    ui.debut(w, h);
    ecrans::chargement(ui, "Chargement…");
    ui.dessiner();
    fenetre.gl_swap_window();
}

/// orbite (lacet, tangage, distance) qui part de la caméra en cours, autour du centre de la salle de jeu
fn orbite_depuis(m: &Matrix4<f32>) -> (f32, f32, f32) {
    let oeil = Vector3::new(m[(0, 3)], m[(1, 3)], m[(2, 3)]);
    let l = oeil.norm().max(1.0);
    ((oeil.x).atan2(oeil.z), (oeil.y / l).clamp(-1.0, 1.0).asin().clamp(0.05, 1.5), l.min(4000.0))
}
