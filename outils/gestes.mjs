// Banc d'essai des gestes techniques aux palettes, sur la vraie physique (Rapier + surfaces de la CAO).
// Chaque geste est essayé sur une plage de réglages (instant, durée, point d'impact) ; on compte les réussites.
// Sert à vérifier que la géométrie des palettes permet tous les gestes, sans la régler pour un robot.
//
//   node outils/gestes.mjs [--cinematique] [--sans-caoutchouc] [--json sortie.json]
//   --regle CHEMIN=valeur : change un réglage de REGLAGES (sim.js) pour l'essai
//   --sans-caoutchouc : rebond constant des caoutchoucs (sans e(v) ni hystérésis)
//   --cinematique : ancien modèle de palette (vitesse imposée, masse infinie) au lieu de la palette motorisée
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1] ?? true; };
let graine = 7;
Math.random = () => ((graine = (graine * 1664525 + 1013904223) >>> 0) / 2 ** 32);
globalThis.window = { Matter: require(path.join(RACINE, 'vendor/matter.min.js')), crypto: globalThis.crypto, performance: globalThis.performance };
const { creerSim, REGLAGES } = await import(path.join(RACINE, 'js/sim.js'));
// --regle CAOUTCHOUC.hysteresis=0.1 --regle MATIERES.palette.1=0.8 (plusieurs fois possible)
process.argv.forEach((a, i) => {
  if (a !== '--regle') return;
  const [cle, val] = process.argv[i + 1].split('=');
  const ch = cle.split('.'), dernier = ch.pop();
  ch.reduce((o, k) => o[k], REGLAGES)[dernier] = Number(val);
});
const { GEO, CX } = await import(path.join(RACINE, 'js/table.js'));
const b = readFileSync(path.join(RACINE, 'assets/cao/collision.glb'));
const glb = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const sim = await creerSim(() => {}, { glb, motorisee: !process.argv.includes('--cinematique'), caoutchoucs: !process.argv.includes('--sans-caoutchouc') });
sim.power = true;

const FR = 1000 / 60;
const MS = 1000 / 60 / 1000;                       // m/s → mm/image : v / MS / 1000
const vImg = (ms) => (ms * 1000) / 60;            // m/s → mm par image (unités de setVitesse)
const FL = { L: GEO.flippers[0], R: GEO.flippers[1] };
const autre = (s) => (s === 'L' ? 'R' : 'L');
const sg = (s) => (s === 'L' ? 1 : -1);

// repère d'une palette : le = distance le long de la palette au repos, depuis l'axe
function le(side, p) {
  const f = FL[side], a = FL.L.rest;
  const dx = (p.x - f.px) * sg(side), dy = p.y - f.py;
  return dx * Math.cos(a) + dy * Math.sin(a);
}
const surPalette = (side, p) => Math.abs(p.x - FL[side].px) < 80 && p.y > FL[side].py - 45 && p.y < FL[side].py + 50
  && (side === 'L' ? p.x < CX : p.x > CX);
