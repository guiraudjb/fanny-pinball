// Règles du jeu : portage ligne à ligne de js/rules.js (mêmes contacts, bobines, sons, lampes, afficheurs).
// Les minuteries de JavaScript (after(ms, fn)) deviennent des actions différées (enum Differe).

pub mod sw {
    pub const START: &str = "start";
    pub const COIN: &str = "coin";
    pub const TILT: &str = "tilt";
    pub const SHOOTER: &str = "shooter";
    pub const LAUNCH: &str = "launch";
    pub const FLIP_L: &str = "flipL";
    pub const FLIP_R: &str = "flipR";
    pub const DRAIN: &str = "drain";
    pub const SAUCER: &str = "saucer";
    pub const RAMP: &str = "ramp";
    pub const SPINNER: &str = "spinner";
    pub const LANES: [&str; 4] = ["laneT", "laneO", "laneU", "laneR"];
    pub const LOWER_LANES: [&str; 6] = ["outL", "inExtL", "inIntL", "inIntR", "inExtR", "outR"];
    pub const DROPS: [&str; 5] = ["dropF", "dropA", "dropN1", "dropN2", "dropY"];
    pub const STANDUPS: [&str; 3] = ["pointer", "tirer", "bouchon"];
    pub const TARGETS: [&str; 3] = ["boule1", "boule2", "boule3"];
    pub const SLINGS: [&str; 2] = ["slingL", "slingR"];
    pub const BUMPERS: [&str; 3] = ["bumper1", "bumper2", "bumper3"];
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Bobine { Trough, Launch, Saucer, DropReset, Knocker, PowerOff, PowerOn }

pub mod snd {
    pub const START: u16 = 1; pub const BUMPER: u16 = 2; pub const SLING: u16 = 3; pub const FLIP: u16 = 4;
    pub const DROP: u16 = 5; pub const DROPS_DONE: u16 = 6; pub const RAMP: u16 = 7; pub const LANE: u16 = 8;
    pub const LANES_DONE: u16 = 9; pub const STANDUP: u16 = 10; pub const SAUCER: u16 = 11; pub const MULTIBALL: u16 = 12;
    pub const JACKPOT: u16 = 13; pub const CITY: u16 = 14; pub const GRAND_CHELEM: u16 = 15; pub const EXTRA: u16 = 16;
    pub const BALL_SAVE: u16 = 17; pub const DRAIN: u16 = 18; pub const BONUS: u16 = 19; pub const GAME_OVER: u16 = 20;
    pub const LAUNCH: u16 = 21; pub const MUSIQUE_GENERIQUE: u16 = 22; pub const MUSIQUE_THEME: u16 = 23;
    pub const V_START: u16 = 24; pub const V_MULTIBALL: u16 = 25; pub const V_JACKPOT: u16 = 26; pub const V_CARREAU: u16 = 27;
    pub const V_BIBERON: u16 = 28; pub const V_BOUCHON: u16 = 29; pub const V_TRIPLETTE: u16 = 30; pub const V_GRAND_CHELEM: u16 = 31;
    pub const V_EXTRA: u16 = 32; pub const V_BALL_SAVE: u16 = 33; pub const V_MB_LIT: u16 = 34; pub const V_BONUS_MULT: u16 = 35;
    pub const V_DRAIN: u16 = 36; pub const V_GAME_OVER: u16 = 37; pub const V_RECORD: u16 = 38; pub const V_CITY_1: u16 = 39;
    pub const CLAC: u16 = 45; pub const MATCH: u16 = 46; pub const V_PARTIE_GRATUITE: u16 = 47; pub const V_MATCH: u16 = 48;
    pub const V_EXTRA_LIT: u16 = 49; pub const V_SUPER_JACKPOT: u16 = 50; pub const NUDGE: u16 = 51; pub const TILT: u16 = 52;
    pub const V_ATTENTION: u16 = 53; pub const V_TILT: u16 = 54; pub const SPINNER: u16 = 55;
    /// voix de Fanny : un seul canal (une réplique coupe la précédente)
    pub fn est_voix(id: u16) -> bool {
        (V_START..=V_CITY_1 + 5).contains(&id) || (V_PARTIE_GRATUITE..=V_SUPER_JACKPOT).contains(&id) || id >= V_ATTENTION && id != SPINNER
    }
}

pub const CITIES: [&str; 7] = ["MARSEILLE", "PARIS", "LONDRES", "NEW YORK", "TOKYO", "RIO", "SYDNEY"];
const BALLS_PER_GAME: u32 = 3;
const BALL_SAVE_MS: f64 = 8000.0;
const MB_BALL_SAVE_MS: f64 = 10000.0;
const MAX_MULT: u32 = 5;
const JACKPOT_START: u64 = 20000;
const JACKPOT_STEP: u64 = 5000;
const CARREAU_MS: f64 = 20000.0;
const CARREAU_PTS: u64 = 10000;
const REPLAY_LEVELS: [u64; 3] = [150000, 300000, 500000];
const MAX_CREDITS: u32 = 9;
const EXTRA_MAX: u32 = 2;
const EXTRA_POINTS: u64 = 25000;
const SUPER_AFTER: u32 = 3;
const FREE_PLAY: bool = true;
const TILT_WARNINGS: u32 = 2;
const TILT_SETTLE_MS: f64 = 1200.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode { Attract, Play, Bonus, Match, Over }

#[derive(Clone, Debug)]
enum Differe {
    NextBall, CountBonus, FreeGame(&'static str), StartMatch, FinMatch, RetourAttract, SaucerKick, Launch,
    DropsReset, StartMultiball, ServeAuto, Dire(String, f64), DireSon(String, f64, u16), AwardExtra,
}

/// Sorties des règles vers le matériel (bobines, sons), relevées par la boucle de jeu après chaque appel
#[derive(Default)]
pub struct Sorties { pub bobines: Vec<Bobine>, pub sons: Vec<u16> }

struct Message { texte: String, debut: f64, fin: f64 }

pub struct Regles {
    pub now: f64,
    minuteries: Vec<(f64, Differe)>,
    pub high_score: u64,
    pub last_score: u64,
    pub mode: Mode,
    msg: Option<Message>,
    pub credits: u32,
    match_num: Option<u32>,
    match_rolling: bool,
    pub score: u64,
    pub ball: u32,
    extra_balls: u32,
    extras_given: u32,
    extra_lit: bool,
    replay_idx: usize,
    balls_in_play: i32,
    pending_serves: i32,
    city: usize,
    mb_lit: bool,
    pub multiball: bool,
    mb_count: u32,
    fanny_done: u32,
    jackpot: u64,
    jackpots_mb: u32,
    super_lit: bool,
    carreaux: u64,
    pub mult: u32,
    bonus: u64,
    letters: [bool; 4],
    drops: [bool; 5],
    point_lit: bool,
    carreau_until: f64,
    targets: [bool; 3],
    ball_save_until: f64,
    ball_save_armed: bool,
    shooter_closed: bool,
    auto_launch_next: bool,
    saucer_busy: bool,
    tilt_warnings: u32,
    tilt_ignore_until: f64,
    pub tilted: bool,
    pub sorties: Sorties,
    graine: u64,
}

impl Regles {
    pub fn new(graine: u64) -> Self {
        let mut r = Regles {
            now: 0.0, minuteries: vec![], high_score: 0, last_score: 0, mode: Mode::Attract, msg: None, credits: 0,
            match_num: None, match_rolling: false, score: 0, ball: 0, extra_balls: 0, extras_given: 0, extra_lit: false,
            replay_idx: 0, balls_in_play: 0, pending_serves: 0, city: 0, mb_lit: false, multiball: false, mb_count: 0,
            fanny_done: 0, jackpot: JACKPOT_START, jackpots_mb: 0, super_lit: false, carreaux: 0, mult: 1, bonus: 0,
            letters: [false; 4], drops: [false; 5], point_lit: false, carreau_until: 0.0, targets: [false; 3],
            ball_save_until: 0.0, ball_save_armed: false, shooter_closed: false, auto_launch_next: false, saucer_busy: false,
            tilt_warnings: 0, tilt_ignore_until: 0.0, tilted: false, sorties: Sorties::default(), graine: graine | 1,
        };
        r.reset_game();
        r
    }

