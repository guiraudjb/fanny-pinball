// Géométrie de la table et création des corps Matter.js.
//
// Cotes réelles en millimètres (1 unité = 1 mm), origine = coin haut gauche du plateau.
// Référence : plateau standard 20,25" × 42" (514 × 1067 mm), bille 1-1/16" (27 mm),
// flippers 3" — mêmes proportions que les tables Visual Pinball X (bille de rayon 25 unités VP,
// flipper ≈ 147 unités VP caoutchouc compris, angles de repos 121° / levée 70°).
// Silhouette inspirée des Gottlieb des années 70 (Top Score, Big Brave) : haut presque
// rectangulaire aux coins arrondis, grands flippers rapprochés, lance-pierres hauts.

const { Bodies, Body, Composite, Vertices } = window.Matter;

export const W = 514;
export const H = 1067;
export const BALL_R = 13.5;
export const CAT = { WALL: 0x0001, GATE: 0x0002, BALL: 0x0004 };

const PLAY_R = 478;           // bord droit de la zone de jeu (mur du couloir de lancement)
export const CX = PLAY_R / 2; // axe de symétrie de la zone de jeu
const mx = (x) => PLAY_R - x;
const deg = (a) => (a * Math.PI) / 180;

// --- flippers
// Cotes relevées dans Black Knight (Williams 1980, VPX) : axe → pointe 63,5 mm, rayons 11 / 6 mm,
// axes écartés de 174 mm, à 179 mm du bas ; angles 32° / 18°. (Top Score 1975 : 62 mm, 187 mm, 31° / 20°.)
const FLIP = { len: 63, r1: 12, r2: 7, rest: deg(31), up: deg(-19), pivotDX: 87, pivotY: H - 180 };
const LPX = CX - FLIP.pivotDX;

// Guide de couloir de retour : prolonge exactement le dessus du flipper au repos
// (axe du flipper décalé vers le haut de r1 − ½ épaisseur du guide).
const GUIDE_T = 8;
const dir = { x: Math.cos(FLIP.rest), y: Math.sin(FLIP.rest) };
const nrm = { x: Math.sin(FLIP.rest), y: -Math.cos(FLIP.rest) };
const off = FLIP.r1 - GUIDE_T / 2;
const guideEnd = { x: LPX + nrm.x * off - dir.x * 16, y: FLIP.pivotY + nrm.y * off - dir.y * 16 };
const SEP_X = 40; // séparateur couloir de sortie / couloir de retour
const kL = (guideEnd.x - SEP_X) / dir.x;
const guideKnee = { x: SEP_X, y: guideEnd.y - dir.y * kL };

// Lance-pierre : bord bas parallèle au guide, à une largeur de couloir (34 mm) au-dessus.
// Deux couloirs de retour côte à côte (comme les Williams des années 80) : le séparateur DIV_X
// s'arrête sur la ligne du lance-pierre, les deux couloirs se rejoignent sur le guide du flipper.
const INLANE = 34;
// Lance-pierre écarté du guide de SL_JEU mm en plus du couloir : palette levée, la bille (Ø 27) doit
// encore passer librement entre la palette et le caoutchouc du poteau bas du lance-pierre.
const SL_JEU = 5;
const slingOff = GUIDE_T / 2 + INLANE + SL_JEU;
const slingP0 = { x: guideKnee.x + nrm.x * slingOff, y: guideKnee.y + nrm.y * slingOff };
// Remonté de SL_LEVE mm (verticalement : le couloir de retour garde sa largeur) : son poteau bas était à 50 mm
// au-dessus de l'axe de la palette, trop près d'elle (bille pincée entre palette levée et caoutchouc) ; il reste
// maintenant ≈ 58 mm entre palette levée et caoutchouc (plus de deux billes)
const SL_LEVE = 20;
const slingLine = (x) => slingP0.y + ((x - slingP0.x) / dir.x) * dir.y - SL_LEVE;
const DIV_X = SEP_X + GUIDE_T / 2 + INLANE + GUIDE_T / 2;   // séparateur retour 1 / retour 2
const SL_X1 = DIV_X + GUIDE_T / 2 + INLANE; // bord vertical du lance-pierre
// Face (caoutchouc) entre les deux poteaux : 101 mm, l'entraxe du mécanisme Williams 500-5849
// (gabarit Pinball Makers), à 68° sur l'horizontale (60,8° avant : le poteau bas avançait au-dessus de la
// palette ; les jeux modernes écartent les deux poteaux bas de 7 3/4" à 8 1/2", ici ≈ 7" sur un plateau
// plus étroit), pied posé sur la ligne parallèle au guide.
const SL_FACE = 101;
const SL_ANG = deg(68);
const SL_X2 = SL_X1 + SL_FACE * Math.cos(SL_ANG);
const SL_Y1 = slingLine(SL_X2) - SL_FACE * Math.sin(SL_ANG);
const SLING = [[SL_X1, SL_Y1], [SL_X1, slingLine(SL_X1)], [SL_X2, slingLine(SL_X2)]];

