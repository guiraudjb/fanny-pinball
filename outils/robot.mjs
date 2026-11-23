// Banc d'essai : le robot joueur expert (js/robot.js) joue une partie complète sur la vraie physique (Rapier,
// surfaces de la CAO) et les vraies règles, sans affichage. Rapport : score, billes, cibles touchées, rampes,
// billes perdues (couloir extérieur ou entre les palettes), billes coincées et où, coups de caisse, tilt.
//
//   node outils/robot.mjs [--parties 1] [--max-min 30] [--graine 1] [--json rapport.json]
//
// L'étalonnage des tirs (quelques dizaines de secondes) est gardé dans outils/robot_tirs.json ; --etalonner le refait.
import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1] ?? true; };

// hasard reproductible (Math.random sert aux règles et aux secousses)
let graine = Number(arg('graine', 1)) || 1;
Math.random = () => ((graine = (graine * 1664525 + 1013904223) >>> 0) / 2 ** 32);

globalThis.window = { Matter: require(path.join(RACINE, 'vendor/matter.min.js')), crypto: globalThis.crypto, performance: globalThis.performance };
const { creerSim } = await import(path.join(RACINE, 'js/sim.js'));
const { Rules, SW } = await import(path.join(RACINE, 'js/rules.js'));
const { Robot, etalonner } = await import(path.join(RACINE, 'js/robot.js'));
const { GEO } = await import(path.join(RACINE, 'js/table.js'));
const b = readFileSync(path.join(RACINE, 'assets/cao/collision.glb'));
const glb = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

const creer = async (onSwitch = () => {}) => {
  const contacts = [];
  const sim = await creerSim((id, closed = true) => { if (closed) contacts.push(id); onSwitch(id, closed); }, { glb });
  return { sim, contacts };
};

// ------------------------------------------------------------ étalonnage des tirs
const FICHIER_TIRS = path.join(RACINE, 'outils/robot_tirs.json');
let tirs;
if (existsSync(FICHIER_TIRS) && !process.argv.includes('--etalonner')) tirs = JSON.parse(readFileSync(FICHIER_TIRS, 'utf8'));
else {
  process.stderr.write('étalonnage des tirs depuis le berceau…\n');
  tirs = await etalonner(creer);
  writeFileSync(FICHIER_TIRS, JSON.stringify(tirs, null, 1));
}
for (const s of ['L', 'R']) process.stderr.write(`tirs ${s} : ${tirs[s].map((t) => `${t.d}:${t.cible}`).join(' ')}\n`);

