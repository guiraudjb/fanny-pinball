// Exporte le monde physique de la version web (js/sim.js construit sur assets/cao/collision.glb) pour la version
// native Rust (natif/) : chaque collider fixe (forme, position, matière, groupes, rôle de jeu), les palettes, les
// constantes de jeu et la géométrie utile aux règles. La version native reconstruit exactement le même monde.
//
//   node outils/exporter_natif.mjs            → natif/donnees/monde.json
import { createRequire } from 'module';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = { Matter: require(path.join(RACINE, 'vendor/matter.min.js')), crypto: globalThis.crypto, performance: globalThis.performance };
const { creerSim, REGLAGES } = await import(path.join(RACINE, 'js/sim.js'));
const { GEO, W, H, BALL_R, CX, rampPath } = await import(path.join(RACINE, 'js/table.js'));
const R = (await import(path.join(RACINE, 'vendor/rapier.module.js'))).default;
const b = readFileSync(path.join(RACINE, 'assets/cao/collision.glb'));
const sim = await creerSim(() => {}, { glb: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });

const arr = (a) => Array.from(a, (x) => +x.toFixed(6));
const T = R.ShapeType;
function forme(c) {
  const s = c.shape;
  switch (s.type) {
    case T.Ball: return { type: 'boule', r: s.radius };
    case T.Cuboid: return { type: 'pave', demi: [s.halfExtents.x, s.halfExtents.y, s.halfExtents.z] };
    case T.Cylinder: return { type: 'cylindre', demiH: s.halfHeight, r: s.radius };
    case T.ConvexPolyhedron: return { type: 'convexe', pts: arr(s.vertices) };
    case T.TriMesh: return { type: 'maillage', pts: arr(s.vertices), idx: Array.from(s.indices), fix: true };
    default: throw new Error(`forme ${s.type} non exportée`);
  }
}
const role = (h) => {
  const r = sim.info.get(h);
  if (!r) return null;
  const o = {};
  for (const [k, v] of Object.entries(r)) if (k !== 'corps' && k !== 'collider' && k !== 'bille') o[k] = v;
  if (r.corps?.position) o.centre = [r.corps.position.x, r.corps.position.y];
  return o;
};

const fixes = [], palettes = [];
const corpsPal = new Map(sim.palettes.map((p, i) => [p.body.handle, i]));
sim.world.forEachCollider((c) => {
  const t = c.translation(), q = c.rotation();
  const k = sim.caoutchoucs.get(c.handle);
  const d = {
    forme: forme(c), pos: [t.x, t.y, t.z], rot: [q.x, q.y, q.z, q.w],
    rebond: c.restitution(), frottement: c.friction(), groupes: c.collisionGroups(), capteur: c.isSensor(),
    role: role(c.handle), caoutchouc: k ? k.type : null,
  };
  const parent = c.parent();
  if (parent && corpsPal.has(parent.handle)) {
    // collider de palette : position relative au corps (axe de la palette)
    const p = sim.palettes[corpsPal.get(parent.handle)], bt = parent.translation();
    d.pos = [t.x - bt.x, t.y - bt.y, t.z - bt.z];
    palettes.push({ ...p.fl.def, axe: [bt.x, bt.y, bt.z], angle0: p.a0, sens: p.sens, collider: d });
  } else if (!parent) fixes.push(d);
});

const ip = sim.world.integrationParameters;
const monde = {
  version: 1,
  source: 'js/sim.js + assets/cao/collision.glb',
  unites: 'mètres, repère table (x droite, y vers le joueur, z vers l\'intérieur : hauteur h → z = −h)',
  W, H, BALL_R, CX,
  physique: {
    pas_hz: 480, pente_deg: sim.penteDeg, gravite: 9.81, iterations: ip.numSolverIterations,
    length_unit: ip.lengthUnit, erreur_lineaire: ip.normalizedAllowedLinearError,
    reglages: JSON.parse(JSON.stringify(REGLAGES)),
  },
  fixes, palettes,
  geo: GEO,
  rampe: rampPath(GEO.ramps.L, 2).pts.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2), +p.s.toFixed(2)]),
};
mkdirSync(path.join(RACINE, 'natif/donnees'), { recursive: true });
const sortie = path.join(RACINE, 'natif/donnees/monde.json');
writeFileSync(sortie, JSON.stringify(monde));
const n = (t) => fixes.filter((f) => f.forme.type === t).length;
console.log(`${sortie} : ${fixes.length} colliders fixes (${['maillage', 'convexe', 'cylindre', 'pave', 'boule'].map((t) => `${n(t)} ${t}`).join(', ')}), ${palettes.length} palettes`);
process.exit(0);
