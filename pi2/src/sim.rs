//! Moteur physique 2D dédié au flipper en Rust pur (480 Hz, zéro dépendance externe).
//! Calibré sur les constantes réelles de `js/sim.js` (mm, secondes, gravité selon la pente).

use std::f32::consts::PI;

use crate::rules::{Coil, Switch};
use crate::table::{dz_ds_rampe, z_rampe, TableGeo, Vec2, BALL_R, CX, DRAIN_Y, H, PLAY_R};

const DT: f32 = 1.0 / 480.0;
const G_MM: f32 = 9810.0; // mm/s²
const ROULEMENT: f32 = 0.005;
const V_MAX: f32 = 6000.0; // 6.0 m/s
const FLIP_UP: f32 = 45.0; // rad/s
const FLIP_DOWN: f32 = 20.0; // rad/s
const LAUNCH_V: f32 = 2500.0; // 2.50 m/s
const BUMPER_V: f32 = 1250.0; // 1.25 m/s
const SLING_V: f32 = 1050.0; // 1.05 m/s
const NUDGE_V: f32 = 270.0; // 0.27 m/s
const SAUCER_MAX_V: f32 = 950.0; // 0.95 m/s
const TILT_BOB: f32 = 2.4;
const BOB_TAU_S: f32 = 1.5;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BallMode {
    Table,
    Ramp {
        s: f32,
        v_s: f32,
        triggered: bool,
    },
    Saucer,
}

#[derive(Debug, Clone)]
pub struct Ball {
    pub pos: Vec2,
    pub vel: Vec2,
    pub z: f32, // altitude visuelle au-dessus du plateau (mm)
    pub mode: BallMode,
    pub passed_gate: bool,
    pub saucer_ignore_until: u64,
    pub ramp_ignore_until: u64,
    pub spinner_at: u64,
    pub still_ms: f32,
    pub stuck_at: Option<Vec2>,
    pub stuck_nudges: u32,
    pub in_lane: [bool; 4],
    pub in_lower_lane: [bool; 6],
}

