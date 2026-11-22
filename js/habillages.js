// Habillages provisoires de la caisse (vue 3D) : huit décors dessinés avec la palette et les images des sprites
// (planche « Habillage caisse Fanny »). Chaque décor peint, sur des canevas aux cotes de la caisse WPC (mm) :
// le flanc (repère du dessin : x depuis l'arrière, y depuis le haut ; bord haut en pente de 610 à 402 mm),
// la façade et les côtés du fronton. Le flanc droit est le miroir du gauche, sauf les textes.

export const HABILLAGES = [
  { id: 'bois', nom: 'bois' },
  { id: 'pois', nom: 'robe à pois' },
  { id: 'riviera', nom: 'Riviera' },
  { id: 'terre', nom: 'terre battue' },
  { id: 'postale', nom: 'carte postale' },
  { id: 'neon', nom: 'néon' },
  { id: 'transat', nom: 'transat' },
  { id: 'deco', nom: 'Art déco' },
  { id: 'frise', nom: 'frise du plateau' },
];

const L = 1308.1, HA = 609.6, HV = 401.84;     // flanc : longueur, hauteur arrière, hauteur avant
// Charnière du fronton, posée à l'extérieur du flanc (cao/construire.py charnieres) : elle cache le coin haut arrière
// (x 58 à 266 mm depuis l'arrière, 127 mm sous le bord haut). Rien d'important ne doit y être peint.
const CHARNIERE = { x1: 290, y1: 150 };
export const FACADE = { l: 558.8, h: 401.84 };
export const COTE = { l: 250.83, h: 723.9 };   // côté du fronton (profondeur en haut × hauteur)
const C = {
  rouge: '#d11a25', bordeaux: '#5c1017', creme: '#f4cfba', papier: '#f4e4cf', or: '#f0c776', soleil: '#f7ce4d',
  pin: '#314745', pin2: '#3e5c59', riviera: '#85afac', sarcelle: '#517872', terre: '#b6785b', encre: '#0b0003',
  deco: '#7a1a22',
};
const POLICE = '"Bowlby One SC", "Arial Black", "Helvetica Neue", Impact, sans-serif';
const POLICE_ETROITE = '"Barlow Condensed", "Arial Narrow", "DejaVu Sans Condensed", sans-serif';

// ------------------------------------------------------------ images (sprites, frise tirée du plateau)
let images = null;
export function chargerImages() {
  if (images) return images;
  const charge = (src) => new Promise((ok) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => ok(null);
    im.src = src;
  });
  images = Promise.all(['assets/fanny_lancer.png', 'assets/fanny_victoire.png', 'assets/plateau.jpg'].map(charge))
    .then(([lancer, victoire, plateau]) => ({ lancer, victoire, plateau }));
  return images;
}

// ------------------------------------------------------------ outils de dessin (unités : mm)
function pois(g, w, h, fond, coul, r, pas) {
  g.fillStyle = fond; g.fillRect(0, 0, w, h);
  g.fillStyle = coul;
  for (let y = 0; y < h + pas; y += pas) for (let x = 0; x < w + pas; x += pas) {
    for (const [dx, dy] of [[pas / 4, pas / 4], [(pas * 3) / 4, (pas * 3) / 4]]) {
      g.beginPath(); g.arc(x + dx, y + dy, r, 0, 2 * Math.PI); g.fill();
    }
  }
}
function rayures(g, w, h, couls, l, angle = 0) {
  g.save();
  g.translate(w / 2, h / 2); g.rotate((angle * Math.PI) / 180);
  const R = Math.hypot(w, h);
  for (let k = 0, x = -R; x < R; k++, x += l) { g.fillStyle = couls[k % couls.length]; g.fillRect(x, -R, l + 0.5, 2 * R); }
  g.restore();
}
function rayons(g, cx, cy, n, R, coul) {
  g.fillStyle = coul;
  for (let k = 0; k < n; k++) {
    const a0 = (2 * Math.PI * k) / n, a1 = (2 * Math.PI * (k + 0.5)) / n;
    g.beginPath(); g.moveTo(cx, cy);
    g.lineTo(cx + R * Math.cos(a0), cy + R * Math.sin(a0)); g.lineTo(cx + R * Math.cos(a1), cy + R * Math.sin(a1));
    g.fill();
  }
}
function disque(g, x, y, r, fill, stroke, ep) {
  g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = ep; g.stroke(); }
}
function rect(g, x, y, w, h, coul) { g.fillStyle = coul; g.fillRect(x, y, w, h); }
// filet parallèle au bord haut du flanc, à d mm sous lui
function filet(g, d, ep, coul) {
  g.strokeStyle = coul; g.lineWidth = ep;
  g.beginPath(); g.moveTo(0, d); g.lineTo(L, HA - HV + d); g.stroke();
}
function boule(g, x, y, r) {
  const d = g.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.05, x, y, r * 1.1);
  d.addColorStop(0, '#fff'); d.addColorStop(0.35, '#b9bec6'); d.addColorStop(1, '#3d4148');
  disque(g, x, y, r, d);
}

