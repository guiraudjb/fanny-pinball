// Banc de performance de la version web : Chrome sans écran ouvre le jeu, lance une partie en Autoplay et mesure,
// image par image, le temps de la physique (sim.step), des règles (rules.tick), du dessin (view.draw) et l'intervalle
// entre deux images. Sert de référence avant / après chaque optimisation.
//
//   node outils/banc_perf.mjs [--vue 3d|2d|leger] [--duree 20] [--gpu] [--taille 900x1200] [--chargement]
//
// --gpu : rendu par le processeur graphique (ANGLE OpenGL) au lieu de SwiftShader (logiciel, par défaut).
// --chargement : mesure aussi le temps jusqu'à la première image et les octets téléchargés.
import { spawn } from 'child_process';
import { mkdtempSync, existsSync, readFileSync, statSync } from 'fs';
import { createServer } from 'http';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import path from 'path';
import zlib from 'zlib';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const drapeau = (n) => process.argv.includes(`--${n}`);
const VUE = arg('vue', '3d'), DUREE = Number(arg('duree', 20)), GPU = drapeau('gpu'), TAILLE = arg('taille', '900x1200');
const GZIP = drapeau('gzip'), PROFIL = drapeau('profil'), SONDE = arg('sonde', null);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
  '.webmanifest': 'application/json', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.ktx2': 'image/ktx2' };
let octets = 0;
const serveur = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(RACINE, p === '/' ? 'index.html' : p);
  if (!f.startsWith(RACINE) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  let corps = readFileSync(f);
  const h = { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
  // --gzip : comme GitHub Pages, qui compresse les textes (js, html, css, json) mais pas les images ni les mp3
  if (GZIP && /\.(js|mjs|html|css|json|webmanifest|svg|glb|wasm)$/.test(f)) { corps = zlib.gzipSync(corps); h['Content-Encoding'] = 'gzip'; }
  octets += corps.length;
  res.writeHead(200, h);
  res.end(corps);
}).listen(0, '127.0.0.1');
await new Promise((r) => serveur.on('listening', r));
const url = `http://127.0.0.1:${serveur.address().port}/index.html`;

const dir = mkdtempSync(path.join(tmpdir(), 'fanny-banc-'));
const PORT = 9300 + Math.floor(Math.random() * 500);
const gl = GPU ? ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const ch = spawn('google-chrome', ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  ...gl, '--autoplay-policy=no-user-gesture-required', `--window-size=${TAILLE.replace('x', ',')}`, 'about:blank'], { stdio: 'ignore' });
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
// pas de vue mémorisée : la vue est imposée par le banc
await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); } catch {} window.__t0 = performance.now();` });
const t0 = Date.now();
await cmd('Page.navigate', { url });

let profil = null;
if (PROFIL) {   // échantillonnage CPU pendant la mesure (démarré après le chargement, voir __profil)
  await cmd('Profiler.enable'); await cmd('Profiler.setSamplingInterval', { interval: 200 });
}
const prep = await evaluer(`
  const att = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 240 && !(window.fanny && window.fanny.sim); i++) await att(250);
  const pret = performance.now() - window.__t0;
  const f = window.fanny;
  await f.setView(${JSON.stringify(VUE !== '2d')});
  if (${JSON.stringify(VUE === 'leger')} && f.view.setLeger) f.view.setLeger(true);
  for (let i = 0; i < 80 && ${JSON.stringify(VUE !== '2d')} && !f.view.pret && !f.view.machine; i++) await att(250);
  const premiere = performance.now() - window.__t0;
  await att(3000);
  f.setAutoplay(true);
  await att(2000);
  return { pret, premiere };
