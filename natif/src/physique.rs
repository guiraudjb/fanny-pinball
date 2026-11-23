// Physique : portage de js/sim.js sur rapier3d (Rust). Le monde (colliders fixes, palettes, matières, groupes, rôles)
// est lu dans donnees/monde.json, exporté de la version web par outils/exporter_natif.mjs : les surfaces sont
// exactement celles du jeu web. Ce module refait la boucle : palettes motorisées, caoutchoucs (rebond selon la vitesse,
// hystérésis), coups de bobine des bumpers et lance-pierres, tourniquet, Cercle, lanceur, évacuation, bourrage, tilt.
//
// Repère : celui de la table, en mètres (x à droite, y vers le joueur, z vers l'intérieur du plateau : hauteur h → z = −h).
// Les positions exposées sont en mm.

use rapier3d::crossbeam::channel::{unbounded, Receiver};
use rapier3d::prelude::*;
use rapier3d::na::{Quaternion, Translation3, UnitQuaternion};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

use crate::regles::sw;

const MM: f32 = 0.001;
const DT_MS: f64 = 1000.0 / 480.0;
const G: f32 = 9.81;
const H_VITRE: f32 = 105.0;
const MASSE: f32 = 0.080;
const BILLE_E: f32 = 0.95;
const SPINNER_I: f32 = 2.5e-6;
const V_MAX: f32 = 6.0;
const ROULEMENT: f32 = 0.005;
/// frottement de pivotement au plateau (rad/s²), comme js/sim.js PIVOTEMENT
const PIVOTEMENT: f32 = 13.0;
const LAUNCH_V: f32 = 2.50;
pub const COURSE_LANCEUR: f32 = 50.0;
const BUMPER_V: f32 = 1.25;
const SLING_V: f32 = 1.05;
const DISPERSION_BOBINE: f32 = 0.05;
const NUDGE_V: f32 = 0.27;
const TILT_BOB: f32 = 2.4;
const BOB_TAU: f64 = 1500.0;
const SAUCER_MAX_V: f32 = 0.95;
const GR_WALL: u32 = 0x0001;
const GR_GATE: u32 = 0x0002;
const GR_BALL: u32 = 0x0004;
const GR_PAL: u32 = 0x0008;

fn groupes(membre: u32, filtre: u32) -> InteractionGroups {
    InteractionGroups::new(Group::from_bits_truncate(membre), Group::from_bits_truncate(filtre))
}
fn groupes_js(g: u32) -> InteractionGroups { groupes(g >> 16, g & 0xffff) }

pub struct Reglages {
    pub e1_anneau: f32, pub e1_palette: f32, pub hysteresis: f32, pub v_min: f32,
    pub inertie: f32, pub couple: f32, pub maintien: f32, pub ressort: f32, pub coup_ms: f64, pub eos: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ModeBille { Table, Saucer, Partie }

pub struct Bille {
    pub corps: RigidBodyHandle,
    pub collider: ColliderHandle,
    pub mode: ModeBille,
    pub gate: bool,
    still: f64,
    saucer_ignore_until: f64,
    spinner_at: f64,
    stuck_at: Option<(f32, f32)>,
    nudges: u32,
    v_avant: Option<Vector<f32>>,
    contacts_caout: HashSet<ColliderHandle>,
    pub retiree: bool,
}

#[derive(Clone, Debug)]
pub enum Role {
    Bumper { idx: usize, centre: (f32, f32) },
    Sling { idx: usize, a: (f32, f32), n: (f32, f32) },
    Drop(usize),
    Standup { idx: usize, id: String },
    Target { idx: usize, id: String },
    Lane(usize),
    LowerLane(String),
    Saucer,
    Ramp,
    Autre,
}

pub struct PaletteCorps {
    pub corps: RigidBodyHandle,
    pub collider: ColliderHandle,
    pub cote: char,
    pub px: f32, pub py: f32,
    pub rest: f32, pub up: f32,
    pub a0: f32, pub sens: f32,
    pub angle: f32,
    tenue: bool, debut_coup: f64,
    w_avant: f32,
}

#[derive(Default, Clone)]
pub struct Tourniquet { pub angle: f32, pub omega: f32, tick_angle: f32 }

pub struct Sim {
    pub bodies: RigidBodySet,
    pub colliders: ColliderSet,
    params: IntegrationParameters,
    pipeline: PhysicsPipeline,
    islands: IslandManager,
    broad: DefaultBroadPhase,
    pub narrow: NarrowPhase,
    ij: ImpulseJointSet,
    mj: MultibodyJointSet,
    ccd: CCDSolver,
    pub query: QueryPipeline,
    gravite: Vector<f32>,
    ev_col: Receiver<CollisionEvent>,
    ev_force: Receiver<ContactForceEvent>,
    collecteur: ChannelEventCollector,

    pub geo: Value,
    pub ball_r: f32,
    pub w: f32, pub h: f32, pub cx: f32,
    roles: HashMap<ColliderHandle, Role>,
    caoutchoucs: HashMap<ColliderHandle, bool>,   // true = palette, false = anneau
    drops: Vec<ColliderHandle>,
    rampe: Option<ColliderHandle>,
    pub billes: Vec<Bille>,
    pub palettes: Vec<PaletteCorps>,
    pub reglages: Reglages,

