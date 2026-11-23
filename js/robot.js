// Robot joueur, niveau tournoi (IFPA) : il ne voit que ce que voit un joueur (billes, palettes, lampes des règles)
// et n'agit que par les commandes d'un joueur (palettes, lanceur, coups de caisse frontaux et latéraux).
// Sert au mode Autoplay dans la page et au banc d'essai headless (outils/robot.mjs).
//
// Répertoire technique complet (voir docs/analyse_de_l_espacement_des_batteurs_et_des_techniques_de_flipper.md) :
//   • Amorti & contrôle : Berceau (Cradle), Live Catch, Drop Catch, Séparation en multibille (Cradle Separation)
//   • Transferts (Passing) : Dead Bounce (rebond mort), Post Pass, Tap Pass, Alley Pass (= Shatz), Changement de couloir T-O-U-R
//   • Tirs de précision : Coup droit (Forehand), Revers (Backhand), Flick / Tip Shot — tous asservis sur la position
//     réelle « le » de la bille le long de la palette (garde-fou anti-perte en bout de palette)
//   • Sauvetage & bourrage : Slap Save (claque synchronisée sur le temps avant impact + nudge latéral),
//     Slide Save (nudge prédictif devant les poteaux d'outlane), Center Nudge (plafonné sous le seuil de Tilt)
import { GEO, BALL_R, CX } from './table.js';
import { tirageLanceur } from './sim.js';
import { SW } from './rules.js';

const MM = 0.001;
const FLIP_LEN = GEO.flippers[0].len;   // 57,7 mm (palette 3")
const Y_POST = GEO.separators[0][0][1]; // haut des poteaux d'outlane (suit H)
const Y_FLIP = GEO.flippers[0].py;      // axe des batteurs (H − 178)
const Y_LANE = GEO.lanes[0].y;          // couloirs T-O-U-R en haut du plateau
const TENUE_TIR_MS = 140;               // palette tenue après une frappe (assez courte pour ne pas rester figée)
const BERCEAU_MS = 240;                 // bille immobile en berceau depuis … avant tir / passe
const TILT_SUR = 1.25;                  // plafond de sim.bob avant un coup d'urgence (+1 < 2,25 < TILT 2,4 : 0 Tilt garanti)
const TILT_SUR_BONUS = 1.05;            // plafond plus conservateur pour le bourrage bonus en haut (garde une marge pour le bas)
const LE_GARDE = FLIP_LEN - 6.5;        // 51,2 mm : au-delà, frappe immédiate (empêche toute perte en bout de palette)
// Forces du lanceur étalonnées sur Rapier au centre de la fenêtre T-O-U-R + bumpers (0 = T, 1 = O, 2 = U, 3 = R)
const FORCE_TOUR = [0.796, 0.792, 0.788, 0.784];

const NOMS_GESTES = {
  berceau: 'Berceau',
  liveCatch: 'Live Catch',
  dropCatch: 'Drop Catch',
  cradleSep: 'Séparation multibille',
  deadBounce: 'Dead Bounce',
  postPass: 'Post Pass',
  tapPass: 'Tap Pass',
  shatz: 'Alley Pass (Shatz)',
  forehand: 'Coup droit',
  backhand: 'Revers',
  flick: 'Flick visé',
  slapSave: 'Slap Save',
  slideSave: 'Slide Save',
  centerNudge: 'Bourrage central',
  bumperNudge: 'Bourrage bonus T-O-U-R',
  skillShot: 'Lancer dosé T-O-U-R',
  laneChange: 'Changement de couloir',
  sauvetage: 'Sauvetage',
};

// géométrie d'une palette dans son repère : r = distance à l'axe, le = le long de la palette, t = au-dessus au repos
function repere(fl, p) {
  const { px, py } = fl.def, sg = fl.def.side === 'L' ? 1 : -1;
  const a = GEO.flippers[0].rest;       // palette droite : repère miroir de la gauche
  const dx = (p.x - px) * sg, dy = p.y - py;
  const c = Math.cos(a), s = Math.sin(a);
  return { r: Math.hypot(dx, dy), le: dx * c + dy * s, t: dx * s - dy * c };
}

