// Salle autour de la machine (version native : décor des menus et de la cinématique) : un café provençal, dans le
// style illustré du plateau. Murs ocre à la chaux, soubassement lavande, tomettes, poutres, fenêtres à volets bleus
// ouvertes sur un paysage de lavande, affiches de Fanny, ardoise du concours de pétanque, comptoir en zinc, table de
// bistrot avec boules et cochonnet, olivier en pot, guirlande de guinguette.
//
// Repère de la caisse (mm) : X largeur de la machine (0 à L), Y de la façade vers le fronton, Z vers le haut, sol à
// z = −hSol. Tous les matériaux s'appellent « salle_* » : la version native les éclaire toujours (ils ne suivent pas
// la mise sous tension de la machine).

export async function construireSalle(THREE, { L, P, hSol }) {
  const g = new THREE.Group();
  g.name = 'salle';
  const SOL = -hSol, HAUT = SOL + 3000;
  const X0 = L / 2 - 2700, X1 = L / 2 + 2700, Y0 = -3000, Y1 = P + 1100;
  const mats = {};
  const mat = (nom, o) => (mats[nom] ||= Object.assign(new THREE.MeshStandardMaterial(o), { name: 'salle_' + nom }));
  const toile = (w, h, f) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    f(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  const alea = (() => { let s = 7; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); })();
  const boite = (l, p, h, x, y, z, m) => {              // pavé posé : (x, y) centre, z = dessous
    const b = new THREE.Mesh(new THREE.BoxGeometry(l, p, h), m);
    b.position.set(x, y, z + h / 2);
    g.add(b);
    return b;
  };
  const cyl = (r1, r2, h, x, y, z, m, seg = 20) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m);
    c.rotation.x = Math.PI / 2;                          // axe Y de Three → axe Z de la caisse
    c.position.set(x, y, z + h / 2);
    g.add(c);
    return c;
  };
  const plan = (w, h, m, x, y, z, rz = 0) => {          // panneau vertical, face vers −Y tourné de rz autour de Z
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    p.rotation.set(Math.PI / 2, 0, 0);
    p.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), rz);
    p.position.set(x, y, z);
    g.add(p);
    return p;
  };

  // ---------------------------------------------------------------- sol : tomettes hexagonales en terre cuite
  const tomettes = toile(1024, 1024, (c, w, h) => {
    c.fillStyle = '#5a2d18'; c.fillRect(0, 0, w, h);
    const r = w / 8, dx = r * Math.sqrt(3), dy = r * 1.5;
    for (let j = -1; j < h / dy + 1; j++) for (let i = -1; i < w / dx + 1; i++) {
      const cx = i * dx + (j % 2 ? dx / 2 : 0), cy = j * dy;
      const t = alea();
      c.fillStyle = `hsl(${14 + t * 10}, ${55 + t * 15}%, ${36 + alea() * 12}%)`;
      c.beginPath();
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; c.lineTo(cx + (r - 5) * Math.cos(a), cy + (r - 5) * Math.sin(a)); }
      c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,220,180,0.10)';
      c.beginPath(); c.ellipse(cx - r * 0.2, cy - r * 0.25, r * 0.45, r * 0.25, -0.5, 0, 2 * Math.PI); c.fill();
    }
  });
  tomettes.repeat.set((X1 - X0) / 900, (Y1 - Y0) / 900);
  const sol = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Y1 - Y0), mat('tomettes', { map: tomettes, roughness: 0.75 }));
  sol.position.set((X0 + X1) / 2, (Y0 + Y1) / 2, SOL);
  g.add(sol);

  // ---------------------------------------------------------------- murs : chaux ocre, soubassement lavande
  const chaux = toile(1024, 1024, (c, w, h) => {
    c.fillStyle = '#e3a857'; c.fillRect(0, 0, w, h);
    for (let k = 0; k < 900; k++) {
      const x = alea() * w, y = alea() * h, r = 20 + alea() * 90;
      const gr = c.createRadialGradient(x, y, 0, x, y, r);
      const clair = alea() < 0.5;
      gr.addColorStop(0, clair ? 'rgba(255,226,160,0.10)' : 'rgba(170,96,40,0.09)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gr; c.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  });
  const soubassement = toile(512, 512, (c, w, h) => {
    c.fillStyle = '#7d6fb0'; c.fillRect(0, 0, w, h);
    for (let k = 0; k < 400; k++) {
      c.fillStyle = `rgba(${alea() < 0.5 ? '255,255,255' : '40,20,80'},0.05)`;
      c.fillRect(alea() * w, alea() * h, 2 + alea() * 30, 1 + alea() * 4);
    }
  });
  const H_SOUB = 950;
  const mur = (x, y, longueur, rz) => {
    const tx = chaux.clone(); tx.needsUpdate = true; tx.repeat.set(longueur / 1400, 3000 / 1400);
    const ts = soubassement.clone(); ts.needsUpdate = true; ts.repeat.set(longueur / 700, 1);
    plan(longueur, 3000 - H_SOUB, mat('chaux_' + longueur, { map: tx, roughness: 0.95 }), x, y, SOL + H_SOUB + (3000 - H_SOUB) / 2, rz);
    plan(longueur, H_SOUB, mat('soubassement_' + longueur, { map: ts, roughness: 0.6 }), x, y, SOL + H_SOUB / 2, rz);
  };
  // les plans regardent −Y : le mur du fond (y = Y1) regarde déjà la salle ; façade tournée de π, côtés de ±π/2
  mur((X0 + X1) / 2, Y1, X1 - X0, 0);
  mur((X0 + X1) / 2, Y0, X1 - X0, Math.PI);
  mur(X0, (Y0 + Y1) / 2, Y1 - Y0, Math.PI / 2);
  mur(X1, (Y0 + Y1) / 2, Y1 - Y0, -Math.PI / 2);
  // listel peint entre la chaux et le soubassement, plinthes en terre cuite
  const listel = mat('listel', { color: 0x2f5fa8, roughness: 0.5 });
  const terre = mat('plinthe', { color: 0x8a3e1e, roughness: 0.8 });
  for (const [x, y, l, p] of [[(X0 + X1) / 2, Y1 - 6, X1 - X0, 12], [(X0 + X1) / 2, Y0 + 6, X1 - X0, 12], [X0 + 6, (Y0 + Y1) / 2, 12, Y1 - Y0], [X1 - 6, (Y0 + Y1) / 2, 12, Y1 - Y0]]) {
    boite(l, p, 22, x, y, SOL + H_SOUB - 11, listel);
    boite(l, p, 90, x, y, SOL, terre);
  }

  // ---------------------------------------------------------------- plafond blanchi et poutres
  const plafond = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Y1 - Y0), mat('plafond', { color: 0xf1e6cf, roughness: 1, side: THREE.DoubleSide }));
  plafond.position.set((X0 + X1) / 2, (Y0 + Y1) / 2, HAUT);
  plafond.rotation.x = Math.PI;
  g.add(plafond);
  const bois = mat('poutre', { color: 0x5b3a22, roughness: 0.85 });
  for (let y = Y0 + 500; y < Y1; y += 900) boite(X1 - X0, 180, 220, (X0 + X1) / 2, y, HAUT - 220, bois);

  // ---------------------------------------------------------------- fenêtres du fond : paysage de lavande au soleil
  const paysage = toile(1024, 1024, (c, w, h) => {
    const ciel = c.createLinearGradient(0, 0, 0, h * 0.55);
    ciel.addColorStop(0, '#2f8fe0'); ciel.addColorStop(1, '#bfe6ff');
    c.fillStyle = ciel; c.fillRect(0, 0, w, h);
    // soleil à rayons, comme sur le plateau
    const sx = w * 0.7, sy = h * 0.2;
    c.save(); c.translate(sx, sy);
    for (let k = 0; k < 16; k++) {
      c.rotate(Math.PI / 8);
      c.fillStyle = k % 2 ? 'rgba(255,214,70,0.55)' : 'rgba(255,170,40,0.45)';
      c.beginPath(); c.moveTo(0, 0); c.lineTo(w, -40); c.lineTo(w, 40); c.fill();
    }
    c.restore();
    c.fillStyle = '#ffd23f'; c.strokeStyle = '#f08a1c'; c.lineWidth = 10;
    c.beginPath(); c.arc(sx, sy, 90, 0, 2 * Math.PI); c.fill(); c.stroke();
    // Ventoux et collines
    c.fillStyle = '#8fa7c9'; c.beginPath(); c.moveTo(0, h * 0.46); c.quadraticCurveTo(w * 0.3, h * 0.28, w * 0.55, h * 0.44); c.lineTo(w, h * 0.48); c.lineTo(w, h); c.lineTo(0, h); c.fill();
    c.fillStyle = '#f2f2f6'; c.beginPath(); c.moveTo(w * 0.22, h * 0.35); c.quadraticCurveTo(w * 0.3, h * 0.28, w * 0.38, h * 0.35); c.fill();
    c.fillStyle = '#6f9a4b'; c.beginPath(); c.moveTo(0, h * 0.52); c.quadraticCurveTo(w * 0.5, h * 0.44, w, h * 0.53); c.lineTo(w, h); c.lineTo(0, h); c.fill();
    // rangs de lavande en perspective
    c.fillStyle = '#6a4fa3'; c.fillRect(0, h * 0.55, w, h * 0.45);
    for (let k = -14; k <= 14; k++) {
      c.strokeStyle = k % 2 ? '#9a7fd6' : '#b79bea'; c.lineWidth = 26;
      c.beginPath(); c.moveTo(w / 2 + k * 6, h * 0.55); c.lineTo(w / 2 + k * 95, h); c.stroke();
    }
    // cyprès et oliviers
    const cypres = (x, y, s) => { c.fillStyle = '#1f5a33'; c.beginPath(); c.ellipse(x, y - 70 * s, 16 * s, 75 * s, 0, 0, 2 * Math.PI); c.fill(); };
    cypres(w * 0.12, h * 0.55, 1.3); cypres(w * 0.18, h * 0.55, 1.0); cypres(w * 0.88, h * 0.56, 1.2);
    c.fillStyle = '#87a05a';
    for (const [x, r] of [[w * 0.4, 30], [w * 0.47, 24], [w * 0.62, 28]]) { c.beginPath(); c.arc(x, h * 0.52, r, 0, 2 * Math.PI); c.fill(); }
    // cigale sur la branche (clin d'œil au plateau)
    c.fillStyle = '#8a5a2b'; c.beginPath(); c.ellipse(w * 0.62, h * 0.5, 12, 6, 0.4, 0, 2 * Math.PI); c.fill();
  });
  const vitre = mat('paysage', { map: paysage, emissive: 0xffffff, emissiveMap: paysage, emissiveIntensity: 0.85, roughness: 1 });
  const volet = mat('volet', { color: 0x2b7bbf, roughness: 0.6 });
  const encadrement = mat('encadrement', { color: 0xf3ead6, roughness: 0.8 });
  const fenetre = (x) => {
    const fw = 900, fh = 1500, z0 = SOL + 1050;
    plan(fw, fh, vitre, x, Y1 - 4, z0 + fh / 2, 0);
    // encadrement en pierre et croisillons
    for (const [l, h, dx, dz] of [[fw + 120, 60, 0, -30], [fw + 120, 60, 0, fh + 30], [60, fh, -fw / 2 - 30, fh / 2], [60, fh, fw / 2 + 30, fh / 2], [30, fh, 0, fh / 2], [fw, 24, 0, fh * 0.6]]) {
      boite(l, 40, h, x + dx, Y1 - 20, z0 + dz - h / 2, encadrement);
    }
    // volets ouverts contre le mur, à lames
    for (const s of [-1, 1]) {
      const v = boite(fw / 2, 30, fh, x + s * (fw * 0.75 + 60), Y1 - 18, z0, volet);
      for (let k = 1; k < 12; k++) boite(fw / 2 - 30, 10, 18, v.position.x, Y1 - 36, z0 + (k * fh) / 12 - 9, mat('volet_lame', { color: 0x225f96, roughness: 0.6 }));
    }
    boite(fw + 200, 160, 40, x, Y1 - 80, z0 - 70, encadrement);           // rebord
    for (let k = 0; k < 3; k++) {                                         // jardinière de lavande
      const px = x - 280 + k * 280;
      cyl(70, 55, 130, px, Y1 - 120, z0 - 30, mat('pot', { color: 0xb5562b, roughness: 0.85 }), 14);
      for (let j = 0; j < 9; j++) {
        const t = new THREE.Mesh(new THREE.ConeGeometry(14, 110, 6), mat('lavande', { color: 0x8e6cc9, roughness: 0.9 }));
        t.rotation.x = -Math.PI / 2;
        t.position.set(px + (alea() - 0.5) * 90, Y1 - 120 + (alea() - 0.5) * 70, z0 + 140 + alea() * 30);
        g.add(t);
      }
    }
  };
  fenetre(L / 2 - 1500);
  fenetre(L / 2 + 1500);

  // ---------------------------------------------------------------- affiches de Fanny au mur gauche
  const charger = (u) => new Promise((ok) => new THREE.TextureLoader().load(u, (t) => { t.colorSpace = THREE.SRGBColorSpace; ok(t); }, undefined, () => ok(null)));
  const cadre = mat('cadre', { color: 0x3a2414, roughness: 0.5 });
  const affiche = async (url, x, y, z, w, rz) => {
    const t = await charger(url);
    if (!t) return;
    const h = (w * t.image.height) / t.image.width;
    const p = plan(w, h, mat('affiche_' + url.replace(/\W/g, ''), { map: t, roughness: 0.55 }), x, y, z, rz);
    const c = plan(w + 70, h + 70, cadre, x, y, z, rz);
    const n = new THREE.Vector3(0, -1, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), rz);
    p.position.addScaledVector(n, 14); c.position.addScaledVector(n, 6);
  };
  await affiche('assets/fronton.jpg', X0 + 4, -400, SOL + 1900, 1100, Math.PI / 2);
  await affiche('assets/fanny_lancer.png', X0 + 4, -1700, SOL + 1750, 650, Math.PI / 2);
  await affiche('assets/fanny_victoire.png', X1 - 4, -2300, SOL + 1750, 650, -Math.PI / 2);

  // ---------------------------------------------------------------- ardoise du concours, au mur droit
  const ardoise = toile(1024, 768, (c, w, h) => {
    c.fillStyle = '#1d2621'; c.fillRect(0, 0, w, h);
    for (let k = 0; k < 300; k++) { c.fillStyle = 'rgba(255,255,255,0.025)'; c.fillRect(alea() * w, alea() * h, alea() * 120, alea() * 8); }
    c.fillStyle = '#f4f1e8'; c.textAlign = 'center';
    c.font = 'italic 900 92px Georgia, serif'; c.fillText('Grand Concours', w / 2, 140);
    c.font = 'italic 700 72px Georgia, serif'; c.fillText('de Pétanque', w / 2, 230);
    c.font = '600 56px Georgia, serif'; c.fillStyle = '#ffd23f';
    c.fillText('Dimanche 15 h · Doublettes', w / 2, 360);
    c.fillStyle = '#f4f1e8'; c.font = '500 50px Georgia, serif';
    c.fillText('Mise : 5 F · Pastis offert au vainqueur', w / 2, 460);
    c.fillText('Qui perd 13 à 0 embrasse Fanny !', w / 2, 560);
    c.strokeStyle = '#f4f1e8'; c.lineWidth = 5;
    for (const [x, r] of [[w / 2 - 90, 34], [w / 2, 34], [w / 2 + 90, 34]]) { c.beginPath(); c.arc(x, 660, r, 0, 2 * Math.PI); c.stroke(); }
    c.fillStyle = '#e8392c'; c.beginPath(); c.arc(w / 2 + 170, 675, 14, 0, 2 * Math.PI); c.fill();
  });
  ardoise.wrapS = ardoise.wrapT = THREE.ClampToEdgeWrapping;
  plan(1300, 975, mat('ardoise', { map: ardoise, roughness: 0.9 }), X1 - 16, 400, SOL + 1800, -Math.PI / 2);
  plan(1380, 1055, cadre, X1 - 8, 400, SOL + 1800, -Math.PI / 2);

  // ---------------------------------------------------------------- comptoir en zinc, bouteilles, tabourets
  const zinc = mat('zinc', { color: 0xb9bfc6, metalness: 0.9, roughness: 0.3 });
  const facade = mat('comptoir', { color: 0x6b4226, roughness: 0.7 });
  const xc = X1 - 500, yc = -1200;
  boite(700, 2200, 1050, xc, yc, SOL, facade);
  boite(800, 2300, 50, xc - 30, yc, SOL + 1050, zinc);
  const verre = (c) => mat('bouteille_' + c.toString(16), { color: c, roughness: 0.15, metalness: 0.1 });
  for (let k = 0; k < 7; k++) {
    const c = [0xe8c33a, 0x2f7a3c, 0x7a2b1f, 0xe8c33a, 0xd9d4c4, 0x2f7a3c, 0xe8c33a][k];
    const b = cyl(38, 38, 230, xc + 120, yc - 800 + k * 120, SOL + 1100, verre(c), 12);
    cyl(14, 34, 70, b.position.x, b.position.y, SOL + 1330, verre(c), 10);
  }
  for (let k = 0; k < 3; k++) {                                // tabourets de bar
    const y = yc - 700 + k * 700;
    cyl(190, 190, 50, xc - 650, y, SOL + 720, mat('tabouret', { color: 0xc8372d, roughness: 0.5 }), 20);
    cyl(28, 28, 720, xc - 650, y, SOL, zinc, 10);
    cyl(170, 200, 20, xc - 650, y, SOL, zinc, 16);
  }

  // ---------------------------------------------------------------- table de bistrot, chaises, boules et cochonnet
  const xt = X0 + 900, yt = -1500;
  const fer = mat('fer', { color: 0x1b1b1d, metalness: 0.6, roughness: 0.4 });
  cyl(380, 380, 35, xt, yt, SOL + 720, mat('marbre', { color: 0xf3efe6, roughness: 0.25 }), 32);
  cyl(30, 30, 720, xt, yt, SOL, fer, 10);
  cyl(260, 260, 20, xt, yt, SOL, fer, 20);
  const acier = mat('boule', { color: 0xc9ccd2, metalness: 1, roughness: 0.22 });
  for (const [dx, dy] of [[-120, 40], [20, -110], [130, 80]]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(37, 24, 16), acier);
    b.position.set(xt + dx, yt + dy, SOL + 755 + 37);
    g.add(b);
  }
  const coch = new THREE.Mesh(new THREE.SphereGeometry(15, 16, 12), mat('cochonnet', { color: 0xe8392c, roughness: 0.5 }));
  coch.position.set(xt - 10, yt + 150, SOL + 755 + 15);
  g.add(coch);
  const verrePastis = cyl(30, 26, 120, xt + 200, yt - 120, SOL + 755, mat('pastis', { color: 0xf4e3a1, roughness: 0.1, metalness: 0 }), 14);
  verrePastis.name = 'pastis';
  const chaise = (x, y, rz) => {
    const c = new THREE.Group();
    const m = mat('chaise', { color: 0x2b6f3c, roughness: 0.6 });
    const piece = (l, p, h, px, py, pz) => { const b = new THREE.Mesh(new THREE.BoxGeometry(l, p, h), m); b.position.set(px, py, pz + h / 2); c.add(b); };
    piece(420, 420, 30, 0, 0, 440);
    for (const [px, py] of [[-190, -190], [190, -190], [-190, 190], [190, 190]]) piece(30, 30, 440, px, py, 0);
    piece(30, 30, 480, -190, 190, 470); piece(30, 30, 480, 190, 190, 470);
    for (let k = 0; k < 3; k++) piece(380, 20, 40, 0, 190, 600 + k * 110);
    c.position.set(x, y, SOL);
    c.rotation.z = rz;
    g.add(c);
  };
  chaise(xt - 520, yt + 60, Math.PI / 2 + 0.3);
  chaise(xt + 140, yt - 560, 0.2);

  // ---------------------------------------------------------------- olivier en jarre, au fond à gauche
  const xo = X0 + 600, yo = Y1 - 700;
  const jarre = new THREE.Mesh(new THREE.SphereGeometry(330, 20, 14), mat('jarre', { color: 0xb8612f, roughness: 0.85 }));
  jarre.scale.set(1, 1, 1.25);
  jarre.position.set(xo, yo, SOL + 380);
  g.add(jarre);
  cyl(80, 110, 1500, xo, yo, SOL + 600, mat('tronc', { color: 0x6d5a45, roughness: 1 }), 10).rotation.y = 0.15;
  const feuillage = mat('olivier', { color: 0x7f9a5a, roughness: 0.9 });
  for (let k = 0; k < 14; k++) {
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(220 + alea() * 160, 1), feuillage);
    f.position.set(xo + (alea() - 0.5) * 900, yo + (alea() - 0.5) * 600, SOL + 1950 + (alea() - 0.3) * 600);
    f.scale.z = 0.7;
    g.add(f);
  }

  // ---------------------------------------------------------------- guirlande de guinguette sous les poutres
  const ampoule = mat('ampoule', { color: 0xfff2c4, emissive: 0xffd88a, emissiveIntensity: 1.6, roughness: 0.4 });
  const fil = mat('fil', { color: 0x151515, roughness: 0.8 });
  const guirlande = (a, b, n, fleche) => {
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t - fleche * 4 * t * (1 - t)));
    }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 4, 5, 5), fil));
    for (let k = 1; k < n; k++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(32, 12, 8), ampoule);
      s.position.copy(pts[k]).add(new THREE.Vector3(0, 0, -45));
      g.add(s);
    }
  };
  const zg = HAUT - 260;
  guirlande(new THREE.Vector3(X0 + 100, Y0 + 400, zg), new THREE.Vector3(X1 - 100, Y1 - 400, zg), 16, 420);
  guirlande(new THREE.Vector3(X1 - 100, Y0 + 400, zg), new THREE.Vector3(X0 + 100, Y1 - 400, zg), 16, 420);
  guirlande(new THREE.Vector3(X0 + 100, (Y0 + Y1) / 2, zg), new THREE.Vector3(X1 - 100, (Y0 + Y1) / 2, zg), 12, 300);

  // ---------------------------------------------------------------- tapis rond sous la machine
  const tapis = toile(512, 512, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    for (const [r, col] of [[250, '#8a2b1f'], [222, '#e8b04a'], [200, '#8a2b1f'], [150, '#2f5fa8'], [130, '#8a2b1f']]) {
      c.fillStyle = col; c.beginPath(); c.arc(w / 2, h / 2, r, 0, 2 * Math.PI); c.fill();
    }
    c.strokeStyle = '#e8b04a'; c.lineWidth = 6;
    for (let k = 0; k < 16; k++) { const a = (k * Math.PI) / 8; c.beginPath(); c.moveTo(w / 2 + 140 * Math.cos(a), h / 2 + 140 * Math.sin(a)); c.lineTo(w / 2 + 195 * Math.cos(a), h / 2 + 195 * Math.sin(a)); c.stroke(); }
  });
  tapis.wrapS = tapis.wrapT = THREE.ClampToEdgeWrapping;
  const tp = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), mat('tapis', { map: tapis, transparent: true, roughness: 1, depthWrite: false }));
  tp.position.set(L / 2, P * 0.45, SOL + 2);
  g.add(tp);

  return { groupe: g, bornes: { x0: X0, x1: X1, y0: Y0, y1: Y1, sol: SOL, haut: HAUT } };
}