    pub time: f64,
    acc: f64,
    pub held: [bool; 2],
    pub power: bool,
    pub bob: f32,
    last_nudge: f64,
    pub force: f32,
    pub tirage: f32,
    shooter_closed: bool,
    pub drops_up: Vec<bool>,
    pub spinner: Tourniquet,
    pub flash: HashMap<String, f64>,
    pub flash_dir: HashMap<String, (f32, f32)>,
    cool: HashMap<String, f64>,
    pub secoue_auto: bool,
    pub pente_deg: f32,
    graine: u64,
    /// contacts fermés (id, fermé) depuis le dernier relevé, pour les règles
    pub contacts: Vec<(String, bool)>,
}

fn f(v: &Value) -> f32 { v.as_f64().unwrap_or(0.0) as f32 }
fn xy(v: &Value) -> (f32, f32) {
    if let Some(a) = v.as_array() { (f(&a[0]), f(&a[1])) } else { (f(&v["x"]), f(&v["y"])) }
}

impl Sim {
    pub fn charger(chemin: &str) -> Result<Sim, String> {
        let txt = std::fs::read_to_string(chemin).map_err(|e| format!("{chemin} : {e}"))?;
        let m: Value = serde_json::from_str(&txt).map_err(|e| e.to_string())?;
        let ph = &m["physique"];
        let rg = &ph["reglages"];
        let reglages = Reglages {
            e1_anneau: f(&rg["CAOUTCHOUC"]["anneau"]["e1"]), e1_palette: f(&rg["CAOUTCHOUC"]["palette"]["e1"]),
            hysteresis: f(&rg["CAOUTCHOUC"]["hysteresis"]), v_min: f(&rg["CAOUTCHOUC"]["vMin"]),
            inertie: f(&rg["PALETTE"]["inertie"]), couple: f(&rg["PALETTE"]["couple"]), maintien: f(&rg["PALETTE"]["maintien"]),
            ressort: f(&rg["PALETTE"]["ressort"]), coup_ms: rg["PALETTE"]["coupMs"].as_f64().unwrap_or(40.0), eos: f(&rg["PALETTE"]["eos"]),
        };
        let pente = f(&ph["pente_deg"]).to_radians();
        let mut params = IntegrationParameters::default();
        params.dt = (DT_MS / 1000.0) as f32;
        params.num_solver_iterations = std::num::NonZeroUsize::new(ph["iterations"].as_u64().unwrap_or(8) as usize).unwrap();
        params.length_unit = f(&ph["length_unit"]);
        params.normalized_allowed_linear_error = f(&ph["erreur_lineaire"]);
        params.normalized_prediction_distance = ph["prediction"].as_f64().unwrap_or(0.002) as f32;
        let (cs, cr) = unbounded();
        let (fs, fr) = unbounded();
        let mut sim = Sim {
            bodies: RigidBodySet::new(), colliders: ColliderSet::new(), params, pipeline: PhysicsPipeline::new(),
            islands: IslandManager::new(), broad: DefaultBroadPhase::new(), narrow: NarrowPhase::new(),
            ij: ImpulseJointSet::new(), mj: MultibodyJointSet::new(), ccd: CCDSolver::new(), query: QueryPipeline::new(),
            gravite: vector![0.0, G * pente.sin(), G * pente.cos()],
            ev_col: cr, ev_force: fr, collecteur: ChannelEventCollector::new(cs, fs),
            geo: m["geo"].clone(), ball_r: f(&m["BALL_R"]), w: f(&m["W"]), h: f(&m["H"]), cx: f(&m["CX"]),
            roles: HashMap::new(), caoutchoucs: HashMap::new(), drops: vec![], rampe: None, billes: vec![], palettes: vec![], reglages,
            time: 0.0, acc: 0.0, held: [false; 2], power: true, bob: 0.0, last_nudge: -1e9, force: 1.0, tirage: 0.0,
            shooter_closed: false, drops_up: vec![], spinner: Tourniquet::default(), flash: HashMap::new(),
            flash_dir: HashMap::new(), cool: HashMap::new(), secoue_auto: true, pente_deg: f(&ph["pente_deg"]), graine: 0x9e3779b97f4a7c15,
            contacts: vec![],
        };
        for c in m["fixes"].as_array().ok_or("fixes")? {
            let desc = Self::forme(c)?;
            let p = c["pos"].as_array().unwrap();
            let q = c["rot"].as_array().unwrap();
            let rot = UnitQuaternion::from_quaternion(Quaternion::new(f(&q[3]), f(&q[0]), f(&q[1]), f(&q[2])));
            let iso = Isometry::from_parts(Translation3::new(f(&p[0]), f(&p[1]), f(&p[2])), rot);
            let col = desc.position(iso).restitution(f(&c["rebond"])).friction(f(&c["frottement"]))
                .restitution_combine_rule(CoefficientCombineRule::Multiply).friction_combine_rule(CoefficientCombineRule::Multiply)
                .collision_groups(groupes_js(c["groupes"].as_u64().unwrap_or(0) as u32)).sensor(c["capteur"].as_bool().unwrap_or(false))
                .build();
            let h = sim.colliders.insert(col);
            if let Some(k) = c["caoutchouc"].as_str() { sim.caoutchoucs.insert(h, k == "palette"); }
            let r = &c["role"];
            if r["nom"].as_str() == Some("rampe") { sim.rampe = Some(h); }
            let idx = r["idx"].as_u64().unwrap_or(0) as usize;
            let role = match r["type"].as_str().unwrap_or("") {
                "bumper" => Role::Bumper { idx, centre: xy(&r["centre"]) },
                "sling" => Role::Sling { idx, a: xy(&r["A"]), n: xy(&r["n"]) },
                "drop" => { sim.drops.push(h); Role::Drop(idx) }
                "standup" => Role::Standup { idx, id: r["id"].as_str().unwrap_or("").into() },
                "target" => Role::Target { idx, id: r["id"].as_str().unwrap_or("").into() },
                "lane" => Role::Lane(idx),
                "lowerLane" => Role::LowerLane(r["id"].as_str().unwrap_or("").into()),
                "saucer" => Role::Saucer,
                "ramp" => Role::Ramp,
                _ => Role::Autre,
            };
            if !matches!(role, Role::Autre) { sim.roles.insert(h, role); }
        }
        sim.drops_up = vec![true; sim.drops.len()];
        for p in m["palettes"].as_array().ok_or("palettes")? {
            let axe = p["axe"].as_array().unwrap();
            let corps = RigidBodyBuilder::dynamic().translation(vector![f(&axe[0]), f(&axe[1]), f(&axe[2])])
                .locked_axes(LockedAxes::TRANSLATION_LOCKED | LockedAxes::ROTATION_LOCKED_X | LockedAxes::ROTATION_LOCKED_Y)
                .gravity_scale(0.0).can_sleep(false).ccd_enabled(true).angular_damping(0.0).build();
            let hb = sim.bodies.insert(corps);
            let c = &p["collider"];
            let i = sim.reglages.inertie;
            let (cp, cq) = (c["pos"].as_array().unwrap(), c["rot"].as_array().unwrap());
            let iso = Isometry::from_parts(Translation3::new(f(&cp[0]), f(&cp[1]), f(&cp[2])),
                UnitQuaternion::from_quaternion(Quaternion::new(f(&cq[3]), f(&cq[0]), f(&cq[1]), f(&cq[2]))));
            let col = Self::forme(c)?.position(iso).restitution(f(&c["rebond"])).friction(f(&c["frottement"]))
                .restitution_combine_rule(CoefficientCombineRule::Multiply).friction_combine_rule(CoefficientCombineRule::Multiply)
                .collision_groups(groupes(GR_PAL, GR_BALL))
                .mass_properties(MassProperties::new(point![0.0, 0.0, 0.0], 0.1, vector![i, i, i])).build();
            let hc = sim.colliders.insert_with_parent(col, hb, &mut sim.bodies);
            sim.caoutchoucs.insert(hc, true);
            let a0 = f(&p["angle0"]);
            sim.palettes.push(PaletteCorps {
                corps: hb, collider: hc, cote: if p["side"].as_str() == Some("L") { 'L' } else { 'R' },
                px: f(&p["px"]), py: f(&p["py"]), rest: f(&p["rest"]), up: f(&p["up"]), a0, sens: f(&p["sens"]), angle: a0,
                tenue: false, debut_coup: -1e9, w_avant: 0.0,
            });
        }
        Ok(sim)
    }

