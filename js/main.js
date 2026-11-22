import { creerSim } from './sim.js';
import { Rules, SW, SND, CITIES } from './rules.js';
import { Renderer } from './render.js';
import { drawSegDisplay } from './segfont.js';
import { unlockAudio, play, toggleMute, playMusic } from './audio.js';
import { W, H, GEO } from './table.js';
import { Robot } from './robot.js';

const canvas = document.getElementById('table');
const view3dEl = document.getElementById('view3d');
const viewBtn = document.getElementById('view');
const camBtn = document.getElementById('camera');
const lockBtn = document.getElementById('verrou');
const skinBtn = document.getElementById('habillage');
const transportBtn = document.getElementById('transport');
const playfieldEl = document.getElementById('playfield');
const dispScore = document.getElementById('disp-score');
const dispInfo = document.getElementById('disp-info');
const cityEl = document.getElementById('city');
const startBtn = document.getElementById('start');
const autoBtn = document.getElementById('autoplay');
const muteBtn = document.getElementById('mute');

// Le « matériel » vu par les règles : la simulation + les sons.
let sim;
let audioReady = false;
const hw = {
  coil: (name) => sim.coil(name),
  sound: (id) => {
    play(id);
    // Fanny surgit sur les grands moments (sprites Krea 2, facultatifs)
    if (id === SND.JACKPOT || id === SND.MULTIBALL || id === SND.GRAND_CHELEM) view?.fanny('victoire');
    else if (id === SND.START || id === SND.EXTRA) view?.fanny('lancer', 1800);
  },
  event: (name, data) => {
    if (name === 'gameOver') try { localStorage.setItem('fanny-pinball-hi', String(rules.highScore)); } catch {}
    if (name === 'credits') try { localStorage.setItem('fanny-pinball-credits', String(data.credits)); } catch {}
  },
};
const rules = new Rules(hw);
try { rules.highScore = Number(localStorage.getItem('fanny-pinball-hi')) || 0; } catch {}
try { rules.credits = Number(localStorage.getItem('fanny-pinball-credits')) || 0; } catch {}

// physique 3D (Rapier) : moteur WebAssembly et surfaces de la CAO chargés avant la première image
sim = await creerSim((id, closed = true) => {
  rules.onSwitch(id, closed);
  if (id === SW.DRAIN && rules.mode !== 'play') sim.clear();
});
const renderer = new Renderer(canvas, sim);

// ------------------------------------------------------------ vue 2D / 3D
// La vue 3D (Three.js) n'est chargée qu'à la première demande ; la physique est la même.
let renderer3d = null;
let view = renderer;
const has3d = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })();
let mode3d = false;
function viewLabel() {
  viewBtn.textContent = !mode3d ? 'Vue : 2D' : renderer3d.light ? 'Vue : 3D légère' : 'Vue : 3D';
  camBtn.hidden = !mode3d;
  if (mode3d) camBtn.textContent = `Caméra : ${renderer3d.cameraNom}`;
  // vue machine : on choisit l'angle et le zoom, puis on verrouille pour jouer
  lockBtn.hidden = !mode3d || !renderer3d.enMachine;
  // habillage de la caisse : visible quand la caméra montre la machine entière
  skinBtn.hidden = !mode3d || !(renderer3d.enMachine || renderer3d.enTour);
  if (!skinBtn.hidden) skinBtn.textContent = `Habillage : ${renderer3d.habillageNom}`;
  transportBtn.hidden = skinBtn.hidden;
  transportBtn.textContent = `Fronton : ${renderer3d.frontonPlie ? 'rabattu (transport)' : 'assemblé'}`;
  if (!lockBtn.hidden) {
    const v = renderer3d.vueMachine?.verrou;
    lockBtn.textContent = v ? 'Déverrouiller la vue' : 'Verrouiller la vue';
    lockBtn.classList.toggle('actif', !!v);
  }
}
// bouton Vue / touche V : 2D → 3D → 3D légère → 2D
function nextView() {
  if (!mode3d) setView(true);
  else if (!renderer3d.light) { renderer3d.setLight(true); viewLabel(); }
  else { renderer3d.setLight(false); setView(false); }
}
async function setView(want3d) {
  if (want3d && !has3d) want3d = false;
  if (want3d && !renderer3d) {
    try {
      const { Renderer3D } = await import('./render3d.js');
      renderer3d = new Renderer3D(document.getElementById('table3d'), document.getElementById('overlay3d'), sim);
      renderer3d.onQualite = viewLabel;
    } catch (e) { console.error('vue 3D indisponible', e); want3d = false; }
  }
  mode3d = want3d;
  view = mode3d ? renderer3d : renderer;
  canvas.hidden = mode3d;
  view3dEl.hidden = !mode3d;
  viewBtn.hidden = !has3d;
  try { localStorage.setItem('fanny-pinball-vue', mode3d ? '3d' : '2d'); } catch {}
  layout();
  viewLabel();
}