// Étalonnage par défaut (issu d'outils/robot_tirs.json), conservé pour compatibilité avec outils/robot.mjs.
export const TIRS_DEFAUT = {
  L: [
    [0, 'drain'], [17, 'drain'], [33, 'drain'], [50, 'drain'], [67, 'drain'], [83, 'drain'], [100, 'drain'], [117, 'drain'],
    [133, '-'], [150, 'drain'], [167, '-'], [183, 'drain'], [200, 'drain'], [217, 'drain'], [233, 'drain'], [250, 'drain'],
    [267, 'drain'], [283, 'drain'], [300, 'drain'], [317, 'drain'], [333, 'drain'], [350, 'dropA'], [367, 'drain'], [383, 'drain'],
    [400, '-'], [417, 'drain'], [433, '-'], [450, 'dropF'], [467, 'dropN1'], [483, 'boule3'], [500, '-'], [517, 'drain'],
    [533, '-'], [550, 'laneR'], [567, '-'], [583, 'dropF'], [600, 'dropA'], [617, 'dropN1'], [633, 'dropY'], [650, 'dropY'],
    [667, '-'], [683, '-'], [700, 'drain'], [717, 'drain'], [733, 'drain'], [750, 'drain'], [767, 'drain'], [783, 'drain'],
    [800, 'drain'],
  ].map(([d, cible]) => ({ d, cible })),
  R: [
    [0, 'drain'], [17, 'drain'], [33, 'drain'], [50, 'drain'], [67, '-'], [83, 'drain'], [100, 'drain'], [117, 'drain'],
    [133, '-'], [150, '-'], [167, '-'], [183, 'drain'], [200, 'drain'], [217, 'drain'], [233, 'drain'], [250, '-'],
    [267, 'drain'], [283, 'drain'], [300, 'drain'], [317, '-'], [333, 'drain'], [350, 'boule1'], [367, 'tirer'], [383, 'drain'],
    [400, 'dropF'], [417, 'drain'], [433, '-'], [450, '-'], [467, '-'], [483, 'laneO'], [500, '-'], [517, '-'],
    [533, 'dropF'], [550, 'dropN1'], [567, '-'], [583, '-'], [600, 'drain'], [617, 'pointer'], [633, 'tirer'], [650, 'tirer'],
    [667, 'dropN1'], [683, '-'], [700, 'drain'], [717, 'drain'], [733, '-'], [750, 'drain'], [767, 'drain'], [783, 'drain'],
    [800, 'drain'],
  ].map(([d, cible]) => ({ d, cible })),
};

// Positions « le » (mm depuis le pivot) étalonnées depuis un berceau (insensibles au point exact d'arrêt en berceau)
const LE_BERCEAU = {
  L: { tirer: 37, saucer: 28, drops: 50, boule: 14 },
  R: { ramp: 31, tirer: 22, bouchon: 36, drops: 26, saucer: 18, boule: 47 },
};

// Positions « le » (mm depuis le pivot) pour un tir visé à la volée sur bille roulante (Flick)
const LE_VOL = {   // outils/etalonner_le.mjs (23/11, physique à prédiction 2 mm et pivotement) : milieu de la plus longue plage
  L: { tirer: 16.75, pointer: 20.5, saucer: 36.25, boule: 45, drops: 50.25, bouchon: 60 },
  R: { saucer: 21.25, drops: 22.5, ramp: 35.75, bouchon: 45.25, pointer: 48, tirer: 52, boule: 56 },
};

// Côté du plateau où se trouve chaque cible (pour distinguer Coup droit / Forehand et Revers / Backhand)
const COTE_CIBLE = {
  ramp: 'L', bouchon: 'L', pointer: 'L', boule1: 'L', boule2: 'L', boule3: 'L',
  saucer: 'R', drops: 'R', dropF: 'R', dropA: 'R', dropN1: 'R', dropN2: 'R', dropY: 'R',
};

const autre = (s) => (s === 'L' ? 'R' : 'L');

export class Robot {
  // act : { flip(side, down), launch(force), nudge(dx) } ; tirs : étalonnage { L: [{ d, cible }], R: [...] }
  constructor(sim, rules, act, tirs = TIRS_DEFAUT) {
    this.sim = sim; this.rules = rules; this.act = act; this.tirs = tirs;
    this.etat = { L: { phase: 'libre', t: 0 }, R: { phase: 'libre', t: 0 } };
    this.lanceur = 0;
    this.lancerPlan = null;            // { force, tirage, lane } : lancer dosé en cours
    this.dernierLancer = -1e9;
    this.echecLanceur = 0;             // compteur de retombées dans le couloir (compense la force si besoin)
    this.dernierNudge = -1e9;
    this.dernierLane = -1e9;
    this.slap = null;                  // { first, second, t, phase }
    this.passeAlt = 0;                 // alterne passe / revers
    this.passeMode = 0;                // alterne Tap Pass (0) / Post Pass (1) / Shatz (2)
    this.catchAlt = 0;                 // alterne Live Catch / Drop Catch / Dead Bounce
    this.dernierGeste = null;          // { code, nom, jusqua } pour affichage HUD en Autoplay
    this.journal = [];
    this.stats = { berceaux: 0, tirs: {}, sauvetages: 0, coups: 0, gestes: {} };
  }

