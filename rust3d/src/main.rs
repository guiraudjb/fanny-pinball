//! Fanny Pinball 3D — Version native OpenGL 3.3 Core en Rust.
//!
//! Zéro navigateur, zéro JavaScript/WASM : physique 480 Hz en Rust pur + maillages CAO réels
//! (`assets/cao/pieces.glb`, `assets/cao/caisse.glb`) fusionnés sur GPU + 54 sons MP3 natifs.

mod audio;
mod gl;
mod glb;
mod math3d;
mod mesh;
mod render3d;
mod rules;
mod sim;
mod table;

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use sdl2::event::Event;
use sdl2::image::InitFlag as ImgInit;
use sdl2::keyboard::Scancode;
use sdl2::mouse::MouseButton;
use sdl2::video::{FullscreenType, GLProfile, SwapInterval};

use audio::Audio;
use gl::Gl;
use render3d::{CameraMode, Renderer3D};
use rules::{snd, GameMode, Rules, Switch};
use sim::Sim;
use table::TableGeo;

const TIRAGE_S: f32 = 0.9;

#[derive(Debug, Clone)]
struct Config {
    high_score: u32,
    rot_deg: i32,
    slope_deg: f32,
    muted: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            high_score: 0,
            rot_deg: 0,
            slope_deg: 6.5,
            muted: false,
        }
    }
}

fn config_path() -> PathBuf {
    if let Ok(home) = env::var("HOME") {
        let dir = PathBuf::from(home).join(".config");
        let _ = fs::create_dir_all(&dir);
        dir.join("fanny-pinball-3d.conf")
    } else {
        PathBuf::from("fanny-pinball-3d.conf")
    }
}

fn load_config() -> Config {
    let mut cfg = Config::default();
    if let Ok(text) = fs::read_to_string(config_path()) {
        for line in text.lines() {
            if let Some((k, v)) = line.split_once('=') {
                match k.trim() {
                    "high_score" => {
                        if let Ok(n) = v.trim().parse() {
                            cfg.high_score = n;
                        }
                    }
                    "rot_deg" => {
                        if let Ok(r) = v.trim().parse::<i32>() {
                            if r == 0 || r == 90 || r == -90 {
                                cfg.rot_deg = r;
                            }
                        }
                    }
                    "slope_deg" => {
                        if let Ok(s) = v.trim().parse::<f32>() {
                            if (5.0..=8.0).contains(&s) {
                                cfg.slope_deg = s;
                            }
                        }
                    }
                    "muted" => cfg.muted = v.trim() == "1" || v.trim() == "true",
                    _ => {}
                }
            }
        }
    }
    cfg
}

fn save_config(cfg: &Config) {
    let text = format!(
        "high_score={}\nrot_deg={}\nslope_deg={:.1}\nmuted={}\n",
        cfg.high_score,
        cfg.rot_deg,
        cfg.slope_deg,
        if cfg.muted { 1 } else { 0 }
    );
    let _ = fs::write(config_path(), text);
}

fn find_assets_dir(cli_path: Option<PathBuf>) -> PathBuf {
    if let Some(p) = cli_path {
        return p;
    }
    let mut candidates = vec![PathBuf::from("assets"), PathBuf::from("../assets")];
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("assets"));
            candidates.push(dir.join("../assets"));
            candidates.push(dir.join("../../assets"));
            candidates.push(dir.join("../../../assets"));
        }
    }
    for c in &candidates {
        if c.is_dir() {
            return c.clone();
        }
    }
    PathBuf::from("assets")
}

struct CliOpts {
    fullscreen: bool,
    rot_override: Option<i32>,
    slope_override: Option<f32>,
    assets: Option<PathBuf>,
    show_fps: bool,
    cam_haute: bool,
}

