// Règles du jeu, indépendantes de la physique et du rendu — esprit flipper des années 70.
//
// Ce module ne voit que ce que verra l'Arduino Mega de la réplique physique :
//   entrées  : contacts (onSwitch)                → micro-rupteurs, boutons d'arcade
//   sorties  : bobines (hw.coil), sons (hw.sound) → MOSFET + solénoïdes, DFPlayer Mini
//              lampes (lamps())                   → bande WS2812B
//              afficheurs (display())             → TM1637 (2 × 4 chiffres score + 4 chiffres info)
// Il doit rester portable tel quel en C++ : compteurs, drapeaux et minuteries seulement.
//
// Règles — la boucle de jeu :
//   • F-A-N-N-Y (cibles tombantes) allume le Cercle ; bille dans le Cercle allumé = MULTIBALL (3 billes).
//     Le multiball se rallume ensuite plus difficilement : F-A-N-N-Y deux fois, puis trois…
//   • Multiball : chaque rampe = JACKPOT (+5 000 à chaque fois, +10 000 par F-A-N-N-Y ; la valeur reste
//     acquise d'un multiball à l'autre). Trois jackpots allument le SUPER JACKPOT au Cercle (3 × jackpot).
//   • Seul le passage dans un couloir du haut allume sa lettre T-O-U-R ; TOUR complet = bonus ×2, ×3 … ×5,
//     puis au ×5 : EXTRA BALL allumée au Cercle. Changement de couloir : chaque appui sur un batteur
//     décale les lettres allumées.
//   • Couloir du BOUCHON (haut gauche) : allume le CARREAU sur TIRER pendant 20 s (carreau = k × 10 000).
//     POINTER puis BOUCHON = BIBERON (+5 000).
//   • Trois cibles rondes du mur gauche : les trois = TRIPLETTE (+3 000, boule pointée).
//   • Rampe : allume l'escale suivante du World Tour ; 7 escales = GRAND CHELEM (+50 000) + EXTRA BALL.
//   • EXTRA BALL : deux au plus par partie ; au-delà, l'extra ball allumée vaut 25 000.
//   • 3 billes, sauvetage de bille 8 s ; bonus de fin de bille décompté × multiplicateur.
//   • TILT : le pendule (contact TILT) se ferme quand on secoue trop la caisse. Deux avertissements
//     « ATTENTION » par bille, puis TILT : alimentation des batteurs, bumpers et lance-pierres coupée,
//     plus aucun point, la bille est perdue sans bonus (et sans sauvetage).
//   • LE CLAC (knocker) : partie gratuite à 150 000, 300 000 et 500 000 points, et au record battu.
//   • MATCH en fin de partie : tirage de 00 à 90 ; s'il tombe sur les deux derniers chiffres du score,
//     CLAC et partie gratuite. Crédits gagnés : 9 au plus ; START en consomme un s'il y en a
//     (sinon partie libre sur le jeu web ; sur la réplique, monnayeur facultatif : contact COIN).

export const SW = {
  FLIP_L: 'flipL', FLIP_R: 'flipR', LAUNCH: 'launch', START: 'start',
  LANES: ['laneT', 'laneO', 'laneU', 'laneR'],
  DROPS: ['dropF', 'dropA', 'dropN1', 'dropN2', 'dropY'],
  STANDUPS: ['pointer', 'tirer', 'bouchon'],
  TARGETS: ['boule1', 'boule2', 'boule3'],   // cibles rondes du mur gauche
  SAUCER: 'saucer', RAMP: 'ramp',
  SLINGS: ['slingL', 'slingR'], BUMPERS: ['bumper1', 'bumper2', 'bumper3'],
  SHOOTER: 'shooter', DRAIN: 'drain', COIN: 'coin', TILT: 'tilt',
};

export const COIL = { TROUGH: 'trough', LAUNCH: 'autoLaunch', SAUCER: 'saucerKick', DROP_RESET: 'dropReset', KNOCKER: 'knocker',
  POWER_OFF: 'powerOff', POWER_ON: 'powerOn' };   // relais d'alimentation des bobines du plateau (tilt)