// Couloir d'entrée de rampe : bouche M, axe u (de la bouche vers le fond) orienté pour que
// le tir de la palette droite y entre dans l'axe.
function rampEntry(side, M, len, half) {
  const target = side === 'L'
    ? { x: mx(LPX) - Math.cos(FLIP.up) * FLIP.len * 0.5, y: FLIP.pivotY + Math.sin(FLIP.up) * FLIP.len * 0.5 }
    : { x: LPX + Math.cos(FLIP.up) * FLIP.len * 0.5, y: FLIP.pivotY + Math.sin(FLIP.up) * FLIP.len * 0.5 };
  let ux = M.x - target.x, uy = M.y - target.y;
  const l = Math.hypot(ux, uy); ux /= l; uy /= l;
  const v = { x: -uy, y: ux };
  const Tp = { x: M.x + ux * len, y: M.y + uy * len };
  return { side, M, T: Tp, u: { x: ux, y: uy }, v, half, sensor: { x: Tp.x - ux * 14, y: Tp.y - uy * 14 } };
}

const DROP_DIR = { x: Math.cos(deg(75)), y: Math.sin(deg(75)) }; // 75° comme la banque H-O-L-E de Black Hole
// remontée de 60 mm le long de son axe : la rampe, qui redescend le long du mur droit, passe au large de la cible Y
const DROP_BANK = { x0: 396 - DROP_DIR.x * 60, y0: 472 - DROP_DIR.y * 60, dir: DROP_DIR, n: { x: -DROP_DIR.y, y: DROP_DIR.x } }; // n : face avant
// Pas et taille des cibles : banque de 5 Williams (plan DWG Pinball Makers) — pas 1-1/4" = 31,75 mm,
// cible 22,5 × 8,1 mm (au lieu du pas de 28 mm relevé sur Black Hole, une Gottlieb).
const DROP_PITCH = 31.75;

// Couloir du bouchon : de sa bouche M jusqu'au cochonnet B, axe u tourné vers le milieu de la palette
// droite levée ; parois à ±HALF (bille 27 mm dans un couloir de 38 mm).
const BOUCHON = (() => {
  const B = { x: 50, y: 368 };
  const tgt = { x: mx(LPX) - Math.cos(FLIP.up) * FLIP.len * 0.5, y: FLIP.pivotY + Math.sin(FLIP.up) * FLIP.len * 0.5 };
  let ux = B.x - tgt.x, uy = B.y - tgt.y;
  const l = Math.hypot(ux, uy); ux /= l; uy /= l;
  const len = 78, half = 19;
  return { B, u: { x: ux, y: uy }, v: { x: -uy, y: ux }, len, half, M: { x: B.x - ux * len, y: B.y - uy * len } };
})();

const RAMPE_E = rampEntry('L', { x: 180, y: 450 }, 85, 26);   // entrée de 52 mm (Black Knight : 50 à 56 mm)
// la rampe elle-même fait l'entrée : sa bouche de 52 mm se resserre sur « evase » mm jusqu'à sa largeur
// courante (39 mm intérieur, cao/cotes.py RAMPE.larg_int) ; ses flancs transparents guident la bille dès la bouche
RAMPE_E.evase = 70;
RAMPE_E.fond = 19.5;