  log(m) {
    this.journal.push(`${(this.sim.time / 1000).toFixed(1)} s ${m}`);
    if (this.journal.length > 500) this.journal.splice(0, this.journal.length - 500);
  }

  noterGeste(code, detail = '') {
    this.stats.gestes[code] = (this.stats.gestes[code] || 0) + 1;
    const nom = NOMS_GESTES[code] || code;
    this.dernierGeste = { code, nom: detail ? `${nom} (${detail})` : nom, jusqua: this.sim.time + 2200 };
    this.log(detail ? `${nom} ${detail}` : nom);
  }

  // Libellé du dernier geste actif (pour l'affichage en mode Autoplay)
  gesteActif() {
    return this.dernierGeste && this.sim.time < this.dernierGeste.jusqua ? this.dernierGeste.nom : null;
  }

  // cible voulue selon les règles (ordre d'un joueur de tournoi qui connaît la table)
  cibleVoulue() {
    const r = this.rules;
    if (r.multiball) return r.superLit ? 'saucer' : 'ramp';
    if (r.mbLit || r.extraLit) return 'saucer';
    if (r.carreauUntil > r.now) return 'tirer';
    if (r.drops.some((d) => !d)) return 'drops';
    return 'ramp';
  }

  leBerceauExact(side, cible) {
    return LE_BERCEAU[side]?.[cible] ?? null;
  }

  estRevers(side, cible) {
    return COTE_CIBLE[cible] === side;
  }

  nudgeSur(dx, code, detail = '', plafond = TILT_SUR, delai = 550) {
    if (this.sim.bob >= plafond || this.sim.time - this.dernierNudge < delai) return false;
    this.dernierNudge = this.sim.time;
    this.act.nudge(dx);
    this.stats.coups++;
    this.noterGeste(code, detail);
    return true;
  }

  // Calcule la direction la plus courte ('L' ou 'R') pour amener une lettre éteinte sur le couloir idx (0..3).
  directionCouloir(idx) {
    const l = this.rules.letters;
    if (!l[idx] || !l.some((v) => !v)) return null;
    let pasR = 4, pasL = 4;
    for (let k = 1; k <= 3; k++) {
      if (pasR === 4 && !l[(idx - k + 4) % 4]) pasR = k;
      if (pasL === 4 && !l[(idx + k) % 4]) pasL = k;
    }
    return pasR <= pasL ? 'R' : 'L';
  }