    fn forme(c: &Value) -> Result<ColliderBuilder, String> {
        let fo = &c["forme"];
        let pts = |k: &str| -> Vec<Point<f32>> {
            fo[k].as_array().unwrap().chunks(3).map(|q| point![f(&q[0]), f(&q[1]), f(&q[2])]).collect()
        };
        Ok(match fo["type"].as_str().unwrap_or("") {
            "boule" => ColliderBuilder::ball(f(&fo["r"])),
            "pave" => { let d = fo["demi"].as_array().unwrap(); ColliderBuilder::cuboid(f(&d[0]), f(&d[1]), f(&d[2])) }
            "cylindre" => ColliderBuilder::cylinder(f(&fo["demiH"]), f(&fo["r"])),
            "convexe" => ColliderBuilder::convex_hull(&pts("pts")).ok_or("enveloppe convexe impossible")?,
            "maillage" => {
                let idx: Vec<[u32; 3]> = fo["idx"].as_array().unwrap().chunks(3)
                    .map(|q| [q[0].as_u64().unwrap() as u32, q[1].as_u64().unwrap() as u32, q[2].as_u64().unwrap() as u32]).collect();
                ColliderBuilder::trimesh_with_flags(pts("pts"), idx, TriMeshFlags::FIX_INTERNAL_EDGES)
            }
            t => return Err(format!("forme inconnue {t}")),
        })
    }

    fn hasard(&mut self) -> f32 {
        self.graine ^= self.graine << 13; self.graine ^= self.graine >> 7; self.graine ^= self.graine << 17;
        ((self.graine >> 40) as f32) / ((1u64 << 24) as f32)
    }
    fn g(&self, a: &str, b: &str) -> f32 { f(&self.geo[a][b]) }

    pub fn set_pente(&mut self, deg: f32) -> f32 {
        let d = (deg.clamp(4.5, 8.5) * 10.0).round() / 10.0;
        self.pente_deg = d;
        let p = d.to_radians();
        self.gravite = vector![0.0, G * p.sin(), G * p.cos()];
        d
    }

    // ------------------------------------------------------------ billes
    pub fn make_ball(&mut self, x: f32, y: f32) -> usize {
        let r = self.ball_r * MM;
        let corps = RigidBodyBuilder::dynamic().translation(vector![x * MM, y * MM, -(self.ball_r + 0.05) * MM])
            .ccd_enabled(true).can_sleep(false).linear_damping(0.02).angular_damping(0.05).build();
        let hb = self.bodies.insert(corps);
        let col = ColliderBuilder::ball(r).density(MASSE / (4.0 / 3.0 * std::f32::consts::PI * r * r * r))
            .restitution(BILLE_E).friction(1.0)
            .restitution_combine_rule(CoefficientCombineRule::Multiply).friction_combine_rule(CoefficientCombineRule::Multiply)
            .active_events(ActiveEvents::COLLISION_EVENTS).collision_groups(groupes(GR_BALL, GR_WALL | GR_BALL | GR_PAL)).build();
        let hc = self.colliders.insert_with_parent(col, hb, &mut self.bodies);
        self.billes.push(Bille {
            corps: hb, collider: hc, mode: ModeBille::Table, gate: false, still: 0.0, saucer_ignore_until: 0.0, spinner_at: -1e9,
            stuck_at: None, nudges: 0, v_avant: None, contacts_caout: HashSet::new(), retiree: false,
        });
        self.billes.len() - 1
    }
    pub fn position(&self, i: usize) -> (f32, f32) {
        let t = self.bodies[self.billes[i].corps].translation();
        (t.x / MM, t.y / MM)
    }
    pub fn hauteur(&self, i: usize) -> f32 { -self.bodies[self.billes[i].corps].translation().z / MM - self.ball_r }
    pub fn vitesse(&self, i: usize) -> f32 { self.bodies[self.billes[i].corps].linvel().norm() }
    pub fn rotation(&self, i: usize) -> UnitQuaternion<f32> { *self.bodies[self.billes[i].corps].rotation() }
    fn retirer(&mut self, i: usize) {
        let b = &mut self.billes[i];
        if b.retiree { return; }
        b.retiree = true;
        let hb = b.corps;
        self.bodies.remove(hb, &mut self.islands, &mut self.colliders, &mut self.ij, &mut self.mj, true);
    }
    #[allow(dead_code)]
    pub fn clear(&mut self) {
        for i in 0..self.billes.len() { self.retirer(i); }
        self.billes.clear();
        self.shooter_closed = false;
        self.spinner = Tourniquet::default();
        self.reset_drops();
    }
    fn dans_lanceur(&self, i: usize) -> bool {
        let (x, y) = self.position(i);
        x > self.geo["playRight"].as_f64().unwrap() as f32 + 4.0 && y > self.g("plunger", "top") - 120.0
    }
    fn set_vitesse_si(&mut self, i: usize, v: Vector<f32>) { self.bodies[self.billes[i].corps].set_linvel(v, true); }