// POINTER, à gauche de la bouche du couloir du bouchon : encastrée dans le bloc entre le mur et le couloir,
// face tournée vers les flippers. Face sur l'arête a → b du bloc, à s mm de a (boîtier de 30 × 30 derrière).
function cibleEncastree(a, b, s) {
  const l = Math.hypot(b.x - a.x, b.y - a.y), e = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  const n = e.x < 0 ? { x: e.y, y: -e.x } : { x: -e.y, y: e.x };         // normale vers le bas du plateau (y > 0)
  return { x: a.x + e.x * s + n.x, y: a.y + e.y * s + n.y, n };
}
const boucheBouchon = (k) => ({ x: BOUCHON.M.x + BOUCHON.v.x * k, y: BOUCHON.M.y + BOUCHON.v.y * k });
const CIBLE_POINTER = cibleEncastree(boucheBouchon(-(BOUCHON.half + 3)), { x: -2, y: 478 }, 24);
export const GEO = {
  ellipse: { cx: W / 2, cy: 160, rx: W / 2, ry: 150 },
  playRight: PLAY_R,
  laneSep: { x: PLAY_R + 2, y1: 210, y2: H, t: 4 },
  plunger: { x: (PLAY_R + 4 + W) / 2, top: 1000, ballY: 1000 - BALL_R - 1 },
  gate: { y: 195, x1: PLAY_R, x2: W, drop: 22 },
  flippers: [
    { side: 'L', px: LPX, py: FLIP.pivotY, len: FLIP.len, r1: FLIP.r1, r2: FLIP.r2, rest: FLIP.rest, up: FLIP.up },
    { side: 'R', px: mx(LPX), py: FLIP.pivotY, len: FLIP.len, r1: FLIP.r1, r2: FLIP.r2, rest: -FLIP.rest, up: -FLIP.up },
  ],
  separators: [
    [[SEP_X, 700], [guideKnee.x, guideKnee.y], [guideEnd.x, guideEnd.y]],
    [[mx(SEP_X), 700], [mx(guideKnee.x), guideKnee.y], [mx(guideEnd.x), guideEnd.y]],
  ],
  // séparateurs entre les deux couloirs de retour : du poteau du haut jusqu'à la ligne du lance-pierre
  dividers: [
    [[DIV_X, 700], [DIV_X, slingLine(DIV_X)]],
    [[mx(DIV_X), 700], [mx(DIV_X), slingLine(DIV_X)]],
  ],
  deflectors: [
    [[0, 465], [32, 500]],
  ],
  slings: [
    { pts: SLING, face: [0, 2] },
    { pts: SLING.map(([x, y]) => [mx(x), y]), face: [0, 2] },
  ],
  // bumpers : r = anneau qui frappe la bille (Ø 57 mm ; c'est le « Radius » 45 u. de VPX + jupe),
  // cap = chapeau vu de dessus (Ø 68 mm, 2,5 billes)
  bumpers: [
    { x: CX - 54, y: 232, r: 28, cap: 34 },
    { x: CX + 54, y: 232, r: 28, cap: 34 },
    { x: CX, y: 314, r: 28, cap: 34 },
  ],
  lanePosts: [-84, -42, 0, 42, 84].map((dx) => ({ x: CX + dx, y1: 95, y2: 145 })),
  lanes: ['T', 'O', 'U', 'R'].map((letter, i) => ({ letter, x: CX - 63 + 42 * i, y: 122 })),
  // banque F-A-N-N-Y en diagonale sur le côté droit, tournée vers le flipper gauche,
  // adossée à un bloc plein (aucune bille ne peut passer derrière)
  dropBank: DROP_BANK,
  drops: ['F', 'A', 'N', 'N', 'Y'].map((letter, i) => ({
    letter, x: DROP_BANK.x0 + DROP_BANK.dir.x * DROP_PITCH * i, y: DROP_BANK.y0 + DROP_BANK.dir.y * DROP_PITCH * i,
    w: 22.5, h: 8.1, angle: Math.atan2(DROP_BANK.dir.y, DROP_BANK.dir.x),
  })),
  // trois cibles rondes à la verticale contre le mur gauche (montées à fleur d'une paroi pleine)
  leftWall: { x: 30, y1: 520, y2: 640 },
  leftTargets: [0, 1, 2].map((i) => ({ id: `boule${i + 1}`, x: 30, y: 540 + 40 * i, r: 13 })),
  standups: [
    { id: 'pointer', label: 'POINTER', ...CIBLE_POINTER, r: 11 },
    { id: 'tirer', label: 'TIRER', x: CX + 16, y: 450, r: 11 },   // 45 mm du poteau droit de l'entrée de rampe : pas de recoin
    { id: 'bouchon', label: 'BOUCHON', x: BOUCHON.B.x, y: BOUCHON.B.y, r: 8 },  // cochonnet au fond du couloir
  ],
  // couloir du bouchon (haut gauche), dans l'axe du tir de la palette droite
  bouchonLane: BOUCHON,
  // le Cercle : trou d'éjection latéral en haut à droite (comme les « kickout holes » Gottlieb),
  // la bobine renvoie la bille vers les bumpers et le centre
  saucer: { x: 400, y: 318, r: 7, ring: 18, kick: { x: -6.5, y: 3.5 } },
  // entrées de rampe : couloir court fermé en haut, capteur près du fond
  // entrée de rampe : couloir incliné dont l'axe vise le milieu de la palette droite levée
  rampEntries: [RAMPE_E],
  // une seule rampe, qui exploite l'arrondi supérieur du plateau
  ramps: { L: null },
  inlaneTop: { x: (SEP_X + DIV_X) / 2, y: 690 },  // haut du couloir de retour extérieur (sortie de rampe)
  drainY: H + 8,
  // tablier (apron) : plastron noir en V au bas du plateau. Ses deux bras, parallèles aux flippers au repos,
  // laissent 31 mm (un peu plus qu'une bille) sous l'arrière des flippers et ramènent les billes des couloirs
  // extérieurs vers le trou d'évacuation, au centre ; il cache le bac et l'autolanceur. Lèvre de 20 mm.
  // Dans le couloir de lancement, son bord est sous la bille au repos (lane).
  apron: { side: 846, front: 964, half: 42, lane: 1000, lip: 20, trou: [70, 34] },
  // plot central caoutchouté entre les pointes des palettes (« center post ») : 13 mm sous les pointes au repos ;
  // 21 mm restent entre son caoutchouc et chaque pointe, moins qu'une bille : palettes baissées, la bille tombée
  // au milieu se pose entre pointe et plot et se rejoue ; palette levée, le passage s'ouvre (r : rebond, Ø 15)
  centerPost: { x: CX, y: FLIP.pivotY + Math.sin(FLIP.rest) * FLIP.len + 13, r: 7.5 },
  cities: ['Marseille', 'Paris', 'Londres', 'New York', 'Tokyo', 'Rio', 'Sydney'],
};

