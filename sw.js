// Service worker de Fanny Pinball : le jeu entier (≈ 6 Mo) est mis en cache à l'installation,
// puis servi hors ligne. VERSION et la liste sont réécrites par outils/pwa.py (empreinte des
// fichiers) : à chaque nouvelle version, l'ancien cache est remplacé au chargement suivant.

// <version>
const VERSION = '36fb7f3d554c';
// </version>
const CACHE = `fanny-pinball-${VERSION}`;
const PRECACHE = [
// <fichiers>
  './',
  './assets/cao/caisse.glb',
  './assets/cao/collision.glb',
  './assets/cao/pieces.glb',
  './assets/fanny_lancer.png',
  './assets/fanny_victoire.png',
  './assets/fronton.jpg',
  './assets/plateau.jpg',
  './assets/sons/0001.mp3',
  './assets/sons/0002.mp3',
  './assets/sons/0003.mp3',
  './assets/sons/0004.mp3',
  './assets/sons/0005.mp3',
  './assets/sons/0006.mp3',
  './assets/sons/0007.mp3',
  './assets/sons/0008.mp3',
  './assets/sons/0009.mp3',
  './assets/sons/0010.mp3',
  './assets/sons/0011.mp3',
  './assets/sons/0012.mp3',
  './assets/sons/0013.mp3',
  './assets/sons/0014.mp3',
  './assets/sons/0015.mp3',
  './assets/sons/0016.mp3',
  './assets/sons/0017.mp3',
  './assets/sons/0018.mp3',
  './assets/sons/0019.mp3',
  './assets/sons/0020.mp3',
  './assets/sons/0021.mp3',
  './assets/sons/0022.mp3',
  './assets/sons/0023.mp3',
  './assets/sons/0024.mp3',
  './assets/sons/0025.mp3',
  './assets/sons/0026.mp3',
  './assets/sons/0027.mp3',
  './assets/sons/0028.mp3',
  './assets/sons/0029.mp3',
  './assets/sons/0030.mp3',
  './assets/sons/0031.mp3',
  './assets/sons/0032.mp3',
  './assets/sons/0033.mp3',
  './assets/sons/0034.mp3',
  './assets/sons/0035.mp3',
  './assets/sons/0036.mp3',
  './assets/sons/0037.mp3',
  './assets/sons/0038.mp3',
  './assets/sons/0039.mp3',
  './assets/sons/0040.mp3',
  './assets/sons/0041.mp3',
  './assets/sons/0042.mp3',
  './assets/sons/0043.mp3',
  './assets/sons/0044.mp3',
  './assets/sons/0045.mp3',
  './assets/sons/0046.mp3',
  './assets/sons/0047.mp3',
  './assets/sons/0048.mp3',
  './assets/sons/0049.mp3',
  './assets/sons/0050.mp3',
  './assets/sons/0051.mp3',
  './assets/sons/0052.mp3',
  './assets/sons/0053.mp3',
  './assets/sons/0054.mp3',
  './css/style.css',
  './icons/apple-touch-icon.png',
  './icons/icone-192.png',
  './icons/icone-512.png',
  './icons/icone-maskable-192.png',
  './icons/icone-maskable-512.png',
  './index.html',
  './js/audio.js',
  './js/habillages.js',
  './js/main.js',
  './js/render.js',
  './js/render3d.js',
  './js/robot.js',
  './js/rules.js',
  './js/segfont.js',
  './js/sim.js',
  './js/table.js',
  './manifest.webmanifest',
  './vendor/matter.min.js',
  './vendor/rapier.module.js',
  './vendor/three.module.min.js',
// </fichiers>
];

self.addEventListener('install', (e) => {
  // cache: 'reload' : on relit chaque fichier au serveur, sinon le cache HTTP du navigateur peut
  // mélanger des fichiers de deux versions (par exemple une ancienne index.html avec un nouveau main.js)
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fanny-pinball-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// cache d'abord (le jeu ne dépend d'aucun serveur), réseau en secours ; pages → index.html hors ligne
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((hit) => hit
    || fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