// ------------------------------------------------------------ commandes
// Codes physiques (e.code) : indépendants de la disposition AZERTY/QWERTY.
const KEYS = {
  left: ['ShiftLeft', 'ArrowLeft', 'KeyZ'],
  right: ['ShiftRight', 'ArrowRight', 'Slash'],
  launch: ['ArrowDown', 'Enter'],
  nudge: ['Space', 'ArrowUp'],   // bourrage frontal : coup de caisse vers l'avant
  nudgeL: ['ControlLeft'],       // bourrage latéral gauche (Slide Save / Slap Save)
  nudgeR: ['ControlRight'],      // bourrage latéral droit
  start: ['Enter', 'KeyS'],
  coin: ['KeyC', 'Digit5'],      // pièce (monnayeur de la réplique)
};

function setFlipper(side, down) {
  if (sim.held[side] === down) return;
  sim.held[side] = down;
  if (down) {
    play(SND.FLIP);
    rules.onSwitch(side === 'L' ? SW.FLIP_L : SW.FLIP_R, true);
  }
}

function pressStart() {
  unlockAudio(); audioReady = true;
  if (rules.canStart()) {
    sim.clear();
    rules.onSwitch(SW.START);
  }
}

// Bourrage : la table tressaute (frontal ou latéral gauche/droite), coup sourd dans la caisse
function nudge(dx = 0) {
  if (paused || rules.mode !== 'play') return;
  if (!sim.nudge(dx)) return;
  play(SND.NUDGE);
  const tr = dx ? `translateX(${-dx * 6}px)` : 'translateY(-5px)';
  (mode3d ? view3dEl : canvas).animate([{ transform: 'translate(0,0)' }, { transform: tr }, { transform: 'translate(0,0)' }],
    { duration: 140, easing: 'ease-out' });
}

let paused = false;
// Autoplay : le robot (js/robot.js) lance et enchaîne les parties tout seul jusqu'à l'arrêt du mode.
let autoplay = false;
let autoplayAttente = 0;
const AUTOPLAY_DELAI_MS = 2500;   // courte pause après la fin de partie / loterie avant de relancer
const robot = new Robot(sim, rules, {
  flip: (side, down) => setFlipper(side, down),
  launch: (force) => { sim.force = force; rules.onSwitch(SW.LAUNCH); },
  nudge: () => nudge(),
});
function setAutoplay(on) {
  autoplay = !!on;
  autoplayAttente = 0;
  autoBtn.textContent = autoplay ? 'Autoplay : oui' : 'Autoplay';
  autoBtn.classList.toggle('actif', autoplay);
  if (autoplay) {
    unlockAudio(); audioReady = true;
    paused = false;
    relacher(false);
    if (rules.canStart()) pressStart();
  } else {
    robot.relacher();
  }
}
// lanceur à ressort : maintenir pour tirer (pleine course en TIRAGE_S), relâcher pour lancer. La vitesse suit la
// course : 30 % de la vitesse nominale à peine tiré (la bille retombe sur le lanceur), 110 % tiré à fond.
const TIRAGE_S = 0.9;
let tirageDebut = null;
const tirer = () => { if (tirageDebut === null) tirageDebut = performance.now(); };
function relacher(lancer = true) {
  if (tirageDebut === null) return;
  const p = Math.min(1, (performance.now() - tirageDebut) / 1000 / TIRAGE_S);
  tirageDebut = null;
  sim.tirage = 0;
  if (!lancer) return;
  sim.force = 0.3 + 0.8 * p;
  rules.onSwitch(SW.LAUNCH);
}
window.addEventListener('keydown', (e) => {
  unlockAudio(); audioReady = true;
  if (e.repeat) { if ([...KEYS.left, ...KEYS.right, ...KEYS.launch, ...KEYS.nudge, ...KEYS.nudgeL, ...KEYS.nudgeR].includes(e.code)) e.preventDefault(); return; }
  if (e.code === 'KeyA') { setAutoplay(!autoplay); e.preventDefault(); return; }
  if (KEYS.nudge.includes(e.code)) { nudge(0); e.preventDefault(); return; }
  if (KEYS.nudgeL.includes(e.code)) { nudge(-1); e.preventDefault(); return; }
  if (KEYS.nudgeR.includes(e.code)) { nudge(1); e.preventDefault(); return; }
  if (KEYS.left.includes(e.code)) { if (autoplay) setAutoplay(false); setFlipper('L', true); e.preventDefault(); }
  if (KEYS.right.includes(e.code)) { if (autoplay) setAutoplay(false); setFlipper('R', true); e.preventDefault(); }
  if (KEYS.start.includes(e.code) && rules.canStart()) { if (autoplay) setAutoplay(false); pressStart(); e.preventDefault(); return; }
  if (KEYS.coin.includes(e.code)) { rules.onSwitch(SW.COIN); e.preventDefault(); return; }
  if (KEYS.launch.includes(e.code)) { if (autoplay) setAutoplay(false); tirer(); e.preventDefault(); }
  if (e.code === 'KeyP' || e.code === 'Escape') paused = !paused;
  if (e.code === 'KeyM') muteBtn.textContent = toggleMute() ? 'Son : non' : 'Son : oui';
  if (e.code === 'KeyV') nextView();
  if (e.code === 'KeyK' && mode3d) { renderer3d.cycleCamera(); viewLabel(); }
  if (e.code === 'KeyL' && mode3d && renderer3d.enMachine) { renderer3d.basculerVerrou(); viewLabel(); }
  if (e.code === 'KeyH' && !skinBtn.hidden) { renderer3d.cycleHabillage(); viewLabel(); }
  if (e.code === 'KeyT' && !transportBtn.hidden) { renderer3d.basculerFronton(); viewLabel(); }
});
window.addEventListener('keyup', (e) => {
  if (KEYS.left.includes(e.code)) setFlipper('L', false);
  if (KEYS.right.includes(e.code)) setFlipper('R', false);
  if (KEYS.launch.includes(e.code)) relacher();
});
window.addEventListener('blur', () => { setFlipper('L', false); setFlipper('R', false); relacher(false); });