const pas = (n = 1) => { for (let i = 0; i < n; i++) sim.step(FR); };
// coup de palette de « ms » millisecondes, au pas de la physique (2,08 ms) et non à l'image
function coup(side, ms) { sim.held[side] = true; for (let t = 0; t < ms; t += 1000 / 480) sim.step(1000 / 480); sim.held[side] = false; }
function reset(held = { L: false, R: false }) {
  sim.clear();
  sim.held = { ...held };
  pas(20);                                         // palettes en place
}
// met une bille en berceau sur la palette tenue : elle descend le couloir de retour à une vitesse d'arrivée qui bloque
// (essais à 1,0 / 0,5 / 1,5 / 0 m/s, couloir intérieur puis extérieur) ; renvoie la bille immobile en berceau (ou null)
function berceau(side) {
  for (const v of [1.0, 0.5, 1.5, 0]) for (const lane of ['inInt', 'inExt']) {
    reset({ L: side === 'L', R: side === 'R' });
    const l = GEO.lowerLanes.find((q) => q.id === lane + side);
    const bille = sim.makeBall(l.x, l.y - 20);
    sim.setVitesse(bille, 0, vImg(v));
    for (let k = 0; k < 240 && !bille.retiree; k++) pas();
    if (!bille.retiree && bille.vitesse < 0.03 && surPalette(side, bille.position)) return bille;
  }
  for (const v of [0, 0.5]) for (const lane of ['inExt', 'inInt']) for (const leC of [-30, -15, 0, 10, 20, 30, 40]) {
    const bille = receptionCouloir(side, lane, v, leC);
    if (bille) return bille;
  }
  return null;
}
// réception depuis le couloir de retour, comme un joueur : la palette est au repos, il la lève quand la bille, arrivée
// sur la palette, a roulé jusqu'à « leC » mm de l'axe ; renvoie la bille immobile en berceau (ou null)
function receptionCouloir(side, lane, v, leC) {
  reset();
  const l = GEO.lowerLanes.find((q) => q.id === lane + side);
  const bille = sim.makeBall(l.x, l.y - 20);
  sim.setVitesse(bille, 0, vImg(v));
  for (let t = 0; t < 4000 && !bille.retiree; t += 1000 / 480) {
    sim.step(1000 / 480);
    if (!sim.held[side] && distPalette(side, bille.position) < 3 && le(side, bille.position) >= leC) sim.held[side] = true;
    if (sim.held[side] && bille.vitesse < 0.03 && distPalette(side, bille.position) < 2) return bille;
  }
  return null;
}
// distance de la bille à la surface de la palette (angle courant), en mm
function distPalette(side, p) {
  const fl = sim.T.flippers.find((q) => q.def.side === side), f = fl.def, a = fl.angle;
  const ux = sg(side) * Math.cos(a), uy = sg(side) * Math.sin(a);
  const t = Math.max(0, Math.min(f.len, (p.x - f.px) * ux + (p.y - f.py) * uy));
  return Math.hypot(p.x - f.px - ux * t, p.y - f.py - uy * t) - (f.r1 + (f.r2 - f.r1) * (t / f.len)) - 13.5;
}
// Réception sur l'autre palette, comme un joueur : la palette receveuse reste au repos et il la lève quand la bille
// arrive à « d » mm de sa surface (d = 0 : au contact ; d < 0 : tenue levée dès le départ). Réussite = bille immobile
// en berceau. Le geste est rejoué pour chaque instant de levée (simulation déterministe).
const LEVEES = [-1, 0, 5, 10, 20, 30, 45, 60];
function receptionner(bille, side, d, ms = 3000) {
  const o = autre(side);
  if (d < 0) sim.held[o] = true;
  for (let t = 0; t < ms; t += 1000 / 480) {
    sim.step(1000 / 480);
    if (bille.retiree) return false;
    if (!sim.held[o] && distPalette(o, bille.position) <= d) sim.held[o] = true;
    if (sim.held[o] && bille.vitesse < 0.03 && distPalette(o, bille.position) < 2) return true;
  }
  return false;
}
// rejoue « geste » (qui prépare la bille et renvoie la bille, ou null) pour chaque levée ; renvoie les levées réussies
function essaisReception(geste, side) {
  const ok = [];
  for (const d of LEVEES) {
    const bille = geste();
    if (bille && receptionner(bille, side, d)) ok.push(d);
  }
  return ok;
}

const R = {};

// 0. Course à vide de la palette (appui maintenu, sans bille) : temps pour aller du repos à la butée haute
{
  reset();
  const fl = sim.T.flippers[0];
  sim.held.L = true;
  let t = 0;
  while (Math.abs(fl.angle - fl.def.up) > 0.01 && t < 300) { sim.step(1000 / 480); t += 1000 / 480; }
  sim.held.L = false;
  let r = 0;
  while (Math.abs(fl.angle - fl.def.rest) > 0.01 && r < 500) { sim.step(1000 / 480); r += 1000 / 480; }
  console.log(`course à vide : levée ${t.toFixed(0)} ms, retour ${r.toFixed(0)} ms`);
  R.course = { levee_ms: Math.round(t), retour_ms: Math.round(r) };
}