// Contexte du flanc : m = miroir (flanc droit). Textes et sprites restent lisibles et droits.
function flancCtx(g, m) {
  return {
    g, m,
    titre(txt, x, y, taille, rot, fill, stroke, ep, opts = {}) {
      g.save();
      g.translate(x, y);
      if (m) g.scale(-1, 1);
      g.rotate(((m ? -rot : rot) * Math.PI) / 180);
      g.font = `900 ${taille}px ${opts.police || POLICE}`;
      const max = opts.max ?? L * 0.6;   // la police de secours est plus large : le titre reste dans le flanc
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      if (opts.espace) g.letterSpacing = `${opts.espace}px`;
      if (opts.neon) { g.shadowColor = opts.neon; g.shadowBlur = 28; }
      if (stroke && ep) { g.lineJoin = 'round'; g.strokeStyle = stroke; g.lineWidth = ep; g.strokeText(txt, 0, 0, max); }
      if (fill) { g.fillStyle = fill; g.fillText(txt, 0, 0, max); }
      if (opts.neon && stroke) { g.shadowBlur = 12; g.strokeText(txt, 0, 0, max); }
      g.restore();
    },
    // sprite de hauteur h, bas en y + h ; cx : centre horizontal. S'il passe sous la charnière, il descend sous elle
    // (bas inchangé, image réduite).
    sprite(im, cx, y, h, inverse = false) {
      if (!im) return;
      const r = im.width / im.height;
      if (y < CHARNIERE.y1 && cx - (r * h) / 2 < CHARNIERE.x1) { h = y + h - CHARNIERE.y1; y = CHARNIERE.y1; }
      const w = r * h, x = cx - w / 2;
      g.save();
      g.translate(x + w / 2, y);
      if (inverse) g.scale(-1, 1);
      g.drawImage(im, -w / 2, 0, w, h);
      g.restore();
    },
  };
}

function tampon(g, cx, cy, r, txt, coul, m) {
  g.save();
  g.translate(cx, cy); if (m) g.scale(-1, 1); g.rotate((-14 * Math.PI) / 180);
  g.globalAlpha = 0.85;
  disque(g, 0, 0, r, null, coul, 5); disque(g, 0, 0, r - 14, null, coul, 5);
  g.fillStyle = coul; g.font = `600 ${Math.round(r * 0.42)}px ${POLICE_ETROITE}`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.letterSpacing = '3px';
  g.fillText(txt, 0, 2);
  g.restore();
}
function chevrons(g, x0, y0, n, w, h, coul) {
  g.strokeStyle = coul; g.lineWidth = 22;
  for (let k = 0; k < n; k++) {
    const x = x0 + k * w * 0.62;
    g.beginPath(); g.moveTo(x, y0); g.lineTo(x + w / 2, y0 + h / 2); g.lineTo(x, y0 + h); g.stroke();
  }
}
function frise(g, im, x, y, w, h) {
  if (!im) return;
  // haut de l'illustration du plateau : soleil, opéra de Sydney, maisons des escales
  const sy = im.height * 0.02, sh = im.height * 0.14, sw = im.width;
  const k = Math.max(w / sw, h / sh), cw = w / k, ch = h / k;
  g.drawImage(im, (sw - cw) / 2, sy + (sh - ch) / 2, cw, ch, x, y, w, h);
}

