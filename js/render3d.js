// Vue 3D du plateau (Three.js, chargé à la demande). La physique reste celle de sim.js (2D + rampe) :
// cette vue ne fait que dessiner. Le plateau peint (illustration, lampes, Cercle, tablier) est dessiné
// par le moteur 2D dans une image qui sert de texture ; tout ce qui dépasse du plateau est en volume.
//
// Repère « table » (groupe this.table) : x vers la droite, y vers le joueur, z = −hauteur (mm),
// exactement les coordonnées du jeu. Le groupe est incliné de la pente du plateau.

import * as THREE from '../vendor/three.module.min.js';
import { W, H, GEO, BALL_R, pointAt } from './table.js';
import { Renderer } from './render.js';

const PENTE = (6.5 * Math.PI) / 180;      // pente du plateau (cao/cotes.py)
const H_PAROI = 32;                        // parois et guides imprimés
const RAMPE = { z: 62, pente: Math.tan((14 * Math.PI) / 180), desc: 300, larg: 39, flanc: 25 };
const TEX = 2;                             // résolution des textures peintes (px par mm)
const APRON_Y = 975;                       // au-delà, la bille est sous le tablier

// hauteur du fond de rampe à l'abscisse curviligne s (même profil que cao/modele.py)
function zRampe(s, L) {
  const montee = Math.min(RAMPE.z, s * RAMPE.pente);
  if (s > L - RAMPE.desc) return Math.max(3, Math.min(montee, (RAMPE.z * (L - s)) / RAMPE.desc + 3));
  return montee;
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
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#170d07');
    this.camera = new THREE.PerspectiveCamera(34, 0.7, 10, 6000);

    // plateau incliné, puis repère de la table
    this.tilt = new THREE.Group();
    this.tilt.rotation.x = PENTE;
    this.scene.add(this.tilt);
    this.table = new THREE.Group();
    this.table.rotation.x = Math.PI / 2;       // (x, y, z) → (x, −z, y)
    this.table.position.set(-W / 2, 0, -H / 2);
    this.tilt.add(this.table);

    this.buildLights();
    this.buildMaterials();
    this.buildFloor();
    this.buildCabinet();
    this.buildStatic();
    this.buildMoving();
    this.buildRamp();

    this.raycaster = new THREE.Raycaster();
    this.lastFloorKey = '';
  }

  // ------------------------------------------------------------ lumière et matières
  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff1dc, 0x2a1a10, 0.9));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    sun.position.set(-260, 900, 420);
    sun.target.position.set(0, 0, -60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -420, right: 420, top: 700, bottom: -700, near: 100, far: 2400 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.5);
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
      redRubber: new THREE.MeshStandardMaterial({ color: 0xd8342a, roughness: 0.6 }),
      flipper: new THREE.MeshStandardMaterial({ color: 0xfbfbf8, roughness: 0.35 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x4a2c18, roughness: 0.7 }),
      woodDark: new THREE.MeshStandardMaterial({ color: 0x2b1a10, roughness: 0.8 }),
      plasticSide: new THREE.MeshStandardMaterial({ color: 0x3f3a7c, roughness: 0.4 }),
      gate: new THREE.MeshStandardMaterial({ color: 0x9aa0aa, metalness: 0.8, roughness: 0.35 }),
      rampe: new THREE.MeshPhysicalMaterial({ color: 0xcde8ff, roughness: 0.08, transmission: 0, transparent: true,
        opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }),
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
    this.floor = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.floorTex, roughness: 0.55, metalness: 0 }));
    this.floor.receiveShadow = true;
    this.table.add(this.floor);
  }

  // caisse en bois autour du plateau et barre de verrouillage
  buildCabinet() {
    const box = (x0, y0, x1, y1, z0, z1, m) => {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, -(z0 + z1) / 2);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.table.add(mesh);
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
    this.table.add(extrude(pts, 40, this.mat.wood));
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
    T.slings.forEach((b) => pr.plastic(b.vertices.map((v) => [v.x, v.y]), 5));
    const tex = canvasTexture(cv);
    tex.repeat.set(1 / W, -1 / H);
    tex.offset.set(0, 1);
    const plasticTop = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3 });
    const plasticMat = [plasticTop, this.mat.plasticSide];

    for (const p of plastics) this.table.add(extrude(p, H_PAROI, plasticMat));

    // parois et poteaux
    for (const b of T.walls) {
      if (b.plugin && (b.plugin.hidden || b.plugin.housing)) continue;
      if (b.circleRadius) {
        this.table.add(cylinder(b.circleRadius, H_PAROI + 4, this.mat.chrome, b.position.x, b.position.y));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(b.circleRadius + 1.5, 2.2, 10, 28), this.mat.rubber);
        ring.position.set(b.position.x, b.position.y, -14);
        ring.castShadow = true;
        this.table.add(ring);
      } else {
        this.table.add(extrude(b.vertices.map((v) => [v.x, v.y]), H_PAROI, this.mat.chrome));
      }
    }
    // portillon du couloir de lancement
    this.table.add(extrude(T.gate.vertices.map((v) => [v.x, v.y]), 22, this.mat.gate));

    // lance-pierres : plastique + caoutchouc blanc tendu sur la face, butoir rouge au milieu
    this.slings = T.slings.map((b) => {
      this.table.add(extrude(b.vertices.map((v) => [v.x, v.y]), H_PAROI - 6, plasticMat));
      const { A, C } = b.plugin;
      const l = Math.hypot(C[0] - A[0], C[1] - A[1]);
      const band = new THREE.Mesh(new THREE.BoxGeometry(l, 3, 14), this.mat.rubber.clone());
      band.position.set((A[0] + C[0]) / 2 + b.plugin.n.x * 1.5, (A[1] + C[1]) / 2 + b.plugin.n.y * 1.5, -12);
      band.rotation.z = Math.atan2(C[1] - A[1], C[0] - A[0]);
      band.castShadow = true;
      this.table.add(band);
      for (const p of [A, C]) this.table.add(cylinder(3.5, H_PAROI + 2, this.mat.chrome, p[0], p[1]));
      return band;
    });

    // bumpers : jupe chromée + chapeau peint (même dessin que la vue 2D)
    this.bumpers = T.bumpers.map((b, i) => {
      const cap = b.plugin.cap || b.circleRadius;
      const paint = (hit) => {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const g = c.getContext('2d');
        g.setTransform(256 / (2 * cap), 0, 0, 256 / (2 * cap), 0, 0);
        Renderer.prototype.popBumper.call({ ctx: g, boule: Renderer.prototype.boule }, cap, cap, cap, hit, i);
        return canvasTexture(c);
      };
      const tex = [paint(false), paint(true)];
      const base = cylinder(b.circleRadius, 26, this.mat.chrome, b.position.x, b.position.y, 0, 40);
      const topMat = new THREE.MeshStandardMaterial({ map: tex[0], roughness: 0.25, emissive: 0xffe08a, emissiveIntensity: 0 });
      const sideMat = new THREE.MeshStandardMaterial({ color: 0x5b4fa0, roughness: 0.3, transparent: true, opacity: 0.92 });
      const capGeo = new THREE.CylinderGeometry(cap, cap * 0.96, 9, 48);
      capGeo.rotateX(-Math.PI / 2);
      const capMesh = new THREE.Mesh(capGeo, [sideMat, topMat, sideMat]);
      capMesh.position.set(b.position.x, b.position.y, -(26 + 4.5));
      capMesh.castShadow = true;
      this.table.add(base, capMesh);
      return { topMat, tex };
    });

    // cibles fixes (cochonnets en bois peint)
    T.standups.forEach((b) => {
      const jack = b.plugin.id === 'bouchon';
      const m = new THREE.Mesh(new THREE.SphereGeometry(b.circleRadius, 24, 16),
        new THREE.MeshStandardMaterial({ color: jack ? 0xe8392c : 0xd9822b, roughness: 0.45 }));
      m.position.set(b.position.x, b.position.y, -b.circleRadius);
      m.castShadow = true;
      this.table.add(m);
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
      return face;
    });
  }

  // ------------------------------------------------------------ pièces mobiles
  buildMoving() {
    const T = this.sim.T;
    // flippers : contour du corps Matter.js autour de l'axe, tourné à chaque image
    this.flippers = T.flippers.map((fl) => {
      const { px, py } = fl.def;
      const pts = fl.body.vertices.map((v) => [v.x - px, v.y - py]);
      const m = extrude(pts, 20, [this.mat.flipper, this.mat.redRubber], 3);
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
      const mat = new THREE.MeshStandardMaterial({ map: canvasTexture(c), roughness: 0.4 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, 30), mat);
      m.position.set(d.x, d.y, -15);
      m.rotation.z = d.angle;
      m.castShadow = true;
      this.table.add(m);
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

  // rampe : fond transparent, flancs, rails chromés, poteaux de support
  buildRamp() {
    const path = this.sim.ramps.L;
    if (!path) return;
    this.rampPath = path;
    const L = path.length, half = RAMPE.larg / 2;
    const pos = [], idx = [];
    const rails = [[], []];
    const pts = path.pts;
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l, z = zRampe(p.s, L);
      for (const [k, sg] of [[0, 1], [1, -1]]) {
        const x = p.x + nx * half * sg, y = p.y + ny * half * sg;
        pos.push(x, y, -z, x, y, -(z + RAMPE.flanc));
        rails[k].push(new THREE.Vector3(x, y, -(z + RAMPE.flanc)));
      }
    });
    // sommets par point : [g bas, g haut, d bas, d haut]
    for (let i = 0; i < pts.length - 1; i++) {
      const o = i * 4, n = o + 4;
      idx.push(o, n, o + 2, n, n + 2, o + 2);          // fond
      idx.push(o, o + 1, n, o + 1, n + 1, n);            // flanc gauche
      idx.push(o + 2, n + 2, o + 3, n + 2, n + 3, o + 3); // flanc droit
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.rampMat = this.mat.rampe;
    const mesh = new THREE.Mesh(geo, this.rampMat);
    mesh.renderOrder = 2;
    this.table.add(mesh);
    for (const r of rails) {
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(r), r.length * 2, 2, 8), this.mat.chrome);
      tube.castShadow = true;
      this.table.add(tube);
    }
    for (let s = 140; s < L - 40; s += 140) {
      const z = zRampe(s, L);
      if (z < 20) continue;
      const p = pointAt(path, s);
      this.table.add(cylinder(3, z, this.mat.chrome, p.x, p.y, 0, 12));
    }
  }

  // ------------------------------------------------------------ interface commune avec Renderer
  fanny(kind = 'victoire', ms = 2200) { this.fannyShow = { kind, t: performance.now(), ms }; }

  popup(x, y, text) { this.popups.push({ x, y, text, t: performance.now() }); }

  resize(cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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

  // caméra à la place du joueur : on recule jusqu'à voir toute la table
  fitCamera() {
    const cam = this.camera, elev = (42 * Math.PI) / 180;
    cam.clearViewOffset();
    this.scene.updateMatrixWorld(true);
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
    let lo = 300, hi = 6000;
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
    const lamps = rules.lamps();
    const blinkOn = Math.floor(performance.now() / 220) % 2 === 0;

    // texture du plateau : redessinée seulement quand une lampe change
    const key = Object.entries(lamps).map(([k, v]) => (v === 2 ? (blinkOn ? 1 : 0) : v) ? k : '').join(',');
    if (key !== this.lastFloorKey || this.floorR.bg !== this.lastBg) {   // bg change quand l'illustration arrive
      this.lastFloorKey = key;
      this.lastBg = this.floorR.bg;
      this.floorR.drawFloor(lamps, blinkOn);
      this.floorR.apron(lamps, blinkOn);
      this.floorTex.needsUpdate = true;
    }

    for (const f of this.flippers) f.mesh.rotation.z = f.fl.angle - f.a0;
    this.drops.forEach((m, i) => { m.visible = sim.dropsUp[i]; });
    this.bumpers.forEach((b, i) => {
      const hit = now - (sim.flash[`bumper${i}`] ?? -1e9) < 100;
      const want = b.tex[hit ? 1 : 0];
      if (b.topMat.map !== want) { b.topMat.map = want; b.topMat.emissiveIntensity = hit ? 0.35 : 0; b.topMat.needsUpdate = true; }
    });
    this.slings.forEach((band, i) => {
      const hit = now - (sim.flash[`sling${i}`] ?? -1e9) < 90;
      band.material.emissive.setHex(hit ? 0xffd23f : 0x000000);
    });
    this.leftTargets.forEach((face, i) => {
      const hit = now - (sim.flash[`target${i}`] ?? -1e9) < 150;
      face.emissiveIntensity = hit ? 0.9 : (lamps[`cible${i}`] || 0) > 0 ? 0.5 : 0;
    });
    const rampHit = now - (sim.flash.rampL ?? -1e9) < 300;
    this.rampMat.color.setHex(rampHit ? 0xfff0aa : 0xcde8ff);
    const kick = now - (sim.flash.plunger ?? -1e9) < 120 ? -14 : 0;
    this.plunger.position.y = GEO.plunger.top + 4 + kick;

    // billes
    const views = [];
    for (const b of sim.balls) {
      const fp = b.plugin.fp;
      if (fp.mode === 'gone') continue;
      if (fp.mode === 'ramp') {
        const path = sim.ramps[fp.ramp], p = pointAt(path, fp.s);
        views.push([p.x, p.y, zRampe(fp.s, path.length) + 2]);
      } else if (b.position.y < APRON_Y) {
        views.push([b.position.x, b.position.y, fp.mode === 'saucer' ? -7 : 0]);
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
    });

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
