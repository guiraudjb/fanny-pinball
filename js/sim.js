// Simulation physique en 3D (Rapier) : joue le rôle de la mécanique réelle.
// La bille est une sphère d'acier qui roule sur le plateau incliné ; elle touche les vraies surfaces de la
// CAO (guides, carcasses, plastiques, rampe, pattes : assets/cao/collision.glb) et les éléments actifs
// décrits par table.js, extrudés à leur hauteur (palettes en rotation, bumpers, lance-pierres, cibles).
// Elle transforme les chocs en « contacts » (comme les micro-rupteurs) et exécute les « bobines »
// demandées par les règles. Bumpers, lance-pierres et palettes réagissent localement, exactement comme la
// réplique où le Mega tire la bobine dès que le contact se ferme.
//
// Repère : celui de la table, en mètres. X vers la droite, Y vers le joueur (bas du plateau),
// Z vers l'intérieur du plateau : une hauteur h au-dessus du plateau est z = −h (comme la vue 3D).
// Les positions exposées sont en mm, les vitesses en mm par image de 16,7 ms (unités de l'ancien moteur).

import R from '../vendor/rapier.module.js';
import { buildTable, GEO, BALL_R, W, H, CX as CX_TABLE, rampPath } from './table.js';
import { SW, COIL } from './rules.js';

const { Engine, Body } = window.Matter;

const MM = 0.001;
const FRAME = 1000 / 60;                 // ms : unité de temps des vitesses exposées
const v2si = (v) => (v * 60) * MM;        // mm/image → m/s
const si2v = (v) => v / MM / 60;          // m/s → mm/image

const DT_MS = 1000 / 480;                // pas fixe : 480 Hz (la pointe de palette avance de 6 mm par pas au plus)
const PENTE = (6.5 * Math.PI) / 180;     // inclinaison du plateau
const G = 9.81;
const H_PAROI = 32;                       // mm, hauteur des parois et blocs (cao/cotes.py PLATEAU.h_paroi)
const H_VITRE = 105;                      // mm, dessous de la vitre
const MASSE = 0.080;                      // kg, bille de 1-1/16"
const V_MAX = 6.0;                        // m/s
// Résistance au roulement (Rapier n'en a pas) : la bille roulant au contact du plateau perd ROULEMENT × g
// (m/s²) tant qu'elle avance. Avec la géométrie moderne des batteurs (repos +24,5°, levée −22,5°), 0,005 correspond
// au roulement acier sur plateau verni : berceau stable à toute vitesse et descente fluide sur la palette.
const ROULEMENT = 0.005;
const FLIP_UP = 45;                       // rad/s (course complète ≈ 22 ms, comme une vraie bobine)
const FLIP_DOWN = 20;
const LAUNCH_V = 2.35;
const COURSE_LANCEUR = 50;               // mm : course du lanceur à ressort tiré à fond                    // m/s : suit l'arrondi du haut et retombe sur les bumpers
const BUMPER_V = 1.25;                    // m/s, coup du bumper
const SLING_V = 1.05;                     // m/s, coup du lance-pierre
// Coup du lance-pierre : penché vers le bas et dispersé, comme un vrai : sans cela, la bille trouvait une
// orbite stable d'un lance-pierre à l'autre et n'en sortait plus.
const SLING_TUNE = { kick: SLING_V, bias: 0.2, jitter: 6, spread: 0.12, keep: 0.5 };
const NUDGE_V = 0.27;                     // m/s, élan vers le haut donné par un coup de caisse
const TILT_BOB = 2.4;                     // amplitude du pendule qui ferme le contact TILT
const BOB_TAU = 1500;                     // amortissement du pendule (ms)
const SAUCER_MAX_V = 0.95;                // m/s : au-delà, la bille passe par-dessus le Cercle