    fn hasard(&mut self) -> f64 {
        self.graine ^= self.graine << 13; self.graine ^= self.graine >> 7; self.graine ^= self.graine << 17;
        (self.graine >> 11) as f64 / (1u64 << 53) as f64
    }
    fn coil(&mut self, b: Bobine) { self.sorties.bobines.push(b); }
    fn sound(&mut self, s: u16) { self.sorties.sons.push(s); }
    fn after(&mut self, ms: f64, d: Differe) { self.minuteries.push((self.now + ms, d)); }
    fn say(&mut self, texte: impl Into<String>, ms: f64) { self.msg = Some(Message { texte: texte.into(), debut: self.now, fin: self.now + ms }); }

    fn reset_game(&mut self) {
        self.score = 0; self.ball = 0; self.extra_balls = 0; self.extras_given = 0; self.extra_lit = false; self.replay_idx = 0;
        self.balls_in_play = 0; self.pending_serves = 0; self.city = 0; self.mb_lit = false; self.multiball = false;
        self.mb_count = 0; self.fanny_done = 0; self.jackpot = JACKPOT_START; self.jackpots_mb = 0; self.super_lit = false;
        self.carreaux = 0;
        self.reset_ball_state();
    }
    fn reset_ball_state(&mut self) {
        self.mult = 1; self.bonus = 0; self.letters = [false; 4]; self.drops = [false; 5]; self.point_lit = false;
        self.carreau_until = 0.0; self.targets = [false; 3]; self.ball_save_until = 0.0; self.ball_save_armed = false;
        self.shooter_closed = false; self.auto_launch_next = false; self.saucer_busy = false; self.tilt_warnings = 0;
        self.tilt_ignore_until = 0.0; self.tilted = false;
    }

