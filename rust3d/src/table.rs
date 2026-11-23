//! Géométrie exacte de la table Fanny Pinball (portage 1:1 de `js/table.js` et `LAMP_LAYOUT`).
//! Toutes les dimensions sont en millimètres (origine = coin haut gauche du plateau).

use std::f32::consts::PI;

pub const W: f32 = 514.0;
pub const DY: f32 = 196.0;
pub const YT: f32 = 42.0;
pub const H: f32 = 1067.0 + DY; // 1263.0 mm
pub const BALL_R: f32 = 13.5;
pub const PLAY_R: f32 = 478.0;
pub const CX: f32 = PLAY_R * 0.5; // 239.0 mm
pub const GUIDE_T: f32 = 8.0;
pub const DRAIN_Y: f32 = H + 8.0;

pub const CITIES: [&str; 7] = [
    "MARSEILLE",
    "PARIS",
    "LONDRES",
    "NEW YORK",
    "TOKYO",
    "RIO",
    "SYDNEY",
];

#[derive(Debug, Clone, Copy, Default)]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

impl Vec2 {
    pub const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
    pub fn add(self, o: Self) -> Self {
        Self::new(self.x + o.x, self.y + o.y)
    }
    pub fn sub(self, o: Self) -> Self {
        Self::new(self.x - o.x, self.y - o.y)
    }
    pub fn scale(self, s: f32) -> Self {
        Self::new(self.x * s, self.y * s)
    }
    pub fn dot(self, o: Self) -> f32 {
        self.x * o.x + self.y * o.y
    }
    pub fn len(self) -> f32 {
        self.x.hypot(self.y)
    }
    pub fn norm(self) -> Self {
        let l = self.len();
        if l > 1e-6 {
            self.scale(1.0 / l)
        } else {
            Self::new(0.0, 0.0)
        }
    }
}

#[inline]
pub fn mx(x: f32) -> f32 {
    PLAY_R - x
}

#[inline]
pub fn deg(a: f32) -> f32 {
    a * PI / 180.0
}