// Matières : [rebond, frottement] effectifs contre la bille (règle « produit » ; la bille porte 0,95 et 1).
const BILLE_E = 0.95;
const MATIERES = {
  bois: [0.3, 0.2],          // plateau vernis : la bille y roule sans glisser
  verre: [0.3, 0.05],
  plastique: [0.55, 0.15],   // guides et carcasses imprimés
  acrylique: [0.5, 0.12],
  rampe: [0.35, 0.12],
  metal: [0.45, 0.1],
  caoutchouc: [0.8, 0.7],    // anneaux, lance-pierres
  palette: [0.65, 0.6],      // caoutchouc rouge de palette (rebond fidèle pour les dead bounces)
  bumper: [0.6, 0.3],
  cible: [0.45, 0.2],
  mou: [0.2, 0.2],           // bras du tablier, lanceur
};

// Groupes de collision : le portillon du couloir de lancement ne touche que les billes qui l'ont passé.
const GR = { WALL: 0x0001, GATE: 0x0002, BALL: 0x0004 };
const groupes = (membre, filtre) => (membre << 16) | filtre;

// hauteur du fond de rampe à l'abscisse s (même profil que cao/modele.py et render3d.js)
const RAMPE = { z: 62, zFin: 34, pente: Math.tan((25 * Math.PI) / 180), desc: 120 };
function zRampe(s, L) {
  const p0 = 3 / 30, s1 = 20, s2 = (RAMPE.z + (RAMPE.pente - p0) * s1) / RAMPE.pente, s3 = L - RAMPE.desc;
  let z = p0 * Math.max(0, s);   // pente de la languette d'entrée (3 mm sur 30)
  for (const [sk, dm, h] of [[s1, RAMPE.pente - p0, 20], [s2, -RAMPE.pente, 50], [s3, -(RAMPE.z - RAMPE.zFin) / RAMPE.desc, 40]]) {
    const x = s - sk;
    z += dm * (x < -h ? 0 : x > h ? x : (x + h) ** 2 / (4 * h));
  }
  return Math.max(0, z);
}

// --- lecture minimale d'un glTF binaire (assets/cao/collision.glb, écrit par outils/cao_web.py)
function lireGLB(buf) {
  const dv = new DataView(buf);
  const lj = dv.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, lj)));
  const bin = 20 + lj + 8;
  const lire = (i) => {
    const a = gltf.accessors[i], v = gltf.bufferViews[a.bufferView];
    const T = a.componentType === 5126 ? Float32Array : a.componentType === 5125 ? Uint32Array : Uint16Array;
    const n = a.count * (a.type === 'VEC3' ? 3 : 1);
    return new T(buf.slice(bin + (v.byteOffset || 0), bin + (v.byteOffset || 0) + n * T.BYTES_PER_ELEMENT));
  };
  return gltf.nodes.map((n) => {
    const p = gltf.meshes[n.mesh].primitives[0];
    return { nom: n.name, ...n.extras, pos: lire(p.attributes.POSITION), idx: lire(p.indices) };
  });
}

const dedans = (x, y, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const pres = (x, y, poly, d) => poly.some(([xi, yi], i) => {
  const [xj, yj] = poly[(i + 1) % poly.length];
  const dx = xj - xi, dy = yj - yi, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / l2));
  return Math.hypot(x - xi - t * dx, y - yi - t * dy) < d;
});

// Bille : corps Rapier + état de jeu (fp), position et vitesse dans les unités de l'ancien moteur
class Bille {
  constructor(body, collider) {
    this.body = body;
    this.collider = collider;
    this.plugin = { fp: { mode: 'table', gate: false, still: 0, saucerIgnoreUntil: 0 } };
  }
  // après retrait du monde, le corps Rapier n'existe plus : on garde son dernier état
  get t() { return this.fige ? this.fige.t : this.body.translation(); }
  get v() { return this.fige ? this.fige.v : this.body.linvel(); }
  figer() { this.fige = { t: this.body.translation(), v: this.body.linvel(), q: this.body.rotation() }; }
  get position() { const t = this.t; return { x: t.x / MM, y: t.y / MM }; }
  get hauteur() { return -this.t.z / MM - BALL_R; }   // dessous de la bille au-dessus du plateau
  get velocity() { const v = this.v; return { x: si2v(v.x), y: si2v(v.y) }; }
  get vitesse() { const v = this.v; return Math.hypot(v.x, v.y, v.z); }   // m/s
  get rotation() { return this.fige ? this.fige.q : this.body.rotation(); }
}

