// Robot joueur, niveau tournoi (IFPA) : il ne voit que ce que voit un joueur (billes, palettes, lampes des règles)
// et n'agit que par les commandes d'un joueur (palettes, lanceur, coups de caisse frontaux et latéraux).
// Sert au mode Autoplay dans la page et au banc d'essai headless (outils/robot.mjs).
//
// Répertoire technique complet (voir docs/analyse_de_l_espacement_des_batteurs_et_des_techniques_de_flipper.md) :
//   • Amorti & contrôle : Berceau (Cradle), Live Catch, Drop Catch, Séparation en multibille (Cradle Separation), Shatz
//   • Transferts (Passing) : Dead Bounce (rebond mort), Post Pass, Tap / Alley Pass, Changement de couloir T-O-U-R
//   • Tirs de précision : Coup droit (Forehand), Revers (Backhand), Flick / Tip Shot visé à la volée selon le
//   • Sauvetage & bourrage : Slap Save (claque + nudge latéral), Slide Save (nudge anti-outlane), Center Nudge (sans Tilt)
import { GEO, BALL_R, CX } from './table.js';
import { SW } from './rules.js';

const MM = 0.001;
const FLIP_LEN = GEO.flippers[0].len;   // 57,7 mm (géométrie moderne 3")
const TENUE_TIR_MS = 180;               // palette tenue après une frappe
const BERCEAU_MS = 280;                 // bille immobile en berceau depuis … avant tir / passe
const TILT_SUR = 1.15;                  // plafond de sim.bob sous lequel le robot s'autorise un coup de caisse (TILT = 2,4)

