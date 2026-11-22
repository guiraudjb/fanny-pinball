// Vue 3D du plateau (Three.js, chargé à la demande). La physique est celle de sim.js (Rapier, en 3D) :
// cette vue ne fait que dessiner. Le plateau peint (illustration, lampes, Cercle, tablier) est dessiné
// par le moteur 2D dans une image qui sert de texture ; tout ce qui dépasse du plateau est en volume.
//
// Repère « table » (groupe this.table) : x vers la droite, y vers le joueur, z = −hauteur (mm),
// exactement les coordonnées du jeu. Le groupe est incliné de la pente du plateau.

import * as THREE from '../vendor/three.module.min.js';
import { W, H, CX, GEO, BALL_R, pointAt } from './table.js';
import { Renderer, LAMP_LAYOUT, COLORS, drawApron, drawLampInsert, drawLampInsertEmissive } from './render.js';
import { drawSegDisplay } from './segfont.js';
import { HABILLAGES, chargerImages, dessiner, estEmissif } from './habillages.js';

const PENTE = (6.5 * Math.PI) / 180;      // pente du plateau (cao/cotes.py)
const H_PAROI = 32;                        // parois et guides imprimés
const RAMPE = { z: 48, zFin: 34, pente: Math.tan((25 * Math.PI) / 180), desc: 120, larg: 39, flanc: 25 };
const TEX = 2;                             // résolution des textures peintes (px par mm)
// la bille passe sous le tablier quand son centre dépasse le bord avant (bras en V, GEO.apron)
function sousTablier(x, y) {
  const a = GEO.apron;
  const bord = x < CX - a.half ? a.side + (a.front - a.side) * (x / (CX - a.half))
    : x >= GEO.playRight ? a.lane
    : x > CX + a.half ? a.side + (a.front - a.side) * ((GEO.playRight - x) / (GEO.playRight - CX - a.half)) : a.front;
  return y > bord - 4;
}
const Z_CAOUT = BALL_R;                    // les caoutchoucs sont à hauteur du centre de la bille (cao/cotes.py)
const CORDE_PALETTE = 4;                   // section du caoutchouc de palette ; sa face extérieure = contour de rebond
const DROP = { l: 22.5, e: 8.1, h: 33, r: 6, lumiere: [23.5, 9] };   // lame de cible tombante (cao/cotes.py, CIBLES)

// contour d'une palette (repère de la palette au repos, comme flipperBody de table.js), rayons ra au pivot, rb à la pointe
function contourPalette(f, ra, rb) {
  const sgn = f.side === 'L' ? 1 : -1, pts = [];
  for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + (Math.PI * i) / 12; pts.push([f.len + Math.cos(a) * rb, Math.sin(a) * rb]); }
  for (let i = 0; i <= 16; i++) { const a = Math.PI / 2 + (Math.PI * i) / 16; pts.push([Math.cos(a) * ra, Math.sin(a) * ra]); }
  const c = Math.cos(f.rest), s = Math.sin(f.rest);
  return pts.map(([x, y]) => [x * sgn * c - y * s, x * sgn * s + y * c]);
}

// corde de caoutchouc fermée (tube) le long d'un contour du plateau, à la hauteur z
function corde(pts, rayon, z, material, seg = 120) {
  const courbe = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, -z)), true, 'centripetal');
  const m = new THREE.Mesh(new THREE.TubeGeometry(courbe, seg, rayon, 10, true), material);
  m.castShadow = true;
  return m;
}

// ligne moyenne d'un anneau tendu autour de poteaux (enveloppe convexe des cercles de rayon rc) ; « bombe » pousse
// le milieu d'un côté vers l'extérieur (bras du lance-pierre)
function enveloppe(posts, rc, bombe = null) {
  let aire = 0;
  posts.forEach(([x, y], i) => { const [x2, y2] = posts[(i + 1) % posts.length]; aire += x * y2 - x2 * y; });
  const P = aire > 0 ? posts : [...posts].reverse(), n = P.length, out = [];
  const normale = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return Math.atan2(-dx / l, dy / l); };
  for (let i = 0; i < n; i++) {
    const a0 = normale(P[(i - 1 + n) % n], P[i]);
    let a1 = normale(P[i], P[(i + 1) % n]);
    while (a1 < a0) a1 += 2 * Math.PI;
    for (let k = 0; k <= 6; k++) { const a = a0 + ((a1 - a0) * k) / 6; out.push([P[i][0] + rc * Math.cos(a), P[i][1] + rc * Math.sin(a)]); }
    const Q = P[(i + 1) % n], na = a1;
    const A = [P[i][0] + rc * Math.cos(na), P[i][1] + rc * Math.sin(na)], B = [Q[0] + rc * Math.cos(na), Q[1] + rc * Math.sin(na)];
    const face = bombe && ((P[i] === bombe.A && Q === bombe.C) || (P[i] === bombe.C && Q === bombe.A));
    for (let k = 1; k < 8; k++) {
      const t = k / 8, d = face ? bombe.d * 4 * t * (1 - t) : 0;
      out.push([A[0] + (B[0] - A[0]) * t + Math.cos(na) * d, A[1] + (B[1] - A[1]) * t + Math.sin(na) * d]);
    }
  }
  return out;
}
// points de vue : élévation de la caméra au-dessus de l'horizontale, champ vertical
export const CAMERAS = [
  { nom: 'joueur', elev: 38, fov: 32 },       // à la place du joueur, comme la vue « bureau » de Visual Pinball
  { nom: 'haute', elev: 55, fov: 32 },
  { nom: 'plateau', elev: 80, fov: 28 },      // presque de dessus : écrans verticaux, téléphones
  { nom: 'machine', elev: 16, fov: 30, machine: true },   // tout le flipper ; angle et zoom au choix, puis vue verrouillée pour jouer
  { nom: 'tour', elev: 20, fov: 30, tour: true },         // tour de la machine, angles variés ; glisser / molette pour la piloter
];
const TOUR = { tour_s: 48, elev_s: 31, zoom_s: 19, elevMin: 6, elevMax: 55, reprise_ms: 5000 };
const lire = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const ecrire = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// Panneaux habillés de la caisse : nom dans caisse.glb → canevas de js/habillages.js. UV planes sur la face
// extérieure, vue de dehors : flancs et côtés du fronton projetés sur Y-Z (le panneau droit est déjà dessiné en
// miroir), façade sur X-Z, plaque arrière et dos du fronton sur X-Z vus de derrière, dessous et dessus du fronton
// sur X-Y (le dessus vu d'en haut depuis l'avant : le haut de l'image vers l'arrière).
const PANNEAUX = { flanc_G: 'flancG', flanc_D: 'flancD', facade: 'facade', fronton_cote_G: 'coteG', fronton_cote_D: 'coteD',
  arriere: 'arriere', fronton_fond: 'dosFronton', fronton_dessous: 'dessous', fronton_dessus: 'dessus' };
function uvPanneau(geo, pos, panneau) {
  const n = pos.length / 3, b = { x: [1e9, -1e9], y: [1e9, -1e9], z: [1e9, -1e9] };
  for (let i = 0; i < n; i++) ['x', 'y', 'z'].forEach((k, j) => { b[k][0] = Math.min(b[k][0], pos[i * 3 + j]); b[k][1] = Math.max(b[k][1], pos[i * 3 + j]); });
  const uv = new Float32Array(n * 2), larg = 558.8, t = (k, v) => (v - b[k][0]) / (b[k][1] - b[k][0]);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (panneau === 'facade') uv.set([x / larg, t('z', z)], i * 2);
    else if (panneau === 'dessous' || panneau === 'dessus') uv.set([t('x', x), t('y', y)], i * 2);
    else if (panneau === 'arriere' || panneau === 'dosFronton') uv.set([1 - t('x', x), t('z', z)], i * 2);
    else uv.set([panneau.endsWith('G') ? 1 - t('y', y) : t('y', y), t('z', z)], i * 2);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // dimensions (mm) du canevas pour les panneaux sans cote fixe
  geo.userData.dims = panneau === 'dessous' || panneau === 'dessus' ? [b.x[1] - b.x[0], b.y[1] - b.y[0]] : [b.x[1] - b.x[0], b.z[1] - b.z[0]];
}

// hauteur du fond de rampe à l'abscisse curviligne s (même profil que cao/modele.py)
function zRampe(s, L) {
  const p0 = 3 / 30, s1 = 20, s2 = (RAMPE.z + (RAMPE.pente - p0) * s1) / RAMPE.pente, s3 = L - RAMPE.desc;
  let z = p0 * Math.max(0, s);   // pente de la languette d'entrée (3 mm sur 30)
  for (const [sk, dm, h] of [[s1, RAMPE.pente - p0, 20], [s2, -RAMPE.pente, 50], [s3, -(RAMPE.z - RAMPE.zFin) / RAMPE.desc, 40]]) {
    const x = s - sk;
    z += dm * (x < -h ? 0 : x > h ? x : (x + h) ** 2 / (4 * h));
  }
  return Math.max(0, z);
}

// Enseigne de l'entrée de rampe (plastique incliné de la CAO, sur les flancs de la rampe) : bandeau bleu nuit,
// filet jaune, « ESCALE » lisible depuis les palettes. pts : empreinte vue de dessus, le premier côté le long
// de la bouche ; k : cosinus de l'inclinaison (le décor est écrasé d'autant, la pente le remet d'aplomb).
function enseigne(g, pts, k = 1) {
  const [a, b, , d] = pts;
  const cx = pts.reduce((t, p) => t + p[0], 0) / 4, cy = pts.reduce((t, p) => t + p[1], 0) / 4;
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let h = Math.hypot(d[0] - a[0], d[1] - a[1]);
  g.save();
  g.translate(cx, cy); g.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]));
  g.scale(1, k); h /= k;
  g.fillStyle = '#1f2a6b'; g.fillRect(-l / 2 - 3, -h / 2 - 3, l + 6, h + 6);
  g.strokeStyle = '#ffd23f'; g.lineWidth = 1.4; g.strokeRect(-l / 2 + 2.5, -h / 2 + 2.5, l - 5, h - 5);
  g.font = 'italic 900 10px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 2.6; g.strokeStyle = '#e8392c'; g.strokeText('★ ESCALE ★', 0, 0.8);
  g.fillStyle = '#ffffff'; g.fillText('★ ESCALE ★', 0, 0.8);
  g.restore();
}

// Mesh extrudé d'un contour du jeu, posé sur le plateau, de hauteur h (z de −h à 0)
function extrude(pts, h, material, z0 = 0) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 8 });
  geo.translate(0, 0, -h - z0);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// Cylindre vertical (axe = hauteur) de rayon r, de z0 à z0 + h au-dessus du plateau
