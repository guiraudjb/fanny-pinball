// Règles du jeu, indépendantes de la physique et du rendu — esprit flipper des années 70.
//
// Ce module ne voit que ce que verra l'Arduino Mega de la réplique physique :
//   entrées  : contacts (onSwitch)                → micro-rupteurs, boutons d'arcade
//   sorties  : bobines (hw.coil), sons (hw.sound) → MOSFET + solénoïdes, DFPlayer Mini
//              lampes (lamps())                   → bande WS2812B
//              afficheurs (display())             → TM1637 (2 × 4 chiffres score + 4 chiffres info)
// Il doit rester portable tel quel en C++ : compteurs, drapeaux et minuteries seulement.
//
// Règles :
//   • F-A-N-N-Y (cibles tombantes) allume le Cercle ; bille dans le Cercle allumé = MULTIBALL (3 billes).
//   • Bumpers (tous les 3 coups) et couloirs du haut allument T-O-U-R ; TOUR complet = bonus ×2, ×3 … ×5.
//     Changement de couloir : chaque appui sur un batteur décale les lettres allumées.
//   • Couloir du BOUCHON (haut gauche) : allume le CARREAU sur TIRER pendant 20 s (carreau = lettre + k × 10 000).
//     POINTER puis BOUCHON = BIBERON (+5 000).
//   • Trois cibles rondes du mur gauche : les trois = TRIPLETTE (+3 000, lettre T-O-U-R, boule pointée).
//   • Rampe : allume l'escale suivante du World Tour ; en multiball, chaque rampe = JACKPOT.
//   • 7 escales = GRAND CHELEM + bille supplémentaire (une fois par partie).
//   • 3 billes, sauvetage de bille 8 s, bonus de fin de bille × multiplicateur.

export const SW = {
  FLIP_L: 'flipL', FLIP_R: 'flipR', LAUNCH: 'launch', START: 'start',
  LANES: ['laneT', 'laneO', 'laneU', 'laneR'],
  DROPS: ['dropF', 'dropA', 'dropN1', 'dropN2', 'dropY'],
  STANDUPS: ['pointer', 'tirer', 'bouchon'],
  TARGETS: ['boule1', 'boule2', 'boule3'],   // cibles rondes du mur gauche
  SAUCER: 'saucer', RAMP: 'ramp',
  SLINGS: ['slingL', 'slingR'], BUMPERS: ['bumper1', 'bumper2', 'bumper3'],
  SHOOTER: 'shooter', DRAIN: 'drain',
};

export const COIL = { TROUGH: 'trough', LAUNCH: 'autoLaunch', SAUCER: 'saucerKick', DROP_RESET: 'dropReset' };

// Numéros de pistes du DFPlayer (0001.mp3 …)
export const SND = {
  START: 1, BUMPER: 2, SLING: 3, FLIP: 4, DROP: 5, DROPS_DONE: 6, RAMP: 7, LANE: 8, LANES_DONE: 9,
  STANDUP: 10, SAUCER: 11, MULTIBALL: 12, JACKPOT: 13, CITY: 14, GRAND_CHELEM: 15, EXTRA: 16,
  BALL_SAVE: 17, DRAIN: 18, BONUS: 19, GAME_OVER: 20, LAUNCH: 21,
};

export const CITIES = ['MARSEILLE', 'PARIS', 'LONDRES', 'NEW YORK', 'TOKYO', 'RIO', 'SYDNEY'];

const BALLS_PER_GAME = 3;
const BALL_SAVE_MS = 8000;
const MB_BALL_SAVE_MS = 10000;
const BUMPER_HITS_PER_LETTER = 3;
const MAX_MULT = 5;
const JACKPOT_START = 20000;
const JACKPOT_STEP = 5000;
const CARREAU_MS = 20000;   // durée du carreau allumé après un tir au bouchon
const CARREAU_PTS = 10000;  // carreau n°k = k × 10 000