// ------------------------------------------------------------ décors
// chaque décor : fond(g, w, h) commun aux trois panneaux, flanc(f, im), facade(g, im), cote(g, im)
const DECORS = {
  pois: {
    dos: ['#f0c776', '#5c1017', '#5c1017'],
    fond: (g, w, h) => pois(g, w, h, C.rouge, C.creme, 13, 70),
    flanc(f, im) {
      const { g } = f;
      rect(g, 0, HA - 150, L, 150, C.bordeaux); rect(g, 0, HA - 156, L, 6, C.or);
      filet(g, 26, 10, C.or); filet(g, 44, 4, C.or);
      f.titre('FANNY', L * 0.5, HA * 0.8, 150, -9, C.or, C.bordeaux, 20);
      f.sprite(im.lancer, 190, 40, 560);
    },
    facade(g) { rect(g, 0, FACADE.h - 60, FACADE.l, 60, C.bordeaux); rect(g, 0, FACADE.h - 66, FACADE.l, 6, C.or); },
    cote(g) { rect(g, 0, COTE.h - 90, COTE.l, 90, C.bordeaux); rect(g, 0, COTE.h - 96, COTE.l, 6, C.or); },
  },
  riviera: {
    dos: ['#f0c776', '#0b0003', '#85afac'],
    fond: (g, w, h) => rect(g, 0, 0, w, h, C.pin),
    flanc(f, im) {
      const { g } = f;
      rayons(g, 140, 40, 28, 1500, C.pin2);
      disque(g, 140, 40, 250, C.or); disque(g, 140, 40, 170, C.soleil);
      rect(g, 0, HA - 90, L, 90, C.riviera); rect(g, 0, HA - 98, L, 8, C.rouge);
      filet(g, 18, 8, C.rouge);
      f.titre('PÉTANQUE TOUR', L * 0.6, HA * 0.8, 130, -9, C.or, C.encre, 20, { max: L * 0.66 });
      f.sprite(im.victoire, 230, 30, 560);
    },
    facade(g) {
      rayons(g, FACADE.l / 2, -40, 22, 900, C.pin2);
      rect(g, 0, FACADE.h - 50, FACADE.l, 50, C.riviera); rect(g, 0, FACADE.h - 56, FACADE.l, 6, C.rouge);
    },
    cote(g) { rayons(g, COTE.l / 2, COTE.h, 18, 1000, C.pin2); disque(g, COTE.l / 2, 0, 110, C.or); },
  },
  terre: {
    dos: ['#d11a25', '#f4cfba', '#b6785b'],
    fond: (g, w, h) => rect(g, 0, 0, w, h, C.encre),
    flanc(f, im) {
      const { g } = f;
      g.fillStyle = C.terre;
      g.beginPath(); g.moveTo(0, HA * 0.56);
      g.bezierCurveTo(L * 0.3, HA * 0.5, L * 0.6, HA * 0.62, L, HA * 0.58); g.lineTo(L, HA); g.lineTo(0, HA); g.fill();
      for (const [x, y] of [[760, 520], [930, 548], [1110, 515]]) boule(g, x, y, 38);
      disque(g, 1210, 560, 14, C.rouge);
      filet(g, 22, 6, C.or); rect(g, 0, HA - 14, L, 14, C.bordeaux);
      f.titre('FANNY', L * 0.5, HA * 0.8, 150, -9, C.rouge, C.creme, 20);
      f.sprite(im.lancer, 180, 40, 560);
    },
    facade(g) { rect(g, 0, FACADE.h * 0.62, FACADE.l, FACADE.h * 0.38, C.terre); },
    cote(g) { rect(g, 0, COTE.h - 120, COTE.l, 120, C.terre); },
  },
  postale: {
    dos: ['#5c1017', '#f4e4cf', '#517872'],
    fond: (g, w, h) => rect(g, 0, 0, w, h, C.papier),
    flanc(f, im) {
      const { g, m } = f;
      // bordure de courrier aérien le long des quatre bords
      g.save();
      g.beginPath(); g.rect(0, 0, L, HA);
      g.moveTo(32, 32); g.lineTo(32, HA - 32); g.lineTo(L - 32, HA - 32); g.lineTo(L - 32, HA - HV + 32); g.closePath();
      g.clip('evenodd');
      rayures(g, L, HA, [C.rouge, C.creme, C.sarcelle, C.creme], 30, 45);
      g.restore();
      tampon(g, 560, 250, 92, 'PARIS', C.bordeaux, m); tampon(g, 760, 330, 80, 'TOKYO', C.pin, m);
      tampon(g, 940, 260, 74, 'RIO', C.bordeaux, m); tampon(g, 1110, 380, 66, 'SYDNEY', C.pin, m);
      // timbre à dents
      // timbre sous la charnière
      rect(g, 60, 160, 330, 400, '#fff'); rect(g, 80, 180, 290, 360, C.riviera);
      g.fillStyle = C.papier;
      for (let x = 60; x <= 390; x += 16) { disque(g, x, 160, 5, C.papier); disque(g, x, 560, 5, C.papier); }
      for (let y = 160; y <= 560; y += 16) { disque(g, 60, y, 5, C.papier); disque(g, 390, y, 5, C.papier); }
      f.sprite(im.victoire, 225, 185, 350);
      f.titre('BONS BAISERS DE FANNY', L * 0.64, HA * 0.86, 74, -6, C.bordeaux, C.papier, 14, { max: L * 0.6 });
    },
    facade(g) {
      g.save(); g.beginPath(); g.rect(0, 0, FACADE.l, FACADE.h); g.rect(28, 28, FACADE.l - 56, FACADE.h - 56); g.clip('evenodd');
      rayures(g, FACADE.l, FACADE.h, [C.rouge, C.creme, C.sarcelle, C.creme], 30, 45); g.restore();
      tampon(g, 470, 80, 50, 'MARSEILLE', C.bordeaux, false);
    },
    cote(g) { rayures(g, COTE.l, COTE.h, [C.rouge, C.creme, C.sarcelle, C.creme], 30, 45); },
  },
  neon: {
    dos: ['#d11a25', null, null],
    fond: (g, w, h) => rect(g, 0, 0, w, h, C.encre),
    flanc(f, im) {
      const { g } = f;
      g.save(); g.shadowColor = C.or; g.shadowBlur = 26; g.strokeStyle = C.or; g.lineWidth = 9;
      g.beginPath(); g.moveTo(30, 30); g.lineTo(L - 30, HA - HV + 30); g.lineTo(L - 30, HA - 30); g.lineTo(30, HA - 30); g.closePath(); g.stroke();
      g.shadowColor = C.rouge; g.strokeStyle = C.rouge; g.lineWidth = 7;
      g.beginPath(); g.ellipse(215, 375, 165, 210, 0, 0, 2 * Math.PI); g.stroke();   // sous la charnière
      g.restore();
      // titres assez hauts pour que la pente (−9°) ne les fasse pas passer sous le filet du bas
      f.titre('FANNY', L * 0.6, HA * 0.64, 190, -9, null, C.rouge, 9, { neon: C.rouge });
      f.titre('PÉTANQUE · WORLD · TOUR', L * 0.62, HA * 0.78, 46, -9, C.or, null, 0, { neon: C.or, espace: 10, max: L * 0.56 });
      f.sprite(im.lancer, 215, 175, 390);
    },
    facade(g) {
      g.save(); g.shadowColor = C.or; g.shadowBlur = 22; g.strokeStyle = C.or; g.lineWidth = 7;
      g.beginPath(); g.roundRect(20, 20, FACADE.l - 40, FACADE.h - 40, 18); g.stroke(); g.restore();
    },
    cote(g) {
      g.save(); g.shadowColor = C.rouge; g.shadowBlur = 22; g.strokeStyle = C.rouge; g.lineWidth = 8;
      g.beginPath(); g.roundRect(16, 16, COTE.l - 32, COTE.h - 32 - 30, 22); g.stroke(); g.restore();   // bas : au-dessus de la charnière
    },
    emissif: true,
  },
  transat: {
    dos: ['#d11a25', '#f4e4cf', '#5c1017'],
    fond: (g, w, h) => rayures(g, w, h, [C.rouge, C.creme, C.pin, C.creme], 64),
    flanc(f, im) {
      const { g, m } = f;
      g.save();
      g.translate(L * 0.64, HA * 0.64); if (m) g.scale(-1, 1); g.rotate(((m ? 9 : -9) * Math.PI) / 180);
      g.fillStyle = C.papier; g.strokeStyle = C.bordeaux; g.lineWidth = 10;
      g.beginPath(); g.roundRect(-L * 0.28, -HA * 0.2, L * 0.56, HA * 0.4, 20); g.fill(); g.stroke();
      g.restore();
      f.titre('FANNY', L * 0.64, HA * 0.74, 160, -9, C.rouge, C.papier, 12);
      f.sprite(im.victoire, 220, 30, 570);
    },
    facade() {},
    cote() {},
  },
  deco: {
    dos: ['#f4cfba', '#0b0003', '#0b0003'],
    fond: (g, w, h) => rect(g, 0, 0, w, h, C.bordeaux),
    flanc(f, im) {
      const { g } = f;
      rayons(g, 260, HA + 40, 36, 900, C.deco);
      disque(g, 260, HA + 40, 330, null, C.or, 10); disque(g, 260, HA + 40, 300, null, C.or, 4);
      chevrons(g, 820, 250, 5, 110, 150, C.or);
      filet(g, 20, 6, C.or); rect(g, 0, HA - 30, L, 30, C.encre);
      f.titre('F A N N Y', L * 0.55, HA * 0.86, 120, -9, C.creme, C.encre, 16);
      f.sprite(im.lancer, 270, 20, 560);
    },
    facade(g) { rayons(g, FACADE.l / 2, FACADE.h + 20, 30, 700, C.deco); rect(g, 0, 0, FACADE.l, 12, C.or); },
    cote(g) { rayons(g, COTE.l / 2, COTE.h + 40, 20, 1000, C.deco); rect(g, 0, 0, COTE.l, 12, C.or); },
  },
  frise: {
    dos: ['#f0c776', '#314745', '#314745'],
    fond: (g, w, h) => rect(g, 0, 0, w, h, C.sarcelle),
    flanc(f, im) {
      const { g } = f;
      g.save(); g.rotate(Math.atan2(HA - HV, L)); frise(g, im.plateau, 0, -6, L + 30, 215); g.restore();
      g.strokeStyle = C.rouge; g.lineWidth = 12;
      g.beginPath(); g.moveTo(0, 212); g.lineTo(L, HA - HV + 212); g.stroke();
      filet(g, 226, 5, C.or);
      rect(g, 0, HA - 40, L, 40, C.pin);
      f.titre('FANNY', L * 0.62, HA * 0.84, 150, -9, C.or, C.pin, 20);
      f.sprite(im.lancer, 180, 240, 360, true);
    },
    facade(g, im) { frise(g, im.plateau, 0, 0, FACADE.l, 56); rect(g, 0, 56, FACADE.l, 6, C.rouge); },
    cote(g, im) { frise(g, im.plateau, 0, COTE.h - 150, COTE.l, 150); },
  },
};

