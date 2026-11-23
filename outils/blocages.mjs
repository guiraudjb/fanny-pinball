// Recherche des points de blocage de la bille sur tout le plateau et la rampe, sur la vraie physique (Rapier + CAO).
//
//  1. Plateau : une bille est posée sur chaque nœud d'une grille (pas de --pas mm), immobile puis lancée dans
//     4 directions ; palettes au repos, bobines sous tension, sans la secousse automatique du jeu. Une bille qui
//     reste immobile (< 1 cm/s pendant 1 s) ailleurs qu'au Cercle ou dans le couloir de lancement est un blocage.
//  2. Rampe : la bille est envoyée dans l'entrée de la rampe de 0,5 à 4 m/s, décalée et inclinée ; on classe
//     l'issue (rampe faite, redescendue, arrêtée sur la rampe, sortie de la table).
//
//   node outils/blocages.mjs [--pas 12] [--duree 8000] [--variantes 5] [--json sortie.json]
//   (--variantes 1 : bille posée immobile seulement ; --sans-plateau / --sans-rampe : une seule des deux parties)
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1] ?? true; };
let graine = 11;
Math.random = () => ((graine = (graine * 1664525 + 1013904223) >>> 0) / 2 ** 32);
globalThis.window = { Matter: require(path.join(RACINE, 'vendor/matter.min.js')), crypto: globalThis.crypto, performance: globalThis.performance };
const { creerSim } = await import(path.join(RACINE, 'js/sim.js'));
const { GEO, W, H, BALL_R } = await import(path.join(RACINE, 'js/table.js'));
const b = readFileSync(path.join(RACINE, 'assets/cao/collision.glb'));
const glb = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const contacts = [];
const sim = await creerSim((id) => contacts.push(id), { glb });
sim.secoueAuto = false;
const R = (await import(path.join(RACINE, 'vendor/rapier.module.js'))).default;

const PAS = Number(arg('pas', 12));
const DUREE = Number(arg('duree', 8000));
const DT = 1000 / 480;
const vImg = (ms) => (ms * 1000) / 60;

// la bille tient-elle à cet endroit sans toucher une pièce ? (sphère de test un peu plus grosse que la bille)
const boule = new R.Ball((BALL_R + 0.5) / 1000);
function libre(x, y, h = 1.2) {
  let touche = false;
  sim.world.intersectionsWithShape({ x: x / 1000, y: y / 1000, z: -(BALL_R + h) / 1000 }, { x: 0, y: 0, z: 0, w: 1 }, boule,
    (c) => { const r = sim.info.get(c.handle); if (!r || r.type !== 'lane' && r.type !== 'lowerLane' && r.type !== 'saucer' && r.type !== 'ramp') touche = true; return !touche; });
  return !touche;
}
// bille enfoncée de plus de 1 mm dans une pièce : départ posé dans l'épaisseur d'un mur (un maillage est creux, la
// sphère de test de libre() ne touche alors aucune face) ; ce n'est pas un endroit où la bille peut se trouver en jeu
function enfoncee(bille) {
  let k = false;
  sim.world.contactPairsWith(bille.collider, (o) => {
    sim.world.contactPair(bille.collider, o, (m) => { for (let i = 0; i < m.numContacts(); i++) if (m.contactDist(i) < -0.001) k = true; });
  });
  return k;
}
const auCercle = (p) => Math.hypot(p.x - GEO.saucer.x, p.y - GEO.saucer.y) < 20;
const auLanceur = (p) => p.x > GEO.playRight + 2 && p.y > GEO.plunger.top - 140;

// suit une bille jusqu'à sa perte, son arrêt ou la fin du temps ; renvoie l'issue
// Bloquée = immobile 3 s à moins de 1 mm près : au sommet d'un poteau rond (équilibre instable), une bille posée
// à 3 mm du centre met plus d'une seconde à prendre 1 cm/s avant de rouler ; ce n'est pas un blocage.
function suivre(bille, duree = DUREE) {
  let immobile = 0, ici = null;
  for (let t = 0; t < duree; t += DT) {
    sim.step(DT);
    if (bille.retiree) return { issue: 'perdue', t };
    if (t < 30 && enfoncee(bille)) return { issue: 'départ dans une paroi', t };
    if (bille.plugin.fp.mode === 'saucer') return { issue: 'cercle', t };
    const q = bille.position;
    if (bille.vitesse < 0.01 && (!ici || Math.hypot(q.x - ici.x, q.y - ici.y) < 1)) { ici ||= q; immobile += DT; } else { immobile = 0; ici = null; }
    if (immobile > 3000) {
      const p = bille.position;
      if (auLanceur(p)) return { issue: 'lanceur', t };
      return { issue: 'bloquee', t, x: +p.x.toFixed(1), y: +p.y.toFixed(1), h: +bille.hauteur.toFixed(1) };
    }
  }
  const p = bille.position;
  return { issue: 'en jeu', t: duree, x: +p.x.toFixed(1), y: +p.y.toFixed(1), h: +bille.hauteur.toFixed(1) };
}
function nouvelle() { sim.clear(); sim.held = { L: false, R: false }; sim.power = true; contacts.length = 0; }

const res = { plateau: [], rampe: [] };