  tick(dtMs) {
    const sim = this.sim, r = this.rules;
    if (r.mode !== 'play') { this.relacher(); return; }

    // 1. Lanceur à ressort dosé (Skill Shot T-O-U-R → bumpers) : chaque lancer cherche à allumer des lettres bonus
    if (sim.shooterClosed) {
      if (!this.lancerPlan) {
        // si la bille vient juste de retomber dans le couloir, on augmente légèrement la force
        if (sim.time - this.dernierLancer < 2600) this.echecLanceur = Math.min(4, this.echecLanceur + 1);
        else this.echecLanceur = 0;
        // choisir une lettre T-O-U-R éteinte (priorité aux couloirs centraux U-O : au milieu de la fenêtre tolérante ±2 %)
        const ordre = [2, 1, 3, 0];
        const lane = ordre.find((i) => !r.letters[i]) ?? 2;
        // compensation de l'inclinaison réelle de la table (étalonné à 6,5° : plus pentu = tirer plus fort)
        const sinRef = Math.sin((6.5 * Math.PI) / 180);
        const kPente = Math.sqrt(Math.max(0.65, 1 + 0.62 * (Math.sin(sim.pente ?? ((6.5 * Math.PI) / 180)) / sinRef - 1)));
        const base = FORCE_TOUR[lane] * kPente;
        const force = Math.min(1.08, base + this.echecLanceur * 0.032);
        const tirage = tirageLanceur(force);   // course à tirer pour cette force (ressort précomprimé)
        this.lancerPlan = { force, tirage, lane };
      }
      // aligner une lettre éteinte sur le couloir visé avant de lâcher le lanceur (en jouant des palettes)
      if (this.lanceur < 420 && sim.time - this.dernierLane > 110 && r.letters[this.lancerPlan.lane] && r.letters.some((l) => !l)) {
        const s = this.directionCouloir(this.lancerPlan.lane);
        if (s) {
          this.act.flip(s, true); this.act.flip(s, false);
          this.dernierLane = sim.time;
          this.noterGeste('laneChange', 'T-O-U-R');
        }
      }
      this.lanceur += dtMs;
      // tirage progressif jusqu'à la cote dosée (460 ms), courte pause de visée (140 ms), puis lâcher
      sim.tirage = this.lancerPlan.tirage * Math.min(1, this.lanceur / 460);
      if (this.lanceur > 600) {
        const { force, lane } = this.lancerPlan;
        const lettre = 'TOUR'[lane];
        sim.tirage = 0;
        this.act.launch(force);
        this.dernierLancer = sim.time;
        this.lanceur = 0;
        this.lancerPlan = null;
        this.noterGeste('skillShot', `${lettre} · ${Math.round(force * 100)}%`);
      }
    } else {
      if (this.lanceur) sim.tirage = 0;
      this.lanceur = 0;
      this.lancerPlan = null;
    }

    const billes = sim.balls.filter((b) => b.plugin.fp.mode === 'table' && !b.retiree && !sim.dansLanceur(b));
    if (!billes.length) {
      for (const s of ['L', 'R']) if (this.etat[s].phase !== 'libre') { this.act.flip(s, false); this.etat[s] = { phase: 'libre', t: 0 }; }
      this.slap = null;
      return;
    }

    // 2. Changement de couloir T-O-U-R actif en vol (descente de l'arche OU rebond des bumpers vers le haut)
    const basOccupe = billes.some((b) => b.position.y > Y_POST - 100);
    if (!basOccupe && !this.slap && sim.time - this.dernierLane > 95 && r.letters.some((l) => !l) && r.letters.some(Boolean)) {
      let bHaut = null, xPred = 0;
      for (const b of billes) {
        const { x, y } = b.position, vx = b.velocity.x * 60 * MM, vy = b.velocity.y * 60 * MM;
        if (x > 130 && x < 350 && y > Y_LANE - 105 && y < Y_LANE - 6 && vy > -0.20) {
          const dt = Math.min(0.22, (Y_LANE - y) * MM / Math.max(0.25, vy));
          bHaut = b; xPred = x + (vx * dt) / MM; break;
        }
        // bille renvoyée vers le haut par les bumpers en direction des couloirs T-O-U-R
        if (x > 140 && x < 340 && y >= Y_LANE + 10 && y < Y_LANE + 95 && vy < -0.20) {
          const dt = Math.min(0.20, (y - Y_LANE) * MM / (-vy));
          bHaut = b; xPred = x + (vx * dt) / MM; break;
        }
      }
      if (bHaut) {
        const idx = Math.max(0, Math.min(3, Math.floor((xPred - 155) / 42)));
        const s = this.directionCouloir(idx);
        if (s && this.etat[s].phase === 'libre') {
          this.act.flip(s, true);
          this.etat[s] = { phase: 'tenue', t: 0, duree: 38 };
          this.dernierLane = sim.time;
          this.noterGeste('laneChange', `T-O-U-R → ${'TOUR'[idx]}`);
        }
      }
    }

    // 2b. Bourrage bonus en zone haute (arche / couloirs T-O-U-R / bumpers) pour allumer plus de lettres et monter le ×
    const chasseBonus = r.mult < 5 || (sim.time - this.dernierLancer < 6500);
    if (chasseBonus && !basOccupe && !this.slap) {
      for (const b of billes) {
        const { x, y } = b.position, vx = b.velocity.x * 60 * MM, vy = b.velocity.y * 60 * MM;
        // a) bille trop à droite / à gauche de l'entrée T-O-U-R : pousser latéralement vers les couloirs
        if (y > 62 && y < Y_LANE + 12 && vy > 0.04) {
          if (x > 322 && x < 410 && vx < 0.30) {
            if (this.nudgeSur(-1, 'bumperNudge', 'vers T-O-U-R', TILT_SUR_BONUS, 620)) break;
          } else if (x > 108 && x < 160 && vx < -0.10) {
            if (this.nudgeSur(1, 'bumperNudge', 'vers T-O-U-R', TILT_SUR_BONUS, 620)) break;
          }
        }
        // b) bille qui hésite sur le sommet d'un séparateur de couloir T-O-U-R : la faire tomber vers une lettre éteinte
        if (y > Y_LANE - 48 && y < Y_LANE - 6 && x > 148 && x < 330 && Math.abs(vy) < 0.24) {
          const idxLibre = [0, 1, 2, 3].find((i) => !r.letters[i]);
          const xCible = idxLibre !== undefined ? 176 + idxLibre * 42 : CX;
          if (this.nudgeSur(xCible >= x ? 1 : -1, 'bumperNudge', 'entrée couloir', TILT_SUR_BONUS, 620)) break;
        }
        // c) bille dans les bumpers : coup frontal vers le haut pour la remonter dans T-O-U-R, ou latéral pour la garder dans les bumpers
        if (y > Y_LANE + 22 && y < 408 && x > 120 && x < 358) {
          if (y < 292 && vy < -0.15 && vy > -1.45) {
            if (this.nudgeSur(0, 'bumperNudge', 'remontée T-O-U-R', TILT_SUR_BONUS, 620)) break;
          } else if (y > 325 && Math.abs(x - CX) < 52 && vy > 0.14 && vy < 1.35) {
            if (this.nudgeSur(0, 'bumperNudge', 'relance bumpers', TILT_SUR_BONUS, 680)) break;
          } else if (y > 235 && x < 174 && vx < 0.08 && vy > 0.05) {
            if (this.nudgeSur(1, 'bumperNudge', 'retour bumpers', TILT_SUR_BONUS, 680)) break;
          } else if (y > 235 && x > 304 && vx > -0.08 && vy > 0.05) {
            if (this.nudgeSur(-1, 'bumperNudge', 'retour bumpers', TILT_SUR_BONUS, 680)) break;
          }
        }
      }
    }

    // 3. Slide Save : bourrage latéral prédictif UNIQUEMENT si la trajectoire vise un outlane (poteaux à x=40 et x=438)
    for (const b of billes) {
      const { x, y } = b.position, vx = b.velocity.x * 60 * MM, vy = b.velocity.y * 60 * MM;
      if (y > Y_POST - 100 && y < Y_POST + 2 && vy > 0.12) {
        const dtPost = (Y_POST - 4 - y) * MM / vy;
        if (dtPost > 0.30) continue;
        const xPost = x + (vx * dtPost) / MM;
        if (xPost < 46 && x < 72) {
          this.nudgeSur(1, 'slideSave', 'outlane G');
        } else if (xPost > 432 && x > 406) {
          this.nudgeSur(-1, 'slideSave', 'outlane D');
        }
      }
    }

    // 4. Slap Save (sauvetage par claque sur bille SDTM au centre) — déclenché sur le temps réel avant impact
    if (this.slap) {
      const sl = this.slap;
      sl.t += dtMs;
      if (sl.phase === 'first' && sl.t >= 42) {
        this.act.flip(sl.second, true);
        sl.phase = 'both';
      } else if (sl.t >= 140) {
        this.act.flip(sl.first, false);
        this.act.flip(sl.second, false);
        this.etat[sl.first] = { phase: 'libre', t: 0 };
        this.etat[sl.second] = { phase: 'libre', t: 0 };
        this.slap = null;
      }
      return;
    }

    const occupeSlap = (ph) => ph === 'berceau' || ph === 'tir' || ph === 'passe' || ph === 'deadBounce';
    const librePourSlap = !occupeSlap(this.etat.L.phase) && !occupeSlap(this.etat.R.phase);
    if (librePourSlap) {
      for (const b of billes) {
        const { x, y } = b.position, vx = b.velocity.x * 60 * MM, vy = b.velocity.y * 60 * MM;
        if (y > Y_FLIP - 127 && y < Y_FLIP + 15 && vy > 0.18) {
          const dtTips = Math.max(0, (Y_FLIP + 5 - y) * MM / vy);
          if (dtTips > 0.25) continue;
          const xPred = x + (vx * dtTips) / MM;
          if (Math.abs(xPred - CX) < 25) {
            const first = xPred <= CX ? 'L' : 'R', second = autre(first);
            // coup latéral précoce (50 à 200 ms avant les pointes) pour décaler la bille sur le batteur le plus proche
            if (dtTips >= 0.05 && dtTips <= 0.20 && Math.abs(xPred - CX) < 23) {
              this.nudgeSur(first === 'L' ? -1 : 1, 'centerNudge', first);
            }
            // claque synchronisée juste avant la ligne des pointes (jamais 200 ms trop tôt sur bille lente !)
            if (dtTips <= 0.045 || y > Y_FLIP + 1) {
              this.act.flip(first, true);
              this.etat[first] = { phase: 'slap', t: 0 };
              this.etat[second] = { phase: 'slap', t: 0 };
              this.slap = { first, second, t: 0, phase: 'first' };
              this.stats.sauvetages++;
              this.noterGeste('slapSave', `${first}→${second}`);
              return;
            }
          }
        }
      }
    }

    // 5. Pilotage de chaque palette
    for (const fl of sim.T.flippers) this.palette(fl, billes, dtMs);
  }

