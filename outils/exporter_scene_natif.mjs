// Exporte la scène 3D de la version web (js/render3d.js : CAO, plateau peint, rampe décorée, bumpers, habillage de
// la caisse…) en glTF binaire pour la version native Rust : natif/donnees/scene.glb. Chrome sans écran ouvre le jeu,
// passe en vue 3D, applique l'habillage voulu, repeint le plateau en haute définition, nomme les pièces mobiles
// (dyn_*) et les matériaux qui s'allument (lampe_*, emis_*), puis GLTFExporter (Three r170) écrit la scène.
//
//   node outils/exporter_scene_natif.mjs [--habillage riviera] [--px-mm 3.2] [--sortie natif/donnees/scene.glb]
//
// Il faut google-chrome et le réseau la première fois (GLTFExporter est pris sur cdn.jsdelivr.net, version figée).
import { spawn } from 'child_process';
import { writeFileSync, mkdtempSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { createServer } from 'http';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import path from 'path';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const HABILLAGE = arg('habillage', 'riviera');
const PX_MM = Number(arg('px-mm', 3.2));                      // 1263 mm × 3,2 = 4042 px de haut
const SORTIE = path.resolve(RACINE, arg('sortie', 'natif/donnees/scene.glb'));
const EXPORTEUR = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/exporters/GLTFExporter.js';

// petit serveur de fichiers statiques sur la racine du dépôt (+ le module GLTFExporter réécrit pour vendor/three)
const cache = path.join(RACINE, 'natif/donnees/.GLTFExporter.js');
if (!existsSync(cache)) {
  const src = await (await fetch(EXPORTEUR)).text();
  mkdirSync(path.dirname(cache), { recursive: true });
  writeFileSync(cache, src.replace(/from 'three'/g, "from '/vendor/three.module.min.js'"));
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.webmanifest': 'application/json',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.svg': 'image/svg+xml' };
const serveur = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  const f = p === '/__exporteur.js' ? cache : path.join(RACINE, p === '/' ? 'index.html' : p);
  if (!f.startsWith(RACINE) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(0, '127.0.0.1');
await new Promise((r) => serveur.on('listening', r));
const url = `http://127.0.0.1:${serveur.address().port}/index.html`;

const dir = mkdtempSync(path.join(tmpdir(), 'fanny-chrome-'));
const PORT = 9300 + Math.floor(Math.random() * 500);
const ch = spawn('google-chrome', ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=900,1200', 'about:blank'], { stdio: 'ignore' });
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
let cibles;
for (let i = 0; i < 100; i++) { try { cibles = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (cibles.find((c) => c.type === 'page')) break; } catch {} await attendre(200); }
const ws = new WebSocket(cibles.find((c) => c.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const att = new Map();
ws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data);
  if (d.id && att.has(d.id)) { att.get(d.id)(d); att.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') console.error('[page]', JSON.stringify(d.params.exceptionDetails).slice(0, 400));
});
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; att.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluer = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};
await cmd('Runtime.enable'); await cmd('Page.enable');
await cmd('Page.navigate', { url });

const n = await evaluer(`
  const att = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !(window.fanny && window.fanny.sim); i++) await att(500);
  const f = window.fanny; await f.setView(true);
  const r3 = f.view;
  for (let i = 0; i < 12 && !r3.enMachine; i++) r3.cycleCamera();      // caméra « caisse » : la caisse se construit
  for (let i = 0; i < 120 && !r3.machine; i++) await att(500);
  if (r3.setHabillage) await r3.setHabillage(${JSON.stringify(HABILLAGE)});
  await att(3000);
  const THREE = r3.constructor.THREE;
  // plateau repeint en haute définition (lampes éteintes, comme dans le jeu)
  const fr = r3.floorR, s = ${PX_MM}, W = fr.canvas.width / fr.scale, H = fr.canvas.height / fr.scale;
  const cv = document.createElement('canvas'); cv.width = Math.round(W * s); cv.height = Math.round(H * s);
  const R2 = new fr.constructor(cv, r3.sim); R2.scale = s; R2.bg = fr.bg;
  R2.drawFloor({}, false); R2.apron({}, false);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = r3.floorTex.colorSpace; tex.flipY = r3.floorTex.flipY;
  r3.floorMat.map = tex; r3.floorMat.needsUpdate = true;
  // noms des pièces mobiles et des matériaux qui s'allument
  r3.flippers.forEach((p) => { p.mesh.name = 'dyn_palette_' + p.fl.def.side; });
  r3.drops.forEach((m, i) => { m.name = 'dyn_cible_' + i; });
  r3.bumpers.forEach((b, i) => {
    b.ringGroup.name = 'dyn_bumper_anneau_' + i; b.capGroup.name = 'dyn_bumper_chapeau_' + i;
    b.topMat.name = 'emis_bumper_chapeau_' + i; b.sideMat.name = 'emis_bumper_flanc_' + i;
    b.bodyMat.name = 'emis_bumper_corps_' + i; b.bulbMat.name = 'emis_bumper_ampoule_' + i;
  });
  r3.slings.forEach((band, i) => { band.material = band.material.clone(); band.material.name = 'emis_sling_' + i; band.name = 'dyn_sling_' + i; });
  r3.leftTargets.forEach((m, i) => { m.name = 'emis_cible_gauche_' + i; });
  if (r3.spinner3d) r3.spinner3d.bladePivot.name = 'dyn_tourniquet';
  r3.plunger.name = 'dyn_tige_lanceur';
  r3.lanceur.forEach((m, i) => { m.name = 'dyn_lanceur_' + i; });
  for (const [k, b] of Object.entries(r3.boutons)) b.name = 'bouton_' + k;
  for (const g of r3.lampGlows) { g.mat.name = 'lampe_' + g.name; g.mat.emissiveIntensity = 0; g.sp.visible = false; }
  r3.balls.forEach((m) => { m.visible = false; });
  r3.rampMat.name = 'rampe_fond'; r3.rampFlank.name = 'rampe_flanc';
  const { GLTFExporter } = await import('/__exporteur.js');
  const glb = await new GLTFExporter().parseAsync(r3.scene, { binary: true, maxTextureSize: 4096, onlyVisible: true });
  const u8 = new Uint8Array(glb);
  window.__morceaux = [];
  for (let i = 0; i < u8.length; i += 1 << 20) {
    let t = ''; const m = u8.subarray(i, i + (1 << 20));
    for (let j = 0; j < m.length; j += 8192) t += String.fromCharCode.apply(null, m.subarray(j, j + 8192));
    window.__morceaux.push(btoa(t));
  }
  return window.__morceaux.length;
`);
const parts = [];
for (let i = 0; i < n; i++) parts.push(Buffer.from(await evaluer(`return window.__morceaux[${i}];`), 'base64'));
const glb = Buffer.concat(parts);
mkdirSync(path.dirname(SORTIE), { recursive: true });
writeFileSync(SORTIE, glb);
console.log(`${SORTIE} : ${(glb.length / 1e6).toFixed(1)} Mo (habillage ${HABILLAGE}, plateau ${PX_MM} px/mm)`);
ch.kill(); serveur.close(); process.exit(0);