const NOMS_GESTES = {
  berceau: 'Berceau',
  liveCatch: 'Live Catch',
  dropCatch: 'Drop Catch',
  cradleSep: 'Séparation multibille',
  deadBounce: 'Dead Bounce',
  postPass: 'Post Pass',
  tapPass: 'Tap / Alley Pass',
  shatz: 'Shatz',
  forehand: 'Coup droit',
  backhand: 'Revers',
  flick: 'Flick visé',
  slapSave: 'Slap Save',
  slideSave: 'Slide Save',
  centerNudge: 'Bourrage central',
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

// Étalonnage par défaut (issu d'outils/robot_tirs.json), embarqué pour jouer dans la page et hors ligne (PWA).
export const TIRS_DEFAUT = {
  L: [
    [417, '-'], [433, '-'], [450, '-'], [467, '-'], [483, '-'], [500, 'boule3'], [517, '-'], [533, '-'],
    [550, '-'], [567, '-'], [583, '-'], [600, 'tirer'], [617, 'tirer'], [633, 'dropF'], [650, 'saucer'],
    [667, 'boule3'], [683, 'tirer'], [700, 'tirer'], [717, 'tirer'], [733, 'tirer'], [750, '-'], [767, '-'],
    [783, '-'], [800, 'dropF'],
  ].map(([d, cible]) => ({ d, cible })),
  R: [
    [417, '-'], [433, '-'], [450, '-'], [467, '-'], [483, '-'], [500, 'dropF'], [517, '-'], [533, 'saucer'],
    [550, '-'], [567, 'tirer'], [583, 'tirer'], [600, 'tirer'], [617, 'dropN1'], [633, '-'], [650, '-'],
    [667, '-'], [683, '-'], [700, 'bouchon'], [717, 'dropF'], [733, 'drain'], [750, 'ramp'], [767, 'ramp'],
    [783, 'boule1'], [800, '-'],
  ].map(([d, cible]) => ({ d, cible })),
};

// Positions le (mm depuis le pivot) pour un tir visé à la volée sur bille roulante (étalonnées en simulation)
const LE_TIRS = {
  L: { tirer: 23, saucer: 26, drops: 34, ramp: 28, bouchon: 48, pointer: 46, boule: 50 },
  R: { tirer: 23, ramp: 26, bouchon: 30, boule: 30, pointer: 37, drops: 54, saucer: 50 },
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
    this.dernierNudge = -1e9;
    this.dernierLane = -1e9;
    this.slap = null;                  // { first, second, t, phase }
    this.passeAlt = 0;                 // alterne passe / revers
    this.passeMode = 0;                // alterne Tap Pass (0) / Post Pass (1) / Shatz (2)
    this.catchAlt = 0;                 // alterne Live Catch / Drop Catch sur les balles descendantes
    this.dernierGeste = null;          // { code, nom, detail, jusqua } pour affichage HUD en Autoplay
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

  // d visé exact pour une cible sur ce batteur (exclut tout délai voisin d'un drain pour la fiabilité)
  choisirTirExact(side, cible) {
    const bon = (t) => t && (cible === 'drops' ? t.cible.startsWith('drop') : t.cible === cible);
    const T = this.tirs[side] || [];
    let mieux = null, note = -1;
    T.forEach((t, i) => {
      if (!bon(t)) return;
      if (T[i - 1]?.cible === 'drain' || T[i + 1]?.cible === 'drain') return;
      const n = bon(T[i - 1]) + bon(T[i + 1]);
      if (n > note) { note = n; mieux = t.d; }
    });
    return mieux;
  }

  // d visé avec repli sûr (ne jamais figer une bille en berceau ni choisir un délai proche d'un drain)
  choisirTir(side, cible) {
    const exact = this.choisirTirExact(side, cible);
    if (exact !== null) return exact;
    const T = this.tirs[side] || [];
    const sur = T.find((t, i) => t.cible !== '-' && t.cible !== 'drain' && T[i - 1]?.cible !== 'drain' && T[i + 1]?.cible !== 'drain');
    return sur?.d ?? 600;
  }

  estRevers(side, cible) {
    return COTE_CIBLE[cible] === side;
  }

  nudgeSur(dx, code, detail = '') {
    if (this.sim.bob >= TILT_SUR || this.sim.time - this.dernierNudge < 1100) return false;
    this.dernierNudge = this.sim.time;
    this.act.nudge(dx);
    this.stats.coups++;
    this.noterGeste(code, detail);
    return true;
  }

  tick(dtMs) {
    const sim = this.sim, r = this.rules;
    if (r.mode !== 'play') { this.relacher(); return; }

    // 1. Lanceur à ressort (tiré progressivement) + changement de couloir avant le lancer
    if (sim.shooterClosed) {
      if (this.lanceur === 0 && r.letters.some((l) => !l) && r.letters[2] && r.letters[3]) {
        // décale une lettre éteinte sous les couloirs de droite où retombe le lancement
        this.act.flip('R', true); this.act.flip('R', false);
        this.noterGeste('laneChange', 'T-O-U-R');
      }
      this.lanceur += dtMs;
      sim.tirage = Math.min(1, this.lanceur / 600);
      if (this.lanceur > 600) { sim.tirage = 0; this.act.launch(1.1); this.lanceur = 0; this.log('lancer'); }
    } else {
      if (this.lanceur) sim.tirage = 0;
      this.lanceur = 0;
    }

    const billes = sim.balls.filter((b) => b.plugin.fp.mode === 'table' && !b.retiree && !sim.dansLanceur(b));
    if (!billes.length) {
      for (const s of ['L', 'R']) if (this.etat[s].phase !== 'libre') { this.act.flip(s, false); this.etat[s] = { phase: 'libre', t: 0 }; }
      this.slap = null;
      return;
    }

    // 2. Changement de couloir T-O-U-R en vol (quand aucune bille n'est dans la zone basse des batteurs)
    const basOccupe = billes.some((b) => b.position.y > 600);
    if (!basOccupe && !this.slap && sim.time - this.dernierLane > 280 && r.letters.some((l) => !l) && r.letters.some(Boolean)) {
      const bHaut = billes.find((b) => b.position.y > 55 && b.position.y < 128 && b.position.x > 155 && b.position.x < 323 && b.velocity.y > 0);
      if (bHaut) {
        const idx = Math.max(0, Math.min(3, Math.floor((bHaut.position.x - 155) / 42)));
        if (r.letters[idx]) {
          // choisir le sens qui amène la lettre éteinte la plus proche dans le couloir visé
          const versD = !r.letters[(idx + 3) % 4];
          const s = versD ? 'R' : 'L';
          this.act.flip(s, true);
          this.etat[s] = { phase: 'tenue', t: TENUE_TIR_MS - 45 };
          this.dernierLane = sim.time;
          this.noterGeste('laneChange', 'T-O-U-R');
        }
      }
    }

    // 3. Slide Save : bourrage latéral préventif au-dessus des poteaux d'outlane (x ≈ 40 et x ≈ 438)
    for (const b of billes) {
      const { x, y } = b.position, vx = b.velocity.x * 60 * MM, vy = b.velocity.y * 60 * MM;
      if (y > 640 && y < 712 && vy > 0.15) {
        if (x < 62 && x > 10 && vx <= 0.25) {
          this.nudgeSur(1, 'slideSave', 'outlane G');
        } else if (x > 416 && x < 468 && vx >= -0.25) {
          this.nudgeSur(-1, 'slideSave', 'outlane D');
        }
      }
    }

    // 4. Slap Save (sauvetage par claque sur bille SDTM au centre) — coordonné sur les deux batteurs
    if (this.slap) {
      const sl = this.slap;
      sl.t += dtMs;
      if (sl.phase === 'first' && sl.t >= 48) {
        this.act.flip(sl.second, true);
        sl.phase = 'both';
      } else if (sl.t >= 175) {
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
        if (y > 785 && y < 902 && vy > 0.22) {
          const dtCentre = Math.max(0, (895 - y) * MM / vy);
          const xPred = x + (vx * dtCentre) / MM;
          if (Math.abs(xPred - CX) < 26) {
            const first = xPred <= CX ? 'L' : 'R', second = autre(first);
            // coup latéral précoce pour décaler la bille sur la pointe du batteur le plus proche
            if (y > 805 && y < 855 && Math.abs(xPred - CX) < 22) {
              this.nudgeSur(first === 'L' ? -1 : 1, 'centerNudge', first);
            }
            if (y > 852 || dtCentre < 0.055) {
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

  // Prépare le batteur opposé à recevoir une passe (Dead Bounce, Post Pass, Tap Pass)
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

    // --- phases minutées en cours ---
    if (e.phase === 'tir') {
      if (e.t >= e.d - 1) {
        tenir(true);
        e.phase = 'tenue'; e.t = 0; e.duree = TENUE_TIR_MS;
        this.stats.tirs[e.cible] = (this.stats.tirs[e.cible] || 0) + 1;
        this.noterGeste(this.estRevers(side, e.cible) ? 'backhand' : 'forehand', `${side} → ${e.cible}`);
      }
      return;
    }
    if (e.phase === 'passe') {
      if (e.t >= e.d - 1) {
        tenir(true);
        e.phase = 'tenue'; e.t = 0; e.duree = e.hold;
        this.noterGeste(e.typePasse, `${side}→${opp}`);
      }
      return;
    }
    if (e.phase === 'cradleSep') {
      // micro-relâchement de 65 ms puis reprise immédiate pour libérer la bille du dessus en multibille
      if (e.t >= 65) {
        tenir(true);
        e.phase = 'berceau'; e.t = 0;
      }
      return;
    }
    if (e.phase === 'dropCatch') {
      // relâchement juste avant l'impact pour amortir, puis reprise en berceau 70 ms plus tard
      if (!e.lache && e.t >= e.attente) {
        tenir(false); e.lache = true; e.t = 0;
      } else if (e.lache && e.t >= 70) {
        tenir(true); e.phase = 'attrape'; e.t = 0; e.raison = 'dropCatch';
      }
      return;
    }
    if (e.phase === 'deadBounce') {
      // laisse la bille rebondir sur la palette immobile au repos vers l'autre batteur levé
      if (e.t > 380) { e.phase = 'libre'; e.t = 0; }
      return;
    }
    if (e.phase === 'tenue') {
      if (e.t >= (e.duree ?? TENUE_TIR_MS)) { tenir(false); e.phase = 'libre'; e.t = 0; }
      return;
    }

    // billes de ce côté : dans la zone de la palette (y compris au fond du berceau, le jusqu'à −26 mm)
    const proches = billes.map((b) => ({ b, q: repere(fl, b.position) }))
      .filter(({ q }) => q.r < FLIP_LEN + BALL_R + 42 && q.t > -BALL_R && q.le > -26);

    // détection anticipée d'une bille descendant l'inlane de ce côté (pour lever tôt et réussir le Berceau)
    const bInlane = billes.find((b) => (side === 'L' ? b.position.x < 145 : b.position.x > 333)
      && b.position.y > 720 && b.position.y < 885 && b.velocity.y * 60 * MM > 0.05);
    if (e.phase === 'libre' && bInlane && billes.length === 1 && !proches.length) {
      tenir(true); e.phase = 'attrape'; e.t = 0; e.raison = 'berceau';
      return;
    }

    if (!proches.length) {
      // attente de réception d'une passe, d'un berceau d'inlane ou d'un catch : ne pas relâcher trop tôt
      const delai = e.raison === 'passe' ? 1600 : bInlane ? 1800 : 900;
      if (e.phase !== 'libre' && (e.phase !== 'attrape' || e.t > delai)) { tenir(false); e.phase = 'libre'; e.t = 0; }
      return;
    }

    // bille la plus basse (la plus urgente)
    const { b, q } = proches.reduce((m, x) => (x.b.position.y > m.b.position.y ? x : m));
    const vx = b.velocity.x * 60 * MM, vy = b.velocity.y * 60 * MM, v = b.vitesse;

    // --- berceau (Cradle) ---
    if (e.phase === 'berceau') {
      // séparation en multibille (Cradle Separation) : une 2e bille arrive sur ce batteur déjà occupé
      if (proches.length >= 2 && e.t > 120) {
        tenir(false);
        e.phase = 'cradleSep'; e.t = 0;
        this.noterGeste('cradleSep', side);
        return;
      }
      if (v > 0.08) { e.t = 0; return; }
      if (e.t < BERCEAU_MS) return;

      const cible = this.cibleVoulue();
      const dExact = this.choisirTirExact(side, cible);
      const dOpp = this.choisirTirExact(opp, cible);
      // transférer vers l'autre batteur si la cible n'est atteignable que de l'autre côté, OU si c'est un revers
      // délicat alors que l'autre batteur offre un coup droit propre (ex. drops depuis D → passe à G)
      const preferePasse = (dExact === null && dOpp !== null)
        || (dOpp !== null && this.estRevers(side, cible) && !this.estRevers(opp, cible) && (this.passeAlt % 2 === 0));

      if (preferePasse && billes.length === 1 && this.etat[opp].phase === 'libre') {
        this.preparerReception(opp, 'passe');
        tenir(false);
        this.passeAlt++;
        const mode = this.passeMode++ % 3;
        if (mode === 0) {
          // Tap / Alley Pass de pointe (833 ms, micro-impulsion) : transfère sur le batteur opposé
          e.phase = 'passe'; e.d = 833; e.hold = 25; e.typePasse = 'tapPass'; e.t = 0;
        } else if (mode === 1) {
          // Post Pass (500 ms) : renvoie via le plot / haut vers le batteur opposé
          e.phase = 'passe'; e.d = 500; e.hold = 180; e.typePasse = 'postPass'; e.t = 0;
        } else {
          // Shatz (700 ms, micro-impulsion de pointe) : remonte l'inlane opposé vers l'autre palette
          e.phase = 'passe'; e.d = 700; e.hold = 25; e.typePasse = 'shatz'; e.t = 0;
        }
        return;
      }
      if (this.estRevers(side, cible) && !this.estRevers(opp, cible)) this.passeAlt++;

      const d = this.choisirTir(side, cible);
      tenir(false);
      e.phase = 'tir'; e.d = d; e.cible = cible; e.t = 0;
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
      if (e.t > 2800) { tenir(false); e.phase = 'libre'; e.t = 0; }
      return;
    }

    // --- libre : bille qui descend vers la palette ou roule dessus ---
    const surPalette = q.t < BALL_R + 18;
    const dansInlane = (side === 'L' ? b.position.x < 145 : b.position.x > 333) && b.position.y > 740;

    // A. Bille qui descend du plateau vers la palette (hors contact immédiat)
    if (!surPalette && vy > 0.15 && q.le > -4 && q.le < FLIP_LEN + 22) {
      const avance = vy * 1000;                      // mm/s
      const tImpMs = Math.max(0, ((q.t - BALL_R - 7) / avance) * 1000);
      const sg = side === 'L' ? 1 : -1;
      const leImp = q.le + (vx * sg * tImpMs);

      // 1. Retour depuis l'inlane : lever tôt pour un Berceau propre (100 % stable sur Voie A)
      if (dansInlane && billes.length === 1 && tImpMs < 240) {
        tenir(true); e.phase = 'attrape'; e.t = 0; e.raison = 'berceau';
        return;
      }

      // 2. Dead Bounce : bille de vitesse moyenne tombant au milieu de la palette → laisser rebondir palette morte
      //    vers le batteur opposé levé quand la cible voulue est mieux placée de l'autre côté (ou en contrôle)
      const cible = this.cibleVoulue();
      const prefereOpp = this.choisirTirExact(side, cible) === null && this.choisirTirExact(opp, cible) !== null;
      if (billes.length === 1 && this.etat[opp].phase === 'libre'
          && v >= 0.72 && v <= 1.35 && Math.abs(vx) < 0.35 && leImp >= 24 && leImp <= 48 && tImpMs < 130
          && (prefereOpp || (this.catchAlt % 4 === 3))) {
        this.catchAlt++;
        this.preparerReception(opp, 'passe');
        e.phase = 'deadBounce'; e.t = 0;
        this.noterGeste('deadBounce', `${side}→${opp}`);
        return;
      }

      // 3. Drop Catch ou Live Catch : amorti contrôlé sur bille descendante (en simple bille)
      if (billes.length === 1 && v >= 0.45 && v <= 2.1 && Math.abs(vx) < 0.95 && leImp >= 10 && leImp <= 54) {
        const modeCatch = this.catchAlt % 2;
        if (modeCatch === 0 && tImpMs > 40 && tImpMs < 130) {
          // Drop Catch : on lève tôt, puis on relâche juste avant le contact pour absorber l'énergie
          this.catchAlt++;
          tenir(true);
          e.phase = 'dropCatch'; e.t = 0; e.lache = false; e.attente = Math.max(16, tImpMs - 30);
          this.noterGeste('dropCatch', side);
          return;
        }
        if (tImpMs <= 45) {
          // Live Catch : levée synchronisée au moment exact du contact, tenue haute
          this.catchAlt++;
          tenir(true);
          e.phase = 'attrape'; e.t = 0; e.raison = 'liveCatch';
          this.noterGeste('liveCatch', side);
          return;
        }
        return;
      }

      // 4. Bille très rapide ou multibille : frappe de sauvetage / tir à la volée au bon timing
      if (tImpMs <= 42) {
        tenir(true); e.phase = 'tenue'; e.t = 0; e.duree = TENUE_TIR_MS;
        this.stats.sauvetages++;
        this.noterGeste('sauvetage', side);
      }
      return;
    }

    // B. Bille roulant sur la palette vers la pointe : Flick / tir visé au bon « le » (ou sauvetage en bout de course)
    if (surPalette) {
      const cible = this.cibleVoulue();
      const leCible = LE_TIRS[side][cible] ?? FLIP_LEN * 0.65;
      if (q.le >= leCible && q.le <= FLIP_LEN + 10) {
        tenir(true); e.phase = 'tenue'; e.t = 0; e.duree = TENUE_TIR_MS;
        this.stats.tirs[cible] = (this.stats.tirs[cible] || 0) + 1;
        this.noterGeste('flick', `${side} → ${cible}`);
      } else if (q.le > FLIP_LEN * 0.85) {
        tenir(true); e.phase = 'tenue'; e.t = 0; e.duree = TENUE_TIR_MS;
        this.stats.sauvetages++;
        this.noterGeste('sauvetage', side);
      }
    }
  }

  relacher() {
    this.lanceur = 0;
    this.sim.tirage = 0;
    this.slap = null;
    for (const s of ['L', 'R']) { this.act.flip(s, false); this.etat[s] = { phase: 'libre', t: 0 }; }
  }
}

// Étalonnage des tirs depuis le berceau : pour chaque côté et chaque délai d (ms entre la palette baissée et la
// frappe), première cible touchée.
// creer() rend une simulation neuve ({ sim, contacts }) ; dure quelques dizaines de secondes.
export async function etalonner(creer) {
  const tirs = { L: [], R: [] };
  const { sim, contacts } = await creer();
  for (const side of ['L', 'R']) {
    const fl = sim.T.flippers.find((f) => f.def.side === side);
    // le robot agit une fois par image (60 Hz) : les délais sont des nombres entiers d'images
    for (let n = 0; n <= 48; n++) {
      const d = Math.round(n * 1000 / 60);
      sim.clear(); contacts.length = 0;
      sim.held = { L: false, R: false }; sim.held[side] = true;
      for (let k = 0; k < 10; k++) sim.step(1000 / 60);
      const b = sim.makeBall(side === 'R' ? 417 : 61, 700);
      for (let k = 0; k < 210; k++) sim.step(1000 / 60);
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