export class Rules {
  constructor(hw) {
    this.hw = hw;            // { coil(name), sound(id), event?(name, data) }
    this.now = 0;
    this.timers = [];
    this.highScore = 0;
    this.lastScore = 0;
    this.mode = 'attract';   // attract | play | bonus | over
    this.msg = null;
    this.resetGame();
  }

  // ---------------------------------------------------------------- état
  resetGame() {
    this.score = 0;
    this.ball = 0;
    this.extraBalls = 0;
    this.extraAwarded = false;
    this.ballsInPlay = 0;
    this.pendingServes = 0;
    this.city = 0;              // nombre d'escales allumées (0 → 7)
    this.mbLit = false;
    this.multiball = false;
    this.jackpot = JACKPOT_START;
    this.carreaux = 0;
    this.resetBallState();
  }

  resetBallState() {
    this.mult = 1;
    this.bonus = 0;
    this.letters = [false, false, false, false];
    this.bumperHits = 0;
    this.drops = [false, false, false, false, false]; // true = tombée
    this.pointLit = false;
    this.carreauUntil = 0;
    this.targets = [false, false, false];
    this.ballSaveUntil = 0;
    this.ballSaveArmed = false;
    this.shooterClosed = false;
    this.autoLaunchNext = false;
    this.saucerBusy = false;
  }

  after(ms, fn) { this.timers.push({ t: this.now + ms, fn }); }
  say(text, ms = 2000) { this.msg = { text, start: this.now, until: this.now + ms }; }

  add(points, bonus = 0) {
    if (this.mode !== 'play') return;
    this.score += points;
    this.bonus += bonus;
  }

  // ---------------------------------------------------------------- partie
  startGame() {
    this.resetGame();
    this.mode = 'play';
    this.ball = 1;
    this.hw.sound(SND.START);
    this.say('FANNY PETANQUE WORLD TOUR', 3000);
    this.serveBall(false);
  }

  serveBall(auto) {
    this.ballsInPlay++;
    this.pendingServes++;
    if (auto) this.autoLaunchNext = true;
    this.hw.coil(COIL.TROUGH); // la bille arrive dans le couloir → contact SHOOTER
  }

  startBall() {
    this.resetBallState();
    this.serveBall(false);
  }

  endOfBall() {
    this.mode = 'bonus';
    const total = this.bonus * this.mult;
    this.say(`BONUS ${total}`, 2500);
    this.hw.sound(SND.BONUS);
    this.after(2500, () => {
      this.score += total;
      this.mode = 'play';
      if (this.extraBalls > 0) {
        this.extraBalls--;
        this.say('REJOUE', 1500);
        this.startBall();
      } else if (this.ball < BALLS_PER_GAME) {
        this.ball++;
        this.say(`BILLE ${this.ball}`, 1500);
        this.startBall();
      } else {
        this.gameOver();
      }
    });
  }

  gameOver() {
    this.mode = 'over';
    this.lastScore = this.score;
    const record = this.score > this.highScore;
    if (record) this.highScore = this.score;
    this.hw.sound(SND.GAME_OVER);
    this.say(record ? 'NOUVEAU RECORD' : 'FIN DE PARTIE', 4000);
    this.hw.event?.('gameOver', { score: this.score, record });
    this.after(4000, () => { this.mode = 'attract'; });
  }

