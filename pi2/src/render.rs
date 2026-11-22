//! Rendu 2D accéléré matériellement (SDL2 / OpenGL ES 2.0 / KMSDRM) pour Raspberry Pi 2 Model B.
//!
//! Architecture optimisée Pi 2 B (< 10 % CPU, 60 FPS constants) :
//!   - Le fond statique (illustration `assets/plateau.jpg` + murs, guides, plastiques, étiquettes)
//!     et le calque supérieur (rampe translucide + tablier) sont pré-rendus UNE SEULE FOIS au démarrage.
//!   - Les sprites (bille acier, batteurs, bumpers, 32 inserts lumineux, cibles) sont générés en
//!     RGBA anti-aliasé une seule fois puis envoyés au GPU.
//!   - Chaque image dessine ~50 quads dans une texture cible (`514 × 1351`) puis l'affiche en un seul
//!     `copy_ex` GPU avec rotation matérielle `0° / +90° / -90°`.

use std::path::Path;

use sdl2::image::LoadTexture;
use sdl2::pixels::{Color, PixelFormatEnum};
use sdl2::rect::{Point, Rect};
use sdl2::render::{BlendMode, Canvas, Texture, TextureCreator};
use sdl2::video::{Window, WindowContext};

use crate::rules::{FannyPose, GameMode, Rules};
use crate::sim::{BallMode, Sim};
use crate::table::{TableGeo, Vec2, BALL_R, CX, H, PLAY_R, W};

pub const HUD_H: u32 = 88;
pub const FRAME_W: u32 = 514;
pub const FRAME_H: u32 = 1263 + HUD_H; // 1351

// ============================================================================
// Buffer RGBA logiciel utilisé UNE SEULE FOIS au démarrage pour générer des sprites nets
// ============================================================================

struct RgbaBuf {
    w: usize,
    h: usize,
    data: Vec<u8>,
}

impl RgbaBuf {
    fn new(w: usize, h: usize) -> Self {
        Self {
            w,
            h,
            data: vec![0u8; w * h * 4],
        }
    }

    #[inline]
    fn blend_px(&mut self, x: i32, y: i32, r: u8, g: u8, b: u8, a: u8) {
        if x < 0 || y < 0 || x >= self.w as i32 || y >= self.h as i32 || a == 0 {
            return;
        }
        let idx = ((y as usize) * self.w + (x as usize)) * 4;
        if a == 255 {
            self.data[idx] = r;
            self.data[idx + 1] = g;
            self.data[idx + 2] = b;
            self.data[idx + 3] = 255;
            return;
        }
        let sa = a as f32 / 255.0;
        let da = self.data[idx + 3] as f32 / 255.0;
        let out_a = sa + da * (1.0 - sa);
        if out_a <= 1e-5 {
            return;
        }
        let inv = (1.0 - sa) * da;
        self.data[idx] = ((r as f32 * sa + self.data[idx] as f32 * inv) / out_a) as u8;
        self.data[idx + 1] = ((g as f32 * sa + self.data[idx + 1] as f32 * inv) / out_a) as u8;
        self.data[idx + 2] = ((b as f32 * sa + self.data[idx + 2] as f32 * inv) / out_a) as u8;
        self.data[idx + 3] = (out_a * 255.0).min(255.0) as u8;
    }

    fn fill_rect(&mut self, x0: i32, y0: i32, w: i32, h: i32, col: (u8, u8, u8, u8)) {
        for y in y0..(y0 + h) {
            for x in x0..(x0 + w) {
                self.blend_px(x, y, col.0, col.1, col.2, col.3);
            }
        }
    }

    fn fill_circle_aa(&mut self, cx: f32, cy: f32, r: f32, col: (u8, u8, u8, u8)) {
        let min_x = ((cx - r - 1.5).floor() as i32).max(0);
        let max_x = ((cx + r + 1.5).ceil() as i32).min(self.w as i32 - 1);
        let min_y = ((cy - r - 1.5).floor() as i32).max(0);
        let max_y = ((cy + r + 1.5).ceil() as i32).min(self.h as i32 - 1);
        for y in min_y..=max_y {
            for x in min_x..=max_x {
                let d = (x as f32 + 0.5 - cx).hypot(y as f32 + 0.5 - cy);
                if d < r + 0.8 {
                    let cov = ((r + 0.6 - d) / 1.2).clamp(0.0, 1.0);
                    let a = (col.3 as f32 * cov) as u8;
                    self.blend_px(x, y, col.0, col.1, col.2, a);
                }
            }
        }
    }

    fn stroke_circle_aa(&mut self, cx: f32, cy: f32, r: f32, width: f32, col: (u8, u8, u8, u8)) {
        let hw = width * 0.5;
        let outer = r + hw;
        let min_x = ((cx - outer - 1.5).floor() as i32).max(0);
        let max_x = ((cx + outer + 1.5).ceil() as i32).min(self.w as i32 - 1);
        let min_y = ((cy - outer - 1.5).floor() as i32).max(0);
        let max_y = ((cy + outer + 1.5).ceil() as i32).min(self.h as i32 - 1);
        for y in min_y..=max_y {
            for x in min_x..=max_x {
                let d = ((x as f32 + 0.5 - cx).hypot(y as f32 + 0.5 - cy) - r).abs();
                if d < hw + 0.8 {
                    let cov = ((hw + 0.6 - d) / 1.2).clamp(0.0, 1.0);
                    let a = (col.3 as f32 * cov) as u8;
                    self.blend_px(x, y, col.0, col.1, col.2, a);
                }
            }
        }
    }

    fn fill_capsule_aa(&mut self, a: Vec2, b: Vec2, r: f32, col: (u8, u8, u8, u8)) {
        let min_x = ((a.x.min(b.x) - r - 1.5).floor() as i32).max(0);
        let max_x = ((a.x.max(b.x) + r + 1.5).ceil() as i32).min(self.w as i32 - 1);
        let min_y = ((a.y.min(b.y) - r - 1.5).floor() as i32).max(0);
        let max_y = ((a.y.max(b.y) + r + 1.5).ceil() as i32).min(self.h as i32 - 1);
        let ab = b.sub(a);
        let ab2 = ab.dot(ab).max(1e-6);
        for y in min_y..=max_y {
            for x in min_x..=max_x {
                let p = Vec2::new(x as f32 + 0.5, y as f32 + 0.5);
                let t = (p.sub(a).dot(ab) / ab2).clamp(0.0, 1.0);
                let q = a.add(ab.scale(t));
                let d = p.sub(q).len();
                if d < r + 0.8 {
                    let cov = ((r + 0.6 - d) / 1.2).clamp(0.0, 1.0);
                    let alpha = (col.3 as f32 * cov) as u8;
                    self.blend_px(x, y, col.0, col.1, col.2, alpha);
                }
            }
        }
    }