export const estEmissif = (id) => !!DECORS[id]?.emissif;

// Panneaux sans dessin propre : plaque arrière de la caisse et dos du fronton (titre au centre, bande en bas),
// dessous du fronton (fond et bande). Couleurs : dos = [titre, contour, bande].
function dosPanneau(g, d, w, h, titre, yt = 0.5) {
  const [tc, cc, bande] = d.dos;
  if (bande) { rect(g, 0, h - h * 0.14, w, h * 0.14, bande); rect(g, 0, h - h * 0.14 - 6, w, 6, C.or); }
  if (d.emissif) {
    g.save(); g.shadowColor = C.or; g.shadowBlur = 22; g.strokeStyle = C.or; g.lineWidth = 7;
    g.beginPath(); g.roundRect(18, 18, w - 36, h - 36, 18); g.stroke(); g.restore();
  }
  if (!titre) return;
  const t = Math.min(w * 0.2, h * 0.3);
  g.save(); g.translate(w / 2, h * yt + t / 3);
  g.font = `900 ${t}px ${POLICE}`; g.textAlign = 'center';
  if (d.emissif) { g.shadowColor = tc; g.shadowBlur = 26; g.strokeStyle = tc; g.lineWidth = 7; g.strokeText('FANNY', 0, 0, w * 0.86); }
  else {
    if (cc) { g.lineJoin = 'round'; g.strokeStyle = cc; g.lineWidth = t * 0.12; g.strokeText('FANNY', 0, 0, w * 0.86); }
    g.fillStyle = tc; g.fillText('FANNY', 0, 0, w * 0.86);
  }
  g.restore();
}