  // ---------------------------------------------------------------- contacts
  onSwitch(id, closed = true) {
    if (id === SW.START) {
      if (closed && (this.mode === 'attract' || this.mode === 'over')) this.startGame();
      return;
    }
    if (this.mode === 'attract' || this.mode === 'over') return;

    if (id === SW.SHOOTER) {
      this.shooterClosed = closed;
      if (closed && this.pendingServes > 0) {
        this.pendingServes--;
        if (this.autoLaunchNext) {
          this.autoLaunchNext = false;
          this.after(500, () => this.launch());
        }
      }
      return;
    }
    if (id === SW.LAUNCH) { if (closed) this.launch(); return; }
    // Les flippers sont câblés en direct ; les règles ne lisent les boutons que pour le
    // changement de couloir : chaque appui décale les lettres T-O-U-R allumées.
    if (id === SW.FLIP_L || id === SW.FLIP_R) {
      if (closed && this.mode === 'play') this.rotateLetters(id === SW.FLIP_L ? -1 : 1);
      return;
    }
    if (id === SW.DRAIN) { this.drain(); return; }
    if (!closed) return;

    // tout autre contact = la bille est sur le plateau → le sauvetage de bille démarre
    if (!this.ballSaveArmed && this.mode === 'play') {
      this.ballSaveArmed = true;
      this.ballSaveUntil = Math.max(this.ballSaveUntil, this.now + BALL_SAVE_MS);
    }

    let i;
    if ((i = SW.LANES.indexOf(id)) >= 0) return this.hitLane(i);
    if ((i = SW.DROPS.indexOf(id)) >= 0) return this.hitDrop(i);
    if (SW.BUMPERS.includes(id)) return this.hitBumper();
    if ((i = SW.TARGETS.indexOf(id)) >= 0) return this.hitTarget(i);
    if (id === 'pointer') return this.hitPointer();
    if (id === 'tirer') return this.hitTirer();
    if (id === 'bouchon') return this.hitBouchon();
    if (SW.SLINGS.includes(id)) { this.add(10, 1); this.hw.sound(SND.SLING); return; }
    if (id === SW.SAUCER) return this.hitSaucer();
    if (id === SW.RAMP) return this.hitRamp();
  }

  launch() {
    if (!this.shooterClosed) return;
    this.hw.sound(SND.LAUNCH);
    this.hw.coil(COIL.LAUNCH);
  }

  // --- T O U R : lettres allumées par les couloirs du haut et par les bumpers
  lightLetter(i) {
    if (this.letters[i]) return false;
    this.letters[i] = true;
    if (this.letters.every(Boolean)) {
      this.letters = [false, false, false, false];
      if (this.mult < MAX_MULT) {
        this.mult++;
        this.say(`BONUS X${this.mult}`, 1800);
      } else {
        this.add(10000, 0);
        this.say('10000', 1200);
      }
      this.hw.sound(SND.LANES_DONE);
    }
    return true;
  }

  // changement de couloir : décale les lettres allumées d'un cran (circulaire)
  rotateLetters(dir) {
    const n = this.letters.length;
    this.letters = this.letters.map((_, i) => this.letters[(i - dir + n) % n]);
  }

  // --- jeu de boules : POINTER, BOUCHON, TIRER (carreau)
  // trois cibles rondes du mur gauche : les trois = TRIPLETTE (lettre T-O-U-R + boule pointée)
  hitTarget(i) {
    this.add(300, 30);
    this.hw.sound(SND.STANDUP);
    if (this.targets[i]) return;
    this.targets[i] = true;
    if (!this.targets.every(Boolean)) return;
    this.targets = [false, false, false];
    this.add(3000, 300);
    this.say('TRIPLETTE', 1500);
    this.hw.sound(SND.LANES_DONE);
    this.pointLit = true;
    const next = this.letters.indexOf(false);
    if (next >= 0) this.lightLetter(next);
  }

  hitPointer() {
    this.add(500, 50);
    this.hw.sound(SND.STANDUP);
    this.pointLit = true;                         // la boule est pointée : le bouchon vaut un BIBERON
  }

  hitBouchon() {
    this.add(1500, 150);
    this.hw.sound(SND.STANDUP);
    if (this.pointLit) {
      this.pointLit = false;
      this.add(5000, 500);
      this.say('BIBERON', 1500);
    } else this.say('TIR AU BOUCHON', 1500);
    this.carreauUntil = this.now + CARREAU_MS;    // le carreau s'allume sur TIRER
  }

