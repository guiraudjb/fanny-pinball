//! Audio natif via SDL2_mixer (libmpg123) : lit les 54 MP3 d'origine (`assets/sons/`)
//! + clic métallique synthétisé pour le tourniquet (`snd::SPINNER`).
//! Canal 0 réservé à la voix de Fanny (une réplique coupe la précédente), canaux 1..16 pour les bruitages.

use std::collections::HashMap;
use std::f32::consts::PI;
use std::path::Path;

use sdl2::mixer::{
    self, Channel, Chunk, InitFlag, Music, Sdl2MixerContext, AUDIO_S16LSB, DEFAULT_CHANNELS,
};

use crate::regles::snd;

pub struct Audio {
    _ctx: Option<Sdl2MixerContext>,
    chunks: HashMap<u16, Chunk>,
    music_menu: Option<Music<'static>>,
    music_game: Option<Music<'static>>,
    current_music: u8, // 0 = aucune, 1 = menu, 2 = jeu
    next_sfx_ch: i32,
    pub muted: bool,
    enabled: bool,
}

impl Audio {
    pub fn init(assets_dir: &Path) -> Self {
        let mut a = Self {
            _ctx: None,
            chunks: HashMap::new(),
            music_menu: None,
            music_game: None,
            current_music: 0,
            next_sfx_ch: 1,
            muted: false,
            enabled: false,
        };

        if let Err(e) = mixer::open_audio(44_100, AUDIO_S16LSB, DEFAULT_CHANNELS, 1024) {
            eprintln!("Audio indisponible ({e}) : mode muet.");
            return a;
        }
        let ctx = match mixer::init(InitFlag::MP3) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("SDL2_mixer MP3 indisponible ({e}) : mode muet.");
                return a;
            }
        };
        mixer::allocate_channels(16);
        Channel(0).set_volume(118); // voix de Fanny
        for ch in 1..16 {
            Channel(ch).set_volume(96);
        }
        Music::set_volume(40);

        a._ctx = Some(ctx);
        a.enabled = true;

        let sons_dir = assets_dir.join("sons");
        for id in 1..=54u16 {
            let p = sons_dir.join(format!("{:04}.mp3", id));
            if !p.exists() {
                continue;
            }
            if id == snd::MUSIQUE_GENERIQUE {
                a.music_menu = Music::from_file(&p).ok();
            } else if id == snd::MUSIQUE_THEME {
                a.music_game = Music::from_file(&p).ok();
            } else if let Ok(chunk) = Chunk::from_file(&p) {
                a.chunks.insert(id, chunk);
            }
        }

        // Synthèse du clic mécanique du tourniquet (18 ms stéréo 44.1 kHz, 16 bits signé)
        if let Ok(click) = synth_spinner_click() {
            a.chunks.insert(snd::SPINNER, click);
        }

        a
    }

    pub fn play(&mut self, id: u16) {
        if !self.enabled || self.muted {
            return;
        }
        let Some(chunk) = self.chunks.get(&id) else {
            return;
        };
        if snd::est_voix(id) {
            Channel(0).halt();
            let _ = Channel(0).play(chunk, 0);
        } else {
            // Cherche un canal libre dans 1..16 (sans jamais toucher au canal voix 0)
            let mut chosen = self.next_sfx_ch;
            for offset in 0..15 {
                let c = 1 + ((self.next_sfx_ch - 1 + offset) % 15);
                if !Channel(c).is_playing() {
                    chosen = c;
                    break;
                }
            }
            self.next_sfx_ch = 1 + (chosen % 15);
            let _ = Channel(chosen).play(chunk, 0);
        }
    }

    pub fn set_music(&mut self, in_game: bool) {
        if !self.enabled || self.muted {
            return;
        }
        let target = if in_game { 2 } else { 1 };
        if self.current_music == target {
            return;
        }
        let track = if in_game {
            self.music_game.as_ref().or(self.music_menu.as_ref())
        } else {
            self.music_menu.as_ref()
        };
        if let Some(m) = track {
            let _ = m.play(-1);
            Music::set_volume(if in_game { 34 } else { 42 });
            self.current_music = target;
        }
    }

    pub fn toggle_mute(&mut self) -> bool {
        self.muted = !self.muted;
        if !self.enabled {
            return self.muted;
        }
        if self.muted {
            Channel::all().halt();
            Music::halt();
            self.current_music = 0;
        }
        self.muted
    }
}

fn synth_spinner_click() -> Result<Chunk, String> {
    let sr = 44_100usize;
    let frames = (sr * 18) / 1000; // 18 ms
    let mut buf = Vec::with_capacity(frames * 2);
    for i in 0..frames {
        let t = i as f32 / sr as f32;
        let env = (-t * 210.0).exp();
        let tone = (2.0 * PI * 2400.0 * t).sin() * 0.55 + (2.0 * PI * 5100.0 * t).sin() * 0.35;
        let s = (tone * env * 14_000.0).clamp(-32000.0, 32000.0) as i16;
        buf.push(s);
        buf.push(s);
    }
    Chunk::from_raw_buffer(buf.into_boxed_slice())
}
