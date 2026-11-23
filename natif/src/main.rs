// Fanny Pinball, version native (Rust) : même physique que la version web (monde exporté), mêmes règles,
// scène 3D exportée du jeu web avec l'habillage de la caisse. Commandes identiques à la version web et au
// contrôleur Pro Micro (controleur/fanny_pincab) :
//   Maj gauche / Maj droite : palettes ; Bas (maintenir puis relâcher) : lanceur ; S ou Entrée : départ ; 5 : pièce
//   Espace / Haut : bourrage frontal ; Ctrl gauche / droit : bourrage latéral ; P : pause ; F / F11 : plein écran
//   C : caméra suivante ; M : son coupé ; + / − : pente du plateau ; Échap : quitter

mod audio;
mod physique;
mod regles;
mod rendu;

use nalgebra::{UnitQuaternion, Vector3};
use sdl2::keyboard::Scancode;
use std::path::PathBuf;
use std::time::Instant;

const TIRAGE_S: f64 = 0.9;

fn racine() -> PathBuf {
    // donnees/ à côté de l'exécutable, sinon dans le dossier du crate (cargo run)
    let exe = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf()));
    for d in exe.iter().flat_map(|e| [e.clone(), e.join(".."), e.join("../..")]).chain([PathBuf::from(env!("CARGO_MANIFEST_DIR"))]) {
        if d.join("donnees/monde.json").exists() { return d; }
    }
    PathBuf::from(".")
}

struct Anim { noeud: usize, t0: Vector3<f32>, r0: UnitQuaternion<f32> }