// Création : Rapier (WebAssembly) et les surfaces de la CAO se chargent d'abord.
export async function creerSim(onSwitch, { collision = 'assets/cao/collision.glb', glb = null } = {}) {
  await R.init();
  const buf = glb || await (await fetch(collision)).arrayBuffer();
  return new Sim(onSwitch, lireGLB(buf));
}

export class Sim {
  constructor(onSwitch, surfaces = []) {
    this.onSwitch = onSwitch;
    // table.js décrit les formes avec des corps Matter.js : on s'en sert comme gabarits (et pour le rendu)
    this.T = buildTable(Engine.create());
    this.ramps = { L: rampPath(GEO.ramps.L) };
    this.balls = [];
    this.post = [];
    this.time = 0;
    this.acc = 0;
    this.held = { L: false, R: false };
    this.power = true;        // relais d'alimentation des bobines du plateau (coupé par le tilt)
    this.bob = 0;             // amplitude du pendule de tilt
    this.lastNudge = -1e9;
    this.shakeAt = -1e9;
    this.launchV = LAUNCH_V;
    this.courseLanceur = COURSE_LANCEUR;
    this.tirage = 0;            // lanceur à ressort : part de la course tirée (0..1), pour le rendu
    this.force = 1;             // part de launchV donnée au prochain tir (main.js : suit le tirage)
    this.slingTune = { ...SLING_TUNE };
    this.shooterClosed = false;
    this.dropsUp = GEO.drops.map(() => true);
    this.flash = {};            // nom → instant du dernier choc (pour le rendu)
    this.cool = {};             // anti-rebond des contacts
    this.info = new Map();      // poignée de collider → rôle (bumper, sling, cible…)

    this.world = new R.World({ x: 0, y: G * Math.sin(PENTE), z: G * Math.cos(PENTE) });
    this.world.timestep = DT_MS / 1000;
    this.world.integrationParameters.numSolverIterations = 8;
    // échelle des objets : sans elle Rapier tolère 5 mm d'interpénétration (réglé pour des objets d'un mètre),
    // et la bille qui aborde une pente en ressortait projetée vers la vitre
    this.world.integrationParameters.lengthUnit = 0.01;
    this.events = new R.EventQueue(true);
    this.construire(surfaces);
  }

  // ---------------------------------------------------------------- monde
  matiere(desc, nom) {
    const [e, f] = MATIERES[nom];
    return desc.setRestitution(e / BILLE_E).setFriction(f)
      .setRestitutionCombineRule(R.CoefficientCombineRule.Multiply)
      .setFrictionCombineRule(R.CoefficientCombineRule.Multiply);
  }

  // prisme vertical d'un contour 2D (mm), de la hauteur h0 à h1 au-dessus du plateau
  prisme(pts, h0, h1) {
    const v = new Float32Array(pts.length * 6);
    pts.forEach(([x, y], i) => v.set([x * MM, y * MM, -h0 * MM, x * MM, y * MM, -h1 * MM], i * 6));
    return R.ColliderDesc.convexHull(v);
  }

  cylindre(x, y, r, h0, h1) {
    const s = Math.SQRT1_2;   // l'axe des cylindres Rapier est Y : quart de tour autour de X
    return R.ColliderDesc.cylinder(((h1 - h0) / 2) * MM, r * MM)
      .setTranslation(x * MM, y * MM, (-(h0 + h1) / 2) * MM).setRotation({ x: s, y: 0, z: 0, w: s });
  }