// Numéros de pistes du DFPlayer (0001.mp3 …)
export const SND = {
  START: 1, BUMPER: 2, SLING: 3, FLIP: 4, DROP: 5, DROPS_DONE: 6, RAMP: 7, LANE: 8, LANES_DONE: 9,
  STANDUP: 10, SAUCER: 11, MULTIBALL: 12, JACKPOT: 13, CITY: 14, GRAND_CHELEM: 15, EXTRA: 16,
  BALL_SAVE: 17, DRAIN: 18, BONUS: 19, GAME_OVER: 20, LAUNCH: 21,
  MUSIQUE_GENERIQUE: 22, MUSIQUE_THEME: 23,   // musiques YuE2 (en boucle)
  // voix de Fanny (outils/voix_fanny.json) : une seule voix à la fois
  V_START: 24, V_MULTIBALL: 25, V_JACKPOT: 26, V_CARREAU: 27, V_BIBERON: 28, V_BOUCHON: 29, V_TRIPLETTE: 30,
  V_GRAND_CHELEM: 31, V_EXTRA: 32, V_BALL_SAVE: 33, V_MB_LIT: 34, V_BONUS_MULT: 35, V_DRAIN: 36,
  V_GAME_OVER: 37, V_RECORD: 38, V_CITY_1: 39,   // escales 1 à 6 : 39 à 44
  CLAC: 45, MATCH: 46,                            // knocker (partie gratuite), tirage du match
  V_PARTIE_GRATUITE: 47, V_MATCH: 48, V_EXTRA_LIT: 49, V_SUPER_JACKPOT: 50,
  NUDGE: 51, TILT: 52,                            // coup de caisse (jeu web), tilt
  V_ATTENTION: 53, V_TILT: 54,
};
export const SND_MAX = 54;
// Voix de Fanny : un seul canal (une réplique coupe la précédente).
export const isVoice = (id) => (id >= SND.V_START && id <= SND.V_CITY_1 + 5)
  || (id >= SND.V_PARTIE_GRATUITE && id <= SND.V_SUPER_JACKPOT) || id >= SND.V_ATTENTION;

export const CITIES = ['MARSEILLE', 'PARIS', 'LONDRES', 'NEW YORK', 'TOKYO', 'RIO', 'SYDNEY'];

const BALLS_PER_GAME = 3;
const BALL_SAVE_MS = 8000;
const MB_BALL_SAVE_MS = 10000;
const MAX_MULT = 5;
const JACKPOT_START = 20000;
const JACKPOT_STEP = 5000;
const CARREAU_MS = 20000;   // durée du carreau allumé après un tir au bouchon
const CARREAU_PTS = 10000;  // carreau n°k = k × 10 000
const REPLAY_LEVELS = [150000, 300000, 500000];   // paliers du clac (réglage « exploitant »)
const MAX_CREDITS = 9;
const EXTRA_MAX = 2;         // extra balls par partie
const EXTRA_POINTS = 25000;  // extra ball allumée au-delà du plafond
const SUPER_AFTER = 3;       // jackpots avant le super jackpot
const FREE_PLAY = true;      // jeu web : START sans crédit possible
const TILT_WARNINGS = 2;     // avertissements par bille avant le tilt
const TILT_SETTLE_MS = 1200; // le pendule oscille encore : contacts ignorés pendant ce temps

export class Rules {
  constructor(hw) {
    this.hw = hw;            // { coil(name), sound(id), event?(name, data) }
    this.now = 0;
    this.timers = [];
    this.highScore = 0;
    this.lastScore = 0;
    this.mode = 'attract';   // attract | play | bonus | match | over
    this.msg = null;
    this.credits = 0;
    this.matchNum = null;    // tirage du match (0, 10 … 90), null = pas de tirage affiché
    this.matchRolling = false;
    this.resetGame();
  }

  // ---------------------------------------------------------------- état
  resetGame() {
    this.score = 0;
    this.ball = 0;
    this.extraBalls = 0;     // billes à rejouer (lampe REJOUE)
    this.extrasGiven = 0;    // extra balls gagnées dans la partie
    this.extraLit = false;   // extra ball allumée au Cercle
    this.replayIdx = 0;      // prochain palier du clac
    this.ballsInPlay = 0;
    this.pendingServes = 0;
    this.city = 0;              // nombre d'escales allumées (0 → 7)
    this.mbLit = false;
    this.multiball = false;
    this.mbCount = 0;           // multiballs joués
    this.fannyDone = 0;         // F-A-N-N-Y complétés depuis le dernier multiball
    this.jackpot = JACKPOT_START;
    this.jackpotsMb = 0;        // jackpots du multiball en cours
    this.superLit = false;
    this.carreaux = 0;
    this.resetBallState();
  }

