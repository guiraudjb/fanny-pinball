// Étalonnage des tirs du robot par position : la bille est mise en berceau, la palette relâchée ; le robot frappe
// quand la bille, roulant vers la pointe, atteint « le » mm de l'axe (repère de js/robot.js). Pour chaque « le » de
// 0 à 60 mm (pas de 1 mm), on note la première cible touchée ; la table LE_VOL proposée prend, pour chaque cible,
// le milieu de la plus longue plage de « le » qui l'atteint.
//
//   node outils/etalonner_le.mjs [--pas 1]
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
let graine = 5;
Math.random = () => ((graine = (graine * 1664525 + 1013904223) >>> 0) / 2 ** 32);
globalThis.window = { Matter: require(path.join(RACINE, 'vendor/matter.min.js')), crypto: globalThis.crypto, performance: globalThis.performance };
const { creerSim } = await import(path.join(RACINE, 'js/sim.js'));
const { GEO, CX } = await import(path.join(RACINE, 'js/table.js'));
const b = readFileSync(path.join(RACINE, 'assets/cao/collision.glb'));
const contacts = [];
const sim = await creerSim((id) => contacts.push(id), { glb: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
sim.secoueAuto = false;
const PAS = Number(arg('pas', 1));
const DT = 1000 / 480;
const TENUE_TIR_MS = 140;
const Y_POST = GEO.separators[0][0][1];

function repere(side, p) {
  const f = GEO.flippers[side === 'L' ? 0 : 1], sg = side === 'L' ? 1 : -1, a = GEO.flippers[0].rest;
  const dx = (p.x - f.px) * sg, dy = p.y - f.py;
  return dx * Math.cos(a) + dy * Math.sin(a);
}
// berceau : la bille descend le couloir de retour extérieur sur la palette tenue (vitesses du robot)
function berceau(side) {
  for (const v of [1.0, 0.5, 1.5, 0]) {
    sim.clear(); contacts.length = 0;
    sim.held = { L: false, R: false }; sim.held[side] = true;
    for (let k = 0; k < 10; k++) sim.step(1000 / 60);
    const bl = sim.makeBall(side === 'R' ? 417 : 61, Y_POST);
    sim.setVitesse(bl, 0, (v * 1000) / 60);
    for (let k = 0; k < 210; k++) sim.step(1000 / 60);
    if (!bl.retiree && bl.vitesse <= 0.05) return bl;
  }
  // repli : bille posée dans le creux du berceau (position d'équilibre relevée au banc, palette tenue)
  sim.clear(); contacts.length = 0;
  sim.held = { L: false, R: false }; sim.held[side] = true;
  for (let k = 0; k < 10; k++) sim.step(1000 / 60);
  const bl = sim.makeBall(side === 'R' ? 2 * CX - 156.7 : 156.7, 1052);
  for (let k = 0; k < 120; k++) sim.step(1000 / 60);
  if (!bl.retiree && bl.vitesse <= 0.05) return bl;
  return null;
}
// familles de cibles du robot (js/robot.js cibleVoulue)
const famille = (c) => /^drop/.test(c) ? 'drops' : /^boule/.test(c) ? 'boule' : c;
const CIBLES = /^(ramp|drop|saucer|bouchon|tirer|pointer|boule)/;

const table = {};
for (const side of ['L', 'R']) {
  const res = [];
  for (let le = 0; le <= 60; le += PAS) {
    const bl = berceau(side);
    if (!bl) { res.push([le, 'x']); continue; }
    contacts.length = 0;
    sim.held[side] = false;
    let tire = false, t = 0;
    for (; t < 1500 && !bl.retiree; t += DT) {
      sim.step(DT);
      if (!tire && repere(side, bl.position) >= le) { tire = true; break; }
    }
    if (!tire) { res.push([le, '-']); continue; }
    sim.held[side] = true;
    for (let u = 0; u < TENUE_TIR_MS; u += DT) sim.step(DT);
    sim.held[side] = false;
    let cible = null;
    for (let u = 0; u < 3500 && !bl.retiree && !cible; u += DT) {
      sim.step(DT);
      cible = contacts.find((c) => CIBLES.test(c));
    }
    res.push([le, cible ? famille(cible) : bl.retiree ? 'perdue' : '-']);
  }
  console.log(side, res.map(([le, c]) => `${le}:${c}`).join(' '));
  // plus longue plage de chaque cible
  const t = {};
  let i = 0;
  while (i < res.length) {
    let j = i;
    while (j + 1 < res.length && res[j + 1][1] === res[i][1]) j++;
    const c = res[i][1], long = j - i + 1;
    if (!/^(x|-|perdue)$/.test(c) && (!t[c] || long > t[c].long)) t[c] = { long, milieu: (res[i][0] + res[j][0]) / 2 };
    i = j + 1;
  }
  table[side] = Object.fromEntries(Object.entries(t).map(([c, v]) => [c, v.milieu]));
  console.log(side, 'plages :', Object.entries(t).map(([c, v]) => `${c} ${v.milieu} (±${((v.long - 1) * PAS) / 2})`).join(', '));
}
console.log('LE_VOL proposé :', JSON.stringify(table));