fn parse_args() -> CliOpts {
    let mut opts = CliOpts {
        fullscreen: false,
        rot_override: None,
        slope_override: None,
        assets: None,
        show_fps: false,
        cam_haute: false,
    };
    let args: Vec<String> = env::args().collect();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--fullscreen" | "-f" => opts.fullscreen = true,
            "--fps" => opts.show_fps = true,
            "--haute" => opts.cam_haute = true,
            "--rot" => {
                if let Some(v) = args.get(i + 1).and_then(|s| s.parse::<i32>().ok()) {
                    if v == 0 || v == 90 || v == -90 {
                        opts.rot_override = Some(v);
                    }
                    i += 1;
                }
            }
            "--slope" | "--pente" => {
                if let Some(v) = args.get(i + 1).and_then(|s| s.parse::<f32>().ok()) {
                    opts.slope_override = Some(v.clamp(5.0, 8.0));
                    i += 1;
                }
            }
            "--assets" => {
                if let Some(v) = args.get(i + 1) {
                    opts.assets = Some(PathBuf::from(v));
                    i += 1;
                }
            }
            "--help" | "-h" => {
                println!(
                    "Fanny Pinball 3D (natif Rust + OpenGL 3.3)\n\
                     Options :\n\
                     \x20 -f, --fullscreen      Démarrer en plein écran\n\
                     \x20 --rot <0|90|-90>      Pivoter l'affichage pour écran vertical\n\
                     \x20 --haute               Démarrer en caméra haute (pincab)\n\
                     \x20 --pente <5.0..8.0>    Inclinaison du plateau en degrés\n\
                     \x20 --assets <dossier>    Chemin vers le dossier assets/\n\
                     \x20 --fps                 Afficher les FPS dans le titre\n"
                );
                std::process::exit(0);
            }
            _ => {}
        }
        i += 1;
    }
    opts
}

fn is_left(sc: Scancode) -> bool {
    matches!(sc, Scancode::LShift | Scancode::Left | Scancode::Z)
}
fn is_right(sc: Scancode) -> bool {
    matches!(sc, Scancode::RShift | Scancode::Right | Scancode::Slash)
}
fn is_launch(sc: Scancode) -> bool {
    matches!(sc, Scancode::Down | Scancode::Return)
}
fn is_start(sc: Scancode) -> bool {
    matches!(sc, Scancode::S | Scancode::Return)
}
fn is_coin(sc: Scancode) -> bool {
    matches!(sc, Scancode::Num5 | Scancode::C)
}