    fn add(&mut self, points: u64, bonus: u64) {
        if self.mode != Mode::Play || self.tilted { return; }
        self.score += points;
        self.bonus += bonus;
        self.check_replay();
    }
    fn check_replay(&mut self) {
        while self.replay_idx < REPLAY_LEVELS.len() && self.score >= REPLAY_LEVELS[self.replay_idx] {
            self.replay_idx += 1;
            self.free_game("PARTIE GRATUITE");
        }
    }
    fn free_game(&mut self, texte: &str) {
        self.credits = (self.credits + 1).min(MAX_CREDITS);
        self.coil(Bobine::Knocker);
        self.sound(snd::CLAC);
        self.sound(if texte == "MATCH" { snd::V_MATCH } else { snd::V_PARTIE_GRATUITE });
        self.say(texte.to_string(), 2000.0);
    }
    fn add_credit(&mut self) { self.credits = (self.credits + 1).min(MAX_CREDITS); self.sound(snd::STANDUP); }

    pub fn can_start(&self) -> bool { matches!(self.mode, Mode::Attract | Mode::Over) && (FREE_PLAY || self.credits > 0) }

    fn start_game(&mut self) {
        if !self.can_start() { return; }
        let gratuite = self.credits > 0;
        if gratuite { self.credits -= 1; }
        self.reset_game();
        self.match_num = None;
        self.mode = Mode::Play;
        self.ball = 1;
        self.sound(snd::START);
        self.sound(snd::V_START);
        self.say(if gratuite { "PARTIE GRATUITE" } else { "FANNY PETANQUE WORLD TOUR" }, 3000.0);
        self.serve_ball(false);
    }
    fn serve_ball(&mut self, auto: bool) {
        self.balls_in_play += 1;
        self.pending_serves += 1;
        if auto { self.auto_launch_next = true; }
        self.coil(Bobine::Trough);
    }
    fn start_ball(&mut self) { self.reset_ball_state(); self.coil(Bobine::PowerOn); self.serve_ball(false); }