const note = (nom, ok, total, detail = '') => {
  R[nom] = { ok, total, taux: +(ok / total).toFixed(2), detail };
  console.log(`${nom.padEnd(34)} ${String(ok).padStart(3)}/${String(total).padEnd(3)} ${detail}`);
};

// 1. Berceau : la bille descend le couloir de retour (lâchée à 4 vitesses) sur la palette levée et s'y arrête
{
  let ok = 0, n = 0;
  for (const side of ['L', 'R']) for (const v of [0, 0.5, 1.0, 1.5]) for (const lane of ['inInt', 'inExt']) {
    n++;
    reset({ L: side === 'L', R: side === 'R' });
    const l = GEO.lowerLanes.find((q) => q.id === lane + side);
    const bille = sim.makeBall(l.x, l.y - 20);
    sim.setVitesse(bille, 0, vImg(v));
    let k = 0;
    for (; k < 240 && !bille.retiree; k++) pas();
    if (!bille.retiree && bille.vitesse < 0.03 && surPalette(side, bille.position)) ok++;
  }
  note('berceau (couloir → palette levée)', ok, n, 'v 0 à 1,5 m/s, 2 couloirs, 2 côtés');
}
// 1 bis. Réception depuis le couloir de retour (palette au repos, levée quand la bille a roulé jusqu'à le mm) :
//        réussite = au moins un instant de levée qui met la bille en berceau
{
  let ok = 0, n = 0; const regl = [];
  for (const side of ['L', 'R']) for (const v of [0, 0.5, 1.0]) for (const lane of ['inInt', 'inExt']) {
    n++;
    const r = [-30, -15, 0, 10, 20, 30, 40, 50].filter((leC) => receptionCouloir(side, lane, v, leC));
    if (r.length) { ok++; regl.push(`${side}${lane.slice(2)}/${v}:${r.length}`); }
  }
  note('réception depuis le couloir de retour', ok, n, regl.join(' '));
}

// relâche la palette (bille en berceau) et attend que la bille ait roulé jusqu'à « leCible » mm de l'axe
function rouler(side, bille, leCible) {
  sim.held[side] = false;
  for (let t = 0; t < 1500; t += FR) {
    if (bille.retiree || le(side, bille.position) >= leCible) return true;
    pas();
  }
  return false;
}

// 2. Tir depuis le berceau : la bille roule jusqu'à « le », puis frappe ; vitesse de sortie
{
  const v = [];
  for (const leC of [20, 30, 40, 50]) for (const side of ['L', 'R']) {
    const bille = berceau(side);
    if (!bille || !rouler(side, bille, leC)) continue;
    sim.held[side] = true;
    let m = 0;
    for (let k = 0; k < 30; k++) { pas(); m = Math.max(m, bille.retiree ? 0 : bille.vitesse); }
    v.push(`${side}${leC}:${m.toFixed(2)}`);
  }
  note('tir (m/s max selon le point de frappe)', v.length, 8, v.join(' '));
}

// 3. Rebond mort : bille qui tombe sur la palette au repos et rebondit vers l'autre palette, que le joueur lève
//    au bon moment ; réussite = au moins un instant de levée qui met la bille en berceau
{
  let ok = 0, n = 0; const fen = [];
  for (const side of ['L', 'R']) for (const leI of [15, 25, 35, 45]) for (const v of [0.8, 1.2, 1.6]) {
    n++;
    const f = FL[side], a = f.rest;
    const x = f.px + Math.cos(a) * leI * sg(side), y = f.py + Math.sin(Math.abs(a)) * leI - 60;
    const r = essaisReception(() => { reset(); const bl = sim.makeBall(x, y); sim.setVitesse(bl, 0, vImg(v)); return bl; }, side);
    if (r.length) { ok++; fen.push(`${leI}/${v}:${r.length}`); }
  }
  note('rebond mort (palette au repos)', ok, n, `impact 15–45 mm, 0,8–1,6 m/s ; levées réussies sur ${LEVEES.length} : ${fen.join(' ')}`);
}