    fn fill_poly(&mut self, pts: &[Vec2], col: (u8, u8, u8, u8)) {
        if pts.len() < 3 {
            return;
        }
        let mut min_y = f32::MAX;
        let mut max_y = f32::MIN;
        for p in pts {
            min_y = min_y.min(p.y);
            max_y = max_y.max(p.y);
        }
        let y0 = (min_y.floor() as i32).max(0);
        let y1 = (max_y.ceil() as i32).min(self.h as i32 - 1);
        let mut xs = Vec::new();
        for y in y0..=y1 {
            let fy = y as f32 + 0.5;
            xs.clear();
            let n = pts.len();
            for i in 0..n {
                let a = pts[i];
                let b = pts[(i + 1) % n];
                if (a.y <= fy && b.y > fy) || (b.y <= fy && a.y > fy) {
                    let t = (fy - a.y) / (b.y - a.y);
                    xs.push(a.x + t * (b.x - a.x));
                }
            }
            xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let mut k = 0;
            while k + 1 < xs.len() {
                let x_start = (xs[k].ceil() as i32).max(0);
                let x_end = (xs[k + 1].floor() as i32).min(self.w as i32 - 1);
                for x in x_start..=x_end {
                    self.blend_px(x, y, col.0, col.1, col.2, col.3);
                }
                k += 2;
            }
        }
    }

    fn draw_text_5x7(&mut self, cx: i32, cy: i32, scale: i32, text: &str, col: (u8, u8, u8, u8), centered: bool) {
        let chars: Vec<char> = text.chars().collect();
        let step = 6 * scale;
        let total_w = if chars.is_empty() { 0 } else { chars.len() as i32 * step - scale };
        let start_x = if centered { cx - total_w / 2 } else { cx };
        let start_y = if centered { cy - (7 * scale) / 2 } else { cy };
        for (idx, ch) in chars.iter().enumerate() {
            let glyph = glyph_5x7(*ch);
            let gx = start_x + idx as i32 * step;
            for (row, &bits) in glyph.iter().enumerate() {
                for bit in 0..5 {
                    if (bits >> (4 - bit)) & 1 != 0 {
                        self.fill_rect(
                            gx + bit * scale,
                            start_y + row as i32 * scale,
                            scale,
                            scale,
                            col,
                        );
                    }
                }
            }
        }
    }

    fn to_texture<'r>(&self, tc: &'r TextureCreator<WindowContext>) -> Result<Texture<'r>, String> {
        let mut tex = tc
            .create_texture_static(PixelFormatEnum::ABGR8888, self.w as u32, self.h as u32)
            .map_err(|e| e.to_string())?;
        tex.set_blend_mode(BlendMode::Blend);
        tex.update(None, &self.data, self.w * 4)
            .map_err(|e| e.to_string())?;
        Ok(tex)
    }
}

// ============================================================================
// Rendu principal SDL2
// ============================================================================

pub struct Renderer<'r> {
    frame_tex: Texture<'r>,
    bg_tex: Texture<'r>,
    ramp_apron_tex: Texture<'r>,
    ball_tex: Texture<'r>,
    flipper_l_tex: Texture<'r>,
    flipper_r_tex: Texture<'r>,
    bumper_idle_tex: Texture<'r>,
    bumper_hit_tex: Texture<'r>,
    drop_tex: Texture<'r>,
    standup_tex: Texture<'r>,
    standup_hit_tex: Texture<'r>,
    lamp_off: Vec<Texture<'r>>,
    lamp_on: Vec<Texture<'r>>,
    fanny_victoire: Option<Texture<'r>>,
    fanny_lancer: Option<Texture<'r>>,
    fanny_show: Option<(FannyPose, u64, u64)>,
}

impl<'r> Renderer<'r> {
    pub fn new(
        canvas: &mut Canvas<Window>,
        tc: &'r TextureCreator<WindowContext>,
        geo: &TableGeo,
        assets_dir: &Path,
    ) -> Result<Self, String> {
        let mut frame_tex = tc
            .create_texture_target(PixelFormatEnum::ABGR8888, FRAME_W, FRAME_H)
            .map_err(|e| e.to_string())?;
        frame_tex.set_blend_mode(BlendMode::Blend);

        // 1. Fond statique (plateau.jpg + décors fixes)
        let mut bg_tex = tc
            .create_texture_target(PixelFormatEnum::ABGR8888, W as u32, H as u32)
            .map_err(|e| e.to_string())?;
        let plateau_img = tc.load_texture(assets_dir.join("plateau.jpg")).ok();
        let bg_overlay = build_static_overlay(geo, plateau_img.is_some()).to_texture(tc)?;
        canvas
            .with_texture_canvas(&mut bg_tex, |c| {
                c.set_draw_color(Color::RGB(0x2b, 0x1a, 0x10));
                c.clear();
                if let Some(ref img) = plateau_img {
                    let _ = c.copy(img, None, Rect::new(0, 0, W as u32, H as u32));
                }
                let _ = c.copy(&bg_overlay, None, None);
            })
            .map_err(|e| format!("{e:?}"))?;

        // 2. Calque supérieur : rampe translucide + enseigne ESCALE + tablier (apron)
        let ramp_apron_tex = build_ramp_and_apron(geo).to_texture(tc)?;

        // 3. Sprites dynamiques pré-générés
        let ball_tex = build_ball_sprite().to_texture(tc)?;
        let flipper_l_tex = build_flipper_sprite(true, geo.flippers[0]).to_texture(tc)?;
        let flipper_r_tex = build_flipper_sprite(false, geo.flippers[1]).to_texture(tc)?;
        let bumper_idle_tex = build_bumper_sprite(false).to_texture(tc)?;
        let bumper_hit_tex = build_bumper_sprite(true).to_texture(tc)?;
        let drop_tex = build_drop_sprite().to_texture(tc)?;
        let standup_tex = build_standup_sprite(false).to_texture(tc)?;
        let standup_hit_tex = build_standup_sprite(true).to_texture(tc)?;

        // 4. 32 pastilles lumineuses (éteintes & allumées)
        let mut lamp_off = Vec::with_capacity(geo.lamps.len());
        let mut lamp_on = Vec::with_capacity(geo.lamps.len());
        for lamp in &geo.lamps {
            lamp_off.push(build_lamp_sprite(lamp.r, lamp.rgb, lamp.inner_label, false).to_texture(tc)?);
            lamp_on.push(build_lamp_sprite(lamp.r, lamp.rgb, lamp.inner_label, true).to_texture(tc)?);
        }

        // 5. Illustrations Fanny (optionnelles)
        let fanny_victoire = tc.load_texture(assets_dir.join("fanny_victoire.png")).ok();
        let fanny_lancer = tc.load_texture(assets_dir.join("fanny_lancer.png")).ok();

        Ok(Self {
            frame_tex,
            bg_tex,
            ramp_apron_tex,
            ball_tex,
            flipper_l_tex,
            flipper_r_tex,
            bumper_idle_tex,
            bumper_hit_tex,
            drop_tex,
            standup_tex,
            standup_hit_tex,
            lamp_off,
            lamp_on,
            fanny_victoire,
            fanny_lancer,
            fanny_show: None,
        })
    }

