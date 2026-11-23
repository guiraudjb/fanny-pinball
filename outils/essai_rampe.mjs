// Essai de la rampe : bille lancée en roulement dans la bouche (centrée, décalée de ±8 mm, inclinée de ±8°) à
// plusieurs vitesses ; OK = barrière infrarouge de sortie franchie (contact RAMPE). « V » : la bille a touché la vitre.
//   node outils/essai_rampe.mjs [1.2,1.4,…]
import { createRequire } from 'module'; import { readFileSync } from 'fs';
const require = createRequire(import.meta.url);
globalThis.window = { Matter: require('../vendor/matter.min.js'), crypto: globalThis.crypto, performance: globalThis.performance };
const { creerSim } = await import('../js/sim.js');
const { GEO } = await import('../js/table.js');
const b = readFileSync('assets/cao/collision.glb');
const sw = [];
const sim = await creerSim((id) => sw.push(id), { glb: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
sim.secoueAuto = false;
const E = GEO.rampEntries[0], vImg = (m) => m * 1000 / 60;
const lignes = [];
for (const v of (process.argv[2] || '1.2,1.4,1.6,1.8,2,2.4,2.8,3.2,4').split(',').map(Number)) {
  const r = [];
  for (const [dec, ang] of [[0, 0], [-8, 0], [8, 0], [0, -8], [0, 8]]) {
    sim.clear(); sw.length = 0;
    const a = ang * Math.PI / 180, dx = E.u.x * Math.cos(a) + E.v.x * Math.sin(a), dy = E.u.y * Math.cos(a) + E.v.y * Math.sin(a);
    const bl = sim.makeBall(E.M.x - E.u.x * 60 + E.v.x * dec, E.M.y - E.u.y * 60 + E.v.y * dec);
    sim.setRoulement(bl, vImg(v) * dx, vImg(v) * dy);
    let hm = 0; for (let t = 0; t < 4000 && !bl.retiree; t += 1000 / 480) { sim.step(1000 / 480); hm = Math.max(hm, bl.hauteur); if (sw.includes('ramp')) break; }
    r.push(sw.includes('ramp') ? 'OK' : '--' + (hm > 77 ? 'V' : ''));
  }
  lignes.push(`${v} m/s : ${r.join(' ')}`);
}
console.log(lignes.join('\n'));
process.exit(0);