    fn end_of_ball(&mut self) {
        self.mode = Mode::Bonus;
        if self.tilted {
            self.bonus = 0;
            self.say("TILT", 1800.0);
            self.after(1800.0, Differe::NextBall);
            return;
        }
        let t = if self.mult > 1 { format!("BONUS X{}", self.mult) } else { "BONUS".into() };
        self.say(t, 1200.0);
        self.sound(snd::BONUS);
        self.after(1200.0, Differe::CountBonus);
    }
    fn count_bonus(&mut self) {
        if self.bonus == 0 { self.after(600.0, Differe::NextBall); return; }
        let step = self.bonus.min(1000.max(((self.bonus as f64 / 200.0).ceil() as u64) * 10));
        self.bonus -= step;
        self.score += step * self.mult as u64;
        self.check_replay();
        self.sound(snd::LANE);
        self.after(110.0, Differe::CountBonus);
    }
    fn next_ball(&mut self) {
        self.mode = Mode::Play;
        if self.extra_balls > 0 {
            self.extra_balls -= 1;
            self.say("REJOUE", 1500.0);
            self.start_ball();
        } else if self.ball < BALLS_PER_GAME {
            self.ball += 1;
            self.say(format!("BILLE {}", self.ball), 1500.0);
            self.start_ball();
        } else {
            self.game_over();
        }
    }
    fn game_over(&mut self) {
        self.mode = Mode::Match;
        self.tilted = false;
        self.coil(Bobine::PowerOn);
        self.last_score = self.score;
        let record = self.score > self.high_score;
        let ancien = self.high_score;
        if record { self.high_score = self.score; }
        self.sound(snd::GAME_OVER);
        self.say(if record { "NOUVEAU RECORD" } else { "FIN DE PARTIE" }, 2500.0);
        self.sound(if record { snd::V_RECORD } else { snd::V_GAME_OVER });
        if record && ancien > 0 { self.after(2600.0, Differe::FreeGame("PARTIE GRATUITE")); }
        self.after(if record && ancien > 0 { 5000.0 } else { 2800.0 }, Differe::StartMatch);
    }
    fn start_match(&mut self) {
        self.match_rolling = true;
        self.match_num = Some(0);
        self.sound(snd::MATCH);
        self.after(2600.0, Differe::FinMatch);
    }
    fn fin_match(&mut self) {
        self.match_rolling = false;
        let n = 10 * (self.hasard() * 10.0).floor() as u32;
        self.match_num = Some(n);
        let fin = ((self.score % 100) - (self.score % 10)) as u32;
        if n == fin { self.free_game("MATCH"); } else { self.say(format!("MATCH {:02}", n), 1800.0); }
        self.mode = Mode::Over;
        self.after(5000.0, Differe::RetourAttract);
    }

    // ---------------------------------------------------------------- contacts
    pub fn on_switch(&mut self, id: &str, closed: bool) {
        if id == sw::START { if closed { self.start_game(); } return; }
        if id == sw::COIN { if closed { self.add_credit(); } return; }
        if id == sw::TILT { if closed && self.mode == Mode::Play { self.hit_tilt(); } return; }
        if matches!(self.mode, Mode::Attract | Mode::Over) { return; }
        if id == sw::SHOOTER {
            self.shooter_closed = closed;
            if closed && self.pending_serves > 0 {
                self.pending_serves -= 1;
                if self.auto_launch_next { self.auto_launch_next = false; self.after(500.0, Differe::Launch); }
            }
            return;
        }
        if id == sw::LAUNCH { if closed { self.launch(); } return; }
        if id == sw::FLIP_L || id == sw::FLIP_R {
            if closed && self.mode == Mode::Play && !self.tilted { self.rotate_letters(if id == sw::FLIP_L { -1 } else { 1 }); }
            return;
        }
        if id == sw::DRAIN { self.drain(); return; }
        if !closed { return; }
        if self.tilted {
            if id == sw::SAUCER && !self.saucer_busy { self.saucer_busy = true; self.after(600.0, Differe::SaucerKick); }
            return;
        }
        if !self.ball_save_armed && self.mode == Mode::Play {
            self.ball_save_armed = true;
            self.ball_save_until = self.ball_save_until.max(self.now + BALL_SAVE_MS);
        }
        if let Some(i) = sw::LANES.iter().position(|&s| s == id) { return self.hit_lane(i); }
        if sw::LOWER_LANES.contains(&id) {
            let out = id.starts_with("out");
            self.add(if out { 1000 } else { 500 }, if out { 200 } else { 100 });
            self.sound(snd::LANE);
            return;
        }
        if let Some(i) = sw::DROPS.iter().position(|&s| s == id) { return self.hit_drop(i); }
        if sw::BUMPERS.contains(&id) { self.add(100, 10); self.sound(snd::BUMPER); return; }
        if let Some(i) = sw::TARGETS.iter().position(|&s| s == id) { return self.hit_target(i); }
        match id {
            "pointer" => { self.add(500, 50); self.sound(snd::STANDUP); self.point_lit = true; }
            "tirer" => self.hit_tirer(),
            "bouchon" => self.hit_bouchon(),
            _ if sw::SLINGS.contains(&id) => { self.add(10, 10); self.sound(snd::SLING); }
            sw::SAUCER => self.hit_saucer(),
            sw::RAMP => self.hit_ramp(),
            sw::SPINNER => { self.add(if self.multiball { 1000 } else { 250 }, 25); self.sound(snd::SPINNER); }
            _ => {}
        }
    }