  // corps Matter (gabarit) → collider fixe ; role : informations pour les contacts
  ajouter(b, h0, h1, matiere, role) {
    const parts = b.parts.length > 1 ? b.parts.slice(1) : [b];
    for (const p of parts) {
      const desc = b.circleRadius ? this.cylindre(b.position.x, b.position.y, b.circleRadius, h0, h1)
        : this.prisme(p.vertices.map((v) => [v.x, v.y]), h0, h1);
      if (!desc) continue;
      this.matiere(desc, matiere);
      if (b.isSensor) desc.setSensor(true);
      const c = this.world.createCollider(desc);
      if (role) this.info.set(c.handle, { ...role, corps: b, collider: c });
    }
  }

  construire(surfaces) {
    const T = this.T, w = this.world;
    // plateau et vitre
    w.createCollider(this.matiere(R.ColliderDesc.cuboid((W / 2) * MM, (H / 2 + 40) * MM, 0.02)
      .setTranslation((W / 2) * MM, (H / 2) * MM, 0.02), 'bois'));
    w.createCollider(this.matiere(R.ColliderDesc.cuboid((W / 2) * MM, (H / 2 + 40) * MM, 0.005)
      .setTranslation((W / 2) * MM, (H / 2) * MM, -(H_VITRE * MM + 0.005)), 'verre'));

    // surfaces passives de la CAO (maillages)
    const contours = [];
    for (const s of surfaces) {
      const v = new Float32Array(s.pos.length);
      for (let i = 0; i < v.length; i++) v[i] = s.pos[i] * MM;
      // FIX_INTERNAL_EDGES : sans lui, les arêtes entre deux facettes d'une même pièce (pied de rampe, cintrages)
      // donnent des contacts fantômes qui font sauter la bille
      const c = w.createCollider(this.matiere(R.ColliderDesc.trimesh(v, new Uint32Array(s.idx), R.TriMeshFlags.FIX_INTERNAL_EDGES),
        MATIERES[s.categorie] ? s.categorie : 'plastique'));
      this.info.set(c.handle, { type: 'surface', nom: s.nom });
      for (const c of s.contour || []) contours.push(c);
    }
    // parois de table.js qui n'ont pas de pièce CAO (caisse, séparateur du couloir de lancement, bras du
    // tablier…) ; les poteaux caoutchoutés restent des cylindres (leur anneau n'est pas dans le maillage)
    const couvert = (b) => {
      const pts = b.vertices.map((v) => [v.x, v.y]);
      const ok = (x, y) => contours.some((c) => dedans(x, y, c) || pres(x, y, c, 4));
      return ok(b.position.x, b.position.y) && pts.filter((p) => ok(...p)).length * 2 >= pts.length;
    };
    for (const b of T.walls) {
      const pl = b.plugin || {};
      if (pl.flanc) continue;                                   // flancs de la rampe : dans son maillage
      const poteau = b.circleRadius && !pl.hidden;
      if (!poteau && couvert(b)) continue;
      const hors = b.position.x < 0 || b.position.x > W;       // murs de la caisse
      const mat = poteau ? 'caoutchouc' : b.label === 'apron' || b.label === 'plunger' ? 'mou' : 'plastique';
      this.ajouter(b, 0, hors ? H_VITRE + 10 : H_PAROI, mat, { type: 'paroi', nom: b.label, x: Math.round(b.position.x), y: Math.round(b.position.y) });
    }
    T.bumpers.forEach((b, i) => this.ajouter(b, 0, 40, 'bumper', { type: 'bumper', idx: i }));
    T.slings.forEach((b) => this.ajouter(b, 0, H_PAROI, 'caoutchouc', { type: 'sling', ...b.plugin }));
    T.drops.forEach((b, i) => this.ajouter(b, 0, 33, 'cible', { type: 'drop', idx: i }));
    T.standups.forEach((b) => this.ajouter(b, 0, 30, 'cible', { type: 'standup', ...b.plugin }));
    (T.leftTargets || []).forEach((b) => this.ajouter(b, 0, 30, 'cible', { type: 'target', ...b.plugin }));
    T.lanes.forEach((b) => this.ajouter(b, 0, 10, 'bois', { type: 'lane', ...b.plugin }));
    this.ajouter(T.saucer, 0, 8, 'bois', { type: 'saucer' });
    // portillon à sens unique en haut du couloir de lancement
    const g = this.matiere(this.prisme(T.gate.vertices.map((v) => [v.x, v.y]), 0, 22), 'metal');
    w.createCollider(g.setCollisionGroups(groupes(GR.GATE, GR.BALL)));
    // barrière infrarouge en sortie de rampe (contact RAMPE), à hauteur de la bille sur la rampe
    const path = this.ramps.L, L = path.length, sIR = L - 120;
    const p = path.pts.reduce((m, q) => (Math.abs(q.s - sIR) < Math.abs(m.s - sIR) ? q : m));
    const cIR = w.createCollider(R.ColliderDesc.ball(16 * MM).setSensor(true)
      .setTranslation(p.x * MM, p.y * MM, -(zRampe(p.s, L) + 3 + BALL_R) * MM));
    this.info.set(cIR.handle, { type: 'ramp', side: 'L' });

    // palettes : corps cinématiques en rotation autour de leur axe ; Rapier en déduit la vitesse de
    // surface transmise à la bille
    this.palettes = T.flippers.map((fl) => {
      const { px, py } = fl.def;
      const body = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(px * MM, py * MM, 0));
      const pts = fl.body.vertices.map((v) => [v.x - px, v.y - py]);
      const c = w.createCollider(this.matiere(this.prisme(pts, 3, 25), 'palette'), body);
      this.info.set(c.handle, { type: 'palette', nom: fl.def.side });
      return { fl, body, a0: fl.angle };
    });
  }

  // ---------------------------------------------------------------- billes
  makeBall(x, y) {
    const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(x * MM, y * MM, -(BALL_R + 0.05) * MM).setCcdEnabled(true)
      .setLinearDamping(0.02).setAngularDamping(0.05));
    const r = BALL_R * MM;
    const desc = R.ColliderDesc.ball(r).setDensity(MASSE / ((4 / 3) * Math.PI * r ** 3))
      .setRestitution(BILLE_E).setFriction(1)
      .setRestitutionCombineRule(R.CoefficientCombineRule.Multiply)
      .setFrictionCombineRule(R.CoefficientCombineRule.Multiply)
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
      .setCollisionGroups(groupes(GR.BALL, GR.WALL | GR.BALL));
    const b = new Bille(body, this.world.createCollider(desc, body));
    this.info.set(b.collider.handle, { type: 'ball', bille: b });
    this.balls.push(b);
    return b;
  }

  setVitesse(b, vx, vy, vz = null) {
    const v = b.body.linvel();
    b.body.setLinvel({ x: v2si(vx), y: v2si(vy), z: vz ?? v.z }, true);
  }

  removeBall(b, forget) {
    if (!b.retiree) {
      this.info.delete(b.collider.handle);
      b.figer();
      this.world.removeRigidBody(b.body);
      b.retiree = true;
    }
    if (forget) this.balls = this.balls.filter((o) => o !== b);
  }

  clear() {
    for (const b of this.balls) this.removeBall(b, false);
    this.balls = [];
    this.shooterClosed = false;
    this.resetDrops();
  }

  dansLanceur(b) {
    const { x, y } = b.position;
    return x > GEO.playRight + 4 && y > GEO.plunger.top - 120;
  }

  // ---------------------------------------------------------------- bobines
  coil(name) {
    const P = GEO.plunger;
    if (name === COIL.TROUGH) {
      const occupied = this.balls.some((b) => b.plugin.fp.mode === 'table' && this.dansLanceur(b));
      this.makeBall(P.x, occupied ? P.ballY - 60 : P.ballY);
    } else if (name === COIL.LAUNCH) {
      for (const b of this.balls) {
        if (b.plugin.fp.mode === 'table' && this.dansLanceur(b)) {
          b.body.setLinvel({ x: 0, y: -(this.launchV * this.force * (1 + (Math.random() - 0.5) * 0.04)), z: 0 }, true);
        }
      }
      this.flash.plunger = this.time;
    } else if (name === COIL.SAUCER) {
      const s = GEO.saucer;
      for (const b of this.balls) {
        if (b.plugin.fp.mode !== 'saucer') continue;
        b.plugin.fp.mode = 'table';
        b.plugin.fp.saucerIgnoreUntil = this.time + 900;
        b.body.setEnabled(true);
        b.body.setTranslation({ x: s.x * MM, y: (s.y + 2) * MM, z: -(BALL_R + 0.5) * MM }, true);
        const k = s.kick || { x: 0, y: 7 };
        this.setVitesse(b, k.x + (Math.random() - 0.5) * 2, k.y + (Math.random() - 0.5) * 2, 0);
      }
      this.flash.saucer = this.time;
    } else if (name === COIL.DROP_RESET) {
      this.resetDrops();
    } else if (name === COIL.POWER_OFF) {
      this.power = false;
    } else if (name === COIL.POWER_ON) {
      this.power = true;
    }
  }

  resetDrops() {
    for (const [, r] of this.info) if (r.type === 'drop') r.collider.setEnabled(true);
    this.dropsUp = this.dropsUp.map(() => true);
  }

  // ---------------------------------------------------------------- chocs
  debounce(key, ms) {
    if (this.cool[key] && this.time - this.cool[key] < ms) return false;
    this.cool[key] = this.time;
    return true;
  }

  // choc bille / élément : r = rôle de l'élément (voir construire)
  contact(b, r) {
    const fp = b.plugin.fp;
    if (fp.mode !== 'table') return;
    const { x, y } = b.position;
    switch (r.type) {
      case 'bumper': {
        if (!this.power || !this.debounce(`bumper${r.idx}`, 60)) break;
        this.flash[`bumper${r.idx}`] = this.time;
        const c = r.corps.position;
        this.post.push(() => {
          const dx = x - c.x, dy = y - c.y, l = Math.hypot(dx, dy) || 1;
          b.body.setLinvel({ x: (dx / l) * BUMPER_V, y: (dy / l) * BUMPER_V, z: 0 }, true);
        });
        this.onSwitch(SW.BUMPERS[r.idx]);
        break;
      }
      case 'sling': {
        const { A, n, idx } = r;
        const side = (x - A[0]) * n.x + (y - A[1]) * n.y;
        if (side < BALL_R * 0.5) break; // choc sur le dos du triangle : pas de tir
        if (!this.power || !this.debounce(`sling${idx}`, 200)) break;
        this.flash[`sling${idx}`] = this.time;
        this.post.push(() => {
          const v = b.body.linvel();
          const tx = -n.y, ty = n.x, vt = v.x * tx + v.y * ty;
          // perpendiculaire à la face, un peu penché vers le bas (bias) et dispersé (jitter°, ±spread)
          const k = this.slingTune;
          let dx = n.x, dy = n.y + k.bias;
          const a = ((Math.random() * 2 - 1) * k.jitter * Math.PI) / 180;
          [dx, dy] = [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
          const l = Math.hypot(dx, dy), p = k.kick * (1 + (Math.random() * 2 - 1) * k.spread);
          b.body.setLinvel({ x: (dx / l) * p + tx * vt * k.keep, y: (dy / l) * p + ty * vt * k.keep, z: 0 }, true);
        });
        this.onSwitch(SW.SLINGS[idx]);
        break;
      }
      case 'drop':
        if (!this.dropsUp[r.idx]) break;
        this.dropsUp[r.idx] = false;
        this.post.push(() => r.collider.setEnabled(false));
        this.onSwitch(SW.DROPS[r.idx]);
        break;
      case 'standup':
        if (!this.debounce(`standup${r.idx}`, 250)) break;
        this.flash[`standup${r.idx}`] = this.time;
        this.onSwitch(SW.STANDUPS[r.idx]);
        break;
      case 'target':
        if (!this.debounce(`target${r.idx}`, 250)) break;
        this.flash[`target${r.idx}`] = this.time;
        this.onSwitch(r.id);
        break;
      case 'lane':
        if (!this.debounce(`lane${r.idx}`, 300)) break;
        this.onSwitch(SW.LANES[r.idx]);
        break;
      case 'saucer':
        if (this.time < fp.saucerIgnoreUntil || b.vitesse > SAUCER_MAX_V) break; // trop rapide : elle saute le trou
        fp.mode = 'saucer';
        this.post.push(() => {
          b.body.setTranslation({ x: GEO.saucer.x * MM, y: GEO.saucer.y * MM, z: -(BALL_R - 7) * MM }, true);
          b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          b.body.setEnabled(false);
        });
        this.onSwitch(SW.SAUCER);
        break;
      case 'ramp':
        if (!this.debounce(`ramp${r.side}`, 400)) break;
        this.flash[`ramp${r.side}`] = this.time;
        this.onSwitch(SW.RAMP);
        break;
    }
  }

  // ---------------------------------------------------------------- boucle
  step(dtMs) {
    this.acc += Math.min(dtMs, 100);
    while (this.acc >= DT_MS) {
      this.acc -= DT_MS;
      this.substep(DT_MS);
    }
    this.frameChecks(dtMs);
  }

  substep(dt) {
    this.time += dt;

    for (const p of this.palettes) {
      const { fl } = p;
      const held = this.power && this.held[fl.def.side];
      const target = held ? fl.def.up : fl.def.rest;
      const speed = ((held ? FLIP_UP : FLIP_DOWN) * dt) / 1000;
      const delta = Math.max(-speed, Math.min(speed, target - fl.angle));
      fl.angle += delta;
      Body.rotate(fl.body, delta, { x: fl.def.px, y: fl.def.py });     // gabarit, pour le rendu
      const a = (fl.angle - p.a0) / 2;
      p.body.setNextKinematicRotation({ x: 0, y: 0, z: Math.sin(a), w: Math.cos(a) });
    }

    for (const b of this.balls) {
      const fp = b.plugin.fp;
      if (fp.mode !== 'table') continue;
      // portillon : franchi vers le haut, il ferme ensuite le couloir de lancement
      const { x, y } = b.position;
      if (y < GEO.gate.y - GEO.gate.drop / 2 - BALL_R - 6) fp.gate = true;
      else if (x > GEO.playRight && y > GEO.gate.y + GEO.gate.drop / 2 + BALL_R + 4) fp.gate = false;
      b.collider.setCollisionGroups(groupes(GR.BALL, GR.WALL | GR.BALL | (fp.gate ? GR.GATE : 0)));
    }

    this.world.step(this.events);
    this.events.drainCollisionEvents((h1, h2, debut) => {
      if (!debut) return;
      let a = this.info.get(h1), o = this.info.get(h2);
      if (a?.type !== 'ball') [a, o] = [o, a];
      if (a?.type !== 'ball' || !o || o.type === 'ball') return;
      this.contact(a.bille, o);
    });

    if (this.post.length) {
      const jobs = this.post;
      this.post = [];
      jobs.forEach((f) => f());
    }

    for (const b of this.balls) {
      const fp = b.plugin.fp;
      if (fp.mode !== 'table' || b.retiree) continue;
      const v = b.body.linvel(), sp = Math.hypot(v.x, v.y, v.z);
      if (sp > V_MAX) b.body.setLinvel({ x: (v.x / sp) * V_MAX, y: (v.y / sp) * V_MAX, z: (v.z / sp) * V_MAX }, true);
      else if (b.hauteur < 0.3 && sp > 0.005) {   // pas de freinage à l'arrêt : il retiendrait la bille en équilibre
        // freinage de roulement : vitesse et rotation réduites ensemble (la bille continue de rouler sans glisser)
        const k = Math.max(0, 1 - (ROULEMENT * G * dt) / 1000 / sp), w = b.body.angvel();
        b.body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z }, true);
        b.body.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true);
      }
      // évacuation (sous le tablier) et filet de sécurité : bille sortie de la table
      const { x, y } = b.position;
      if (y > GEO.drainY || x < -20 || x > W + 20 || y < -40 || b.hauteur > H_VITRE + 20 || b.hauteur < -40) {
        fp.mode = 'gone';
        this.post.push(() => this.removeBall(b, true));
        this.onSwitch(SW.DRAIN);
      }
    }
  }

  // Bourrage : le joueur pousse la caisse (dx = 0 frontal vers le haut, -1 coup latéral gauche, +1 droit).
  // Les billes du plateau reçoivent l'élan correspondant ; le pendule de tilt s'écarte et ferme TILT si trop rapprochés.
  nudge(dx = 0) {
    if (this.time - this.lastNudge < 250) return false;
    this.lastNudge = this.time;
    this.shakeAt = this.time;
    for (const b of this.balls) {
      if (b.plugin.fp.mode !== 'table' || this.dansLanceur(b)) continue;
      const v = b.body.linvel();
      const vx = dx ? dx * NUDGE_V * 1.15 : (Math.random() - 0.5) * 0.18;
      const vy = dx ? -NUDGE_V * 0.35 : -NUDGE_V;
      b.body.setLinvel({ x: v.x + vx, y: v.y + vy, z: v.z }, true);
    }
    this.bob += 1;
    if (this.bob >= TILT_BOB) { this.bob = 0.8; this.onSwitch(SW.TILT); }
    return true;
  }

  frameChecks(dtMs) {
    this.bob *= Math.exp(-dtMs / BOB_TAU);
    // contact du couloir de lancement
    const inShooter = this.balls.some((b) => b.plugin.fp.mode === 'table' && b.position.x > GEO.playRight + 4
      && b.position.y > GEO.plunger.ballY - 8 && Math.abs(b.velocity.y) < 0.8);
    if (inShooter !== this.shooterClosed) {
      this.shooterClosed = inShooter;
      this.onSwitch(SW.SHOOTER, inShooter);
    }
    // bille immobile hors couloir (coincée) : petite secousse automatique
    for (const b of this.balls) {
      const fp = b.plugin.fp;
      if (fp.mode !== 'table' || b.retiree || this.dansLanceur(b)) { fp.still = 0; continue; }
      const { x, y } = b.position;
      // bille tenue volontairement sur une palette levée : on ne la secoue pas
      const cradled = y > GEO.flippers[0].py - 90 && ((this.held.L && x < CX_TABLE) || (this.held.R && x >= CX_TABLE));
      if (b.vitesse < 0.15 * 60 * MM && !cradled) fp.still += dtMs; else fp.still = 0;
      if (fp.still > 1500) {
        // secousses de plus en plus fortes, dirigées vers le centre de la table (comme un joueur qui
        // secoue la caisse) ; le compteur repart quand la bille a quitté l'endroit
        fp.still = 0;
        if (!fp.stuckAt || Math.hypot(x - fp.stuckAt.x, y - fp.stuckAt.y) > 30) { fp.stuckAt = { x, y }; fp.nudges = 0; }
        fp.nudges++;
        const dx = CX_TABLE - x, dy = 480 - y, l = Math.hypot(dx, dy) || 1;
        const k = 4 + 3 * Math.min(fp.nudges, 4);
        this.setVitesse(b, (dx / l) * k + (Math.random() - 0.5) * 3, (dy / l) * k - 3);
      }
    }
  }

  // positions pour le rendu : z = hauteur du dessous de la bille au-dessus du plateau (mm)
  ballViews() {
    return this.balls.filter((b) => b.plugin.fp.mode !== 'gone' && !b.retiree).map((b) => {
      const { x, y } = b.position, z = b.plugin.fp.mode === 'saucer' ? -7 : b.hauteur;
      return { x, y, z, onRamp: z > 12, inSaucer: b.plugin.fp.mode === 'saucer', rotation: b.rotation };
    });
  }
}