fn main() -> Result<(), String> {
    let base = racine();
    let mut sim = physique::Sim::charger(base.join("donnees/monde.json").to_str().unwrap())?;
    let mut regles = regles::Regles::new(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(7));

    let sdl = sdl2::init()?;
    let video = sdl.video()?;
    let gla = video.gl_attr();
    gla.set_context_profile(sdl2::video::GLProfile::Core);
    gla.set_context_version(3, 3);
    gla.set_multisample_buffers(1);
    gla.set_multisample_samples(4);
    gla.set_framebuffer_srgb_compatible(false);
    let mut fenetre = video.window("Fanny Pinball", 1280, 800).opengl().resizable().position_centered().build().map_err(|e| e.to_string())?;
    let _ctx = fenetre.gl_create_context()?;
    gl::load_with(|s| video.gl_get_proc_address(s) as *const _);
    let _ = video.gl_set_swap_interval(1);
    unsafe { gl::Enable(gl::MULTISAMPLE); }

    let chemin_scene = base.join("donnees/scene.glb");
    let mut scene = rendu::Scene::charger(chemin_scene.to_str().unwrap())
        .map_err(|e| format!("{e}\n(scène absente : node outils/exporter_scene_natif.mjs)"))?;
    let mut son = audio::Audio::init(&base.join("../assets"));
    if !base.join("../assets/sons").exists() { son = audio::Audio::init(&base.join("assets")); }

    // pièces animées
    let anim = |scene: &rendu::Scene, nom: &str| scene.noeud(nom).map(|i| Anim { noeud: i, t0: scene.noeuds[i].t0, r0: scene.noeuds[i].r0 });
    let palettes: Vec<(char, Option<Anim>)> = vec![('L', anim(&scene, "dyn_palette_L")), ('R', anim(&scene, "dyn_palette_R"))];
    let cibles: Vec<Option<Anim>> = (0..sim.drops_up.len()).map(|i| anim(&scene, &format!("dyn_cible_{i}"))).collect();
    let anneaux: Vec<Option<Anim>> = (0..3).map(|i| anim(&scene, &format!("dyn_bumper_anneau_{i}"))).collect();
    let chapeaux: Vec<Option<Anim>> = (0..3).map(|i| anim(&scene, &format!("dyn_bumper_chapeau_{i}"))).collect();
    let tourniquet = anim(&scene, "dyn_tourniquet");
    let tige = anim(&scene, "dyn_tige_lanceur");
    let lanceur: Vec<Anim> = (0..8).filter_map(|i| anim(&scene, &format!("dyn_lanceur_{i}"))).collect();
    let table = scene.noeud("table");
    let axe_lanceur = Vector3::new(0.0, 1.0, 0.0);
    let lampes_mats: Vec<(String, f32)> = scene.materiaux.iter().filter(|m| m.nom.starts_with("lampe_")).map(|m| (m.nom.clone(), m.intensite)).collect();

    // caméra de départ : « joueur » (vue debout devant la machine), comme la version web
    let mut cam_idx = scene.cameras.iter().filter(|c| c.format == "paysage").position(|c| c.nom == "joueur").unwrap_or(0);
    let mut pause = false;
    // caméra orbitale (souris : glisser pour tourner, molette pour zoomer ; C revient aux caméras du jeu) :
    // (lacet, tangage, distance) autour du centre du plateau
    let mut orbite: Option<(f32, f32, f32)> = None;
    let mut glisse = false;
    let mut plein = false;
    let mut tirage_debut: Option<Instant> = None;
    let mut ev = sdl.event_pump()?;
    let mut avant = Instant::now();
    let t_depart = Instant::now();
    let mut fps = (0u32, Instant::now(), 0.0f32);
    // essais sans joueur : --auto (départ puis tir), --capture fichier.ppm [--apres ms] [--camera n] [--orbite l,t,d]
    let args: Vec<String> = std::env::args().collect();
    let opt = |n: &str| args.iter().position(|a| a == n).and_then(|i| args.get(i + 1)).cloned();
    let auto = args.iter().any(|a| a == "--auto");
    let capture = opt("--capture");
    let apres: f64 = opt("--apres").and_then(|v| v.parse().ok()).unwrap_or(3000.0);
    if let Some(c) = opt("--camera").and_then(|v| v.parse().ok()) { cam_idx = c; }
    if let Some(o) = opt("--orbite") {      // --orbite lacet,tangage,distance (rad, rad, mm)
        let v: Vec<f32> = o.split(',').filter_map(|x| x.parse().ok()).collect();
        if v.len() == 3 { orbite = Some((v[0], v[1], v[2])); }
    }
    let mut etape_auto = 0;

    // centre du plateau dans le repère de la scène (cible de la caméra orbitale)
    let centre: Vector3<f32> = table.map(|t| {
        let p = scene.noeuds[t].monde * rendu::v4(sim.w / 2.0, sim.h / 2.0, 0.0);
        Vector3::new(p.x, p.y, p.z)
    }).unwrap_or_else(Vector3::zeros);
    let mut cam_courante = nalgebra::Matrix4::<f32>::identity();

    'jeu: loop {
        for e in ev.poll_iter() {
            use sdl2::event::Event;
            match e {
                Event::Quit { .. } => break 'jeu,
                Event::KeyDown { scancode: Some(sc), repeat: false, .. } => match sc {
                    Scancode::Escape => break 'jeu,
                    Scancode::LShift | Scancode::Z | Scancode::Left => { sim.held[0] = true; regles.on_switch(regles::sw::FLIP_L, true); son.play(regles::snd::FLIP); }
                    Scancode::RShift | Scancode::Slash | Scancode::Right => { sim.held[1] = true; regles.on_switch(regles::sw::FLIP_R, true); son.play(regles::snd::FLIP); }
                    Scancode::Down => { if tirage_debut.is_none() { tirage_debut = Some(Instant::now()); } }
                    Scancode::S | Scancode::Return => regles.on_switch(regles::sw::START, true),
                    Scancode::Num5 => regles.on_switch(regles::sw::COIN, true),
                    Scancode::Space | Scancode::Up => { if sim.nudge(0.0) { son.play(regles::snd::NUDGE); } }
                    Scancode::LCtrl => { if sim.nudge(-1.0) { son.play(regles::snd::NUDGE); } }
                    Scancode::RCtrl => { if sim.nudge(1.0) { son.play(regles::snd::NUDGE); } }
                    Scancode::P => pause = !pause,
                    Scancode::M => { son.toggle_mute(); }
                    Scancode::C => { if orbite.take().is_none() && !scene.cameras.is_empty() { cam_idx = (cam_idx + 1) % scene.cameras.len(); } }
                    Scancode::Equals | Scancode::KpPlus => { let d = sim.pente_deg + 0.5; sim.set_pente(d); }
                    Scancode::Minus | Scancode::KpMinus => { let d = sim.pente_deg - 0.5; sim.set_pente(d); }
                    Scancode::F | Scancode::F11 => {
                        plein = !plein;
                        let _ = fenetre.set_fullscreen(if plein { sdl2::video::FullscreenType::Desktop } else { sdl2::video::FullscreenType::Off });
                    }
                    _ => {}
                },
                Event::MouseButtonDown { mouse_btn: sdl2::mouse::MouseButton::Left, .. } => glisse = true,
                Event::MouseButtonUp { mouse_btn: sdl2::mouse::MouseButton::Left, .. } => glisse = false,
                Event::MouseMotion { xrel, yrel, .. } if glisse => {
                    let o = orbite.get_or_insert(orbite_depuis(&cam_courante, centre));
                    o.0 -= xrel as f32 * 0.005;
                    o.1 = (o.1 + yrel as f32 * 0.005).clamp(0.05, 1.5);
                }
                Event::MouseWheel { y, .. } => {
                    let o = orbite.get_or_insert(orbite_depuis(&cam_courante, centre));
                    o.2 = (o.2 * 0.9f32.powi(y)).clamp(250.0, 6000.0);
                }
                Event::KeyUp { scancode: Some(sc), .. } => match sc {
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
                _ => {}
            }
        }
        let ecoule = t_depart.elapsed().as_secs_f64() * 1000.0;
        if auto {
            if etape_auto == 0 && ecoule > 300.0 { regles.on_switch(regles::sw::START, true); etape_auto = 1; }
            if etape_auto == 1 && ecoule > 1200.0 { tirage_debut = Some(Instant::now()); etape_auto = 2; }
            if etape_auto == 2 && ecoule > 2100.0 {
                tirage_debut = None; sim.tirage = 0.0; sim.force = 1.1; regles.on_switch(regles::sw::LAUNCH, true); etape_auto = 3;
            }
        }
        let dt = avant.elapsed().as_secs_f64() * 1000.0;
        avant = Instant::now();
        if let Some(t) = tirage_debut { sim.tirage = (t.elapsed().as_secs_f64() / TIRAGE_S).min(1.0) as f32; }

        if !pause {
            sim.step(dt);
            for (id, ferme) in std::mem::take(&mut sim.contacts) { regles.on_switch(&id, ferme); }
            regles.tick(sim.time);
        } else {
            regles.tick(sim.time);
        }
        let sorties = std::mem::take(&mut regles.sorties);
        for b in sorties.bobines { sim.coil(b); }
        for s in sorties.sons { son.play(s); }
        son.set_music(regles.mode == regles::Mode::Play);

        // ------------------------------------------------ animation de la scène
        let now = sim.time;
        let age = |k: &str| now - sim.flash.get(k).copied().unwrap_or(-1e9);
        for (c, a) in &palettes {
            if let Some(a) = a {
                let n = &mut scene.noeuds[a.noeud];
                n.r = a.r0 * UnitQuaternion::from_axis_angle(&Vector3::z_axis(), sim.angle_palette(*c));
            }
        }
        for (i, a) in cibles.iter().enumerate() {
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
                else if ag < 145.0 { let u = (ag - 26.0) / 119.0; (-u * 4.2).exp() * (u * std::f64::consts::PI * 1.35).cos() * (1.0 - u) } else { 0.0 } as f64;
            if let Some(a) = &anneaux[i] { scene.noeuds[a.noeud].t = a.t0 + Vector3::new(0.0, 0.0, (stroke * 10.5) as f32); }
            if let Some(a) = &chapeaux[i] {
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
        for (nom, _) in &lampes_mats {
            let st = lampes.iter().find(|(k, _)| format!("lampe_{k}") == *nom).map_or(0, |e| e.1);
            let allume = st == 1 || (st == 2 && clign);
            if let Some(m) = scene.mat(nom) { m.intensite = if allume { 1.55 } else { 0.0 }; }
        }
        for i in 0..3 {
            let hit = age(&format!("target{i}")) < 150.0;
            let allume = lampes.iter().any(|(k, v)| *k == format!("cible{i}") && *v > 0);
            if let Some(m) = scene.mat(&format!("emis_cible_gauche_{i}")) { m.intensite = if hit { 0.9 } else if allume { 0.5 } else { 0.0 }; }
        }
        if let Some(a) = &tourniquet { scene.noeuds[a.noeud].r = a.r0 * UnitQuaternion::from_axis_angle(&Vector3::x_axis(), sim.spinner.angle); }
        let kick = (if age("plunger") < 60.0 { -6.0 } else { 0.0 }) + sim.tirage * physique::COURSE_LANCEUR;
        if let Some(a) = &tige { scene.noeuds[a.noeud].t = a.t0 + Vector3::new(0.0, kick, 0.0); }
        for a in &lanceur { scene.noeuds[a.noeud].t = a.t0 + axe_lanceur * kick; }
        scene.mettre_a_jour();
        { let (sc, inf) = regles.display(); if let Some(a) = scene.afficheurs.as_mut() { a.ecrire(&sc, &inf); } }

        // ------------------------------------------------ dessin
        let (w, h) = fenetre.drawable_size();
        let aspect = w as f32 / h.max(1) as f32;
        let format = if aspect >= 1.0 { "paysage" } else { "portrait" };
        let cams: Vec<&rendu::Camera> = scene.cameras.iter().filter(|c| c.format == format).collect();
        let defaut = rendu::Camera { nom: "défaut".into(), format: format.into(),
            matrice: nalgebra::Matrix4::look_at_rh(&nalgebra::Point3::new(0.0, 1500.0, 1400.0), &nalgebra::Point3::origin(), &Vector3::y()).try_inverse().unwrap(),
            fov: 34.0, near: 10.0, far: 12000.0 };
        let fixe = if cams.is_empty() { &defaut } else { cams[cam_idx % cams.len()] };
        let orb;
        let cam = if let Some((lacet, tangage, d)) = orbite {
            let oeil = centre + Vector3::new(lacet.sin() * tangage.cos(), tangage.sin(), lacet.cos() * tangage.cos()) * d;
            orb = rendu::Camera { nom: "orbite".into(), format: format.into(),
                matrice: nalgebra::Matrix4::look_at_rh(&nalgebra::Point3::from(oeil), &nalgebra::Point3::from(centre), &Vector3::y()).try_inverse().unwrap(),
                fov: fixe.fov, near: 10.0, far: 20000.0 };
            &orb
        } else { fixe };
        cam_courante = cam.matrice;
        let billes: Vec<(Vector3<f32>, UnitQuaternion<f32>)> = (0..sim.billes.len()).filter(|&i| !sim.billes[i].retiree).map(|i| {
            let (x, y) = sim.position(i);
            let hz = if sim.billes[i].mode == physique::ModeBille::Saucer { -7.0 } else { sim.hauteur(i).min(200.0) };
            (Vector3::new(x, y, -(sim.ball_r + hz)), sim.rotation(i))
        }).collect();
        unsafe {
            gl::Viewport(0, 0, w as i32, h as i32);
            gl::ClearColor(0.09, 0.05, 0.027, 1.0);
            gl::Clear(gl::COLOR_BUFFER_BIT | gl::DEPTH_BUFFER_BIT);
        }
        scene.dessiner(cam, aspect, &billes, table);
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
            println!("capture {f} ({w}×{h}), caméra {}, billes {}, afficheur [{sc}] [{inf}], {:.0} i/s", cam.nom, billes.len(), fps.2);
            break 'jeu;
        }
        fenetre.gl_swap_window();

        // afficheurs dans le titre de la fenêtre (en attendant leur rendu sur le fronton)
        fps.0 += 1;
        if fps.1.elapsed().as_secs_f32() >= 0.25 {
            fps.2 = fps.0 as f32 / fps.1.elapsed().as_secs_f32();
            fps.0 = 0;
            fps.1 = Instant::now();
            let (s, i) = regles.display();
            let _ = fenetre.set_title(&format!("Fanny Pinball  [{s}] [{i}]  — {} — {:.0} i/s{}", cam.nom, fps.2, if pause { " — PAUSE" } else { "" }));
        }
    }
    Ok(())
}

/// orbite (lacet, tangage, distance) qui part de la caméra en cours
fn orbite_depuis(m: &nalgebra::Matrix4<f32>, centre: Vector3<f32>) -> (f32, f32, f32) {
    let oeil = Vector3::new(m[(0, 3)], m[(1, 3)], m[(2, 3)]);
    let d = oeil - centre;
    let l = d.norm().max(1.0);
    ((d.x).atan2(d.z), (d.y / l).clamp(-1.0, 1.0).asin().clamp(0.05, 1.5), l)
}