    fn hit_tilt(&mut self) {
        if self.tilted || self.now < self.tilt_ignore_until { return; }
        self.tilt_ignore_until = self.now + TILT_SETTLE_MS;
        self.tilt_warnings += 1;
        if self.tilt_warnings <= TILT_WARNINGS {
            self.say("ATTENTION", 1500.0);
            self.sound(snd::STANDUP);
            self.sound(snd::V_ATTENTION);
            return;
        }
        self.tilted = true;
        self.ball_save_until = 0.0;
        self.multiball = false;
        self.super_lit = false;
        self.carreau_until = 0.0;
        self.coil(Bobine::PowerOff);
        self.sound(snd::TILT);
        self.sound(snd::V_TILT);
        self.msg = None;
    }
    fn launch(&mut self) {
        if !self.shooter_closed { return; }
        self.sound(snd::LAUNCH);
        self.coil(Bobine::Launch);
    }
    fn light_letter(&mut self, i: usize) -> bool {
        if self.letters[i] { return false; }
        self.letters[i] = true;
        if self.letters.iter().all(|&b| b) {
            self.letters = [false; 4];
            if self.mult < MAX_MULT {
                self.mult += 1;
                self.say(format!("BONUS X{}", self.mult), 1800.0);
                self.sound(snd::V_BONUS_MULT);
                if self.mult == MAX_MULT { self.light_extra(); }
            } else {
                self.add(10000, 0);
                self.say("10000", 1200.0);
            }
            self.sound(snd::LANES_DONE);
        }
        true
    }
    fn rotate_letters(&mut self, dir: i32) {
        let n = self.letters.len() as i32;
        let l = self.letters;
        for i in 0..n { self.letters[i as usize] = l[((i - dir + n) % n) as usize]; }
    }
    fn hit_target(&mut self, i: usize) {
        self.add(300, 30);
        self.sound(snd::STANDUP);
        if self.targets[i] { return; }
        self.targets[i] = true;
        if !self.targets.iter().all(|&b| b) { return; }
        self.targets = [false; 3];
        self.add(3000, 300);
        self.say("TRIPLETTE", 1500.0);
        self.sound(snd::V_TRIPLETTE);
        self.sound(snd::LANES_DONE);
        self.point_lit = true;
    }
    fn hit_bouchon(&mut self) {
        self.add(1500, 150);
        self.sound(snd::STANDUP);
        if self.point_lit {
            self.point_lit = false;
            self.add(5000, 500);
            self.say("BIBERON", 1500.0);
            self.sound(snd::V_BIBERON);
        } else { self.say("TIR AU BOUCHON", 1500.0); self.sound(snd::V_BOUCHON); }
        self.carreau_until = self.now + CARREAU_MS;
    }
    fn hit_tirer(&mut self) {
        if self.now < self.carreau_until {
            self.carreau_until = 0.0;
            self.carreaux += 1;
            let pts = CARREAU_PTS * self.carreaux;
            self.add(pts, 1000);
            self.say(format!("CARREAU {pts}"), 1800.0);
            self.sound(snd::JACKPOT);
            self.sound(snd::V_CARREAU);
            return;
        }
        self.add(500, 50);
        self.sound(snd::STANDUP);
    }
    fn hit_lane(&mut self, i: usize) {
        self.add(300, 30);
        if self.light_letter(i) { self.sound(snd::LANE); }
    }
    fn hit_drop(&mut self, i: usize) {
        if self.drops[i] { return; }
        self.drops[i] = true;
        self.add(500, 50);
        self.sound(snd::DROP);
        if !self.drops.iter().all(|&b| b) { return; }
        self.sound(snd::DROPS_DONE);
        if self.multiball {
            self.jackpot += 2 * JACKPOT_STEP;
            self.say(format!("JACKPOT {}", self.jackpot), 1800.0);
        } else if !self.mb_lit {
            self.fanny_done += 1;
            let besoin = self.mb_count + 1;
            if self.fanny_done >= besoin {
                self.fanny_done = 0;
                self.mb_lit = true;
                self.say("MULTIBALL AU CERCLE", 2200.0);
                self.sound(snd::V_MB_LIT);
            } else {
                self.add(5000, 500);
                self.say(format!("FANNY {}/{}", self.fanny_done, besoin), 1500.0);
            }
        } else {
            self.add(5000, 500);
        }
        self.after(1000.0, Differe::DropsReset);
    }
    fn hit_saucer(&mut self) {
        if self.saucer_busy { return; }
        self.saucer_busy = true;
        let mut hold = 1000.0;
        if self.mb_lit && !self.multiball {
            self.say("TRIPLETTE MULTIBALL", 2500.0);
            self.sound(snd::MULTIBALL);
            self.sound(snd::V_MULTIBALL);
            hold = 2000.0;
            self.after(hold, Differe::StartMultiball);
        } else if self.multiball && self.super_lit {
            self.super_lit = false;
            self.jackpots_mb = 0;
            let pts = 3 * self.jackpot;
            self.add(pts, 0);
            self.say(format!("SUPER JACKPOT {pts}"), 2500.0);
            self.sound(snd::JACKPOT);
            self.sound(snd::V_SUPER_JACKPOT);
            hold = 1800.0;
        } else if self.extra_lit {
            self.extra_lit = false;
            self.award_extra();
            hold = 1800.0;
        } else {
            self.add(1000, 100);
            self.sound(snd::SAUCER);
        }
        self.after(hold, Differe::SaucerKick);
    }
    fn start_multiball(&mut self) {
        self.multiball = true;
        self.mb_lit = false;
        self.mb_count += 1;
        self.jackpots_mb = 0;
        self.super_lit = false;
        self.ball_save_until = self.now + MB_BALL_SAVE_MS;
        self.serve_ball(true);
        self.after(1500.0, Differe::ServeAuto);
    }
    fn light_extra(&mut self) {
        if self.extra_lit { return; }
        if self.extras_given >= EXTRA_MAX { self.add(EXTRA_POINTS, 0); return; }
        self.extra_lit = true;
        self.after(1900.0, Differe::DireSon("EXTRA BALL AU CERCLE".into(), 2200.0, snd::V_EXTRA_LIT));
    }
    fn award_extra(&mut self) {
        if self.extras_given >= EXTRA_MAX {
            self.add(EXTRA_POINTS, 0);
            self.say(format!("{EXTRA_POINTS}"), 1500.0);
            return;
        }
        self.extras_given += 1;
        self.extra_balls += 1;
        self.say("EXTRA BALL", 2000.0);
        self.sound(snd::EXTRA);
        self.sound(snd::V_EXTRA);
    }
    fn hit_ramp(&mut self) {
        self.add(2000, 200);
        if self.multiball {
            let j = self.jackpot;
            self.add(j, 0);
            self.say(format!("JACKPOT {j}"), 1800.0);
            self.jackpot += JACKPOT_STEP;
            self.sound(snd::JACKPOT);
            self.sound(snd::V_JACKPOT);
            self.jackpots_mb += 1;
            if self.jackpots_mb >= SUPER_AFTER && !self.super_lit {
                self.super_lit = true;
                self.after(1900.0, Differe::Dire("SUPER JACKPOT AU CERCLE".into(), 2200.0));
            }
        } else {
            self.sound(snd::RAMP);
        }
        self.city += 1;
        if self.city >= CITIES.len() {
            self.city = 0;
            self.add(50000, 5000);
            self.say("GRAND CHELEM", 2500.0);
            self.sound(snd::GRAND_CHELEM);
            self.sound(snd::V_GRAND_CHELEM);
            self.after(2500.0, Differe::AwardExtra);
        } else {
            if !self.multiball { self.say(CITIES[self.city], 1500.0); }
            self.sound(snd::CITY);
            if !self.multiball { self.sound(snd::V_CITY_1 + self.city as u16 - 1); }
        }
    }
    fn drain(&mut self) {
        self.balls_in_play = (self.balls_in_play - 1).max(0);
        if self.mode != Mode::Play { return; }
        if self.tilted {
            if self.balls_in_play == 0 { self.sound(snd::DRAIN); self.end_of_ball(); }
            return;
        }
        if !self.ball_save_armed && !self.multiball {
            self.say("BILLE RENDUE", 1200.0);
            self.serve_ball(false);
            return;
        }
        if self.now < self.ball_save_until {
            self.say("FANNY TE LA REND", 1500.0);
            self.sound(snd::BALL_SAVE);
            self.sound(snd::V_BALL_SAVE);
            self.serve_ball(true);
            return;
        }
        if self.multiball && self.balls_in_play <= 1 {
            self.multiball = false;
            self.super_lit = false;
            self.say("FIN DE LA MENE", 1500.0);
        }
        if self.balls_in_play == 0 {
            self.sound(snd::DRAIN);
            self.sound(snd::V_DRAIN);
            self.end_of_ball();
        }
    }