  hitTirer() {
    if (this.now < this.carreauUntil) {
      this.carreauUntil = 0;
      this.carreaux++;
      const pts = CARREAU_PTS * this.carreaux;
      this.add(pts, 1000);
      this.say(`CARREAU ${pts}`, 1800);
      this.hw.sound(SND.JACKPOT);
      const next = this.letters.indexOf(false);
      if (next >= 0) this.lightLetter(next);
      return;
    }
    this.add(500, 50);
    this.hw.sound(SND.STANDUP);
  }

  hitLane(i) {
    this.add(300, 30);
    if (this.lightLetter(i)) this.hw.sound(SND.LANE);
  }

  hitBumper() {
    this.add(100, 10);
    this.hw.sound(SND.BUMPER);
    this.bumperHits++;
    if (this.bumperHits >= BUMPER_HITS_PER_LETTER) {
      this.bumperHits = 0;
      const next = this.letters.indexOf(false);
      if (next >= 0) this.lightLetter(next);
    }
  }

  // --- F A N N Y : allume le multiball au Cercle
  hitDrop(i) {
    if (this.drops[i]) return;
    this.drops[i] = true;
    this.add(500, 50);
    this.hw.sound(SND.DROP);
    if (!this.drops.every(Boolean)) return;
    this.hw.sound(SND.DROPS_DONE);
    if (this.multiball) {
      this.jackpot += 2 * JACKPOT_STEP;
      this.say(`JACKPOT ${this.jackpot}`, 1800);
    } else if (!this.mbLit) {
      this.mbLit = true;
      this.say('MULTIBALL AU CERCLE', 2200);
    } else {
      this.add(5000, 500);
    }
    this.after(1000, () => {
      this.drops = [false, false, false, false, false];
      this.hw.coil(COIL.DROP_RESET);
    });
  }

  // --- le Cercle : la bille est toujours réexpulsée
  hitSaucer() {
    if (this.saucerBusy) return;
    this.saucerBusy = true;
    let hold = 1000;
    if (this.mbLit && !this.multiball) {
      this.say('TRIPLETTE MULTIBALL', 2500);
      this.hw.sound(SND.MULTIBALL);
      hold = 2000;
      this.after(hold, () => this.startMultiball());
    } else {
      this.add(1000, 100);
      this.hw.sound(SND.SAUCER);
    }
    this.after(hold, () => { this.hw.coil(COIL.SAUCER); this.saucerBusy = false; });
  }

  startMultiball() {
    this.multiball = true;
    this.mbLit = false;
    this.jackpot = JACKPOT_START;
    this.ballSaveUntil = this.now + MB_BALL_SAVE_MS;
    this.serveBall(true);
    this.after(1500, () => this.serveBall(true));
  }

  // --- rampes : escales du World Tour, jackpot en multiball
  hitRamp() {
    this.add(2000, 200);
    if (this.multiball) {
      this.add(this.jackpot, 0);
      this.say(`JACKPOT ${this.jackpot}`, 1800);
      this.jackpot += JACKPOT_STEP;
      this.hw.sound(SND.JACKPOT);
    } else {
      this.hw.sound(SND.RAMP);
    }
    this.city++;
    if (this.city >= CITIES.length) {
      this.city = 0;
      this.add(50000, 5000);
      this.say('GRAND CHELEM', 2500);
      this.hw.sound(SND.GRAND_CHELEM);
      if (!this.extraAwarded) {
        this.extraAwarded = true;
        this.extraBalls++;
        this.after(2500, () => { this.say('EXTRA BALL', 2000); this.hw.sound(SND.EXTRA); });
      }
    } else {
      if (!this.multiball) this.say(CITIES[this.city], 1500);
      this.hw.sound(SND.CITY);
    }
  }