  resetBallState() {
    this.mult = 1;
    this.bonus = 0;
    this.letters = [false, false, false, false];
    this.drops = [false, false, false, false, false]; // true = tombée
    this.pointLit = false;
    this.carreauUntil = 0;
    this.targets = [false, false, false];
    this.ballSaveUntil = 0;
    this.ballSaveArmed = false;
    this.shooterClosed = false;
    this.autoLaunchNext = false;
    this.saucerBusy = false;
    this.tiltWarnings = 0;
    this.tiltIgnoreUntil = 0;
    this.tilted = false;
  }

  after(ms, fn) { this.timers.push({ t: this.now + ms, fn }); }
  say(text, ms = 2000) { this.msg = { text, start: this.now, until: this.now + ms }; }

  add(points, bonus = 0) {
    if (this.mode !== 'play' || this.tilted) return;
    this.score += points;
    this.bonus += bonus;
    this.checkReplay();
  }

  // ---------------------------------------------------------------- le clac et les crédits
  checkReplay() {
    while (this.replayIdx < REPLAY_LEVELS.length && this.score >= REPLAY_LEVELS[this.replayIdx]) {
      this.replayIdx++;
      this.freeGame('PARTIE GRATUITE');
    }
  }

  freeGame(text) {
    this.credits = Math.min(MAX_CREDITS, this.credits + 1);
    this.hw.coil(COIL.KNOCKER);
    this.hw.sound(SND.CLAC);
    this.hw.sound(text === 'MATCH' ? SND.V_MATCH : SND.V_PARTIE_GRATUITE);
    this.say(text, 2000);
    this.hw.event?.('credits', { credits: this.credits });
  }

  addCredit() {
    this.credits = Math.min(MAX_CREDITS, this.credits + 1);
    this.hw.sound(SND.STANDUP);
    this.hw.event?.('credits', { credits: this.credits });
  }

  // ---------------------------------------------------------------- partie
  canStart() { return (this.mode === 'attract' || this.mode === 'over') && (FREE_PLAY || this.credits > 0); }

  startGame() {
    if (!this.canStart()) return;
    const gratuite = this.credits > 0;
    if (gratuite) { this.credits--; this.hw.event?.('credits', { credits: this.credits }); }
    this.resetGame();
    this.matchNum = null;
    this.mode = 'play';
    this.ball = 1;
    this.hw.sound(SND.START);
    this.hw.sound(SND.V_START);
    this.say(gratuite ? 'PARTIE GRATUITE' : 'FANNY PETANQUE WORLD TOUR', 3000);
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
    this.hw.coil(COIL.POWER_ON);
    this.serveBall(false);
  }

  // Bonus de fin de bille décompté sous les yeux du joueur : « BONUS X3 », puis le score monte par paquets.
  endOfBall() {
    this.mode = 'bonus';
    if (this.tilted) {                      // bille tiltée : pas de bonus
      this.bonus = 0;
      this.say('TILT', 1800);
      this.after(1800, () => this.nextBall());
      return;
    }
    this.say(this.mult > 1 ? `BONUS X${this.mult}` : 'BONUS', 1200);
    this.hw.sound(SND.BONUS);
    this.after(1200, () => this.countBonus());
  }

  countBonus() {
    if (this.bonus <= 0) { this.after(600, () => this.nextBall()); return; }
    const step = Math.min(this.bonus, Math.max(1000, Math.ceil(this.bonus / 200) * 10));
    this.bonus -= step;
    this.score += step * this.mult;
    this.checkReplay();
    this.hw.sound(SND.LANE);
    this.after(110, () => this.countBonus());
  }

  nextBall() {
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
  }

  // Fin de partie : record (partie gratuite si un record existait déjà), puis le MATCH.
  gameOver() {
    this.mode = 'match';
    this.tilted = false;
    this.hw.coil(COIL.POWER_ON);
    this.lastScore = this.score;
    const record = this.score > this.highScore;
    const ancien = this.highScore;
    if (record) this.highScore = this.score;
    this.hw.sound(SND.GAME_OVER);
    this.say(record ? 'NOUVEAU RECORD' : 'FIN DE PARTIE', 2500);
    this.hw.sound(record ? SND.V_RECORD : SND.V_GAME_OVER);
    this.hw.event?.('gameOver', { score: this.score, record });
    if (record && ancien > 0) this.after(2600, () => this.freeGame('PARTIE GRATUITE'));
    this.after(record && ancien > 0 ? 5000 : 2800, () => this.startMatch());
  }