impl Ball {
    fn new(pos: Vec2) -> Self {
        Self {
            pos,
            vel: Vec2::new(0.0, 0.0),
            z: 0.0,
            mode: BallMode::Table,
            passed_gate: false,
            saucer_ignore_until: 0,
            ramp_ignore_until: 0,
            spinner_at: 0,
            still_ms: 0.0,
            stuck_at: None,
            stuck_nudges: 0,
            in_lane: [false; 4],
            in_lower_lane: [false; 6],
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct FlipperState {
    pub angle: f32,
    pub omega: f32,
}

#[derive(Debug, Clone)]
pub struct FlashState {
    pub bumper: [u64; 3],
    pub sling: [u64; 2],
    pub standup: [u64; 3],
    pub target: [u64; 3],
    pub drop: [u64; 5],
    pub spinner: u64,
    pub plunger: u64,
}

impl Default for FlashState {
    fn default() -> Self {
        Self {
            bumper: [0; 3],
            sling: [0; 2],
            standup: [0; 3],
            target: [0; 3],
            drop: [0; 5],
            spinner: 0,
            plunger: 0,
        }
    }
}

pub struct Sim {
    pub geo: TableGeo,
    pub balls: Vec<Ball>,
    pub flippers: [FlipperState; 2],
    pub held_l: bool,
    pub held_r: bool,
    pub power: bool,
    pub drops_up: [bool; 5],
    pub slope_deg: f32,
    pub force: f32,
    pub tirage: f32, // 0..1 position du ressort de lanceur (visuel)
    pub time_ms: u64,
    pub bob: f32,
    pub last_nudge_ms: u64,
    pub shake_at_ms: u64,
    pub shake_dx: i32,
    pub spinner_angle: f32,
    pub spinner_omega: f32,
    spinner_tick_angle: f32,
    pub rollover_down: [bool; 10], // 4 haut + 6 bas
    pub flash: FlashState,
    shooter_closed: bool,
    cool_bumper: [u64; 3],
    cool_sling: [u64; 2],
    cool_standup: [u64; 3],
    cool_target: [u64; 3],
    accum_s: f32,
    rng: u64,
    events: Vec<(Switch, bool)>,
}

impl Sim {
    pub fn new(geo: TableGeo, slope_deg: f32, seed: u64) -> Self {
        let f0 = FlipperState {
            angle: geo.flippers[0].rest,
            omega: 0.0,
        };
        let f1 = FlipperState {
            angle: geo.flippers[1].rest,
            omega: 0.0,
        };
        Self {
            geo,
            balls: Vec::new(),
            flippers: [f0, f1],
            held_l: false,
            held_r: false,
            power: true,
            drops_up: [true; 5],
            slope_deg: slope_deg.clamp(5.0, 8.0),
            force: 1.0,
            tirage: 0.0,
            time_ms: 0,
            bob: 0.0,
            last_nudge_ms: 0,
            shake_at_ms: 0,
            shake_dx: 0,
            spinner_angle: 0.0,
            spinner_omega: 0.0,
            spinner_tick_angle: 0.0,
            rollover_down: [false; 10],
            flash: FlashState::default(),
            shooter_closed: false,
            cool_bumper: [0; 3],
            cool_sling: [0; 2],
            cool_standup: [0; 3],
            cool_target: [0; 3],
            accum_s: 0.0,
            rng: seed.max(1),
            events: Vec::new(),
        }
    }

    fn rand_f32(&mut self) -> f32 {
        let mut x = self.rng;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.rng = x;
        ((x >> 11) as u32 & 0x00ff_ffff) as f32 / 16_777_216.0
    }

    pub fn set_slope(&mut self, deg: f32) -> f32 {
        self.slope_deg = (deg * 2.0).round() * 0.5;
        self.slope_deg = self.slope_deg.clamp(5.0, 8.0);
        self.slope_deg
    }

    pub fn clear(&mut self) {
        self.balls.clear();
        self.drops_up = [true; 5];
        self.shooter_closed = false;
        self.bob = 0.0;
        self.spinner_angle = 0.0;
        self.spinner_omega = 0.0;
        self.spinner_tick_angle = 0.0;
    }

    pub fn drain_events(&mut self) -> Vec<(Switch, bool)> {
        std::mem::take(&mut self.events)
    }

    fn emit(&mut self, sw: Switch, closed: bool) {
        self.events.push((sw, closed));
    }

    fn in_shooter(&self, b: &Ball) -> bool {
        b.mode == BallMode::Table
            && b.pos.x > PLAY_R + 4.0
            && b.pos.y > self.geo.plunger_ball_y - 25.0
    }

    pub fn coil(&mut self, c: Coil) {
        match c {
            Coil::Trough => {
                // Dépose une bille dans le couloir de lancement
                let mut y = self.geo.plunger_ball_y;
                while self.balls.iter().any(|b| {
                    b.mode == BallMode::Table
                        && (b.pos.x - self.geo.plunger_x).abs() < 12.0
                        && (b.pos.y - y).abs() < BALL_R * 2.2
                }) {
                    y -= BALL_R * 2.3;
                }
                self.balls.push(Ball::new(Vec2::new(self.geo.plunger_x, y)));
            }
            Coil::Launch => {
                let f = self.force.clamp(0.3, 1.15);
                let jitter = (self.rand_f32() - 0.5) * 0.03;
                let vy = -LAUNCH_V * (f + jitter);
                for b in &mut self.balls {
                    if b.mode == BallMode::Table
                        && b.pos.x > PLAY_R + 4.0
                        && b.pos.y > self.geo.plunger_ball_y - 30.0
                    {
                        b.vel = Vec2::new(0.0, vy);
                        b.passed_gate = false;
                    }
                }
                self.flash.plunger = self.time_ms;
                self.force = 1.0;
            }
            Coil::Saucer => {
                let sc = self.geo.saucer;
                for i in 0..self.balls.len() {
                    if self.balls[i].mode == BallMode::Saucer {
                        let rx = (self.rand_f32() - 0.5) * 120.0;
                        let ry = (self.rand_f32() - 0.5) * 120.0;
                        let b = &mut self.balls[i];
                        b.mode = BallMode::Table;
                        b.saucer_ignore_until = self.time_ms + 900;
                        b.pos = Vec2::new(sc.pos.x, sc.pos.y + 2.0);
                        b.vel = Vec2::new(sc.kick.x + rx, sc.kick.y + ry);
                        b.z = 0.0;
                    }
                }
            }
            Coil::DropReset => {
                self.drops_up = [true; 5];
            }
            Coil::PowerOff => {
                self.power = false;
            }
            Coil::PowerOn => {
                self.power = true;
            }
            Coil::Knocker => {}
        }
    }

    pub fn nudge(&mut self, dx: i32) -> bool {
        if self.time_ms.saturating_sub(self.last_nudge_ms) < 250 {
            return false;
        }
        self.last_nudge_ms = self.time_ms;
        self.shake_at_ms = self.time_ms;
        self.shake_dx = dx;
        for i in 0..self.balls.len() {
            if self.balls[i].mode != BallMode::Table || self.in_shooter(&self.balls[i]) {
                continue;
            }
            let r = (self.rand_f32() - 0.5) * 180.0;
            let vx = if dx != 0 {
                (dx as f32) * NUDGE_V * 1.15
            } else {
                r
            };
            let vy = if dx != 0 { -NUDGE_V * 0.35 } else { -NUDGE_V };
            self.balls[i].vel.x += vx;
            self.balls[i].vel.y += vy;
        }
        self.bob += 1.0;
        if self.bob >= TILT_BOB {
            self.bob = 0.8;
            self.emit(Switch::Tilt, true);
        }
        true
    }

    pub fn step(&mut self, dt_s: f32) {
        let clamped = dt_s.min(0.05);
        self.accum_s += clamped;
        while self.accum_s >= DT {
            self.accum_s -= DT;
            self.substep();
        }
        self.frame_checks(clamped);
    }

    fn substep(&mut self) {
        self.time_ms = self.time_ms.saturating_add(2); // ~2.083 ms par pas à 480 Hz
        let slope_rad = self.slope_deg.to_radians();
        let g_table = G_MM * slope_rad.sin();
        let roll_decel = ROULEMENT * G_MM * slope_rad.cos();

        // 1. Mise à jour des batteurs
        for i in 0..2 {
            let def = self.geo.flippers[i];
            let held = self.power && if i == 0 { self.held_l } else { self.held_r };
            let target = if held { def.up } else { def.rest };
            let cur = self.flippers[i].angle;
            let diff = target - cur;
            if diff.abs() < 1e-4 {
                self.flippers[i].angle = target;
                self.flippers[i].omega = 0.0;
            } else {
                let speed = if held { FLIP_UP } else { FLIP_DOWN };
                let step = diff.signum() * (speed * DT).min(diff.abs());
                self.flippers[i].angle = cur + step;
                self.flippers[i].omega = step / DT;
            }
        }

        // 2. Intégration & collisions de chaque bille
        let ramp_len = self.geo.ramp_path.length;
        for bi in 0..self.balls.len() {
            match self.balls[bi].mode {
                BallMode::Saucer => {
                    self.balls[bi].pos = self.geo.saucer.pos;
                    self.balls[bi].vel = Vec2::new(0.0, 0.0);
                    self.balls[bi].z = -4.0;
                }
                BallMode::Ramp {
                    mut s,
                    mut v_s,
                    mut triggered,
                } => {
                    let (_, dir) = self.geo.ramp_path.point_at(s);
                    let dz = dz_ds_rampe(s, ramp_len);
                    // Gravité projetée sur la pente de la rampe + composante de pente du plateau
                    let a_s = -G_MM * slope_rad.cos() * dz + g_table * dir.y
                        - 0.025 * G_MM * v_s.signum();
                    v_s += a_s * DT;
                    v_s = v_s.clamp(-3200.0, 4200.0);
                    s += v_s * DT;

                    if !triggered && s > 135.0 {
                        triggered = true;
                        self.emit(Switch::Ramp, true);
                    }

                    if s < 0.0 {
                        // La bille n'avait pas assez d'élan : elle redescend sur le plateau
                        let re = self.geo.ramp_entry;
                        self.balls[bi].mode = BallMode::Table;
                        self.balls[bi].pos = re.m.sub(re.u.scale(4.0));
                        self.balls[bi].vel = re.u.scale(v_s.min(-350.0));
                        self.balls[bi].z = 0.0;
                        self.balls[bi].ramp_ignore_until = self.time_ms + 350;
                    } else if s >= ramp_len {
                        // Sortie de rampe dans le couloir de retour droit
                        let (exit_pos, exit_dir) = self.geo.ramp_path.point_at(ramp_len);
                        self.balls[bi].mode = BallMode::Table;
                        self.balls[bi].pos = exit_pos;
                        self.balls[bi].vel = exit_dir.scale(v_s.clamp(220.0, 950.0));
                        self.balls[bi].z = 0.0;
                    } else {
                        let (pos, _) = self.geo.ramp_path.point_at(s);
                        self.balls[bi].pos = pos;
                        self.balls[bi].z = z_rampe(s, ramp_len);
                        self.balls[bi].mode = BallMode::Ramp { s, v_s, triggered };
                    }
                }
                BallMode::Table => {
                    // Gravité + résistance au roulement
                    let b = &mut self.balls[bi];
                    b.vel.y += g_table * DT;
                    let spd = b.vel.len();
                    if spd > 1e-3 {
                        let new_spd = (spd - roll_decel * DT).max(0.0).min(V_MAX);
                        b.vel = b.vel.scale(new_spd / spd);
                    }
                    b.pos = b.pos.add(b.vel.scale(DT));
                    b.z = 0.0;

                    if !b.passed_gate && b.pos.y < self.geo.gate_y - 16.0 {
                        b.passed_gate = true;
                    }

                    // Collisions statiques : segments
                    self.collide_segments(bi);
                    // Poteaux circulaires
                    self.collide_posts(bi);
                    // Lance-pierres
                    self.collide_slings(bi);
                    // Bumpers
                    self.collide_bumpers(bi);
                    // Cibles tombantes F-A-N-N-Y
                    self.collide_drops(bi);
                    // Cibles fixes (POINTER, TIRER, BOUCHON)
                    self.collide_standups(bi);
                    // 3 cibles rondes du mur gauche
                    self.collide_left_targets(bi);
                    // Batteurs (capsules coniques balayées)
                    self.collide_flippers(bi);
                    // Capteurs (couloirs, saucer, entrée rampe)
                    self.check_sensors(bi);
                }
            }
        }

        // 3. Collisions bille contre bille (multiball)
        self.collide_balls();

        // 4. Tourniquet (spinner)
        self.step_spinner();

        // 5. Évacuation (drain)
        let mut drained = 0usize;
        self.balls.retain(|b| {
            if b.mode == BallMode::Table && b.pos.y > DRAIN_Y {
                drained += 1;
                false
            } else {
                true
            }
        });
        for _ in 0..drained {
            self.emit(Switch::Drain, true);
        }
    }

    fn collide_segments(&mut self, bi: usize) {
        let passed = self.balls[bi].passed_gate;
        for si in 0..self.geo.segments.len() {
            let seg = self.geo.segments[si];
            if seg.is_gate && !passed {
                continue;
            }
            let b = &mut self.balls[bi];
            let ab = seg.b.sub(seg.a);
            let ab_len2 = ab.dot(ab).max(1e-6);
            let t = (b.pos.sub(seg.a).dot(ab) / ab_len2).clamp(0.0, 1.0);
            let q = seg.a.add(ab.scale(t));
            let diff = b.pos.sub(q);
            let dist = diff.len();
            let min_d = BALL_R + seg.r;
            if dist < min_d && dist > 1e-6 {
                let n = diff.scale(1.0 / dist);
                b.pos = q.add(n.scale(min_d));
                let vn = b.vel.dot(n);
                if vn < 0.0 {
                    b.vel = b.vel.sub(n.scale((1.0 + seg.restitution) * vn));
                    // léger amortissement tangentiel
                    let tang = Vec2::new(-n.y, n.x);
                    let vt = b.vel.dot(tang);
                    b.vel = b.vel.sub(tang.scale(vt * 0.025));
                }
            }
        }
    }

    fn collide_posts(&mut self, bi: usize) {
        for pi in 0..self.geo.posts.len() {
            let post = self.geo.posts[pi];
            let b = &mut self.balls[bi];
            let diff = b.pos.sub(post.pos);
            let dist = diff.len();
            let min_d = BALL_R + post.r;
            if dist < min_d && dist > 1e-6 {
                let n = diff.scale(1.0 / dist);
                b.pos = post.pos.add(n.scale(min_d));
                let vn = b.vel.dot(n);
                if vn < 0.0 {
                    b.vel = b.vel.sub(n.scale((1.0 + post.restitution) * vn));
                }
            }
        }
    }

    fn collide_slings(&mut self, bi: usize) {
        for si in 0..2 {
            let posts = self.geo.slings[si].posts;
            let r_rub = self.geo.slings[si].r_rub;
            let face_n = self.geo.slings[si].face_n;
            let edges = [(posts[0], posts[1], false), (posts[1], posts[2], false), (posts[2], posts[0], true)];
            for (a, c, is_active_face) in edges {
                let ab = c.sub(a);
                let ab_len2 = ab.dot(ab).max(1e-6);
                let t = (self.balls[bi].pos.sub(a).dot(ab) / ab_len2).clamp(0.0, 1.0);
                let q = a.add(ab.scale(t));
                let diff = self.balls[bi].pos.sub(q);
                let dist = diff.len();
                let min_d = BALL_R + r_rub;
                if dist < min_d && dist > 1e-6 {
                    let n = diff.scale(1.0 / dist);
                    self.balls[bi].pos = q.add(n.scale(min_d));
                    let vn = self.balls[bi].vel.dot(n);
                    if vn < 0.0 {
                        let active_hit = is_active_face
                            && t > 0.12
                            && t < 0.88
                            && n.dot(face_n) > 0.5
                            && self.power
                            && self.time_ms.saturating_sub(self.cool_sling[si]) > 140;
                        if active_hit {
                            self.cool_sling[si] = self.time_ms;
                            self.flash.sling[si] = self.time_ms;
                            let spread = (self.rand_f32() - 0.5) * 0.24;
                            let mut kd = Vec2::new(face_n.x, face_n.y + 0.20).norm();
                            let ca = spread.cos();
                            let sa = spread.sin();
                            kd = Vec2::new(kd.x * ca - kd.y * sa, kd.x * sa + kd.y * ca);
                            self.balls[bi].vel = self.balls[bi].vel.scale(0.45).add(kd.scale(SLING_V));
                            self.emit(Switch::Sling(si), true);
                        } else {
                            self.balls[bi].vel = self.balls[bi].vel.sub(n.scale(1.65 * vn));
                        }
                    }
                }
            }
        }
    }

    fn collide_bumpers(&mut self, bi: usize) {
        for idx in 0..3 {
            let bmp = self.geo.bumpers[idx];
            let diff = self.balls[bi].pos.sub(bmp.pos);
            let dist = diff.len();
            let min_d = BALL_R + bmp.r;
            if dist < min_d && dist > 1e-6 {
                let n = diff.scale(1.0 / dist);
                self.balls[bi].pos = bmp.pos.add(n.scale(min_d));
                let vn = self.balls[bi].vel.dot(n);
                if vn < 0.0 {
                    if self.power && self.time_ms.saturating_sub(self.cool_bumper[idx]) > 90 {
                        self.cool_bumper[idx] = self.time_ms;
                        self.flash.bumper[idx] = self.time_ms;
                        let jitter = (self.rand_f32() - 0.5) * 0.16;
                        let ca = jitter.cos();
                        let sa = jitter.sin();
                        let kn = Vec2::new(n.x * ca - n.y * sa, n.x * sa + n.y * ca);
                        self.balls[bi].vel = kn.scale(BUMPER_V.max(self.balls[bi].vel.len() * 0.85));
                        self.emit(Switch::Bumper(idx), true);
                    } else {
                        self.balls[bi].vel = self.balls[bi].vel.sub(n.scale(1.5 * vn));
                    }
                }
            }
        }
    }

    fn collide_drops(&mut self, bi: usize) {
        for idx in 0..5 {
            if !self.drops_up[idx] {
                continue;
            }
            let d = self.geo.drops[idx];
            let rel = self.balls[bi].pos.sub(d.pos);
            let lx = rel.dot(d.dir);
            let ly = rel.dot(d.normal);
            let hw = d.w * 0.5;
            let hh = d.h * 0.5;
            let cx = lx.clamp(-hw, hw);
            let cy = ly.clamp(-hh, hh);
            let dx = lx - cx;
            let dy = ly - cy;
            let dist = dx.hypot(dy);
            if dist < BALL_R && dist > 1e-6 {
                let nx_l = dx / dist;
                let ny_l = dy / dist;
                let n = d.dir.scale(nx_l).add(d.normal.scale(ny_l));
                let push = BALL_R - dist;
                self.balls[bi].pos = self.balls[bi].pos.add(n.scale(push));
                let vn = self.balls[bi].vel.dot(n);
                if vn < 0.0 {
                    self.balls[bi].vel = self.balls[bi].vel.sub(n.scale(1.45 * vn));
                }
                self.drops_up[idx] = false;
                self.flash.drop[idx] = self.time_ms;
                self.emit(Switch::Drop(idx), true);
            }
        }
    }

    fn collide_standups(&mut self, bi: usize) {
        for idx in 0..3 {
            let st = self.geo.standups[idx];
            let diff = self.balls[bi].pos.sub(st.pos);
            let dist = diff.len();
            let min_d = BALL_R + st.r;
            if dist < min_d && dist > 1e-6 {
                let n = diff.scale(1.0 / dist);
                self.balls[bi].pos = st.pos.add(n.scale(min_d));
                let vn = self.balls[bi].vel.dot(n);
                if vn < 0.0 {
                    self.balls[bi].vel = self.balls[bi].vel.sub(n.scale(1.55 * vn));
                }
                if self.time_ms.saturating_sub(self.cool_standup[idx]) > 140 {
                    self.cool_standup[idx] = self.time_ms;
                    self.flash.standup[idx] = self.time_ms;
                    let sw = match idx {
                        0 => Switch::Pointer,
                        1 => Switch::Tirer,
                        _ => Switch::Bouchon,
                    };
                    self.emit(sw, true);
                }
            }
        }
    }

    fn collide_left_targets(&mut self, bi: usize) {
        for idx in 0..3 {
            let lt = self.geo.left_targets[idx];
            let rel = self.balls[bi].pos.sub(lt.pos);
            let cx = rel.x.clamp(-lt.half_w, lt.half_w);
            let cy = rel.y.clamp(-lt.half_h, lt.half_h);
            let dx = rel.x - cx;
            let dy = rel.y - cy;
            let dist = dx.hypot(dy);
            if dist < BALL_R && dist > 1e-6 {
                let n = Vec2::new(dx / dist, dy / dist);
                self.balls[bi].pos = self.balls[bi].pos.add(n.scale(BALL_R - dist));
                let vn = self.balls[bi].vel.dot(n);
                if vn < 0.0 {
                    self.balls[bi].vel = self.balls[bi].vel.sub(n.scale(1.50 * vn));
                }
                if self.time_ms.saturating_sub(self.cool_target[idx]) > 140 {
                    self.cool_target[idx] = self.time_ms;
                    self.flash.target[idx] = self.time_ms;
                    self.emit(Switch::Target(idx), true);
                }
            }
        }
    }

    fn collide_flippers(&mut self, bi: usize) {
        for fi in 0..2 {
            let def = self.geo.flippers[fi];
            let st = self.flippers[fi];
            let sgn = if def.is_left { 1.0_f32 } else { -1.0_f32 };
            let dir = Vec2::new(sgn * st.angle.cos(), sgn * st.angle.sin());
            let b = &mut self.balls[bi];
            let rel = b.pos.sub(def.pivot);
            let t = (rel.dot(dir) / def.len).clamp(0.0, 1.0);
            let q = def.pivot.add(dir.scale(t * def.len));
            let rf = def.r1 + (def.r2 - def.r1) * t;
            let diff = b.pos.sub(q);
            let dist = diff.len();
            let min_d = BALL_R + rf;
            if dist < min_d && dist > 1e-6 {
                let n = diff.scale(1.0 / dist);
                b.pos = q.add(n.scale(min_d));
                let contact_r = q.add(n.scale(rf)).sub(def.pivot);
                let v_surf = Vec2::new(-st.omega * contact_r.y, st.omega * contact_r.x);
                let v_rel = b.vel.sub(v_surf);
                let vn = v_rel.dot(n);
                if vn < 0.0 {
                    let e = if st.omega.abs() > 2.0 { 0.55 } else { 0.34 };
                    b.vel = b.vel.sub(n.scale((1.0 + e) * vn));
                    // adhérence caoutchouc rouge de la palette
                    let tang = Vec2::new(-n.y, n.x);
                    let vt = v_rel.dot(tang);
                    b.vel = b.vel.sub(tang.scale(vt * 0.14));
                }
            }
        }
    }

    fn check_sensors(&mut self, bi: usize) {
        let pos = self.balls[bi].pos;
        let vel = self.balls[bi].vel;

        // 1. Couloirs T-O-U-R
        for i in 0..4 {
            let lp = self.geo.lanes[i].pos;
            let inside = (pos.x - lp.x).abs() < 16.0 && (pos.y - lp.y).abs() < 12.0;
            if inside && !self.balls[bi].in_lane[i] {
                self.emit(Switch::Lane(i), true);
            }
            self.balls[bi].in_lane[i] = inside;
        }

        // 2. 6 couloirs du bas (rollovers)
        for i in 0..6 {
            let lp = self.geo.lower_lanes[i].pos;
            let inside = (pos.x - lp.x).abs() < 14.0 && (pos.y - lp.y).abs() < 14.0;
            if inside && !self.balls[bi].in_lower_lane[i] {
                self.emit(Switch::LowerLane(i), true);
            }
            self.balls[bi].in_lower_lane[i] = inside;
        }

        // 3. Le Cercle (saucer)
        let sc = self.geo.saucer;
        if self.time_ms >= self.balls[bi].saucer_ignore_until
            && pos.sub(sc.pos).len() < 14.0
            && vel.len() < SAUCER_MAX_V
        {
            self.balls[bi].mode = BallMode::Saucer;
            self.balls[bi].pos = sc.pos;
            self.balls[bi].vel = Vec2::new(0.0, 0.0);
            self.emit(Switch::Saucer, true);
            return;
        }

        // 4. Entrée de rampe
        let re = self.geo.ramp_entry;
        if self.time_ms >= self.balls[bi].ramp_ignore_until {
            let rel = pos.sub(re.sensor);
            let du = rel.dot(re.u);
            let dv = rel.dot(re.v);
            let vu = vel.dot(re.u);
            if du.abs() < 16.0 && dv.abs() < re.half && vu > 650.0 {
                let s0 = re.sensor.sub(re.m).len();
                self.balls[bi].mode = BallMode::Ramp {
                    s: s0,
                    v_s: vu * 1.08,
                    triggered: false,
                };
            }
        }
    }

    fn collide_balls(&mut self) {
        let n = self.balls.len();
        if n < 2 {
            return;
        }
        let min_d = BALL_R * 2.0;
        for i in 0..n {
            if self.balls[i].mode != BallMode::Table {
                continue;
            }
            for j in (i + 1)..n {
                if self.balls[j].mode != BallMode::Table {
                    continue;
                }
                let diff = self.balls[j].pos.sub(self.balls[i].pos);
                let dist = diff.len();
                if dist < min_d && dist > 1e-6 {
                    let norm = diff.scale(1.0 / dist);
                    let overlap = (min_d - dist) * 0.5;
                    self.balls[i].pos = self.balls[i].pos.sub(norm.scale(overlap));
                    self.balls[j].pos = self.balls[j].pos.add(norm.scale(overlap));
                    let rv = self.balls[j].vel.sub(self.balls[i].vel);
                    let vn = rv.dot(norm);
                    if vn < 0.0 {
                        let imp = norm.scale(0.95 * vn);
                        self.balls[i].vel = self.balls[i].vel.add(imp);
                        self.balls[j].vel = self.balls[j].vel.sub(imp);
                    }
                }
            }
        }
    }

    fn step_spinner(&mut self) {
        let sp = self.geo.spinner;
        for b in &mut self.balls {
            if b.mode != BallMode::Table {
                continue;
            }
            if self.time_ms.saturating_sub(b.spinner_at) < 120 {
                continue;
            }
            let rel = b.pos.sub(sp.pos);
            let du = rel.dot(sp.u);
            let dv = rel.dot(sp.v);
            if du.abs() < 12.0 && dv.abs() < sp.half - 2.0 {
                let vu = b.vel.dot(sp.u) * 0.001; // m/s
                if vu.abs() > 0.12 {
                    b.spinner_at = self.time_ms;
                    let w_hit = (vu * 30.0).clamp(-75.0, 75.0);
                    self.spinner_omega = if w_hit.abs() > self.spinner_omega.abs() {
                        w_hit
                    } else {
                        (self.spinner_omega + w_hit * 0.45).clamp(-85.0, 85.0)
                    };
                    self.flash.spinner = self.time_ms;
                }
            }
        }
        if self.spinner_omega.abs() > 0.01 || self.spinner_angle.sin().abs() > 0.002 {
            let drag = -0.82 * self.spinner_omega
                - if self.spinner_omega.abs() > 0.2 {
                    self.spinner_omega.signum() * 0.45
                } else {
                    0.0
                };
            self.spinner_omega += (-26.0 * self.spinner_angle.sin() + drag) * DT;
            self.spinner_angle += self.spinner_omega * DT;
            while (self.spinner_angle - self.spinner_tick_angle).abs() >= 2.0 * PI {
                self.spinner_tick_angle +=
                    (self.spinner_angle - self.spinner_tick_angle).signum() * 2.0 * PI;
                self.flash.spinner = self.time_ms;
                self.emit(Switch::Spinner, true);
            }
            if self.spinner_omega.abs() < 0.06
                && self.spinner_angle.sin().abs() < 0.025
                && self.spinner_angle.cos() > 0.9
            {
                self.spinner_angle = 0.0;
                self.spinner_omega = 0.0;
                self.spinner_tick_angle = 0.0;
            }
        }
    }

    fn frame_checks(&mut self, dt_s: f32) {
        // Amortissement du pendule de tilt
        self.bob *= (-dt_s / BOB_TAU_S).exp();

        // État visuel des 10 fils de rollover
        self.rollover_down = [false; 10];
        for b in &self.balls {
            for i in 0..4 {
                if b.in_lane[i] {
                    self.rollover_down[i] = true;
                }
            }
            for i in 0..6 {
                if b.in_lower_lane[i] {
                    self.rollover_down[4 + i] = true;
                }
            }
        }

        // Contact du couloir de lancement
        let in_shooter = self.balls.iter().any(|b| {
            b.mode == BallMode::Table
                && b.pos.x > PLAY_R + 4.0
                && b.pos.y > self.geo.plunger_ball_y - 12.0
                && b.vel.y.abs() < 60.0
        });
        if in_shooter != self.shooter_closed {
            self.shooter_closed = in_shooter;
            self.emit(Switch::Shooter, in_shooter);
        }

        // Anti-blocage automatique si une bille s'arrête sur le plateau (hors berceau sur palette levée)
        let flip_py = self.geo.flippers[0].pivot.y;
        let dt_ms = dt_s * 1000.0;
        for i in 0..self.balls.len() {
            if self.balls[i].mode != BallMode::Table || self.in_shooter(&self.balls[i]) {
                self.balls[i].still_ms = 0.0;
                continue;
            }
            let pos = self.balls[i].pos;
            let cradled = pos.y > flip_py - 90.0
                && ((self.held_l && pos.x < CX) || (self.held_r && pos.x >= CX));
            if self.balls[i].vel.len() < 30.0 && !cradled {
                self.balls[i].still_ms += dt_ms;
            } else {
                self.balls[i].still_ms = 0.0;
            }
            if self.balls[i].still_ms > 1500.0 {
                self.balls[i].still_ms = 0.0;
                let reset_cnt = match self.balls[i].stuck_at {
                    Some(prev) => pos.sub(prev).len() > 30.0,
                    None => true,
                };
                if reset_cnt {
                    self.balls[i].stuck_at = Some(pos);
                    self.balls[i].stuck_nudges = 0;
                }
                self.balls[i].stuck_nudges += 1;
                let to_center = Vec2::new(CX - pos.x, H * 0.45 - pos.y).norm();
                let k = (4.0 + 3.0 * (self.balls[i].stuck_nudges.min(4) as f32)) * 60.0;
                let rx = (self.rand_f32() - 0.5) * 180.0;
                self.balls[i].vel = Vec2::new(to_center.x * k + rx, to_center.y * k - 180.0);
            }
        }
    }
}