  // Prépare le batteur opposé à recevoir une passe (Dead Bounce, Post Pass, Tap Pass, Shatz)
  preparerReception(side, raison) {
    const e = this.etat[side];
    if (e.phase === 'libre' || e.phase === 'deadBounce') {
      this.act.flip(side, true);
      this.etat[side] = { phase: 'attrape', t: 0, raison };
    }
  }

  palette(fl, billes, dtMs) {
    const side = fl.def.side, opp = autre(side), e = this.etat[side], sim = this.sim;
    e.t += dtMs;
    const tenir = (down) => { if (this.trace) this.log(`${side} ${down ? 'lève' : 'baisse'} (${e.phase})`); this.act.flip(side, down); };

    // billes dans la zone de la palette (calculé avant tir/passe pour l'asservissement en position q.le)
    const proches = billes.map((b) => ({ b, q: repere(fl, b.position) }))
      .filter(({ q }) => q.r < FLIP_LEN + BALL_R + 42 && q.t > -BALL_R && q.le > -26);

    // --- phases asservies sur la position réelle q.le (plus de minuteur aveugle !) ---
    if (e.phase === 'tir' || e.phase === 'passe') {
      if (!proches.length) { e.phase = 'libre'; e.t = 0; return; }
      const { q } = proches.reduce((m, x) => (x.b.position.y > m.b.position.y ? x : m));
      // déclenche dès que la bille atteint le « le » visé, ou au garde-fou LE_GARDE (51,2 mm) avant la pointe
      const pret = q.le >= e.leVise || q.le >= LE_GARDE || (e.t > 120 && q.t < 2) || e.t >= 950;
      if (pret) {
        tenir(true);
        if (e.phase === 'tir') {
          e.phase = 'tenue'; e.t = 0; e.duree = TENUE_TIR_MS;
          this.stats.tirs[e.cible] = (this.stats.tirs[e.cible] || 0) + 1;
          this.noterGeste(this.estRevers(side, e.cible) ? 'backhand' : 'forehand', `${side} → ${e.cible}`);
        } else {
          e.phase = 'tenue'; e.t = 0; e.duree = e.hold;
          this.noterGeste(e.typePasse, `${side}→${opp}`);
        }
      }
      return;
    }
    if (e.phase === 'cradleSep') {
      if (e.t >= 65) { tenir(true); e.phase = 'berceau'; e.t = 0; }
      return;
    }
    if (e.phase === 'dropCatch') {
      if (!e.lache && e.t >= e.attente) {
        tenir(false); e.lache = true; e.t = 0;
      } else if (e.lache && e.t >= 65) {
        tenir(true); e.phase = 'attrape'; e.t = 0; e.raison = 'dropCatch';
      }
      return;
    }
    if (e.phase === 'deadBounce') {
      if (e.t > 340) { e.phase = 'libre'; e.t = 0; }
      return;
    }
    if (e.phase === 'tenue') {
      if (e.t >= (e.duree ?? TENUE_TIR_MS)) { tenir(false); e.phase = 'libre'; e.t = 0; }
      return;
    }

    // détection anticipée d'une bille descendant l'inlane de ce côté (pour lever tôt et réussir le Berceau)
    const bInlane = billes.find((b) => (side === 'L' ? b.position.x < 145 : b.position.x > 333)
      && b.position.y > Y_POST + 20 && b.position.y < Y_FLIP - 2 && b.velocity.y * 60 * MM > 0.05);
    if (e.phase === 'libre' && bInlane && billes.length === 1 && !proches.length) {
      tenir(true); e.phase = 'attrape'; e.t = 0; e.raison = 'berceau';
      return;
    }

    if (!proches.length) {
      const delai = e.raison === 'passe' ? 1500 : bInlane ? 1700 : 800;
      if (e.phase !== 'libre' && (e.phase !== 'attrape' || e.t > delai)) { tenir(false); e.phase = 'libre'; e.t = 0; }
      return;
    }

    // bille la plus basse (la plus urgente)
    const { b, q } = proches.reduce((m, x) => (x.b.position.y > m.b.position.y ? x : m));
    const vx = b.velocity.x * 60 * MM, vy = b.velocity.y * 60 * MM, v = b.vitesse;

    // --- berceau (Cradle) ---
    if (e.phase === 'berceau') {
      if (proches.length >= 2 && e.t > 120) {
        tenir(false);
        e.phase = 'cradleSep'; e.t = 0;
        this.noterGeste('cradleSep', side);
        return;
      }
      if (v > 0.08) { e.t = 0; return; }
      if (e.t < BERCEAU_MS) return;

      const cible = this.cibleVoulue();
      const leExact = this.leBerceauExact(side, cible);
      const leOpp = this.leBerceauExact(opp, cible);
      // transférer vers l'autre batteur si la cible n'est atteignable que de l'autre côté, ou en alternance sur revers
      const preferePasse = (leExact === null && leOpp !== null)
        || (leOpp !== null && this.estRevers(side, cible) && !this.estRevers(opp, cible) && (this.passeAlt % 3 === 0));

      if (preferePasse && billes.length === 1 && this.etat[opp].phase === 'libre') {
        this.preparerReception(opp, 'passe');
        tenir(false);
        this.passeAlt++;
        const mode = this.passeMode++ % 3;
        if (mode === 0) {
          e.phase = 'passe'; e.leVise = 49; e.hold = 35; e.typePasse = 'tapPass'; e.t = 0;
        } else if (mode === 1) {
          e.phase = 'passe'; e.leVise = 16; e.hold = 150; e.typePasse = 'postPass'; e.t = 0;
        } else {
          e.phase = 'passe'; e.leVise = 45; e.hold = 35; e.typePasse = 'shatz'; e.t = 0;
        }
        return;
      }
      if (this.estRevers(side, cible) && !this.estRevers(opp, cible)) this.passeAlt++;

      // sur R, quand drops est voulu en revers, on peut aussi viser la rampe (coup droit très sûr à le=31)
      const cibleFinale = leExact !== null ? cible : (side === 'R' ? 'ramp' : 'drops');
      const leVise = Math.min(LE_GARDE, this.leBerceauExact(side, cibleFinale) ?? 34);
      tenir(false);
      e.phase = 'tir'; e.leVise = leVise; e.cible = cibleFinale; e.t = 0;
      return;
    }

    // --- capture en cours (Cradle / Live Catch / Drop Catch / réception de passe) ---
    if (e.phase === 'attrape') {
      if (v < 0.12 && q.r < FLIP_LEN + 28) {
        e.phase = 'berceau'; e.t = 0;
        this.stats.berceaux++;
        if (e.raison !== 'liveCatch' && e.raison !== 'dropCatch') this.noterGeste('berceau', side);
        e.raison = null;
        return;
      }
      if (e.t > 2400) { tenir(false); e.phase = 'libre'; e.t = 0; }
      return;
    }

    // --- libre : bille qui descend vers la palette ou roule dessus ---
    const surPalette = q.t < BALL_R + 18;
    const dansInlane = (side === 'L' ? b.position.x < 145 : b.position.x > 333) && b.position.y > Y_POST + 40;

    // A. Bille qui descend du plateau vers la palette
    if (!surPalette && vy > 0.15 && q.le > -4 && q.le < FLIP_LEN + 18) {
      const avance = vy * 1000;                      // mm/s
      const tImpMs = Math.max(0, ((q.t - BALL_R - 7) / avance) * 1000);
      const sg = side === 'L' ? 1 : -1;
      const leImp = q.le + (vx * sg * tImpMs);

      // ne pas réagir sur une bille qui passe hors portée de cette palette (laisse le Slap Save gérer le centre)
      if (leImp > FLIP_LEN + 10) return;

      // 1. Retour depuis l'inlane : lever tôt pour un Berceau propre
      if (dansInlane && billes.length === 1 && tImpMs < 240) {
        tenir(true); e.phase = 'attrape'; e.t = 0; e.raison = 'berceau';
        return;
      }

      // 2. Dead Bounce : rebond mort vers le batteur opposé levé (uniquement dans la fenêtre sûre leImp ∈ [26..44])
      const cible = this.cibleVoulue();
      const prefereOpp = this.leBerceauExact(side, cible) === null && this.leBerceauExact(opp, cible) !== null;
      if (billes.length === 1 && this.etat[opp].phase === 'libre'
          && v >= 0.80 && v <= 1.35 && Math.abs(vx) < 0.30 && leImp >= 26 && leImp <= 44 && tImpMs < 110
          && (prefereOpp || (this.catchAlt % 5 === 4))) {
        this.catchAlt++;
        this.preparerReception(opp, 'passe');
        e.phase = 'deadBounce'; e.t = 0;
        this.noterGeste('deadBounce', `${side}→${opp}`);
        return;
      }

      // 3. Drop Catch ou Live Catch : amorti contrôlé sur bille descendante (en simple bille)
      if (billes.length === 1 && v >= 0.45 && v <= 2.1 && Math.abs(vx) < 0.90 && leImp >= 10 && leImp <= 48) {
        const modeCatch = this.catchAlt % 2;
        if (modeCatch === 0 && tImpMs > 42 && tImpMs < 120) {
          this.catchAlt++;
          tenir(true);
          e.phase = 'dropCatch'; e.t = 0; e.lache = false; e.attente = Math.max(16, tImpMs - 28);
          this.noterGeste('dropCatch', side);
          return;
        }
        if (tImpMs <= 38) {
          this.catchAlt++;
          tenir(true);
          e.phase = 'attrape'; e.t = 0; e.raison = 'liveCatch';
          this.noterGeste('liveCatch', side);
          return;
        }
        return;
      }

      // 4. Bille très rapide ou multibille : frappe de sauvetage juste avant l'impact (jamais trop tôt)
      if (tImpMs <= 34 && leImp >= 6) {
        tenir(true); e.phase = 'tenue'; e.t = 0; e.duree = TENUE_TIR_MS;
        this.stats.sauvetages++;
        this.noterGeste('sauvetage', side);
      }
      return;
    }

    // B. Bille roulant sur la palette vers la pointe : Flick visé au bon « le », ou garde-fou LE_GARDE
    if (surPalette) {
      const cible = this.cibleVoulue();
      const leCible = Math.min(LE_GARDE, LE_VOL[side][cible] ?? 36);
      if (q.le >= leCible && q.le <= FLIP_LEN + 8) {
        tenir(true); e.phase = 'tenue'; e.t = 0; e.duree = TENUE_TIR_MS;
        this.stats.tirs[cible] = (this.stats.tirs[cible] || 0) + 1;
        this.noterGeste('flick', `${side} → ${cible}`);
      } else if (q.le >= LE_GARDE) {
        tenir(true); e.phase = 'tenue'; e.t = 0; e.duree = TENUE_TIR_MS;
        this.stats.sauvetages++;
        this.noterGeste('sauvetage', side);
      }
    }
  }