// Canevas d'un panneau : 'flancG', 'flancD', 'facade', 'coteG', 'coteD', 'arriere', 'dosFronton', 'dessous', 'dessus'.
// px : pixels par mm ; dims : [largeur, hauteur] en mm des panneaux sans cote fixe.
export function dessiner(id, panneau, im, px = 1.6, dims = null) {
  const d = DECORS[id];
  const [w, h] = panneau.startsWith('flanc') ? [L, HA] : panneau === 'facade' ? [FACADE.l, FACADE.h]
    : panneau.startsWith('cote') ? [COTE.l, COTE.h] : dims;
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * px); cv.height = Math.round(h * px);
  const g = cv.getContext('2d');
  g.scale(px, px);
  const m = panneau.endsWith('D');
  if (m) { g.translate(w, 0); g.scale(-1, 1); }      // panneau droit : miroir du gauche (textes remis à l'endroit)
  d.fond(g, w, h);
  if (panneau.startsWith('flanc')) d.flanc(flancCtx(g, m), im);
  else if (panneau === 'facade') d.facade(g, im);
  else if (panneau.startsWith('cote')) d.cote(g, im);
  else dosPanneau(g, d, w, h, panneau !== 'dessous', panneau === 'arriere' ? 0.68 : 0.5);   // arrière : sous les lumières de ventilation
  return cv;
}