    pub fn trigger_fanny(&mut self, pose: FannyPose, now_ms: u64) {
        self.fanny_show = Some((pose, now_ms, 2200));
    }

    pub fn render(
        &mut self,
        canvas: &mut Canvas<Window>,
        sim: &Sim,
        rules: &Rules,
        rot_deg: i32,
        paused: bool,
        muted: bool,
        fps: Option<u32>,
    ) -> Result<(), String> {
        let now_ms = rules.now_ms;
        let lamps = rules.lamps();
        let (disp_score, disp_info) = rules.display();
        let blink_on = (now_ms / 180) % 2 == 0;
        let oy = HUD_H as i32;

        // 1. Rendu complet dans `frame_tex` (514 × 1351)
        canvas
            .with_texture_canvas(&mut self.frame_tex, |c| {
                c.set_draw_color(Color::RGB(0x16, 0x0c, 0x06));
                c.clear();

                // --- Bandeau fronton (0..HUD_H) ---
                draw_hud(
                    c,
                    &disp_score,
                    &disp_info,
                    sim.slope_deg,
                    paused,
                    muted,
                    rules.mode == GameMode::Attract,
                    fps,
                );

                // --- Fond statique du plateau ---
                let _ = c.copy(&self.bg_tex, None, Rect::new(0, oy, W as u32, H as u32));

                // --- 32 inserts lumineux ---
                for (i, lamp) in sim.geo.lamps.iter().enumerate() {
                    let st = lamps[i];
                    let lit = st == 1 || (st == 2 && blink_on);
                    let tex = if lit { &self.lamp_on[i] } else { &self.lamp_off[i] };
                    let sz = (lamp.r * 2.0).ceil() as u32 + 10;
                    let x = (lamp.pos.x - sz as f32 * 0.5).round() as i32;
                    let y = oy + (lamp.pos.y - sz as f32 * 0.5).round() as i32;
                    let _ = c.copy(tex, None, Rect::new(x, y, sz, sz));
                }

                // --- 10 fils de rollover (4 haut T-O-U-R + 6 bas) ---
                for (i, lane) in sim.geo.lanes.iter().enumerate() {
                    draw_rollover(c, lane.pos, oy, sim.rollover_down[i]);
                }
                for (i, lane) in sim.geo.lower_lanes.iter().enumerate() {
                    draw_rollover(c, lane.pos, oy, sim.rollover_down[4 + i]);
                }

                // --- Flash des lance-pierres ---
                for (i, sl) in sim.geo.slings.iter().enumerate() {
                    if now_ms.saturating_sub(sim.flash.sling[i]) < 130 {
                        c.set_draw_color(Color::RGB(0xff, 0xe8, 0x70));
                        let _ = c.draw_line(
                            Point::new(sl.face_a.x as i32, oy + sl.face_a.y as i32),
                            Point::new(sl.face_c.x as i32, oy + sl.face_c.y as i32),
                        );
                    }
                }

                // --- Cibles tombantes F-A-N-N-Y ---
                for (i, d) in sim.geo.drops.iter().enumerate() {
                    if !sim.drops_up[i] {
                        continue;
                    }
                    let dst = Rect::new(
                        (d.pos.x - 13.0) as i32,
                        oy + (d.pos.y - 6.0) as i32,
                        26,
                        12,
                    );
                    let _ = c.copy_ex(
                        &self.drop_tex,
                        None,
                        dst,
                        (d.angle as f64).to_degrees(),
                        None,
                        false,
                        false,
                    );
                }

                // --- 3 cibles rondes du mur gauche ---
                for (i, lt) in sim.geo.left_targets.iter().enumerate() {
                    let lit = now_ms.saturating_sub(sim.flash.target[i]) < 160 || rules.targets[i];
                    c.set_draw_color(if lit {
                        Color::RGB(0xff, 0x5c, 0xb8)
                    } else {
                        Color::RGB(0xd0, 0x35, 0x80)
                    });
                    let _ = c.fill_rect(Rect::new(
                        (lt.pos.x - 4.0) as i32,
                        oy + (lt.pos.y - 16.0) as i32,
                        8,
                        32,
                    ));
                }

                // --- Cibles fixes (POINTER, TIRER, BOUCHON) ---
                for (i, st) in sim.geo.standups.iter().enumerate() {
                    let hit = now_ms.saturating_sub(sim.flash.standup[i]) < 160;
                    let sz = (st.r * 2.0 + 4.0) as u32;
                    let tex = if hit { &self.standup_hit_tex } else { &self.standup_tex };
                    let _ = c.copy(
                        tex,
                        None,
                        Rect::new(
                            (st.pos.x - sz as f32 * 0.5) as i32,
                            oy + (st.pos.y - sz as f32 * 0.5) as i32,
                            sz,
                            sz,
                        ),
                    );
                }

                // --- Bumpers (boules) ---
                for (i, bmp) in sim.geo.bumpers.iter().enumerate() {
                    let hit = now_ms.saturating_sub(sim.flash.bumper[i]) < 120;
                    let tex = if hit { &self.bumper_hit_tex } else { &self.bumper_idle_tex };
                    let sz = if hit { 76 } else { 72 };
                    let _ = c.copy(
                        tex,
                        None,
                        Rect::new(
                            (bmp.pos.x - sz as f32 * 0.5) as i32,
                            oy + (bmp.pos.y - sz as f32 * 0.5) as i32,
                            sz,
                            sz,
                        ),
                    );
                }

                // --- Tourniquet (spinner) ---
                draw_spinner(c, &sim.geo, sim.spinner_angle, oy);

                // --- Lanceur mécanique (ressort + tige) ---
                draw_plunger(c, &sim.geo, sim.tirage, oy);

                // --- Batteurs (flippers) ---
                for fi in 0..2 {
                    let def = sim.geo.flippers[fi];
                    let ang_deg = (sim.flippers[fi].angle as f64).to_degrees();
                    let (tex, piv_x, piv_y) = if def.is_left {
                        (&self.flipper_l_tex, 16, 18)
                    } else {
                        (&self.flipper_r_tex, 80, 18)
                    };
                    let dst = Rect::new(
                        def.pivot.x.round() as i32 - piv_x,
                        oy + def.pivot.y.round() as i32 - piv_y,
                        96,
                        36,
                    );
                    let _ = c.copy_ex(tex, None, dst, ang_deg, Some(Point::new(piv_x, piv_y)), false, false);
                }

                // --- Billes sur le plateau (sous la rampe et le tablier) ---
                for b in &sim.balls {
                    if matches!(b.mode, BallMode::Table | BallMode::Saucer) {
                        let sz = if b.mode == BallMode::Saucer { 28 } else { 32 };
                        let _ = c.copy(
                            &self.ball_tex,
                            None,
                            Rect::new(
                                (b.pos.x - sz as f32 * 0.5).round() as i32,
                                oy + (b.pos.y - sz as f32 * 0.5).round() as i32,
                                sz,
                                sz,
                            ),
                        );
                    }
                }

                // --- Calque supérieur : rampe translucide + enseigne + tablier ---
                let _ = c.copy(&self.ramp_apron_tex, None, Rect::new(0, oy, W as u32, H as u32));

                // --- Billes SUR la rampe (légèrement agrandies par l'altitude) ---
                for b in &sim.balls {
                    if let BallMode::Ramp { .. } = b.mode {
                        let sz = (32.0 + b.z * 0.12).round() as u32;
                        let _ = c.copy(
                            &self.ball_tex,
                            None,
                            Rect::new(
                                (b.pos.x - sz as f32 * 0.5).round() as i32,
                                oy + (b.pos.y - sz as f32 * 0.5).round() as i32,
                                sz,
                                sz,
                            ),
                        );
                    }
                }

                // --- Popup Fanny (victoire / lancer) ---
                if let Some((pose, t0, dur)) = self.fanny_show {
                    let el = now_ms.saturating_sub(t0);
                    if el < dur {
                        let tex = match pose {
                            FannyPose::Victoire => self.fanny_victoire.as_ref(),
                            FannyPose::Lancer => self.fanny_lancer.as_ref(),
                        };
                        if let Some(t) = tex {
                            let slide = if el < 220 {
                                el as f32 / 220.0
                            } else if el > dur - 300 {
                                (dur - el) as f32 / 300.0
                            } else {
                                1.0
                            };
                            let w = 156u32;
                            let h = 210u32;
                            let x = (-160.0 + 168.0 * slide) as i32;
                            let y = oy + (H as i32) - (h as i32) - 110;
                            let _ = c.copy(t, None, Rect::new(x, y, w, h));
                        }
                    }
                }

                // --- Voile PAUSE ---
                if paused {
                    c.set_blend_mode(BlendMode::Blend);
                    c.set_draw_color(Color::RGBA(0, 0, 0, 145));
                    let _ = c.fill_rect(Rect::new(0, oy, W as u32, H as u32));
                    draw_led_string(c, "PAUSE", (FRAME_W as i32 - 5 * 34) / 2, oy + 540, 26, 44, Color::RGB(0xff, 0xd2, 0x3f));
                }
            })
            .map_err(|e| format!("{e:?}"))?;

        if let Some((_, t0, dur)) = self.fanny_show {
            if now_ms.saturating_sub(t0) >= dur {
                self.fanny_show = None;
            }
        }

        // 2. Affichage final sur l'écran physique avec rotation matérielle 0° / +90° / -90°
        let (win_w, win_h) = canvas.output_size().map_err(|e| e.to_string())?;
        canvas.set_draw_color(Color::RGB(0x0d, 0x07, 0x04));
        canvas.clear();

        let rotated = rot_deg == 90 || rot_deg == -90;
        let (vis_w, vis_h) = if rotated {
            (FRAME_H as f32, FRAME_W as f32)
        } else {
            (FRAME_W as f32, FRAME_H as f32)
        };
        let scale = (win_w as f32 / vis_w).min(win_h as f32 / vis_h);
        let dw = (FRAME_W as f32 * scale).round().max(1.0) as u32;
        let dh = (FRAME_H as f32 * scale).round().max(1.0) as u32;

        // Secousse visuelle du bourrage
        let mut sx = 0i32;
        let mut sy = 0i32;
        let shake_el = sim.time_ms.saturating_sub(sim.shake_at_ms);
        if shake_el < 140 {
            let k = 1.0 - (shake_el as f32 / 140.0);
            let mag = (6.0 * k * scale).round() as i32;
            let (lx, ly) = if sim.shake_dx != 0 {
                (-sim.shake_dx * mag, 0)
            } else {
                (0, -mag)
            };
            match rot_deg {
                90 => { sx = -ly; sy = lx; }
                -90 => { sx = ly; sy = -lx; }
                _ => { sx = lx; sy = ly; }
            }
        }

        let dst = Rect::new(
            (win_w as i32 - dw as i32) / 2 + sx,
            (win_h as i32 - dh as i32) / 2 + sy,
            dw,
            dh,
        );
        canvas.copy_ex(&self.frame_tex, None, dst, rot_deg as f64, None, false, false)?;
        canvas.present();
        Ok(())
    }
}