function cylinder(r, h, material, x, y, z0 = 0, seg = 32) {
  const geo = new THREE.CylinderGeometry(r, r, h, seg);
  geo.rotateX(-Math.PI / 2);                // axe Y → −z (vers le haut)
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, -(z0 + h / 2));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function canvasTexture(cv) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Renderer3D {
  constructor(canvas, overlay, sim) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.octx = overlay.getContext('2d');
    this.sim = sim;
    this.popups = [];
    this.fannyShow = null;
    this.art = {};
    for (const k of ['victoire', 'lancer']) {
      const img = new Image();
      img.onload = () => { this.art[k] = img; };
      img.src = `assets/fanny_${k}.png`;
    }

    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral (Khronos PBR Neutral) : garde les couleurs de l'illustration ; ACES les délavait vers le blanc
    this.gl.toneMapping = THREE.NeutralToneMapping;
    this.gl.toneMappingExposure = 1;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#170d07');
    this.camera = new THREE.PerspectiveCamera(34, 0.7, 10, 12000);

    // plateau incliné, puis repère de la table
    this.tilt = new THREE.Group();
    this.tilt.rotation.x = PENTE;
    this.scene.add(this.tilt);
    this.table = new THREE.Group();
    this.table.rotation.x = Math.PI / 2;       // (x, y, z) → (x, −z, y)
    this.table.position.set(-W / 2, 0, -H / 2);
    this.tilt.add(this.table);

    this.provisoire = [];   // volumes dessinés ici en attendant les pièces de la CAO : { mesh, x, y }
    this.buildLights();
    this.buildMaterials();
    this.buildFloor();
    this.buildCabinet();
    this.buildStatic();
    this.buildMoving();
    this.buildRamp();

    this.raycaster = new THREE.Raycaster();
    this.panneaux = {}; this.habillages = {}; this.lanceur = []; this.boutons = {};
    this.habillage = lire('fanny-pinball-habillage') || 'bois';
    const cam = CAMERAS.findIndex((c) => c.nom === lire('fanny-pinball-camera'));
    this.camIdx = cam >= 0 ? cam : -1;           // -1 : choisie selon la forme de l'écran
    // version légère : réglage mémorisé, sinon automatique (téléphone, ou machine trop lente)
    const q = lire('fanny-pinball-qualite');
    const mobile = matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory || 8) <= 4;
    this.qualiteAuto = !q;
    this.light = q ? q === 'legere' : mobile;
    this.mesure = { n: 0, total: 0, last: 0 };
    this.onQualite = null;                       // rappel quand la qualité change d'elle-même
    this.applyQuality();
    this.loadCAO();
    this.loadCaisse();
    this.lastFloorKey = '';
    this.lastDisp = '';
  }

  // ------------------------------------------------------------ lumière et matières
  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xfffaf2, 0x2a1a10, 0.6));
    const sun = new THREE.DirectionalLight(0xfff8ee, 1.8);
    sun.position.set(-260, 900, 420);
    sun.target.position.set(0, 0, -60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -420, right: 420, top: 700, bottom: -700, near: 100, far: 2400 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.4);
    fill.position.set(400, 500, 800);
    this.scene.add(fill);

    // environnement des reflets (bille, chromes) : une salle sombre avec quelques panneaux lumineux
    const env = new THREE.Scene();
    env.background = new THREE.Color(0.42, 0.34, 0.27);   // salle chaude, assez claire pour l'acier
    const panel = (w, h, col, x, y, z, ry = 0, rx = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.rotation.set(rx, ry, 0); env.add(m);
    };
    panel(6, 2, new THREE.Color(3, 2.8, 2.5), 0, 6, 0, 0, Math.PI / 2);        // plafonnier
    panel(4, 3, new THREE.Color(2.2, 1.6, 0.8), 0, 2, -6);                     // fronton éclairé
    panel(3, 2, new THREE.Color(0.6, 0.8, 1.4), -6, 2, 2, Math.PI / 2);        // fenêtre bleutée
    panel(3, 2, new THREE.Color(1.2, 0.9, 0.6), 6, 2, 2, -Math.PI / 2);
    panel(20, 20, new THREE.Color(0.35, 0.22, 0.12), 0, -3, 0, 0, Math.PI / 2); // sol chaud
    const pmrem = new THREE.PMREMGenerator(this.gl);
    this.scene.environment = pmrem.fromScene(env, 0.02).texture;
    this.scene.environmentIntensity = 0.75;
  }

  buildMaterials() {
    this.mat = {
      chrome: new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 1, roughness: 0.22, envMapIntensity: 1.6 }),
      steel: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.1, envMapIntensity: 2.6 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.75 }),
      rubberNoir: new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 0.7 }),
      redRubber: new THREE.MeshStandardMaterial({ color: 0xd8342a, roughness: 0.6 }),
      flipper: new THREE.MeshStandardMaterial({ color: 0xfbfbf8, roughness: 0.35 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x4a2c18, roughness: 0.7 }),
      woodDark: new THREE.MeshStandardMaterial({ color: 0x2b1a10, roughness: 0.8 }),
      plasticSide: new THREE.MeshStandardMaterial({ color: 0x3f3a7c, roughness: 0.4 }),
      gate: new THREE.MeshStandardMaterial({ color: 0x9aa0aa, metalness: 0.8, roughness: 0.35 }),
    };
  }

  // ------------------------------------------------------------ plateau peint
  buildFloor() {
    const cv = document.createElement('canvas');
    cv.width = W * TEX; cv.height = H * TEX;
    this.floorR = new Renderer(cv, this.sim);       // le moteur 2D peint la texture
    this.floorR.scale = TEX;
    this.floorTex = canvasTexture(cv);
    this.floorTex.anisotropy = this.gl.capabilities.getMaxAnisotropy();
    const geo = new THREE.PlaneGeometry(W, H);
    geo.rotateX(Math.PI);                            // face vers le haut (−z), v = 0 en bas du plateau
    geo.translate(W / 2, H / 2, 0);
    // plateau verni : vernis brillant (clearcoat) sur l'illustration mate. La texture est peinte lampes
    // éteintes, une seule fois : les lampes sont des pastilles posées dessus (aucun envoi de texture en jeu).
    this.floorMat = new THREE.MeshPhysicalMaterial({
      map: this.floorTex, roughness: 0.6, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.12,
      envMapIntensity: 0.5,                          // la salle se reflète moins : pas de voile laiteux
    });
    this.floor = new THREE.Mesh(geo, this.floorMat);
    this.floor.receiveShadow = true;
    this.table.add(this.floor);

    // halos des lampes : sprites additifs au-dessus des inserts allumés
    const gc = document.createElement('canvas'); gc.width = gc.height = 64;
    const gg = gc.getContext('2d');
    const rg = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.25, 'rgba(255,255,255,0.55)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    gg.fillStyle = rg; gg.fillRect(0, 0, 64, 64);
    this.glowTex = canvasTexture(gc);
    this.glow = (color, size, x, y, z) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false }));
      sp.scale.set(size, size, 1);
      sp.position.set(x, y, -z);
      sp.renderOrder = 3;
      sp.visible = false;
      this.table.add(sp);
      return sp;
    };
    // lampes : pastilles en plastique coloré encastrées à fleur du plateau (opaques, brillantes) + halo au-dessus
    const disc = new THREE.CircleGeometry(1, 32);
    disc.rotateX(Math.PI);                           // face vers le haut (−z)
    this.lampGlows = LAMP_LAYOUT.map(([name, x, y, r, col, label]) => {
      const sz = 96, rOut = r + 1.1, k = (sz / 2) / rOut;
      const makeTex = (bg, fn) => {
        const c = document.createElement('canvas'); c.width = c.height = sz;
        const g = c.getContext('2d');
        g.fillStyle = bg; g.fillRect(0, 0, sz, sz);
        g.setTransform(k, 0, 0, k, 0, 0);
        fn(g);
        const t = canvasTexture(c);
        t.anisotropy = this.gl.capabilities.getMaxAnisotropy();
        return t;
      };
      const map = makeTex('#18110c', (g) => drawLampInsert(g, rOut, rOut, r, col, label, false));
      const emissiveMap = makeTex('#000000', (g) => drawLampInsertEmissive(g, rOut, rOut, r, col, label));
      const mat = new THREE.MeshStandardMaterial({
        map, emissive: 0xffffff, emissiveMap, emissiveIntensity: 0,
        roughness: 0.14, metalness: 0.04, envMapIntensity: 1.4,
      });
      const ins = new THREE.Mesh(disc, mat);
      ins.scale.set(rOut, rOut, 1);
      ins.position.set(x, y, -0.25);
      ins.receiveShadow = true;
      this.table.add(ins);
      return { name, mat, sp: this.glow(col, r * 3.8, x, y, 4) };
    });
  }

  // caisse en bois autour du plateau et barre de verrouillage, en attendant la caisse de la CAO (loadCaisse)
  buildCabinet() {
    this.caisseProvisoire = [];
    const box = (x0, y0, x1, y1, z0, z1, m) => {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, -(z0 + z1) / 2);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.table.add(mesh);
      this.caisseProvisoire.push(mesh);
    };
    const E = 20;
    box(-E, -E, 0, H + E, -40, 95, this.mat.wood);
    box(W, -E, W + E, H + E, -40, 95, this.mat.wood);
    box(-E, -E - 20, W + E, 0, -40, 95, this.mat.wood);
    box(-E, H, W + E, H + E, -40, 70, this.mat.wood);
    box(-E, H - 6, W + E, H + 26, 70, 92, this.mat.chrome);       // barre de verrouillage
    box(-E - 4, -E - 20, W + E + 4, H + E, -60, -40, this.mat.woodDark);
    // coins du haut, hors de l'arrondi du plateau : bois plein
    const { cx, cy, rx, ry } = GEO.ellipse;
    const pts = [[0, 0], [W, 0], [W, cy]];
    for (let i = 0; i <= 48; i++) { const a = -(Math.PI * i) / 48; pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
    pts.push([0, cy]);
    const coins = extrude(pts, 40, this.mat.wood);
    this.table.add(coins);
    this.caisseProvisoire.push(coins);
  }

  // ------------------------------------------------------------ pièces fixes
  buildStatic() {
    const T = this.sim.T;
    // plastiques décorés : le dessus porte la sérigraphie peinte par le moteur 2D
    const cv = document.createElement('canvas');
    cv.width = W * TEX; cv.height = H * TEX;
    const pr = new Renderer(cv, this.sim);
    pr.ctx.setTransform(TEX, 0, 0, TEX, 0, 0);
    const plastics = [];
    if (GEO.bouchonPiece) plastics.push(GEO.bouchonPiece);
    for (const b of T.walls) if (b.plugin && b.plugin.housing) plastics.push(b.vertices.map((v) => [v.x, v.y]));
    for (const p of plastics) pr.plastic(p, 6);
    if (GEO.tirerPlastic) pr.plastic(GEO.tirerPlastic, 6);
    // plastrons supérieurs des lance-pierres : calés sur les 3 poteaux (marge = 10 mm en CAO) + 1,5 mm de fond perdu
    T.slings.forEach((b) => pr.slingPlastic(b.plugin.posts, b.plugin.rPlast, 1.5));
    if (GEO.enseigneRampe) enseigne(pr.ctx, GEO.enseigneRampe.pts, Math.cos((GEO.enseigneRampe.incl * Math.PI) / 180));
    const tex = canvasTexture(cv);
    tex.repeat.set(1 / W, -1 / H);
    tex.offset.set(0, 1);
    const plasticTop = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3 });
    const plasticMat = [plasticTop, this.mat.plasticSide];

    const cen = (pts) => [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length];
    // pts : points témoins (tous les sommets d'un contour, ou le centre d'un rond)
    const prov = (mesh, pts) => { this.provisoire.push({ mesh, pts }); this.table.add(mesh); return mesh; };
    this.plasticTop = plasticTop; this.plasticMat = plasticMat;
    for (const p of plastics) prov(extrude(p, H_PAROI, plasticMat), p);

    // parois et poteaux
    this.anneauxProvisoires = [];
    for (const b of T.walls) {
      if (b.plugin && (b.plugin.hidden || b.plugin.housing || b.plugin.flanc)) continue;
      if (b.circleRadius) {
        prov(cylinder(b.circleRadius, H_PAROI + 4, this.mat.chrome, b.position.x, b.position.y), [[b.position.x, b.position.y]]);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(b.circleRadius + 1.5, 2.2, 10, 28), this.mat.rubber);
        ring.position.set(b.position.x, b.position.y, -14);
        ring.castShadow = true;
        this.table.add(ring);
        this.anneauxProvisoires.push(ring);              // remplacés par les anneaux de la CAO (loadCAO)
      } else {
        const pts = b.vertices.map((v) => [v.x, v.y]);
        prov(extrude(pts, H_PAROI, this.mat.chrome), [cen(pts), ...pts]);
      }
    }
    // portillon du couloir de lancement
    this.table.add(extrude(T.gate.vertices.map((v) => [v.x, v.y]), 22, this.mat.gate));

    // lance-pierres : plastique + caoutchouc blanc tendu sur la face, butoir rouge au milieu
    this.slings = T.slings.map((b) => {
      const sp = b.vertices.map((v) => [v.x, v.y]);
      prov(extrude(sp, H_PAROI - 6, plasticMat), [cen(sp)]);
      const { A, C } = b.plugin;
      const l = Math.hypot(C[0] - A[0], C[1] - A[1]);
      const band = new THREE.Mesh(new THREE.BoxGeometry(l, 3, 14), this.mat.rubber.clone());
      band.position.set((A[0] + C[0]) / 2 + b.plugin.n.x * 1.5, (A[1] + C[1]) / 2 + b.plugin.n.y * 1.5, -12);
      band.rotation.z = Math.atan2(C[1] - A[1], C[0] - A[0]);
      band.castShadow = true;
      this.table.add(band);
      for (const p of [A, C]) prov(cylinder(3.5, H_PAROI + 2, this.mat.chrome, p[0], p[1]), [p]);
      band.userData.sp = this.glow(0xfff0b0, 70, (A[0] + C[0]) / 2, (A[1] + C[1]) / 2, 16);
      this.anneauxProvisoires.push(band);
      return band;
    });

    // bumpers : géométrie réaliste de pop bumper (embase + vis, jupe conique mobile, corps cannelé translucide
    // avec ampoule interne, anneau de frappe chromé biseauté + 2 tiges verticales coulissantes, chapeau bombé)
    const lathe = (pts, segs = 48) => {
      const g = new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), segs);
      g.rotateX(-Math.PI / 2);                                    // h → −z (hauteur au-dessus du plateau)
      return g;
    };
    // corps cannelé translucide (type Williams 03-7443-5) : fût étroit laissant passer les tiges, évasé sous le chapeau
    const flutedBodyGeo = (z0, z1, flutes = 16, segs = 64, rows = 14) => {
      const pos = [], idx = [], stride = segs + 1;
      for (let j = 0; j <= rows; j++) {
        const t = j / rows, h = z0 + t * (z1 - z0);
        const flare = t > 0.62 ? ((t - 0.62) / 0.38) ** 1.6 : 0;
        const rBase = 14.8 + flare * 8.2 - 0.6 * Math.sin(Math.PI * Math.min(1, t / 0.65));
        const amp = 0.65 * Math.sin(Math.PI * t) ** 0.5;
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          const r = rBase + amp * Math.cos(flutes * a);
          pos.push(r * Math.cos(a), r * Math.sin(a), -h);
        }
      }
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < segs; i++) {
          const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    // dessus bombé du chapeau avec UV planaires (la sérigraphie « boule de pétanque » s'y plaque sans distorsion)
    const domeCapGeo = (cap, zBase, domeH, segs = 48, rings = 10) => {
      const pos = [], uv = [], idx = [], stride = segs + 1;
      const kEdge = Math.sqrt(1 - 0.82);
      for (let j = 0; j <= rings; j++) {
        const u = j / rings, r = cap * u;
        const h = zBase + domeH * ((Math.sqrt(Math.max(0, 1 - 0.82 * u * u)) - kEdge) / (1 - kEdge));
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2, x = r * Math.cos(a), y = r * Math.sin(a);
          pos.push(x, y, -h);
          uv.push(0.5 + x / (2 * cap), 0.5 - y / (2 * cap));
        }
      }
      for (let j = 0; j < rings; j++) {
        for (let i = 0; i < segs; i++) {
          const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const baseRingGeo = lathe([[15.5, 0], [33.5, 0], [33.5, 0.9], [31.5, 1.3], [16.5, 1.3], [15.5, 0]], 48);
    const skirtGeo = lathe([
      [17.5, -2.5], [29.8, -2.7], [31.2, -1.9], [30.8, -0.9], [25.4, 0.4], [21.2, 2.8], [18.6, 4.6],
      [17.2, 4.4], [19.8, 2.2], [24.2, -0.5], [29.4, -1.8], [17.5, -2.5],
    ], 48);
    const bodyGeo = flutedBodyGeo(7.5, 34.0);
    const rodGeo = new THREE.CylinderGeometry(1.8, 1.8, 24, 12);
    rodGeo.rotateX(Math.PI / 2);                                  // axe selon z
    const lugGeo = new THREE.BoxGeometry(6.5, 4.4, 2.2);
    const screwGeo = new THREE.SphereGeometry(2.1, 12, 8);
    const capScrewGeo = new THREE.SphereGeometry(1.6, 12, 8);
    const bulbGeo = new THREE.SphereGeometry(5.5, 16, 12);
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0xf7f3e8, roughness: 0.22, metalness: 0.02, envMapIntensity: 0.9 });
    const baseWaferMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.48, metalness: 0 });
    const ringChrome = this.mat.steel.clone();
    ringChrome.color.setHex(0xe8ecf2);
    ringChrome.roughness = 0.11;
    ringChrome.envMapIntensity = 2.2;

    this.bumpers = T.bumpers.map((b, i) => {
      const cap = b.plugin.cap || b.circleRadius, rRing = b.circleRadius;
      const paint = (hit) => {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const g = c.getContext('2d');
        g.setTransform(256 / (2 * cap), 0, 0, 256 / (2 * cap), 0, 0);
        Renderer.prototype.popBumper.call({ ctx: g, boule: Renderer.prototype.boule }, cap, cap, cap, hit, i);
        return canvasTexture(c);
      };
      const tex = [paint(false), paint(true)];
      const grp = new THREE.Group();
      grp.position.set(b.position.x, b.position.y, 0);

      // 1. collerette d'embase posée sur le plateau + 3 vis de fixation (motif Williams Ø 69 mm)
      const baseWafer = new THREE.Mesh(baseRingGeo, baseWaferMat);
      baseWafer.receiveShadow = true;
      grp.add(baseWafer);
      for (const [dx, dy] of [[-25.5, -10.67], [25.5, -10.67], [0, -28.67]]) {
        const vis = new THREE.Mesh(screwGeo, this.mat.chrome);
        vis.scale.set(1, 1, 0.55);
        vis.position.set(dx, dy, -1.3);
        grp.add(vis);
      }

      // 2. jupe conique mobile (bascule vers la bille au contact pour déclencher la bobine)
      const skirtPivot = new THREE.Group();
      skirtPivot.position.set(0, 0, -4.5);
      const skirt = new THREE.Mesh(skirtGeo, skirtMat);
      skirt.castShadow = true; skirt.receiveShadow = true;
      skirtPivot.add(skirt);
      grp.add(skirtPivot);

      // 3. corps cannelé translucide + ampoule interne
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0xe6e0f8, roughness: 0.22, metalness: 0, transparent: true, opacity: 0.88,
        emissive: 0xffc857, emissiveIntensity: 0.1,
      });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.castShadow = true;
      grp.add(body);
      const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xffd86b, emissiveIntensity: 0.4, roughness: 0.2 });
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(0, 0, -24);
      grp.add(bulb);

      // 4. anneau de frappe chromé biseauté + 2 tiges verticales (entraxe 35 mm) : plonge vers le bas au tir
      const ringGeo = lathe([
        [20.5, -1.8], [24.2, -3.2], [rRing - 0.5, -2.0], [rRing, 0.2],
        [rRing - 1.3, 3.2], [21.6, 3.2], [20.5, 2.2], [20.5, -1.8],
      ], 48);
      const ringGroup = new THREE.Group();
      ringGroup.position.set(0, 0, -22.5);                        // position haute au repos (au-dessus de l'équateur de la bille)
      const ringMesh = new THREE.Mesh(ringGeo, ringChrome);
      ringMesh.castShadow = true;
      ringGroup.add(ringMesh);
      for (const sx of [-1, 1]) {
        const rod = new THREE.Mesh(rodGeo, ringChrome);
        rod.position.set(sx * 17.5, 0, 12);                       // descend dans les 2 trous du plateau
        rod.castShadow = true;
        const lug = new THREE.Mesh(lugGeo, ringChrome);
        lug.position.set(sx * 19.6, 0, 0.8);
        ringGroup.add(rod, lug);
      }
      grp.add(ringGroup);

      // 5. chapeau bombé sérigraphié + collerette translucide + 2 vis de chapeau
      const capGroup = new THREE.Group();
      const sideMat = new THREE.MeshStandardMaterial({
        color: 0x5b4fa0, roughness: 0.22, metalness: 0.04, transparent: true, opacity: 0.92,
        emissive: 0xffc857, emissiveIntensity: 0.08,
      });
      const collarGeo = lathe([
        [22.5, 33.4], [cap - 1.8, 33.8], [cap, 35.0], [cap, 37.9], [cap - 0.8, 38.0], [22.5, 37.2], [22.5, 33.4],
      ], 48);
      const collar = new THREE.Mesh(collarGeo, sideMat);
      collar.castShadow = true;
      const topMat = new THREE.MeshStandardMaterial({
        map: tex[0], roughness: 0.18, metalness: 0.04, emissive: 0xffe08a, emissiveIntensity: 0,
      });
      const dome = new THREE.Mesh(domeCapGeo(cap, 37.8, 6.2), topMat);
      dome.castShadow = true;
      capGroup.add(collar, dome);
      for (const sx of [-1, 1]) {
        const cv = new THREE.Mesh(capScrewGeo, this.mat.chrome);
        cv.scale.set(1, 1, 0.45);
        cv.position.set(sx * (cap - 7), 0, -40.8);
        capGroup.add(cv);
      }
      grp.add(capGroup);

      this.table.add(grp);
      return {
        topMat, sideMat, bodyMat, bulbMat, tex, skirtPivot, ringGroup, capGroup,
        tiltAxis: new THREE.Vector3(),
        sp: this.glow(0xffd36a, cap * 3.6, b.position.x, b.position.y, 40),
      };
    });

    // cibles fixes (cochonnets en bois peint)
    this.ciblesProvisoires = {};
    T.standups.forEach((b) => {
      const jack = b.plugin.id === 'bouchon';
      const m = new THREE.Mesh(new THREE.SphereGeometry(b.circleRadius, 24, 16),
        new THREE.MeshStandardMaterial({ color: jack ? 0xe8392c : 0xd9822b, roughness: 0.45 }));
      m.position.set(b.position.x, b.position.y, -b.circleRadius);
      m.castShadow = true;
      this.table.add(m);
      this.ciblesProvisoires[b.plugin.id] = m;           // remplacée par la cible de la CAO (boîtier + face pendulaire)
    });

    // cibles rondes du mur gauche : disques numérotés, face vers le plateau
    this.leftTargets = GEO.leftTargets.map((t, i) => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      g.fillStyle = '#f7f2e8'; g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#1f4e8c'; g.font = 'bold 40px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(i + 1), 32, 34);
      const face = new THREE.MeshStandardMaterial({ map: canvasTexture(c), roughness: 0.4, emissive: 0xff3fa4, emissiveIntensity: 0 });
      const geo = new THREE.CylinderGeometry(t.r, t.r, 4, 32);
      geo.rotateZ(-Math.PI / 2);               // axe vers +x (face tournée vers le plateau)
      const m = new THREE.Mesh(geo, [new THREE.MeshStandardMaterial({ color: 0x1f4e8c }), face, face]);
      m.position.set(t.x, t.y, -t.r - 3);
      m.castShadow = true;
      this.table.add(m);
      this.ciblesProvisoires[t.id] = m;
      return face;
    });
    this.numeroCible = (i) => {                          // face numérotée des cibles rondes (pièces de la CAO)
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#f7f2e8'; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#1f4e8c'; g.lineWidth = 8; g.beginPath(); g.arc(64, 64, 56, 0, 2 * Math.PI); g.stroke();
      g.fillStyle = '#1f4e8c'; g.font = 'bold 78px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(i + 1), 64, 68);
      return canvasTexture(c);
    };
  }

  // ------------------------------------------------------------ pièces mobiles
  buildMoving() {
    const T = this.sim.T;
    // flippers : contour du corps Matter.js autour de l'axe, tourné à chaque image
    this.flippers = T.flippers.map((fl) => {
      const { px, py } = fl.def;
      // palette : corps en plastique dans le contour réduit de la corde, caoutchouc rouge tendu dans sa gorge ;
      // la face extérieure du caoutchouc est le contour de rebond du jeu
      const f = fl.def, c = CORDE_PALETTE;
      const m = extrude(contourPalette(f, f.r1 - c + 0.6, f.r2 - c + 0.6), 21, this.mat.flipper, 2);
      m.add(corde(contourPalette(f, f.r1 - c / 2, f.r2 - c / 2), c / 2, Z_CAOUT, this.mat.redRubber, 90));
      m.position.set(px, py, 0);
      const axe = cylinder(5, 24, this.mat.chrome, 0, 0, 2);
      m.add(axe);
      axe.position.set(0, 0, -14);
      this.table.add(m);
      return { mesh: m, fl, a0: fl.angle };
    });

    // cibles tombantes : blocs blancs à lettre bleue, escamotés quand elles tombent
    this.drops = GEO.drops.map((d) => {
      const c = document.createElement('canvas'); c.width = 96; c.height = 64;
      const g = c.getContext('2d');
      g.fillStyle = '#f7f2e8'; g.fillRect(0, 0, 96, 64);
      g.fillStyle = '#1f4e8c'; g.font = 'bold 44px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(d.letter, 48, 36);
      // lame : coins hauts arrondis, décalque de la lettre sur la face ; elle s'enfonce dans sa lumière quand elle tombe
      const tex = canvasTexture(c);
      tex.repeat.set(1 / DROP.l, 1 / DROP.h); tex.offset.set(0.5, 0);
      const sh = new THREE.Shape(), { l, h, r, e } = DROP;
      sh.moveTo(-l / 2, -2); sh.lineTo(l / 2, -2); sh.lineTo(l / 2, h - r);
      sh.absarc(l / 2 - r, h - r, r, 0, Math.PI / 2, false); sh.lineTo(-l / 2 + r, h);
      sh.absarc(-l / 2 + r, h - r, r, Math.PI / 2, Math.PI, false); sh.lineTo(-l / 2, -2);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: e, bevelEnabled: true, bevelSize: 0.6, bevelThickness: 0.6, bevelSegments: 2, curveSegments: 8 });
      geo.translate(0, 0, -e / 2);
      geo.rotateX(-Math.PI / 2);                 // hauteur → −z (vers le haut), épaisseur → y
      geo.rotateZ(d.angle);
      const m = new THREE.Mesh(geo, [new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 }),
        new THREE.MeshStandardMaterial({ color: 0xf7f2e8, roughness: 0.35 })]);
      m.position.set(d.x, d.y, 0);
      m.castShadow = true;
      m.userData.z = 0;
      this.table.add(m);
      // lumière dans le plateau, visible quand la cible est tombée
      const lu = new THREE.Mesh(new THREE.PlaneGeometry(DROP.lumiere[0], DROP.lumiere[1]), new THREE.MeshBasicMaterial({ color: 0x050403 }));
      lu.rotation.set(Math.PI, 0, -d.angle);
      lu.position.set(d.x, d.y, -0.25);
      this.table.add(lu);
      return m;
    });

    // lanceur
    const P = GEO.plunger;
    const g = new THREE.CylinderGeometry(4, 4, 70, 16);
    this.plunger = new THREE.Group();
    const tige = new THREE.Mesh(g, this.mat.chrome);
    tige.position.set(0, 35, 0);
    const tete = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 8, 24), this.mat.redRubber);
    this.plunger.add(tige, tete);
    this.plunger.position.set(P.x, P.top + 4, -BALL_R);
    this.table.add(this.plunger);

    // billes : sphères d'acier poli
    this.ballGeo = new THREE.SphereGeometry(BALL_R, 40, 28);
    this.balls = [];
  }

  // Rampe en plastique transparent : décor appliqué sur la longueur (liserés rouge et jaune, chevrons à l'entrée,
  // « WORLD TOUR » sur l'arrondi), flancs teintés, rails chromés, lèvre d'entrée.
  buildRamp() {
    const path = this.sim.ramps.L;
    if (!path) return;
    this.rampPath = path;
    const L = path.length, half = RAMPE.larg / 2, bouche = GEO.rampEntries[0];
    const pos = [], uv = [], idxFond = [], idxFlanc = [];
    const rails = [[], []];
    const pts = path.pts;
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l, z = zRampe(p.s, L);
      const hp = half + Math.max(0, (bouche.half - half) * (1 - p.s / bouche.evase));   // entonnoir de la bouche
      for (const [k, sg] of [[0, 1], [1, -1]]) {
        const x = p.x + nx * hp * sg, y = p.y + ny * hp * sg;
        pos.push(x, y, -z, x, y, -(z + RAMPE.flanc));
        const v = k === 0 ? 0 : 1;                  // v = 0 : côté droit du sens de montée
        uv.push(p.s / L, v, p.s / L, v);
        rails[k].push(new THREE.Vector3(x, y, -(z + RAMPE.flanc)));
      }
    });
    // sommets par point : [g bas, g haut, d bas, d haut]
    for (let i = 0; i < pts.length - 1; i++) {
      const o = i * 4, n = o + 4;
      idxFond.push(o, n, o + 2, n, n + 2, o + 2);
      idxFlanc.push(o, o + 1, n, o + 1, n + 1, n, o + 2, n + 2, o + 3, n + 2, n + 3, o + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex([...idxFond, ...idxFlanc]);
    geo.addGroup(0, idxFond.length, 0);
    geo.addGroup(idxFond.length, idxFlanc.length, 1);
    geo.computeVertexNormals();

    // décor du fond, dessiné en millimètres : x = abscisse le long de la rampe, y = travers
    const cv = document.createElement('canvas');
    cv.width = 4096; cv.height = 128;
    const g = cv.getContext('2d');
    g.scale(cv.width / L, cv.height / RAMPE.larg);
    g.fillStyle = 'rgba(205,235,255,0.30)'; g.fillRect(0, 0, L, RAMPE.larg);
    for (const [y0, h, col] of [[0, 4, '#e8392c'], [4, 2.5, '#ffd23f'], [RAMPE.larg - 4, 4, '#e8392c'], [RAMPE.larg - 6.5, 2.5, '#ffd23f']]) {
      g.fillStyle = col; g.fillRect(0, y0, L, h);
    }
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const s0 of [26, 46, 66]) {                 // chevrons dans le sens de la montée
      g.beginPath(); g.moveTo(s0 - 4, half - 8); g.lineTo(s0 + 5, half); g.lineTo(s0 - 4, half + 8);
      g.strokeStyle = '#2b1a10'; g.lineWidth = 6; g.stroke();
      g.strokeStyle = '#ffd23f'; g.lineWidth = 3.5; g.stroke();
    }
    const top = pts.reduce((m, p) => (p.y < m.y ? p : m), pts[0]);
    g.font = 'italic 900 13px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 3; g.strokeStyle = '#1f4e8c'; g.fillStyle = '#ffffff';
    const texte = '★ WORLD TOUR ★', pas = 13;
    [...texte].forEach((ch, i) => {
      const x = top.s - (pas * (texte.length - 1)) / 2 + i * pas;
      g.strokeText(ch, x, half + 0.5); g.fillText(ch, x, half + 0.5);
    });
    const tex = canvasTexture(cv);
    tex.anisotropy = this.gl.capabilities.getMaxAnisotropy();
    this.rampMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      roughness: 0.08, metalness: 0 });
    this.rampFlank = new THREE.MeshStandardMaterial({ color: 0xcde8ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide,
      depthWrite: false, roughness: 0.05, metalness: 0 });
    const mesh = new THREE.Mesh(geo, [this.rampMat, this.rampFlank]);
    mesh.renderOrder = 2;
    this.table.add(mesh);

    for (const r of rails) {
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(r), r.length * 2, 2, 8), this.mat.chrome);
      tube.castShadow = true;
      this.table.add(tube);
    }
    // lèvre métallique de l'entrée, posée sur le plateau
    const p0 = pointAt(path, 7);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(16, 2 * bouche.half + 4, 1.5), this.mat.chrome);
    lip.position.set(p0.x, p0.y, -0.8);
    lip.rotation.z = Math.atan2(p0.dy, p0.dx);
    lip.receiveShadow = true;
    this.table.add(lip);
    // pas de poteaux dans le plateau : la rampe est portée par des pattes murales (pièces de la CAO)
    this.buildWireformGuides();
  }

  // Ensemble des guides de bille du plateau en wireform d'acier inox chromé :
  // tiges parallèles (Ø 4 mm à hauteur du centre de la bille + tige supérieure) à bouts coudés plantés dans le bois
  // avec rondelles chromées et montants intermédiaires. Remplace les guides pleins en vue 3D (même physique Rapier).
  buildWireformGuides() {
    const inox = this.mat.chrome.clone();
    inox.color.setHex(0xe6eaef);
    inox.roughness = 0.13;
    const recule = (pts, d) => {
      const [a, b] = pts, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return [[a[0] + (dx / l) * d, a[1] + (dy / l) * d], ...pts.slice(1)];
    };
    const lisse = (pts) => {
      if (pts.length < 3) return pts;
      const out = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1], b = pts[i], c = pts[i + 1];
        const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, l2 = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
        const r = Math.min(10, l1 * 0.35, l2 * 0.35);
        const p1 = [b[0] - ((b[0] - a[0]) / l1) * r, b[1] - ((b[1] - a[1]) / l1) * r];
        const p2 = [b[0] + ((c[0] - b[0]) / l2) * r, b[1] + ((c[1] - b[1]) / l2) * r];
        out.push(p1, [0.25 * p1[0] + 0.5 * b[0] + 0.25 * p2[0], 0.25 * p1[1] + 0.5 * b[1] + 0.25 * p2[1]], p2);
      }
      out.push(pts[pts.length - 1]);
      return out;
    };
    const ajouterFil = (vecs, rayon, segs = 36) => {
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(vecs, false, 'catmullrom', 0.25), segs, rayon, 8), inox);
      m.castShadow = true;
      m.receiveShadow = true;
      this.table.add(m);
    };
    const pied = (x, y, h = 0) => {
      this.table.add(cylinder(3.4, 1.8, inox, x, y, 0, 14));
      if (h > 0) this.table.add(cylinder(1.5, h, inox, x, y, 0, 10));
    };
    // points intermédiaires régulièrement espacés le long d'une polyligne (pour les montants verticaux)
    const jalons = (pts, pas) => {
      const segs = []; let L = 0;
      for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); segs.push([pts[i], pts[i + 1], l]); L += l; }
      const n = Math.floor(L / pas);
      if (n < 2) return [];
      const out = [];
      for (let k = 1; k < n; k++) {
        let cible = (L * k) / n, acc = 0;
        for (const [a, b, l] of segs) {
          if (acc + l >= cible) { const t = (cible - acc) / (l || 1); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); break; }
          acc += l;
        }
      }
      return out;
    };
    const guideFil = (rawPts, { recul = 0, r1 = 2.0, r2 = 1.55, z1 = BALL_R, z2 = 23, z3 = 0, pasPieds = 130, coude = true, piedsH = 0 } = {}) => {
      const pts = recul ? recule(rawPts, recul) : rawPts;
      const sm = coude ? lisse(pts) : pts;
      const p0 = sm[0], pN = sm[sm.length - 1];
      const u0 = [sm[1][0] - p0[0], sm[1][1] - p0[1]], l0 = Math.hypot(...u0) || 1;
      const uN = [pN[0] - sm[sm.length - 2][0], pN[1] - sm[sm.length - 2][1]], lN = Math.hypot(...uN) || 1;
      const dC = Math.min(5, l0 * 0.35, lN * 0.35);
      const segs = Math.min(180, Math.max(24, sm.length * 10));
      const bas = [
        new THREE.Vector3(p0[0], p0[1], 0),
        new THREE.Vector3(p0[0], p0[1], -z1 + 3),
        new THREE.Vector3(p0[0] + (u0[0] / l0) * dC, p0[1] + (u0[1] / l0) * dC, -z1),
        ...sm.slice(1, -1).map(([x, y]) => new THREE.Vector3(x, y, -z1)),
        new THREE.Vector3(pN[0] - (uN[0] / lN) * dC, pN[1] - (uN[1] / lN) * dC, -z1),
        new THREE.Vector3(pN[0], pN[1], -z1 + 3),
        new THREE.Vector3(pN[0], pN[1], 0),
      ];
      ajouterFil(bas, r1, segs);
      const haut = [
        new THREE.Vector3(p0[0], p0[1], -z1),
        new THREE.Vector3(p0[0], p0[1], -z2 + 3),
        new THREE.Vector3(p0[0] + (u0[0] / l0) * dC, p0[1] + (u0[1] / l0) * dC, -z2),
        ...sm.slice(1, -1).map(([x, y]) => new THREE.Vector3(x, y, -z2)),
        new THREE.Vector3(pN[0] - (uN[0] / lN) * dC, pN[1] - (uN[1] / lN) * dC, -z2),
        new THREE.Vector3(pN[0], pN[1], -z2 + 3),
        new THREE.Vector3(pN[0], pN[1], -z1),
      ];
      ajouterFil(haut, r2, segs);
      if (z3) {
        const top = [
          new THREE.Vector3(p0[0], p0[1], -z2),
          new THREE.Vector3(p0[0], p0[1], -z3 + 3),
          new THREE.Vector3(p0[0] + (u0[0] / l0) * dC, p0[1] + (u0[1] / l0) * dC, -z3),
          ...sm.slice(1, -1).map(([x, y]) => new THREE.Vector3(x, y, -z3)),
          new THREE.Vector3(pN[0] - (uN[0] / lN) * dC, pN[1] - (uN[1] / lN) * dC, -z3),
          new THREE.Vector3(pN[0], pN[1], -z3 + 3),
          new THREE.Vector3(pN[0], pN[1], -z2),
        ];
        ajouterFil(top, r2, segs);
      }
      const hMax = piedsH || z3 || z2;
      pied(p0[0], p0[1], 0);
      pied(pN[0], pN[1], 0);
      if (coude && pts.length === 3) pied(sm[2][0], sm[2][1], hMax);
      else for (const [x, y] of jalons(sm, pasPieds)) pied(x, y, hMax);
    };

    // 1. Guides du bas : couloirs de retour et séparateurs
    for (const s of GEO.separators) guideFil(s, { recul: 8 });
    for (const d of GEO.dividers || []) guideFil(d, { recul: 8 });
    // 2. Guide du couloir bonus (vers T-O-U-R)
    for (const bg of GEO.bonusGuides || []) guideFil(bg, { recul: 8, coude: false, pasPieds: 110 });
    // 3. Guides des couloirs du haut T-O-U-R
    for (const lp of GEO.lanePosts) guideFil([[lp.x, lp.y1], [lp.x, lp.y2]], { r1: 1.75, r2: 1.4, z2: 22 });
    // 4. Déflecteur gauche (deux colonnettes montent à z = 32,5 sous les entretoises de plastique_tirer)
    for (const df of GEO.deflectors) {
      guideFil(df, { pasPieds: 999 });
      const [[x0, y0], [x1, y1]] = df;
      for (const t of [0.2, 0.8]) pied(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 32.5);
    }
    // 5. Séparateur du couloir de lancement (3e fil à z = 28,5 portant les pattes de rampe à z = 30)
    const ls = GEO.laneSep;
    guideFil([[ls.x, ls.y1], [ls.x, GEO.apron.lane - 6]], { r1: 1.8, r2: 1.5, z2: 21, z3: 28.5, pasPieds: 170 });
    // 6. Arche supérieure (3e fil à z = 30,5 portant les pattes de rampe à z = 32)
    const e = GEO.ellipse, arc = [];
    for (let i = 0; i <= 48; i++) {
      const a = Math.PI + (Math.PI * i) / 48;
      const nx = Math.cos(a) / e.rx, ny = Math.sin(a) / e.ry, nl = Math.hypot(nx, ny);
      const x = Math.max(2, Math.min(W - 2, e.cx + e.rx * Math.cos(a) + (nx / nl) * 3));
      const y = e.cy + e.ry * Math.sin(a) + (ny / nl) * 3;
      arc.push([x, y]);
    }
    if (arc.length >= 2) guideFil(arc, { r1: 2.0, r2: 1.55, z2: 22, z3: 30.5, coude: false, pasPieds: 115 });
  }

  // Reflets : la bille et les chromes reflètent la vraie table (capture faite une fois, et quand
  // l'illustration arrive). Des plafonniers invisibles pour le joueur (calque 1) éclairent le reflet.
  captureEnv() {
    if (!this.cubeCam) {
      this.cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
      this.cubeCam = new THREE.CubeCamera(5, 4000, this.cubeRT);
      this.cubeCam.children.forEach((c) => c.layers.enable(1));
      this.scene.add(this.cubeCam);
      for (const [x, z, w, h, k] of [[0, -150, 500, 160, 3.2], [-260, 250, 120, 420, 1.6], [260, 250, 120, 420, 1.6]]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k * 0.95, k * 0.85), side: THREE.DoubleSide }));
        m.position.set(x, 700, z); m.rotation.x = Math.PI / 2;
        m.layers.set(1);
        this.scene.add(m);
      }
    }
    this.scene.updateMatrixWorld(true);
    this.cubeCam.position.copy(this.table.localToWorld(new THREE.Vector3(W / 2, H * 0.55, -BALL_R)));
    const vis = this.balls.map((m) => m.visible);
    this.balls.forEach((m) => { m.visible = false; });
    this.cubeCam.update(this.gl, this.scene);
    this.balls.forEach((m, i) => { m.visible = vis[i]; });
    this.cubeRT.texture.needsPMREMUpdate = true;
    this.mat.steel.envMap = this.cubeRT.texture;
    this.mat.steel.envMapIntensity = 1.4;
    this.mat.steel.needsUpdate = true;
  }

  // ------------------------------------------------------------ pièces de la CAO
  // assets/cao/pieces.glb (outils/cao_web.py) : glTF binaire minimal, lu ici sans chargeur externe.
  // Chaque pièce remplace les volumes provisoires dont le centre tombe dans son contour au ras du plateau.
  async lireGLB(url) {
    let buf;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      buf = await r.arrayBuffer();
    } catch { return null; }
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546c67) return null;
    const jlen = dv.getUint32(12, true);
    const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jlen)));
    const bin = 20 + jlen + 8;
    const lire = (a) => {
      const acc = gltf.accessors[a], v = gltf.bufferViews[acc.bufferView];
      const n = acc.count * (acc.type === 'VEC3' ? 3 : 1);
      const T = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[acc.componentType];
      return new T(buf.slice(bin + v.byteOffset, bin + v.byteOffset + n * T.BYTES_PER_ELEMENT));
    };
    return { gltf, lire };
  }

  async loadCAO() {
    const glb = await this.lireGLB('assets/cao/pieces.glb');
    if (!glb) return;
    const { gltf, lire } = glb;
    const blanc = new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.35, flatShading: true });
    const chrome = this.mat.chrome.clone(); chrome.flatShading = true;
    // tablier : plastique noir satiné, cartes d'instructions peintes sur le dessus (drawApron de render.js)
    const TY0 = GEO.apron.side - 10, ta = document.createElement('canvas');
    ta.width = 2048; ta.height = Math.round((2048 * (H - TY0)) / W);
    const tg = ta.getContext('2d');
    tg.setTransform(ta.width / W, 0, 0, ta.width / W, 0, (-TY0 * ta.width) / W);
    drawApron(tg);
    const texTablier = canvasTexture(ta);
    texTablier.anisotropy = this.gl.capabilities.getMaxAnisotropy();
    const tablierCote = new THREE.MeshPhysicalMaterial({ color: 0x0e0e11, roughness: 0.4, clearcoat: 0.4, clearcoatRoughness: 0.3 });
    const tablierDessus = new THREE.MeshPhysicalMaterial({ map: texTablier, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.35 });
    const plastCote = this.mat.plasticSide.clone(); plastCote.flatShading = true;
    const boitierCible = new THREE.MeshStandardMaterial({ color: 0x24242b, roughness: 0.5, flatShading: true });
    this.faces = [];
    this.anneaux(gltf.scenes[0].extras?.anneaux);
    const contours = [];
    for (const node of gltf.nodes) {
      const { categorie, contour } = node.extras;
      for (const poly of contour) if (poly.length > 2) contours.push(poly);
      if (categorie === 'guide') continue;
      const prim = gltf.meshes[node.mesh].primitives[0];
      const pos = lire(prim.attributes.POSITION), idx = lire(prim.indices);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      let mat;
      if (categorie === 'face') { this.faceCible(node, geo, pos, idx); continue; }
      if (categorie === 'plastique' || categorie === 'tablier') {
        // dessus (faces tournées vers le haut) : décor ; le reste : chant
        const dessus = [], cotes = [];
        for (let i = 0; i < idx.length; i += 3) {
          const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
          const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1];
          const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1];
          const uz = pos[3 * b + 2] - pos[3 * a + 2], vz = pos[3 * c + 2] - pos[3 * a + 2];
          const nz = ux * vy - uy * vx, l = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz) || 1;
          (nz / l < -0.7 ? dessus : cotes).push(a, b, c);
        }
        geo.setIndex([...dessus, ...cotes]);
        geo.addGroup(0, dessus.length, 0);
        geo.addGroup(dessus.length, cotes.length, 1);
        const uv = new Float32Array((pos.length / 3) * 2);
        for (let i = 0; i < pos.length / 3; i++) {
          const x = pos[3 * i], y = pos[3 * i + 1];
          if (categorie === 'tablier') { uv[2 * i] = x / W; uv[2 * i + 1] = 1 - (y - TY0) / (H - TY0); } else { uv[2 * i] = x; uv[2 * i + 1] = y; }
        }
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        mat = categorie === 'tablier' ? [tablierDessus, tablierCote] : [this.plasticTop, plastCote];
      } else {
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        mat = categorie === 'poteau' ? blanc : categorie === 'cible' ? boitierCible : chrome;
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.name = node.name;
      m.castShadow = true;
      m.receiveShadow = true;
      this.table.add(m);
    }
    // volumes provisoires remplacés
    const dedans = (x, y, poly) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const pres = (x, y, poly, d) => poly.some(([xi, yi], i) => {   // distance au contour < d
      const [xj, yj] = poly[(i + 1) % poly.length];
      const dx = xj - xi, dy = yj - yi, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / l2));
      return Math.hypot(x - xi - t * dx, y - yi - t * dy) < d;
    });
    // une pièce provisoire disparaît si la majorité de ses points témoins sont dans une pièce de la CAO (ou à moins
    // de 8 mm) ; les poteaux de rampe provisoires disparaissent tous dès que la CAO fournit les siens
    const couvert = ([x, y]) => contours.some((poly) => dedans(x, y, poly) || pres(x, y, poly, 8));
    const supportsCAO = gltf.nodes.some((n) => n.extras.categorie === 'support');
    let caches = 0;
    for (const p of this.provisoire) {
      const ok = p.support ? supportsCAO : p.pts.filter(couvert).length * 2 > p.pts.length;
      if (ok) { p.mesh.visible = false; caches++; }
    }
    for (const f of this.faces) if (this.ciblesProvisoires[f.id]) this.ciblesProvisoires[f.id].visible = false;
    this.cao = { pieces: gltf.nodes.length, caches, restants: this.provisoire.length - caches };
    this.envDirty = true;
  }

  // caoutchoucs de la CAO (scène de pieces.glb) : mini-anneaux des poteaux d'entrée des couloirs, anneaux des
  // lance-pierres tendus autour de leurs 3 poteaux (deux formes : au repos, et poussé par le bras au choc)
  anneaux(liste) {
    if (!liste) return;
    let slingIdx = 0;
    for (const a of liste) {
      if (a.type === 'poteau') {
        const t = new THREE.Mesh(new THREE.TorusGeometry(a.r + a.cord / 2, a.cord / 2, 10, 32), this.mat.rubberNoir);
        t.position.set(a.x, a.y, -a.z);
        t.castShadow = true;
        this.table.add(t);
      } else {
        const posts = a.poteaux, rc = a.r + a.cord / 2;
        const bombe = { A: posts[a.face[0]], C: posts[a.face[1]], d: 6 };
        const geos = [enveloppe(posts, rc), enveloppe(posts, rc, bombe)].map((pts) => corde(pts, a.cord / 2, a.z, null, 140).geometry);
        const old = this.slings[slingIdx];
        const m = new THREE.Mesh(geos[0], this.mat.rubber.clone());
        m.castShadow = true;
        m.userData = { sp: old.userData.sp, geos };
        this.table.add(m);
        this.slings[slingIdx++] = m;
      }
    }
    for (const m of this.anneauxProvisoires) m.visible = false;
  }

  // face pendulaire d'une cible fixe : maillage de la CAO, accroché à son axe pour basculer au choc
  faceCible(node, geo, pos, tris) {
    const ex = node.extras, id = ex.cible;
    const axe = new THREE.Vector3(...ex.axe), t = new THREE.Vector3(ex.axe_dir[0], ex.axe_dir[1], 0).normalize();
    const n = new THREE.Vector2(ex.n[0], ex.n[1]);
    const cx = ex.axe[0] - n.x * ex.u_axe, cy = ex.axe[1] - n.y * ex.u_axe;     // centre de la face
    const uv = new Float32Array((pos.length / 3) * 2);
    for (let i = 0; i < pos.length / 3; i++) {
      const dx = pos[3 * i] - cx, dy = pos[3 * i + 1] - cy;
      uv[2 * i] = 0.5 - (dx * t.x + dy * t.y) / (2 * ex.r);
      uv[2 * i + 1] = 0.5 + (-pos[3 * i + 2] - ex.zc) / (2 * ex.r);
    }
    geo.setIndex(new THREE.BufferAttribute(tris, 1));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    geo.translate(-axe.x, -axe.y, -axe.z);
    const ronde = id.startsWith('boule');
    const idx = ronde ? Number(id.slice(5)) - 1 : GEO.standups.findIndex((s) => s.id === id);
    let mat;
    if (ronde) {
      mat = new THREE.MeshStandardMaterial({ map: this.numeroCible(idx), roughness: 0.4, emissive: 0xff3fa4, emissiveIntensity: 0, flatShading: true });
      this.leftTargets[idx] = mat;                  // l'allumage de la lampe passe par cette matière
    } else {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d');
      const rg = g.createRadialGradient(48, 44, 6, 64, 64, 64);     // cochonnet en bois peint, vu de face
      const coul = id === 'bouchon' ? ['#ff8a70', '#e8392c', '#7a1410'] : ['#ffc27a', '#d9822b', '#6b3a10'];
      rg.addColorStop(0, coul[0]); rg.addColorStop(0.55, coul[1]); rg.addColorStop(1, coul[2]);
      g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
      mat = new THREE.MeshStandardMaterial({ map: canvasTexture(c), roughness: 0.45, flatShading: true });
    }
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    const pivot = new THREE.Group();
    pivot.position.copy(axe);
    pivot.add(m);
    this.table.add(pivot);
    // sens de bascule : le bas de la face doit reculer (à l'opposé de la bille)
    const bas = new THREE.Vector3(cx, cy, -ex.zc).sub(axe).applyAxisAngle(t, 0.2).add(axe);
    const signe = (bas.x - cx) * n.x + (bas.y - cy) * n.y < 0 ? 1 : -1;
    this.faces.push({ id, pivot, axe: t, signe, flash: ronde ? `target${idx}` : `standup${idx}` });
  }

  // ------------------------------------------------------------ caisse et fronton de la CAO
  // Bouton de flipper (Williams A-16883, axe 1-1/8") : bague-collerette plaquée sur le flanc, capuchon en plastique
  // translucide à face bombée creusée d'anneaux concentriques. Groupe : axe Y sortant, origine sur la face du flanc ;
  // le capuchon (userData.capuchon) s'enfonce quand la palette est tenue.
  boutonFlipper(d) {
    const v = (pts) => pts.map(([r, h]) => new THREE.Vector2(r, h)).reverse();   // profil parcouru du haut vers le bas : faces vers l'extérieur
    const g = new THREE.Group();
    const plast = new THREE.MeshPhysicalMaterial({ color: 0xd11a25, roughness: 0.12, transmission: 0.55, thickness: 6, ior: 1.5,
      clearcoat: 1, clearcoatRoughness: 0.08, attenuationColor: 0x8a0710, attenuationDistance: 12 });
    const bague = new THREE.Mesh(new THREE.LatheGeometry(v([[d / 2, 0], [d / 2 + 6.5, 0], [d / 2 + 7.2, 0.7], [d / 2 + 7.2, 2.2],
      [d / 2 + 6.3, 3], [d / 2 - 0.5, 3]]), 48), plast);
    const r = d / 2 + 2.5;
    const capuchon = new THREE.Mesh(new THREE.LatheGeometry(v([[0, 17.6], [4, 17.5], [4.4, 16.9], [4.9, 17.4], [8.6, 17.2],
      [9, 16.6], [9.5, 17.1], [r - 2.6, 16.8], [r - 0.6, 16], [r, 14.6], [r, 5.2], [r - 0.8, 4], [d / 2 - 1, 4]]), 48), plast);
    g.add(bague, capuchon);
    g.userData.capuchon = capuchon;
    return g;
  }

  // Bouton START (Williams 20-9663) : lunette noire crantée, lentille rouge translucide marquée START, éclairée par
  // sa lampe (userData.lentille : matériau dont on règle l'émission).
  boutonStart(d) {
    const v = (pts) => pts.map(([r, h]) => new THREE.Vector2(r, h)).reverse();   // profil parcouru du haut vers le bas : faces vers l'extérieur
    const g = new THREE.Group();
    const noir = new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.55 });
    const R0 = d / 2 + 5, ri = d / 2 + 0.3;
    g.add(new THREE.Mesh(new THREE.LatheGeometry(v([[ri, 0], [R0, 0], [R0 + 0.5, 0.6], [R0 + 0.5, 7.2], [R0 - 0.4, 8.6],
      [ri + 0.8, 8.6], [ri, 7.6], [ri, 6]]), 64), noir));
    const cran = new THREE.BoxGeometry(1.1, 6, 0.9);
    for (let i = 0; i < 36; i++) {                    // moletage de la lunette
      const a = (i / 36) * Math.PI * 2, m = new THREE.Mesh(cran, noir);
      m.position.set(Math.cos(a) * (R0 + 0.6), 3.9, Math.sin(a) * (R0 + 0.6));
      m.rotation.y = -a;
      g.add(m);
    }
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const c = cv.getContext('2d');
    const grad = c.createRadialGradient(128, 118, 10, 128, 128, 128);
    grad.addColorStop(0, '#ff5a4a'); grad.addColorStop(1, '#a3121b');
    c.fillStyle = grad; c.fillRect(0, 0, 256, 256);
    c.fillStyle = '#1a0405'; c.font = '900 62px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('START', 128, 132, 210);
    const tex = canvasTexture(cv);
    const lentille = new THREE.MeshPhysicalMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.15,
      roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.1 });
    const dome = new THREE.LatheGeometry(v([[0, 7.4], [ri * 0.6, 7.2], [ri - 0.6, 6.8], [ri, 6.2], [ri, 4]]), 48);
    // UV planes (vue de face) pour que le marquage reste droit sur la face bombée
    const pos = dome.attributes.position, uv = dome.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 - pos.getX(i) / (2 * ri), 0.5 + pos.getZ(i) / (2 * ri));
    // posé sur la façade, le groupe est retourné d'un demi-tour autour de Z : X local vers la gauche du joueur
    g.add(new THREE.Mesh(dome, lentille));
    g.userData.lentille = lentille;
    return g;
  }

  // assets/cao/caisse.glb (outils/cao_web.py) : panneaux de la caisse WPC, pieds et barre de verrouillage, dans le
  // repère de la caisse (X largeur, Y vers l'arrière depuis la façade, Z vers le haut). La scène donne la place du
  // plateau : le groupe this.machine ramène ce repère sur celui de la table. Le fronton reçoit ici sa vitre
  // décorée et les afficheurs du score (mêmes TM1637 que la réplique).
  async loadCaisse() {
    const glb = await this.lireGLB('assets/cao/caisse.glb');
    if (!glb) return;
    const { gltf, lire } = glb;
    const ex = gltf.scenes[0].extras;
    const { plateau: pf, caisse: cs, fronton: fr } = ex;
    // table → caisse : retournement (y vers l'arrière, z vers le haut), pente, puis place du plateau
    const versCaisse = new THREE.Matrix4().makeTranslation(pf.x, pf.y, pf.z)
      .multiply(new THREE.Matrix4().makeRotationX((pf.pente_deg * Math.PI) / 180))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI))
      .multiply(new THREE.Matrix4().makeTranslation(0, -H, 0));
    const machine = new THREE.Group();
    machine.matrixAutoUpdate = false;
    machine.matrix.copy(versCaisse.invert());
    this.table.add(machine);

    const bois = this.mat.wood.clone(); bois.flatShading = true;
    const chrome = this.mat.chrome.clone(); chrome.flatShading = true;
    // pieds en acier thermolaqué noir satiné (une peinture : pas de reflet métallique) ; boulons, platines et vérins zingués
    const thermolaque = new THREE.MeshPhysicalMaterial({ color: 0x17171a, roughness: 0.5, metalness: 0, clearcoat: 0.3,
      clearcoatRoughness: 0.35, flatShading: true });
    const zingue = new THREE.MeshStandardMaterial({ color: 0xc4c8ce, metalness: 1, roughness: 0.35, flatShading: true });
    // barre en inox brossé, baguettes et lanceur chromés (surfaces courbes : ombrage lissé), pommeau en bakélite
    // noire, embout en caoutchouc
    const inox = this.mat.chrome.clone(); inox.roughness = 0.32;
    const chromeLisse = this.mat.chrome.clone();
    const mats = { bois, pied: thermolaque, quincaillerie: zingue, barre: inox, baguette: chrome, lanceur: chromeLisse,
      lanceur_tige: chromeLisse,
      pommeau: new THREE.MeshPhysicalMaterial({ color: 0x0c0c0e, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
      embout: new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.8 }),
      // finitions des perçages : grille du ventilateur et boulons chromés, ouïes et ventilateur en plastique noir
      finition_chrome: chromeLisse, charniere: chromeLisse,
      finition_noir: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.6 }),
      fronton_fond: new THREE.MeshStandardMaterial({ color: 0x120c08, roughness: 0.9, flatShading: true }) };
    // fronton basculant : ses panneaux, ses charnières et sa façade sont posés dans un groupe qui pivote sur l'axe des
    // boulons de charnière (X), pour le rabattre sur la caisse comme pour le transport
    const ch = ex.charniere;
    const pivot = new THREE.Group();
    pivot.position.set(0, ch.y, ch.z);
    const fronton = new THREE.Group();
    fronton.position.set(0, -ch.y, -ch.z);
    pivot.add(fronton);
    machine.add(pivot);
    for (const node of gltf.nodes) {
      const prim = gltf.meshes[node.mesh].primitives[0];
      const geo = new THREE.BufferGeometry();
      const pos = lire(prim.attributes.POSITION);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setIndex(new THREE.BufferAttribute(lire(prim.indices), 1));
      const mat = mats[node.extras.categorie] || bois;
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.name = node.name;
      m.castShadow = m.receiveShadow = true;
      (/^(fronton_|charniere_)/.test(node.name) ? fronton : machine).add(m);
      if (PANNEAUX[node.name]) { uvPanneau(geo, pos, PANNEAUX[node.name]); m.userData.mat0 = mat; this.panneaux[node.name] = m; }
      if (['lanceur_tige', 'lanceur_pommeau', 'lanceur_embout'].includes(node.name)) this.lanceur.push(m);
    }
    // le lanceur à ressort de la caisse remplace la tige simplifiée du plateau
    if (this.lanceur.length) { this.lanceurAxe = new THREE.Vector3(...ex.lanceur.axe); this.plunger.visible = false; }

    // porte du monnayeur, posée sur la découpe de la façade
    const po = ex.porte;
    const metal = new THREE.MeshStandardMaterial({ color: 0x202026, metalness: 0.7, roughness: 0.35 });
    const bloc = (l, p, h, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(l, p, h), mat);
      m.position.set(x, y, z);
      machine.add(m);
      return m;
    };
    const xc = po.x_gauche + po.l / 2, zc = po.z_bas + po.h / 2;
    bloc(po.l + 14, 4, po.h + 14, xc, -2, zc, metal);
    bloc(po.l - 30, 3, po.h - 30, xc, -5, zc, new THREE.MeshStandardMaterial({ color: 0x3b3b44, metalness: 0.8, roughness: 0.3 }));
    const fente = new THREE.MeshBasicMaterial({ color: 0xff3a20 });
    for (const dx of [-55, 55]) {
      bloc(46, 6, 70, xc + dx, -7, zc + 40, metal);
      bloc(5, 2, 34, xc + dx, -10.5, zc + 40, fente);
    }
    // boutons : start sur la façade, flippers sur les flancs
    for (const b of ex.boutons) {
      const g = b.nom === 'start' ? this.boutonStart(b.d) : this.boutonFlipper(b.d);
      const axe = new THREE.Vector3(...b.axe);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axe);
      g.position.set(...b.p);
      g.userData.axe = axe;
      machine.add(g);
      this.boutons[b.nom] = g;
    }

    // façade du fronton, inclinée : vitre décorée en haut, panneau des afficheurs en bas
    const LG = cs.longueur, E = cs.ep, HAR = cs.h_arriere;
    const yAt = (z) => LG - fr.p_bas - ((fr.p_haut - fr.p_bas) * (z - HAR)) / fr.h;
    const zb = HAR + E, zt = HAR + fr.h - E;
    const A = new THREE.Vector3((cs.largeur - fr.l) / 2 + E, yAt(zb), zb);
    const up = new THREE.Vector3(0, yAt(zt) - A.y, zt - zb);
    const hh = up.length(); up.normalize();
    const ax = new THREE.Vector3(1, 0, 0), nrm = new THREE.Vector3().crossVectors(ax, up);
    const rot = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, up, nrm));
    const w = fr.l - 2 * E;
    const plan = (v0, ph, mat) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, ph), mat);
      m.quaternion.copy(rot);
      m.position.copy(A).addScaledVector(ax, w / 2).addScaledVector(up, v0 + ph / 2).addScaledVector(nrm, -6);
      fronton.add(m);
      return m;
    };
    // vitre rétroéclairée : l'illustration du fronton, sans éclairage de la scène
    const gh = Math.min(hh * 0.72, (w * 832) / 1216);
    const vitre = new THREE.MeshBasicMaterial({ color: 0x222222, toneMapped: false });
    new THREE.TextureLoader().load('assets/fronton.jpg', (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.gl.capabilities.getMaxAnisotropy();
      vitre.map = t; vitre.color.set(0xffffff); vitre.needsUpdate = true;
      this.envDirty = true;
    });
    plan(hh - gh, gh, vitre);
    // panneau des afficheurs
    const ph = hh - gh - 6;
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = Math.round((1024 * ph) / w);
    this.afficheurs = { cv, tex: canvasTexture(cv), fond: this.panneauAfficheurs(cv.width, cv.height) };
    this.afficheurs.tex.anisotropy = this.gl.capabilities.getMaxAnisotropy();
    plan(0, ph, new THREE.MeshBasicMaterial({ map: this.afficheurs.tex, toneMapped: false }));
    this.lastDisp = '';
    // baguette chromée entre la vitre et le panneau
    const bag = plan(ph, 6, chrome);
    bag.position.addScaledVector(nrm, 2);

    // sol de la salle, avec une ombre douce sous la machine (l'ombre du soleil ne couvre que le plateau)
    const sol = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.85 }));
    sol.position.set(cs.largeur / 2, LG / 2, -ex.h_sol);
    machine.add(sol);
    const oc = document.createElement('canvas'); oc.width = oc.height = 128;
    const og = oc.getContext('2d');
    const orad = og.createRadialGradient(64, 64, 10, 64, 64, 64);
    orad.addColorStop(0, 'rgba(0,0,0,0.75)'); orad.addColorStop(1, 'rgba(0,0,0,0)');
    og.fillStyle = orad; og.fillRect(0, 0, 128, 128);
    const ombre = new THREE.Mesh(new THREE.PlaneGeometry(cs.largeur * 1.9, LG * 1.35),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(oc), transparent: true, depthWrite: false }));
    ombre.position.set(cs.largeur / 2, LG / 2, -ex.h_sol + 1);
    machine.add(ombre);

    for (const m of this.caisseProvisoire) m.visible = false;
    this.machine = machine;
    this.setHabillage(this.habillage);
    // angle du fronton rabattu : la façade (arêtes avant du dessous et du dessus du fronton) se pose sur les baguettes
    // des flancs, avec 12 mm de couverture de protection sous l'arête haute (l'arête basse, près du pivot, frôle
    // seulement le haut de la caisse)
    const zBaguette = (y) => cs.h_avant + (HAR - cs.h_avant) * Math.min(1, y / (LG - cs.plat)) + 1.5;
    const aretes = [[LG - fr.p_bas, HAR, 0], [LG - fr.p_haut, HAR + fr.h, 12]];
    let plie = 0;
    for (let a = 0; a < Math.PI * 0.62; a += 0.002) {
      const c = Math.cos(a), s = Math.sin(a);
      const touche = ([y, z, jeu]) => {             // seulement au-dessus des baguettes (pente des flancs)
        const y2 = ch.y + (y - ch.y) * c - (z - ch.z) * s;
        return y2 < LG - cs.plat && ch.z + (y - ch.y) * s + (z - ch.z) * c < zBaguette(y2) + jeu;
      };
      if (aretes.some(touche)) break;
      plie = a;
    }
    this.fronton = { pivot, angle: 0, cible: 0, plie, t: 0 };
    this.machineBox = { x0: -70, x1: cs.largeur + 70, y0: -20, y1: LG, z0: -ex.h_sol, z1: HAR + fr.h };
    this.envDirty = true;
    if (this.cssW && (CAMERAS[this.camIdx]?.machine || this.enTour)) this.fitCamera();
  }

  // ------------------------------------------------------------ fronton : assemblé ou rabattu pour le transport
  get frontonPlie() { return !!this.fronton?.cible; }
  basculerFronton() {
    const f = this.fronton;
    if (f) f.cible = f.cible ? 0 : f.plie;
  }
  animerFronton() {
    const f = this.fronton, t = performance.now();
    const dt = Math.min(0.1, (t - (f.t || t)) / 1000);
    f.t = t;
    if (f.angle === f.cible) return;
    const pas = 0.9 * dt;                       // ≈ 2 s pour rabattre le fronton
    f.angle = Math.abs(f.cible - f.angle) <= pas ? f.cible : f.angle + Math.sign(f.cible - f.angle) * pas;
    f.pivot.rotation.x = f.angle;
    if (f.angle === f.cible) this.envDirty = true;
  }

  // ------------------------------------------------------------ habillages de la caisse (js/habillages.js)
  get habillageNom() { return HABILLAGES.find((h) => h.id === this.habillage)?.nom ?? 'bois'; }
  cycleHabillage() {
    const i = HABILLAGES.findIndex((h) => h.id === this.habillage);
    this.setHabillage(HABILLAGES[(i + 1) % HABILLAGES.length].id);
  }
  async setHabillage(id) {
    if (!HABILLAGES.some((h) => h.id === id)) id = 'bois';
    this.habillage = id;
    ecrire('fanny-pinball-habillage', id);
    if (!this.machine) return;          // appliqué quand la caisse sera chargée
    if (id !== 'bois' && !this.habillages[id]) {
      const im = await chargerImages();
      const mats = {};
      for (const [nom, panneau] of Object.entries(PANNEAUX)) {
        const tex = new THREE.CanvasTexture(dessiner(id, panneau, im, 1.6, this.panneaux[nom]?.geometry.userData.dims));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = this.gl.capabilities.getMaxAnisotropy();
        // vinyle imprimé, mat satiné ; le décor néon s'éclaire lui-même
        mats[nom] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0, flatShading: true,
          ...(estEmissif(id) ? { emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55 } : {}) });
      }
      this.habillages[id] = mats;
    }
    if (this.habillage !== id) return;  // un autre choix est arrivé pendant le dessin
    for (const [nom, m] of Object.entries(this.panneaux)) m.material = id === 'bois' ? m.userData.mat0 : this.habillages[id][nom];
    this.envDirty = true;
  }

  // fond du panneau des afficheurs : tôle noire, deux grilles de haut-parleur, logements des TM1637
  panneauAfficheurs(cw, ch) {
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    const lg = g.createLinearGradient(0, 0, 0, ch);
    lg.addColorStop(0, '#1c1620'); lg.addColorStop(1, '#0b080c');
    g.fillStyle = lg; g.fillRect(0, 0, cw, ch);
    const r = ch * 0.36;
    for (const x of [ch * 0.5, cw - ch * 0.5]) {
      g.fillStyle = '#060507';
      g.beginPath(); g.arc(x, ch / 2, r, 0, 2 * Math.PI); g.fill();
      g.fillStyle = '#2a2430';
      for (let dy = -r; dy <= r; dy += 9) {
        for (let dx = -r; dx <= r; dx += 9) if (dx * dx + dy * dy < (r - 6) ** 2) g.fillRect(x + dx - 2, ch / 2 + dy - 2, 4, 4);
      }
      g.strokeStyle = '#8a7f6a'; g.lineWidth = 4;
      g.beginPath(); g.arc(x, ch / 2, r, 0, 2 * Math.PI); g.stroke();
    }
    g.strokeStyle = '#c9a24a'; g.lineWidth = 3;
    g.strokeRect(4, 4, cw - 8, ch - 8);
    return c;
  }

  // afficheurs du fronton : score (2 × 4 chiffres) et info (4 chiffres), comme dans la colonne de gauche
  drawAfficheurs(d) {
    const { cv, tex, fond } = this.afficheurs;
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(fond, 0, 0);
    const cw = cv.width, ch = cv.height;
    const sw = cw - 2 * ch * 1.05, sh = ch * 0.42;
    const x = (cw - sw) / 2;
    g.fillStyle = '#000'; g.fillRect(x - 8, ch * 0.08 - 8, sw + 16, sh + 16);
    drawSegDisplay(cv, d.score, { rect: [x, ch * 0.08, sw, sh] });
    const iw = sw * 0.45, ih = ch * 0.34;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000'; g.fillRect(x + sw - iw - 8, ch * 0.58 - 8, iw + 16, ih + 16);
    drawSegDisplay(cv, d.info, { on: '#ffb020', off: 'rgba(255,176,32,0.08)', rect: [x + sw - iw, ch * 0.58, iw, ih] });
    g.setTransform(1, 0, 0, 1, 0, 0);
    tex.needsUpdate = true;
  }

  // ------------------------------------------------------------ interface commune avec Renderer
  fanny(kind = 'victoire', ms = 2200) { this.fannyShow = { kind, t: performance.now(), ms }; }

  popup(x, y, text) { this.popups.push({ x, y, text, t: performance.now() }); }

  // version légère : ni ombres ni vernis, résolution de l'écran
  setLight(on, auto = false) {
    this.light = on;
    if (!auto) { this.qualiteAuto = false; ecrire('fanny-pinball-qualite', on ? 'legere' : 'haute'); }
    this.applyQuality();
    if (this.cssW) this.resize(this.cssW, this.cssH);
  }

  applyQuality() {
    this.gl.shadowMap.enabled = !this.light;
    if (this.floorMat) this.floorMat.clearcoat = this.light ? 0 : 0.5;
    this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
  }

  get cameraNom() { return CAMERAS[this.camIdx >= 0 ? this.camIdx : this.camAuto()].nom; }
  camAuto() { return this.cssW && this.cssW / this.cssH < 0.62 ? 1 : 0; }

  cycleCamera() {
    this.camIdx = ((this.camIdx >= 0 ? this.camIdx : this.camAuto()) + 1) % CAMERAS.length;
    ecrire('fanny-pinball-camera', CAMERAS[this.camIdx].nom);
    this.fitCamera();
    return this.cameraNom;
  }

  resize(cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, this.light ? 1 : 1.5);
    this.cssW = cssW; this.cssH = cssH;
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(cssW, cssH, true);
    this.overlay.width = Math.round(cssW * dpr);
    this.overlay.height = Math.round(cssH * dpr);
    this.overlay.style.width = `${cssW}px`;
    this.overlay.style.height = `${cssH}px`;
    this.dpr = dpr;
    this.camera.aspect = cssW / cssH;
    this.fitCamera();
  }

  get enTour() { return !!CAMERAS[this.camIdx]?.tour; }
  get enMachine() { return !!CAMERAS[this.camIdx]?.machine; }
  // la souris ou le doigt pilotent la caméra (et non les flippers) : tour, ou vue machine déverrouillée
  get pilotable() { return this.enTour || (this.enMachine && !this.vueMachine?.verrou); }
  get orbite() { return this.enTour ? this.tour : this.enMachine ? this.vueMachine : null; }

  // vue machine : angle et zoom choisis à la souris, mémorisés avec le verrou
  chargerVueMachine() {
    let v = null;
    try { v = JSON.parse(lire('fanny-pinball-vue-machine')); } catch {}
    this.vueMachine = { az: 0, elev: CAMERAS.find((c) => c.machine).elev, zoom: 0.85, verrou: false, ...(v || {}), plateau: true };
  }

  memoriserVueMachine() {
    const { az, elev, zoom, verrou } = this.vueMachine;
    ecrire('fanny-pinball-vue-machine', JSON.stringify({ az, elev, zoom, verrou }));
  }

  basculerVerrou() {
    if (!this.vueMachine) this.chargerVueMachine();
    this.vueMachine.verrou = !this.vueMachine.verrou;
    this.vueMachine.drag = null;
    this.memoriserVueMachine();
    return this.vueMachine.verrou;
  }

  // boîte englobante du flipper (repère du monde) : centre et rayon de la sphère qui la contient
  sphereMachine() {
    const pts = [];
    if (this.machine) {
      const b = this.machineBox;
      for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) {
        pts.push(this.machine.localToWorld(new THREE.Vector3(x, y, z)));
      }
    } else {
      for (const [x, y] of [[-20, -40], [W + 20, -40], [-20, H + 26], [W + 20, H + 26]]) {
        for (const z of [-40, 95]) pts.push(this.table.localToWorld(new THREE.Vector3(x, y, -z)));
      }
    }
    const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    return { c, r: Math.max(...pts.map((p) => p.distanceTo(c))) };
  }

  // tour de la machine : la caméra tourne seule (azimut, hauteur et distance varient à des rythmes différents,
  // donc les angles ne se répètent pas à chaque tour) ; un glisser la pilote, la molette zoome, puis elle repart
  updateTour() {
    const t = this.tour, now = performance.now();
    const auto = now - t.main > TOUR.reprise_ms;
    const dt = Math.min(0.1, (now - (t.last || now)) / 1000);
    t.last = now;
    if (auto) {
      t.az += (dt * 2 * Math.PI) / TOUR.tour_s;
      t.ph += dt;
      // la hauteur et le zoom glissent vers leur rythme automatique, sans saut après une reprise en main
      const elevAuto = TOUR.elevMin + ((TOUR.elevMax - TOUR.elevMin) * (1 - Math.cos((2 * Math.PI * t.ph) / TOUR.elev_s))) / 2;
      const zoomAuto = 0.82 + 0.2 * Math.cos((2 * Math.PI * t.ph) / TOUR.zoom_s);
      const k = Math.min(1, dt * 0.8);
      t.elev += (elevAuto - t.elev) * k;
      t.zoom += (zoomAuto - t.zoom) * k;
    }
    this.placerOrbite(t);
  }

  // caméra en orbite autour du flipper : azimut, hauteur (degrés) et zoom (1 = tout le flipper dans l'image)
  placerOrbite(t) {
    const { c, r } = this.sphereMachine();
    const cam = this.camera;
    cam.clearViewOffset();
    const v = (cam.fov * Math.PI) / 360, h = Math.atan(Math.tan(v) * cam.aspect);
    const d = (r / Math.sin(Math.min(v, h))) * t.zoom;
    const el = (t.elev * Math.PI) / 180;
    const cible = c.clone();
    if (t.plateau) {
      // vue machine : en zoomant, on se rapproche du centre du plateau
      const p = this.table.localToWorld(new THREE.Vector3(W / 2, H / 2, 0));
      cible.lerp(p, Math.min(1, Math.max(0, (1 - t.zoom) / 0.7)));
    } else cible.y += r * 0.12 * (1 - t.zoom);          // de près, on regarde un peu plus haut (plateau, fronton)
    cam.position.set(cible.x + d * Math.sin(t.az) * Math.cos(el), cible.y + d * Math.sin(el), cible.z + d * Math.cos(t.az) * Math.cos(el));
    cam.lookAt(cible);
    cam.updateProjectionMatrix();
  }

  // pilotage à la souris ou au doigt (tour, vue machine déverrouillée) : glisser tourne, molette ou pincer zoome
  tourDown(x, y) {
    const t = this.pilotable && this.orbite;
    if (t) { t.drag = { x, y }; t.main = performance.now(); }
  }

  tourMove(x, y) {
    const t = this.pilotable && this.orbite;
    if (!t || !t.drag) return;
    t.az -= ((x - t.drag.x) / (this.cssW || 800)) * 2 * Math.PI * 0.6;
    t.elev = Math.max(TOUR.elevMin, Math.min(80, t.elev + ((y - t.drag.y) / (this.cssH || 600)) * 90));
    t.drag = { x, y };
    this.bougee(t);
  }

  tourUp() { const t = this.orbite; if (t) t.drag = null; }

  tourZoom(dy) { this.zoomer(Math.exp(dy * 0.0013)); }

  zoomer(facteur) {
    const t = this.pilotable && this.orbite;
    if (!t) return;
    t.zoom = Math.max(t.plateau ? 0.03 : 0.25, Math.min(1.8, t.zoom * facteur));
    this.bougee(t);
  }

  bougee(t) {
    t.main = performance.now();
    if (t === this.vueMachine) { this.placerOrbite(t); this.memoriserVueMachine(); }
  }

  // caméra à la place du joueur : on recule jusqu'à voir toute la table
  fitCamera() {
    const vue = CAMERAS[this.camIdx >= 0 ? this.camIdx : this.camAuto()];
    const cam = this.camera, elev = (vue.elev * Math.PI) / 180;
    cam.fov = vue.fov;
    cam.clearViewOffset();
    this.scene.updateMatrixWorld(true);
    if (vue.tour) {
      if (!this.tour) this.tour = { az: 0, elev: vue.elev, zoom: 1, ph: 0, main: 0 };
      this.updateTour();
      return;
    }
    this.tour = null;
    if (vue.machine) {
      if (!this.vueMachine) this.chargerVueMachine();
      this.placerOrbite(this.vueMachine);
      return;
    }
    const target = new THREE.Vector3(0, 0, 40);
    const dir = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev));
    const corners = [];
    for (const [x, y, z] of [[-20, -40, 0], [W + 20, -40, 0], [-20, H + 26, 92], [W + 20, H + 26, 92], [-20, -40, 95], [W + 20, -40, 95]]) {
      corners.push(this.table.localToWorld(new THREE.Vector3(x, y, -z)));
    }
    const fits = (d) => {
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      return corners.every((c) => { const p = c.clone().project(cam); return Math.abs(p.x) < 0.98 && Math.abs(p.y) < 0.98; });
    };
    let lo = 300, hi = 9000;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    fits(hi);
    // recentrage vertical : la table occupe toute la hauteur
    const ys = corners.map((c) => c.clone().project(cam).y);
    const dy = (Math.max(...ys) + Math.min(...ys)) / 2;
    cam.setViewOffset(this.cssW, this.cssH, 0, (-dy * this.cssH) / 2, this.cssW, this.cssH);
    cam.updateProjectionMatrix();
  }

  // point de l'écran → coordonnées de la table (commandes tactiles)
  toTable(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.floor, false)[0];
    if (!hit) return { x: clientX - r.left < r.width / 2 ? 0 : W, y: H };
    const p = this.table.worldToLocal(hit.point.clone());
    return { x: p.x, y: p.y };
  }

  // point de la table → pixels de l'overlay
  toScreen(x, y, z = 0) {
    const p = this.table.localToWorld(new THREE.Vector3(x, y, -z)).project(this.camera);
    return [((p.x + 1) / 2) * this.overlay.width, ((1 - p.y) / 2) * this.overlay.height];
  }

  // ------------------------------------------------------------ image
  draw(rules) {
    const sim = this.sim, now = sim.time;
    if (this.fronton) this.animerFronton();
    // qualité automatique : sous 40 images/s en moyenne pendant une partie, on passe en version légère
    if (this.qualiteAuto && !this.light && rules.mode === 'play') {
      const t = performance.now(), m = this.mesure;
      if (m.last && t - m.last < 250) { m.n++; m.total += t - m.last; }
      m.last = t;
      if (m.n >= 150) {
        if (m.total / m.n > 25) { this.setLight(true, true); if (this.onQualite) this.onQualite(); }
        else this.qualiteAuto = false;           // la machine suit : on n'y touche plus
      }
    }
    if (this.afficheurs) {
      const d = rules.display();
      if (d.score + d.info !== this.lastDisp) { this.lastDisp = d.score + d.info; this.drawAfficheurs(d); }
    }
    const lamps = rules.lamps();
    const blinkOn = Math.floor(performance.now() / 220) % 2 === 0;

    // texture du plateau : redessinée seulement quand une lampe change
    const key = Object.entries(lamps).map(([k, v]) => (v === 2 ? (blinkOn ? 1 : 0) : v) ? k : '').join(',');
    // plateau peint lampes éteintes : redessiné seulement quand l'illustration arrive
    if (this.floorR.bg !== this.lastBg) {
      this.lastBg = this.floorR.bg;
      this.floorR.drawFloor({}, false);
      this.floorR.apron({}, false);
      this.floorTex.needsUpdate = true;
      this.envDirty = true;
    }
    if (key !== this.lastFloorKey) {
      this.lastFloorKey = key;
      for (const { name, mat, sp } of this.lampGlows) {
        const st = lamps[name] || 0;
        const lit = st === 1 || (st === 2 && blinkOn);
        mat.emissiveIntensity = lit ? 1.55 : 0;
        sp.visible = lit;
      }
    }

    for (const f of this.flippers) f.mesh.rotation.z = f.fl.angle - f.a0;
    // cibles tombantes : elles s'enfoncent (ou remontent) en 60 ms environ
    const tAnim = performance.now(), dtA = Math.min(0.1, (tAnim - (this.tAnim || tAnim)) / 1000);
    this.tAnim = tAnim;
    this.drops.forEach((m, i) => {
      const cible = sim.dropsUp[i] ? 0 : DROP.h + 1;
      m.userData.z += (cible - m.userData.z) * Math.min(1, dtA * 30);
      m.position.z = m.userData.z;
      m.visible = m.userData.z < DROP.h;
    });
    // faces pendulaires des cibles fixes : elles basculent sur leur axe au choc, puis le levier du KW11 les ramène
    if (this.faces) {
      for (const f of this.faces) {
        const age = now - (sim.flash[f.flash] ?? -1e9);
        const a = age < 160 ? 0.32 * Math.sin((Math.PI * age) / 160) : 0;
        f.pivot.quaternion.setFromAxisAngle(f.axe, f.signe * a);
      }
    }
    this.bumpers.forEach((b, i) => {
      const age = now - (sim.flash[`bumper${i}`] ?? -1e9);
      const hit = age < 110;
      const want = b.tex[hit ? 1 : 0];
      if (b.topMat.map !== want) { b.topMat.map = want; b.topMat.needsUpdate = true; }
      // 1. bascule de la jupe conique vers le côté frappé par la bille (0..115 ms)
      if (age < 115) {
        const d = sim.flashDir?.[`bumper${i}`] || { x: 0, y: 1 };
        const tilt = 0.14 * Math.sin((Math.PI * age) / 115) * Math.exp(-age / 75);
        b.skirtPivot.quaternion.setFromAxisAngle(b.tiltAxis.set(d.y, -d.x, 0), tilt);
      } else if (b.skirtPivot.quaternion.w !== 1) {
        b.skirtPivot.quaternion.identity();
      }
      // 2. coup de bobine : l'anneau chromé + ses 2 tiges plongent violemment vers le bas (10,5 mm en 26 ms) puis remontent par ressort
      let stroke = 0;
      if (age < 26) {
        stroke = Math.sin((age / 26) * (Math.PI / 2));
      } else if (age < 145) {
        const u = (age - 26) / 119;
        stroke = Math.exp(-u * 4.2) * Math.cos(u * Math.PI * 1.35) * (1 - u);
      }
      b.ringGroup.position.z = -(22.5 - stroke * 10.5);
      // 3. léger recul vibratoire du chapeau + flash de l'ampoule interne dans le corps cannelé translucide
      b.capGroup.position.z = age < 90 ? 0.7 * Math.sin((Math.PI * age) / 90) : 0;
      const flash = age < 190 ? (1 - age / 190) ** 1.5 : 0;
      b.topMat.emissiveIntensity = flash * 0.65;
      b.sideMat.emissiveIntensity = 0.08 + flash * 1.1;
      b.bodyMat.emissiveIntensity = 0.1 + flash * 1.6;
      b.bulbMat.emissiveIntensity = 0.4 + flash * 2.4;
      b.sp.visible = age < 190;
      if (b.sp.visible) b.sp.material.opacity = flash;
    });
    this.slings.forEach((band, i) => {
      const hit = now - (sim.flash[`sling${i}`] ?? -1e9) < 90;
      band.material.emissive.setHex(hit ? 0xffd23f : 0x000000);
      band.userData.sp.visible = hit;
      if (band.userData.geos) band.geometry = band.userData.geos[hit ? 1 : 0];     // le bras pousse le caoutchouc
    });
    this.leftTargets.forEach((face, i) => {
      const hit = now - (sim.flash[`target${i}`] ?? -1e9) < 150;
      face.emissiveIntensity = hit ? 0.9 : (lamps[`cible${i}`] || 0) > 0 ? 0.5 : 0;
    });
    const rampHit = now - (sim.flash.rampL ?? -1e9) < 300;
    this.rampMat.color.setHex(rampHit ? 0xfff0aa : 0xffffff);
    this.rampFlank.color.setHex(rampHit ? 0xfff0aa : 0xcde8ff);
    const kick = (now - (sim.flash.plunger ?? -1e9) < 60 ? -6 : 0) + sim.tirage * sim.courseLanceur;   // tiré vers le joueur, puis frappe
    this.plunger.position.y = GEO.plunger.top + 4 + kick;
    for (const m of this.lanceur) m.position.copy(this.lanceurAxe).multiplyScalar(kick);
    // boutons : capuchons de flipper enfoncés quand la palette est tenue ; START clignote quand une partie peut partir
    for (const c of ['L', 'R']) {
      const cap = this.boutons[`flipper_${c === 'L' ? 'G' : 'D'}`]?.userData.capuchon;
      if (cap) cap.position.y = sim.held[c] ? -4 : 0;
    }
    const st = this.boutons.start?.userData.lentille;
    if (st) st.emissiveIntensity = rules.canStart?.() ? (Math.floor(now / 400) % 2 ? 1.3 : 0.25) : 0.15;

    // billes
    const views = [];
    for (const b of sim.balls) {
      const fp = b.plugin.fp;
      if (fp.mode === 'gone') continue;
      if (!sousTablier(b.position.x, b.position.y)) {
        // hauteur et rotation données par la physique ; au-dessus du trou d'évacuation, la bille s'y enfonce
        const { x, y } = b.position, [tl, th] = GEO.apron.trou, ey = GEO.apron.front - 2 - th;
        const trou = Math.abs(x - CX) < tl / 2 && y > ey ? -Math.min(BALL_R, (y - ey) * 0.5) : 0;
        views.push([x, y, fp.mode === 'saucer' ? -7 : Math.min(b.hauteur ?? 0, 200) + trou, b.rotation]);
      }
    }
    while (this.balls.length < views.length) {
      const m = new THREE.Mesh(this.ballGeo, this.mat.steel);
      m.castShadow = true;
      this.table.add(m);
      this.balls.push(m);
    }
    this.balls.forEach((m, i) => {
      const v = views[i];
      m.visible = !!v;
      if (v) m.position.set(v[0], v[1], -(BALL_R + v[2]));
      if (v && v[3]) m.quaternion.set(v[3].x, v[3].y, v[3].z, v[3].w);   // la bille roule (reflets qui tournent)
    });

    if (this.envDirty) { this.envDirty = false; this.captureEnv(); }
    if (this.tour) this.updateTour();
    this.gl.render(this.scene, this.camera);
    this.drawOverlay();
  }

  // points flottants et Fanny, dessinés à plat par-dessus la scène
  drawOverlay() {
    const g = this.octx, cw = this.overlay.width, ch = this.overlay.height, k = this.dpr;
    g.clearRect(0, 0, cw, ch);
    const tnow = performance.now();
    this.popups = this.popups.filter((p) => tnow - p.t < 900);
    g.textAlign = 'center';
    for (const p of this.popups) {
      const t = (tnow - p.t) / 900;
      const [x, y] = this.toScreen(p.x, p.y, 40);
      g.globalAlpha = 1 - t;
      g.font = `bold ${16 * k}px system-ui, sans-serif`;
      g.lineWidth = 3 * k; g.strokeStyle = '#2b1a10';
      g.strokeText(p.text, x, y - t * 40 * k);
      g.fillStyle = '#fff6c8';
      g.fillText(p.text, x, y - t * 40 * k);
    }
    g.globalAlpha = 1;
    const f = this.fannyShow, img = f && this.art[f.kind];
    if (!img) return;
    const t = (tnow - f.t) / f.ms;
    if (t >= 1) { this.fannyShow = null; return; }
    const h = ch * 0.42, w = (img.width / img.height) * h;
    const rise = Math.min(1, t * 6, (1 - t) * 6);
    const ease = 1 - (1 - rise) ** 3;
    g.save();
    g.globalAlpha = Math.min(1, rise * 1.5);
    g.translate(w / 2, ch + (1 - ease) * h);
    g.rotate(Math.sin(tnow / 160) * 0.03);
    g.drawImage(img, -w / 2, -h, w, h);
    g.restore();
  }
}
