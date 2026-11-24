// Aperçu de la table VPX sans Visual Pinball : `vpxtool export gltf` puis rendu three.js dans Chrome sans écran.
//
//   node outils/vpx/apercu.mjs [sortie/FannyPinball.vpx] [--sortie sortie/apercu.png]
//
// Produit deux vues côte à côte : de dessus (géométrie) et en perspective depuis le joueur.
import { spawn, execFileSync } from 'child_process';
import { writeFileSync, mkdtempSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { createServer } from 'http';
import { tmpdir, homedir } from 'os';
import { fileURLToPath } from 'url';
import path from 'path';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '../..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const VPX = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(ICI, 'sortie/FannyPinball.vpx'));
const SORTIE = path.resolve(arg('sortie', path.join(ICI, 'sortie/apercu.png')));
const tmp = mkdtempSync(path.join(tmpdir(), 'fanny-apercu-'));
const vpxtool = existsSync(path.join(homedir(), '.cargo/bin/vpxtool')) ? path.join(homedir(), '.cargo/bin/vpxtool') : 'vpxtool';
execFileSync(vpxtool, ['export', 'gltf', VPX, '-o', tmp, '--units', 'mm'], { stdio: 'ignore' });
const glb = path.join(tmp, path.basename(VPX, '.vpx') + '.glb');

// GLTFLoader (three r170, version figée) mis en cache à côté de l'exporteur GLTF de la version native
const cache = path.join(ICI, 'sortie/.GLTFLoader.js');
if (!existsSync(cache)) {
  mkdirSync(path.dirname(cache), { recursive: true });
  const src = await (await fetch('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js')).text();
  writeFileSync(cache, src.replace(/from 'three'/g, "from '/vendor/three.module.min.js'").replace(/from '\.\.\/utils\/BufferGeometryUtils\.js'/g, "from '/__utils.js'"));
  const u = await (await fetch('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/utils/BufferGeometryUtils.js')).text();
  writeFileSync(path.join(ICI, 'sortie/.BufferGeometryUtils.js'), u.replace(/from 'three'/g, "from '/vendor/three.module.min.js'"));
}
const page = `<!doctype html><html><body style="margin:0;background:#222"><canvas id="c" width="1400" height="1300"></canvas>
<script type="module">
import * as THREE from '/vendor/three.module.min.js';
import { GLTFLoader } from '/__loader.js';
const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, preserveDrawingBuffer: true });
r.outputColorSpace = THREE.SRGBColorSpace; r.setScissorTest(true);
const s = new THREE.Scene(); s.background = new THREE.Color('#2a2420');
s.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.2));
const d = new THREE.DirectionalLight(0xffffff, 1.5); d.position.set(-300, 1500, 800); s.add(d);
const g = await new GLTFLoader().loadAsync('/__table.glb');
s.add(g.scene);
const b = new THREE.Box3().setFromObject(g.scene), c0 = b.getCenter(new THREE.Vector3()), t = b.getSize(new THREE.Vector3());
window.__infos = { min: b.min.toArray(), max: b.max.toArray(), n: g.scene.children.length };
const haut = new THREE.OrthographicCamera(-t.x / 2 * 1.05, t.x / 2 * 1.05, t.z / 2 * 1.05, -t.z / 2 * 1.05, 1, 20000);
haut.position.set(c0.x, b.max.y + 3000, c0.z); haut.up.set(0, 0, -1); haut.lookAt(c0.x, c0.y, c0.z);
const W = 1400, H = 1300, w1 = Math.round(H * t.x / t.z);
r.setViewport(0, 0, w1, H); r.setScissor(0, 0, w1, H); r.render(s, haut);
const p = new THREE.PerspectiveCamera(42, (W - w1) / H, 10, 20000);
p.position.set(c0.x, b.max.y + 700, b.max.z + 650); p.lookAt(c0.x, c0.y, c0.z - t.z * 0.12);
r.setViewport(w1, 0, W - w1, H); r.setScissor(w1, 0, W - w1, H); r.render(s, p);
window.__png = c.toDataURL('image/png');
</script></body></html>`;
const serveur = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = p === '/' ? null : p === '/__table.glb' ? glb : p === '/__loader.js' ? cache : p === '/__utils.js' ? path.join(ICI, 'sortie/.BufferGeometryUtils.js') : path.join(RACINE, p);
  if (!f) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page); return; }
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(0, '127.0.0.1');
await new Promise((r) => serveur.on('listening', r));
const PORT = 9300 + Math.floor(Math.random() * 500);
const ch = spawn('google-chrome', ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${tmp}/chrome`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,1300', 'about:blank'], { stdio: 'ignore' });
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
let cibles;
for (let i = 0; i < 100; i++) { try { cibles = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (cibles.find((c) => c.type === 'page')) break; } catch {} await attendre(200); }
const ws = new WebSocket(cibles.find((c) => c.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const att = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && att.has(d.id)) { att.get(d.id)(d); att.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') console.error('[page]', JSON.stringify(d.params.exceptionDetails).slice(0, 400)); });
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; att.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await cmd('Runtime.enable');
await cmd('Page.navigate', { url: `http://127.0.0.1:${serveur.address().port}/` });
let png = null;
for (let i = 0; i < 120 && !png; i++) {
  await attendre(500);
  png = (await cmd('Runtime.evaluate', { expression: 'window.__png || null', returnByValue: true })).result?.result?.value;
}
const infos = (await cmd('Runtime.evaluate', { expression: 'window.__infos', returnByValue: true })).result?.result?.value;
if (!png) { console.error('pas de rendu'); process.exit(1); }
writeFileSync(SORTIE, Buffer.from(png.split(',')[1], 'base64'));
console.log(`${SORTIE} (${JSON.stringify(infos)})`);
ch.kill(); serveur.close(); process.exit(0);
