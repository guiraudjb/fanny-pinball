// Réglages du joueur et tableau des meilleurs scores, enregistrés en JSON dans ~/.config/fanny-pinball/
// (ou $XDG_CONFIG_HOME/fanny-pinball/).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Debug)]
pub enum Detail { Bas, Moyen, Eleve }

impl Detail {
    pub fn nom(self) -> &'static str { match self { Detail::Bas => "Bas", Detail::Moyen => "Moyen", Detail::Eleve => "Élevé" } }
    pub fn suivant(self, d: i32) -> Detail {
        let t = [Detail::Bas, Detail::Moyen, Detail::Eleve];
        let i = t.iter().position(|x| *x == self).unwrap_or(1) as i32;
        t[(i + d).clamp(0, 2) as usize]
    }
    /// échantillons d'anticrénelage, filtrage anisotrope maximal, scène aux textures allégées
    pub fn msaa(self) -> i32 { match self { Detail::Bas => 0, Detail::Moyen => 0, Detail::Eleve => 4 } }
    pub fn aniso(self) -> f32 { match self { Detail::Bas => 4.0, Detail::Moyen => 8.0, Detail::Eleve => 16.0 } }
    pub fn scene_legere(self) -> bool { self == Detail::Bas }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(default)]
pub struct Reglages {
    pub plein_ecran: bool,
    /// fenêtré : taille de la fenêtre ; plein écran : définition de l'image calculée (agrandie à l'écran)
    pub resolution: (u32, u32),
    pub detail: Detail,
    pub volume_effets: u8,     // 0 à 10
    pub volume_musique: u8,    // 0 à 10
    pub vue: String,           // « joueur » ou « vertical » (plateau plein écran, écran posé à la verticale)
    /// écran vertical tourné dans le sens des aiguilles d'une montre (son haut à droite), sinon dans l'autre sens
    pub vertical_horaire: bool,
}

impl Default for Reglages {
    fn default() -> Self {
        Reglages { plein_ecran: false, resolution: (1280, 800), detail: Detail::Moyen, volume_effets: 8, volume_musique: 6, vue: "joueur".into(), vertical_horaire: true }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Score { pub nom: String, pub points: u64, pub date: String }

fn dossier() -> PathBuf {
    // Windows : %APPDATA%\fanny-pinball ; ailleurs : $XDG_CONFIG_HOME ou ~/.config
    let base = (if cfg!(windows) { std::env::var_os("APPDATA").map(PathBuf::from) } else { None })
        .or_else(|| std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("fanny-pinball")
}

fn lire<T: for<'de> Deserialize<'de>>(f: &str) -> Option<T> {
    serde_json::from_str(&std::fs::read_to_string(dossier().join(f)).ok()?).ok()
}

fn ecrire<T: Serialize>(f: &str, v: &T) {
    let d = dossier();
    let _ = std::fs::create_dir_all(&d);
    if let Ok(s) = serde_json::to_string_pretty(v) { let _ = std::fs::write(d.join(f), s); }
}

impl Reglages {
    pub fn charger() -> Reglages { lire("reglages.json").unwrap_or_default() }
    pub fn enregistrer(&self) { ecrire("reglages.json", self); }
}

pub const NB_SCORES: usize = 10;

pub struct Tableau { pub scores: Vec<Score> }

impl Tableau {
    pub fn charger() -> Tableau {
        let mut scores: Vec<Score> = lire("scores.json").unwrap_or_else(|| {
            // tableau de départ, comme sur les machines d'origine
            [("FAN", 500_000), ("BOU", 400_000), ("PET", 300_000), ("CAR", 200_000), ("TIR", 150_000),
             ("POI", 100_000), ("COC", 75_000), ("MAR", 50_000), ("OLI", 25_000), ("LAV", 10_000)]
                .iter().map(|(n, p)| Score { nom: n.to_string(), points: *p, date: String::new() }).collect()
        });
        scores.sort_by(|a, b| b.points.cmp(&a.points));
        scores.truncate(NB_SCORES);
        Tableau { scores }
    }
    /// rang (0 = premier) qu'obtiendrait ce score, s'il entre au tableau
    pub fn rang(&self, points: u64) -> Option<usize> {
        if points == 0 { return None; }
        let r = self.scores.iter().position(|s| points > s.points).unwrap_or(self.scores.len());
        (r < NB_SCORES).then_some(r)
    }
    pub fn ajouter(&mut self, nom: &str, points: u64) -> Option<usize> {
        let r = self.rang(points)?;
        self.scores.insert(r, Score { nom: nom.to_string(), points, date: date_du_jour() });
        self.scores.truncate(NB_SCORES);
        ecrire("scores.json", &self.scores);
        Some(r)
    }
}

/// date du jour (JJ/MM/AAAA), calculée depuis l'horloge système (UTC) sans dépendance
pub fn date_du_jour() -> String {
    let s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let mut j = s / 86_400;
    // algorithme de H. Hinnant (jours depuis 1970 → date civile)
    j += 719_468;
    let era = j.div_euclid(146_097);
    let doe = j - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{d:02}/{m:02}/{y}")
}

/// séparateur des milliers à la française : 1 234 567
pub fn points(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 { out.push(' '); }
        out.push(c);
    }
    out
}
