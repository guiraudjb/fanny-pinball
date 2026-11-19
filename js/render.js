// Rendu canvas du plateau. Les lampes sont dessinées depuis LAMP_LAYOUT, dont l'ordre
// est aussi l'ordre des LED sur la bande WS2812B de la réplique (index 0, 1, 2, …).

import { W, H, GEO, BALL_R, CX } from './table.js';
import { CITIES } from './rules.js';

const C = {
  wood: '#2b1a10', gravel: '#d8b679', gravelDark: '#b8935a', line: '#fff4dc',
  chrome: '#d6d9df', chromeDark: '#7c818c', red: '#c8372d', blue: '#1f4e8c', sea: '#174a7c',
  lavender: '#8b6fc0', ochre: '#e0a134', lampOff: 'rgba(40,20,10,0.35)',
};

const PR = GEO.playRight;
const mx = (x) => PR - x;
const RE = GEO.rampEntries[0];
const rampLamp = (k) => [RE.M.x - RE.u.x * k, RE.M.y - RE.u.y * k];
const cityPos = (i) => { const t = (i - 3) / 3; return [CX + t * 88, 655 + t * t * 24]; };

// [nom de lampe, x, y, rayon, couleur, étiquette] — l'ordre = index des LED WS2812B
export const LAMP_LAYOUT = [
  ...GEO.lanes.map((l, i) => [`lane${i}`, l.x, 168, 10, '#ffd23f', l.letter]),
  ...GEO.drops.map((d, i) => [`drop${i}`, d.x + GEO.dropBank.n.x * 24, d.y + GEO.dropBank.n.y * 24, 9, '#4fc3ff', d.letter]),
  ['multiball', GEO.saucer.x, GEO.saucer.y + 42, 10, '#ff3fa4', ''],
  ['ramp', ...rampLamp(24), 10, '#7dff6a', ''],
  ['jackpot', ...rampLamp(50), 8, '#ffe14d', ''],
  ...CITIES.map((_, i) => [`city${i}`, ...cityPos(i), 8, '#ffffff', '']),
  ['mult2', CX - 45, 845, 9, '#ffb13d', '2'],
  ['mult3', CX - 15, 845, 9, '#ffb13d', '3'],
  ['mult4', CX + 15, 845, 9, '#ffb13d', '4'],
  ['mult5', CX + 45, 845, 9, '#ffb13d', '5'],
  ['extra', CX, 812, 9, '#ff5252', ''],
  ['save', CX, 990, 8, '#62ffda', ''],
  ['carreau', CX, 420, 9, '#ff4a3d', ''],
  ['bouchon', GEO.bouchonLane.M.x + GEO.bouchonLane.u.x * 34, GEO.bouchonLane.M.y + GEO.bouchonLane.u.y * 34, 8, '#ffd23f', ''],
  ['point', 82, 560, 7, '#7dff6a', ''],
  ...GEO.leftTargets.map((t, i) => [`cible${i}`, t.x + 26, t.y, 6, '#ff3fa4', '']),
];

export class Renderer {
  constructor(canvas, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sim = sim;
    this.art = {};
    this.bg = this.buildBackground();
    this.popups = [];
    this.fannyShow = null;
    // Illustrations Krea 2 (assets/) : facultatives, le dessin vectoriel sert de repli.
    const load = (key, src, rebuild) => {
      const img = new Image();
      img.onload = () => { this.art[key] = img; if (rebuild) this.bg = this.buildBackground(); };
      img.src = src;
    };
    load('plateau', 'assets/plateau.jpg', true);
    load('bumper', 'assets/bumper.png');
    load('rampe', 'assets/rampe.jpg');
    load('sling', 'assets/lance_pierre.jpg');
    load('victoire', 'assets/fanny_victoire.png');
    load('lancer', 'assets/fanny_lancer.png');
  }

  // Fanny surgit en bas à gauche du plateau (jackpot, multiball…)
  fanny(kind = 'victoire', ms = 2200) { this.fannyShow = { kind, t: performance.now(), ms }; }