// ============================================================================
// Générateurs de textures statiques et sprites (exécutés 1× au démarrage)
// ============================================================================

fn build_static_overlay(geo: &TableGeo, has_art: bool) -> RgbaBuf {
    let mut b = RgbaBuf::new(W as usize, H as usize);

    // Si pas d'illustration plateau.jpg, dessiner un terrain de boules provençal
    if !has_art {
        b.fill_rect(0, 0, W as i32, H as i32, (0xd8, 0xb6, 0x79, 255));
        let mut seed = 7u64;
        for _ in 0..6000 {
            seed = (seed.wrapping_mul(16807)) % 2_147_483_647;
            let x = (seed % W as u64) as f32;
            seed = (seed.wrapping_mul(16807)) % 2_147_483_647;
            let y = (seed % H as u64) as f32;
            let dark = (seed & 1) == 0;
            let col = if dark { (0xb8, 0x93, 0x5a, 140) } else { (0xef, 0xd7, 0xa5, 140) };
            b.fill_circle_aa(x, y, 1.3, col);
        }
        b.fill_rect(
            (PLAY_R + 4.0) as i32,
            geo.lane_sep_y1 as i32,
            (W - PLAY_R - 4.0) as i32,
            H as i32,
            (0x1e, 0x0f, 0x05, 95),
        );
        b.draw_text_5x7(CX as i32, (H - 305.0) as i32, 4, "FANNY", (0x1f, 0x4e, 0x8c, 255), true);
        b.draw_text_5x7(CX as i32, (H - 275.0) as i32, 1, "PETANQUE WORLD TOUR", (0x1f, 0x4e, 0x8c, 255), true);
    }

    // Masque bois à l'extérieur de l'arrondi supérieur du plateau
    for y in 0..(geo.ellipse_cy as usize + 2) {
        for x in 0..(W as usize) {
            let dx = (x as f32 + 0.5 - geo.ellipse_cx) / geo.ellipse_rx;
            let dy = (y as f32 + 0.5 - geo.ellipse_cy) / geo.ellipse_ry;
            if dy < 0.0 && dx * dx + dy * dy > 1.0 {
                b.blend_px(x as i32, y as i32, 0x2b, 0x1a, 0x10, 255);
            }
        }
    }

    // Couloir de lancement légèrement ombré
    b.fill_rect(
        (PLAY_R + 4.0) as i32,
        geo.lane_sep_y1 as i32,
        (W - PLAY_R - 4.0) as i32,
        (H - geo.lane_sep_y1) as i32,
        (0x14, 0x0a, 0x04, 110),
    );

    // Le Cercle (trou d'éjection + anneau blanc)
    b.stroke_circle_aa(geo.saucer.pos.x, geo.saucer.pos.y, 30.0, 2.8, (0xff, 0xf4, 0xdc, 235));
    b.fill_circle_aa(geo.saucer.pos.x, geo.saucer.pos.y, geo.saucer.ring, (0x1a, 0x12, 0x0c, 240));
    b.stroke_circle_aa(geo.saucer.pos.x, geo.saucer.pos.y, geo.saucer.ring, 2.2, (0xd0, 0xd4, 0xdc, 255));
    b.fill_circle_aa(geo.saucer.pos.x, geo.saucer.pos.y, 11.0, (0x08, 0x06, 0x05, 255));
    b.draw_text_5x7(geo.saucer.pos.x as i32, (geo.saucer.pos.y - 40.0) as i32, 1, "LE CERCLE", (0xff, 0xf4, 0xdc, 245), true);

    // Pièces plastiques moulées (bouchon, tirer, blocs derrière F-A-N-N-Y et mur gauche)
    let plastic_fill = (0x2f, 0x2c, 0x62, 235);
    let plastic_rim = (0xe9, 0xb4, 0x4c, 220);
    for poly in [
        &geo.bouchon_piece,
        &geo.tirer_plastic,
        &geo.drop_housing,
        &geo.left_wall_housing,
    ] {
        b.fill_poly(poly, plastic_fill);
        for i in 0..poly.len() {
            b.fill_capsule_aa(poly[i], poly[(i + 1) % poly.len()], 1.4, plastic_rim);
        }
    }

    // Lance-pierres (caoutchouc blanc + capot bleu/or)
    for sl in &geo.slings {
        b.fill_poly(&sl.poly, (0xf0, 0xed, 0xe4, 245));
        for i in 0..3 {
            b.fill_capsule_aa(sl.posts[i], sl.posts[(i + 1) % 3], sl.r_rub, (0xf0, 0xed, 0xe4, 245));
        }
        b.fill_poly(&sl.posts, (0x2a, 0x3c, 0x7c, 255));
        for p in sl.posts {
            b.fill_circle_aa(p.x, p.y, 5.0, (0xd8, 0xdc, 0xe2, 255));
            b.fill_circle_aa(p.x, p.y, 2.2, (0x60, 0x66, 0x72, 255));
        }
    }

    // Guides métalliques & chromes
    let chrome = (0xd6, 0xd9, 0xdf, 255);
    let chrome_dark = (0x6a, 0x70, 0x7a, 255);
    // Séparateur de couloir de lancement
    b.fill_capsule_aa(
        Vec2::new(geo.lane_sep_x, geo.lane_sep_y1),
        Vec2::new(geo.lane_sep_x, H),
        2.5,
        chrome,
    );
    // Portillon à sens unique
    b.fill_capsule_aa(
        Vec2::new(PLAY_R, geo.gate_y + 11.0),
        Vec2::new(W, geo.gate_y - 11.0),
        1.5,
        (0xf0, 0xc8, 0x55, 220),
    );
    // Déflecteur gauche
    b.fill_capsule_aa(geo.deflector.0, geo.deflector.1, 4.0, chrome_dark);
    b.fill_capsule_aa(geo.deflector.0, geo.deflector.1, 2.2, chrome);
    // Guide orbital bonus droit
    for i in 0..(geo.bonus_guide.len() - 1) {
        b.fill_capsule_aa(geo.bonus_guide[i], geo.bonus_guide[i + 1], 4.0, chrome_dark);
        b.fill_capsule_aa(geo.bonus_guide[i], geo.bonus_guide[i + 1], 2.2, chrome);
    }
    // Séparateurs et diviseurs bas
    for s in &geo.separators {
        for i in 0..(s.len() - 1) {
            b.fill_capsule_aa(s[i], s[i + 1], 4.2, chrome_dark);
            b.fill_capsule_aa(s[i], s[i + 1], 2.4, chrome);
        }
    }
    for &(p1, p2) in &geo.dividers {
        b.fill_capsule_aa(p1, p2, 4.2, chrome_dark);
        b.fill_capsule_aa(p1, p2, 2.4, chrome);
    }
    // Poteaux T-O-U-R
    for &(x, y1, y2) in &geo.lane_posts {
        b.fill_capsule_aa(Vec2::new(x, y1), Vec2::new(x, y2), 3.4, chrome_dark);
        b.fill_capsule_aa(Vec2::new(x, y1), Vec2::new(x, y2), 1.8, chrome);
    }
    // Arceau de protection de la bielle du tourniquet
    for i in 0..(geo.spinner_guard.len() - 1) {
        b.fill_capsule_aa(geo.spinner_guard[i], geo.spinner_guard[i + 1], 2.0, chrome);
    }

    // Étiquettes des pastilles lumineuses
    for lamp in &geo.lamps {
        if !lamp.outer_label.is_empty() {
            let dy = if lamp.outer_above { -(lamp.r + 7.0) } else { lamp.r + 7.0 };
            let lx = lamp.pos.x.round() as i32;
            let ly = (lamp.pos.y + dy).round() as i32;
            b.draw_text_5x7(lx + 1, ly + 1, 1, lamp.outer_label, (0x1a, 0x10, 0x08, 220), true);
            b.draw_text_5x7(lx, ly, 1, lamp.outer_label, (0xff, 0xf6, 0xd0, 240), true);
        }
    }
    b.draw_text_5x7(
        (geo.standups[1].pos.x + 38.0) as i32,
        (geo.standups[1].pos.y + 2.0) as i32,
        1,
        "TIRER",
        (0xff, 0xf6, 0xd0, 240),
        true,
    );
    b.draw_text_5x7(454, 456, 1, "BONUS", (0xff, 0xf6, 0xd0, 240), true);

    b
}

