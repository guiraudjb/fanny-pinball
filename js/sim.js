// Simulation physique (Matter.js) : joue le rôle de la mécanique réelle.
// Elle transforme les chocs en « contacts » (comme les micro-rupteurs) et exécute les
// « bobines » demandées par les règles. Bumpers, lance-pierres et flippers réagissent
// localement, exactement comme la réplique où le Mega tire la bobine dès que le contact
// se ferme.

import { buildTable, GEO, BALL_R, CAT, W, CX as CX_TABLE, rampPath, pointAt } from './table.js';

const LANE_X = GEO.playRight + 4;            // intérieur du couloir de lancement
const SHOOTER_Y = GEO.plunger.top - 120;    // zone de repos de la bille sur le lanceur
import { SW, COIL } from './rules.js';

const { Engine, Events, Composite, Bodies, Body } = window.Matter;

const SUB_MS = 1000 / 600;        // pas fixe : 10 sous-pas par image à 60 i/s
const GRAVITY = 2.2;              // ≈ 0,9 m/s² le long du plateau : un peu plus lent qu'un vrai (6,5°) pour le confort
const MAX_SPEED = 50;             // px par 16,7 ms (8 px par sous-pas, < rayon de bille)
const FLIP_UP = 0.045;            // rad/ms (course complète ≈ 22 ms, comme une vraie bobine)
const FLIP_DOWN = 0.02;
const LAUNCH_POWER = 36;             // calé pour suivre l'arrondi du haut et retomber sur les bumpers
const BUMPER_KICK = 12;
const SLING_KICK = 10;
const SAUCER_MAX_SPEED = 16;      // au-delà, la bille passe par-dessus le Cercle
const RAMP_SPEED = 1.0;          // px/ms sur la rampe
const RAMP_MIN_VY = -1.5;         // vitesse montante minimale pour franchir la rampe

export class Sim {
  constructor(onSwitch) {
    this.onSwitch = onSwitch;
    this.engine = Engine.create({ enableSleeping: false, positionIterations: 8, velocityIterations: 6 });
    this.engine.gravity.y = GRAVITY;
    this.T = buildTable(this.engine);
    this.world = this.engine.world;
    this.ramps = { L: rampPath(GEO.ramps.L) };
    this.balls = [];
    this.post = [];
    this.time = 0;
    this.acc = 0;
    this.held = { L: false, R: false };
    this.launchPower = LAUNCH_POWER;
    this.shooterClosed = false;
    this.dropsUp = GEO.drops.map(() => true);
    this.flash = {};            // nom → instant du dernier choc (pour le rendu)
    this.cool = {};             // anti-rebond des contacts
    Events.on(this.engine, 'collisionStart', (e) => this.onCollisions(e.pairs));
  }

  // ---------------------------------------------------------------- billes
  makeBall(x, y) {
    const b = Bodies.circle(x, y, BALL_R, {
      label: 'ball', restitution: 0.2, friction: 0.02, frictionStatic: 0, frictionAir: 0.0015,
      density: 0.004, slop: 0.02,
      collisionFilter: { category: CAT.BALL, mask: CAT.WALL | CAT.BALL },
    });
    b.plugin.fp = { mode: 'table', gate: false, still: 0, saucerIgnoreUntil: 0 };
    Composite.add(this.world, b);
    this.balls.push(b);
    return b;
  }

  removeBall(b, forget) {
    Composite.remove(this.world, b);
    if (forget) this.balls = this.balls.filter((o) => o !== b);
  }

  clear() {
    for (const b of this.balls) Composite.remove(this.world, b);
    this.balls = [];
    this.shooterClosed = false;
    this.resetDrops();
  }

  // ---------------------------------------------------------------- bobines
  coil(name) {
    const P = GEO.plunger;
    if (name === COIL.TROUGH) {
      const occupied = this.balls.some((b) => b.plugin.fp.mode === 'table' && b.position.x > LANE_X && b.position.y > SHOOTER_Y);
      this.makeBall(P.x, occupied ? P.ballY - 60 : P.ballY);
    } else if (name === COIL.LAUNCH) {
      for (const b of this.balls) {
        if (b.plugin.fp.mode === 'table' && b.position.x > LANE_X && b.position.y > SHOOTER_Y) {
          Body.setVelocity(b, { x: 0, y: -(this.launchPower + (Math.random() - 0.5) * 1.6) });
        }
      }
      this.flash.plunger = this.time;
    } else if (name === COIL.SAUCER) {
      const s = GEO.saucer;
      for (const b of this.balls) {
        if (b.plugin.fp.mode !== 'saucer') continue;
        b.plugin.fp.mode = 'table';
        b.plugin.fp.saucerIgnoreUntil = this.time + 900;
        Body.setPosition(b, { x: s.x, y: s.y + 2 });
        Composite.add(this.world, b);
        const k = s.kick || { x: 0, y: 7 };
        Body.setVelocity(b, { x: k.x + (Math.random() - 0.5) * 2, y: k.y + (Math.random() - 0.5) * 2 });
      }
      this.flash.saucer = this.time;
    } else if (name === COIL.DROP_RESET) {
      this.resetDrops();
    }
  }

