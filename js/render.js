// Rendu canvas du plateau. Les lampes sont dessinées depuis LAMP_LAYOUT, dont l'ordre
// est aussi l'ordre des LED sur la bande WS2812B de la réplique (index 0, 1, 2, …).

import { W, H, GEO, BALL_R, CX, pointAt } from './table.js';
import { CITIES } from './rules.js';

const C = {
  wood: '#2b1a10', gravel: '#d8b679', gravelDark: '#b8935a', line: '#fff4dc',
  chrome: '#d6d9df', chromeDark: '#7c818c', red: '#c8372d', blue: '#1f4e8c', sea: '#174a7c',
  lavender: '#8b6fc0', ochre: '#e0a134',
};

function tintHex(hex, k, lift = 0) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.min(255, Math.max(0, Math.round(v * k + lift)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

// Pastille en plastique coloré opaque encastrée dans le plateau (insert de flipper) :
// masque totalement le graphisme sous-jacent, cerclage noir, léger anneau moulé et reflet brillant.
export function drawLampInsert(ctx, x, y, r, col, label, lit) {
  ctx.fillStyle = '#18110c';
  ctx.beginPath(); ctx.arc(x, y, r + 1.1, 0, Math.PI * 2); ctx.fill();
  const gr = lit
    ? ctx.createRadialGradient(x, y, 0, x, y, r)
    : ctx.createRadialGradient(x - r * 0.22, y - r * 0.22, r * 0.08, x, y, r);
  if (lit) {
    gr.addColorStop(0, tintHex(col, 0.35, 166));
    gr.addColorStop(0.58, col);
    gr.addColorStop(1, tintHex(col, 0.72, 0));
  } else {
    gr.addColorStop(0, tintHex(col, 0.66, 18));
    gr.addColorStop(0.68, tintHex(col, 0.48, 6));
    gr.addColorStop(1, tintHex(col, 0.26, 0));
  }
  ctx.fillStyle = gr;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = lit ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.16)';
  ctx.lineWidth = Math.max(0.6, r * 0.075);
  ctx.beginPath(); ctx.arc(x, y, r * 0.74, 0, Math.PI * 2); ctx.stroke();
  ctx.save();
  ctx.translate(x - r * 0.24, y - r * 0.28);
  ctx.rotate(-0.6);
  ctx.fillStyle = lit ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.24)';
  ctx.beginPath(); ctx.ellipse(0, 0, r * 0.38, r * 0.18, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(0.75, r * 0.085);
  ctx.beginPath(); ctx.arc(x, y, r - 0.25, 0, Math.PI * 2); ctx.stroke();
  if (label) {
    ctx.fillStyle = '#160f0a';
    ctx.font = `bold ${r * (label.length > 1 ? 0.92 : 1.18)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + r * 0.06);
  }
}

// Masque émissif correspondant (vue 3D) : le plastique brille de l'intérieur, le cerclage et les lettres restent noirs.
export function drawLampInsertEmissive(ctx, x, y, r, col, label) {
  const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, tintHex(col, 0.35, 166));
  gr.addColorStop(0.6, col);
  gr.addColorStop(1, tintHex(col, 0.58, 0));
  ctx.fillStyle = gr;
  ctx.beginPath(); ctx.arc(x, y, r - 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.26)';
  ctx.lineWidth = Math.max(0.6, r * 0.075);
  ctx.beginPath(); ctx.arc(x, y, r * 0.74, 0, Math.PI * 2); ctx.stroke();
  if (label) {
    ctx.fillStyle = '#000000';
    ctx.font = `bold ${r * (label.length > 1 ? 0.92 : 1.18)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + r * 0.06);
  }
}

const PR = GEO.playRight;
const mx = (x) => PR - x;
const RE = GEO.rampEntries[0];
const rampLamp = (k) => [RE.M.x - RE.u.x * k, RE.M.y - RE.u.y * k];
// point devant la face d'une cible fixe encastrée (POINTER : lampe, étiquette)
const devant = (id, k) => { const s = GEO.standups.find((c) => c.id === id); return [s.x + s.n.x * k, s.y + s.n.y * k]; };
const TIRER = GEO.standups.find((c) => c.id === 'tirer');
const cityPos = (i) => { const t = (i - 3) / 3; return [CX + t * 88, H - 557 + t * t * 24]; };

// [nom de lampe, x, y, rayon, couleur, étiquette interne, texte enroulé autour]
// L'ordre = index des LED WS2812B. Rayons calés sur les inserts standards de flipper :
// 5/8" (Ø 16, r=8), 3/4" (Ø 19, r=9.5), 7/8" (Ø 22, r=11), 1" (Ø 25, r=12.5).
// Les lettres composant un mot (T-O-U-R, F-A-N-N-Y) restent dans la pastille.
export const LAMP_LAYOUT = [
  ...GEO.lanes.map((l, i) => [`lane${i}`, l.x, l.y + 46, 12.5, '#ffd23f', l.letter]),
  ...GEO.drops.map((d, i) => [`drop${i}`, d.x + GEO.dropBank.n.x * 24, d.y + GEO.dropBank.n.y * 24, 11, '#4fc3ff', d.letter]),
  ['multiball', GEO.saucer.x - 52, GEO.saucer.y, 12.5, '#ff3fa4', '', { text: 'MULTIBALL', side: 'top', size: 7.5 }],
  ['ramp', ...rampLamp(54), 12.5, '#7dff6a', '', { text: 'ESCALE', side: 'top', size: 7.5 }],
  ['jackpot', ...rampLamp(88), 9.5, '#ffe14d', '', { text: 'JACKPOT', side: 'bottom', size: 7.2 }],
  ...CITIES.map((name, i) => [`city${i}`, ...cityPos(i), 9.5, '#ffffff', '', { text: name, side: 'bottom', size: 6.0 }]),
  ['mult2', CX - 48, H - 222, 11, '#ffb13d', '×2', { text: 'BONUS', side: 'bottom', size: 6.6 }],
  ['mult3', CX - 16, H - 222, 11, '#ffb13d', '×3', { text: 'BONUS', side: 'bottom', size: 6.6 }],
  ['mult4', CX + 16, H - 222, 11, '#ffb13d', '×4', { text: 'BONUS', side: 'bottom', size: 6.6 }],
  ['mult5', CX + 48, H - 222, 11, '#ffb13d', '×5', { text: 'BONUS', side: 'bottom', size: 6.6 }],
  ['extra', CX, H - 259, 12.5, '#ff5252', '', { text: 'REJOUE', side: 'top', size: 7.5 }],
  ['save', CX, H - 172, 11, '#62ffda', '', { text: 'SAUVE', side: 'top', size: 7.2 }],
  ['carreau', TIRER.x + 22, TIRER.y + 40, 11, '#ff4a3d', '', { text: 'CARREAU', side: 'bottom', size: 7.5 }],
  ['bouchon', GEO.bouchonLane.M.x + GEO.bouchonLane.u.x * 34, GEO.bouchonLane.M.y + GEO.bouchonLane.u.y * 34, 9.5, '#ffd23f', '', { text: 'BOUCHON', side: 'bottom', size: 6.8 }],
  ['point', ...devant('pointer', 46), 9.5, '#7dff6a', '', { text: 'POINTER', side: 'bottom', size: 7.0 }],
  ...GEO.leftTargets.map((t, i) => [`cible${i}`, t.x + 28, t.y, 8, '#ff3fa4', '', { text: `BOULE ${i + 1}`, side: 'bottom', size: 6.4 }]),
  ['extraLit', GEO.saucer.x - 34, GEO.saucer.y + 30, 9.5, '#ff5252', '', { text: 'EXTRA BALL', side: 'bottom', size: 6.2 }],
];

export { C as COLORS };

// Tablier (« apron ») : plastron noir en V au bas du plateau, même bord avant que ses bras dans le jeu
// (GEO.apron). Il cache le bac et l'autolanceur et porte les cartes d'instructions. Dessiné en 2D par-dessus
// les billes, et peint sur le dessus du tablier de la CAO dans la vue 3D.
function apronPath(ctx) {
  const a = GEO.apron;
  ctx.beginPath();
  ctx.moveTo(0, H); ctx.lineTo(0, a.side);
  ctx.arcTo(CX - a.half, a.front, CX + a.half, a.front, 30);
  ctx.arcTo(CX + a.half, a.front, PR, a.side, 30);
  ctx.lineTo(PR, a.side); ctx.lineTo(PR, a.lane); ctx.lineTo(W, a.lane); ctx.lineTo(W, H);
  ctx.closePath();
}

const APRON_CARDS = [
  { x: 14, titre: 'MULTIBALL TRIPLETTE', lignes: ['F-A-N-N-Y allume LE CERCLE', 'Cercle allumé : 3 billes en jeu',
    'En multiball, la RAMPE = JACKPOT', '3 jackpots : SUPER JACKPOT au Cercle'] },
  { x: 294, titre: 'BONUS · EXTRA BALL', lignes: ['T-O-U-R : bonus ×2, ×3 … ×5', '×5 : EXTRA BALL au Cercle',
    'RAMPE : escale du World Tour', '7 escales : GRAND CHELEM + extra ball'] },
];

export function drawApron(ctx) {
  const a = GEO.apron, y0 = a.front + 6, hc = H - 6 - y0;
  ctx.save();
  // ombre portée sur le plateau, devant la lèvre
  ctx.save(); ctx.translate(0, -3); apronPath(ctx); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill(); ctx.restore();
  apronPath(ctx);
  const g = ctx.createLinearGradient(0, a.side, 0, H);
  g.addColorStop(0, '#2a2a30'); g.addColorStop(0.25, '#141417'); g.addColorStop(1, '#0b0b0d');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.clip();
  // lèvre arrondie : reflet le long du bord avant, filet chromé juste derrière
  ctx.translate(0, 2.5); apronPath(ctx); ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.translate(0, 5); apronPath(ctx); ctx.strokeStyle = '#8d939c'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
  // cartes d'instructions
  for (const c of APRON_CARDS) {
    ctx.fillStyle = '#f3e6c8';
    ctx.beginPath(); ctx.roundRect(c.x, y0, 170, hc, 3); ctx.fill();
    ctx.fillStyle = '#c8342b';
    ctx.beginPath(); ctx.roundRect(c.x, y0, 170, 15, [3, 3, 0, 0]); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff6e0'; ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.fillText(c.titre, c.x + 85, y0 + 8, 160);
    ctx.fillStyle = '#1d140c'; ctx.font = '600 7.2px system-ui, sans-serif';
    c.lignes.forEach((l, i) => ctx.fillText(l, c.x + 85, y0 + 29 + i * 16, 162));
  }
  // centre : renvoi vers la lampe de sauvetage, entre les palettes
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#62ffda'; ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.fillText('▲', CX, y0 + 8);
  ctx.fillStyle = '#f3e6c8'; ctx.font = 'bold 8px system-ui, sans-serif';
  ctx.fillText('FANNY', CX, y0 + 22, 80); ctx.fillText('TE LA REND', CX, y0 + 32, 80);
  ctx.font = '600 6px system-ui, sans-serif';
  ctx.fillText('bille sauvée tant', CX, y0 + 46, 80);
  ctx.fillText('que la lampe brille', CX, y0 + 54, 80);
  ctx.fillStyle = '#e9b44c'; ctx.font = 'bold 6px system-ui, sans-serif';
  ctx.fillText('PÉTANQUE', CX, y0 + 70, 80); ctx.fillText('WORLD TOUR', CX, y0 + 78, 80);
  // couloir de lancement : sortie du lanceur
  ctx.fillStyle = '#e9b44c'; ctx.font = 'bold 6px system-ui, sans-serif';
  ctx.save(); ctx.translate((PR + W) / 2 + 1, (a.lane + H) / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('LANCER ▶', 0, 0); ctx.restore();
  ctx.restore();
}


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
    const grad = g.createLinearGradient(0, H - 187, 0, H);
    grad.addColorStop(0, 'rgba(23,74,124,0)');
    grad.addColorStop(1, 'rgba(23,74,124,0.85)');
    g.fillStyle = grad;
    g.fillRect(0, H - 187, PR, 187);

    // bandes provençales sur les côtés
    g.fillStyle = 'rgba(139,111,192,0.18)';
    g.fillRect(0, GEO.laneSep.y1, 36, H - GEO.laneSep.y1 - 207);
    g.fillRect(PR - 36, GEO.laneSep.y1, 36, H - GEO.laneSep.y1 - 207);
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
    g.translate(CX, H - 299);
    g.rotate(-0.06);
    g.font = 'italic 900 46px Georgia, serif';
    g.lineWidth = 6; g.strokeStyle = C.blue; g.strokeText('Fanny', 0, 0);
    g.fillStyle = C.ochre; g.fillText('Fanny', 0, 0);
    g.font = 'bold 13px system-ui, sans-serif';
    g.fillStyle = C.blue; g.fillText('PÉTANQUE WORLD TOUR', 0, 22);
    g.restore();
    }

    // étiquettes peintes (cibles fixes sans lampe dédiée + textes enroulés autour de chaque pastille lumineuse)
    g.font = 'bold 10px system-ui, sans-serif';
    g.fillStyle = art ? '#fff6d0' : '#5a3a1a';
    g.strokeStyle = '#2b1a10'; g.lineWidth = 3; g.lineJoin = 'round';
    const label = (t, x, y) => { if (art) g.strokeText(t, x, y); g.fillText(t, x, y); };
    GEO.standups.forEach((s) => {
      if (s.id === 'tirer') label(s.label, s.x + 38, s.y + 4);
      else if (s.id !== 'bouchon' && s.id !== 'pointer') label(s.label, ...(s.n ? devant(s.id, 26) : [s.x, s.y + 28]));
    });
    // repère d'entrée du couloir bonus (côté droit, au-dessus de F-A-N-N-Y)
    label('▲', 454, 448);
    g.save(); g.font = 'bold 8px system-ui, sans-serif'; label('BONUS', 454, 462); g.restore();
    const arcText = (text, x, y, R, side, size) => {
      g.save();
      g.font = `bold ${size}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 2.4;
      const chars = [...text], tracking = 0.4;
      const widths = chars.map((ch) => g.measureText(ch).width + tracking);
      const total = widths.reduce((a, b) => a + b, 0) - tracking;
      let pos = 0;
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i], w = widths[i];
        const dAng = (pos + (w - tracking) / 2 - total / 2) / R;
        pos += w;
        if (ch === ' ') continue;
        const a = side === 'top' ? -Math.PI / 2 + dAng : Math.PI / 2 - dAng;
        g.save();
        g.translate(x + Math.cos(a) * R, y + Math.sin(a) * R);
        g.rotate(side === 'top' ? a + Math.PI / 2 : a - Math.PI / 2);
        if (art) g.strokeText(ch, 0, 0);
        g.fillText(ch, 0, 0);
        g.restore();
      }
      g.restore();
    };
    for (const [, x, y, r, , , arc] of LAMP_LAYOUT) {
      if (arc) arcText(arc.text, x, y, r + 2.5 + arc.size * 0.45, arc.side, arc.size);
    }
    g.restore();

    // bord du plateau
    g.strokeStyle = C.chromeDark; g.lineWidth = 3; g.stroke(shape);
    return cv;
  }

  // Illustration du plateau recadrée pour couvrir la surface de jeu, voilée légèrement.
  paintArt(g, img) {
    // zoom calé en haut : Fanny descend sous le Cercle, le bas de l'image passe sous le tablier
    const k = Math.max(W / img.width, H / img.height) * 1.25;
    const w = img.width * k, h = img.height * k;
    g.drawImage(img, (W - w) / 2, 0, w, h);
    g.fillStyle = 'rgba(20,10,0,0.10)';
    g.fillRect(0, 0, W, H);
  }

  // ------------------------------------------------------------ image
  // Ce qui est peint SUR le plateau : illustration, lampes (inserts), trou du Cercle.
  // Sert aussi de texture au plateau de la vue 3D (render3d.js).
  drawFloor(lamps, blinkOn) {
    const ctx = this.ctx, s = this.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    // trou d'évacuation devant la lèvre du tablier (cotes de la CAO)
    const [tl, th] = GEO.apron.trou, ey = GEO.apron.front - 2 - th;
    ctx.beginPath(); ctx.roundRect(CX - tl / 2, ey, tl, th, th / 2 - 1);
    const gt = ctx.createLinearGradient(0, ey, 0, ey + th);
    gt.addColorStop(0, '#000'); gt.addColorStop(1, '#1c1814');
    ctx.fillStyle = gt; ctx.fill();
    ctx.strokeStyle = 'rgba(190,195,205,0.55)'; ctx.lineWidth = 1.2; ctx.stroke();
    for (const [name, x, y, r, col, label] of LAMP_LAYOUT) {
      const st = lamps[name] || 0;
      const lit = st === 1 || (st === 2 && blinkOn);
      if (lit) {
        const gl = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 2.3);
        gl.addColorStop(0, col + 'bb'); gl.addColorStop(0.5, col + '55'); gl.addColorStop(1, col + '00');
        ctx.fillStyle = gl;
        ctx.beginPath(); ctx.arc(x, y, r * 2.3, 0, Math.PI * 2); ctx.fill();
      }
      drawLampInsert(ctx, x, y, r, col, label, lit);
    }
    ctx.textBaseline = 'alphabetic';
    // lumières des fils de rollover : couloirs bonus T-O-U-R et couloirs du bas (cotes CAO : 36 × 4 mm)
    for (const l of [...GEO.lanes, ...(GEO.lowerLanes || [])]) {
      ctx.beginPath();
      ctx.roundRect(l.x - 2, l.y - 18, 4, 36, 2);
      const gr = ctx.createLinearGradient(l.x - 2, 0, l.x + 2, 0);
      gr.addColorStop(0, '#070504'); gr.addColorStop(0.5, '#17110c'); gr.addColorStop(1, '#261b12');
      ctx.fillStyle = gr; ctx.fill();
      ctx.strokeStyle = 'rgba(215,195,160,0.45)'; ctx.lineWidth = 0.7; ctx.stroke();
    }
    // le Cercle (trou)
    ctx.fillStyle = '#120a05';
    ctx.beginPath(); ctx.arc(GEO.saucer.x, GEO.saucer.y, GEO.saucer.ring, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.chrome; ctx.lineWidth = 3; ctx.stroke();
  }

  draw(rules) {
    const ctx = this.ctx, sim = this.sim, T = sim.T;
    const now = sim.time;
    const lamps = rules.lamps();
    const blinkOn = Math.floor(performance.now() / 220) % 2 === 0;
    this.drawFloor(lamps, blinkOn);

    // pièce du bouchon : une seule pièce en U aux coins arrondis
    if (GEO.bouchonPiece) this.plastic(GEO.bouchonPiece, 9);
    if (GEO.tirerPlastic) this.plastic(GEO.tirerPlastic, 6);
    // murs et poteaux
    for (const b of T.walls) {
      if (b.plugin && b.plugin.hidden) continue;
      if (b.plugin && b.plugin.housing) this.plastic(b.vertices.map((v) => [v.x, v.y]), 6);
      else this.poly(b.vertices, C.chrome, C.chromeDark);
    }
    // portillon
    this.poly(T.gate.vertices, '#9aa0aa', '#555');

    // lance-pierres
    T.slings.forEach((b, i) => {
      const hit = now - (sim.flash[`sling${i}`] ?? -1e9) < 90;
      const { A, C: Cc, posts, rPlast } = b.plugin;
      this.slingPlastic(posts, rPlast);
      if (hit) { this.offsetPath(posts, rPlast); ctx.fillStyle = 'rgba(255,246,190,0.55)'; ctx.fill(); }
      // élastique blanc et butoir rouge au milieu (la face qui frappe)
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#2b1a10'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(Cc[0], Cc[1]); ctx.stroke();
      ctx.strokeStyle = hit ? '#fffbe6' : '#f4f1ea'; ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(Cc[0], Cc[1]); ctx.stroke();
      const mx = (A[0] + Cc[0]) / 2, my = (A[1] + Cc[1]) / 2, dx = Cc[0] - A[0], dy = Cc[1] - A[1], l = Math.hypot(dx, dy);
      ctx.strokeStyle = hit ? '#ffd23f' : '#e8392c'; ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.moveTo(mx - dx / l * 9, my - dy / l * 9); ctx.lineTo(mx + dx / l * 9, my + dy / l * 9); ctx.stroke();
      // têtes de vis M3 des 3 poteaux du plastron
      for (const p of posts) {
        ctx.beginPath(); ctx.arc(p[0], p[1], 2.2, 0, Math.PI * 2);
        ctx.fillStyle = '#e6e9ee'; ctx.fill(); ctx.strokeStyle = '#4c535e'; ctx.lineWidth = 0.9; ctx.stroke();
      }
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

    // bumpers = pop bumpers (jupe conique + anneau de frappe + chapeau boule de pétanque)
    T.bumpers.forEach((b, i) => {
      const age = now - (sim.flash[`bumper${i}`] ?? -1e9);
      const hit = age < 110;
      const cap = b.plugin.cap || b.circleRadius;
      if (age < 170) {
        const k = 1 - age / 170;
        const gl = ctx.createRadialGradient(b.position.x, b.position.y, cap * 0.4, b.position.x, b.position.y, cap + 14);
        gl.addColorStop(0, `rgba(255,235,140,${0.65 * k})`);
        gl.addColorStop(1, 'rgba(255,210,80,0)');
        ctx.fillStyle = gl;
        ctx.beginPath(); ctx.arc(b.position.x, b.position.y, cap + 14, 0, Math.PI * 2); ctx.fill();
      }
      // anneau chromé qui descend frapper la bille (léger débordement visible au choc)
      const stroke = age < 26 ? Math.sin((age / 26) * (Math.PI / 2))
        : age < 145 ? Math.max(0, Math.exp(-((age - 26) / 119) * 4) * (1 - (age - 26) / 119)) : 0;
      if (stroke > 0.02) {
        const d = sim.flashDir?.[`bumper${i}`];
        const ox = d ? d.x * stroke * 2.5 : 0, oy = d ? d.y * stroke * 2.5 : 0;
        ctx.beginPath(); ctx.arc(b.position.x + ox, b.position.y + oy, cap + 2.5 * stroke, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(235,240,248,${0.85 * stroke})`; ctx.lineWidth = 3; ctx.stroke();
      }
      this.popBumper(b.position.x, b.position.y, cap, hit, i);
    });

    // flippers
    for (const fl of T.flippers) {
      this.poly(fl.body.vertices, '#fbfbf8', C.red, 3);
      ctx.fillStyle = C.red;
      ctx.beginPath(); ctx.arc(fl.def.px, fl.def.py, 4, 0, Math.PI * 2); ctx.fill();
    }

    // lanceur
    const P = GEO.plunger;
    const kick = (now - (sim.flash.plunger ?? -1e9) < 60 ? -6 : 0) + sim.tirage * sim.courseLanceur;
    ctx.fillStyle = '#8c929c';
    ctx.fillRect(P.x - 12, P.top + kick, 24, 8);
    ctx.fillStyle = '#5c616a';
    ctx.fillRect(P.x - 3, P.top + 8 + kick, 6, 30);

    // fils de détection (rollovers) : couloirs bonus T-O-U-R et couloirs du bas (s'enfoncent au passage de la bille)
    const rollovers = [
      ...GEO.lanes.map((l, i) => ({ x: l.x, y: l.y, key: `lane${i}` })),
      ...(GEO.lowerLanes || []).map((l) => ({ x: l.x, y: l.y, key: l.id })),
    ];
    for (const l of rollovers) {
      let press = 0;
      for (const b of sim.balls) {
        if (b.plugin.fp.mode !== 'table' || b.retiree) continue;
        const dx = b.position.x - l.x, dy = b.position.y - l.y;
        if (Math.abs(dx) < 15 && Math.abs(dy) < 22) {
          const d = Math.hypot(dx / 15, dy / 22);
          press = Math.max(press, Math.max(0, 1 - d * d));
        }
      }
      const age = now - (sim.flash[l.key] ?? -1e9);
      if (age < 130) press = Math.max(press, Math.sin((Math.PI * age) / 130) * 0.85);
      const lift = 1 - press;
      ctx.save();
      ctx.lineCap = 'round';
      if (lift > 0.05) {
        ctx.strokeStyle = `rgba(0,0,0,${0.42 * lift})`; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(l.x + 1.8 * lift, l.y - 15); ctx.lineTo(l.x + 1.8 * lift, l.y + 15); ctx.stroke();
      }
      ctx.strokeStyle = '#4c535e'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(l.x, l.y - 15.5); ctx.lineTo(l.x, l.y + 15.5); ctx.stroke();
      ctx.strokeStyle = lift > 0.3 ? '#f0f4f8' : '#a8b0bc'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(l.x, l.y - 15); ctx.lineTo(l.x, l.y + 15); ctx.stroke();
      ctx.restore();
    }

    const views = sim.ballViews();
    for (const v of views) if (!v.onRamp) this.ball(v.x, v.y, v.inSaucer ? 0.85 : 1);

    this.apron(lamps, blinkOn);

    // rampes (au-dessus du plateau)
    for (const side of Object.keys(sim.ramps)) this.ramp(sim.ramps[side], now - (sim.flash[`ramp${side}`] ?? -1e9) < 300);
    // tourniquet métallique (spinner) à l'entrée de la rampe
    if (GEO.spinner) {
      const sp = GEO.spinner, ang = sim.spinner?.angle ?? 0;
      const c = Math.cos(ang), s = Math.sin(ang);
      const flash = now - (sim.flash.spinner ?? -1e9) < 70;
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(Math.atan2(sp.v.y, sp.v.x));
      // portique chromé (2 paliers latéraux) + axe horizontal en corde à piano
      ctx.strokeStyle = '#3d434d'; ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.moveTo(-24, 0); ctx.lineTo(24, 0); ctx.stroke();
      ctx.strokeStyle = '#eef2f7'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-24, 0); ctx.lineTo(24, 0); ctx.stroke();
      for (const sx of [-24, 24]) {
        ctx.fillStyle = '#d6d9df'; ctx.strokeStyle = '#3d434d'; ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.roundRect(sx - 2.2, -3.5, 4.4, 7, 1.5); ctx.fill(); ctx.stroke();
      }
      // plaque métallique symétrique vue de dessus : profondeur raccourcie par sin(angle) lors de la rotation 360°
      const depth = Math.max(2.4, Math.abs(s) * 40);
      ctx.fillStyle = flash ? '#fff4b8' : c >= 0 ? '#5c4fa6' : '#342c66';
      ctx.strokeStyle = '#e6eaf0'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.roundRect(-15, -depth / 2, 30, depth, 1.5); ctx.fill(); ctx.stroke();
      if (depth > 8) {
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(-11, -1, 22, 2);
      }
      ctx.restore();
    }
    // guide de protection autour de la bielle du tourniquet
    if (GEO.spinnerGuard) {
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      GEO.spinnerGuard.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = '#3d434d'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = '#eef2f7'; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }
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

  // Tablier : voir drawApron
  apron() { drawApron(this.ctx); }

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

  // Chapeau de pop bumper vu de dessus, assorti aux plastiques : jupe chromée, chapeau lavande à
  // rayons ocre, liseré ocre cerné, couronne d'étoiles et de pois, boule de pétanque gravée au centre.
  popBumper(x, y, r, hit, i) {
    const ctx = this.ctx, TAU = Math.PI * 2;
    ctx.save();
    ctx.fillStyle = 'rgba(20,10,0,0.35)';                                   // ombre
    ctx.beginPath(); ctx.arc(x + 3, y + 4, r, 0, TAU); ctx.fill();
    const jupe = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r);   // jupe chromée
    jupe.addColorStop(0, '#f4f6f8'); jupe.addColorStop(1, '#6b727c');
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = jupe; ctx.fill();
    const rc = r - 4;                                                        // chapeau en plastique
    const g = ctx.createRadialGradient(x, y, 0, x, y, rc);
    g.addColorStop(0, hit ? '#fff3b0' : '#9d8bd6'); g.addColorStop(1, hit ? '#f2b632' : '#3f3a7c');
    ctx.beginPath(); ctx.arc(x, y, rc, 0, TAU); ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = hit ? 'rgba(255,255,255,0.35)' : 'rgba(242,182,50,0.30)';   // rayons de soleil
    const rot = i * 0.4;
    for (let k = 0; k < 24; k += 2) {
      const a0 = rot + (k * TAU) / 24, a1 = rot + ((k + 1) * TAU) / 24;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, rc, a0, a1); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.lineWidth = 4.5; ctx.strokeStyle = '#2b1a10';                       // liseré ocre cerné
    ctx.beginPath(); ctx.arc(x, y, rc, 0, TAU); ctx.stroke();
    ctx.lineWidth = 2.8; ctx.strokeStyle = '#e9b44c'; ctx.stroke();
    // couronne : quatre étoiles jaunes, pois crème entre elles
    const rt = rc - 7;
    for (let k = 0; k < 16; k++) {
      const a = rot + (k * TAU) / 16, px = x + Math.cos(a) * rt, py = y + Math.sin(a) * rt;
      if (k % 4 === 0) {
        ctx.beginPath();
        for (let j = 0; j < 10; j++) {
          const rr = j % 2 ? 2.2 : 5, b = a + (j * Math.PI) / 5;
          ctx.lineTo(px + Math.cos(b) * rr, py + Math.sin(b) * rr);
        }
        ctx.closePath(); ctx.fillStyle = '#ffd23f'; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = '#2b1a10'; ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(px, py, 1.6, 0, TAU); ctx.fillStyle = '#fff4d6'; ctx.fill();
      }
    }
    ctx.restore();
    this.boule(x, y, rc * 0.48, hit ? '#fffbe6' : '#d4d8de', '#4c535e', true);   // boule au centre
  }

  // Contour aux coins arrondis (rayon limité à la moitié des côtés voisins).
  roundedPath(pts, r) {
    const ctx = this.ctx, n = pts.length;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    ctx.beginPath();
    ctx.moveTo(...mid(pts[n - 1], pts[0]));
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n], o = pts[(i - 1 + n) % n];
      const lim = Math.min(Math.hypot(p[0] - o[0], p[1] - o[1]), Math.hypot(q[0] - p[0], q[1] - p[1])) / 2;
      ctx.arcTo(p[0], p[1], ...mid(p, q), Math.min(r, lim));
    }
    ctx.closePath();
  }

  // Plastique sérigraphié façon années 70, teintes provençales : fond lavande → indigo, rayons de soleil, pois crème,
  // liseré ocre et trait noir, coins arrondis.
  plastic(pts, r = 6) {
    const ctx = this.ctx;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0);
    ctx.save();
    this.roundedPath(pts, r);
    ctx.save();
    ctx.clip();
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, '#7d6bb8'); g.addColorStop(1, '#3f3a7c');
    ctx.fillStyle = g; ctx.fillRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
    ctx.fillStyle = 'rgba(242,182,50,0.18)';                       // rayons de soleil
    for (let k = 0; k < 16; k += 2) {
      const a0 = (k * Math.PI) / 8, a1 = ((k + 1) * Math.PI) / 8;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R); ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,244,214,0.40)';                      // pois
    for (let y = Math.floor(y0 / 10) * 10, row = 0; y < y1 + 10; y += 10, row++) {
      for (let x = Math.floor(x0 / 10) * 10 + (row % 2) * 5; x < x1 + 10; x += 10) {
        ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    this.roundedPath(pts, r);   // les rayons et les pois ont remplacé le tracé : on le refait
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#2b1a10'; ctx.lineWidth = 8.5; ctx.stroke();
    ctx.strokeStyle = '#e9b44c'; ctx.lineWidth = 6.5; ctx.stroke();
    ctx.restore();
  }

  // Contour extérieur d'un polygone convexe décalé de m mm (somme de Minkowski avec un disque de rayon m,
  // identique au makeOffset2D(m, join=0) de FreeCAD : suit les pointes aiguës sans les tronquer).
  offsetPath(pts, m) {
    const ctx = this.ctx, n = pts.length;
    const cx = pts.reduce((t, p) => t + p[0], 0) / n, cy = pts.reduce((t, p) => t + p[1], 0) / n;
    const nrm = [], ang = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      let nx = -dy / l, ny = dx / l;
      if (nx * (cx - a[0]) + ny * (cy - a[1]) > 0) { nx = -nx; ny = -ny; }
      nrm.push([nx, ny]);
      ang.push(Math.atan2(ny, nx));
    }
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p = pts[i], prev = (i - 1 + n) % n;
      const acw = nrm[prev][0] * nrm[i][1] - nrm[prev][1] * nrm[i][0] < 0;
      ctx.arc(p[0], p[1], m, ang[prev], ang[i], acw);
    }
    ctx.closePath();
  }

  // Plastron supérieur sérigraphié d'un lance-pierre, ajusté aux 3 poteaux et au débord réel (marge = 10 mm,
  // soit +2 mm autour du caoutchouc Ø 16) : bordure ocre cernée de brun qui épouse tout le pourtour,
  // rayons de soleil et boule de pétanque gravée au centre inscrit, étoile provençale dans la pointe haute.
  slingPlastic(pts, marge = 10, bleed = 0) {
    const ctx = this.ctx;
    const [p0, p1, p2] = pts;
    const l0 = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
    const l1 = Math.hypot(p2[0] - p0[0], p2[1] - p0[1]);
    const l2 = Math.hypot(p0[0] - p1[0], p0[1] - p1[1]);
    const perim = l0 + l1 + l2 || 1;
    const ix = (l0 * p0[0] + l1 * p1[0] + l2 * p2[0]) / perim;
    const iy = (l0 * p0[1] + l1 * p1[1] + l2 * p2[1]) / perim;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs) - marge, x1 = Math.max(...xs) + marge;
    const y0 = Math.min(...ys) - marge, y1 = Math.max(...ys) + marge;
    const R = Math.hypot(x1 - x0, y1 - y0);
    const rim = 1.3, ochre = 3.2, innerRim = 1.2;
    ctx.save();
    // bordure en couches concentriques : brun extérieur (+ fond perdu en 3D), liseré ocre, filet brun intérieur
    this.offsetPath(pts, marge + bleed);
    ctx.fillStyle = '#2b1a10'; ctx.fill();
    this.offsetPath(pts, marge - rim);
    ctx.fillStyle = '#e9b44c'; ctx.fill();
    this.offsetPath(pts, marge - rim - ochre);
    ctx.fillStyle = '#2b1a10'; ctx.fill();
    // champ intérieur : dégradé lavande → indigo, rayons de soleil depuis le centre inscrit, pois crème
    this.offsetPath(pts, Math.max(0.5, marge - rim - ochre - innerRim));
    ctx.save();
    ctx.clip();
    const g = ctx.createLinearGradient(ix, y0, ix, y1);
    g.addColorStop(0, '#7d6bb8'); g.addColorStop(1, '#3f3a7c');
    ctx.fillStyle = g; ctx.fillRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
    ctx.fillStyle = 'rgba(242,182,50,0.22)';
    for (let k = 0; k < 16; k += 2) {
      const a0 = (k * Math.PI) / 8, a1 = ((k + 1) * Math.PI) / 8;
      ctx.beginPath(); ctx.moveTo(ix, iy);
      ctx.lineTo(ix + Math.cos(a0) * R, iy + Math.sin(a0) * R);
      ctx.lineTo(ix + Math.cos(a1) * R, iy + Math.sin(a1) * R);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,244,214,0.40)';
    for (let y = Math.floor(y0 / 10) * 10, row = 0; y < y1 + 10; y += 10, row++) {
      for (let x = Math.floor(x0 / 10) * 10 + (row % 2) * 5; x < x1 + 10; x += 10) {
        ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    // étoile provençale dans la pointe haute, sur la bissectrice du sommet supérieur
    let topI = 0;
    if (pts[1][1] < pts[topI][1]) topI = 1;
    if (pts[2][1] < pts[topI][1]) topI = 2;
    const tp = pts[topI], qa = pts[(topI + 1) % 3], qb = pts[(topI + 2) % 3];
    const la = Math.hypot(qa[0] - tp[0], qa[1] - tp[1]) || 1;
    const lb = Math.hypot(qb[0] - tp[0], qb[1] - tp[1]) || 1;
    let bx = (qa[0] - tp[0]) / la + (qb[0] - tp[0]) / lb;
    let by = (qa[1] - tp[1]) / la + (qb[1] - tp[1]) / lb;
    const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
    const dTop = Math.hypot(ix - tp[0], iy - tp[1]);
    if (dTop > 45) {
      const sx = tp[0] + bx * dTop * 0.50, sy = tp[1] + by * dTop * 0.50;
      const sr = 5.0;
      ctx.beginPath();
      for (let j = 0; j < 10; j++) {
        const rr = j % 2 ? sr * 0.44 : sr, a = -Math.PI / 2 + (j * Math.PI) / 5;
        ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fillStyle = '#ffd23f'; ctx.fill();
      ctx.strokeStyle = '#2b1a10'; ctx.lineWidth = 0.9; ctx.stroke();
    }
    // boule de pétanque gravée au centre inscrit (stries + reflet)
    const br = 8.0;
    const gb = ctx.createRadialGradient(ix - br * 0.3, iy - br * 0.3, br * 0.15, ix, iy, br);
    gb.addColorStop(0, '#ffffff'); gb.addColorStop(0.45, '#b9bec6'); gb.addColorStop(1, '#4c535e');
    ctx.beginPath(); ctx.arc(ix, iy, br, 0, Math.PI * 2); ctx.fillStyle = gb; ctx.fill();
    ctx.strokeStyle = '#2b1a10'; ctx.lineWidth = 1.1; ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.arc(ix, iy, br, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = 'rgba(40,40,50,0.6)'; ctx.lineWidth = 0.85;
    for (const d of [-br * 0.38, br * 0.38]) {
      ctx.beginPath(); ctx.ellipse(ix + d, iy, br * 0.25, br, 0.5, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
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

  // Rampe en plastique transparent façon années 80 : ombre portée sur le plateau, liseré rouge et jaune
  // aux couleurs de Fanny, rails chromés, chevrons à l'entrée, « WORLD TOUR » le long de l'arrondi du haut.
  ramp(path, hit) {
    const ctx = this.ctx, pts = path.pts;
    const off = BALL_R + 6;
    const side = (sign, o = off) => pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
      return { x: p.x - (dy / l) * o * sign, y: p.y + (dx / l) * o * sign };
    });
    const line = (ps) => { ctx.beginPath(); ps.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); };
    const band = (a, b) => { line(a); [...b].reverse().forEach((p) => ctx.lineTo(p.x, p.y)); ctx.closePath(); };
    const l = side(1), r = side(-1);
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // ombre de la rampe surélevée
    ctx.save(); ctx.translate(5, 7); band(l, r); ctx.fillStyle = 'rgba(20,10,0,0.28)'; ctx.fill(); ctx.restore();
    // plastique transparent
    band(l, r);
    ctx.fillStyle = hit ? 'rgba(255,240,170,0.55)' : 'rgba(205,235,255,0.30)';
    ctx.fill();
    // liserés : rouge cerise au bord, jaune soleil à l'intérieur
    for (const sg of [1, -1]) {
      band(side(sg, off - 1), side(sg, off - 6)); ctx.fillStyle = '#e8392c'; ctx.fill();
      band(side(sg, off - 6), side(sg, off - 9)); ctx.fillStyle = '#ffd23f'; ctx.fill();
    }
    // reflet du plastique
    line(side(1, off * 0.35)); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
    // rails chromés
    for (const rail of [l, r]) {
      line(rail); ctx.strokeStyle = '#4c535e'; ctx.lineWidth = 3.5; ctx.stroke();
      line(rail); ctx.strokeStyle = hit ? '#fffbe6' : '#e6e9ee'; ctx.lineWidth = 1.8; ctx.stroke();
    }
    // chevrons jaunes à l'entrée (sens de montée)
    for (const s0 of [26, 46, 66]) {
      const p = pointAt(path, s0), q = pointAt(path, s0 + 8);
      const ang = Math.atan2(q.y - p.y, q.x - p.x);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(-4, -8); ctx.lineTo(5, 0); ctx.lineTo(-4, 8);
      ctx.strokeStyle = '#2b1a10'; ctx.lineWidth = 6; ctx.stroke();
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.restore();
    }
    // « WORLD TOUR » le long de l'arrondi du haut, lettres orientées selon la rampe
    const texte = '★ WORLD TOUR ★';
    const top = pts.reduce((m, p) => (p.y < m.y ? p : m), pts[0]);
    const pas = 13, s0 = top.s - (pas * (texte.length - 1)) / 2;
    ctx.font = 'italic 900 12px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    [...texte].forEach((ch, i) => {
      const p = pointAt(path, s0 + i * pas);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.dy, p.dx));
      ctx.lineWidth = 3; ctx.strokeStyle = '#1f4e8c'; ctx.strokeText(ch, 0, 0.5);
      ctx.fillStyle = hit ? '#fff6c0' : '#ffffff'; ctx.fillText(ch, 0, 0.5);
      ctx.restore();
    });
    ctx.restore();
  }
}