fn build_ramp_and_apron(geo: &TableGeo) -> RgbaBuf {
    let mut b = RgbaBuf::new(W as usize, H as usize);

    // 1. Rampe PVC translucide + flancs chromés
    let pts = &geo.ramp_path.pts;
    for i in 0..(pts.len() - 1) {
        let a = pts[i].pos;
        let c = pts[i + 1].pos;
        // Ombre douce sous la rampe
        b.fill_capsule_aa(
            a.add(Vec2::new(4.0, 5.0)),
            c.add(Vec2::new(4.0, 5.0)),
            19.0,
            (0x00, 0x00, 0x00, 42),
        );
    }
    for i in 0..(pts.len() - 1) {
        let a = pts[i].pos;
        let c = pts[i + 1].pos;
        b.fill_capsule_aa(a, c, 19.5, (0xb8, 0xe4, 0xff, 68));
        let d = c.sub(a).norm();
        let n = Vec2::new(-d.y, d.x);
        for sg in [-1.0_f32, 1.0_f32] {
            b.fill_capsule_aa(
                a.add(n.scale(sg * 19.5)),
                c.add(n.scale(sg * 19.5)),
                1.6,
                (0xe4, 0xf2, 0xff, 195),
            );
        }
    }

    // Enseigne ESCALE au-dessus de l'entrée de rampe
    b.fill_poly(&geo.enseigne_pts, (0x1f, 0x2a, 0x6b, 245));
    for i in 0..4 {
        b.fill_capsule_aa(
            geo.enseigne_pts[i],
            geo.enseigne_pts[(i + 1) % 4],
            1.4,
            (0xff, 0xd2, 0x3f, 255),
        );
    }
    let ecx = (geo.enseigne_pts[0].x + geo.enseigne_pts[2].x) * 0.5;
    let ecy = (geo.enseigne_pts[0].y + geo.enseigne_pts[2].y) * 0.5;
    b.draw_text_5x7(ecx as i32, ecy as i32, 1, "ESCALE", (0xff, 0xff, 0xff, 255), true);

    // 2. Tablier (apron) noir en V en bas du plateau
    let ap = geo.apron;
    let apron_poly = vec![
        Vec2::new(0.0, H),
        Vec2::new(0.0, ap.side),
        Vec2::new(CX - ap.half, ap.front),
        Vec2::new(CX + ap.half, ap.front),
        Vec2::new(PLAY_R, ap.side),
        Vec2::new(PLAY_R, ap.lane),
        Vec2::new(W, ap.lane),
        Vec2::new(W, H),
    ];
    b.fill_poly(&apron_poly, (0x12, 0x12, 0x16, 255));
    b.fill_capsule_aa(Vec2::new(0.0, ap.side), Vec2::new(CX - ap.half, ap.front), 2.0, (0x92, 0x98, 0xa2, 230));
    b.fill_capsule_aa(Vec2::new(CX + ap.half, ap.front), Vec2::new(PLAY_R, ap.side), 2.0, (0x92, 0x98, 0xa2, 230));

    // Cartes d'instructions sur le tablier
    let y0 = ap.front as i32 + 8;
    let hc = (H as i32 - 8 - y0).max(40);
    for &(cx_card, title, l1, l2, l3) in &[
        (14, "MULTIBALL TRIPLETTE", "FANNY ALLUME LE CERCLE", "CERCLE = 3 BILLES", "RAMPE = JACKPOT"),
        (294, "BONUS - EXTRA BALL", "T-O-U-R : BONUS X2..X5", "X5 : EXTRA AU CERCLE", "7 ESCALES = CHELEM"),
    ] {
        b.fill_rect(cx_card, y0, 170, hc, (0xf3, 0xe6, 0xc8, 255));
        b.fill_rect(cx_card, y0, 170, 16, (0xc8, 0x34, 0x2b, 255));
        b.draw_text_5x7(cx_card + 85, y0 + 8, 1, title, (0xff, 0xf6, 0xe0, 255), true);
        b.draw_text_5x7(cx_card + 85, y0 + 28, 1, l1, (0x1d, 0x14, 0x0c, 255), true);
        b.draw_text_5x7(cx_card + 85, y0 + 44, 1, l2, (0x1d, 0x14, 0x0c, 255), true);
        b.draw_text_5x7(cx_card + 85, y0 + 60, 1, l3, (0x1d, 0x14, 0x0c, 255), true);
    }
    b.draw_text_5x7(CX as i32, y0 + 18, 1, "FANNY", (0xf3, 0xe6, 0xc8, 255), true);
    b.draw_text_5x7(CX as i32, y0 + 30, 1, "TE LA REND", (0x62, 0xff, 0xda, 255), true);
    b.draw_text_5x7(CX as i32, y0 + 52, 1, "WORLD TOUR", (0xe9, 0xb4, 0x4c, 255), true);

    b
}