  resetDrops() {
    this.T.drops.forEach((d, i) => {
      if (!this.dropsUp[i]) { Composite.add(this.world, d); this.dropsUp[i] = true; }
    });
  }

  // ---------------------------------------------------------------- chocs
  debounce(key, ms) {
    if (this.cool[key] && this.time - this.cool[key] < ms) return false;
    this.cool[key] = this.time;
    return true;
  }

  onCollisions(pairs) {
    for (const pair of pairs) {
      let ball = pair.bodyA, other = pair.bodyB;
      if (ball.label !== 'ball') { ball = pair.bodyB; other = pair.bodyA; }
      if (ball.label !== 'ball' || other.label === 'ball') continue;
      const fp = ball.plugin.fp;
      const d = other.plugin || {};

      switch (other.label) {
        case 'bumper':
          if (!this.debounce(`bumper${d.idx}`, 60)) break;
          this.flash[`bumper${d.idx}`] = this.time;
          this.post.push(() => {
            let dx = ball.position.x - other.position.x, dy = ball.position.y - other.position.y;
            const l = Math.hypot(dx, dy) || 1;
            Body.setVelocity(ball, { x: (dx / l) * BUMPER_KICK, y: (dy / l) * BUMPER_KICK });
          });
          this.onSwitch(SW.BUMPERS[d.idx]);
          break;

        case 'sling': {
          const { A, n } = d;
          const side = (ball.position.x - A[0]) * n.x + (ball.position.y - A[1]) * n.y;
          if (side < BALL_R * 0.5) break; // choc sur le dos du triangle : pas de tir
          if (!this.debounce(`sling${d.idx}`, 200)) break;
          this.flash[`sling${d.idx}`] = this.time;
          this.post.push(() => {
            const v = Body.getVelocity(ball);
            const tx = -n.y, ty = n.x;
            const vt = v.x * tx + v.y * ty;
            Body.setVelocity(ball, { x: n.x * SLING_KICK + tx * vt * 0.5, y: n.y * SLING_KICK + ty * vt * 0.5 });
          });
          this.onSwitch(SW.SLINGS[d.idx]);
          break;
        }

        case 'drop':
          if (!this.dropsUp[d.idx]) break;
          this.dropsUp[d.idx] = false;
          this.post.push(() => Composite.remove(this.world, other));
          this.onSwitch(SW.DROPS[d.idx]);
          break;

        case 'standup':
          if (!this.debounce(`standup${d.idx}`, 250)) break;
          this.flash[`standup${d.idx}`] = this.time;
          this.onSwitch(SW.STANDUPS[d.idx]);
          break;

        case 'target':
          if (!this.debounce(`target${d.idx}`, 250)) break;
          this.flash[`target${d.idx}`] = this.time;
          this.onSwitch(d.id);
          break;

        case 'lane':
          if (!this.debounce(`lane${d.idx}`, 300)) break;
          this.onSwitch(SW.LANES[d.idx]);
          break;

        case 'saucer':
          if (fp.mode !== 'table' || this.time < fp.saucerIgnoreUntil) break;
          if (Body.getSpeed(ball) > SAUCER_MAX_SPEED) break; // trop rapide : elle saute le trou
          fp.mode = 'saucer';
          this.post.push(() => {
            Composite.remove(this.world, ball);
            Body.setPosition(ball, { x: GEO.saucer.x, y: GEO.saucer.y });
            Body.setVelocity(ball, { x: 0, y: 0 });
          });
          this.onSwitch(SW.SAUCER);
          break;

        case 'rampEntry': {
          if (fp.mode !== 'table') break;
          const v = Body.getVelocity(ball);
          if (v.x * d.u.x + v.y * d.u.y < -RAMP_MIN_VY) break; // trop lente : elle retombera du couloir
          fp.mode = 'ramp';
          fp.ramp = d.side;
          fp.s = 0;
          fp.rampSpeed = Math.max(RAMP_SPEED, Math.min(1.1, Math.hypot(v.x, v.y) / 16.7));
          this.post.push(() => Composite.remove(this.world, ball));
          break;
        }

        case 'drain':
          if (fp.mode !== 'table') break;
          fp.mode = 'gone';
          this.post.push(() => this.removeBall(ball, true));
          this.onSwitch(SW.DRAIN);
          break;
      }
    }
  }

  // ---------------------------------------------------------------- boucle
  step(dtMs) {
    this.acc += Math.min(dtMs, 100);
    while (this.acc >= SUB_MS) {
      this.acc -= SUB_MS;
      this.substep(SUB_MS);
    }
    this.frameChecks(dtMs);
  }