    // ---------------------------------------------------------------- horloge
    pub fn tick(&mut self, now: f64) {
        self.now = now;
        loop {
            let Some(k) = self.minuteries.iter().position(|(t, _)| *t <= now) else { break };
            let (_, d) = self.minuteries.remove(k);
            match d {
                Differe::NextBall => self.next_ball(),
                Differe::CountBonus => self.count_bonus(),
                Differe::FreeGame(t) => self.free_game(t),
                Differe::StartMatch => self.start_match(),
                Differe::FinMatch => self.fin_match(),
                Differe::RetourAttract => if self.mode == Mode::Over { self.mode = Mode::Attract; self.match_num = None; },
                Differe::SaucerKick => { self.coil(Bobine::Saucer); self.saucer_busy = false; }
                Differe::Launch => self.launch(),
                Differe::DropsReset => { self.drops = [false; 5]; self.coil(Bobine::DropReset); }
                Differe::StartMultiball => self.start_multiball(),
                Differe::ServeAuto => self.serve_ball(true),
                Differe::Dire(t, ms) => self.say(t, ms),
                Differe::DireSon(t, ms, s) => { self.say(t, ms); self.sound(s); }
                Differe::AwardExtra => self.award_extra(),
            }
        }
        if self.msg.as_ref().is_some_and(|m| now > m.fin) { self.msg = None; }
    }