fn build_ball_sprite() -> RgbaBuf {
    let sz = 36usize;
    let mut b = RgbaBuf::new(sz, sz);
    let c = sz as f32 * 0.5;
    let r = BALL_R + 0.5;
    // Ombre portée
    b.fill_circle_aa(c + 2.0, c + 2.5, r, (0, 0, 0, 95));
    // Bille acier dégradée
    for y in 0..sz {
        for x in 0..sz {
            let dx = x as f32 + 0.5 - c;
            let dy = y as f32 + 0.5 - c;
            let d = dx.hypot(dy);
            if d < r + 0.7 {
                let cov = ((r + 0.5 - d) / 1.1).clamp(0.0, 1.0);
                let hx = (dx + r * 0.35) / r;
                let hy = (dy + r * 0.35) / r;
                let hd = hx.hypot(hy);
                let luma = (250.0 - hd * 135.0).clamp(55.0, 255.0);
                let spec = (1.0 - (hx * 2.1).hypot(hy * 2.1)).max(0.0).powi(3) * 140.0;
                let cr = (luma + spec).min(255.0) as u8;
                let cg = (luma + spec + 4.0).min(255.0) as u8;
                let cb = (luma + spec + 12.0).min(255.0) as u8;
                b.blend_px(x as i32, y as i32, cr, cg, cb, (255.0 * cov) as u8);
            }
        }
    }
    b
}

fn build_flipper_sprite(is_left: bool, def: crate::table::FlipperDef) -> RgbaBuf {
    let w = 96usize;
    let h = 36usize;
    let mut b = RgbaBuf::new(w, h);
    let piv = if is_left { Vec2::new(16.0, 18.0) } else { Vec2::new(80.0, 18.0) };
    let tip = if is_left {
        Vec2::new(16.0 + def.len, 18.0)
    } else {
        Vec2::new(80.0 - def.len, 18.0)
    };
    let ab = tip.sub(piv);
    let ab2 = ab.dot(ab);

    for y in 0..h {
        for x in 0..w {
            let p = Vec2::new(x as f32 + 0.5, y as f32 + 0.5);
            let t = (p.sub(piv).dot(ab) / ab2).clamp(0.0, 1.0);
            let q = piv.add(ab.scale(t));
            let r_ext = def.r1 + (def.r2 - def.r1) * t;
            let r_in = (r_ext - 3.2).max(2.0);
            let d = p.sub(q).len();
            if d < r_ext + 0.8 {
                let cov = ((r_ext + 0.6 - d) / 1.2).clamp(0.0, 1.0);
                if d <= r_in {
                    b.blend_px(x as i32, y as i32, 0xfb, 0xf7, 0xeb, (255.0 * cov) as u8);
                } else {
                    b.blend_px(x as i32, y as i32, 0xd8, 0x34, 0x2a, (255.0 * cov) as u8);
                }
            }
        }
    }
    b.fill_circle_aa(piv.x, piv.y, 4.2, (0x8c, 0x92, 0x9c, 255));
    b.fill_circle_aa(piv.x, piv.y, 2.0, (0xe6, 0xea, 0xf0, 255));
    b
}

