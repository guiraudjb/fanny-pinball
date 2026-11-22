// Robot joueur, niveau expert : il ne voit que ce que voit un joueur (billes, palettes, lampes des règles) et
// n'agit que par les commandes d'un joueur (palettes, lanceur, coups de caisse). Sert au banc d'essai d'une partie
// complète (outils/robot.mjs) et peut jouer dans la page.
//
// Technique :
//   • berceau : une bille qui descend lentement vers une palette est attrapée palette levée, puis tenue au repos ;
//   • tir visé depuis le berceau : on baisse la palette et on la relève d ms plus tard (la palette repart d'un
//     angle différent) ; la table d → cible vient d'un étalonnage (étalonner()) ;
//   • sauvetage : une bille rapide qui arrive sur une palette est frappée quand elle passe au bon endroit ;
//   • lancer à fond, coups de caisse seulement contre une bille coincée (le robot surveille le pendule).
import { GEO, BALL_R, CX } from './table.js';
import { SW } from './rules.js';

const MM = 0.001;
// m/s sous lesquels une bille qui arrive sur une palette peut être attrapée palette levée
const V_ATTRAPE = 1.4;
const TENUE_TIR_MS = 180;      // palette tenue après une frappe
const BERCEAU_MS = 350;        // bille immobile sur la palette levée depuis … avant de tirer

// géométrie d'une palette dans son repère : r = distance à l'axe, t = côté (+ au-dessus de la palette au repos)
function repere(fl, p) {
  const { px, py } = fl.def, sg = fl.def.side === 'L' ? 1 : -1;
  const dx = (p.x - px) * sg, dy = p.y - py;
  const a = GEO.flippers[0].rest;            // palette droite : repère miroir de la gauche
  const c = Math.cos(a), s = Math.sin(a);
  return { r: Math.hypot(dx, dy), le: dx * c + dy * s, t: dx * s - dy * c };
}

export class Robot {
  // act : { flip(side, down), launch(force), nudge() } ; tirs : étalonnage { L: [{ d, cible }], R: [...] }
  constructor(sim, rules, act, tirs = { L: [], R: [] }) {
    this.sim = sim; this.rules = rules; this.act = act; this.tirs = tirs;
    this.etat = { L: { phase: 'libre', t: 0 }, R: { phase: 'libre', t: 0 } };
    this.lanceur = 0;
    this.journal = [];
    this.stats = { berceaux: 0, tirs: {}, sauvetages: 0, coups: 0 };
  }

  log(m) { this.journal.push(`${(this.sim.time / 1000).toFixed(1)} s ${m}`); }

  // cible voulue selon les règles (ordre d'un joueur qui connaît le jeu)
  cibleVoulue() {
    const r = this.rules;
    if (r.multiball) return r.superLit ? 'saucer' : 'ramp';
    if (r.mbLit || r.extraLit) return 'saucer';
    if (r.carreauUntil > r.now) return 'tirer';
    if (r.drops.some((d) => !d)) return 'drops';
    return 'ramp';
  }

  // d visé pour une cible : la valeur étalonnée qui l'atteint le plus souvent (au milieu de la plage)
  choisirTir(side, cible) {
    // le délai le plus sûr : celui dont les voisins (±5 ms) touchent aussi la cible
    const bon = (t) => t && (cible === 'drops' ? t.cible.startsWith('drop') : t.cible === cible);
    const T = this.tirs[side];
    let mieux = null, note = -1;
    T.forEach((t, i) => { if (!bon(t)) return; const n = bon(T[i - 1]) + bon(T[i + 1]); if (n > note) { note = n; mieux = t.d; } });
    return mieux;
  }

  tick(dtMs) {
    const sim = this.sim, r = this.rules;
    if (r.mode !== 'play') { this.relacher(); return; }
    // lanceur : tiré à fond dès qu'une bille attend dans le couloir
    if (sim.shooterClosed) {
      this.lanceur += dtMs;
      if (this.lanceur > 600) { this.act.launch(1.1); this.lanceur = 0; this.log('lancer'); }
    } else this.lanceur = 0;

    const billes = sim.balls.filter((b) => b.plugin.fp.mode === 'table' && !b.retiree && !sim.dansLanceur(b));
    for (const fl of sim.T.flippers) this.palette(fl, billes, dtMs);
  }