fn main() -> Result<(), String> {
    let cli = parse_args();
    let mut cfg = load_config();
    if let Some(r) = cli.rot_override {
        cfg.rot_deg = r;
    }
    if let Some(s) = cli.slope_override {
        cfg.slope_deg = s;
    }
    let assets_dir = find_assets_dir(cli.assets);

    let sdl = sdl2::init()?;
    let video = sdl.video()?;
    let _audio_sub = sdl.audio().ok();
    let _img_ctx = sdl2::image::init(ImgInit::PNG | ImgInit::JPG)?;

    let gl_attr = video.gl_attr();
    gl_attr.set_context_profile(GLProfile::Core);
    gl_attr.set_context_version(3, 3);
    gl_attr.set_depth_size(24);
    gl_attr.set_double_buffer(true);
    gl_attr.set_multisample_buffers(1);
    gl_attr.set_multisample_samples(4);

    let build_win = |fs: bool| -> Result<sdl2::video::Window, String> {
        let mut wb = if fs {
            let mut b = video.window("Fanny Pinball 3D", 1280, 720);
            b.opengl().fullscreen_desktop();
            b
        } else {
            let mut b = video.window("Fanny Pinball 3D", 920, 1020);
            b.opengl().position_centered().resizable();
            b
        };
        wb.build().map_err(|e| e.to_string())
    };

    let mut window = match build_win(cli.fullscreen) {
        Ok(w) => w,
        Err(_) => {
            // Repli sans MSAA si non supporté par le pilote
            gl_attr.set_multisample_buffers(0);
            gl_attr.set_multisample_samples(0);
            build_win(cli.fullscreen)?
        }
    };
    let _gl_ctx = window.gl_create_context()?;
    let _ = video.gl_set_swap_interval(SwapInterval::VSync);

    let mut fullscreen = cli.fullscreen;
    if fullscreen {
        sdl.mouse().show_cursor(false);
    }

    let gl = Gl::load(&video)?;
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(42);

    let geo = TableGeo::build();
    let mut sim = Sim::new(geo, cfg.slope_deg, seed);
    let mut rules = Rules::new(seed ^ 0x9e37_79b9_7f4a_7c15);
    rules.high_score = cfg.high_score;

    let mut audio = Audio::init(Path::new(&assets_dir));
    if cfg.muted {
        audio.toggle_mute();
    }
    let mut renderer = Renderer3D::new(gl, &sim.geo, Path::new(&assets_dir))?;
    if cli.cam_haute {
        renderer.cam.mode = CameraMode::Haute;
    }

    let mut events = sdl.event_pump()?;
    let mut paused = false;
    let mut show_fps = cli.show_fps;
    let mut pull_start: Option<Instant> = None;
    let mut dragging = false;

    let start_instant = Instant::now();
    let mut last_frame = start_instant;
    let mut fps_timer = start_instant;
    let mut fps_frames = 0u32;
    let mut last_saved_hs = rules.high_score;

    'running: loop {
        let now = Instant::now();
        let dt_s = now.duration_since(last_frame).as_secs_f32().clamp(0.0005, 0.05);
        last_frame = now;
        let now_ms = now.duration_since(start_instant).as_millis() as u64;

        let en_lilli = renderer.cam.mode == CameraMode::Lilliputien;

        for ev in events.poll_iter() {
            match ev {
                Event::Quit { .. } => break 'running,
                Event::MouseButtonDown { mouse_btn: MouseButton::Left, .. } => dragging = true,
                Event::MouseButtonUp { mouse_btn: MouseButton::Left, .. } => dragging = false,
                Event::MouseMotion { xrel, yrel, .. } if dragging => {
                    let (dx, dy) = match cfg.rot_deg {
                        90 => (yrel as f32, -xrel as f32),
                        -90 => (-yrel as f32, xrel as f32),
                        _ => (xrel as f32, yrel as f32),
                    };
                    renderer.mouse_drag(dx, dy);
                }
                Event::MouseWheel { y, .. } => renderer.mouse_wheel(y as f32),
                Event::KeyDown { scancode: Some(sc), repeat: false, .. } => {
                    if sc == Scancode::Q {
                        break 'running;
                    }
                    if sc == Scancode::G {
                        renderer.cam.mode = if en_lilli { CameraMode::Joueur } else { CameraMode::Lilliputien };
                        continue;
                    }
                    if en_lilli {
                        if sc == Scancode::Escape {
                            renderer.cam.mode = CameraMode::Joueur;
                            continue;
                        }
                        if sc == Scancode::R {
                            renderer.cam.lilli_pos = math3d::Vec3::new(table::CX, table::H - 150.0, 42.0);
                            renderer.cam.lilli_yaw = 0.0;
                            renderer.cam.lilli_pitch = -0.10;
                            continue;
                        }
                    }
                    if sc == Scancode::Escape {
                        if fullscreen {
                            fullscreen = false;
                            let _ = window.set_fullscreen(FullscreenType::Off);
                            sdl.mouse().show_cursor(true);
                        } else {
                            break 'running;
                        }
                        continue;
                    }
                    if sc == Scancode::F || sc == Scancode::F11 {
                        fullscreen = !fullscreen;
                        let mode = if fullscreen { FullscreenType::Desktop } else { FullscreenType::Off };
                        let _ = window.set_fullscreen(mode);
                        sdl.mouse().show_cursor(!fullscreen);
                        continue;
                    }
                    if sc == Scancode::O {
                        cfg.rot_deg = match cfg.rot_deg { 0 => 90, 90 => -90, _ => 0 };
                        save_config(&cfg);
                        continue;
                    }
                    if sc == Scancode::K {
                        renderer.cam.mode = renderer.cam.mode.next();
                        continue;
                    }
                    if sc == Scancode::P {
                        paused = !paused;
                        continue;
                    }
                    if sc == Scancode::M {
                        cfg.muted = audio.toggle_mute();
                        save_config(&cfg);
                        continue;
                    }
                    if sc == Scancode::I {
                        show_fps = !show_fps;
                        continue;
                    }
                    if sc == Scancode::Equals || sc == Scancode::KpPlus {
                        cfg.slope_deg = sim.set_slope(sim.slope_deg + 0.5);
                        save_config(&cfg);
                        continue;
                    }
                    if sc == Scancode::Minus || sc == Scancode::KpMinus {
                        cfg.slope_deg = sim.set_slope(sim.slope_deg - 0.5);
                        save_config(&cfg);
                        continue;
                    }

                    if en_lilli {
                        continue;
                    }
                    if is_coin(sc) {
                        rules.on_switch(Switch::Coin, true);
                        continue;
                    }
                    if is_start(sc) && rules.can_start() {
                        paused = false;
                        sim.clear();
                        rules.on_switch(Switch::Start, true);
                        continue;
                    }
                    if paused {
                        continue;
                    }
                    if is_left(sc) {
                        if !sim.held_l {
                            sim.held_l = true;
                            audio.play(snd::FLIP);
                            rules.on_switch(Switch::FlipL, true);
                        }
                    } else if is_right(sc) {
                        if !sim.held_r {
                            sim.held_r = true;
                            audio.play(snd::FLIP);
                            rules.on_switch(Switch::FlipR, true);
                        }
                    } else if is_launch(sc) {
                        if pull_start.is_none() {
                            pull_start = Some(now);
                        }
                    } else if sc == Scancode::Up || sc == Scancode::Space {
                        if rules.mode == GameMode::Play && sim.nudge(0) {
                            audio.play(snd::NUDGE);
                        }
                    } else if sc == Scancode::LCtrl {
                        if rules.mode == GameMode::Play && sim.nudge(-1) {
                            audio.play(snd::NUDGE);
                        }
                    } else if sc == Scancode::RCtrl {
                        if rules.mode == GameMode::Play && sim.nudge(1) {
                            audio.play(snd::NUDGE);
                        }
                    }
                }
                Event::KeyUp { scancode: Some(sc), .. } => {
                    if is_left(sc) {
                        sim.held_l = false;
                    } else if is_right(sc) {
                        sim.held_r = false;
                    } else if is_launch(sc) {
                        if let Some(t0) = pull_start.take() {
                            let p = (now.duration_since(t0).as_secs_f32() / TIRAGE_S).clamp(0.0, 1.0);
                            sim.tirage = 0.0;
                            sim.force = 0.3 + 0.8 * p;
                            rules.on_switch(Switch::Launch, true);
                        }
                    }
                }
                _ => {}
            }
        }

        // Déplacement libre en mode Promenade Lilliputien
        if renderer.cam.mode == CameraMode::Lilliputien {
            let kb = events.keyboard_state();
            let mut fwd = 0.0f32;
            let mut right = 0.0f32;
            let mut up = 0.0f32;
            if kb.is_scancode_pressed(Scancode::W) || kb.is_scancode_pressed(Scancode::Up) { fwd += 1.0; }
            if kb.is_scancode_pressed(Scancode::S) || kb.is_scancode_pressed(Scancode::Down) { fwd -= 1.0; }
            if kb.is_scancode_pressed(Scancode::D) || kb.is_scancode_pressed(Scancode::Right) { right += 1.0; }
            if kb.is_scancode_pressed(Scancode::A) || kb.is_scancode_pressed(Scancode::Left) { right -= 1.0; }
            if kb.is_scancode_pressed(Scancode::Space) || kb.is_scancode_pressed(Scancode::E) { up += 1.0; }
            if kb.is_scancode_pressed(Scancode::C) || kb.is_scancode_pressed(Scancode::LCtrl) { up -= 1.0; }
            let sprint = kb.is_scancode_pressed(Scancode::LShift) || kb.is_scancode_pressed(Scancode::RShift);
            renderer.update_lilliputien(dt_s, fwd, right, up, sprint);
        }

        if !paused {
            if let Some(t0) = pull_start {
                sim.tirage = (now.duration_since(t0).as_secs_f32() / TIRAGE_S).clamp(0.0, 1.0);
            } else {
                sim.tirage = 0.0;
            }
            sim.step(dt_s);
            for (sw, closed) in sim.drain_events() {
                rules.on_switch(sw, closed);
            }
            rules.tick(now_ms);
            for c in rules.out.coils.drain(..) {
                sim.coil(c);
            }
            for s in rules.out.sounds.drain(..) {
                audio.play(s);
            }
            audio.set_music(rules.mode == GameMode::Play || rules.mode == GameMode::Bonus);
            if rules.high_score > last_saved_hs {
                last_saved_hs = rules.high_score;
                cfg.high_score = last_saved_hs;
                save_config(&cfg);
            }
        }

        let (win_w, win_h) = window.drawable_size();
        renderer.render(win_w, win_h, &sim, &rules, cfg.rot_deg);
        window.gl_swap_window();

        fps_frames += 1;
        if now.duration_since(fps_timer) >= Duration::from_secs(1) {
            let title = if show_fps {
                format!(
                    "Fanny Pinball 3D — {} | Pente {:.1}° | {} FPS{}",
                    renderer.cam.mode.label(),
                    sim.slope_deg,
                    fps_frames,
                    if paused { " [PAUSE]" } else { "" }
                )
            } else {
                format!(
                    "Fanny Pinball 3D — {} | Pente {:.1}°{}",
                    renderer.cam.mode.label(),
                    sim.slope_deg,
                    if paused { " [PAUSE]" } else { "" }
                )
            };
            let _ = window.set_title(&title);
            fps_frames = 0;
            fps_timer = now;
        }
    }

    save_config(&cfg);
    Ok(())
}