  startMatch() {
    this.matchRolling = true;
    this.matchNum = 0;
    this.hw.sound(SND.MATCH);
    this.after(2600, () => {
      this.matchRolling = false;
      this.matchNum = 10 * Math.floor(Math.random() * 10);
      const fin = (this.score % 100) - (this.score % 10);   // les deux derniers chiffres (le score finit par 0)
      if (this.matchNum === fin) this.freeGame('MATCH');
      else this.say(`MATCH ${String(this.matchNum).padStart(2, '0')}`, 1800);
      this.mode = 'over';
      this.after(5000, () => { if (this.mode === 'over') { this.mode = 'attract'; this.matchNum = null; } });
    });
  }

  // ---------------------------------------------------------------- contacts
  onSwitch(id, closed = true) {
    if (id === SW.START) {
      if (closed) this.startGame();
      return;
    }
    if (id === SW.COIN) { if (closed) this.addCredit(); return; }
    if (id === SW.TILT) { if (closed && this.mode === 'play') this.hitTilt(); return; }
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
      if (closed && this.mode === 'play' && !this.tilted) this.rotateLetters(id === SW.FLIP_L ? -1 : 1);
      return;
    }
    if (id === SW.DRAIN) { this.drain(); return; }
    if (!closed) return;
    if (this.tilted) {                       // plus rien ne compte ; le Cercle rend quand même la bille
      if (id === SW.SAUCER && !this.saucerBusy) {
        this.saucerBusy = true;
        this.after(600, () => { this.hw.coil(COIL.SAUCER); this.saucerBusy = false; });
      }
      return;
    }

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
    if (SW.SLINGS.includes(id)) { this.add(10, 10); this.hw.sound(SND.SLING); return; }
    if (id === SW.SAUCER) return this.hitSaucer();
    if (id === SW.RAMP) return this.hitRamp();
  }

  // --- tilt : le pendule a touché son anneau
  hitTilt() {
    if (this.tilted || this.now < this.tiltIgnoreUntil) return;
    this.tiltIgnoreUntil = this.now + TILT_SETTLE_MS;
    this.tiltWarnings++;
    if (this.tiltWarnings <= TILT_WARNINGS) {
      this.say('ATTENTION', 1500);
      this.hw.sound(SND.STANDUP);
      this.hw.sound(SND.V_ATTENTION);
      return;
    }
    this.tilted = true;
    this.ballSaveUntil = 0;
    this.multiball = false;
    this.superLit = false;
    this.carreauUntil = 0;
    this.hw.coil(COIL.POWER_OFF);
    this.hw.sound(SND.TILT);
    this.hw.sound(SND.V_TILT);
    this.msg = null;                         // « TILT » occupe les afficheurs jusqu'à la fin de la bille
  }

  launch() {
    if (!this.shooterClosed) return;
    this.hw.sound(SND.LAUNCH);
    this.hw.coil(COIL.LAUNCH);
  }

  // --- T O U R : lettres allumées uniquement par le passage dans les couloirs du haut
  lightLetter(i) {
    if (this.letters[i]) return false;
    this.letters[i] = true;
    if (this.letters.every(Boolean)) {
      this.letters = [false, false, false, false];
      if (this.mult < MAX_MULT) {
        this.mult++;
        this.say(`BONUS X${this.mult}`, 1800);
        this.hw.sound(SND.V_BONUS_MULT);
        if (this.mult === MAX_MULT) this.lightExtra();
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
  // trois cibles rondes du mur gauche : les trois = TRIPLETTE (boule pointée)
  hitTarget(i) {
    this.add(300, 30);
    this.hw.sound(SND.STANDUP);
    if (this.targets[i]) return;
    this.targets[i] = true;
    if (!this.targets.every(Boolean)) return;
    this.targets = [false, false, false];
    this.add(3000, 300);
    this.say('TRIPLETTE', 1500);
    this.hw.sound(SND.V_TRIPLETTE);
    this.hw.sound(SND.LANES_DONE);
    this.pointLit = true;
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
      this.hw.sound(SND.V_BIBERON);
    } else { this.say('TIR AU BOUCHON', 1500); this.hw.sound(SND.V_BOUCHON); }
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
      this.hw.sound(SND.V_CARREAU);
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
      this.fannyDone++;
      const besoin = this.mbCount + 1;            // 1er multiball : 1 fois, puis 2, puis 3…
      if (this.fannyDone >= besoin) {
        this.fannyDone = 0;
        this.mbLit = true;
        this.say('MULTIBALL AU CERCLE', 2200);
        this.hw.sound(SND.V_MB_LIT);
      } else {
        this.add(5000, 500);
        this.say(`FANNY ${this.fannyDone}/${besoin}`, 1500);
      }
    } else {
      this.add(5000, 500);
    }
    this.after(1000, () => {
      this.drops = [false, false, false, false, false];
      this.hw.coil(COIL.DROP_RESET);
    });
  }

  // --- le Cercle : la bille est toujours réexpulsée. Priorité : multiball, super jackpot, extra ball.
  hitSaucer() {
    if (this.saucerBusy) return;
    this.saucerBusy = true;
    let hold = 1000;
    if (this.mbLit && !this.multiball) {
      this.say('TRIPLETTE MULTIBALL', 2500);
      this.hw.sound(SND.MULTIBALL);
      this.hw.sound(SND.V_MULTIBALL);
      hold = 2000;
      this.after(hold, () => this.startMultiball());
    } else if (this.multiball && this.superLit) {
      this.superLit = false;
      this.jackpotsMb = 0;
      const pts = 3 * this.jackpot;
      this.add(pts, 0);
      this.say(`SUPER JACKPOT ${pts}`, 2500);
      this.hw.sound(SND.JACKPOT);
      this.hw.sound(SND.V_SUPER_JACKPOT);
      hold = 1800;
    } else if (this.extraLit) {
      this.extraLit = false;
      this.awardExtra();
      hold = 1800;
    } else {
      this.add(1000, 100);
      this.hw.sound(SND.SAUCER);
    }
    this.after(hold, () => { this.hw.coil(COIL.SAUCER); this.saucerBusy = false; });
  }

  startMultiball() {
    this.multiball = true;
    this.mbLit = false;
    this.mbCount++;
    this.jackpotsMb = 0;
    this.superLit = false;
    this.ballSaveUntil = this.now + MB_BALL_SAVE_MS;
    this.serveBall(true);
    this.after(1500, () => this.serveBall(true));
  }

  // --- extra ball : allumée au Cercle (TOUR au ×5) ou donnée directement (Grand Chelem)
  lightExtra() {
    if (this.extraLit) return;
    if (this.extrasGiven >= EXTRA_MAX) { this.add(EXTRA_POINTS, 0); return; }
    this.extraLit = true;
    this.after(1900, () => { this.say('EXTRA BALL AU CERCLE', 2200); this.hw.sound(SND.V_EXTRA_LIT); });
  }

  awardExtra() {
    if (this.extrasGiven >= EXTRA_MAX) {
      this.add(EXTRA_POINTS, 0);
      this.say(`${EXTRA_POINTS}`, 1500);
      return;
    }
    this.extrasGiven++;
    this.extraBalls++;
    this.say('EXTRA BALL', 2000);
    this.hw.sound(SND.EXTRA);
    this.hw.sound(SND.V_EXTRA);
  }

  // --- rampes : escales du World Tour, jackpot en multiball
  hitRamp() {
    this.add(2000, 200);
    if (this.multiball) {
      this.add(this.jackpot, 0);
      this.say(`JACKPOT ${this.jackpot}`, 1800);
      this.jackpot += JACKPOT_STEP;
      this.hw.sound(SND.JACKPOT);
      this.hw.sound(SND.V_JACKPOT);
      if (++this.jackpotsMb >= SUPER_AFTER && !this.superLit) {
        this.superLit = true;
        this.after(1900, () => { this.say('SUPER JACKPOT AU CERCLE', 2200); });
      }
    } else {
      this.hw.sound(SND.RAMP);
    }
    this.city++;
    if (this.city >= CITIES.length) {
      this.city = 0;
      this.add(50000, 5000);
      this.say('GRAND CHELEM', 2500);
      this.hw.sound(SND.GRAND_CHELEM);
      this.hw.sound(SND.V_GRAND_CHELEM);
      this.after(2500, () => this.awardExtra());
    } else {
      if (!this.multiball) this.say(CITIES[this.city], 1500);
      this.hw.sound(SND.CITY);
      if (!this.multiball) this.hw.sound(SND.V_CITY_1 + this.city - 1);
    }
  }

  drain() {
    this.ballsInPlay = Math.max(0, this.ballsInPlay - 1);
    if (this.mode !== 'play') return;
    if (this.tilted) {                        // ni sauvetage ni bille rendue
      if (this.ballsInPlay === 0) { this.hw.sound(SND.DRAIN); this.endOfBall(); }
      return;
    }
    if (!this.ballSaveArmed && !this.multiball) {
      // bille évacuée sans avoir touché un seul contact : rendue
      this.say('BILLE RENDUE', 1200);
      this.serveBall(false);
      return;
    }
    if (this.now < this.ballSaveUntil) {
      this.say('FANNY TE LA REND', 1500);
      this.hw.sound(SND.BALL_SAVE);
      this.hw.sound(SND.V_BALL_SAVE);
      this.serveBall(true);
      return;
    }
    if (this.multiball && this.ballsInPlay <= 1) {
      this.multiball = false;
      this.superLit = false;
      this.say('FIN DE LA MENE', 1500);
    }
    if (this.ballsInPlay === 0) {
      this.hw.sound(SND.DRAIN);
      this.hw.sound(SND.V_DRAIN);
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
    L.multiball = this.superLit ? 2 : this.multiball ? 1 : this.mbLit ? 2 : 0;
    L.ramp = 1;
    L.jackpot = this.multiball ? 2 : 0;
    for (let m = 2; m <= MAX_MULT; m++) L[`mult${m}`] = this.mult >= m ? 1 : 0;
    CITIES.forEach((_, i) => { L[`city${i}`] = i < this.city ? 1 : i === this.city ? 2 : 0; });
    L.extra = this.extraBalls > 0 ? 1 : 0;
    L.extraLit = this.extraLit ? 2 : 0;
    L.save = this.now < this.ballSaveUntil ? 2 : 0;
    L.carreau = this.now < this.carreauUntil ? 2 : 0;
    L.bouchon = this.pointLit ? 2 : 1;
    L.point = this.pointLit ? 1 : 0;
    this.targets.forEach((on, i) => { L[`cible${i}`] = on ? 1 : 0; });
    if (this.tilted) Object.keys(L).forEach((name) => { L[name] = 0; });   // tilt : tout s'éteint
    if (this.mode === 'attract' || this.mode === 'over' || this.mode === 'match') {
      const k = Math.floor(this.now / 150);
      Object.keys(L).forEach((name, i) => { L[name] = (i + k) % 6 === 0 ? 1 : 0; });
    }
    return L;
  }

  // Afficheurs TM1637 : score = 8 caractères (2 modules), info = 4 caractères (bille + multiplicateur).
  display() {
    let score;
    if (this.tilted) return { score: '  TILT  ', info: 'TILT' };   // afficheurs TM1637
    if (this.msg) score = scrollText(this.msg.text, 8, this.now - this.msg.start);
    else if (this.mode === 'attract') {
      const phase = Math.floor(this.now / 6000) % 3;
      score = phase === 0 ? scrollText('FANNY PETANQUE WORLD TOUR', 8, this.now % 6000)
        : phase === 1 ? pad(`HI ${this.highScore}`, 8) : pad(String(this.lastScore), 8);
    } else score = pad(String(this.score), 8);

    let info;
    if (this.matchNum !== null && (this.mode === 'match' || this.mode === 'over')) {
      // 4 caractères du module info : le tirage du match défile puis s'arrête
      const n = this.matchRolling ? 10 * (Math.floor(this.now / 70) % 10) : this.matchNum;
      info = `  ${String(n).padStart(2, '0')}`;
    } else if (this.mode === 'attract' || this.mode === 'over' || this.mode === 'match') {
      info = this.credits > 0 && Math.floor(this.now / 2000) % 2 ? `CR ${this.credits}` : 'PLAY';
    } else info = `b${this.ball} ${this.mult}`;
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