  substep(dt) {
    this.time += dt;

    for (const fl of this.T.flippers) {
      const held = this.held[fl.def.side];
      const target = held ? fl.def.up : fl.def.rest;
      const speed = (held ? FLIP_UP : FLIP_DOWN) * dt;
      const delta = Math.max(-speed, Math.min(speed, target - fl.angle));
      fl.angle += delta;
      Body.rotate(fl.body, delta, { x: fl.def.px, y: fl.def.py }, true);
    }

    for (const b of this.balls) {
      const fp = b.plugin.fp;
      if (fp.mode !== 'table') continue;
      // portillon à sens unique en haut du couloir de lancement
      if (b.position.y < GEO.gate.y - GEO.gate.drop / 2 - BALL_R - 6) fp.gate = true;
      else if (b.position.x > GEO.playRight && b.position.y > GEO.gate.y + GEO.gate.drop / 2 + BALL_R + 4) fp.gate = false;
      b.collisionFilter.mask = CAT.WALL | CAT.BALL | (fp.gate ? CAT.GATE : 0);
    }

    Engine.update(this.engine, dt);

    if (this.post.length) {
      const jobs = this.post;
      this.post = [];
      jobs.forEach((f) => f());
    }

    for (const b of this.balls) {
      const fp = b.plugin.fp;
      if (fp.mode === 'table') {
        const v = Body.getVelocity(b);
        const sp = Math.hypot(v.x, v.y);
        if (sp > MAX_SPEED) Body.setVelocity(b, { x: (v.x / sp) * MAX_SPEED, y: (v.y / sp) * MAX_SPEED });
        // filet de sécurité : bille sortie de la table
        const { x, y } = b.position;
        if (y > GEO.drainY + 40 || x < -20 || x > W + 20 || y < -40) {
          fp.mode = 'gone';
          this.post.push(() => this.removeBall(b, true));
          this.onSwitch(SW.DRAIN);
        }
      } else if (fp.mode === 'ramp') {
        const path = this.ramps[fp.ramp];
        fp.s += fp.rampSpeed * dt;
        if (fp.s >= path.length) {
          const end = pointAt(path, path.length);
          fp.mode = 'table';
          fp.gate = true;
          Body.setPosition(b, { x: end.x, y: end.y });
          Composite.add(this.world, b);
          Body.setVelocity(b, { x: end.dx * 6, y: end.dy * 6 });
          this.flash[`ramp${fp.ramp}`] = this.time;
          this.onSwitch(SW.RAMP);
        }
      }
    }
  }

  frameChecks(dtMs) {
    // contact du couloir de lancement
    const inShooter = this.balls.some((b) => b.plugin.fp.mode === 'table' && b.position.x > LANE_X
      && b.position.y > GEO.plunger.ballY - 8 && Math.abs(Body.getVelocity(b).y) < 0.8);
    if (inShooter !== this.shooterClosed) {
      this.shooterClosed = inShooter;
      this.onSwitch(SW.SHOOTER, inShooter);
    }
    // bille immobile hors couloir (coincée) : petite secousse automatique
    for (const b of this.balls) {
      const fp = b.plugin.fp;
      if (fp.mode !== 'table' || (b.position.x > GEO.playRight && b.position.y > SHOOTER_Y)) { fp.still = 0; continue; }
      // bille tenue volontairement sur un flipper levé : on ne la secoue pas
      const cradled = b.position.y > GEO.flippers[0].py - 90
        && ((this.held.L && b.position.x < CX_TABLE) || (this.held.R && b.position.x >= CX_TABLE));
      if (Body.getSpeed(b) < 0.15 && !cradled) fp.still += dtMs; else fp.still = 0;
      if (fp.still > 1500) {
        // secousses de plus en plus fortes, dirigées vers le centre de la table (comme un joueur qui
        // secoue la caisse) ; le compteur repart quand la bille a quitté l'endroit
        fp.still = 0;
        if (!fp.stuckAt || Math.hypot(b.position.x - fp.stuckAt.x, b.position.y - fp.stuckAt.y) > 30) {
          fp.stuckAt = { x: b.position.x, y: b.position.y }; fp.nudges = 0;
        }
        fp.nudges++;
        let dx = CX_TABLE - b.position.x, dy = 480 - b.position.y;
        const l = Math.hypot(dx, dy) || 1;
        const k = 4 + 3 * Math.min(fp.nudges, 4);
        Body.setVelocity(b, { x: (dx / l) * k + (Math.random() - 0.5) * 3, y: (dy / l) * k - 3 });
      }
    }
  }

  // positions pour le rendu
  ballViews() {
    return this.balls.filter((b) => b.plugin.fp.mode !== 'gone').map((b) => {
      const fp = b.plugin.fp;
      if (fp.mode === 'ramp') {
        const p = pointAt(this.ramps[fp.ramp], fp.s);
        return { x: p.x, y: p.y, onRamp: true };
      }
      return { x: b.position.x, y: b.position.y, onRamp: false, inSaucer: fp.mode === 'saucer' };
    });
  }
}