fn build_bumper_sprite(hit: bool) -> RgbaBuf {
    let sz = 76usize;
    let mut b = RgbaBuf::new(sz, sz);
    let c = sz as f32 * 0.5;
    if hit {
        b.fill_circle_aa(c, c, 36.5, (0xff, 0xdf, 0x60, 120));
    }
    b.fill_circle_aa(c, c, 34.0, (0x1a, 0x10, 0x0a, 240));
    b.fill_circle_aa(c, c, 32.0, if hit { (0xff, 0xf0, 0xaa, 255) } else { (0xd4, 0xd9, 0xe0, 255) });
    b.fill_circle_aa(c, c, 27.5, if hit { (0xff, 0x50, 0x38, 255) } else { (0xc8, 0x34, 0x2b, 255) });
    b.stroke_circle_aa(c, c, 21.0, 2.5, (0xff, 0xd2, 0x3f, 255));
    b.fill_circle_aa(c, c, 15.0, if hit { (0xff, 0xf8, 0xd6, 255) } else { (0x1f, 0x4e, 0x8c, 255) });
    b.stroke_circle_aa(c, c, 15.0, 1.5, (0xff, 0xff, 0xff, 200));
    b.fill_circle_aa(c - 4.0, c - 4.0, 4.0, (0xff, 0xff, 0xff, 120));
    b
}

fn build_drop_sprite() -> RgbaBuf {
    let mut b = RgbaBuf::new(26, 12);
    b.fill_rect(1, 1, 24, 10, (0x20, 0x14, 0x0a, 255));
    b.fill_rect(2, 2, 22, 8, (0xff, 0xd2, 0x3f, 255));
    b.fill_rect(2, 7, 22, 3, (0xc8, 0x34, 0x2b, 255));
    b
}

fn build_standup_sprite(hit: bool) -> RgbaBuf {
    let mut b = RgbaBuf::new(26, 26);
    b.fill_circle_aa(13.0, 13.0, 11.5, (0x18, 0x10, 0x0a, 240));
    b.fill_circle_aa(13.0, 13.0, 10.0, if hit { (0xff, 0xf2, 0x90, 255) } else { (0xe8, 0x4a, 0x32, 255) });
    b.stroke_circle_aa(13.0, 13.0, 7.0, 1.5, (0xff, 0xff, 0xff, 180));
    b
}

fn build_lamp_sprite(r: f32, rgb: (u8, u8, u8), label: &str, lit: bool) -> RgbaBuf {
    let sz = (r * 2.0).ceil() as usize + 10;
    let mut b = RgbaBuf::new(sz, sz);
    let c = sz as f32 * 0.5;
    if lit {
        b.fill_circle_aa(c, c, r + 4.0, (rgb.0, rgb.1, rgb.2, 90));
    }
    b.fill_circle_aa(c, c, r + 1.1, (0x18, 0x11, 0x0c, 255));
    let (cr, cg, cb) = if lit {
        (
            ((rgb.0 as u16 + 255) / 2) as u8,
            ((rgb.1 as u16 + 255) / 2) as u8,
            ((rgb.2 as u16 + 255) / 2) as u8,
        )
    } else {
        (rgb.0 / 2 + 12, rgb.1 / 2 + 12, rgb.2 / 2 + 12)
    };
    b.fill_circle_aa(c, c, r, (rgb.0, rgb.1, rgb.2, if lit { 255 } else { 185 }));
    b.fill_circle_aa(c, c, r * 0.65, (cr, cg, cb, if lit { 230 } else { 140 }));
    b.stroke_circle_aa(c, c, r * 0.78, 1.0, (255, 255, 255, if lit { 110 } else { 55 }));
    if !label.is_empty() {
        b.draw_text_5x7(c as i32, c as i32, 1, label, (0x16, 0x0f, 0x0a, 255), true);
    }
    b
}

// ============================================================================
// Éléments dynamiques dessinés directement au GPU (très léger)
// ============================================================================

fn draw_rollover(c: &mut Canvas<Window>, pos: Vec2, oy: i32, down: bool) {
    let x = pos.x.round() as i32;
    let y = oy + pos.y.round() as i32;
    c.set_draw_color(Color::RGB(0x12, 0x0b, 0x06));
    let _ = c.fill_rect(Rect::new(x - 2, y - 16, 4, 32));
    c.set_draw_color(if down {
        Color::RGB(0x6e, 0x74, 0x80)
    } else {
        Color::RGB(0xe2, 0xe8, 0xf2)
    });
    let _ = c.fill_rect(Rect::new(x - 1, y - 13 + if down { 3 } else { 0 }, 2, if down { 22 } else { 26 }));
}

fn draw_spinner(c: &mut Canvas<Window>, geo: &TableGeo, angle: f32, oy: i32) {
    let sp = geo.spinner;
    let cx = sp.pos.x;
    let cy = oy as f32 + sp.pos.y;
    // Axe du tourniquet
    let p1 = sp.pos.sub(sp.v.scale(sp.half));
    let p2 = sp.pos.add(sp.v.scale(sp.half));
    c.set_draw_color(Color::RGB(0xd8, 0xdc, 0xe4));
    let _ = c.draw_line(
        Point::new(p1.x as i32, oy + p1.y as i32),
        Point::new(p2.x as i32, oy + p2.y as i32),
    );
    // Palette qui s'aplatit visuellement selon |cos(angle)|
    let thick = (angle.cos().abs() * 11.0).max(2.0);
    let col = if angle.cos() >= 0.0 {
        Color::RGB(0xe9, 0xb4, 0x4c)
    } else {
        Color::RGB(0x28, 0x5e, 0x9c)
    };
    c.set_draw_color(col);
    let _ = c.fill_rect(Rect::new(
        (cx - 14.0) as i32,
        (cy - thick * 0.5) as i32,
        28,
        thick.round() as u32,
    ));
}