// 1. grille du plateau
if (!arg('sans-plateau')) {
  const t0 = Date.now();
  let n = 0;
  const dirs = [null, [0, -1], [1, 0], [-1, 0], [0, 1]].slice(0, Number(arg('variantes', 5)));
  for (let y = PAS / 2; y < H; y += PAS) for (let x = PAS / 2; x < W; x += PAS) {
    nouvelle();
    if (!libre(x, y) || auLanceur({ x, y })) continue;
    for (const d of dirs) {
      nouvelle();
      const bille = sim.makeBall(x, y);
      if (d) sim.setRoulement(bille, vImg(0.4) * d[0], vImg(0.4) * d[1]);
      const r = suivre(bille);
      n++;
      if (r.issue === 'bloquee' || r.issue === 'en jeu') res.plateau.push({ depart: [x, y], v: d, ...r });
    }
  }
  console.log(`plateau : ${n} essais en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// regroupe les arrêts proches (5 mm) : un point de blocage = un lieu où plusieurs départs finissent
function grouper(liste) {
  const g = [];
  for (const r of liste) {
    const p = g.find((q) => Math.hypot(q.x - r.x, q.y - r.y) < 5 && Math.abs(q.h - r.h) < 5);
    if (p) { p.n++; p.departs.push(r.depart); } else g.push({ x: r.x, y: r.y, h: r.h, issue: r.issue, n: 1, departs: [r.depart] });
  }
  return g.sort((a, b) => b.n - a.n);
}
const bloc = grouper(res.plateau.filter((r) => r.issue === 'bloquee'));
const enJeu = res.plateau.filter((r) => r.issue === 'en jeu');
console.log(`points de blocage : ${bloc.length}`);
for (const g of bloc) console.log(`  (${g.x}, ${g.y}) h ${g.h} mm : ${g.n} départ(s), ex. ${JSON.stringify(g.departs.slice(0, 3))}`);
console.log(`billes encore en jeu après ${DUREE / 1000} s : ${enJeu.length}`);
for (const r of enJeu.slice(0, 15)) console.log(`  départ ${JSON.stringify(r.depart)} v ${JSON.stringify(r.v)} → (${r.x}, ${r.y}) h ${r.h}`);

// 2. rampe : entrée M, axe u (vers le haut de la rampe), v en travers
if (!arg('sans-rampe')) {
  const E = GEO.rampEntries[0];
  const bilan = {};
  for (const v of [0.5, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.4, 2.8, 3.2, 4.0]) for (const dec of [-12, -6, 0, 6, 12]) for (const ang of [-15, 0, 15]) {
    nouvelle();
    const x0 = E.M.x - E.u.x * 60 + E.v.x * dec, y0 = E.M.y - E.u.y * 60 + E.v.y * dec;
    const a = (ang * Math.PI) / 180;
    const dx = E.u.x * Math.cos(a) + E.v.x * Math.sin(a), dy = E.u.y * Math.cos(a) + E.v.y * Math.sin(a);
    const bille = sim.makeBall(x0, y0);
    sim.setRoulement(bille, vImg(v) * dx, vImg(v) * dy);   // bille qui roule, comme au sortir d'une palette
    let hMax = 0, sortie = false;
    let r = null;
    for (let t = 0, immobile = 0; t < 9000; t += DT) {
      sim.step(DT);
      if (bille.retiree) { r = { issue: 'perdue' }; break; }
      if (bille.plugin.fp.mode === 'saucer') { r = { issue: 'cercle' }; break; }
      hMax = Math.max(hMax, bille.hauteur);
      if (bille.hauteur > 105 - 2 * BALL_R - 1) sortie = true;
      if (bille.vitesse < 0.01) immobile += DT; else immobile = 0;
      if (immobile > 3000) { const p = bille.position; r = { issue: auLanceur(p) ? 'lanceur' : 'bloquee', x: +p.x.toFixed(1), y: +p.y.toFixed(1), h: +bille.hauteur.toFixed(1) }; break; }
    }
    r = r || { issue: 'en jeu' };
    const fait = contacts.includes('ramp');
    const cle = fait ? 'rampe faite' : hMax > 20 ? `montée puis ${r.issue}` : r.issue;
    (bilan[v] ||= {})[cle] = (bilan[v][cle] || 0) + 1;
    if (r.issue === 'bloquee' || sortie) res.rampe.push({ v, dec, ang, ...r, hMax: +hMax.toFixed(1), vitre: sortie });
  }
  console.log('rampe (15 essais par vitesse : décalage ±12 mm, angle ±15°) :');
  for (const [v, o] of Object.entries(bilan)) console.log(`  ${v} m/s : ${Object.entries(o).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  const br = grouper(res.rampe.filter((r) => r.issue === 'bloquee').map((r) => ({ ...r, depart: [r.v, r.dec, r.ang] })));
  console.log(`blocages depuis la rampe : ${br.length}`);
  for (const g of br) console.log(`  (${g.x}, ${g.y}) h ${g.h} mm : ${g.n} essai(s), ex. ${JSON.stringify(g.departs.slice(0, 3))}`);
  const vitre = res.rampe.filter((r) => r.vitre);
  console.log(`bille contre la vitre : ${vitre.length}`);
  res.bilanRampe = bilan;
}
res.blocages = bloc;
if (arg('json')) writeFileSync(arg('json'), JSON.stringify(res, null, 1));
process.exit(0);
