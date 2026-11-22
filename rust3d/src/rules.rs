//! Règles complètes de Fanny Pinball (portage 1:1 de `js/rules.js`).
//! Indépendant de la physique et du rendu.

use crate::table::CITIES;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Switch {
    FlipL,
    FlipR,
    Launch,
    Start,
    Coin,
    Tilt,
    Shooter,
    Drain,
    Lane(usize),      // 0..4 (T O U R)
    LowerLane(usize), // 0..6 (outL, inExtL, inIntL, inIntR, inExtR, outR)
    Drop(usize),      // 0..5 (F A N N Y)
    Target(usize),    // 0..3 (boule1..3)
    Pointer,
    Tirer,
    Bouchon,
    Sling(usize),  // 0..2
    Bumper(usize), // 0..3
    Saucer,
    Ramp,
    Spinner,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Coil {
    Trough,
    Launch,
    Saucer,
    DropReset,
    Knocker,
    PowerOff,
    PowerOn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FannyPose {
    Victoire,
    Lancer,
}

/// Identifiants des pistes audio (`assets/sons/0001.mp3` .. `0054.mp3`, 55 = clic tourniquet synthétique).
#[allow(dead_code)]
pub mod snd {
    pub const START: u16 = 1;
    pub const BUMPER: u16 = 2;
    pub const SLING: u16 = 3;
    pub const FLIP: u16 = 4;
    pub const DROP: u16 = 5;
    pub const DROPS_DONE: u16 = 6;
    pub const RAMP: u16 = 7;
    pub const LANE: u16 = 8;
    pub const LANES_DONE: u16 = 9;
    pub const STANDUP: u16 = 10;
    pub const SAUCER: u16 = 11;
    pub const MULTIBALL: u16 = 12;
    pub const JACKPOT: u16 = 13;
    pub const CITY: u16 = 14;
    pub const GRAND_CHELEM: u16 = 15;
    pub const EXTRA: u16 = 16;
    pub const BALL_SAVE: u16 = 17;
    pub const DRAIN: u16 = 18;
    pub const BONUS: u16 = 19;
    pub const GAME_OVER: u16 = 20;
    pub const LAUNCH: u16 = 21;
    pub const MUSIQUE_GENERIQUE: u16 = 22;
    pub const MUSIQUE_THEME: u16 = 23;
    pub const V_START: u16 = 24;
    pub const V_MULTIBALL: u16 = 25;
    pub const V_JACKPOT: u16 = 26;
    pub const V_CARREAU: u16 = 27;
    pub const V_BIBERON: u16 = 28;
    pub const V_BOUCHON: u16 = 29;
    pub const V_TRIPLETTE: u16 = 30;
    pub const V_GRAND_CHELEM: u16 = 31;
    pub const V_EXTRA: u16 = 32;
    pub const V_BALL_SAVE: u16 = 33;
    pub const V_MB_LIT: u16 = 34;
    pub const V_BONUS_MULT: u16 = 35;
    pub const V_DRAIN: u16 = 36;
    pub const V_GAME_OVER: u16 = 37;
    pub const V_RECORD: u16 = 38;
    pub const V_CITY_1: u16 = 39;
    pub const CLAC: u16 = 45;
    pub const MATCH: u16 = 46;
    pub const V_PARTIE_GRATUITE: u16 = 47;
    pub const V_MATCH: u16 = 48;
    pub const V_EXTRA_LIT: u16 = 49;
    pub const V_SUPER_JACKPOT: u16 = 50;
    pub const NUDGE: u16 = 51;
    pub const TILT: u16 = 52;
    pub const V_ATTENTION: u16 = 53;
    pub const V_TILT: u16 = 54;
    pub const SPINNER: u16 = 55;

    pub fn is_voice(id: u16) -> bool {
        (V_START..=V_CITY_1 + 5).contains(&id)
            || (V_PARTIE_GRATUITE..=V_SUPER_JACKPOT).contains(&id)
            || id == V_ATTENTION
            || id == V_TILT
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GameMode {
    Attract,
    Play,
    Bonus,
    Match,
    Over,
}

#[derive(Debug, Clone)]
pub struct RuleOutputs {
    pub coils: Vec<Coil>,
    pub sounds: Vec<u16>,
    pub fanny: Option<FannyPose>,
}

impl RuleOutputs {
    pub fn new() -> Self {
        Self {
            coils: Vec::new(),
            sounds: Vec::new(),
            fanny: None,
        }
    }
    pub fn clear(&mut self) {
        self.coils.clear();
        self.sounds.clear();
        self.fanny = None;
    }
}

#[derive(Debug, Clone)]
enum TimerAction {
    CountBonus,
    NextBall,
    FreeGameReplay,
    StartMatch,
    FinishMatch,
    ReturnAttract,
    Launch,
    SaucerEject,
    StartMultiball,
    ServeAutoBall,
    ResetDrops,
    AwardExtra,
    SayExtraLit,
    SaySuperLit,
}

#[derive(Debug, Clone)]
struct Timer {
    at_ms: u64,
    action: TimerAction,
}

#[derive(Debug, Clone)]
struct BannerMsg {
    text: String,
    start_ms: u64,
    until_ms: u64,
}

const BALLS_PER_GAME: u32 = 3;
const BALL_SAVE_MS: u64 = 8000;
const MB_BALL_SAVE_MS: u64 = 10000;
const MAX_MULT: u32 = 5;
const JACKPOT_START: u32 = 20000;
const JACKPOT_STEP: u32 = 5000;
const CARREAU_MS: u64 = 20000;
const CARREAU_PTS: u32 = 10000;
const REPLAY_LEVELS: [u32; 3] = [150_000, 300_000, 500_000];
const MAX_CREDITS: u32 = 9;
const EXTRA_MAX: u32 = 2;
const EXTRA_POINTS: u32 = 25000;
const SUPER_AFTER: u32 = 3;
const TILT_WARNINGS: u32 = 2;
const TILT_SETTLE_MS: u64 = 1200;

pub struct Rules {
    pub now_ms: u64,
    timers: Vec<Timer>,
    pub high_score: u32,
    pub last_score: u32,
    pub mode: GameMode,
    msg: Option<BannerMsg>,
    pub credits: u32,
    pub match_num: Option<u32>,
    pub match_rolling: bool,

    pub score: u32,
    pub ball: u32,
    pub extra_balls: u32,
    pub extras_given: u32,
    pub extra_lit: bool,
    replay_idx: usize,
    pub balls_in_play: u32,
    pending_serves: u32,
    pub city: usize,
    pub mb_lit: bool,
    pub multiball: bool,
    mb_count: u32,
    fanny_done: u32,
    pub jackpot: u32,
    jackpots_mb: u32,
    pub super_lit: bool,
    carreaux: u32,

    pub mult: u32,
    pub bonus: u32,
    pub letters: [bool; 4],
    pub drops: [bool; 5],
    pub point_lit: bool,
    pub carreau_until: u64,
    pub targets: [bool; 3],
    pub ball_save_until: u64,
    ball_save_armed: bool,
    pub shooter_closed: bool,
    auto_launch_next: bool,
    saucer_busy: bool,
    tilt_warnings: u32,
    tilt_ignore_until: u64,
    pub tilted: bool,

    rng: u64,
    pub out: RuleOutputs,
}

impl Rules {
    pub fn new(seed: u64) -> Self {
        let mut r = Self {
            now_ms: 0,
            timers: Vec::new(),
            high_score: 0,
            last_score: 0,
            mode: GameMode::Attract,
            msg: None,
            credits: 0,
            match_num: None,
            match_rolling: false,
            score: 0,
            ball: 0,
            extra_balls: 0,
            extras_given: 0,
            extra_lit: false,
            replay_idx: 0,
            balls_in_play: 0,
            pending_serves: 0,
            city: 0,
            mb_lit: false,
            multiball: false,
            mb_count: 0,
            fanny_done: 0,
            jackpot: JACKPOT_START,
            jackpots_mb: 0,
            super_lit: false,
            carreaux: 0,
            mult: 1,
            bonus: 0,
            letters: [false; 4],
            drops: [false; 5],
            point_lit: false,
            carreau_until: 0,
            targets: [false; 3],
            ball_save_until: 0,
            ball_save_armed: false,
            shooter_closed: false,
            auto_launch_next: false,
            saucer_busy: false,
            tilt_warnings: 0,
            tilt_ignore_until: 0,
            tilted: false,
            rng: seed.max(1),
            out: RuleOutputs::new(),
        };
        r.reset_game();
        r
    }

    fn rand_u32(&mut self) -> u32 {
        let mut x = self.rng;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.rng = x;
        (x >> 16) as u32
    }

    fn reset_game(&mut self) {
        self.score = 0;
        self.ball = 0;
        self.extra_balls = 0;
        self.extras_given = 0;
        self.extra_lit = false;
        self.replay_idx = 0;
        self.balls_in_play = 0;
        self.pending_serves = 0;
        self.city = 0;
        self.mb_lit = false;
        self.multiball = false;
        self.mb_count = 0;
        self.fanny_done = 0;
        self.jackpot = JACKPOT_START;
        self.jackpots_mb = 0;
        self.super_lit = false;
        self.carreaux = 0;
        self.reset_ball_state();
    }

    fn reset_ball_state(&mut self) {
        self.mult = 1;
        self.bonus = 0;
        self.letters = [false; 4];
        self.drops = [false; 5];
        self.point_lit = false;
        self.carreau_until = 0;
        self.targets = [false; 3];
        self.ball_save_until = 0;
        self.ball_save_armed = false;
        self.shooter_closed = false;
        self.auto_launch_next = false;
        self.saucer_busy = false;
        self.tilt_warnings = 0;
        self.tilt_ignore_until = 0;
        self.tilted = false;
    }

    fn after(&mut self, ms: u64, action: TimerAction) {
        self.timers.push(Timer {
            at_ms: self.now_ms + ms,
            action,
        });
    }

    fn say(&mut self, text: impl Into<String>, ms: u64) {
        self.msg = Some(BannerMsg {
            text: text.into(),
            start_ms: self.now_ms,
            until_ms: self.now_ms + ms,
        });
    }

    fn coil(&mut self, c: Coil) {
        self.out.coils.push(c);
    }

    fn sound(&mut self, s: u16) {
        self.out.sounds.push(s);
    }

    fn add(&mut self, points: u32, bonus: u32) {
        if self.mode != GameMode::Play || self.tilted {
            return;
        }
        self.score = self.score.saturating_add(points);
        self.bonus = self.bonus.saturating_add(bonus);
        self.check_replay();
    }

    fn check_replay(&mut self) {
        while self.replay_idx < REPLAY_LEVELS.len() && self.score >= REPLAY_LEVELS[self.replay_idx] {
            self.replay_idx += 1;
            self.free_game("PARTIE GRATUITE");
        }
    }

    fn free_game(&mut self, text: &str) {
        self.credits = (self.credits + 1).min(MAX_CREDITS);
        self.coil(Coil::Knocker);
        self.sound(snd::CLAC);
        self.sound(if text == "MATCH" {
            snd::V_MATCH
        } else {
            snd::V_PARTIE_GRATUITE
        });
        self.say(text, 2000);
        self.out.fanny = Some(FannyPose::Victoire);
    }

    pub fn can_start(&self) -> bool {
        self.mode == GameMode::Attract || self.mode == GameMode::Over
    }

    fn start_game(&mut self) {
        if !self.can_start() {
            return;
        }
        let gratuite = self.credits > 0;
        if gratuite {
            self.credits -= 1;
        }
        self.timers.clear();
        self.reset_game();
        self.match_num = None;
        self.mode = GameMode::Play;
        self.ball = 1;
        self.coil(Coil::PowerOn);
        self.coil(Coil::DropReset);
        self.sound(snd::START);
        self.sound(snd::V_START);
        self.say(
            if gratuite {
                "PARTIE GRATUITE"
            } else {
                "FANNY PETANQUE WORLD TOUR"
            },
            3000,
        );
        self.out.fanny = Some(FannyPose::Lancer);
        self.serve_ball(false);
    }

    fn serve_ball(&mut self, auto: bool) {
        self.balls_in_play += 1;
        self.pending_serves += 1;
        if auto {
            self.auto_launch_next = true;
        }
        self.coil(Coil::Trough);
    }

    fn start_ball(&mut self) {
        self.reset_ball_state();
        self.coil(Coil::PowerOn);
        self.coil(Coil::DropReset);
        self.serve_ball(false);
    }

    fn end_of_ball(&mut self) {
        self.mode = GameMode::Bonus;
        if self.tilted {
            self.bonus = 0;
            self.say("TILT", 1800);
            self.after(1800, TimerAction::NextBall);
            return;
        }
        let label = if self.mult > 1 {
            format!("BONUS X{}", self.mult)
        } else {
            "BONUS".to_string()
        };
        self.say(label, 1200);
        self.sound(snd::BONUS);
        self.after(1200, TimerAction::CountBonus);
    }

    fn count_bonus(&mut self) {
        if self.bonus == 0 {
            self.after(600, TimerAction::NextBall);
            return;
        }
        let step = self.bonus.min(((self.bonus + 199) / 200 * 10).max(1000));
        self.bonus -= step;
        self.score = self.score.saturating_add(step * self.mult);
        self.check_replay();
        self.sound(snd::LANE);
        self.after(110, TimerAction::CountBonus);
    }

    fn next_ball(&mut self) {
        self.mode = GameMode::Play;
        if self.extra_balls > 0 {
            self.extra_balls -= 1;
            self.say("REJOUE", 1500);
            self.start_ball();
        } else if self.ball < BALLS_PER_GAME {
            self.ball += 1;
            self.say(format!("BILLE {}", self.ball), 1500);
            self.start_ball();
        } else {
            self.game_over();
        }
    }

    fn game_over(&mut self) {
        self.mode = GameMode::Match;
        self.tilted = false;
        self.coil(Coil::PowerOn);
        self.last_score = self.score;
        let record = self.score > self.high_score;
        let ancien = self.high_score;
        if record {
            self.high_score = self.score;
        }
        self.sound(snd::GAME_OVER);
        self.say(
            if record {
                "NOUVEAU RECORD"
            } else {
                "FIN DE PARTIE"
            },
            2500,
        );
        self.sound(if record { snd::V_RECORD } else { snd::V_GAME_OVER });
        if record {
            self.out.fanny = Some(FannyPose::Victoire);
        }
        if record && ancien > 0 {
            self.after(2600, TimerAction::FreeGameReplay);
            self.after(5000, TimerAction::StartMatch);
        } else {
            self.after(2800, TimerAction::StartMatch);
        }
    }

    fn start_match(&mut self) {
        self.match_rolling = true;
        self.match_num = Some(0);
        self.sound(snd::MATCH);
        self.after(2600, TimerAction::FinishMatch);
    }

    fn finish_match(&mut self) {
        self.match_rolling = false;
        let m = 10 * (self.rand_u32() % 10);
        self.match_num = Some(m);
        let fin = (self.score % 100) - (self.score % 10);
        if m == fin {
            self.free_game("MATCH");
        } else {
            self.say(format!("MATCH {:02}", m), 1800);
        }
        self.mode = GameMode::Over;
        self.after(5000, TimerAction::ReturnAttract);
    }

    pub fn on_switch(&mut self, sw: Switch, closed: bool) {
        match sw {
            Switch::Start => {
                if closed {
                    self.start_game();
                }
                return;
            }
            Switch::Coin => {
                if closed {
                    self.credits = (self.credits + 1).min(MAX_CREDITS);
                    self.sound(snd::STANDUP);
                }
                return;
            }
            Switch::Tilt => {
                if closed && self.mode == GameMode::Play {
                    self.hit_tilt();
                }
                return;
            }
            _ => {}
        }

        if self.mode == GameMode::Attract || self.mode == GameMode::Over {
            return;
        }

        match sw {
            Switch::Shooter => {
                self.shooter_closed = closed;
                if closed && self.pending_serves > 0 {
                    self.pending_serves -= 1;
                    if self.auto_launch_next {
                        self.auto_launch_next = false;
                        self.after(500, TimerAction::Launch);
                    }
                }
                return;
            }
            Switch::Launch => {
                if closed {
                    self.launch();
                }
                return;
            }
            Switch::FlipL | Switch::FlipR => {
                if closed && self.mode == GameMode::Play && !self.tilted {
                    self.rotate_letters(if sw == Switch::FlipL { -1 } else { 1 });
                }
                return;
            }
            Switch::Drain => {
                self.drain();
                return;
            }
            _ => {}
        }

        if !closed {
            return;
        }

        if self.tilted {
            if sw == Switch::Saucer && !self.saucer_busy {
                self.saucer_busy = true;
                self.after(600, TimerAction::SaucerEject);
            }
            return;
        }

        if !self.ball_save_armed && self.mode == GameMode::Play {
            self.ball_save_armed = true;
            self.ball_save_until = self.ball_save_until.max(self.now_ms + BALL_SAVE_MS);
        }

        match sw {
            Switch::Lane(i) if i < 4 => self.hit_lane(i),
            Switch::LowerLane(i) if i < 6 => {
                let is_out = i == 0 || i == 5;
                self.add(if is_out { 1000 } else { 500 }, if is_out { 200 } else { 100 });
                self.sound(snd::LANE);
            }
            Switch::Drop(i) if i < 5 => self.hit_drop(i),
            Switch::Bumper(_) => {
                self.add(100, 10);
                self.sound(snd::BUMPER);
            }
            Switch::Target(i) if i < 3 => self.hit_target(i),
            Switch::Pointer => {
                self.add(500, 50);
                self.sound(snd::STANDUP);
                self.point_lit = true;
            }
            Switch::Tirer => self.hit_tirer(),
            Switch::Bouchon => self.hit_bouchon(),
            Switch::Sling(_) => {
                self.add(10, 10);
                self.sound(snd::SLING);
            }
            Switch::Saucer => self.hit_saucer(),
            Switch::Ramp => self.hit_ramp(),
            Switch::Spinner => {
                self.add(if self.multiball { 1000 } else { 250 }, 25);
                self.sound(snd::SPINNER);
            }
            _ => {}
        }
    }

    fn hit_tilt(&mut self) {
        if self.tilted || self.now_ms < self.tilt_ignore_until {
            return;
        }
        self.tilt_ignore_until = self.now_ms + TILT_SETTLE_MS;
        self.tilt_warnings += 1;
        if self.tilt_warnings <= TILT_WARNINGS {
            self.say("ATTENTION", 1500);
            self.sound(snd::STANDUP);
            self.sound(snd::V_ATTENTION);
            return;
        }
        self.tilted = true;
        self.ball_save_until = 0;
        self.multiball = false;
        self.super_lit = false;
        self.carreau_until = 0;
        self.coil(Coil::PowerOff);
        self.sound(snd::TILT);
        self.sound(snd::V_TILT);
        self.msg = None;
    }

    fn launch(&mut self) {
        if !self.shooter_closed {
            return;
        }
        self.sound(snd::LAUNCH);
        self.coil(Coil::Launch);
    }

    fn light_letter(&mut self, i: usize) -> bool {
        if self.letters[i] {
            return false;
        }
        self.letters[i] = true;
        if self.letters.iter().all(|&b| b) {
            self.letters = [false; 4];
            if self.mult < MAX_MULT {
                self.mult += 1;
                self.say(format!("BONUS X{}", self.mult), 1800);
                self.sound(snd::V_BONUS_MULT);
                if self.mult == MAX_MULT {
                    self.light_extra();
                }
            } else {
                self.add(10000, 0);
                self.say("10000", 1200);
            }
            self.sound(snd::LANES_DONE);
        }
        true
    }

    fn rotate_letters(&mut self, dir: i32) {
        let old = self.letters;
        for i in 0..4 {
            let src = ((i as i32 - dir).rem_euclid(4)) as usize;
            self.letters[i] = old[src];
        }
    }

    fn hit_target(&mut self, i: usize) {
        self.add(300, 30);
        self.sound(snd::STANDUP);
        if self.targets[i] {
            return;
        }
        self.targets[i] = true;
        if !self.targets.iter().all(|&b| b) {
            return;
        }
        self.targets = [false; 3];
        self.add(3000, 300);
        self.say("TRIPLETTE", 1500);
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
            self.say("BIBERON", 1500);
            self.sound(snd::V_BIBERON);
            self.out.fanny = Some(FannyPose::Victoire);
        } else {
            self.say("TIR AU BOUCHON", 1500);
            self.sound(snd::V_BOUCHON);
        }
        self.carreau_until = self.now_ms + CARREAU_MS;
    }

    fn hit_tirer(&mut self) {
        if self.now_ms < self.carreau_until {
            self.carreau_until = 0;
            self.carreaux += 1;
            let pts = CARREAU_PTS * self.carreaux;
            self.add(pts, 1000);
            self.say(format!("CARREAU {}", pts), 1800);
            self.sound(snd::JACKPOT);
            self.sound(snd::V_CARREAU);
            self.out.fanny = Some(FannyPose::Victoire);
            return;
        }
        self.add(500, 50);
        self.sound(snd::STANDUP);
    }

    fn hit_lane(&mut self, i: usize) {
        self.add(300, 30);
        if self.light_letter(i) {
            self.sound(snd::LANE);
        }
    }

    fn hit_drop(&mut self, i: usize) {
        if self.drops[i] {
            return;
        }
        self.drops[i] = true;
        self.add(500, 50);
        self.sound(snd::DROP);
        if !self.drops.iter().all(|&b| b) {
            return;
        }
        self.sound(snd::DROPS_DONE);
        if self.multiball {
            self.jackpot += 2 * JACKPOT_STEP;
            self.say(format!("JACKPOT {}", self.jackpot), 1800);
        } else if !self.mb_lit {
            self.fanny_done += 1;
            let besoin = self.mb_count + 1;
            if self.fanny_done >= besoin {
                self.fanny_done = 0;
                self.mb_lit = true;
                self.say("MULTIBALL AU CERCLE", 2200);
                self.sound(snd::V_MB_LIT);
                self.out.fanny = Some(FannyPose::Victoire);
            } else {
                self.add(5000, 500);
                self.say(format!("FANNY {}/{}", self.fanny_done, besoin), 1500);
            }
        } else {
            self.add(5000, 500);
        }
        self.after(1000, TimerAction::ResetDrops);
    }

    fn hit_saucer(&mut self) {
        if self.saucer_busy {
            return;
        }
        self.saucer_busy = true;
        let hold;
        if self.mb_lit && !self.multiball {
            self.say("TRIPLETTE MULTIBALL", 2500);
            self.sound(snd::MULTIBALL);
            self.sound(snd::V_MULTIBALL);
            self.out.fanny = Some(FannyPose::Victoire);
            hold = 2000;
            self.after(hold, TimerAction::StartMultiball);
        } else if self.multiball && self.super_lit {
            self.super_lit = false;
            self.jackpots_mb = 0;
            let pts = 3 * self.jackpot;
            self.add(pts, 0);
            self.say(format!("SUPER JACKPOT {}", pts), 2500);
            self.sound(snd::JACKPOT);
            self.sound(snd::V_SUPER_JACKPOT);
            self.out.fanny = Some(FannyPose::Victoire);
            hold = 1800;
        } else if self.extra_lit {
            self.extra_lit = false;
            self.award_extra();
            hold = 1800;
        } else {
            self.add(1000, 100);
            self.sound(snd::SAUCER);
            hold = 1000;
        }
        self.after(hold, TimerAction::SaucerEject);
    }

    fn start_multiball(&mut self) {
        self.multiball = true;
        self.mb_lit = false;
        self.mb_count += 1;
        self.jackpots_mb = 0;
        self.super_lit = false;
        self.ball_save_until = self.now_ms + MB_BALL_SAVE_MS;
        self.serve_ball(true);
        self.after(1500, TimerAction::ServeAutoBall);
    }

    fn light_extra(&mut self) {
        if self.extra_lit {
            return;
        }
        if self.extras_given >= EXTRA_MAX {
            self.add(EXTRA_POINTS, 0);
            return;
        }
        self.extra_lit = true;
        self.after(1900, TimerAction::SayExtraLit);
    }

    fn award_extra(&mut self) {
        if self.extras_given >= EXTRA_MAX {
            self.add(EXTRA_POINTS, 0);
            self.say(format!("{}", EXTRA_POINTS), 1500);
            return;
        }
        self.extras_given += 1;
        self.extra_balls += 1;
        self.say("EXTRA BALL", 2000);
        self.sound(snd::EXTRA);
        self.sound(snd::V_EXTRA);
        self.out.fanny = Some(FannyPose::Victoire);
    }

    fn hit_ramp(&mut self) {
        self.add(2000, 200);
        if self.multiball {
            let jp = self.jackpot;
            self.add(jp, 0);
            self.say(format!("JACKPOT {}", jp), 1800);
            self.jackpot += JACKPOT_STEP;
            self.sound(snd::JACKPOT);
            self.sound(snd::V_JACKPOT);
            self.out.fanny = Some(FannyPose::Victoire);
            self.jackpots_mb += 1;
            if self.jackpots_mb >= SUPER_AFTER && !self.super_lit {
                self.super_lit = true;
                self.after(1900, TimerAction::SaySuperLit);
            }
        } else {
            self.sound(snd::RAMP);
        }
        self.city += 1;
        if self.city >= CITIES.len() {
            self.city = 0;
            self.add(50000, 5000);
            self.say("GRAND CHELEM", 2500);
            self.sound(snd::GRAND_CHELEM);
            self.sound(snd::V_GRAND_CHELEM);
            self.out.fanny = Some(FannyPose::Victoire);
            self.after(2500, TimerAction::AwardExtra);
        } else {
            if !self.multiball {
                self.say(CITIES[self.city], 1500);
            }
            self.sound(snd::CITY);
            if !self.multiball {
                self.sound(snd::V_CITY_1 + (self.city as u16) - 1);
            }
        }
    }

    fn drain(&mut self) {
        self.balls_in_play = self.balls_in_play.saturating_sub(1);
        if self.mode != GameMode::Play {
            return;
        }
        if self.tilted {
            if self.balls_in_play == 0 {
                self.sound(snd::DRAIN);
                self.end_of_ball();
            }
            return;
        }
        if !self.ball_save_armed && !self.multiball {
            self.say("BILLE RENDUE", 1200);
            self.serve_ball(false);
            return;
        }
        if self.now_ms < self.ball_save_until {
            self.say("FANNY TE LA REND", 1500);
            self.sound(snd::BALL_SAVE);
            self.sound(snd::V_BALL_SAVE);
            self.serve_ball(true);
            return;
        }
        if self.multiball && self.balls_in_play <= 1 {
            self.multiball = false;
            self.super_lit = false;
            self.say("FIN DE LA MENE", 1500);
        }
        if self.balls_in_play == 0 {
            self.sound(snd::DRAIN);
            self.sound(snd::V_DRAIN);
            self.end_of_ball();
        }
    }

    pub fn tick(&mut self, now_ms: u64) {
        self.now_ms = now_ms;
        if !self.timers.is_empty() {
            let mut due = Vec::new();
            let mut keep = Vec::new();
            for t in self.timers.drain(..) {
                if t.at_ms <= now_ms {
                    due.push(t.action);
                } else {
                    keep.push(t);
                }
            }
            self.timers = keep;
            for act in due {
                match act {
                    TimerAction::CountBonus => self.count_bonus(),
                    TimerAction::NextBall => self.next_ball(),
                    TimerAction::FreeGameReplay => self.free_game("PARTIE GRATUITE"),
                    TimerAction::StartMatch => self.start_match(),
                    TimerAction::FinishMatch => self.finish_match(),
                    TimerAction::ReturnAttract => {
                        if self.mode == GameMode::Over {
                            self.mode = GameMode::Attract;
                            self.match_num = None;
                        }
                    }
                    TimerAction::Launch => self.launch(),
                    TimerAction::SaucerEject => {
                        self.coil(Coil::Saucer);
                        self.saucer_busy = false;
                    }
                    TimerAction::StartMultiball => self.start_multiball(),
                    TimerAction::ServeAutoBall => self.serve_ball(true),
                    TimerAction::ResetDrops => {
                        self.drops = [false; 5];
                        self.coil(Coil::DropReset);
                    }
                    TimerAction::AwardExtra => self.award_extra(),
                    TimerAction::SayExtraLit => {
                        self.say("EXTRA BALL AU CERCLE", 2200);
                        self.sound(snd::V_EXTRA_LIT);
                    }
                    TimerAction::SaySuperLit => {
                        self.say("SUPER JACKPOT AU CERCLE", 2200);
                    }
                }
            }
        }
        if let Some(ref m) = self.msg {
            if now_ms > m.until_ms {
                self.msg = None;
            }
        }
    }

    /// 32 lampes dans l'ordre exact WS2812B (`0` éteint, `1` allumé, `2` clignotant).
    pub fn lamps(&self) -> [u8; 32] {
        let mut l = [0u8; 32];
        if self.mode == GameMode::Attract || self.mode == GameMode::Over || self.mode == GameMode::Match {
            let k = (self.now_ms / 150) as usize;
            for (i, slot) in l.iter_mut().enumerate() {
                *slot = if (i + k) % 6 == 0 { 1 } else { 0 };
            }
            return l;
        }
        if self.tilted {
            return l;
        }
        for i in 0..4 {
            l[i] = u8::from(self.letters[i]);
        }
        for i in 0..5 {
            l[4 + i] = u8::from(self.drops[i]);
        }
        l[9] = if self.super_lit {
            2
        } else if self.multiball {
            1
        } else if self.mb_lit {
            2
        } else {
            0
        };
        l[10] = 1; // ramp
        l[11] = if self.multiball { 2 } else { 0 }; // jackpot
        for i in 0..7 {
            l[12 + i] = if i < self.city {
                1
            } else if i == self.city {
                2
            } else {
                0
            };
        }
        for m in 0..4 {
            l[19 + m] = u8::from(self.mult >= (m as u32 + 2));
        }
        l[23] = u8::from(self.extra_balls > 0);
        l[24] = if self.now_ms < self.ball_save_until { 2 } else { 0 };
        l[25] = if self.now_ms < self.carreau_until { 2 } else { 0 };
        l[26] = if self.point_lit { 2 } else { 1 };
        l[27] = u8::from(self.point_lit);
        for i in 0..3 {
            l[28 + i] = u8::from(self.targets[i]);
        }
        l[31] = if self.extra_lit { 2 } else { 0 };
        l
    }

    pub fn display(&self) -> (String, String) {
        if self.tilted {
            return ("  TILT  ".to_string(), "TILT".to_string());
        }
        let score = if let Some(ref m) = self.msg {
            scroll_text(&m.text, 8, self.now_ms.saturating_sub(m.start_ms))
        } else if self.mode == GameMode::Attract {
            match (self.now_ms / 6000) % 3 {
                0 => scroll_text("FANNY PETANQUE WORLD TOUR", 8, self.now_ms % 6000),
                1 => pad_left(&format!("HI {}", self.high_score), 8),
                _ => pad_left(&format!("{}", self.last_score), 8),
            }
        } else {
            pad_left(&format!("{}", self.score), 8)
        };

        let info = if let Some(mn) = self.match_num {
            if self.mode == GameMode::Match || self.mode == GameMode::Over {
                let n = if self.match_rolling {
                    10 * ((self.now_ms / 70) % 10) as u32
                } else {
                    mn
                };
                format!("  {:02}", n)
            } else {
                format!("B{} {}", self.ball, self.mult)
            }
        } else if self.mode == GameMode::Attract
            || self.mode == GameMode::Over
            || self.mode == GameMode::Match
        {
            if self.credits > 0 && ((self.now_ms / 2000) % 2 == 1) {
                format!("CR {}", self.credits)
            } else {
                "PLAY".to_string()
            }
        } else {
            format!("B{} {}", self.ball, self.mult)
        };
        (score, info)
    }
}

fn pad_left(s: &str, n: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() >= n {
        chars[chars.len() - n..].iter().collect()
    } else {
        let mut out = String::with_capacity(n);
        for _ in 0..(n - chars.len()) {
            out.push(' ');
        }
        out.push_str(s);
        out
    }
}

fn scroll_text(text: &str, n: usize, elapsed_ms: u64) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= n {
        let left = (n - chars.len()) / 2;
        let mut out = String::with_capacity(n);
        for _ in 0..left {
            out.push(' ');
        }
        out.push_str(text);
        while out.chars().count() < n {
            out.push(' ');
        }
        return out;
    }
    let mut padded: Vec<char> = Vec::with_capacity(chars.len() + 2 * n);
    for _ in 0..n {
        padded.push(' ');
    }
    padded.extend_from_slice(&chars);
    for _ in 0..n {
        padded.push(' ');
    }
    let span = padded.len() - n + 1;
    let step = ((elapsed_ms / 200) as usize) % span;
    padded[step..step + n].iter().collect()
}