fn draw_plunger(c: &mut Canvas<Window>, geo: &TableGeo, tirage: f32, oy: i32) {
    let px = geo.plunger_x.round() as i32;
    let pull = (tirage.clamp(0.0, 1.0) * 48.0).round() as i32;
    let top = oy + geo.plunger_top.round() as i32 + pull;
    let bottom = oy + H as i32 - 4;
    let rod_h = (bottom - top).max(6) as u32;

    // Tige chromée
    c.set_draw_color(Color::RGB(0xc8, 0xce, 0xd8));
    let _ = c.fill_rect(Rect::new(px - 3, top + 6, 6, rod_h));
    // Embout caoutchouc noir
    c.set_draw_color(Color::RGB(0x22, 0x22, 0x28));
    let _ = c.fill_rect(Rect::new(px - 8, top, 16, 8));
    // Spires du ressort
    c.set_draw_color(Color::RGB(0xe9, 0xb4, 0x4c));
    let spires = 6;
    for i in 0..spires {
        let sy = top + 10 + ((bottom - top - 14).max(10) * i) / spires;
        let _ = c.fill_rect(Rect::new(px - 6, sy, 12, 2));
    }
}

fn draw_hud(
    c: &mut Canvas<Window>,
    score_txt: &str,
    info_txt: &str,
    slope_deg: f32,
    paused: bool,
    muted: bool,
    attract: bool,
    fps: Option<u32>,
) {
    // Boîtier fronton bois sombre + filet or
    c.set_draw_color(Color::RGB(0x1f, 0x12, 0x0a));
    let _ = c.fill_rect(Rect::new(0, 0, FRAME_W, HUD_H));
    c.set_draw_color(Color::RGB(0xc8, 0x8d, 0x32));
    let _ = c.fill_rect(Rect::new(0, HUD_H as i32 - 3, FRAME_W, 3));

    // Afficheur score (8 caractères LED ambre)
    c.set_draw_color(Color::RGB(0x0b, 0x07, 0x05));
    let _ = c.fill_rect(Rect::new(12, 10, 316, 54));
    c.set_draw_color(Color::RGB(0x55, 0x36, 0x18));
    let _ = c.draw_rect(Rect::new(12, 10, 316, 54));
    draw_led_string(c, score_txt, 22, 18, 28, 38, Color::RGB(0xff, 0x9c, 0x2a));

    // Afficheur info (4 caractères LED rouge-orange)
    c.set_draw_color(Color::RGB(0x0b, 0x07, 0x05));
    let _ = c.fill_rect(Rect::new(340, 10, 162, 54));
    c.set_draw_color(Color::RGB(0x55, 0x36, 0x18));
    let _ = c.draw_rect(Rect::new(340, 10, 162, 54));
    draw_led_string(c, info_txt, 350, 18, 28, 38, Color::RGB(0xff, 0x5e, 0x2a));

    // Petite barre d'état en bas du fronton
    let status = if paused {
        "PAUSE  [P] REPRENDRE"
    } else if attract {
        "START [S/ENTREE]  PIVOTER [O]  PENTE [+/-]"
    } else {
        ""
    };
    if !status.is_empty() {
        draw_mini_text(c, 14, 71, status, Color::RGB(0xd8, 0xc2, 0x96));
    } else {
        let info_line = format!(
            "PENTE {:.1} DEG   SON:{}   [O] PIVOTER",
            slope_deg,
            if muted { "NON" } else { "OUI" }
        );
        draw_mini_text(c, 14, 71, &info_line, Color::RGB(0xb8, 0xa0, 0x78));
    }
    if let Some(f) = fps {
        let ftxt = format!("{} FPS", f);
        draw_mini_text(c, 444, 71, &ftxt, Color::RGB(0x7d, 0xff, 0x6a));
    }
}

/// Afficheur style LED 7/14 segments très lisible (zéro police TTF nécessaire).
fn draw_led_string(
    c: &mut Canvas<Window>,
    text: &str,
    x0: i32,
    y0: i32,
    cw: i32,
    ch: i32,
    col: Color,
) {
    let step = cw + 10;
    let dim = Color::RGB(0x24, 0x13, 0x09);
    for (i, ch_raw) in text.chars().enumerate() {
        let x = x0 + (i as i32) * step;
        let glyph = glyph_5x7(ch_raw);
        let pw = (cw / 5).max(3);
        let ph = (ch / 7).max(3);
        // Fond léger façon matrice LED
        for row in 0..7 {
            let bits = glyph[row];
            for col_i in 0..5 {
                let on = ((bits >> (4 - col_i)) & 1) != 0;
                c.set_draw_color(if on { col } else { dim });
                let _ = c.fill_rect(Rect::new(
                    x + col_i * pw,
                    y0 + (row as i32) * ph,
                    (pw - 1).max(2) as u32,
                    (ph - 1).max(2) as u32,
                ));
            }
        }
    }
}

fn draw_mini_text(c: &mut Canvas<Window>, x0: i32, y0: i32, text: &str, col: Color) {
    c.set_draw_color(col);
    for (i, ch) in text.chars().enumerate() {
        let glyph = glyph_5x7(ch);
        let gx = x0 + (i as i32) * 7;
        for (row, &bits) in glyph.iter().enumerate() {
            for bit in 0..5 {
                if (bits >> (4 - bit)) & 1 != 0 {
                    let _ = c.fill_rect(Rect::new(gx + bit, y0 + row as i32, 1, 1));
                }
            }
        }
    }
}

/// Police bitmap 5×7 intégrée (majuscules, chiffres et ponctuation).
fn glyph_5x7(c: char) -> [u8; 7] {
    match c.to_ascii_uppercase() {
        '0' => [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E],
        '1' => [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
        '2' => [0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F],
        '3' => [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E],
        '4' => [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02],
        '5' => [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
        '6' => [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E],
        '7' => [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
        '8' => [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E],
        '9' => [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
        'A' => [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
        'B' => [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
        'C' => [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E],
        'D' => [0x1C, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1C],
        'E' => [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F],
        'F' => [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
        'G' => [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F],
        'H' => [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
        'I' => [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E],
        'J' => [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C],
        'K' => [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
        'L' => [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
        'M' => [0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11],
        'N' => [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
        'O' => [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
        'P' => [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
        'Q' => [0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D],
        'R' => [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
        'S' => [0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E],
        'T' => [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
        'U' => [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
        'V' => [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
        'W' => [0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11],
        'X' => [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
        'Y' => [0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04],
        'Z' => [0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F],
        '-' => [0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00],
        '+' => [0x00, 0x04, 0x04, 0x1F, 0x04, 0x04, 0x00],
        '/' => [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
        ':' => [0x00, 0x04, 0x04, 0x00, 0x04, 0x04, 0x00],
        '.' => [0x00, 0x00, 0x00, 0x00, 0x00, 0x0C, 0x0C],
        '[' => [0x0E, 0x08, 0x08, 0x08, 0x08, 0x08, 0x0E],
        ']' => [0x0E, 0x02, 0x02, 0x02, 0x02, 0x02, 0x0E],
        '=' => [0x00, 0x00, 0x1F, 0x00, 0x1F, 0x00, 0x00],
        'É' | 'È' | 'Ê' => [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F],
        '×' => [0x00, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x00],
        _ => [0x00; 7],
    }
}