#[derive(Debug, Clone, Copy)]
pub struct CapsuleSeg {
    pub a: Vec2,
    pub b: Vec2,
    pub r: f32,
    pub restitution: f32,
    pub is_gate: bool,
    pub is_plunger: bool,
    pub is_apron: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct CirclePost {
    pub pos: Vec2,
    pub r: f32,
    pub restitution: f32,
}

#[derive(Debug, Clone, Copy)]
pub struct FlipperDef {
    pub is_left: bool,
    pub pivot: Vec2,
    pub len: f32,
    pub r1: f32,
    pub r2: f32,
    pub rest: f32,
    pub up: f32,
}

#[derive(Debug, Clone)]
pub struct SlingDef {
    pub posts: [Vec2; 3],
    pub poly: Vec<Vec2>,
    pub face_a: Vec2,
    pub face_c: Vec2,
    pub face_n: Vec2,
    pub r_rub: f32,
    pub r_plast: f32,
}

#[derive(Debug, Clone, Copy)]
pub struct BumperDef {
    pub pos: Vec2,
    pub r: f32,
    pub cap: f32,
}

#[derive(Debug, Clone, Copy)]
pub struct LaneDef {
    pub letter: char,
    pub pos: Vec2,
}

#[derive(Debug, Clone, Copy)]
pub struct LowerLaneDef {
    pub is_out: bool,
    pub pos: Vec2,
}

#[derive(Debug, Clone, Copy)]
pub struct DropDef {
    pub letter: char,
    pub pos: Vec2,
    pub w: f32,
    pub h: f32,
    pub angle: f32,
    pub dir: Vec2,
    pub normal: Vec2,
}

#[derive(Debug, Clone, Copy)]
pub struct StandupDef {
    pub idx: usize, // 0=pointer, 1=tirer, 2=bouchon
    pub label: &'static str,
    pub pos: Vec2,
    pub r: f32,
    pub normal: Option<Vec2>,
}

#[derive(Debug, Clone, Copy)]
pub struct LeftTargetDef {
    pub idx: usize,
    pub pos: Vec2,
    pub half_w: f32,
    pub half_h: f32,
}

#[derive(Debug, Clone, Copy)]
pub struct SaucerDef {
    pub pos: Vec2,
    pub r: f32,
    pub ring: f32,
    pub kick: Vec2, // mm/s
}

#[derive(Debug, Clone, Copy)]
pub struct RampEntryDef {
    pub m: Vec2,
    pub t: Vec2,
    pub u: Vec2,
    pub v: Vec2,
    pub half: f32,
    pub evase: f32,
    pub fond: f32,
    pub sensor: Vec2,
}

#[derive(Debug, Clone, Copy)]
pub struct SpinnerDef {
    pub pos: Vec2,
    pub u: Vec2,
    pub v: Vec2,
    pub half: f32,
}

#[derive(Debug, Clone, Copy)]
pub struct RampPoint {
    pub pos: Vec2,
    pub s: f32,
}

#[derive(Debug, Clone)]
pub struct RampPath {
    pub pts: Vec<RampPoint>,
    pub length: f32,
}

impl RampPath {
    pub fn point_at(&self, s: f32) -> (Vec2, Vec2) {
        if s <= 0.0 {
            let p0 = self.pts[0].pos;
            let d = self.pts[1].pos.sub(p0).norm();
            return (p0, d);
        }
        for i in 1..self.pts.len() {
            if self.pts[i].s >= s {
                let a = self.pts[i - 1];
                let b = self.pts[i];
                let ds = (b.s - a.s).max(1e-5);
                let t = (s - a.s) / ds;
                let pos = Vec2::new(
                    a.pos.x + (b.pos.x - a.pos.x) * t,
                    a.pos.y + (b.pos.y - a.pos.y) * t,
                );
                let dir = b.pos.sub(a.pos).norm();
                return (pos, dir);
            }
        }
        let n = self.pts.len();
        let a = self.pts[n - 2].pos;
        let b = self.pts[n - 1].pos;
        (b, b.sub(a).norm())
    }
}

/// Profil d'altitude de la rampe (mm), identique à `js/sim.js` et `cao/modele.py`
/// (montée à 25° jusqu'à 48 mm, puis légère pente descendante depuis L/3 jusqu'à 34 mm en sortie).
pub fn z_rampe(s: f32, total_len: f32) -> f32 {
    let z_max = 48.0_f32;
    let z_fin = 34.0_f32;
    let pente = deg(25.0).tan();
    let p0 = 3.0 / 30.0;
    let s1 = 20.0;
    let s2 = (z_max + (pente - p0) * s1) / pente;
    let desc = total_len * (2.0 / 3.0);
    let s3 = total_len - desc;
    let mut z = p0 * s.max(0.0);
    let knees = [
        (s1, pente - p0, 20.0),
        (s2, -pente, 50.0),
        (s3, -(z_max - z_fin) / desc, 60.0),
    ];
    for (sk, dm, h) in knees {
        let x = s - sk;
        let f = if x < -h {
            0.0
        } else if x > h {
            x
        } else {
            (x + h) * (x + h) / (4.0 * h)
        };
        z += dm * f;
    }
    z.max(0.0)
}

/// Dérivée dz/ds de la rampe (pente locale).
pub fn dz_ds_rampe(s: f32, total_len: f32) -> f32 {
    let eps = 1.0_f32;
    let s0 = (s - eps).max(0.0);
    let s1 = (s + eps).min(total_len);
    (z_rampe(s1, total_len) - z_rampe(s0, total_len)) / (s1 - s0).max(0.01)
}

#[derive(Debug, Clone, Copy)]
pub struct LampDef {
    pub id: usize,
    pub pos: Vec2,
    pub r: f32,
    pub rgb: (u8, u8, u8),
    pub inner_label: &'static str,
    pub outer_label: &'static str,
    pub outer_above: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct ApronDef {
    pub side: f32,
    pub front: f32,
    pub half: f32,
    pub lane: f32,
}

pub struct TableGeo {
    pub ellipse_cx: f32,
    pub ellipse_cy: f32,
    pub ellipse_rx: f32,
    pub ellipse_ry: f32,
    pub lane_sep_x: f32,
    pub lane_sep_y1: f32,
    pub plunger_x: f32,
    pub plunger_top: f32,
    pub plunger_ball_y: f32,
    pub gate_y: f32,
    pub flippers: [FlipperDef; 2],
    pub slings: [SlingDef; 2],
    pub bumpers: [BumperDef; 3],
    pub lane_posts: [(f32, f32, f32); 5],
    pub lanes: [LaneDef; 4],
    pub lower_lanes: [LowerLaneDef; 6],
    pub drops: [DropDef; 5],
    pub standups: [StandupDef; 3],
    pub left_targets: [LeftTargetDef; 3],
    pub saucer: SaucerDef,
    pub ramp_entry: RampEntryDef,
    pub spinner: SpinnerDef,
    pub spinner_guard: Vec<Vec2>,
    pub ramp_path: RampPath,
    pub apron: ApronDef,
    pub separators: [Vec<Vec2>; 2],
    pub dividers: [(Vec2, Vec2); 2],
    pub deflector: (Vec2, Vec2),
    pub bonus_guide: Vec<Vec2>,
    pub bouchon_piece: Vec<Vec2>,
    pub tirer_plastic: Vec<Vec2>,
    pub drop_housing: Vec<Vec2>,
    pub left_wall_housing: Vec<Vec2>,
    pub enseigne_pts: [Vec2; 4],
    pub segments: Vec<CapsuleSeg>,
    pub posts: Vec<CirclePost>,
    pub lamps: Vec<LampDef>,
}

fn offset_poly(pts: &[Vec2], m: f32, steps: usize) -> Vec<Vec2> {
    let n = pts.len();
    let mut cx = 0.0;
    let mut cy = 0.0;
    for p in pts {
        cx += p.x;
        cy += p.y;
    }
    cx /= n as f32;
    cy /= n as f32;

    let mut nrm = Vec::with_capacity(n);
    let mut ang = Vec::with_capacity(n);
    for i in 0..n {
        let a = pts[i];
        let b = pts[(i + 1) % n];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let l = dx.hypot(dy).max(1e-6);
        let mut nx = -dy / l;
        let mut ny = dx / l;
        if nx * (cx - a.x) + ny * (cy - a.y) > 0.0 {
            nx = -nx;
            ny = -ny;
        }
        nrm.push(Vec2::new(nx, ny));
        ang.push(ny.atan2(nx));
    }

    let mut out = Vec::new();
    for i in 0..n {
        let p = pts[i];
        let prev = (i + n - 1) % n;
        let acw = nrm[prev].x * nrm[i].y - nrm[prev].y * nrm[i].x < 0.0;
        let mut da = ang[i] - ang[prev];
        if acw {
            while da > 0.0 {
                da -= 2.0 * PI;
            }
        } else {
            while da < 0.0 {
                da += 2.0 * PI;
            }
        }
        for s in 0..=steps {
            let a = ang[prev] + da * (s as f32) / (steps as f32);
            out.push(Vec2::new(p.x + a.cos() * m, p.y + a.sin() * m));
        }
    }
    out
}

fn inset_corner(c: Vec2, p1: Vec2, p2: Vec2, r: f32) -> Vec2 {
    let ua = p1.sub(c).norm();
    let ub = p2.sub(c).norm();
    let bis = ua.add(ub).norm();
    let half = ua.dot(ub).clamp(-1.0, 1.0).acos() * 0.5;
    let d = r / half.sin().max(1e-4);
    c.add(bis.scale(d))
}

fn build_ramp_path(points: &[Vec2], step: f32) -> RampPath {
    let mut p = Vec::with_capacity(points.len() + 2);
    p.push(points[0]);
    p.extend_from_slice(points);
    p.push(*points.last().unwrap());

    let mut raw = Vec::new();
    for i in 1..(p.len() - 2) {
        let (p0, p1, p2, p3) = (p[i - 1], p[i], p[i + 1], p[i + 2]);
        let k = ((p2.sub(p1).len() / step).ceil() as usize).max(2);
        for j in 0..k {
            let t = j as f32 / k as f32;
            let t2 = t * t;
            let t3 = t2 * t;
            let catmull = |a: f32, b: f32, c: f32, e: f32| {
                0.5 * (2.0 * b
                    + (-a + c) * t
                    + (2.0 * a - 5.0 * b + 4.0 * c - e) * t2
                    + (-a + 3.0 * b - 3.0 * c + e) * t3)
            };
            raw.push(Vec2::new(
                catmull(p0.x, p1.x, p2.x, p3.x),
                catmull(p0.y, p1.y, p2.y, p3.y),
            ));
        }
    }
    raw.push(*points.last().unwrap());

    let mut pts = Vec::with_capacity(raw.len());
    let mut acc = 0.0;
    for (i, &pos) in raw.iter().enumerate() {
        if i > 0 {
            acc += pos.sub(raw[i - 1]).len();
        }
        pts.push(RampPoint { pos, s: acc });
    }
    RampPath { pts, length: acc }
}

impl TableGeo {
    pub fn build() -> Self {
        let flip_len = 57.7_f32;
        let flip_r1 = 12.0_f32;
        let flip_r2 = 6.5_f32;
        let flip_rest = deg(31.0);
        let flip_up = deg(-20.0);
        let flip_pivot_dx = 87.3_f32; // axes à 6-7/8" (174,6 mm)
        let flip_pivot_y = H - 178.0; // 7" du bas du plateau
        let lpx = CX - flip_pivot_dx;

        let flippers = [
            FlipperDef {
                is_left: true,
                pivot: Vec2::new(lpx, flip_pivot_y),
                len: flip_len,
                r1: flip_r1,
                r2: flip_r2,
                rest: flip_rest,
                up: flip_up,
            },
            FlipperDef {
                is_left: false,
                pivot: Vec2::new(mx(lpx), flip_pivot_y),
                len: flip_len,
                r1: flip_r1,
                r2: flip_r2,
                rest: -flip_rest,
                up: -flip_up,
            },
        ];

        // Guides de couloirs bas
        let top_rest = flip_rest + ((flip_r1 - flip_r2) / flip_len).asin();
        let dir = Vec2::new(top_rest.cos(), top_rest.sin());
        let nrm = Vec2::new(top_rest.sin(), -top_rest.cos());
        let off = flip_r1 - GUIDE_T * 0.5;
        let guide_end = Vec2::new(
            lpx + nrm.x * off - dir.x * 16.0,
            flip_pivot_y + nrm.y * off - dir.y * 16.0,
        );
        let sep_x = 40.0_f32;
        let k_l = (guide_end.x - sep_x) / dir.x;
        let guide_knee = Vec2::new(sep_x, guide_end.y - dir.y * k_l);

        let inlane = 34.0_f32;
        let sl_jeu = 5.0_f32;
        let sling_off = GUIDE_T * 0.5 + inlane + sl_jeu;
        let sling_p0 = Vec2::new(
            guide_knee.x + nrm.x * sling_off,
            guide_knee.y + nrm.y * sling_off,
        );
        let sl_leve = 16.0_f32;
        let sling_line = |x: f32| sling_p0.y + ((x - sling_p0.x) / dir.x) * dir.y - sl_leve;
        let div_x = sep_x + GUIDE_T * 0.5 + inlane + GUIDE_T * 0.5;
        let sl_x1 = div_x + GUIDE_T * 0.5 + inlane;

        let sl_face = 101.0_f32;
        let sl_ang = deg(68.0);
        let sl_rub = 8.0_f32;
        let sl_plast = 10.0_f32;
        let sl_post_line = |x: f32| sling_line(x) - sl_rub / dir.y.atan2(dir.x).cos();
        let sl_p1x = sl_x1 + sl_rub;
        let sl_p2x = sl_p1x + sl_face * sl_ang.cos();
        let sl_p2y = sl_post_line(sl_p2x);
        let sling_posts_l = [
            Vec2::new(sl_p1x, sl_p2y - sl_face * sl_ang.sin()),
            Vec2::new(sl_p1x, sl_post_line(sl_p1x)),
            Vec2::new(sl_p2x, sl_p2y),
        ];
        let sling_posts_r = [
            Vec2::new(mx(sling_posts_l[0].x), sling_posts_l[0].y),
            Vec2::new(mx(sling_posts_l[1].x), sling_posts_l[1].y),
            Vec2::new(mx(sling_posts_l[2].x), sling_posts_l[2].y),
        ];

        let make_sling = |posts: [Vec2; 3]| -> SlingDef {
            let poly = offset_poly(&posts, sl_rub, 6);
            let p_a = posts[0];
            let p_b = posts[1];
            let p_c = posts[2];
            let mut n = Vec2::new(p_c.y - p_a.y, -(p_c.x - p_a.x)).norm();
            if p_b.sub(p_a).dot(n) > 0.0 {
                n = n.scale(-1.0);
            }
            SlingDef {
                posts,
                poly,
                face_a: p_a.add(n.scale(sl_rub)),
                face_c: p_c.add(n.scale(sl_rub)),
                face_n: n,
                r_rub: sl_rub,
                r_plast: sl_plast,
            }
        };
        let slings = [make_sling(sling_posts_l), make_sling(sling_posts_r)];

        // Séparateurs & diviseurs
        let separators = [
            vec![Vec2::new(sep_x, 700.0 + DY), guide_knee, guide_end],
            vec![
                Vec2::new(mx(sep_x), 700.0 + DY),
                Vec2::new(mx(guide_knee.x), guide_knee.y),
                Vec2::new(mx(guide_end.x), guide_end.y),
            ],
        ];
        let dividers = [
            (Vec2::new(div_x, 700.0 + DY), Vec2::new(div_x, sling_line(div_x))),
            (
                Vec2::new(mx(div_x), 700.0 + DY),
                Vec2::new(mx(div_x), sling_line(div_x)),
            ),
        ];
        let deflector = (Vec2::new(0.0, 548.0), Vec2::new(38.0, 580.0));
        let tirer_plastic = vec![
            Vec2::new(-2.0, 544.0),
            Vec2::new(40.0, 578.0),
            Vec2::new(47.0, 614.0),
            Vec2::new(19.0, 627.0),
            Vec2::new(-2.0, 622.0),
        ];
        let bonus_guide = vec![
            Vec2::new(428.0, 424.0),
            Vec2::new(434.0, 385.0),
            Vec2::new(434.0, 245.0),
            Vec2::new(428.0, 185.0),
            Vec2::new(416.0, 152.0),
            Vec2::new(398.0, 131.0),
            Vec2::new(374.0, 117.0),
        ];

        // Bumpers
        let bumpers = [
            BumperDef { pos: Vec2::new(CX - 54.0, 232.0 + YT), r: 28.0, cap: 34.0 },
            BumperDef { pos: Vec2::new(CX + 54.0, 232.0 + YT), r: 28.0, cap: 34.0 },
            BumperDef { pos: Vec2::new(CX, 314.0 + YT), r: 28.0, cap: 34.0 },
        ];

        // Couloirs T-O-U-R
        let lane_posts = [
            (CX - 84.0, 95.0 + YT, 145.0 + YT),
            (CX - 42.0, 95.0 + YT, 145.0 + YT),
            (CX, 95.0 + YT, 145.0 + YT),
            (CX + 42.0, 95.0 + YT, 145.0 + YT),
            (CX + 84.0, 95.0 + YT, 145.0 + YT),
        ];
        let lane_chars = ['T', 'O', 'U', 'R'];
        let lanes = [0, 1, 2, 3].map(|i| LaneDef {
            letter: lane_chars[i],
            pos: Vec2::new(CX - 63.0 + 42.0 * (i as f32), 122.0 + YT),
        });

        // 6 couloirs bas (rollovers)
        let y_low = 746.0 + DY;
        let x_out = (sep_x - GUIDE_T * 0.5) * 0.5;
        let x_in_ext = (sep_x + div_x) * 0.5;
        let x_in_int = (div_x + GUIDE_T * 0.5 + sl_x1) * 0.5;
        let lower_lanes = [
            LowerLaneDef { is_out: true, pos: Vec2::new(x_out, y_low) },
            LowerLaneDef { is_out: false, pos: Vec2::new(x_in_ext, y_low) },
            LowerLaneDef { is_out: false, pos: Vec2::new(x_in_int, y_low) },
            LowerLaneDef { is_out: false, pos: Vec2::new(mx(x_in_int), y_low) },
            LowerLaneDef { is_out: false, pos: Vec2::new(mx(x_in_ext), y_low) },
            LowerLaneDef { is_out: true, pos: Vec2::new(mx(x_out), y_low) },
        ];

        // Banque F-A-N-N-Y
        let drop_dir = Vec2::new(deg(75.0).cos(), deg(75.0).sin());
        let drop_n = Vec2::new(-drop_dir.y, drop_dir.x);
        let drop_x0 = 396.0 - drop_dir.x * 60.0;
        let drop_y0 = 472.0 + DY - drop_dir.y * 60.0;
        let drop_pitch = 31.75_f32;
        let drop_chars = ['F', 'A', 'N', 'N', 'Y'];
        let drop_angle = drop_dir.y.atan2(drop_dir.x);
        let drops = [0, 1, 2, 3, 4].map(|i| DropDef {
            letter: drop_chars[i],
            pos: Vec2::new(
                drop_x0 + drop_dir.x * drop_pitch * (i as f32),
                drop_y0 + drop_dir.y * drop_pitch * (i as f32),
            ),
            w: 22.5,
            h: 8.1,
            angle: drop_angle,
            dir: drop_dir,
            normal: drop_n,
        });
        let back = |x: f32, y: f32, along: f32| {
            Vec2::new(
                x + drop_dir.x * along - drop_n.x * 7.0,
                y + drop_dir.y * along - drop_n.y * 7.0,
            )
        };
        let dh_a = back(drop_x0, drop_y0, -16.0);
        let dh_b = back(drops[4].pos.x, drops[4].pos.y, 16.0);
        let drop_housing = vec![
            dh_a,
            dh_b,
            Vec2::new(PLAY_R + 2.0, dh_b.y + 14.0),
            Vec2::new(PLAY_R + 2.0, dh_a.y - 40.0),
        ];

        // Cibles rondes du mur gauche
        let lw_x = 30.0_f32;
        let lw_y1 = 520.0 + DY;
        let lw_y2 = 640.0 + DY;
        let left_wall_housing = vec![
            Vec2::new(-2.0, lw_y1 - 24.0),
            Vec2::new(lw_x - 4.0, lw_y1),
            Vec2::new(lw_x - 4.0, lw_y2),
            Vec2::new(-2.0, lw_y2 + 24.0),
        ];
        let left_targets = [0, 1, 2].map(|i| LeftTargetDef {
            idx: i,
            pos: Vec2::new(lw_x - 3.0, 540.0 + DY + 40.0 * (i as f32)),
            half_w: 4.0,
            half_h: 19.0,
        });

        // Couloir du bouchon + entrée de rampe
        let r_flip_tgt = Vec2::new(
            mx(lpx) - flip_up.cos() * flip_len * 0.5,
            flip_pivot_y + flip_up.sin() * flip_len * 0.5,
        );
        let bouchon_b = Vec2::new(50.0, 368.0 + YT);
        let bouchon_u = bouchon_b.sub(r_flip_tgt).norm();
        let bouchon_v = Vec2::new(-bouchon_u.y, bouchon_u.x);
        let bouchon_len = 78.0_f32;
        let bouchon_half = 19.0_f32;
        let bouchon_m = bouchon_b.sub(bouchon_u.scale(bouchon_len));

        let ramp_m = Vec2::new(180.0, 450.0 + YT);
        let ramp_u = ramp_m.sub(r_flip_tgt).norm();
        let ramp_v = Vec2::new(-ramp_u.y, ramp_u.x);
        let ramp_len = 85.0_f32;
        let ramp_half = 26.0_f32;
        let ramp_t = ramp_m.add(ramp_u.scale(ramp_len));
        let ramp_entry = RampEntryDef {
            m: ramp_m,
            t: ramp_t,
            u: ramp_u,
            v: ramp_v,
            half: ramp_half,
            evase: 70.0,
            fond: 19.5,
            sensor: ramp_t.sub(ramp_u.scale(14.0)),
        };

        // Cible POINTER encastrée
        let bp_a = bouchon_m.add(bouchon_v.scale(-(bouchon_half + 3.0)));
        let bp_b = Vec2::new(-2.0, 478.0 + YT);
        let bp_e = bp_b.sub(bp_a).norm();
        let bp_n = if bp_e.x < 0.0 {
            Vec2::new(bp_e.y, -bp_e.x)
        } else {
            Vec2::new(-bp_e.y, bp_e.x)
        };
        let pointer_pos = bp_a.add(bp_e.scale(24.0)).add(bp_n);
        let standups = [
            StandupDef {
                idx: 0,
                label: "POINTER",
                pos: pointer_pos,
                r: 11.0,
                normal: Some(bp_n),
            },
            StandupDef {
                idx: 1,
                label: "TIRER",
                pos: Vec2::new(32.0, 618.0),
                r: 11.0,
                normal: None,
            },
            StandupDef {
                idx: 2,
                label: "BOUCHON",
                pos: bouchon_b,
                r: 8.0,
                normal: None,
            },
        ];

        // Le Cercle (saucer) : kick (-6.5, 3.5) mm/frame -> * 60 = (-390, +210) mm/s
        let saucer = SaucerDef {
            pos: Vec2::new(400.0, 318.0 + YT),
            r: 7.0,
            ring: 18.0,
            kick: Vec2::new(-390.0, 210.0),
        };

        // Tourniquet (spinner) & garde de bielle
        let spinner = SpinnerDef {
            pos: ramp_m.add(ramp_u.scale(14.0)),
            u: ramp_u,
            v: ramp_v,
            half: 24.5,
        };
        let spinner_guard: Vec<Vec2> = [
            (25.0, -13.0),
            (35.5, -8.5),
            (37.0, 0.0),
            (35.5, 8.5),
            (25.0, 13.0),
        ]
        .iter()
        .map(|&(lx, ly)| {
            spinner
                .pos
                .add(ramp_v.scale(lx))
                .sub(ramp_u.scale(ly))
        })
        .collect();

        // Enseigne ESCALE
        let w_re = ramp_half + 3.0;
        let pe = |k: f32, a: f32| ramp_m.add(ramp_v.scale(k)).add(ramp_u.scale(a));
        let en_a = 30.0_f32;
        let en_pr = en_a + 20.0 * deg(40.0).cos();
        let en_demi = w_re + 3.0;
        let enseigne_pts = [
            pe(-en_demi, en_a),
            pe(en_demi, en_a),
            pe(en_demi, en_pr),
            pe(-en_demi, en_pr),
        ];

        // Chemin complet de la rampe
        let x_l = 26.0_f32;
        let x_r = PLAY_R - 24.0;
        let y_arc = 160.0 + YT;
        let ecx = (x_l + x_r) * 0.5;
        let erx = (x_r - x_l) * 0.5;
        let ery = y_arc - (36.0 + YT);
        let mut rpts = vec![
            ramp_m,
            ramp_t.sub(ramp_u.scale(14.0)),
            ramp_t.add(ramp_u.scale(30.0)),
            Vec2::new(
                ramp_t.x + ramp_u.x * 30.0 - 34.0,
                ramp_t.y + ramp_u.y * 30.0 - 40.0,
            ),
            Vec2::new(x_l + 8.0, 232.0 + YT),
            Vec2::new(x_l, y_arc + 20.0),
        ];
        for i in 0..=24 {
            let a = PI + (PI * i as f32) / 24.0;
            rpts.push(Vec2::new(ecx + erx * a.cos(), y_arc + ery * a.sin()));
        }
        let y_end = 500.0 + DY;
        let mut y = y_arc + 60.0;
        while y < y_end {
            rpts.push(Vec2::new(x_r, y));
            y += 60.0;
        }
        let inlane_top = Vec2::new((sep_x + div_x) * 0.5, 690.0 + DY);
        let exit = Vec2::new(mx(inlane_top.x), inlane_top.y - 5.0);
        let y_align = exit.y - 60.0;
        for i in 0..=10 {
            let t = i as f32 / 10.0;
            let s = t * t * (3.0 - 2.0 * t);
            rpts.push(Vec2::new(
                x_r + (exit.x - x_r) * s,
                y_end + (y_align - y_end) * t,
            ));
        }
        for i in 1..=4 {
            rpts.push(Vec2::new(
                exit.x,
                y_align + ((exit.y - y_align) * i as f32) / 4.0,
            ));
        }
        let ramp_path = build_ramp_path(&rpts, 6.0);

        // Pièce du bouchon (contour complet avec congé de 20 mm)
        let w_b = bouchon_half + 3.0;
        let p_b = |base: Vec2, k: f32, along: f32| {
            base.add(bouchon_v.scale(k)).add(bouchon_u.scale(along))
        };
        let q_r = |base: Vec2, k: f32| base.add(ramp_v.scale(k));
        let roof_r = q_r(ramp_t, w_re);
        let y_toit = 312.0 + YT;
        let c0 = Vec2::new(0.0, y_toit + ((roof_r.y - y_toit) * 2.0) / (roof_r.x + 2.0));
        let rc = 20.0_f32;
        let o_c = inset_corner(c0, Vec2::new(0.0, 200.0 + YT), roof_r, rc);
        let u_toit = roof_r.sub(c0).norm();
        let proj = o_c.sub(c0).dot(u_toit);
        let foot = c0.add(u_toit.scale(proj));
        let a1 = (foot.y - o_c.y).atan2(foot.x - o_c.x);
        let mut bouchon_piece = vec![Vec2::new(-2.0, o_c.y)];
        for i in 0..=8 {
            let a = PI + ((a1 - PI) * i as f32) / 8.0;
            bouchon_piece.push(Vec2::new(o_c.x + rc * a.cos(), o_c.y + rc * a.sin()));
        }
        bouchon_piece.extend_from_slice(&[
            roof_r,
            q_r(ramp_t, -w_re - 3.0),
            q_r(ramp_m, -w_re - 3.0),
            p_b(bouchon_m, w_b, 0.0),
            p_b(bouchon_b, w_b, 14.0),
            p_b(bouchon_b, -w_b, 14.0),
            p_b(bouchon_m, -w_b, 0.0),
            Vec2::new(-2.0, 478.0 + YT),
        ]);

        // Tablier (apron)
        let apron = ApronDef {
            side: 868.0 + DY,
            front: 960.0 + DY,
            half: 42.0,
            lane: 1000.0 + DY,
        };

        // --- Construction des segments & poteaux de collision 2D ---
        let mut segments = Vec::new();
        let mut posts = Vec::new();
        let mut add_seg = |a: Vec2, b: Vec2, r: f32, rest: f32| {
            segments.push(CapsuleSeg {
                a,
                b,
                r,
                restitution: rest,
                is_gate: false,
                is_plunger: false,
                is_apron: false,
            });
        };

        // 1. Demi-ellipse du haut (48 segments)
        let ellipse_cx = W * 0.5;
        let ellipse_cy = 160.0 + YT;
        let ellipse_rx = W * 0.5;
        let ellipse_ry = 150.0;
        let n_arc = 48;
        for i in 0..n_arc {
            let a1 = PI + (PI * i as f32) / n_arc as f32;
            let a2 = PI + (PI * (i + 1) as f32) / n_arc as f32;
            let p1 = Vec2::new(ellipse_cx + ellipse_rx * a1.cos(), ellipse_cy + ellipse_ry * a1.sin());
            let p2 = Vec2::new(ellipse_cx + ellipse_rx * a2.cos(), ellipse_cy + ellipse_ry * a2.sin());
            add_seg(p1, p2, 0.0, 0.40);
        }
        // Murs latéraux gauche & droit
        add_seg(Vec2::new(0.0, ellipse_cy), Vec2::new(0.0, H + 40.0), 0.0, 0.40);
        add_seg(Vec2::new(W, ellipse_cy), Vec2::new(W, H + 40.0), 0.0, 0.40);

        // 2. Couloir du lanceur & portillon à sens unique
        let lane_sep_x = PLAY_R + 2.0;
        let lane_sep_y1 = 210.0 + YT;
        add_seg(
            Vec2::new(lane_sep_x, lane_sep_y1),
            Vec2::new(lane_sep_x, H + 20.0),
            2.0,
            0.40,
        );
        let plunger_x = (PLAY_R + 4.0 + W) * 0.5;
        let plunger_top = 1000.0 + DY;
        let plunger_ball_y = plunger_top - BALL_R - 1.0;
        let gate_y = 195.0 + YT;

        // 3. Déflecteur gauche & guide bonus droit
        add_seg(deflector.0, deflector.1, 4.0, 0.48);
        for i in 0..(bonus_guide.len() - 1) {
            add_seg(bonus_guide[i], bonus_guide[i + 1], 4.0, 0.42);
        }
        posts.push(CirclePost { pos: bonus_guide[0], r: 5.0, restitution: 0.45 });

        // 4. Séparateurs & diviseurs bas
        for s in &separators {
            for i in 0..(s.len() - 1) {
                add_seg(s[i], s[i + 1], GUIDE_T * 0.5, 0.42);
            }
            posts.push(CirclePost { pos: s[0], r: 5.0, restitution: 0.55 });
        }
        for &(a, b) in &dividers {
            add_seg(a, b, GUIDE_T * 0.5, 0.42);
            posts.push(CirclePost { pos: a, r: GUIDE_T * 0.5 + 1.0, restitution: 0.55 });
            posts.push(CirclePost { pos: b, r: GUIDE_T * 0.5 + 1.0, restitution: 0.55 });
        }

        // 5. Poteaux T-O-U-R
        for &(x, y1, y2) in &lane_posts {
            add_seg(Vec2::new(x, y1), Vec2::new(x, y2), 3.0, 0.45);
        }

        // 6. Bloc derrière F-A-N-N-Y + bloc du mur gauche
        for i in 0..drop_housing.len() {
            add_seg(drop_housing[i], drop_housing[(i + 1) % drop_housing.len()], 1.0, 0.38);
        }
        for i in 0..left_wall_housing.len() {
            add_seg(
                left_wall_housing[i],
                left_wall_housing[(i + 1) % left_wall_housing.len()],
                1.0,
                0.38,
            );
        }

        // 7. Pièce du bouchon (contour complet + fond en pointe)
        for i in 0..(bouchon_piece.len() - 1) {
            add_seg(bouchon_piece[i], bouchon_piece[i + 1], 1.5, 0.42);
        }
        let peak = p_b(bouchon_b, 0.0, 30.0);
        add_seg(p_b(bouchon_b, -w_b, 14.0), peak, 3.0, 0.40);
        add_seg(peak, p_b(bouchon_b, w_b, 14.0), 3.0, 0.40);
        posts.push(CirclePost { pos: p_b(bouchon_m, -w_b, 0.0), r: 4.5, restitution: 0.50 });
        posts.push(CirclePost { pos: p_b(bouchon_m, w_b, 0.0), r: 4.5, restitution: 0.50 });

        // 8. Flancs de l'entrée de rampe
        let wf = ramp_entry.fond + 3.0;
        for sg in [-1.0_f32, 1.0_f32] {
            add_seg(pe(sg * w_re, 0.0), pe(sg * wf, ramp_entry.evase), 3.0, 0.35);
            add_seg(pe(sg * wf, ramp_entry.evase), pe(sg * wf, ramp_len), 3.0, 0.35);
        }

        // 9. Arceau de protection de la bielle du tourniquet
        for i in 0..(spinner_guard.len() - 1) {
            add_seg(spinner_guard[i], spinner_guard[i + 1], 2.0, 0.45);
        }

        // Segments spéciaux (lanceur, portillon à sens unique, bras du tablier)
        segments.push(CapsuleSeg {
            a: Vec2::new(PLAY_R + 4.0, plunger_top),
            b: Vec2::new(W, plunger_top),
            r: 2.0,
            restitution: 0.08,
            is_gate: false,
            is_plunger: true,
            is_apron: false,
        });
        segments.push(CapsuleSeg {
            a: Vec2::new(PLAY_R, gate_y + 11.0),
            b: Vec2::new(W, gate_y - 11.0),
            r: 2.5,
            restitution: 0.30,
            is_gate: true,
            is_plunger: false,
            is_apron: false,
        });

        // 10. Bras du tablier (apron)
        for &(a, b) in &[
            (Vec2::new(0.0, apron.side), Vec2::new(CX - apron.half, apron.front)),
            (Vec2::new(CX + apron.half, apron.front), Vec2::new(PLAY_R, apron.side)),
        ] {
            let d = b.sub(a).norm();
            let n = Vec2::new(-d.y * 3.0, d.x * 3.0);
            segments.push(CapsuleSeg {
                a: a.add(n),
                b: b.add(n),
                r: 3.0,
                restitution: 0.22,
                is_gate: false,
                is_plunger: false,
                is_apron: true,
            });
        }

        // --- 32 pastilles lumineuses (ordre exact WS2812B de LAMP_LAYOUT) ---
        let mut lamps = Vec::with_capacity(32);
        let mut lid = 0usize;
        let mut push_lamp = |pos: Vec2, r: f32, rgb: (u8, u8, u8), inner: &'static str, outer: &'static str, above: bool| {
            lamps.push(LampDef {
                id: lid,
                pos,
                r,
                rgb,
                inner_label: inner,
                outer_label: outer,
                outer_above: above,
            });
            lid += 1;
        };
        // 0..4: lane0..3 (T O U R)
        let l_txt = ["T", "O", "U", "R"];
        for i in 0..4 {
            push_lamp(
                Vec2::new(lanes[i].pos.x, lanes[i].pos.y + 46.0),
                12.5,
                (0xff, 0xd2, 0x3f),
                l_txt[i],
                "",
                false,
            );
        }
        // 4..9: drop0..4 (F A N N Y)
        let d_txt = ["F", "A", "N", "N", "Y"];
        for i in 0..5 {
            push_lamp(
                drops[i].pos.add(drop_n.scale(24.0)),
                11.0,
                (0x4f, 0xc3, 0xff),
                d_txt[i],
                "",
                false,
            );
        }
        // 9: multiball
        push_lamp(
            Vec2::new(saucer.pos.x - 52.0, saucer.pos.y),
            12.5,
            (0xff, 0x3f, 0xa4),
            "",
            "MULTIBALL",
            true,
        );
        // 10: ramp
        push_lamp(
            ramp_m.sub(ramp_u.scale(54.0)),
            12.5,
            (0x7d, 0xff, 0x6a),
            "",
            "ESCALE",
            true,
        );
        // 11: jackpot
        push_lamp(
            ramp_m.sub(ramp_u.scale(88.0)),
            9.5,
            (0xff, 0xe1, 0x4d),
            "",
            "JACKPOT",
            false,
        );
        // 12..19: city0..6
        for (i, &city) in CITIES.iter().enumerate() {
            let t = (i as f32 - 3.0) / 3.0;
            push_lamp(
                Vec2::new(CX + t * 88.0, H - 557.0 + t * t * 24.0),
                9.5,
                (0xff, 0xff, 0xff),
                "",
                city,
                false,
            );
        }
        // 19..23: mult2..5
        let mult_txt = ["X2", "X3", "X4", "X5"];
        let mult_x = [CX - 48.0, CX - 16.0, CX + 16.0, CX + 48.0];
        for i in 0..4 {
            push_lamp(
                Vec2::new(mult_x[i], H - 222.0),
                11.0,
                (0xff, 0xb1, 0x3d),
                mult_txt[i],
                if i == 1 || i == 2 { "BONUS" } else { "" },
                false,
            );
        }
        // 23: extra
        push_lamp(Vec2::new(CX, H - 259.0), 12.5, (0xff, 0x52, 0x52), "", "REJOUE", true);
        // 24: save
        push_lamp(Vec2::new(CX, H - 172.0), 11.0, (0x62, 0xff, 0xda), "", "SAUVE", true);
        // 25: carreau
        push_lamp(
            Vec2::new(standups[1].pos.x + 22.0, standups[1].pos.y + 40.0),
            11.0,
            (0xff, 0x4a, 0x3d),
            "",
            "CARREAU",
            false,
        );
        // 26: bouchon
        push_lamp(
            bouchon_m.add(bouchon_u.scale(34.0)),
            9.5,
            (0xff, 0xd2, 0x3f),
            "",
            "BOUCHON",
            false,
        );
        // 27: point
        push_lamp(
            pointer_pos.add(bp_n.scale(46.0)),
            9.5,
            (0x7d, 0xff, 0x6a),
            "",
            "POINTER",
            false,
        );
        // 28..31: cible0..2
        let b_txt = ["BOULE 1", "BOULE 2", "BOULE 3"];
        for i in 0..3 {
            push_lamp(
                Vec2::new(lw_x + 28.0, 540.0 + DY + 40.0 * (i as f32)),
                8.0,
                (0xff, 0x3f, 0xa4),
                "",
                b_txt[i],
                false,
            );
        }
        // 31: extraLit
        push_lamp(
            Vec2::new(saucer.pos.x - 34.0, saucer.pos.y + 30.0),
            9.5,
            (0xff, 0x52, 0x52),
            "",
            "EXTRA",
            false,
        );

        Self {
            ellipse_cx,
            ellipse_cy,
            ellipse_rx,
            ellipse_ry,
            lane_sep_x,
            lane_sep_y1,
            plunger_x,
            plunger_top,
            plunger_ball_y,
            gate_y,
            flippers,
            slings,
            bumpers,
            lane_posts,
            lanes,
            lower_lanes,
            drops,
            standups,
            left_targets,
            saucer,
            ramp_entry,
            spinner,
            spinner_guard,
            ramp_path,
            apron,
            separators,
            dividers,
            deflector,
            bonus_guide,
            bouchon_piece,
            tirer_plastic,
            drop_housing,
            left_wall_housing,
            enseigne_pts,
            segments,
            posts,
            lamps,
        }
    }
}