  drain() {
    this.ballsInPlay = Math.max(0, this.ballsInPlay - 1);
    if (this.mode !== 'play') return;
    if (!this.ballSaveArmed && !this.multiball) {
      // bille évacuée sans avoir touché un seul contact : rendue
      this.say('BILLE RENDUE', 1200);
      this.serveBall(false);
      return;
    }
    if (this.now < this.ballSaveUntil) {
      this.say('FANNY TE LA REND', 1500);
      this.hw.sound(SND.BALL_SAVE);
      this.serveBall(true);
      return;
    }
    if (this.multiball && this.ballsInPlay <= 1) {
      this.multiball = false;
      this.say('FIN DE LA MENE', 1500);
    }
    if (this.ballsInPlay === 0) {
      this.hw.sound(SND.DRAIN);
      this.endOfBall();
    }
  }

  // ---------------------------------------------------------------- horloge
  tick(now) {
    this.now = now;
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.t <= now);
      if (due.length) {
        this.timers = this.timers.filter((t) => t.t > now);
        due.forEach((t) => t.fn());
      }
    }
    if (this.msg && now > this.msg.until) this.msg = null;
  }

  // ---------------------------------------------------------------- sorties
  // Lampes = LED de la bande WS2812B (ordre : LAMP_LAYOUT dans render.js). 0 éteint, 1 allumé, 2 clignotant.
  lamps() {
    const L = {};
    this.letters.forEach((on, i) => { L[`lane${i}`] = on ? 1 : 0; });
    this.drops.forEach((down, i) => { L[`drop${i}`] = down ? 1 : 0; });
    L.multiball = this.multiball ? 1 : this.mbLit ? 2 : 0;
    L.ramp = 1;
    L.jackpot = this.multiball ? 2 : 0;
    for (let m = 2; m <= MAX_MULT; m++) L[`mult${m}`] = this.mult >= m ? 1 : 0;
    CITIES.forEach((_, i) => { L[`city${i}`] = i < this.city ? 1 : i === this.city ? 2 : 0; });
    L.extra = this.extraBalls > 0 ? 1 : 0;
    L.save = this.now < this.ballSaveUntil ? 2 : 0;
    L.carreau = this.now < this.carreauUntil ? 2 : 0;
    L.bouchon = this.pointLit ? 2 : 1;
    L.point = this.pointLit ? 1 : 0;
    this.targets.forEach((on, i) => { L[`cible${i}`] = on ? 1 : 0; });
    if (this.mode === 'attract' || this.mode === 'over') {
      const k = Math.floor(this.now / 150);
      Object.keys(L).forEach((name, i) => { L[name] = (i + k) % 6 === 0 ? 1 : 0; });
    }
    return L;
  }

  // Afficheurs TM1637 : score = 8 caractères (2 modules), info = 4 caractères (bille + multiplicateur).
  display() {
    let score;
    if (this.msg) score = scrollText(this.msg.text, 8, this.now - this.msg.start);
    else if (this.mode === 'attract') {
      const phase = Math.floor(this.now / 6000) % 3;
      score = phase === 0 ? scrollText('FANNY PETANQUE WORLD TOUR', 8, this.now % 6000)
        : phase === 1 ? pad(`HI ${this.highScore}`, 8) : pad(String(this.lastScore), 8);
    } else score = pad(String(this.score), 8);

    const info = this.mode === 'attract' || this.mode === 'over' ? 'PLAY' : `b${this.ball} ${this.mult}`;
    return { score, info };
  }
}

function pad(s, n) { return s.length > n ? s.slice(-n) : s.padStart(n, ' '); }

// Défilement d'un texte trop long sur n caractères (elapsed = ms depuis l'affichage).
function scrollText(text, n, elapsed) {
  if (text.length <= n) {
    const left = Math.floor((n - text.length) / 2);
    return (' '.repeat(left) + text).padEnd(n, ' ');
  }
  const padded = ' '.repeat(n) + text + ' '.repeat(n);
  const step = Math.floor(elapsed / 200) % (padded.length - n + 1);
  return padded.slice(step, step + n);
}
