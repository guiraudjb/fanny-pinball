import { Sim } from './sim.js';
import { Rules, SW, SND, CITIES } from './rules.js';
import { Renderer } from './render.js';
import { drawSegDisplay } from './segfont.js';
import { unlockAudio, play, toggleMute, playMusic } from './audio.js';
import { W, H, GEO } from './table.js';

const canvas = document.getElementById('table');
const dispScore = document.getElementById('disp-score');
const dispInfo = document.getElementById('disp-info');
const cityEl = document.getElementById('city');
const startBtn = document.getElementById('start');
const muteBtn = document.getElementById('mute');

// Le « matériel » vu par les règles : la simulation + les sons.
let sim;
let audioReady = false;
const hw = {
  coil: (name) => sim.coil(name),
  sound: (id) => {
    play(id);
    // Fanny surgit sur les grands moments (sprites Krea 2, facultatifs)
    if (id === SND.JACKPOT || id === SND.MULTIBALL || id === SND.GRAND_CHELEM) renderer?.fanny('victoire');
    else if (id === SND.START || id === SND.EXTRA) renderer?.fanny('lancer', 1800);
  },
  event: (name, data) => {
    if (name === 'gameOver') try { localStorage.setItem('fanny-pinball-hi', String(rules.highScore)); } catch {}
  },
};
const rules = new Rules(hw);
try { rules.highScore = Number(localStorage.getItem('fanny-pinball-hi')) || 0; } catch {}

sim = new Sim((id, closed = true) => {
  rules.onSwitch(id, closed);
  if (id === SW.DRAIN && rules.mode !== 'play') sim.clear();
});
const renderer = new Renderer(canvas, sim);

// ------------------------------------------------------------ commandes
// Codes physiques (e.code) : indépendants de la disposition AZERTY/QWERTY.
const KEYS = {
  left: ['ShiftLeft', 'ArrowLeft', 'KeyZ'],
  right: ['ShiftRight', 'ArrowRight', 'Slash'],
  launch: ['Space', 'ArrowDown', 'Enter'],
  start: ['Enter', 'KeyS'],
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
  if (rules.mode === 'attract' || rules.mode === 'over') {
    sim.clear();
    rules.onSwitch(SW.START);
  }
}

let paused = false;
window.addEventListener('keydown', (e) => {
  unlockAudio(); audioReady = true;
  if (e.repeat) { if ([...KEYS.left, ...KEYS.right, ...KEYS.launch].includes(e.code)) e.preventDefault(); return; }
  if (KEYS.left.includes(e.code)) { setFlipper('L', true); e.preventDefault(); }
  if (KEYS.right.includes(e.code)) { setFlipper('R', true); e.preventDefault(); }
  if (KEYS.start.includes(e.code) && (rules.mode === 'attract' || rules.mode === 'over')) { pressStart(); e.preventDefault(); return; }
  if (KEYS.launch.includes(e.code)) { rules.onSwitch(SW.LAUNCH); e.preventDefault(); }
  if (e.code === 'KeyP' || e.code === 'Escape') paused = !paused;
  if (e.code === 'KeyM') muteBtn.textContent = toggleMute() ? 'Son : non' : 'Son : oui';
});
window.addEventListener('keyup', (e) => {
  if (KEYS.left.includes(e.code)) setFlipper('L', false);
  if (KEYS.right.includes(e.code)) setFlipper('R', false);
});
window.addEventListener('blur', () => { setFlipper('L', false); setFlipper('R', false); });

// tactile : moitié gauche / moitié droite = flippers, couloir de lancement = lanceur
const touches = new Map();
canvas.addEventListener('pointerdown', (e) => {
  unlockAudio(); audioReady = true;
  canvas.setPointerCapture(e.pointerId);
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W;
  const y = ((e.clientY - r.top) / r.height) * H;
  if (rules.mode === 'attract' || rules.mode === 'over') { pressStart(); return; }
  let what;
  if (x > GEO.playRight - 10 && y > 700) { what = 'launch'; rules.onSwitch(SW.LAUNCH); }
  else { what = x < W / 2 ? 'L' : 'R'; setFlipper(what, true); }
  touches.set(e.pointerId, what);
  e.preventDefault();
});
const release = (e) => {
  const what = touches.get(e.pointerId);
  touches.delete(e.pointerId);
  if (what === 'L' || what === 'R') {
    if (![...touches.values()].includes(what)) setFlipper(what, false);
  }
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

startBtn.addEventListener('click', () => { pressStart(); startBtn.blur(); });
muteBtn.addEventListener('click', () => { unlockAudio(); audioReady = true; muteBtn.textContent = toggleMute() ? 'Son : non' : 'Son : oui'; muteBtn.blur(); });

// ------------------------------------------------------------ mise en page
function layout() {
  const wrap = document.getElementById('playfield');
  const availH = wrap.clientHeight, availW = wrap.clientWidth;
  const k = Math.min(availW / W, availH / H);
  canvas.style.width = `${Math.floor(W * k)}px`;
  canvas.style.height = `${Math.floor(H * k)}px`;
  renderer.resize();
}
window.addEventListener('resize', layout);
layout();

// ------------------------------------------------------------ boucle
let last = performance.now();
let lastScore = 0;
let lastDisp = '';
function frame(t) {
  const dt = Math.min(50, t - last);
  last = t;
  if (!paused) {
    sim.step(dt);
    rules.tick(sim.time);
  }
  renderer.draw(rules);

  if (rules.score > lastScore && rules.mode === 'play') {
    const gain = rules.score - lastScore;
    const b = sim.ballViews()[0];
    if (b && gain >= 1000) renderer.popup(b.x, b.y - 18, `+${gain.toLocaleString('fr-FR')}`);
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
    : `Record : ${rules.highScore.toLocaleString('fr-FR')}`;
  startBtn.hidden = rules.mode === 'play' || rules.mode === 'bonus';

  // musique : générique hors partie (une fois le son déverrouillé), thème en partie
  if (audioReady) playMusic(rules.mode === 'play' || rules.mode === 'bonus' ? 'theme' : 'generique');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// accès console pour le réglage
window.fanny = { sim, rules };
