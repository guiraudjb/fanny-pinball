// Flipper complet qui tourne sur lui-même, pour le fond de la vue bureau de la table VPX (fond.py → GIF).
// Rend dans Chrome sans écran la scène 3D de la version web (exportée par outils/exporter_scene_natif.mjs, avec
// l'habillage voulu, sans la salle du café) vue de trois quarts, sur fond transparent, en N vues sur un tour.
//
//   node outils/exporter_scene_natif.mjs --habillage pois --px-mm 1.6 --sortie /tmp/scene_pois.glb
//   node outils/vpx/tourniquet.mjs /tmp/scene_pois.glb --sortie /tmp/tourniquet [--vues 48] [--l 300] [--h 480]
//
// Sortie : <sortie>/v00.png … (RGBA)
import { spawn } from 'child_process';
import { writeFileSync, mkdtempSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { createServer } from 'http';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import path from 'path';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '../..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const GLB = path.resolve(process.argv[2]);
const SORTIE = path.resolve(arg('sortie', 'tourniquet'));
const N = Number(arg('vues', 48)), L = Number(arg('l', 300)), HT = Number(arg('h', 480)), SUR = 2;   // rendu 2× puis réduit
mkdirSync(SORTIE, { recursive: true });
const tmp = mkdtempSync(path.join(tmpdir(), 'fanny-tourniquet-'));

// GLTFLoader (three r170) : même cache que apercu.mjs
const cache = path.join(ICI, 'sortie/.GLTFLoader.js');
if (!existsSync(cache)) {
  mkdirSync(path.dirname(cache), { recursive: true });
  const src = await (await fetch('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js')).text();
  writeFileSync(cache, src.replace(/from 'three'/g, "from '/vendor/three.module.min.js'").replace(/from '\.\.\/utils\/BufferGeometryUtils\.js'/g, "from '/__utils.js'"));
  const u = await (await fetch('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/utils/BufferGeometryUtils.js')).text();
  writeFileSync(path.join(ICI, 'sortie/.BufferGeometryUtils.js'), u.replace(/from 'three'/g, "from '/vendor/three.module.min.js'"));
}
const page = `<!doctype html><html><body style="margin:0;background:transparent"><canvas id="c" width="${L * SUR}" height="${HT * SUR}"></canvas>
<script type="module">
import * as THREE from '/vendor/three.module.min.js';
import { GLTFLoader } from '/__loader.js';
const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
r.outputColorSpace = THREE.SRGBColorSpace; r.setClearColor(0x000000, 0);
r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
const s = new THREE.Scene();
s.add(new THREE.HemisphereLight(0xfff4e0, 0x403020, 1.8));
const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(2, 4, 3); s.add(d);
const d2 = new THREE.DirectionalLight(0xffe0c0, 0.8); d2.position.set(-3, 2, -2); s.add(d2);
const g = (await new GLTFLoader().loadAsync('/__scene.glb')).scene;
// la salle du café (sol, murs, comptoir…) et l'ombre au sol restent de côté : le flipper seul
const cacher = [];
g.traverse((o) => {
  const m = o.material, nm = (m && (Array.isArray(m) ? m[0].name : m.name)) || '';
  if (/^salle/.test(o.name) || /^salle_/.test(nm) || /ombre/i.test(o.name) || /ombre/i.test(nm)) cacher.push(o);
});
cacher.forEach((o) => { o.visible = false; });
const pivot = new THREE.Group(); s.add(pivot); pivot.add(g);
g.updateMatrixWorld(true);
const b = new THREE.Box3();
g.traverseVisible((o) => { if (o.isMesh) b.expandByObject(o); });
const c0 = b.getCenter(new THREE.Vector3()), t = b.getSize(new THREE.Vector3());
g.position.sub(c0);                                           // centre du flipper sur l'axe de rotation (vertical, y)
const R = Math.hypot(t.x, t.z) / 2, cam = new THREE.PerspectiveCamera(24, ${L} / ${HT}, 1, 1e6);
const dist = Math.max(t.y / 2 / Math.tan(THREE.MathUtils.degToRad(12)), R / Math.tan(THREE.MathUtils.degToRad(12)) / (${L} / ${HT})) * 0.75;
const el = THREE.MathUtils.degToRad(16);
cam.position.set(0, Math.sin(el) * dist, Math.cos(el) * dist); cam.lookAt(0, 0, 0); cam.near = dist / 20; cam.far = dist * 4; cam.updateProjectionMatrix();
window.__infos = { taille: t.toArray(), caches: cacher.length };
window.__vue = (k) => { pivot.rotation.y = k / ${N} * Math.PI * 2; r.render(s, cam); return c.toDataURL('image/png'); };
window.__pret = true;
</script></body></html>`;
const serveur = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = p === '/' ? null : p === '/__scene.glb' ? GLB : p === '/__loader.js' ? cache : p === '/__utils.js' ? path.join(ICI, 'sortie/.BufferGeometryUtils.js') : path.join(RACINE, p);
  if (!f) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page); return; }
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(0, '127.0.0.1');
await new Promise((r) => serveur.on('listening', r));
const PORT = 9300 + Math.floor(Math.random() * 500);
const ch = spawn('google-chrome', ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${tmp}/chrome`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--window-size=${L * SUR},${HT * SUR}`, 'about:blank'], { stdio: 'ignore' });
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
let cibles;
for (let i = 0; i < 100; i++) { try { cibles = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (cibles.find((c) => c.type === 'page')) break; } catch {} await attendre(200); }
const ws = new WebSocket(cibles.find((c) => c.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const att = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && att.has(d.id)) { att.get(d.id)(d); att.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') console.error('[page]', JSON.stringify(d.params.exceptionDetails).slice(0, 400)); });
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; att.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
await cmd('Runtime.enable');
await cmd('Page.navigate', { url: `http://127.0.0.1:${serveur.address().port}/` });
for (let i = 0; i < 240 && !(await ev('window.__pret || false')); i++) await attendre(500);
console.log(JSON.stringify(await ev('window.__infos')));
for (let k = 0; k < N; k++) {
  const png = await ev(`window.__vue(${k})`);
  writeFileSync(path.join(SORTIE, `v${String(k).padStart(2, '0')}.png`), Buffer.from(png.split(',')[1], 'base64'));
}
console.log(`${N} vues → ${SORTIE}`);
ch.kill(); serveur.close(); process.exit(0);
