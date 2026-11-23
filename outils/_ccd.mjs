import { createRequire } from 'module'; import { readFileSync } from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
globalThis.window = { Matter: require(path.resolve('vendor/matter.min.js')), crypto: globalThis.crypto, performance: globalThis.performance };
const { creerSim } = await import(path.resolve('js/sim.js'));
const b = readFileSync('assets/cao/collision.glb');
for (const ccd of [true]) {
  const sim = await creerSim(() => {}, { glb: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
  sim.secoueAuto = false;
  const bl = sim.makeBall(24.2, 341.6);
  const f0 = sim.frapper.bind(sim); sim.frapper = (b, nx, ny, k) => { console.log('frapper', (sim.time/1000).toFixed(2), b.position.x.toFixed(1), b.position.y.toFixed(1), nx.toFixed(2), ny.toFixed(2), k); return f0(b, nx, ny, k); };
  const c0 = sim.contact.bind(sim); sim.contact = (b, r) => { if (r.type !== 'paroi' && r.type !== 'surface') { const c = r.collider; const t = c.translation(); console.log('contact', (sim.time/1000).toFixed(2), r.type, r.idx ?? '', 'handle', c.handle, 'forme', c.shapeType(), 'pos', (t.x*1000).toFixed(1), (t.y*1000).toFixed(1), (t.z*1000).toFixed(1), 'r', (c.radius?.()*1000)?.toFixed(1), 'demiH', (c.halfHeight?.()*1000)?.toFixed(1), 'dist', (sim.world.contactPair ? '' : '')); let dm = 9; sim.world.contactPair(b.collider ?? b.col, c, (m) => { for (let i = 0; i < m.numContacts(); i++) dm = Math.min(dm, m.contactDist(i)); }); console.log('   distance contact', (dm*1000).toFixed(2), 'mm'); } return c0(b, r); };
  bl.body.enableCcd(ccd);
  let vmax = 0, saut = null, vprec = 0;
  for (let k = 0; k < 480 * 6; k++) {
    sim.step(1000 / 480);
    if (bl.retiree) break;
    const v = bl.vitesse; if (v - vprec > 0.3 && !saut) saut = { t: (k / 480).toFixed(2), x: bl.position.x.toFixed(1), y: bl.position.y.toFixed(1), avant: vprec.toFixed(3), apres: v.toFixed(3) };
    vprec = v;
  }
  console.log('ccd', ccd, 'saut', JSON.stringify(saut), 'fin', bl.retiree ? 'perdue' : `${bl.position.x.toFixed(1)},${bl.position.y.toFixed(1)}`);
}