    // ---------------------------------------------------------------- sorties
    /// lampes (nom → 0 éteinte, 1 allumée, 2 clignotante), dans l'ordre d'insertion de js/rules.js lamps()
    pub fn lamps(&self) -> Vec<(String, u8)> {
        let mut l: Vec<(String, u8)> = vec![];
        for (i, &on) in self.letters.iter().enumerate() { l.push((format!("lane{i}"), on as u8)); }
        for (i, &d) in self.drops.iter().enumerate() { l.push((format!("drop{i}"), d as u8)); }
        l.push(("multiball".into(), if self.super_lit { 2 } else if self.multiball { 1 } else if self.mb_lit { 2 } else { 0 }));
        l.push(("ramp".into(), 1));
        l.push(("jackpot".into(), if self.multiball { 2 } else { 0 }));
        for m in 2..=MAX_MULT { l.push((format!("mult{m}"), (self.mult >= m) as u8)); }
        for i in 0..CITIES.len() { l.push((format!("city{i}"), if i < self.city { 1 } else if i == self.city { 2 } else { 0 })); }
        l.push(("extra".into(), (self.extra_balls > 0) as u8));
        l.push(("extraLit".into(), if self.extra_lit { 2 } else { 0 }));
        l.push(("save".into(), if self.now < self.ball_save_until { 2 } else { 0 }));
        l.push(("carreau".into(), if self.now < self.carreau_until { 2 } else { 0 }));
        l.push(("bouchon".into(), if self.point_lit { 2 } else { 1 }));
        l.push(("point".into(), self.point_lit as u8));
        for (i, &on) in self.targets.iter().enumerate() { l.push((format!("cible{i}"), on as u8)); }
        if self.tilted { for e in l.iter_mut() { e.1 = 0; } }
        if matches!(self.mode, Mode::Attract | Mode::Over | Mode::Match) {
            let k = (self.now / 150.0).floor() as usize;
            for (i, e) in l.iter_mut().enumerate() { e.1 = ((i + k) % 6 == 0) as u8; }
        }
        l
    }