    // ------------------------------------------------------------ bobines
    pub fn coil(&mut self, b: crate::regles::Bobine) {
        use crate::regles::Bobine::*;
        match b {
            Trough => {
                let occupe = (0..self.billes.len()).any(|i| self.billes[i].mode == ModeBille::Table && !self.billes[i].retiree && self.dans_lanceur(i));
                let (x, y) = (self.g("plunger", "x"), self.g("plunger", "ballY"));
                self.make_ball(x, if occupe { y - 60.0 } else { y });
            }
            Launch => {
                for i in 0..self.billes.len() {
                    if self.billes[i].mode == ModeBille::Table && !self.billes[i].retiree && self.dans_lanceur(i) {
                        let k = 1.0 + (self.hasard() - 0.5) * 0.04;
                        self.set_vitesse_si(i, vector![0.0, -(LAUNCH_V * self.force * k), 0.0]);
                    }
                }
                self.flash.insert("plunger".into(), self.time);
            }
            Saucer => {
                let (sx, sy) = (self.g("saucer", "x"), self.g("saucer", "y"));
                let kick = (f(&self.geo["saucer"]["kick"]["x"]), f(&self.geo["saucer"]["kick"]["y"]));
                for i in 0..self.billes.len() {
                    if self.billes[i].mode != ModeBille::Saucer { continue; }
                    self.billes[i].mode = ModeBille::Table;
                    self.billes[i].saucer_ignore_until = self.time + 900.0;
                    let r = self.ball_r;
                    let (h1, h2) = (self.hasard(), self.hasard());
                    let corps = &mut self.bodies[self.billes[i].corps];
                    corps.set_enabled(true);
                    corps.set_translation(vector![sx * MM, (sy + 2.0) * MM, -(r + 0.5) * MM], true);
                    // vitesse en mm par image de 16,7 ms (unités de js/sim.js) → m/s
                    let k = 60.0 * MM;
                    corps.set_linvel(vector![(kick.0 + (h1 - 0.5) * 2.0) * k, (kick.1 + (h2 - 0.5) * 2.0) * k, 0.0], true);
                }
                self.flash.insert("saucer".into(), self.time);
            }
            DropReset => self.reset_drops(),
            PowerOff => self.power = false,
            PowerOn => self.power = true,
            Knocker => {}
        }
    }
    fn reset_drops(&mut self) {
        for &h in &self.drops { if let Some(c) = self.colliders.get_mut(h) { c.set_enabled(true); } }
        for d in self.drops_up.iter_mut() { *d = true; }
    }
    fn debounce(&mut self, cle: &str, ms: f64) -> bool {
        if let Some(&t) = self.cool.get(cle) { if self.time - t < ms { return false; } }
        self.cool.insert(cle.into(), self.time);
        true
    }
    fn switch(&mut self, id: &str) { self.contacts.push((id.into(), true)); }

