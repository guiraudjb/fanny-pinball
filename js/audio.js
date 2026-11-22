// Sons synthétisés (WebAudio), un par numéro de piste DFPlayer (voir SND dans rules.js).
// Sur la réplique, chaque numéro correspondra à un fichier 00NN.mp3 sur la carte SD.

import { SND, SND_MAX, isVoice } from './rules.js';

let ac = null;
let master = null;
export let muted = false;

export function unlockAudio() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain();
    master.gain.value = 0.35;
    master.connect(ac.destination);
    loadSounds();
  } catch { ac = null; }
}

export function toggleMute() { muted = !muted; if (music.el) music.el.volume = muted ? 0 : 0.35; return muted; }

function tone(freq, dur, { type = 'sine', vol = 0.5, slide = 0, delay = 0 } = {}) {
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.4, freq = 3000, delay = 0 } = {}) {
  const t = ac.currentTime + delay;
  const len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource(); src.buffer = buf;
  const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
  const g = ac.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

// « clac » de deux boules qui se touchent
function clac(pitch = 1) {
  noise(0.05, { vol: 0.6, freq: 4200 * pitch });
  tone(2100 * pitch, 0.18, { type: 'sine', vol: 0.25 });
  tone(3350 * pitch, 0.12, { type: 'sine', vol: 0.15 });
}

function arp(notes, step = 0.09, type = 'square', vol = 0.18) {
  notes.forEach((n, i) => tone(n, step * 1.6, { type, vol, delay: i * step }));
}

// Vrais bruitages (assets/sons/00NN.mp3, outils/bruitages.py) : chargés au déverrouillage,
// la synthèse ci-dessous ne sert que tant qu'un fichier manque.
const buffers = {};
const SON_GAIN = { [SND.FLIP]: 0.5, [SND.BUMPER]: 0.8, [SND.SLING]: 0.7 };
function loadSounds() {
  for (let id = 1; id <= SND_MAX; id++) {
    if (id === SND.MUSIQUE_GENERIQUE || id === SND.MUSIQUE_THEME) continue;
    fetch(`assets/sons/${String(id).padStart(4, '0')}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((b) => ac.decodeAudioData(b))
      .then((buf) => { buffers[id] = buf; })
      .catch(() => {});
  }
}

let voice = null;   // voix de Fanny : une seule à la fois, la nouvelle coupe l'ancienne
function playBuffer(id) {
  const src = ac.createBufferSource(), g = ac.createGain();
  if (isVoice(id)) {
    try { voice?.stop(); } catch {}
    voice = src;
  }
  src.buffer = buffers[id];
  src.playbackRate.value = id === SND.BUMPER || id === SND.FLIP ? 0.96 + Math.random() * 0.08 : 1;
  g.gain.value = (SON_GAIN[id] ?? 1) * (isVoice(id) ? 2.6 : 2.2);
  src.connect(g); g.connect(master);
  src.start();
}

// Musique : générique à l'accueil, thème en partie (pistes 0022 / 0023, YuE2).
const music = { el: null, which: null };
export function playMusic(which) {
  if (music.which === which) return;
  music.which = which;
  if (music.el) { music.el.pause(); music.el = null; }
  if (!which) return;
  const n = which === 'theme' ? SND.MUSIQUE_THEME : SND.MUSIQUE_GENERIQUE;
  const el = new Audio(`assets/sons/${String(n).padStart(4, '0')}.mp3`);
  el.loop = true; el.volume = muted ? 0 : 0.35;
  el.play().catch(() => {});
  music.el = el;
}

export function play(id) {
  if (!ac || muted) return;
  if (buffers[id]) { playBuffer(id); return; }
  switch (id) {
    case SND.BUMPER: clac(0.9 + Math.random() * 0.25); break;
    case SND.SLING: noise(0.04, { vol: 0.5, freq: 1500 }); tone(320, 0.08, { type: 'triangle', vol: 0.3 }); break;
    case SND.FLIP: noise(0.03, { vol: 0.25, freq: 800 }); break;
    case SND.DROP: tone(520, 0.08, { type: 'square', vol: 0.15, slide: 0.5 }); break;
    case SND.DROPS_DONE: arp([523, 659, 784, 1046]); break;
    case SND.RAMP: tone(300, 0.5, { type: 'sawtooth', vol: 0.12, slide: 3 }); break;
    case SND.LANE: tone(880, 0.1, { type: 'triangle', vol: 0.25 }); break;
    case SND.SPINNER: tone(1340 + Math.random() * 140, 0.025, { type: 'triangle', vol: 0.18 }); noise(0.014, { vol: 0.16, freq: 3200 }); break;
    case SND.LANES_DONE: arp([660, 880, 1100, 1320], 0.07, 'triangle', 0.25); break;
    case SND.STANDUP: clac(1.4); break;
    case SND.SAUCER: tone(180, 0.3, { type: 'triangle', vol: 0.3, slide: 0.5 }); break;
    case SND.MULTIBALL: arp([392, 523, 659, 784, 659, 784, 1046, 1318], 0.11); break;
    case SND.JACKPOT: arp([1046, 1318, 1568, 2093, 1568, 2093], 0.07, 'square', 0.15); break;
    case SND.CITY: arp([523, 784, 659, 1046], 0.12, 'triangle', 0.3); break;
    case SND.GRAND_CHELEM: arp([523, 659, 784, 1046, 784, 1046, 1318, 1568], 0.1, 'triangle', 0.3); break;
    case SND.EXTRA: arp([784, 784, 1046, 1318, 1568], 0.1); break;
    case SND.BALL_SAVE: arp([659, 523, 659, 784], 0.08, 'triangle', 0.3); break;
    case SND.DRAIN: tone(220, 0.7, { type: 'sawtooth', vol: 0.15, slide: 0.3 }); break;
    case SND.BONUS: for (let i = 0; i < 8; i++) tone(600 + i * 60, 0.05, { type: 'square', vol: 0.08, delay: i * 0.12 }); break;
    case SND.GAME_OVER: arp([523, 392, 330, 262], 0.22, 'triangle', 0.3); break;
    case SND.START: arp([392, 523, 659, 784, 1046], 0.09, 'triangle', 0.3); break;
    case SND.LAUNCH: noise(0.12, { vol: 0.4, freq: 600 }); break;
    case SND.NUDGE: tone(70, 0.15, { type: 'sine', vol: 0.5, slide: 0.6 }); noise(0.05, { vol: 0.3, freq: 300 }); break;
    case SND.TILT: tone(110, 0.9, { type: 'sawtooth', vol: 0.18 }); clac(0.4); break;
    case SND.CLAC: clac(0.45); noise(0.08, { vol: 0.7, freq: 400 }); break;
    case SND.MATCH: for (let i = 0; i < 20; i++) tone(900 + (i % 10) * 40, 0.03, { type: 'square', vol: 0.06, delay: i * 0.12 }); break;
  }
}