    /// afficheurs : score sur 8 caractères, info sur 4
    pub fn display(&self) -> (String, String) {
        if self.tilted { return ("  TILT  ".into(), "TILT".into()); }
        let score = if let Some(m) = &self.msg { scroll_text(&m.texte, 8, self.now - m.debut) }
        else if self.mode == Mode::Attract {
            match ((self.now / 6000.0).floor() as u64) % 3 {
                0 => scroll_text("FANNY PETANQUE WORLD TOUR", 8, self.now % 6000.0),
                1 => pad(&format!("HI {}", self.high_score), 8),
                _ => pad(&self.last_score.to_string(), 8),
            }
        } else { pad(&self.score.to_string(), 8) };
        let info = if let (Some(n), true) = (self.match_num, matches!(self.mode, Mode::Match | Mode::Over)) {
            let n = if self.match_rolling { 10 * (((self.now / 70.0).floor() as u64) % 10) as u32 } else { n };
            format!("  {:02}", n)
        } else if matches!(self.mode, Mode::Attract | Mode::Over | Mode::Match) {
            if self.credits > 0 && ((self.now / 2000.0).floor() as u64) % 2 == 1 { format!("CR {}", self.credits) } else { "PLAY".into() }
        } else { format!("b{} {}", self.ball, self.mult) };
        (score, info)
    }
}

fn pad(s: &str, n: usize) -> String {
    let c: Vec<char> = s.chars().collect();
    if c.len() > n { c[c.len() - n..].iter().collect() } else { format!("{:>n$}", s, n = n) }
}

fn scroll_text(text: &str, n: usize, elapsed: f64) -> String {
    let c: Vec<char> = text.chars().collect();
    if c.len() <= n {
        let left = (n - c.len()) / 2;
        return format!("{:<n$}", format!("{}{}", " ".repeat(left), text), n = n);
    }
    let padded: Vec<char> = " ".repeat(n).chars().chain(c.iter().copied()).chain(" ".repeat(n).chars()).collect();
    let step = ((elapsed / 200.0).floor() as usize) % (padded.len() - n + 1);
    padded[step..step + n].iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn partie_simple() {
        let mut r = Regles::new(1);
        r.on_switch(sw::START, true);
        assert_eq!(r.mode, Mode::Play);
        assert!(r.sorties.bobines.contains(&Bobine::Trough));
        r.on_switch(sw::SHOOTER, true);
        r.on_switch("bumper1", true);
        assert_eq!(r.score, 100);
        for d in sw::DROPS { r.on_switch(d, true); }
        assert!(r.mb_lit);
        r.on_switch(sw::RAMP, true);
        assert_eq!(r.display().0.trim(), "PARIS");
    }
}