  palette(fl, billes, dtMs) {
    const side = fl.def.side, e = this.etat[side], sim = this.sim;
    e.t += dtMs;
    // billes de ce côté, dans la zone de la palette (au-dessus d'elle, à portée)
    const proches = billes.map((b) => ({ b, q: repere(fl, b.position) }))
      .filter(({ q }) => q.r < FLIP_LEN + BALL_R + 30 && q.t > -BALL_R && q.le > -10);
    const tenir = (down) => { if (this.trace) this.log(`${side} ${down ? 'lève' : 'baisse'} (${e.phase})`); this.act.flip(side, down); };

    if (e.phase === 'tir') {                         // tir visé en cours : palette baissée, on attend la bille
      if (e.t >= e.d - 1) {
        tenir(true); e.phase = 'tenue'; e.t = 0; this.log(`tir ${side} ${e.d} ms → ${e.cible}`);
        this.stats.tirs[e.cible] = (this.stats.tirs[e.cible] || 0) + 1;
      }
      return;
    }
    if (e.phase === 'tenue') { if (e.t > TENUE_TIR_MS) { tenir(false); e.phase = 'libre'; e.t = 0; } return; }

    if (!proches.length) {
      // bille sortie de la zone : palette relâchée (après un instant si on venait de l'attraper)
      if (e.phase !== 'libre' && (e.phase !== 'attrape' || e.t > 400)) { tenir(false); e.phase = 'libre'; }
      return;
    }
    // la plus menaçante : la plus basse
    const { b, q } = proches.reduce((m, x) => (x.b.position.y > m.b.position.y ? x : m));
    const vy = b.velocity.y * 60 * MM, v = b.vitesse;

    if (e.phase === 'berceau') {
      // bille posée sur la palette levée : on la laisse se calmer, puis tir visé
      if (v > 0.08) { e.t = 0; return; }
      if (e.t < BERCEAU_MS) return;
      const cible = this.cibleVoulue(), d = this.choisirTir(side, cible);
      if (d === null) return;                        // rien d'étalonné de ce côté pour cette cible : on attend
      tenir(false); e.phase = 'tir'; e.d = d; e.cible = cible; e.bille = b; e.t = 0;
      return;
    }
    if (e.phase === 'attrape') {
      if (v < 0.12 && q.r < FLIP_LEN + 30) { e.phase = 'berceau'; e.t = 0; this.stats.berceaux++; this.log(`berceau ${side}`); return; }
      if (e.t > 1500) { tenir(false); e.phase = 'libre'; }
      return;
    }
    // libre : bille qui descend vers la palette
    const surPalette = q.t < BALL_R + 22;
    if (!surPalette && vy > 0 && q.le > 0 && q.le < FLIP_LEN + 25) {
      const avance = vy * 1000;                      // mm/s vers la palette
      if (v < V_ATTRAPE && proches.length === 1) {
        // berceau « palette morte » : levée avant l'arrivée (≈ 150 ms), la bille tombe sur une palette immobile
        if (q.t < 40 + avance * 0.15) { tenir(true); e.phase = 'attrape'; e.t = 0; }
        return;
      }
      // trop rapide (ou plusieurs billes) : frappe juste avant le contact, palette tenue un instant
      if (q.t < BALL_R + 20 + avance * 0.03) { tenir(true); e.phase = 'tenue'; e.t = 0; this.stats.sauvetages++; }
      return;
    }
    // bille qui roule sur la palette vers la pointe (venue du couloir de retour) : tir quand elle passe au tiers
    // extérieur ; près de l'axe elle repartirait dans le couloir
    if (surPalette && q.le > FLIP_LEN * 0.6) { tenir(true); e.phase = 'tenue'; e.t = 0; this.stats.sauvetages++; }
  }

  relacher() {
    for (const s of ['L', 'R']) { this.act.flip(s, false); this.etat[s] = { phase: 'libre', t: 0 }; }
  }
}

const FLIP_LEN = 63;   // js/table.js FLIP.len

// Étalonnage des tirs depuis le berceau : pour chaque côté et chaque délai d (ms entre la palette baissée et la
// frappe), première cible touchée.
// creer() rend une simulation neuve ({ sim, contacts }) ; dure quelques dizaines de secondes.
export async function etalonner(creer) {
  const tirs = { L: [], R: [] };
  const { sim, contacts } = await creer();
  for (const side of ['L', 'R']) {
    const fl = sim.T.flippers.find((f) => f.def.side === side);
    // le robot agit une fois par image (60 Hz) : les délais sont des nombres entiers d'images
    for (let n = 0; n <= 24; n++) {
      const d = Math.round(n * 1000 / 60);
      sim.clear(); contacts.length = 0;
      sim.held = { L: false, R: false }; sim.held[side] = true;
      for (let k = 0; k < 10; k++) sim.step(1000 / 60);
      const b = sim.makeBall(side === 'R' ? 417 : 61, 700);
      for (let k = 0; k < 150; k++) sim.step(1000 / 60);
      if (repere(fl, b.position).r > FLIP_LEN + 30 || b.vitesse > 0.05) continue;     // pas en berceau
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