// Rampe unique qui fait le tour du plateau de gauche à droite : du fond du couloir d'entrée
// elle file vers le mur gauche, le longe, suit tout l'arrondi du haut (au-dessus des couloirs
// T-O-U-R) puis redescend le long du côté droit et rend la bille au couloir de retour droit.
function buildRamp() {
  const e = GEO.rampEntries[0];
  const xL = 26, xR = PLAY_R - 24, yArc = 160;          // axe de la rampe : 26 mm du mur gauche, 24 mm du mur droit
  const ecx = (xL + xR) / 2, erx = (xR - xL) / 2, ery = yArc - 36;
  // la rampe part de la bouche M (comme dans la CAO) ; le capteur, à 14 mm du fond du couloir, y prend la bille
  const pts = [[e.M.x, e.M.y], [e.T.x - e.u.x * 14, e.T.y - e.u.y * 14], [e.T.x + e.u.x * 30, e.T.y + e.u.y * 30],
    [e.T.x + e.u.x * 30 - 34, e.T.y + e.u.y * 30 - 40], [xL + 8, 232], [xL, yArc + 20]];
  for (let i = 0; i <= 24; i++) {                          // arrondi du haut, de gauche à droite
    const a = Math.PI + (Math.PI * i) / 24;
    pts.push([ecx + erx * Math.cos(a), yArc + ery * Math.sin(a)]);
  }
  const yEnd = 500;
  for (let y = yArc + 60; y < yEnd; y += 60) pts.push([xR, y]);
  const exit = { x: mx(GEO.inlaneTop.x), y: GEO.inlaneTop.y - 5 };
  // courbe en S (y 500 → 625) puis 60 mm droits dans l'axe x = 417 du couloir de retour droit :
  // la bille quitte la rampe (haute de 34 mm) sans vitesse latérale et retombe droit dans le couloir
  const yAlign = exit.y - 60;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10, s = t * t * (3 - 2 * t);
    pts.push([xR + (exit.x - xR) * s, yEnd + (yAlign - yEnd) * t]);
  }
  for (let i = 1; i <= 4; i++) pts.push([exit.x, yAlign + ((exit.y - yAlign) * i) / 4]);
  return pts;
}
GEO.ramps.L = buildRamp();

// ---------------------------------------------------------------------------

const STATIC = { isStatic: true, restitution: 0.3, friction: 0.02 };

// Corps rond fixe : Matter.js le remplace par un polygone ; à peu de côtés, l'un d'eux peut être
// horizontal en haut (méplat de 5,6 mm sur une cible de r 11) où une bille lâchée sans vitesse
// s'arrête. On prend 32 côtés et on tourne le polygone pour qu'un sommet soit en haut.
function roundBody(x, y, r, opts) {
  const b = Bodies.circle(x, y, r, opts, 32);
  const n = b.vertices.length;
  const top = b.vertices.reduce((m, v) => (v.y < m.y ? v : m));
  const flat = b.vertices.filter((v) => Math.abs(v.y - top.y) < 1e-6).length > 1;
  if (flat) Body.rotate(b, Math.PI / n);
  return b;
}

function seg(x1, y1, x2, y2, t = 8, extra = {}) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  return Bodies.rectangle((x1 + x2) / 2, (y1 + y2) / 2, len + t, t, {
    ...STATIC, angle: Math.atan2(dy, dx), label: 'wall', ...extra,
  });
}

function polyBody(points, opts) {
  const verts = Vertices.clockwiseSort(points.map(([x, y]) => ({ x, y })));
  const c = Vertices.centre(verts);
  return Body.create({ ...opts, position: c, vertices: verts.map((v) => ({ x: v.x - c.x, y: v.y - c.y })) });
}

