// Police 7 segments, même codage que les TM1637 (bit0 = a … bit6 = g, bit7 = point).
//     a
//   f   b
//     g
//   e   c
//     d
// Table reprise à l'identique dans le croquis Arduino (firmware/) pour que l'écran web
// montre exactement ce qu'afficheront les modules.
export const SEG = {
  ' ': 0x00, '-': 0x40, '_': 0x08, '=': 0x48, "'": 0x02, '"': 0x22, '.': 0x80,
  '0': 0x3f, '1': 0x06, '2': 0x5b, '3': 0x4f, '4': 0x66, '5': 0x6d, '6': 0x7d, '7': 0x07, '8': 0x7f, '9': 0x6f,
  A: 0x77, B: 0x7c, C: 0x39, D: 0x5e, E: 0x79, F: 0x71, G: 0x3d, H: 0x76, I: 0x06, J: 0x1e,
  K: 0x75, L: 0x38, M: 0x37, N: 0x54, O: 0x3f, P: 0x73, Q: 0x67, R: 0x50, S: 0x6d, T: 0x78,
  U: 0x3e, V: 0x1c, W: 0x2a, X: 0x76, Y: 0x6e, Z: 0x5b,
  b: 0x7c, c: 0x58, d: 0x5e, h: 0x74, n: 0x54, o: 0x5c, r: 0x50, u: 0x1c,
};

export function encode(ch) {
  if (ch in SEG) return SEG[ch];
  const up = ch.toUpperCase();
  return SEG[up] ?? 0;
}

// Dessine un afficheur de n chiffres dans un canvas.
export function drawSegDisplay(canvas, text, { on = '#ff3b1f', off = 'rgba(255,59,31,0.08)', bg = '#120806' } = {}) {
  const ctx = canvas.getContext('2d');
  const n = text.length;
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cw, ch);
  const pad = ch * 0.12;
  const dw = (cw - pad * 2) / n;
  const h = ch - pad * 2;
  const w = Math.min(dw * 0.72, h * 0.55);
  const t = Math.max(2, w * 0.17);
  for (let i = 0; i < n; i++) {
    const bits = encode(text[i]);
    const x = pad + i * dw + (dw - w) / 2 + h * 0.04, y = pad;
    const segs = [
      [x + t * 0.6, y, w - t * 1.2, t],                    // a
      [x + w - t, y + t * 0.6, t, h / 2 - t * 0.9],         // b
      [x + w - t, y + h / 2 + t * 0.3, t, h / 2 - t * 0.9], // c
      [x + t * 0.6, y + h - t, w - t * 1.2, t],             // d
      [x, y + h / 2 + t * 0.3, t, h / 2 - t * 0.9],         // e
      [x, y + t * 0.6, t, h / 2 - t * 0.9],                 // f
      [x + t * 0.6, y + h / 2 - t / 2, w - t * 1.2, t],     // g
    ];
    segs.forEach((r, k) => {
      ctx.fillStyle = bits & (1 << k) ? on : off;
      ctx.save();
      ctx.translate(r[0] + r[2] / 2, r[1] + r[3] / 2);
      ctx.transform(1, 0, -0.08, 1, 0, 0); // léger penché
      ctx.fillRect(-r[2] / 2, -r[3] / 2, r[2], r[3]);
      ctx.restore();
    });
  }
}