  relacher() {
    this.lanceur = 0;
    this.lancerPlan = null;
    this.echecLanceur = 0;
    this.sim.tirage = 0;
    this.slap = null;
    for (const s of ['L', 'R']) { this.act.flip(s, false); this.etat[s] = { phase: 'libre', t: 0 }; }
  }
}

// Étalonnage des tirs depuis le berceau (utilisé par outils/robot.mjs --etalonner).
export async function etalonner(creer) {
  const tirs = { L: [], R: [] };
  const { sim, contacts } = await creer();
  for (const side of ['L', 'R']) {
    const fl = sim.T.flippers.find((f) => f.def.side === side);
    for (let n = 0; n <= 48; n++) {
      const d = Math.round(n * 1000 / 60);
      // mise en berceau : la bille descend le couloir de retour à une vitesse d'arrivée qui la bloque sur la palette levée
      // (lâchée sans vitesse, elle peut passer par-dessus la pointe, comme sur un vrai jeu)
      let b = null;
      for (const v of [1.0, 0.5, 1.5, 0]) {
        sim.clear(); contacts.length = 0;
        sim.held = { L: false, R: false }; sim.held[side] = true;
        for (let k = 0; k < 10; k++) sim.step(1000 / 60);
        b = sim.makeBall(side === 'R' ? 417 : 61, Y_POST);
        sim.setVitesse(b, 0, v * 1000 / 60);
        for (let k = 0; k < 210; k++) sim.step(1000 / 60);
        if (!b.retiree && repere(fl, b.position).r <= FLIP_LEN + 30 && b.vitesse <= 0.05) break;
        b = null;
      }
      if (!b) continue;
      contacts.length = 0;
      let cible = null;
      for (let k = 0; k < 60 * 3 && !b.retiree; k++) {
        sim.held[side] = k >= n && k < n + Math.round(TENUE_TIR_MS * 60 / 1000);
        sim.step(1000 / 60);
        cible = contacts.find((c) => /^(ramp|drop|saucer|bouchon|tirer|pointer|boule|lane|drain)/.test(c));
        if (cible) break;
      }
      tirs[side].push({ d, cible: cible || (b.retiree ? 'perdue' : '-') });
    }
  }
  return tirs;
}

export { SW, CX };