    // choc bille / élément
    fn contact(&mut self, i: usize, role: Role, post: &mut Vec<Box<dyn FnOnce(&mut Sim)>>) {
        if self.billes[i].mode != ModeBille::Table { return; }
        let (x, y) = self.position(i);
        let t = self.time;
        match role {
            Role::Bumper { idx, centre } => {
                if !self.power || !self.debounce(&format!("bumper{idx}"), 60.0) { return; }
                self.flash.insert(format!("bumper{idx}"), t);
                let (dx, dy) = (x - centre.0, y - centre.1);
                let l = dx.hypot(dy).max(1e-6);
                self.flash_dir.insert(format!("bumper{idx}"), (dx / l, dy / l));
                post.push(Box::new(move |s: &mut Sim| {
                    let (px, py) = s.position(i);
                    let (dx, dy) = (px - centre.0, py - centre.1);
                    let l = dx.hypot(dy).max(1e-6);
                    s.frapper(i, dx / l, dy / l, BUMPER_V);
                }));
                self.switch(sw::BUMPERS[idx.min(2)]);
            }
            Role::Sling { idx, a, n } => {
                let cote = (x - a.0) * n.0 + (y - a.1) * n.1;
                if cote < self.ball_r * 0.5 { return; }
                if !self.power || !self.debounce(&format!("sling{idx}"), 200.0) { return; }
                self.flash.insert(format!("sling{idx}"), t);
                post.push(Box::new(move |s: &mut Sim| s.frapper(i, n.0, n.1, SLING_V)));
                self.switch(sw::SLINGS[idx.min(1)]);
            }
            Role::Drop(idx) => {
                if !self.drops_up.get(idx).copied().unwrap_or(false) { return; }
                self.drops_up[idx] = false;
                let h = self.drops[idx];
                post.push(Box::new(move |s: &mut Sim| { if let Some(c) = s.colliders.get_mut(h) { c.set_enabled(false); } }));
                self.switch(sw::DROPS[idx.min(4)]);
            }
            Role::Standup { idx, id } => {
                if !self.debounce(&format!("standup{idx}"), 250.0) { return; }
                self.flash.insert(format!("standup{idx}"), t);
                let id = if id.is_empty() { sw::STANDUPS[idx.min(2)].to_string() } else { id };
                self.switch(&id);
            }
            Role::Target { idx, id } => {
                if !self.debounce(&format!("target{idx}"), 250.0) { return; }
                self.flash.insert(format!("target{idx}"), t);
                self.switch(&id);
            }
            Role::Lane(idx) => {
                if !self.debounce(&format!("lane{idx}"), 300.0) { return; }
                self.flash.insert(format!("lane{idx}"), t);
                self.switch(sw::LANES[idx.min(3)]);
            }
            Role::LowerLane(id) => {
                if !self.debounce(&id, 300.0) { return; }
                self.flash.insert(id.clone(), t);
                self.switch(&id);
            }
            Role::Saucer => {
                if self.time < self.billes[i].saucer_ignore_until || self.vitesse(i) > SAUCER_MAX_V { return; }
                self.billes[i].mode = ModeBille::Saucer;
                let (sx, sy, r) = (self.g("saucer", "x"), self.g("saucer", "y"), self.ball_r);
                post.push(Box::new(move |s: &mut Sim| {
                    let c = &mut s.bodies[s.billes[i].corps];
                    c.set_translation(vector![sx * MM, sy * MM, -(r - 7.0) * MM], true);
                    c.set_linvel(vector![0.0, 0.0, 0.0], true);
                    c.set_angvel(vector![0.0, 0.0, 0.0], true);
                    c.set_enabled(false);
                }));
                self.switch(sw::SAUCER);
            }
            Role::Ramp => {
                if !self.debounce("rampL", 400.0) { return; }
                self.flash.insert("rampL".into(), t);
                self.switch(sw::RAMP);
            }
            Role::Autre => {}
        }
    }

    /// coup d'une pièce mobile le long de la normale : vitesse normale = rebond physique (s'il s'éloigne déjà) + coup
    fn frapper(&mut self, i: usize, nx: f32, ny: f32, kick: f32) {
        if self.billes[i].retiree { return; }
        let k = kick * (1.0 + (self.hasard() * 2.0 - 1.0) * DISPERSION_BOBINE);
        let c = &mut self.bodies[self.billes[i].corps];
        let v = *c.linvel();
        let vn = v.x * nx + v.y * ny;
        let dv = vn.max(0.0) + k - vn;
        c.set_linvel(vector![v.x + nx * dv, v.y + ny * dv, v.z], true);
    }

    // ------------------------------------------------------------ boucle
    pub fn step(&mut self, dt_ms: f64) {
        self.acc += dt_ms.min(100.0);
        while self.acc >= DT_MS {
            self.acc -= DT_MS;
            self.substep(DT_MS);
        }
        self.frame_checks(dt_ms);
    }

    fn substep(&mut self, dt: f64) {
        self.time += dt;
        for k in 0..self.palettes.len() {
            let tenue = self.power && self.held[if self.palettes[k].cote == 'L' { 0 } else { 1 }];
            self.bobine(k, tenue);
        }
        let (gate_y, gate_drop, play_r) = (self.g("gate", "y"), self.g("gate", "drop"), self.geo["playRight"].as_f64().unwrap() as f32);
        for i in 0..self.billes.len() {
            if self.billes[i].mode != ModeBille::Table || self.billes[i].retiree { continue; }
            let (x, y) = self.position(i);
            if y < gate_y - gate_drop / 2.0 - self.ball_r - 6.0 && x < play_r - 4.0 { self.billes[i].gate = true; }
            else if x > play_r && y > gate_y + gate_drop / 2.0 + self.ball_r + 4.0 { self.billes[i].gate = false; }
            let g = groupes(GR_BALL, GR_WALL | GR_BALL | GR_PAL | if self.billes[i].gate { GR_GATE } else { 0 });
            self.colliders[self.billes[i].collider].set_collision_groups(g);
            self.billes[i].v_avant = Some(*self.bodies[self.billes[i].corps].linvel());
        }
        for p in self.palettes.iter_mut() { p.w_avant = self.bodies[p.corps].angvel().z; }

        self.params.dt = (dt / 1000.0) as f32;
        self.pipeline.step(&self.gravite, &self.params, &mut self.islands, &mut self.broad, &mut self.narrow, &mut self.bodies,
            &mut self.colliders, &mut self.ij, &mut self.mj, &mut self.ccd, Some(&mut self.query), &(), &self.collecteur);
        while self.ev_force.try_recv().is_ok() {}
        for k in 0..self.palettes.len() { self.butees(k); }
        for i in 0..self.billes.len() {
            if !self.billes[i].retiree && self.billes[i].mode == ModeBille::Table && self.billes[i].v_avant.is_some() { self.caoutchouc(i); }
        }
        let mut post: Vec<Box<dyn FnOnce(&mut Sim)>> = vec![];
        while let Ok(ev) = self.ev_col.try_recv() {
            if let CollisionEvent::Started(h1, h2, _) = ev {
                let (bille, autre) = if let Some(i) = self.billes.iter().position(|b| !b.retiree && b.collider == h1) { (i, h2) }
                    else if let Some(i) = self.billes.iter().position(|b| !b.retiree && b.collider == h2) { (i, h1) } else { continue };
                if let Some(role) = self.roles.get(&autre).cloned() { self.contact(bille, role, &mut post); }
            }
        }
        for job in post { job(self); }

        let drain_y = f(&self.geo["drainY"]);
        for i in 0..self.billes.len() {
            if self.billes[i].mode != ModeBille::Table || self.billes[i].retiree { continue; }
            let h = self.hauteur(i);
            let c = &mut self.bodies[self.billes[i].corps];
            let v = *c.linvel();
            let sp = v.norm();
            if sp > V_MAX { c.set_linvel(v * (V_MAX / sp), true); }
            else if h < 0.3 && sp > 0.005 {
                // freinage de roulement : vitesse et rotation réduites ensemble (la bille continue de rouler sans glisser)
                let k = (1.0 - (ROULEMENT * G * dt as f32) / 1000.0 / sp).max(0.0);
                let w = *c.angvel();
                c.set_linvel(vector![v.x * k, v.y * k, v.z], true);
                c.set_angvel(w * k, true);
            } else if sp > 0.005 && self.sur_rampe(self.billes[i].collider) {
                // même résistance au roulement sur le fond de la rampe (vitesse 3D : le fond est en pente)
                let k = (1.0 - (ROULEMENT * G * dt as f32) / 1000.0 / sp).max(0.0);
                let c = &mut self.bodies[self.billes[i].corps];
                let w = *c.angvel();
                c.set_linvel(v * k, true);
                c.set_angvel(w * k, true);
            }
            if h < 0.3 {
                let c = &mut self.bodies[self.billes[i].corps];
                let w = *c.angvel();
                let dw = PIVOTEMENT * dt as f32 / 1000.0;
                let wz = if w.z.abs() <= dw { 0.0 } else { w.z - w.z.signum() * dw };
                if w.z != 0.0 { c.set_angvel(vector![w.x, w.y, wz], true); }
            }
            let (x, y) = self.position(i);
            if y > drain_y || x < -20.0 || x > self.w + 20.0 || y < -40.0 || h > H_VITRE + 20.0 || h < -40.0 {
                self.billes[i].mode = ModeBille::Partie;
                self.retirer(i);
                self.switch(sw::DRAIN);
            }
        }
        self.billes.retain(|b| b.mode != ModeBille::Partie);
        self.step_spinner(dt);
    }