  popup(x, y, text) { this.popups.push({ x, y, text, t: performance.now() }); }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.scale = (cw / W) * dpr;
  }

  // ------------------------------------------------------------ fond statique
  buildBackground() {
    const S = 2;
    const cv = document.createElement('canvas');
    cv.width = W * S; cv.height = H * S;
    const g = cv.getContext('2d');
    g.scale(S, S);

    g.fillStyle = C.wood;
    g.fillRect(0, 0, W, H);

    // forme du plateau
    const { cx, cy, rx, ry } = GEO.ellipse;
    const shape = new Path2D();
    shape.moveTo(0, H);
    shape.lineTo(0, cy);
    shape.ellipse(cx, cy, rx, ry, 0, Math.PI, Math.PI * 2);
    shape.lineTo(W, H);
    shape.closePath();

    g.save();
    g.clip(shape);
    const art = this.art && this.art.plateau;
    if (art) this.paintArt(g, art);
    else {
    // terrain de boules (gravier)
    g.fillStyle = C.gravel;
    g.fillRect(0, 0, W, H);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 9000; i++) {
      const x = rnd() * W, y = rnd() * H, r = 0.6 + rnd() * 1.6;
      g.fillStyle = rnd() < 0.55 ? C.gravelDark : '#efd7a5';
      g.globalAlpha = 0.35 + rnd() * 0.4;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;

    // couloir de lancement
    g.fillStyle = 'rgba(30,15,5,0.35)';
    g.fillRect(PR + 4, GEO.laneSep.y1, W - PR - 4, H);

    // la Méditerranée en bas
    const grad = g.createLinearGradient(0, 880, 0, H);
    grad.addColorStop(0, 'rgba(23,74,124,0)');
    grad.addColorStop(1, 'rgba(23,74,124,0.85)');
    g.fillStyle = grad;
    g.fillRect(0, 880, PR, H - 880);

    // bandes provençales sur les côtés
    g.fillStyle = 'rgba(139,111,192,0.18)';
    g.fillRect(0, 210, 36, 650);
    g.fillRect(PR - 36, 210, 36, 650);
    }

    // cercle de lancer peint autour du Cercle (verrou)
    g.strokeStyle = C.line; g.lineWidth = 3; g.setLineDash([]);
    g.beginPath(); g.arc(GEO.saucer.x, GEO.saucer.y, 30, 0, Math.PI * 2); g.stroke();
    g.font = 'bold 11px system-ui, sans-serif'; g.fillStyle = C.line; g.textAlign = 'center';
    g.strokeStyle = '#2b1a10'; g.lineWidth = 3;
    g.strokeText('LE CERCLE', GEO.saucer.x, GEO.saucer.y - 38);
    g.fillText('LE CERCLE', GEO.saucer.x, GEO.saucer.y - 38);

    // logo central (seulement sans illustration)
    if (!art) {
    g.save();
    g.translate(CX, 768);
    g.rotate(-0.06);
    g.font = 'italic 900 46px Georgia, serif';
    g.lineWidth = 6; g.strokeStyle = C.blue; g.strokeText('Fanny', 0, 0);
    g.fillStyle = C.ochre; g.fillText('Fanny', 0, 0);
    g.font = 'bold 13px system-ui, sans-serif';
    g.fillStyle = C.blue; g.fillText('PÉTANQUE WORLD TOUR', 0, 22);
    g.restore();
    }

    // étiquettes peintes
    g.font = 'bold 10px system-ui, sans-serif';
    g.fillStyle = art ? '#fff6d0' : '#5a3a1a';
    g.strokeStyle = '#2b1a10'; g.lineWidth = 3; g.lineJoin = 'round';
    const label = (t, x, y) => { if (art) g.strokeText(t, x, y); g.fillText(t, x, y); };
    GEO.standups.forEach((s) => { if (s.id !== 'bouchon') label(s.label, s.x, s.y + 28); });
    label('CARREAU', CX, 404);
    {
      const L = GEO.bouchonLane, m = { x: L.M.x + L.u.x * 56, y: L.M.y + L.u.y * 56 };
      g.save(); g.translate(m.x, m.y); g.rotate(Math.atan2(L.u.y, L.u.x) + Math.PI);
      g.font = 'bold 8px system-ui, sans-serif'; label('BOUCHON', 0, 3); g.restore();
    }
    label('JACKPOT', ...rampLamp(72));
    label('MULTIBALL', GEO.saucer.x, GEO.saucer.y + 62);
    label('BONUS ×', CX, 868);
    label('REJOUE', CX, 830);
    CITIES.forEach((name, i) => {
      const [x, y] = cityPos(i);
      g.save();
      g.translate(x, y + 18);
      g.font = 'bold 7px system-ui, sans-serif';
      label(name.split(' ')[0].slice(0, 6), 0, 0);
      g.restore();
    });
    g.restore();

    // bord du plateau
    g.strokeStyle = C.chromeDark; g.lineWidth = 3; g.stroke(shape);
    return cv;
  }

  // Illustration du plateau recadrée pour couvrir la surface de jeu, voilée légèrement,
  // avec une pastille sombre sous chaque lampe pour qu'elle se détache (comme un insert).
  paintArt(g, img) {
    // zoom calé en haut : Fanny descend sous le Cercle, le bas de l'image passe sous le tablier
    const k = Math.max(W / img.width, H / img.height) * 1.25;
    const w = img.width * k, h = img.height * k;
    g.drawImage(img, (W - w) / 2, 0, w, h);
    g.fillStyle = 'rgba(20,10,0,0.10)';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(25,12,4,0.5)';
    for (const [, x, y, r] of LAMP_LAYOUT) { g.beginPath(); g.arc(x, y, r + 3, 0, Math.PI * 2); g.fill(); }
  }

  // ------------------------------------------------------------ image
  draw(rules) {
    const ctx = this.ctx, s = this.scale, sim = this.sim, T = sim.T;
    const now = sim.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);

    // lampes
    const lamps = rules.lamps();
    const blinkOn = Math.floor(performance.now() / 220) % 2 === 0;
    for (const [name, x, y, r, col, label] of LAMP_LAYOUT) {
      const st = lamps[name] || 0;
      const lit = st === 1 || (st === 2 && blinkOn);
      if (lit) {
        const gl = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
        gl.addColorStop(0, col); gl.addColorStop(0.45, col + 'aa'); gl.addColorStop(1, col + '00');
        ctx.fillStyle = gl;
        ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = lit ? col : C.lampOff;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
      if (label) {
        ctx.fillStyle = lit ? '#2b1a10' : 'rgba(255,255,255,0.7)';
        ctx.font = `bold ${r * 1.2}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y + 0.5);
      }
    }
    ctx.textBaseline = 'alphabetic';

    // murs et poteaux
    for (const b of T.walls) {
      if (b.plugin && b.plugin.hidden) continue;
      if (b.plugin && b.plugin.housing) this.poly(b.vertices, C.blue, '#0f2a50', 2);
      else this.poly(b.vertices, C.chrome, C.chromeDark);
    }
    // portillon
    this.poly(T.gate.vertices, '#9aa0aa', '#555');

    // lance-pierres
    T.slings.forEach((b, i) => {
      const hit = now - (sim.flash[`sling${i}`] ?? -1e9) < 90;
      if (this.art.sling) this.decal(b.vertices, this.art.sling, i === 1, hit);
      else this.poly(b.vertices, hit ? '#fff3a0' : C.lavender, '#3d2a63');
      const { A, C: Cc } = b.plugin;
      ctx.strokeStyle = hit ? '#fff' : '#f4f4f4'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(Cc[0], Cc[1]); ctx.stroke();
    });

    // cibles tombantes
    T.drops.forEach((b, i) => {
      const d = GEO.drops[i];
      if (sim.dropsUp[i]) {
        this.poly(b.vertices, '#f7f2e8', '#1f4e8c');
        ctx.fillStyle = C.blue; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(d.letter, d.x, d.y + 3.5);
      } else { // cible tombée : seule la fente reste visible
        ctx.save();
        ctx.translate(d.x, d.y); ctx.rotate(d.angle);
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(-d.w / 2, -1.5, d.w, 3);
        ctx.restore();
      }
    });

    // cibles rondes du mur gauche (faces rondes à fleur de la paroi)
    (T.leftTargets || []).forEach((b, i) => {
      const t = GEO.leftTargets[i];
      const hit = now - (sim.flash[`target${i}`] ?? -1e9) < 150;
      const lit = (lamps[`cible${i}`] || 0) > 0;
      ctx.fillStyle = hit ? '#fff6c0' : lit ? '#ff3fa4' : '#f7f2e8';
      ctx.strokeStyle = '#1f4e8c'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(t.x - 2, t.y, t.r, -Math.PI / 2, Math.PI / 2); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1f4e8c'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), t.x + 3, t.y + 3.5);
    });

    // cibles fixes (cochonnets)
    T.standups.forEach((b, i) => {
      const hit = now - (sim.flash[`standup${i}`] ?? -1e9) < 120;
      const jack = b.plugin.id === 'bouchon'; // le cochonnet : bois peint en rouge
      this.boule(b.position.x, b.position.y, b.circleRadius, hit ? '#ffe08a' : jack ? '#e8392c' : '#d9822b',
        jack ? '#7a120c' : '#7a3c0e', false);
    });

    // le Cercle (trou)
    ctx.fillStyle = '#120a05';
    ctx.beginPath(); ctx.arc(GEO.saucer.x, GEO.saucer.y, GEO.saucer.ring, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.chrome; ctx.lineWidth = 3; ctx.stroke();

    // bumpers = boules de pétanque
    T.bumpers.forEach((b, i) => {
      const hit = now - (sim.flash[`bumper${i}`] ?? -1e9) < 100;
      if (hit) {
        ctx.fillStyle = 'rgba(255,240,150,0.6)';
        ctx.beginPath(); ctx.arc(b.position.x, b.position.y, b.circleRadius + 8, 0, Math.PI * 2); ctx.fill();
      }
      if (this.art.bumper) {
        const r = b.plugin.cap || b.circleRadius, x = b.position.x, y = b.position.y;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.arc(x + 3, y + 4, r, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        ctx.translate(x, y); ctx.rotate(i * 2.1 + (hit ? 0.15 : 0));
        ctx.drawImage(this.art.bumper, -r, -r, 2 * r, 2 * r);
        ctx.restore();
        ctx.strokeStyle = hit ? '#fff6a0' : C.chrome; ctx.lineWidth = hit ? 4 : 2.5;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      } else this.boule(b.position.x, b.position.y, b.plugin.cap || b.circleRadius, hit ? '#fffbe6' : '#c7ccd4', '#4c535e', true);
    });

    // flippers
    for (const fl of T.flippers) {
      this.poly(fl.body.vertices, '#fbfbf8', C.red, 3);
      ctx.fillStyle = C.red;
      ctx.beginPath(); ctx.arc(fl.def.px, fl.def.py, 4, 0, Math.PI * 2); ctx.fill();
    }

    // lanceur
    const P = GEO.plunger;
    const kick = now - (sim.flash.plunger ?? -1e9) < 120 ? -14 : 0;
    ctx.fillStyle = '#8c929c';
    ctx.fillRect(P.x - 12, P.top + kick, 24, 8);
    ctx.fillStyle = '#5c616a';
    ctx.fillRect(P.x - 3, P.top + 8 + kick, 6, 30);

    const views = sim.ballViews();
    for (const v of views) if (!v.onRamp) this.ball(v.x, v.y, v.inSaucer ? 0.85 : 1);

    this.apron(lamps, blinkOn);

    // rampes (au-dessus du plateau)
    for (const side of Object.keys(sim.ramps)) this.ramp(sim.ramps[side], now - (sim.flash[`ramp${side}`] ?? -1e9) < 300);
    for (const v of views) if (v.onRamp) this.ball(v.x, v.y, 1.12, true);

    // points flottants
    const tnow = performance.now();
    this.popups = this.popups.filter((p) => tnow - p.t < 900);
    ctx.textAlign = 'center';
    for (const p of this.popups) {
      const k = (tnow - p.t) / 900;
      ctx.globalAlpha = 1 - k;
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.lineWidth = 3; ctx.strokeStyle = '#2b1a10';
      ctx.strokeText(p.text, p.x, p.y - k * 30);
      ctx.fillStyle = '#fff6c8';
      ctx.fillText(p.text, p.x, p.y - k * 30);
    }
    ctx.globalAlpha = 1;
    this.drawFanny(tnow);
  }

  drawFanny(tnow) {
    const f = this.fannyShow, img = f && this.art[f.kind];
    if (!img) return;
    const k = (tnow - f.t) / f.ms;
    if (k >= 1) { this.fannyShow = null; return; }
    const ctx = this.ctx;
    const h = 330, w = (img.width / img.height) * h;
    const rise = Math.min(1, k * 6, (1 - k) * 6);          // monte, reste, redescend
    const ease = 1 - (1 - rise) ** 3;
    ctx.save();
    ctx.globalAlpha = Math.min(1, rise * 1.5);
    ctx.translate(w / 2 - 20, H - 70 + (1 - ease) * h);
    ctx.rotate(Math.sin(tnow / 160) * 0.03);
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
  }

  // Tablier (« apron ») sous les flippers : cache l'évacuation, porte la carte d'instructions.
  apron(lamps, blinkOn) {
    const ctx = this.ctx, top = 968, pr = PR;
    ctx.beginPath();
    ctx.moveTo(0, H); ctx.lineTo(0, top + 20);
    ctx.quadraticCurveTo(CX - 120, top - 6, CX - 40, top);
    ctx.lineTo(CX + 40, top);
    ctx.quadraticCurveTo(CX + 120, top - 6, pr, top + 20);
    ctx.lineTo(pr, H); ctx.closePath();
    const g = ctx.createLinearGradient(0, top, 0, H);
    g.addColorStop(0, '#2c4f86'); g.addColorStop(1, '#16294a');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = C.chrome; ctx.lineWidth = 3; ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f6e9d2'; ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.fillText('F-A-N-N-Y ALLUME LE CERCLE · LE CERCLE = MULTIBALL', CX, 1024);
    ctx.fillText('RAMPE = ESCALE · JACKPOT EN MULTIBALL · T-O-U-R = BONUS ×', CX, 1040);
    const save = LAMP_LAYOUT.find((e) => e[0] === 'save');
    const st = lamps.save || 0;
    const lit = st === 1 || (st === 2 && blinkOn);
    ctx.fillStyle = lit ? save[4] : 'rgba(255,255,255,0.15)';
    ctx.beginPath(); ctx.arc(save[1], save[2], save[3], 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f6e9d2'; ctx.font = 'bold 8px system-ui, sans-serif';
    ctx.fillText('FANNY TE LA REND', CX, save[2] + 20);
  }

  // Plastique décoré découpé à la forme d'un corps (lance-pierres) ; miroir pour le côté droit.
  decal(verts, img, mirror, hit) {
    const ctx = this.ctx;
    const xs = verts.map((v) => v.x), ys = verts.map((v) => v.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    ctx.save();
    ctx.beginPath();
    verts.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
    ctx.closePath();
    ctx.clip();
    const w = x1 - x0, h = y1 - y0, k = Math.max(w / img.width, h / img.height);
    ctx.translate((x0 + x1) / 2, (y0 + y1) / 2);
    if (mirror) ctx.scale(-1, 1);
    ctx.drawImage(img, -img.width * k / 2, -img.height * k / 2, img.width * k, img.height * k);
    if (hit) { ctx.fillStyle = 'rgba(255,246,190,0.55)'; ctx.fillRect(-w, -h, 2 * w, 2 * h); }
    ctx.restore();
    ctx.beginPath();
    verts.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
    ctx.closePath();
    ctx.strokeStyle = '#2b1a10'; ctx.lineWidth = 2; ctx.stroke();
  }

  poly(verts, fill, stroke, lw = 1.5) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke();
  }

  boule(x, y, r, light, dark, grooves) {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, light); g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (grooves) { // stries de boule de pétanque
      ctx.strokeStyle = 'rgba(40,45,55,0.55)'; ctx.lineWidth = 1.5;
      for (const k of [-0.45, 0, 0.45]) {
        ctx.beginPath(); ctx.ellipse(x, y, r * 0.98, r * 0.32, 0.5 + k, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  ball(x, y, k = 1, shadow = false) {
    const ctx = this.ctx, r = BALL_R * k;
    if (shadow) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.arc(x + 5, y + 7, r, 0, Math.PI * 2); ctx.fill();
    }
    const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#c9ced8'); g.addColorStop(1, '#3d434d');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  ramp(path, hit) {
    const ctx = this.ctx, pts = path.pts;
    const off = BALL_R + 6;
    const side = (sign) => pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
      return { x: p.x - (dy / l) * off * sign, y: p.y + (dx / l) * off * sign };
    });
    const l = side(1), r = side(-1);
    ctx.beginPath();
    l.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    [...r].reverse().forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    if (this.art.rampe) {
      if (!this.rampPattern) {
        this.rampPattern = ctx.createPattern(this.art.rampe, 'repeat');
        const k = (2 * off) / this.art.rampe.height;
        this.rampPattern.setTransform(new DOMMatrix().scale(k, k));
      }
      ctx.save(); ctx.clip();
      ctx.globalAlpha = 0.92; ctx.fillStyle = this.rampPattern; ctx.fillRect(0, 0, W, H);
      if (hit) { ctx.globalAlpha = 0.45; ctx.fillStyle = '#fff6c0'; ctx.fillRect(0, 0, W, H); }
      ctx.restore();
    } else {
      ctx.fillStyle = hit ? 'rgba(255,240,170,0.45)' : 'rgba(170,220,255,0.28)';
      ctx.fill();
    }
    ctx.strokeStyle = hit ? '#fff' : 'rgba(225,235,245,0.95)';
    ctx.lineWidth = 2.5;
    for (const rail of [l, r]) {
      ctx.beginPath();
      rail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
    ctx.lineWidth = 1.2;
    for (let i = 0; i < pts.length; i += 5) {
      ctx.beginPath(); ctx.moveTo(l[i].x, l[i].y); ctx.lineTo(r[i].x, r[i].y); ctx.stroke();
    }
  }
}