// 4. Passes depuis le berceau (post pass, tap pass) : la bille roule jusqu'à « le », coup bref de f ms ;
//    elle doit finir en berceau sur l'autre palette (levée par le joueur au bon moment)
{
  for (const side of ['L', 'R']) {
    let ok = 0, n = 0; const regl = [];
    for (const leC of [5, 10, 20, 30, 40, 50]) for (const f of [4, 8, 12, 17, 33]) {
      n++;
      const r = essaisReception(() => {
        const bille = berceau(side);
        if (!bille || !rouler(side, bille, leC)) return null;
        coup(side, f);
        return bille;
      }, side);
      if (r.length) { ok++; regl.push(`${leC}/${f}:${r.length}`); }
    }
    note(`passe depuis le berceau (${side === 'L' ? 'G → D' : 'D → G'})`, ok, n, regl.join(' '));
  }
}

// 5. Amorti par relâchement (drop catch) : bille qui descend du milieu du plateau vers la palette levée (visée à
//    35 mm de l'axe) ; le joueur relâche « avance » ms avant l'impact et relève après « releve » ms
{
  let ok = 0, n = 0;
  for (const side of ['L', 'R']) for (const v of [1.0, 1.5, 2.0]) for (const avance of [0, 10, 20]) for (const releve of [50, 100, 200]) {
    n++;
    reset({ L: side === 'L', R: side === 'R' });
    const f = FL[side], a = f.up;
    const cible = { x: f.px + sg(side) * Math.cos(a) * 35, y: f.py + sg(side) * Math.sin(a) * 35 - 20 };
    const depart = { x: CX + sg(side) * 10, y: f.py - 260 };
    const l = Math.hypot(cible.x - depart.x, cible.y - depart.y);
    const bille = sim.makeBall(depart.x, depart.y);
    sim.setVitesse(bille, vImg(v) * (cible.x - depart.x) / l, vImg(v) * (cible.y - depart.y) / l);
    let relache = false;
    for (let t = 0; t < 1500 && !bille.retiree; t += 1000 / 480) {
      const reste = (distPalette(side, bille.position) / Math.max(0.2, bille.vitesse * 1000)) * 1000;
      if (!relache && reste <= avance) {
        relache = true; sim.held[side] = false;
        for (let u = 0; u < releve; u += 1000 / 480) sim.step(1000 / 480);
        sim.held[side] = true;
      }
      sim.step(1000 / 480);
    }
    for (let k = 0; k < 90 && !bille.retiree; k++) pas();
    if (!bille.retiree && bille.vitesse < 0.03 && distPalette(side, bille.position) < 2) ok++;
  }
  note('drop catch (palette levée)', ok, n, 'descente 1–2 m/s, relâche 0–20 ms avant l\'impact, relève après 50–200 ms');
}

// 6. Bille qui tombe droit au milieu : perdue entre les palettes au repos ? (écart entre les pointes)
{
  const pts = GEO.flippers.map((f) => {
    const s = sg(f.side), a = Math.abs(f.rest);
    return { x: f.px + s * (Math.cos(a) * f.len), y: f.py + Math.sin(a) * f.len, r: f.r2 };
  });
  const ecart = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) - pts[0].r - pts[1].r;
  let perdues = 0, n = 0;
  for (const dx of [-6, -3, 0, 3, 6]) {
    n++; reset();
    const bille = sim.makeBall(CX + dx, FL.L.py - 120);
    sim.setVitesse(bille, 0, vImg(1));
    for (let k = 0; k < 120 && !bille.retiree; k++) pas();
    if (bille.retiree) perdues++;
  }
  note('chute au centre (perdues)', perdues, n, `écart entre pointes ${ecart.toFixed(1)} mm`);
}

if (arg('json')) writeFileSync(arg('json'), JSON.stringify(R, null, 1));
process.exit(0);