    /// la bille roule-t-elle sur le fond de la rampe ? (contact réel, normale proche de la verticale)
    fn sur_rampe(&self, bille: ColliderHandle) -> bool {
        let Some(r) = self.rampe else { return false };
        let Some(p) = self.narrow.contact_pair(bille, r) else { return false };
        p.manifolds.iter().any(|m| m.data.normal.z.abs() >= 0.7 && m.points.iter().any(|q| q.dist < 0.0005))
    }

    /// caoutchoucs au contact de la bille après le pas : rebond e(v) au premier contact, hystérésis ensuite
    fn caoutchouc(&mut self, i: usize) {
        let hb = self.billes[i].collider;
        let avant = std::mem::take(&mut self.billes[i].contacts_caout);
        let mut maintenant = HashSet::new();
        let v0 = self.billes[i].v_avant.unwrap();
        let mut impulsions: Vec<(Vector<f32>, Option<(usize, Point<f32>, Vector<f32>)>)> = vec![];
        let mut pertes: Vec<(Vector<f32>, f32, Option<(usize, Point<f32>)>)> = vec![];
        let corps = self.billes[i].corps;
        for pair in self.narrow.contact_pairs_with(hb) {
            let autre = if pair.collider1 == hb { pair.collider2 } else { pair.collider1 };
            let Some(&est_palette) = self.caoutchoucs.get(&autre) else { continue };
            for m in &pair.manifolds {
                if m.data.solver_contacts.is_empty() { continue; }
                maintenant.insert(autre);
                let s = if pair.collider1 == hb { -1.0 } else { 1.0 };
                let n0 = m.data.normal * s;
                let ln = n0.x.hypot(n0.y).max(1e-6);
                let n = vector![n0.x / ln, n0.y / ln, 0.0];
                let pt = m.data.solver_contacts[0].point;
                let pal = if est_palette { self.palettes.iter().position(|p| p.collider == autre) } else { None };
                let (rx, ry) = match pal { Some(k) => (pt.x - self.palettes[k].px * MM, pt.y - self.palettes[k].py * MM), None => (0.0, 0.0) };
                let vs = |w: f32| vector![-w * ry, w * rx, 0.0];
                let (s0, s1) = match pal { Some(k) => (vs(self.palettes[k].w_avant), vs(self.bodies[self.palettes[k].corps].angvel().z)), None => (Vector::zeros(), Vector::zeros()) };
                let v1 = *self.bodies[corps].linvel();
                let vn0 = (v0 - s0).dot(&n);
                let rel1 = v1 - s1;
                let vn1 = rel1.dot(&n);
                let rxn = rx * n.y - ry * n.x;
                let inv_m = 1.0 / MASSE + if pal.is_some() { rxn * rxn / self.reglages.inertie } else { 0.0 };
                if !avant.contains(&autre) {
                    if vn0 < -self.reglages.v_min {
                        let e1 = if est_palette { self.reglages.e1_palette } else { self.reglages.e1_anneau };
                        let e = (1.0 - (1.0 - e1) * (-vn0).powf(0.2)).max(0.0);
                        let dv = e * -vn0 - vn1;
                        if dv > 0.0 {
                            let j = dv / inv_m;
                            impulsions.push((n * (j / MASSE), pal.map(|k| (k, pt, -n * j))));
                        }
                    }
                } else {
                    let jn: f32 = m.points.iter().map(|p| p.data.impulse).sum();
                    let vt = rel1 - n * vn1;
                    let lt = vt.norm();
                    if lt > 1e-4 && jn > 0.0 {
                        let dv = lt.min(self.reglages.hysteresis * jn / MASSE);
                        pertes.push((vt * (dv / lt), dv, pal.map(|k| (k, pt))));
                    }
                }
            }
        }
        for (dv, pal) in impulsions {
            let c = &mut self.bodies[corps];
            let v = *c.linvel();
            c.set_linvel(v + dv, true);
            if let Some((k, pt, j)) = pal { self.bodies[self.palettes[k].corps].apply_impulse_at_point(vector![j.x, j.y, 0.0], pt, true); }
        }
        for (dvt, dv, pal) in pertes {
            let c = &mut self.bodies[corps];
            let v = *c.linvel();
            let sp = v.norm().max(1e-6);
            c.set_linvel(v - dvt, true);
            let w = *c.angvel();
            c.set_angvel(w * (1.0 - dv / sp).max(0.0), true);
            if let Some((k, pt)) = pal { self.bodies[self.palettes[k].corps].apply_impulse_at_point(vector![MASSE * dvt.x, MASSE * dvt.y, 0.0], pt, true); }
        }
        self.billes[i].contacts_caout = maintenant;
    }

