// Exporte ce qu'il faut à la table Visual Pinball (outils/vpx/generateur) depuis la version web :
//   - outils/vpx/donnees/table.json : géométrie de js/table.js (murs, palettes, bumpers, cibles, couloirs, Cercle,
//     rampe, lanceur, lampes de LAMP_LAYOUT), en millimètres, repère du plateau (x à droite, y vers le joueur) ;
//   - outils/vpx/donnees/plateau.png : le plateau peint par le moteur 2D du jeu (lampes éteintes, tablier compris),
//     Chrome sans écran, 2 px/mm.
//
//   node outils/vpx/exporter_vpx.mjs [--px-mm 2]
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, mkdtempSync, existsSync, readFileSync, statSync } from 'fs';
import { createServer } from 'http';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import path from 'path';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '../..');
const SORTIE = path.join(ICI, 'donnees');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const PX_MM = Number(arg('px-mm', 2));
mkdirSync(SORTIE, { recursive: true });

// ------------------------------------------------------------------ géométrie (Node)
const require = createRequire(import.meta.url);
globalThis.window = { Matter: require(path.join(RACINE, 'vendor/matter.min.js')) };
const Matter = window.Matter;
const { GEO, W, H, BALL_R, CX, buildTable, rampPath } = await import(path.join(RACINE, 'js/table.js'));
const { LAMP_LAYOUT } = await import(path.join(RACINE, 'js/render.js'));
const { SW } = await import(path.join(RACINE, 'js/rules.js'));
const T = buildTable(Matter.Engine.create());

const r2 = (v) => Math.round(v * 100) / 100;
const pts = (b) => b.vertices.map((v) => [r2(v.x), r2(v.y)]);
// un corps Matter composé a ses morceaux convexes dans parts[1..]
const morceaux = (b) => (b.parts.length > 1 ? b.parts.slice(1) : [b]);
const murs = [];
for (const b of T.walls) {
  const p = b.plugin || {};
  for (const m of morceaux(b)) {
    murs.push({ pts: pts(m), visible: !p.hidden, genre: b.label === 'wall' ? (p.housing ? 'plastique' : p.flanc ? 'flanc' : 'mur') : b.label });
  }
}
// profil en long de la rampe (cao/modele.py : montée à 25° jusqu'à 48 mm, palier, descente douce jusqu'à 34 mm)
const chemin = rampPath(GEO.ramps.L);
const table = {
  unites: 'mm, repère du plateau : x à droite, y vers le joueur',
  W, H, BALL_R, CX, pente_deg: 6.5,
  murs,
  palettes: GEO.flippers,
  bumpers: GEO.bumpers,
  lance_pierres: T.slings.map((b) => ({ A: b.plugin.A, C: b.plugin.C, n: b.plugin.n, poteaux: b.plugin.posts, pts: pts(b) })),
  cibles_tombantes: GEO.drops,
  cibles_fixes: GEO.standups,
  cibles_gauche: GEO.leftTargets,
  couloirs: GEO.lanes,
  couloirs_bas: GEO.lowerLanes,
  cercle: GEO.saucer,
  tourniquet: GEO.spinner,
  rampe: { pts: chemin.pts.map((p) => [r2(p.x), r2(p.y), r2(p.s)]), longueur: r2(chemin.length), z_haut: 48, z_fin: 34, pente_entree_deg: 25,
    largeur: 39, flanc: 25, capteur: GEO.rampEntries[0].sensor },
  lanceur: GEO.plunger,
  portillon: GEO.gate,
  evacuation: { x: CX, y: GEO.apron.front - 2 - GEO.apron.trou[1] / 2, largeur: GEO.apron.trou[0] },
  tablier: GEO.apron,
  lampes: LAMP_LAYOUT.map(([nom, x, y, r, couleur, texte]) => ({ nom, x: r2(x), y: r2(y), r, couleur, texte })),
  contacts: SW,
};
writeFileSync(path.join(SORTIE, 'table.json'), JSON.stringify(table, null, 1));
console.log(`table.json : ${murs.length} murs, ${table.lampes.length} lampes`);

// ------------------------------------------------------------------ plateau peint (Chrome sans écran)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg',
  '.webmanifest': 'application/json' };
const serveur = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(RACINE, p === '/' ? 'index.html' : p);
  if (!f.startsWith(RACINE) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(0, '127.0.0.1');
await new Promise((r) => serveur.on('listening', r));
const dir = mkdtempSync(path.join(tmpdir(), 'fanny-vpx-'));
const PORT = 9300 + Math.floor(Math.random() * 500);
const ch = spawn('google-chrome', ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=900,1200', 'about:blank'], { stdio: 'ignore' });
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
let cibles;
for (let i = 0; i < 100; i++) { try { cibles = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (cibles.find((c) => c.type === 'page')) break; } catch {} await attendre(200); }
const ws = new WebSocket(cibles.find((c) => c.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const att = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && att.has(d.id)) { att.get(d.id)(d); att.delete(d.id); } });
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; att.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluer = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};
await cmd('Runtime.enable'); await cmd('Page.enable');
await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('fanny-pinball-vue', '2d'); } catch {}` });
await cmd('Page.navigate', { url: `http://127.0.0.1:${serveur.address().port}/index.html` });
const png = await evaluer(`
  const att = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !(window.fanny && window.fanny.view); i++) await att(250);
  const v = window.fanny.view;
  for (let i = 0; i < 80 && !v.bg; i++) await att(250);
  await att(1000);
  const s = ${PX_MM}, cv = document.createElement('canvas');
  cv.width = Math.round(${W} * s); cv.height = Math.round(${H} * s);
  const R = new v.constructor(cv, v.sim); R.scale = s; R.bg = v.bg;
  R.drawFloor({}, false); R.apron({}, false);
  return cv.toDataURL('image/png');
`);
writeFileSync(path.join(SORTIE, 'plateau.png'), Buffer.from(png.split(',')[1], 'base64'));
console.log(`plateau.png : ${Math.round(W * PX_MM)} × ${Math.round(H * PX_MM)} px`);
ch.kill(); serveur.close(); process.exit(0);