`);
if (PROFIL) await cmd('Profiler.start');
if (SONDE) { f_sonde: { const { readFileSync: lire } = await import('fs'); console.log(JSON.stringify(await evaluer('await window.fanny.setAutoplay(true);' + lire(SONDE, 'utf8')), null, 1)); } ch.kill(); serveur.close(); process.exit(0); }
const res = await evaluer(`
  const f = window.fanny, att = (ms) => new Promise((r) => setTimeout(r, ms));
  // instrumentation : temps de chaque étape, par image
  const mes = { step: [], tick: [], draw: [], dt: [] };
  const envelopper = (o, nom, cle) => { const orig = o[nom].bind(o); o[nom] = (...a) => { const t = performance.now(); const r = orig(...a); mes[cle].push(performance.now() - t); return r; }; return () => { o[nom] = orig; }; };
  const defaire = [envelopper(f.sim, 'step', 'step'), envelopper(f.rules, 'tick', 'tick'), envelopper(f.view, 'draw', 'draw')];
  let fin = false, prec = performance.now();
  const boucle = (t) => { mes.dt.push(t - prec); prec = t; if (!fin) requestAnimationFrame(boucle); };
  requestAnimationFrame(boucle);
  await att(${DUREE * 1000});
  fin = true; defaire.forEach((d) => d());
  const stats = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0;
    return { n: a.length, moy: a.reduce((x, y) => x + y, 0) / Math.max(1, a.length), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1] || 0 }; };
  let gpu = '';
  try { const c = document.createElement('canvas').getContext('webgl2'); const e = c.getExtension('WEBGL_debug_renderer_info'); gpu = c.getParameter(e.UNMASKED_RENDERER_WEBGL); } catch {}
  const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : 0;
  return { gpu, mem, ips: 1000 / stats(mes.dt).moy, step: stats(mes.step), tick: stats(mes.tick), draw: stats(mes.draw), dt: stats(mes.dt),
    billes: f.sim.ballViews().length, score: f.rules.score };
`);
Object.assign(res, prep);
if (PROFIL) {
  const { profile } = (await cmd('Profiler.stop')).result;
  // temps propre par fonction (échantillons × intervalle)
  const parId = new Map(profile.nodes.map((n) => [n.id, n]));
  const compte = new Map();
  for (const sid of profile.samples) compte.set(sid, (compte.get(sid) || 0) + 1);
  const total = profile.samples.length, parFn = new Map();
  for (const [sid, c] of compte) {
    const cf = parId.get(sid).callFrame;
    const k = `${cf.functionName || '(anonyme)'} ${cf.url.split('/').slice(-1)[0]}:${cf.lineNumber + 1}`;
    parFn.set(k, (parFn.get(k) || 0) + c);
  }
  // appelants (3 niveaux) des fonctions --pile <nom>
  const pile = arg('pile', null);
  if (pile) {
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const chaines = new Map();
    const nomDe = (n) => `${n.callFrame.functionName || '?'}:${n.callFrame.lineNumber + 1}:${n.callFrame.columnNumber}`;
    for (const [sid, c] of compte) {
      const n = parId.get(sid);
      if (n.callFrame.functionName !== pile) continue;
      const ch = []; let p = parent.get(sid);
      for (let k = 0; k < 6 && p; k++) { ch.push(nomDe(parId.get(p))); p = parent.get(p); }
      const k = ch.join(' < ');
      chaines.set(k, (chaines.get(k) || 0) + c);
    }
    console.log([...chaines].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, c]) => `${c}  ${k}`).join('\n'));
  }
  profil = [...parFn].sort((a, b) => b[1] - a[1]).slice(0, Number(arg('top', 30))).map(([k, c]) => `${(100 * c / total).toFixed(1).padStart(5)} %  ${k}`);
}
const r1 = (x) => x.toFixed(2).padStart(7);
console.log(`vue ${VUE} · ${TAILLE} · ${res.gpu}`);
console.log(`chargement : moteur prêt ${(res.pret / 1000).toFixed(1)} s, vue prête ${(res.premiere / 1000).toFixed(1)} s, ${(octets / 1e6).toFixed(1)} Mo servis${GZIP ? ' (gzip)' : ''}, tas JS ${res.mem} Mo`);
console.log(`images : ${res.ips.toFixed(1)} i/s`);
console.log(`              moy     p50     p95     p99     max   (ms)`);
for (const k of ['dt', 'step', 'tick', 'draw']) { const s = res[k]; console.log(`${k.padEnd(6)} ${r1(s.moy)} ${r1(s.p50)} ${r1(s.p95)} ${r1(s.p99)} ${r1(s.max)}`); }
console.log(`(score ${res.score}, billes ${res.billes}, durée ${DUREE} s, total ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
if (profil) console.log('\nprofil (temps propre) :\n' + profil.join('\n'));
ch.kill(); serveur.close(); process.exit(0);