    /// bobine d'une palette motorisée : coup de puissance à l'appui (et à la fin de course perdue), maintien, ressort
    fn bobine(&mut self, k: usize, tenue: bool) {
        let r = &self.reglages;
        let (couple, maintien, ressort, coup_ms, eos) = (r.couple, r.maintien, r.ressort, r.coup_ms, r.eos);
        let p = &mut self.palettes[k];
        if tenue && !p.tenue { p.debut_coup = self.time; }
        p.tenue = tenue;
        let mut en_coup = tenue && self.time - p.debut_coup < coup_ms;
        if tenue && !en_coup && (p.up - p.angle).abs() > eos { p.debut_coup = self.time; en_coup = true; }
        let c = (if tenue { if en_coup { couple } else { maintien } } else { 0.0 }) - ressort;
        let sens = p.sens;
        let b = &mut self.bodies[p.corps];
        b.reset_torques(false);
        b.add_torque(vector![0.0, 0.0, sens * c], true);
    }
    /// butées de la palette (arrêt sans rebond) ; met à jour l'angle
    fn butees(&mut self, k: usize) {
        let p = &mut self.palettes[k];
        let b = &mut self.bodies[p.corps];
        let q = b.rotation();
        let mut a = p.a0 + 2.0 * q.k.atan2(q.w);
        let (lo, hi) = (p.rest.min(p.up), p.rest.max(p.up));
        if a < lo || a > hi {
            a = a.clamp(lo, hi);
            let h = (a - p.a0) / 2.0;
            b.set_rotation(UnitQuaternion::from_quaternion(Quaternion::new(h.cos(), 0.0, 0.0, h.sin())), true);
            b.set_angvel(vector![0.0, 0.0, 0.0], true);
        }
        p.angle = a;
    }

    /// tourniquet : la bille lance la plaque, chaque tour complet ferme SW.SPINNER ; l'énergie de la plaque est prise à la bille
    fn step_spinner(&mut self, dt: f64) {
        let sp = &self.geo["spinner"];
        if sp.is_null() { return; }
        let (sx, sy, half) = (f(&sp["x"]), f(&sp["y"]), f(&sp["half"]));
        let u = (f(&sp["u"]["x"]), f(&sp["u"]["y"]));
        let v = (f(&sp["v"]["x"]), f(&sp["v"]["y"]));
        for i in 0..self.billes.len() {
            if self.billes[i].mode != ModeBille::Table || self.billes[i].retiree || self.hauteur(i) > 18.0 { continue; }
            let (x, y) = self.position(i);
            let (dx, dy) = (x - sx, y - sy);
            let along = dx * u.0 + dy * u.1;
            let across = dx * v.0 + dy * v.1;
            if along.abs() < 12.0 && across.abs() < half - 2.0 && self.time - self.billes[i].spinner_at > 150.0 {
                let c = &mut self.bodies[self.billes[i].corps];
                let lv = *c.linvel();
                let vu = lv.x * u.0 + lv.y * u.1;
                if vu.abs() > 0.12 {
                    self.billes[i].spinner_at = self.time;
                    let w_hit = (vu * 30.0).clamp(-75.0, 75.0);
                    let w0 = self.spinner.omega;
                    self.spinner.omega = if w_hit.abs() > w0.abs() { w_hit } else { (w0 + w_hit * 0.45).clamp(-85.0, 85.0) };
                    let de = 0.5 * SPINNER_I * (self.spinner.omega.powi(2) - w0 * w0);
                    if de > 0.0 {
                        let k = (1.0 - 2.0 * de / (MASSE * lv.norm_squared().max(1e-9))).max(0.0).sqrt();
                        c.set_linvel(lv * k, true);
                    }
                    self.flash.insert("spinner".into(), self.time);
                }
            }
        }
        let s = &mut self.spinner;
        if s.omega.abs() > 0.01 || s.angle.sin().abs() > 0.002 {
            let dts = (dt / 1000.0) as f32;
            let drag = -0.82 * s.omega - if s.omega.abs() > 0.2 { s.omega.signum() * 0.45 } else { 0.0 };
            s.omega += (-26.0 * s.angle.sin() + drag) * dts;
            s.angle += s.omega * dts;
            let mut tours = 0;
            while (s.angle - s.tick_angle).abs() >= std::f32::consts::TAU {
                s.tick_angle += (s.angle - s.tick_angle).signum() * std::f32::consts::TAU;
                tours += 1;
            }
            if s.omega.abs() < 0.06 && s.angle.sin().abs() < 0.025 && s.angle.cos() > 0.9 { *s = Tourniquet::default(); }
            for _ in 0..tours { self.flash.insert("spinner".into(), self.time); self.switch(sw::SPINNER); }
        }
    }