function flipperBody(f) {
  const sgn = f.side === 'L' ? 1 : -1;
  const pts = [];
  for (let i = 0; i <= 8; i++) { // demi-cercle de la pointe
    const a = -Math.PI / 2 + (Math.PI * i) / 8;
    pts.push([f.len + Math.cos(a) * f.r2, Math.sin(a) * f.r2]);
  }
  for (let i = 0; i <= 10; i++) { // demi-cercle du pivot
    const a = Math.PI / 2 + (Math.PI * i) / 10;
    pts.push([Math.cos(a) * f.r1, Math.sin(a) * f.r1]);
  }
  const body = polyBody(pts.map(([x, y]) => [f.px + x * sgn, f.py + y]), {
    isStatic: true, restitution: 0.2, friction: 0.05, label: 'flipper',
  });
  // Les sommets sont construits à l'angle 0 : on tourne à l'angle de repos autour du pivot.
  Body.rotate(body, f.rest, { x: f.px, y: f.py });
  return { def: f, body, angle: f.rest, held: false };
}

export function buildTable(engine) {
  const world = engine.world;
  const add = (b) => { Composite.add(world, b); return b; };
  const T = {
    walls: [], flippers: [], bumpers: [], slings: [], drops: [], standups: [], lanes: [],
    rampSensors: [], saucer: null, drain: null, gate: null,
  };

  // --- haut du plateau (demi-ellipse aplatie), murs épais posés à l'extérieur de la face intérieure
  const { cx, cy, rx, ry } = GEO.ellipse;
  const N = 48, TH = 40;
  for (let i = 0; i < N; i++) {
    const a1 = Math.PI + (Math.PI * i) / N, a2 = Math.PI + (Math.PI * (i + 1)) / N;
    const p1 = { x: cx + rx * Math.cos(a1), y: cy + ry * Math.sin(a1) };
    const p2 = { x: cx + rx * Math.cos(a2), y: cy + ry * Math.sin(a2) };
    const am = (a1 + a2) / 2;
    let nx = Math.cos(am) / rx, ny = Math.sin(am) / ry; // normale extérieure de l'ellipse
    const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) + 6;
    T.walls.push(add(Bodies.rectangle((p1.x + p2.x) / 2 + nx * TH / 2, (p1.y + p2.y) / 2 + ny * TH / 2, len, TH, {
      ...STATIC, angle: Math.atan2(p2.y - p1.y, p2.x - p1.x), label: 'wall', plugin: { hidden: true },
    })));
  }
  // côtés
  const sideH = H - cy + 60;
  T.walls.push(add(Bodies.rectangle(-30, cy + sideH / 2, 60, sideH, { ...STATIC, label: 'wall', plugin: { hidden: true } })));
  T.walls.push(add(Bodies.rectangle(W + 30, cy + sideH / 2, 60, sideH, { ...STATIC, label: 'wall', plugin: { hidden: true } })));

  // --- couloir du lanceur
  const ls = GEO.laneSep;
  T.walls.push(add(Bodies.rectangle(ls.x, (ls.y1 + ls.y2) / 2, ls.t, ls.y2 - ls.y1, { ...STATIC, label: 'wall' })));
  T.walls.push(add(roundBody(ls.x, ls.y1, ls.t / 2, { ...STATIC, label: 'wall' })));
  const p = GEO.plunger;
  T.walls.push(add(Bodies.rectangle(p.x, p.top + 20, W - PLAY_R - 4, 40, { ...STATIC, restitution: 0.05, label: 'plunger' })));
  // portillon à sens unique (catégorie à part, activé par bille — voir sim.js)
  const g = GEO.gate;
  // incliné vers le plateau : une bille qui retombe dessus roule vers la gauche
  T.gate = add(Bodies.rectangle((g.x1 + g.x2) / 2, g.y, Math.hypot(g.x2 - g.x1, g.drop) + 4, 5, {
    ...STATIC, angle: Math.atan2(-g.drop, g.x2 - g.x1), label: 'gate',
    collisionFilter: { category: CAT.GATE, mask: 0xffffffff },
  }));

  // --- déflecteurs latéraux : renvoient vers le centre une bille qui descend le long des murs
  for (const [a, b] of GEO.deflectors) T.walls.push(add(seg(...a, ...b, 8, { restitution: 0.45 })));

  // --- séparateurs de couloirs bas (dans le prolongement des flippers)
  for (const s of GEO.separators) {
    for (let i = 0; i < s.length - 1; i++) T.walls.push(add(seg(...s[i], ...s[i + 1], GUIDE_T)));
    T.walls.push(add(roundBody(s[0][0], s[0][1], 5, { ...STATIC, label: 'wall' })));
  }
  for (const [a, b] of GEO.dividers) {
    T.walls.push(add(seg(...a, ...b, GUIDE_T)));
    for (const p of [a, b]) T.walls.push(add(roundBody(p[0], p[1], GUIDE_T / 2 + 1, { ...STATIC, label: 'wall' })));
  }

  // --- lance-pierres
  GEO.slings.forEach((s, i) => {
    const body = add(polyBody(s.pts, { isStatic: true, restitution: 0.3, label: 'sling' }));
    const A = s.pts[s.face[0]], C = s.pts[s.face[1]];
    const B = s.pts.find((_, k) => k !== s.face[0] && k !== s.face[1]);
    let nx = C[1] - A[1], ny = -(C[0] - A[0]);
    const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
    if ((B[0] - A[0]) * nx + (B[1] - A[1]) * ny > 0) { nx = -nx; ny = -ny; }
    body.plugin = { idx: i, A, C, n: { x: nx, y: ny } };
    T.slings.push(body);
  });

  // --- flippers
  for (const f of GEO.flippers) {
    const fl = flipperBody(f);
    add(fl.body);
    T.flippers.push(fl);
  }

  // --- bumpers (boules)
  GEO.bumpers.forEach((b, i) => {
    T.bumpers.push(add(roundBody(b.x, b.y, b.r, { ...STATIC, restitution: 0.5, label: 'bumper', plugin: { idx: i, cap: b.cap } })));
  });

  // --- couloirs du haut T O U R
  for (const post of GEO.lanePosts) {
    T.walls.push(add(Bodies.rectangle(post.x, (post.y1 + post.y2) / 2, 6, post.y2 - post.y1, { ...STATIC, label: 'wall' })));
    T.walls.push(add(roundBody(post.x, post.y1, 3, { ...STATIC, label: 'wall' })));
    T.walls.push(add(roundBody(post.x, post.y2, 3, { ...STATIC, label: 'wall' })));
  }
  GEO.lanes.forEach((l, i) => {
    T.lanes.push(add(Bodies.rectangle(l.x, l.y, 30, 10, { isStatic: true, isSensor: true, label: 'lane', plugin: { idx: i } })));
  });

  // --- cibles tombantes F A N N Y (retirées / remises par sim.js)
  GEO.drops.forEach((dd, i) => {
    T.drops.push(add(Bodies.rectangle(dd.x, dd.y, dd.w, dd.h, {
      ...STATIC, angle: dd.angle, restitution: 0.2, label: 'drop', plugin: { idx: i },
    })));
  });
  // bloc plein derrière la banque (face avant juste derrière les cibles, toit incliné vers le plateau)
  {
    const b = GEO.dropBank, last = GEO.drops[GEO.drops.length - 1];
    const back = (x, y, along) => [x + b.dir.x * along - b.n.x * 7, y + b.dir.y * along - b.n.y * 7];
    const A = back(b.x0, b.y0, -16), B = back(last.x, last.y, 16);
    const housing = polyBody([A, B, [PLAY_R + 2, B[1] + 14], [PLAY_R + 2, A[1] - 40]], { ...STATIC, label: 'wall' });
    housing.plugin = { housing: true };
    T.walls.push(add(housing));
  }

  // --- cibles fixes POINTER / TIRER
  GEO.standups.forEach((s, i) => {
    T.standups.push(add(roundBody(s.x, s.y, s.r, { ...STATIC, restitution: 0.45, label: 'standup', plugin: { idx: i, id: s.id } })));
  });

  // --- couloir du bouchon : deux parois, fond en pointe derrière le cochonnet (rien de plat vers le haut)
  {
    const L = GEO.bouchonLane, w = L.half + 3;
    const P = (base, k, along = 0) => [base.x + L.v.x * k + L.u.x * along, base.y + L.v.y * k + L.u.y * along];
    const cache = { plugin: { hidden: true } };   // dessinés ensemble comme une seule pièce (GEO.bouchonPiece)
    T.walls.push(add(seg(...P(L.M, -w), ...P(L.B, -w, 14), 6, cache)));
    T.walls.push(add(seg(...P(L.M, w), ...P(L.B, w, 14), 6, cache)));
    const peak = P(L.B, 0, 30);
    T.walls.push(add(seg(...P(L.B, -w, 14), ...peak, 6, cache)));
    T.walls.push(add(seg(...peak, ...P(L.B, w, 14), 6, cache)));
    for (const k of [-w, w]) T.walls.push(add(roundBody(...P(L.M, k), 4, { ...STATIC, label: 'wall' })));
    // blocs pleins de part et d'autre du couloir : aucune poche où une bille pourrait se coincer,
    // toits en pente qui renvoient la bille vers l'entrée de rampe puis le plateau
    const R = GEO.rampEntries[0], wr = R.half + 3;
    const Q = (base, k) => [base.x + R.v.x * k, base.y + R.v.y * k];
    const roofR = Q(R.T, wr);                               // haut de la paroi droite de l'entrée de rampe
    const blocks = [
      [[-2, 312], roofR, Q(R.T, -wr)],                      // grand toit en pente (≈ 16°) au-dessus de tout
      [[-2, 312], P(L.B, -w, 14), [-2, 372]],
      [[-2, 372], P(L.B, -w, 14), P(L.M, -w), [-2, 478]],
      [P(L.B, w, 14), Q(R.T, -wr), Q(R.M, -wr), P(L.M, w)],
    ];
    for (const pts of blocks) {
      const blk = polyBody(pts, { ...STATIC, label: 'wall' });
      blk.plugin = { hidden: true };
      T.walls.push(add(blk));
    }
    // contour unique de la pièce (en U autour du couloir), dessiné avec des coins arrondis ;
    // arrondis aussi dans la physique aux deux coins saillants
    // côté rampe, la pièce s'arrête à la face extérieure de la paroi gauche de l'entrée (pièce à part)
    GEO.bouchonPiece = [[-2, 312], roofR, Q(R.T, -wr - 3), Q(R.M, -wr - 3), P(L.M, w), P(L.B, w, 14),
      P(L.B, -w, 14), P(L.M, -w), [-2, 478]];
    // cercle inscrit dans le coin (tangent aux deux faces) : centré sur le coin, il dépassait du toit
    // et formait un petit barrage où la bille s'arrêtait (lâcher en grille du 20/11)
    const inset = (c, p1, p2, r) => {
      const a = [p1[0] - c[0], p1[1] - c[1]], b = [p2[0] - c[0], p2[1] - c[1]];
      const la = Math.hypot(...a), lb = Math.hypot(...b);
      const ua = [a[0] / la, a[1] / la], ub = [b[0] / lb, b[1] / lb];
      const bis = [ua[0] + ub[0], ua[1] + ub[1]], lbis = Math.hypot(...bis);
      const half = Math.acos(Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1]))) / 2;
      const d = r / Math.sin(half);
      return [c[0] + (bis[0] / lbis) * d, c[1] + (bis[1] / lbis) * d];
    };
    const corners = [
      inset(roofR, [-2, 312], Q(R.M, wr), 6),
      inset(Q(R.M, -wr), Q(R.T, -wr), P(L.M, w), 6),
    ];
    for (const c of corners) T.walls.push(add(roundBody(...c, 6, { ...STATIC, label: 'wall', plugin: { hidden: true } })));
    // congé de 20 mm entre le mur gauche et le toit (pente de 14° seulement) : la bille s'arrêtait dans
    // l'angle (essais de blocage du 21/11) ; cercle tangent aux deux faces, et l'arc dans le contour de la pièce
    {
      const c0 = [0, 312 + ((roofR[1] - 312) * 2) / (roofR[0] + 2)];   // toit au ras du mur
      const rc = 20, o = inset(c0, [0, 200], roofR, rc);
      const ux = roofR[0] - c0[0], uy = roofR[1] - c0[1], l = Math.hypot(ux, uy);
      const t = ((o[0] - c0[0]) * ux + (o[1] - c0[1]) * uy) / l;         // pied du centre sur le toit
      const a1 = Math.atan2(c0[1] + (uy / l) * t - o[1], c0[0] + (ux / l) * t - o[0]);
      const arc = [[-2, o[1]]];
      for (let i = 0; i <= 8; i++) { const a = Math.PI + ((a1 - Math.PI) * i) / 8; arc.push([o[0] + rc * Math.cos(a), o[1] + rc * Math.sin(a)]); }
      GEO.bouchonPiece.splice(0, 1, ...arc);
      // physique : l'arc seul (un cercle entier dépasserait au-dessus du mur et ferait une nouvelle poche),
      // en éventail de triangles convexes depuis le coin
      for (let i = 1; i < arc.length - 1; i++) {
        const tri = polyBody([c0, arc[i], arc[i + 1]], { ...STATIC, label: 'wall' });
        tri.plugin = { hidden: true };
        T.walls.push(add(tri));
      }
    }
  }

  // --- paroi des cibles rondes (mur gauche) : bloc plein, haut et bas en pente ; les cibles sont
  // trois tronçons de sa face, chacun avec son contact
  {
    const LW = GEO.leftWall;
    const blk = polyBody([[-2, LW.y1 - 24], [LW.x - 4, LW.y1], [LW.x - 4, LW.y2], [-2, LW.y2 + 24]], { ...STATIC, label: 'wall' });
    blk.plugin = { housing: true };
    T.walls.push(add(blk));
    T.leftTargets = GEO.leftTargets.map((t, i) => add(Bodies.rectangle(t.x - 3, t.y, 8, 38, {
      ...STATIC, restitution: 0.35, label: 'target', plugin: { idx: i, id: t.id },
    })));
  }

  // --- le Cercle (trou)
  const sc = GEO.saucer;
  T.saucer = add(Bodies.circle(sc.x, sc.y, sc.r, { isStatic: true, isSensor: true, label: 'saucer' }));

  // --- entrées de rampes
  for (const r of GEO.rampEntries) {
    const w = r.half + 3; // axe des parois (épaisseur 6)
    const P = (base, k) => [base.x + r.v.x * k, base.y + r.v.y * k];
    // flancs de la rampe en entonnoir (dessinés par la rampe en 3D, d'où plugin.flanc) ; derrière T, le bloc
    // du bouchon ferme le plan (la bille y est déjà sur la rampe)
    const wf = r.fond + 3, Pe = (k, a) => [r.M.x + r.v.x * k + r.u.x * a, r.M.y + r.v.y * k + r.u.y * a];
    const len = Math.hypot(r.T.x - r.M.x, r.T.y - r.M.y);
    for (const sg of [-1, 1]) {
      T.walls.push(add(seg(...Pe(sg * w, 0), ...Pe(sg * wf, r.evase), 6, { plugin: { flanc: true } })));
      T.walls.push(add(seg(...Pe(sg * wf, r.evase), ...Pe(sg * wf, len), 6, { plugin: { flanc: true } })));
    }
    // enseigne « ESCALE » au-dessus du début de la rampe, inclinée de 40° vers le joueur : bord avant à
    // « a » mm de la bouche, profondeur « prof » ; pts : son empreinte vue de dessus (pour le décor)
    const en = { a: 30, prof: 20, incl: 40, demi: w + 3 };
    const pr = en.a + en.prof * Math.cos((en.incl * Math.PI) / 180);
    GEO.enseigneRampe = { ...en, pts: [Pe(-en.demi, en.a), Pe(en.demi, en.a), Pe(en.demi, pr), Pe(-en.demi, pr)] };
    T.rampSensors.push(add(Bodies.rectangle(r.sensor.x, r.sensor.y, r.half * 2 - 6, 14, {
      isStatic: true, isSensor: true, angle: Math.atan2(r.v.y, r.v.x), label: 'rampEntry',
      plugin: { side: r.side, u: r.u },
    })));
  }

  // --- bras du tablier : leur face suit le bord avant du tablier
  const ap = GEO.apron;
  for (const [a, b] of [[[0, ap.side], [CX - ap.half, ap.front]], [[CX + ap.half, ap.front], [PLAY_R, ap.side]]]) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), nx = -dy / l * 3, ny = dx / l * 3;
    T.walls.push(add(seg(a[0] + nx, a[1] + ny, b[0] + nx, b[1] + ny, 6, { restitution: 0.2, label: 'apron', plugin: { hidden: true } })));
  }

  // --- plot central (cylindre caoutchouc dans la physique, comme les poteaux d'entrée des couloirs)
  const cp = GEO.centerPost;
  T.walls.push(add(roundBody(cp.x, cp.y, cp.r, { ...STATIC, label: 'wall', plugin: { centre: true } })));

  // --- évacuation
  T.drain = add(Bodies.rectangle(CX, GEO.drainY + 10, PLAY_R, 20, { isStatic: true, isSensor: true, label: 'drain' }));

  return T;
}