// tactile : moitié gauche / moitié droite = flippers, couloir de lancement = lanceur
const touches = new Map();
function toTable(e) {
  if (mode3d) return renderer3d.toTable(e.clientX, e.clientY);
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}
for (const el of [canvas, view3dEl]) el.addEventListener('pointerdown', (e) => {
  unlockAudio(); audioReady = true;
  el.setPointerCapture(e.pointerId);
  // caméra « tour » ou vue machine déverrouillée : glisser fait tourner la vue (le jeu reste au clavier)
  if (mode3d && renderer3d.pilotable) {
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointeurs.size === 1) renderer3d.tourDown(e.clientX, e.clientY); else renderer3d.tourUp();
    e.preventDefault(); return;
  }
  const { x, y } = toTable(e);
  if (autoplay) setAutoplay(false);
  if (rules.mode === 'attract' || rules.mode === 'over') { pressStart(); return; }
  let what;
  if (x > GEO.playRight - 10 && y > 700) { what = 'launch'; tirer(); }
  else { what = x < W / 2 ? 'L' : 'R'; setFlipper(what, true); }
  touches.set(e.pointerId, what);
  e.preventDefault();
});
const release = (e) => {
  const what = touches.get(e.pointerId);
  touches.delete(e.pointerId);
  if (what === 'launch') relacher(e.type === 'pointerup');
  if (what === 'L' || what === 'R') {
    if (![...touches.values()].includes(what)) setFlipper(what, false);
  }
};
for (const el of [canvas, view3dEl]) { el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release); }
// pilotage de la caméra : un doigt tourne, deux doigts pincent pour zoomer
const pointeurs = new Map();
const ecart = () => { const [a, b] = [...pointeurs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
view3dEl.addEventListener('pointermove', (e) => {
  if (!renderer3d?.pilotable || !pointeurs.has(e.pointerId)) return;
  if (pointeurs.size === 2) {
    const avant = ecart();
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (avant > 0) renderer3d.zoomer(avant / ecart());
  } else {
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    renderer3d.tourMove(e.clientX, e.clientY);
  }
});
for (const t of ['pointerup', 'pointercancel']) view3dEl.addEventListener(t, (e) => {
  pointeurs.delete(e.pointerId);
  if (!renderer3d) return;
  renderer3d.tourUp();
  const [reste] = pointeurs.values();
  if (reste) renderer3d.tourDown(reste.x, reste.y);
});
view3dEl.addEventListener('wheel', (e) => {
  if (!mode3d || !renderer3d.pilotable) return;
  renderer3d.tourZoom(e.deltaY);
  e.preventDefault();
}, { passive: false });

startBtn.addEventListener('click', () => { if (autoplay) setAutoplay(false); pressStart(); startBtn.blur(); });
autoBtn.addEventListener('click', () => { setAutoplay(!autoplay); autoBtn.blur(); });
viewBtn.addEventListener('click', () => { nextView(); viewBtn.blur(); });
camBtn.addEventListener('click', () => { renderer3d.cycleCamera(); viewLabel(); camBtn.blur(); });
skinBtn.addEventListener('click', () => { renderer3d.cycleHabillage(); viewLabel(); skinBtn.blur(); });
transportBtn.addEventListener('click', () => { renderer3d.basculerFronton(); viewLabel(); transportBtn.blur(); });
lockBtn.addEventListener('click', () => { renderer3d.basculerVerrou(); viewLabel(); lockBtn.blur(); });
muteBtn.addEventListener('click', () => { unlockAudio(); audioReady = true; muteBtn.textContent = toggleMute() ? 'Son : non' : 'Son : oui'; muteBtn.blur(); });

// ------------------------------------------------------------ mise en page
function layout() {
  const availH = playfieldEl.clientHeight, availW = playfieldEl.clientWidth;
  if (mode3d) {
    const w = Math.floor(Math.min(availW, availH * 0.8)), h = Math.floor(availH);
    view3dEl.style.width = `${w}px`; view3dEl.style.height = `${h}px`;
    renderer3d.resize(w, h);
    return;
  }
  const k = Math.min(availW / W, availH / H);
  canvas.style.width = `${Math.floor(W * k)}px`;
  canvas.style.height = `${Math.floor(H * k)}px`;
  renderer.resize();
}
window.addEventListener('resize', layout);
layout();
{
  let pref = null;
  try { pref = localStorage.getItem('fanny-pinball-vue'); } catch {}
  setView(pref ? pref === '3d' : has3d);    // 3D par défaut quand le navigateur la permet
}

// ------------------------------------------------------------ boucle
let last = performance.now();
let lastScore = 0;
let lastDisp = '';
function frame(t) {
  const dt = Math.min(100, t - last);   // rattrape le temps réel jusqu'à 10 images/s
  last = t;
  if (tirageDebut !== null) sim.tirage = Math.min(1, (performance.now() - tirageDebut) / 1000 / TIRAGE_S);
  if (!paused) {
    sim.step(dt);
    rules.tick(sim.time);
    if (autoplay) {
      if (rules.mode === 'play') {
        autoplayAttente = 0;
        robot.tick(dt);
      } else {
        robot.relacher();
        if (rules.canStart()) {
          autoplayAttente += dt;
          if (autoplayAttente >= AUTOPLAY_DELAI_MS) { autoplayAttente = 0; pressStart(); }
        } else {
          autoplayAttente = 0;
        }
      }
    }
  }
  try { view.draw(rules); } catch (e) {   // un défaut de dessin ne doit jamais arrêter la partie
    if (!frame.drawErr) { frame.drawErr = true; console.error('dessin', e); }
  }

  if (rules.score > lastScore && rules.mode === 'play') {
    const gain = rules.score - lastScore;
    const b = sim.ballViews()[0];
    if (b && gain >= 1000) view.popup(b.x, b.y - 18, `+${gain.toLocaleString('fr-FR')}`);
  }
  lastScore = rules.score;

  const d = rules.display();
  const key = d.score + d.info + paused;
  if (key !== lastDisp) {
    lastDisp = key;
    drawSegDisplay(dispScore, paused ? '  PAUSE ' : d.score);
    drawSegDisplay(dispInfo, d.info, { on: '#ffb020', off: 'rgba(255,176,32,0.08)' });
  }
  cityEl.textContent = rules.mode === 'play' || rules.mode === 'bonus'
    ? `Escale : ${CITIES[rules.city].charAt(0) + CITIES[rules.city].slice(1).toLowerCase()} · bille ${rules.ball} · bonus ×${rules.mult}${rules.multiball ? ' · MULTIBALL' : ''}`
    : `Record : ${rules.highScore.toLocaleString('fr-FR')}${rules.credits ? ` · parties gratuites : ${rules.credits}` : ''}`;
  startBtn.hidden = !rules.canStart();

  // musique : générique hors partie (une fois le son déverrouillé), thème en partie
  if (audioReady) playMusic(rules.mode === 'play' || rules.mode === 'bonus' ? 'theme' : 'generique');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// accès console pour le réglage
window.fanny = { sim, rules, robot, get view() { return view; }, setView, setAutoplay };