// ------------------------------------------------------------ une partie
async function partie(n, maxMin) {
  let rules, sim;
  const comptes = {}, sons = {};
  const hw = { coil: (c) => sim.coil(c), sound: (id) => { sons[id] = (sons[id] || 0) + 1; }, event: () => {} };
  rules = new Rules(hw);
  ({ sim } = await creer((id, closed) => {
    if (closed) comptes[id] = (comptes[id] || 0) + 1;
    if (id === SW.DRAIN) perte();
    rules.onSwitch(id, closed);
    if (id === SW.DRAIN && rules.mode !== 'play') sim.clear();
  }));
  const act = {
    flip: (side, down) => {
      if (sim.held[side] === down) return;
      sim.held[side] = down;
      if (down) rules.onSwitch(side === 'L' ? SW.FLIP_L : SW.FLIP_R, true);
    },
    launch: (force) => { sim.force = force; rules.onSwitch(SW.LAUNCH); },
    nudge: (dx = 0) => sim.nudge(dx),
  };
  const robot = new Robot(sim, rules, act, tirs);
  robot.trace = !!arg('trace');

  // suivi : dernière position de chaque bille (pour savoir où elle est perdue), billes coincées
  const pertes = [], coincees = [], billes = [];
  const derniere = new Map();
  function perte() {
    // la bille retirée est celle qui était le plus bas
    const p = [...derniere.values()].reduce((m, q) => (q.y > m.y ? q : m), { x: 0, y: -1 });
    const ou = p.x < GEO.flippers[0].px - 30 ? 'couloir extérieur gauche' : p.x > 2 * 240 - GEO.flippers[0].px + 30 ? 'couloir extérieur droit' : 'entre les palettes';
    pertes.push({ t: sim.time, ou, x: Math.round(p.x), y: Math.round(p.y), sauvee: rules.ballSaveUntil > rules.now });
  }

  sim.clear();
  rules.onSwitch(SW.START);
  let billeEnCours = rules.ball, debut = 0, scoreDebut = 0, inactif = 0;
  const limite = maxMin * 60000;
  while (rules.mode !== 'over' && sim.time < limite) {
    sim.step(1000 / 60);
    rules.tick(sim.time);
    robot.tick(1000 / 60);
    if (arg('fin') && sim.time > 2600 && sim.time < 5000) for (const bl of sim.balls) if (bl.plugin.fp.mode === 'table') {
      const fl = sim.T.flippers[0], { px, py } = fl.def, dx = bl.position.x - px, dy = bl.position.y - py, c = Math.cos(GEO.flippers[0].rest), s2 = Math.sin(GEO.flippers[0].rest);
      process.stderr.write(`      ${(sim.time / 1000).toFixed(2)} (${bl.position.x.toFixed(0)},${bl.position.y.toFixed(0)}) le ${(dx * c + dy * s2).toFixed(0)} t ${(dx * s2 - dy * c).toFixed(0)} v ${bl.vitesse.toFixed(2)} vy ${(bl.velocity.y * 0.06).toFixed(2)} ${robot.etat.L.phase} ${sim.held.L}\n`); }
    derniere.clear();
    for (const bl of sim.balls) if (bl.plugin.fp.mode === 'table' && !bl.retiree) derniere.set(bl, { ...bl.position });
    // billes coincées : la simulation les secoue après 1,5 s immobile (fp.nudges compte les secousses au même endroit)
    for (const bl of sim.balls) {
      const fp = bl.plugin.fp;
      if (fp.nudges && fp.stuckAt && fp.nudges !== fp.vu) {
        fp.vu = fp.nudges;
        coincees.push({ t: sim.time, x: Math.round(fp.stuckAt.x), y: Math.round(fp.stuckAt.y), secousses: fp.nudges });
      }
    }
    if (rules.ball !== billeEnCours) {
      billes.push({ bille: billeEnCours, duree_s: Math.round((sim.time - debut) / 1000), points: rules.score - scoreDebut });
      billeEnCours = rules.ball; debut = sim.time; scoreDebut = rules.score;
    }
    // garde-fou : partie bloquée (aucun contact pendant 60 s)
    const total = Object.values(comptes).reduce((a, v) => a + v, 0);
    if (total === inactif.total) { if (sim.time - inactif.t > 60000) break; } else inactif = { total, t: sim.time };
    if (arg('trace') && sim.time % 2000 < 1000 / 60) process.stderr.write(`    ${(sim.time / 1000).toFixed(0)} s : ${sim.balls.map((bl) => `${bl.plugin.fp.mode} (${bl.position.x.toFixed(0)},${bl.position.y.toFixed(0)}) v${bl.vitesse.toFixed(2)}`).join(' ')} palettes ${robot.etat.L.phase}/${robot.etat.R.phase} ${JSON.stringify(sim.held)}\n`);
    if (sim.time % 60000 < 1000 / 60) process.stderr.write(`  partie ${n} : ${Math.round(sim.time / 60000)} min, bille ${rules.ball}, ${rules.score} pts\n`);
  }
  if (arg('trace')) process.stderr.write(robot.journal.slice(0, 60).join('\n') + '\n');
  if (rules.mode === 'play' || rules.mode === 'bonus') billes.push({ bille: billeEnCours, duree_s: Math.round((sim.time - debut) / 1000), points: rules.score - scoreDebut, inachevee: true });

  // lieux de blocage regroupés (à 30 mm près)
  const lieux = [];
  for (const c of coincees) {
    const l = lieux.find((q) => Math.hypot(q.x - c.x, q.y - c.y) < 30);
    if (l) { l.fois++; l.secousses = Math.max(l.secousses, c.secousses); } else lieux.push({ x: c.x, y: c.y, fois: 1, secousses: c.secousses });
  }
  return {
    partie: n, terminee: rules.mode === 'over', duree_min: +(sim.time / 60000).toFixed(1), score: rules.score,
    billes, extra_balls: rules.extrasGiven, multiballs: rules.mbCount, escales: rules.city, carreaux: rules.carreaux,
    rampes: comptes.ramp || 0, contacts: comptes, pertes, blocages: lieux.sort((a, c) => c.fois - a.fois),
    robot: { ...robot.stats, tirs_vises: Object.values(robot.stats.tirs).reduce((a, v) => a + v, 0) },
    tilts: comptes.tilt || 0,
  };
}

const rapports = [];
for (let n = 1; n <= Number(arg('parties', 1)); n++) {
  const r = await partie(n, Number(arg('max-min', 30)));
  rapports.push(r);
  console.log(`\n=== partie ${r.partie} : ${r.terminee ? 'terminée' : 'INACHEVÉE'} en ${r.duree_min} min de jeu — ${r.score.toLocaleString('fr-FR')} points`);
  for (const bl of r.billes) console.log(`  bille ${bl.bille} : ${bl.duree_s} s, ${bl.points.toLocaleString('fr-FR')} pts${bl.inachevee ? ' (en cours)' : ''}`);
  console.log(`  rampes ${r.rampes}, escales ${r.escales}, multiballs ${r.multiballs}, extra balls ${r.extra_balls}, carreaux ${r.carreaux}, tilts ${r.tilts}`);
  console.log(`  robot : ${r.robot.berceaux} berceaux, ${r.robot.tirs_vises} tirs visés, ${r.robot.sauvetages} frappes de sauvetage, ${r.robot.coups} bourrages`);
  console.log(`  gestes : ${Object.entries(r.robot.gestes || {}).sort().map(([k, v]) => `${k} ${v}`).join(', ') || 'aucun'}`);
  console.log(`  pertes : ${r.pertes.map((p) => `${p.ou}${p.sauvee ? ' (sauvée)' : ''}`).join(', ') || 'aucune'}`);
  console.log(`  blocages (bille immobile 8 s, recherche de bille) : ${r.blocages.map((l) => `(${l.x},${l.y}) ×${l.fois}${l.secousses > 1 ? ` jusqu'à ${l.secousses} recherches` : ''}`).join(' ; ') || 'aucun'}`);
  console.log(`  contacts : ${Object.entries(r.contacts).sort().map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
if (arg('json')) writeFileSync(arg('json'), JSON.stringify(rapports, null, 1));
process.exit(0);