// Chemin lissé (Catmull-Rom) d'une rampe, échantillonné, avec longueurs cumulées.
export function rampPath(points, step = 6) {
  const out = [];
  const P = [points[0], ...points, points[points.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    const k = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let j = 0; j < k; j++) {
      const t = j / k, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, e) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - e) * t2 + (-a + 3 * b - 3 * c + e) * t3);
      out.push({ x: f(p0[0], p1[0], p2[0], p3[0]), y: f(p0[1], p1[1], p2[1], p3[1]) });
    }
  }
  out.push({ x: points[points.length - 1][0], y: points[points.length - 1][1] });
  let acc = 0;
  out.forEach((pt, i) => { if (i) acc += Math.hypot(pt.x - out[i - 1].x, pt.y - out[i - 1].y); pt.s = acc; });
  return { pts: out, length: acc };
}

export function pointAt(path, s) {
  const pts = path.pts;
  if (s <= 0) return { ...pts[0], dx: 0, dy: -1 };
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].s >= s) {
      const a = pts[i - 1], b = pts[i];
      const t = (s - a.s) / (b.s - a.s || 1);
      const dd = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: (b.x - a.x) / dd, dy: (b.y - a.y) / dd };
    }
  }
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const dd = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: b.x, y: b.y, dx: (b.x - a.x) / dd, dy: (b.y - a.y) / dd };
}