    /// bourrage : dx = 0 frontal, −1 coup latéral gauche, +1 droit ; renvoie true si le tilt doit être signalé
    pub fn nudge(&mut self, dx: f32) -> bool {
        if self.time - self.last_nudge < 250.0 { return false; }
        self.last_nudge = self.time;
        for i in 0..self.billes.len() {
            if self.billes[i].mode != ModeBille::Table || self.billes[i].retiree || self.dans_lanceur(i) { continue; }
            let h = self.hasard();
            let c = &mut self.bodies[self.billes[i].corps];
            let v = *c.linvel();
            let vx = if dx != 0.0 { dx * NUDGE_V * 1.15 } else { (h - 0.5) * 0.18 };
            let vy = if dx != 0.0 { -NUDGE_V * 0.35 } else { -NUDGE_V };
            c.set_linvel(vector![v.x + vx, v.y + vy, v.z], true);
        }
        self.bob += 1.0;
        if self.bob >= TILT_BOB { self.bob = 0.8; self.switch(sw::TILT); }
        true
    }

    fn frame_checks(&mut self, dt_ms: f64) {
        self.bob *= (-dt_ms / BOB_TAU).exp() as f32;
        let play_r = self.geo["playRight"].as_f64().unwrap() as f32;
        let ball_y = self.g("plunger", "ballY");
        let dans = (0..self.billes.len()).any(|i| {
            let b = &self.billes[i];
            if b.mode != ModeBille::Table || b.retiree { return false; }
            let (x, y) = self.position(i);
            x > play_r + 4.0 && y > ball_y - 8.0 && self.bodies[b.corps].linvel().y.abs() < 0.8 * 60.0 * MM
        });
        if dans != self.shooter_closed { self.shooter_closed = dans; self.contacts.push((sw::SHOOTER.into(), dans)); }
        let fy = f(&self.geo["flippers"][0]["py"]);
        for i in 0..self.billes.len() {
            if !self.secoue_auto || self.billes[i].mode != ModeBille::Table || self.billes[i].retiree || self.dans_lanceur(i) { self.billes[i].still = 0.0; continue; }
            let (x, y) = self.position(i);
            let tenue = y > fy - 90.0 && ((self.held[0] && x < self.cx) || (self.held[1] && x >= self.cx));
            if self.vitesse(i) < 0.03 && !tenue { self.billes[i].still += dt_ms; } else { self.billes[i].still = 0.0; }
            if self.billes[i].still > 1500.0 {
                self.billes[i].still = 0.0;
                let loin = self.billes[i].stuck_at.map_or(true, |(sx, sy)| (x - sx).hypot(y - sy) > 30.0);
                if loin { self.billes[i].stuck_at = Some((x, y)); self.billes[i].nudges = 0; }
                self.billes[i].nudges += 1;
                let (dx, dy) = (self.cx - x, self.h * 0.45 - y);
                let l = dx.hypot(dy).max(1e-6);
                let k = 4.0 + 3.0 * self.billes[i].nudges.min(4) as f32;
                let (h1, h2) = (self.hasard(), self.hasard());
                let m = 60.0 * MM;
                self.set_vitesse_si(i, vector![(dx / l * k + (h1 - 0.5) * 3.0) * m, (dy / l * k - 3.0) * m, 0.0] + vector![0.0, 0.0, 0.0 * h2]);
            }
        }
    }

    #[allow(dead_code)]
    pub fn set_roulement(&mut self, i: usize, vx: f32, vy: f32) {
        let r = self.ball_r * MM;
        let c = &mut self.bodies[self.billes[i].corps];
        c.set_linvel(vector![vx, vy, 0.0], true);
        c.set_angvel(vector![vy / r, -vx / r, 0.0], true);
    }
    pub fn angle_palette(&self, cote: char) -> f32 { self.palettes.iter().find(|p| p.cote == cote).map_or(0.0, |p| p.angle - p.a0) }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn monde() -> Option<Sim> { Sim::charger(concat!(env!("CARGO_MANIFEST_DIR"), "/donnees/monde.json")).ok() }

    /// même essai que la version web : la palette tenue va du repos à la butée haute en ≈ 21 ms
    #[test]
    fn course_palette() {
        let Some(mut s) = monde() else { return };
        s.step(50.0);
        s.held[0] = true;
        let mut t = 0.0;
        while (s.palettes[0].angle - s.palettes[0].up).abs() > 0.01 && t < 300.0 { s.step(DT_MS); t += DT_MS; }
        assert!((15.0..30.0).contains(&t), "levée en {t} ms");
    }

    /// la bille posée au milieu du plateau descend et finit évacuée (contact DRAIN)
    #[test]
    fn bille_evacuee() {
        let Some(mut s) = monde() else { return };
        s.secoue_auto = false;
        s.make_ball(239.0, 1000.0);
        for _ in 0..(5 * 480) { s.step(DT_MS); }
        assert!(s.contacts.iter().any(|(c, _)| c == sw::DRAIN), "contacts : {:?}", s.contacts);
    }

    /// rampe : bille lancée à 2,4 m/s dans la bouche → barrière infrarouge (contact RAMPE)
    #[test]
    fn rampe_faite() {
        let Some(mut s) = monde() else { return };
        s.secoue_auto = false;
        let e = &s.geo["rampEntries"][0];
        let (mx, my, ux, uy) = (f(&e["M"]["x"]), f(&e["M"]["y"]), f(&e["u"]["x"]), f(&e["u"]["y"]));
        let i = s.make_ball(mx - ux * 60.0, my - uy * 60.0);
        s.set_roulement(i, 2.4 * ux, 2.4 * uy);
        for _ in 0..(4 * 480) { s.step(DT_MS); if s.contacts.iter().any(|(c, _)| c == sw::RAMP) { break; } }
        assert!(s.contacts.iter().any(|(c, _)| c == sw::RAMP), "contacts : {:?}", s.contacts);
    }
}
