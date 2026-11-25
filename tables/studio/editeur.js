// Éditeur 2D du haut du plateau (studio de flippers) : plan SVG en mm, éléments déplaçables à la souris.
// Échange avec Python par la zone de texte #compo_pont : {"base": {...}, "elements": [...], "jeton": n}.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const TYPES = {
    bumper: { nom: 'Bumper', defaut: { r: 27 } },
    cible: { nom: 'Cible', defaut: { genre: 'debout' } },
    banque: { nom: 'Banque', defaut: { n: 3, genre: 'tombante' }, prefixe: true },
    trou: { nom: 'Trou', defaut: { r: 20, ejection: [0, 10] } },
    tourniquet: { nom: 'Tourniquet', defaut: { sens: 0, long: 34 } },
    lampe: { nom: 'lampe', defaut: { r: 10, couleur: '#ffcc33', texte: '' } },
    fleche: { nom: 'fleche', defaut: { angle: 0, couleur: '#ffffff' } },
    couloir: { nom: 'Couloir', defaut: { forme: 'invisible', dx: 16, dy: 10 } },
    poteau: { defaut: { r: 5 } },
    rail: { nom: 'Rail', defaut: { ep: 8, haut: 40 }, points: true },
    rampe: { nom: 'Rampe', defaut: { profil: [[0, 0], [40, 7], [180, 42], [0.85, 42], [1, 34]], capteurs: [] }, points: true },
  };
  let etat = { base: null, elements: [], jeton: -1 }, sel = -1, mode = 'choisir', enCours = null, ecrit = null;
  let svg, panneau, glisse = null;

  const pont = () => document.querySelector('#compo_pont textarea');
  const arrondi = v => Math.round(v * 10) / 10;

  function envoyer() {
    const ta = pont(); if (!ta) return;
    ecrit = JSON.stringify({ base: etat.base, elements: etat.elements, jeton: etat.jeton });
    ta.value = ecrit;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function nomLibre(type) {
    const t = TYPES[type]; if (!t.nom) return null;
    const pris = new Set(etat.elements.map(e => e.nom || e.prefixe));
    for (let i = 1; ; i++) { const n = t.nom + i; if (!pris.has(n)) return n; }
  }

  function pointMm(ev) {
    const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return [arrondi(q.x), arrondi(q.y)];
  }

  function el(nom, attrs, parent) {
    const e = document.createElementNS(NS, nom);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function poly(pts) { return pts.map(p => p[0] + ',' + p[1]).join(' '); }

  function dessinerBase(g) {
    const b = etat.base; if (!b) return;
    el('rect', { x: 0, y: 0, width: b.W, height: b.H, fill: '#e6e9ee' }, g);
    for (let y = 0; y < b.H; y += 50) el('line', { x1: 0, y1: y, x2: b.W, y2: y, stroke: '#d3d8df', 'stroke-width': 0.6 }, g);
    for (let x = 0; x < b.W; x += 50) el('line', { x1: x, y1: 0, x2: x, y2: b.H, stroke: '#d3d8df', 'stroke-width': 0.6 }, g);
    // zones non composables : bas de Fanny, couloir du lanceur, hors arche
    el('rect', { x: 0, y: b.haut_libre, width: b.W, height: b.H - b.haut_libre, fill: 'url(#hachures)' }, g);
    el('rect', { x: b.XD, y: 0, width: b.W - b.XD, height: b.H, fill: 'url(#hachures)' }, g);
    el('path', { d: b.hors_arche, fill: 'url(#hachures)' }, g);
    for (const m of b.murs) el('polygon', { points: poly(m), fill: '#59606b', opacity: 0.85 }, g);
    for (const s of b.lance_pierres) el('polygon', { points: poly(s), fill: '#c01c28', opacity: 0.8 }, g);
    for (const p of b.palettes) el('line', { x1: p[0], y1: p[1], x2: p[2], y2: p[3], stroke: '#c01c28', 'stroke-width': 12, 'stroke-linecap': 'round' }, g);
    for (const c of b.couloirs) el('rect', { x: c[0] - 4, y: c[1] - 8, width: 8, height: 16, fill: '#8a919c' }, g);
    el('line', { x1: 0, y1: b.haut_libre, x2: b.XD, y2: b.haut_libre, stroke: '#c01c28', 'stroke-dasharray': '6 4', 'stroke-width': 1.2 }, g);
    const t = el('text', { x: 8, y: b.haut_libre + 18, 'font-size': 14, fill: '#7a2228' }, g);
    t.textContent = 'bas de table de Fanny (fixe)';
  }

  function dir(a) { const r = a * Math.PI / 180; return [Math.sin(r), -Math.cos(r)]; }

  function dessinerElement(e, i, g) {
    const choisi = i === sel, trait = choisi ? '#1c71d8' : '#222';
    const grp = el('g', { 'data-i': i, class: 'elt' }, g);
    const lab = (x, y, s) => { const t = el('text', { x, y, 'font-size': 11, 'text-anchor': 'middle', fill: '#111', 'pointer-events': 'none' }, grp); t.textContent = s || ''; };
    switch (e.type) {
      case 'bumper': el('circle', { cx: e.x, cy: e.y, r: e.r || 27, fill: '#f6d32d', stroke: trait, 'stroke-width': 2 }, grp); lab(e.x, e.y + 4, e.nom); break;
      case 'cible': el('rect', { x: e.x - 12, y: e.y - 5, width: 24, height: 10, fill: '#e01b24', stroke: trait, 'stroke-width': 1.5 }, grp); lab(e.x, e.y - 9, e.nom); break;
      case 'banque': {
        el('line', { x1: e.x0, y1: e.y0, x2: e.x1, y2: e.y1, stroke: choisi ? '#1c71d8' : '#7a2228', 'stroke-width': 4 }, grp);
        for (let k = 0; k < (e.n || 3); k++) { const u = (k + 0.5) / (e.n || 3); el('rect', { x: e.x0 + u * (e.x1 - e.x0) - 6, y: e.y0 + u * (e.y1 - e.y0) - 6, width: 12, height: 12, fill: '#e01b24', stroke: trait }, grp); }
        lab((e.x0 + e.x1) / 2, Math.min(e.y0, e.y1) - 10, e.prefixe + ' ×' + (e.n || 3)); break;
      }
      case 'trou': el('circle', { cx: e.x, cy: e.y, r: e.r || 20, fill: '#241f31', stroke: trait, 'stroke-width': 2 }, grp); lab(e.x, e.y - (e.r || 20) - 4, e.nom); break;
      case 'tourniquet': { const [dx, dy] = dir((e.sens || 0) + 90), l = (e.long || 34) / 2; el('line', { x1: e.x - dx * l, y1: e.y - dy * l, x2: e.x + dx * l, y2: e.y + dy * l, stroke: choisi ? '#1c71d8' : '#3d3846', 'stroke-width': 6 }, grp); lab(e.x, e.y - 10, e.nom); break; }
      case 'lampe': el('circle', { cx: e.x, cy: e.y, r: e.r || 10, fill: e.couleur || '#ffcc33', opacity: 0.85, stroke: trait, 'stroke-width': 1.5 }, grp); lab(e.x, e.y + 4, e.texte); break;
      case 'fleche': { const [dx, dy] = dir(e.angle || 0), [px, py] = [-dy, dx]; el('polygon', { points: poly([[e.x + dx * 15, e.y + dy * 15], [e.x - dx * 15 + px * 9, e.y - dy * 15 + py * 9], [e.x - dx * 15 - px * 9, e.y - dy * 15 - py * 9]]), fill: e.couleur || '#fff', stroke: trait, 'stroke-width': 1.5 }, grp); break; }
      case 'couloir': el('rect', { x: e.x - (e.dx || 16), y: e.y - (e.dy || 10), width: 2 * (e.dx || 16), height: 2 * (e.dy || 10), fill: '#57e389', opacity: 0.6, stroke: trait }, grp); lab(e.x, e.y + 4, e.nom); break;
      case 'poteau': el('circle', { cx: e.x, cy: e.y, r: e.r || 5, fill: '#222', stroke: trait, 'stroke-width': choisi ? 3 : 1 }, grp); break;
      case 'rail': el('polyline', { points: poly(e.pts), fill: 'none', stroke: choisi ? '#1c71d8' : '#6d7480', 'stroke-width': e.ep || 8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, grp); break;
      case 'rampe': {
        el('polyline', { points: poly(e.pts), fill: 'none', stroke: choisi ? '#99c1f1' : '#c0bfbc', opacity: 0.75, 'stroke-width': e.largeur || 42, 'stroke-linejoin': 'round' }, grp);
        el('polyline', { points: poly(e.pts), fill: 'none', stroke: '#5e5c64', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }, grp);
        if (e.pts.length) { el('circle', { cx: e.pts[0][0], cy: e.pts[0][1], r: 7, fill: '#2ec27e' }, grp); lab(e.pts[0][0], e.pts[0][1] + 22, e.nom + ' (entrée)'); }
        break;
      }
    }
    if (choisi) poignees(e, g);
  }

  function poignees(e, g) {
    const pts = e.pts ? e.pts.map((p, k) => [p[0], p[1], k]) : e.type === 'banque' ? [[e.x0, e.y0, 'a'], [e.x1, e.y1, 'b']] : [];
    for (const [x, y, k] of pts) el('circle', { cx: x, cy: y, r: 6, fill: '#fff', stroke: '#1c71d8', 'stroke-width': 2, class: 'poignee', 'data-k': k }, g);
  }

  function dessiner() {
    if (!svg) return;
    svg.innerHTML = '';
    const defs = el('defs', {}, svg), pat = el('pattern', { id: 'hachures', width: 10, height: 10, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    el('rect', { width: 10, height: 10, fill: '#c9ced6' }, pat); el('line', { x1: 0, y1: 0, x2: 0, y2: 10, stroke: '#aab1bb', 'stroke-width': 4 }, pat);
    const gb = el('g', {}, svg); dessinerBase(gb);
    const ge = el('g', {}, svg);
    etat.elements.forEach((e, i) => { if (e.type === 'lampe' || e.type === 'fleche') dessinerElement(e, i, ge); });
    etat.elements.forEach((e, i) => { if (e.type !== 'lampe' && e.type !== 'fleche') dessinerElement(e, i, ge); });
    if (enCours && enCours.pts.length) {
      el('polyline', { points: poly(enCours.pts), fill: 'none', stroke: '#1c71d8', 'stroke-width': enCours.type === 'rampe' ? 42 : 8, opacity: 0.4 }, ge);
      for (const p of enCours.pts) el('circle', { cx: p[0], cy: p[1], r: 4, fill: '#1c71d8' }, ge);
    }
    proprietes();
    const m = document.getElementById('ed-mode');
    if (m) m.textContent = enCours ? `Tracé ${enCours.type} : cliquer les points, double-clic ou Entrée pour finir, Échap pour annuler`
      : mode === 'choisir' ? 'Cliquer un élément pour le choisir, le glisser pour le déplacer ; Suppr pour l\'effacer'
        : `Cliquer sur le plan pour poser : ${mode}`;
  }

  function proprietes() {
    if (!panneau) return;
    const e = etat.elements[sel];
    if (!e) { panneau.innerHTML = `<p class="ed-vide">${etat.elements.length} élément(s). Aucun élément choisi.</p>`; return; }
    let h = `<h4>${e.type}</h4>`;
    for (const k of Object.keys(e)) {
      if (k === 'type') continue;
      const v = e[k], json = typeof v === 'object';
      h += `<label>${k}${json ? `<textarea data-k="${k}" data-json="1" rows="3">${JSON.stringify(v)}</textarea>` : `<input data-k="${k}" value="${String(v).replace(/"/g, '&quot;')}">`}</label>`;
    }
    h += '<button id="ed-suppr">Supprimer</button>';
    panneau.innerHTML = h;
    panneau.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener('change', () => {
      const k = inp.dataset.k; let v = inp.value;
      try { v = inp.dataset.json ? JSON.parse(v) : (v.trim() !== '' && !isNaN(Number(v)) && typeof e[k] === 'number' ? Number(v) : v); } catch (_) { inp.style.background = '#fdd'; return; }
      e[k] = v; envoyer(); dessiner();
    }));
    panneau.querySelector('#ed-suppr').onclick = supprimer;
  }

  function supprimer() { if (sel >= 0) { etat.elements.splice(sel, 1); sel = -1; envoyer(); dessiner(); } }

  function poser(x, y) {
    const t = TYPES[mode]; if (!t) return;
    if (t.points) { if (!enCours) enCours = { type: mode, pts: [] }; enCours.pts.push([x, y]); dessiner(); return; }
    const e = Object.assign({ type: mode }, JSON.parse(JSON.stringify(t.defaut)));
    if (mode === 'banque') Object.assign(e, { prefixe: nomLibre('banque'), x0: x - 30, y0: y, x1: x + 30, y1: y });
    else { const n = nomLibre(mode); if (n) e.nom = n; e.x = x; e.y = y; }
    const ord = Object.assign({ type: e.type }, e.nom ? { nom: e.nom } : {}, e);
    etat.elements.push(ord); sel = etat.elements.length - 1; envoyer(); dessiner();
  }

  function finirTrace() {
    if (!enCours) return;
    if (enCours.pts.length >= 2) {
      const t = TYPES[enCours.type];
      const e = Object.assign({ type: enCours.type, nom: nomLibre(enCours.type), pts: enCours.pts }, JSON.parse(JSON.stringify(t.defaut)));
      if (e.type === 'rampe') e.capteurs = [['Capteur' + e.nom, 0.6]];
      etat.elements.push(e); sel = etat.elements.length - 1; envoyer();
    }
    enCours = null; dessiner();
  }

  function installer(racine) {
    const outils = ['choisir', ...Object.keys(TYPES)];
    racine.innerHTML = `<div class="ed-outils">${outils.map(o => `<button data-o="${o}">${o === 'choisir' ? '↖ choisir' : o}</button>`).join('')}</div>
      <div id="ed-mode" class="ed-mode"></div>
      <div class="ed-corps"><svg id="ed-svg" viewBox="-12 -12 538 1287" preserveAspectRatio="xMidYMin meet"></svg><div id="ed-props" class="ed-props"></div></div>`;
    svg = racine.querySelector('#ed-svg'); panneau = racine.querySelector('#ed-props');
    racine.querySelectorAll('.ed-outils button').forEach(b => b.onclick = () => {
      finirTrace(); mode = b.dataset.o;
      racine.querySelectorAll('.ed-outils button').forEach(x => x.classList.toggle('actif', x === b)); dessiner();
    });
    racine.querySelector('[data-o=choisir]').classList.add('actif');
    svg.addEventListener('pointerdown', ev => {
      const [x, y] = pointMm(ev), po = ev.target.closest('.poignee'), g = ev.target.closest('.elt');
      if (po && sel >= 0) { glisse = { k: po.dataset.k, x, y }; svg.setPointerCapture(ev.pointerId); return; }
      if (mode !== 'choisir') { poser(x, y); return; }
      sel = g ? Number(g.dataset.i) : -1;
      if (sel >= 0) { glisse = { k: null, x, y }; svg.setPointerCapture(ev.pointerId); }
      dessiner();
    });
    svg.addEventListener('pointermove', ev => {
      if (!glisse || sel < 0) return;
      const [x, y] = pointMm(ev), dx = x - glisse.x, dy = y - glisse.y, e = etat.elements[sel];
      if (glisse.k === 'a') { e.x0 = x; e.y0 = y; }
      else if (glisse.k === 'b') { e.x1 = x; e.y1 = y; }
      else if (glisse.k !== null) { e.pts[Number(glisse.k)] = [x, y]; }
      else if (e.pts) e.pts = e.pts.map(p => [arrondi(p[0] + dx), arrondi(p[1] + dy)]);
      else if (e.type === 'banque') { e.x0 = arrondi(e.x0 + dx); e.x1 = arrondi(e.x1 + dx); e.y0 = arrondi(e.y0 + dy); e.y1 = arrondi(e.y1 + dy); }
      else { e.x = arrondi(e.x + dx); e.y = arrondi(e.y + dy); }
      glisse.x = x; glisse.y = y; dessiner();
    });
    svg.addEventListener('pointerup', () => { if (glisse) { glisse = null; envoyer(); } });
    svg.addEventListener('dblclick', finirTrace);
    document.addEventListener('keydown', ev => {
      if (!document.body.contains(svg) || ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (ev.key === 'Enter') finirTrace();
      if (ev.key === 'Escape') { enCours = null; dessiner(); }
      if (ev.key === 'Delete') supprimer();
    });
    dessiner();
  }

  // attente de l'éditeur et des données venant de Python
  setInterval(() => {
    const racine = document.getElementById('editeur-flipper');
    if (racine && !racine.dataset.pret) { racine.dataset.pret = '1'; installer(racine); }
    const ta = pont();
    if (ta && ta.value && ta.value !== ecrit) {
      try {
        const d = JSON.parse(ta.value);
        if (d.jeton !== etat.jeton) { etat = d; sel = -1; enCours = null; ecrit = ta.value; dessiner(); }
      } catch (_) { }
    }
  }, 400);
})();
