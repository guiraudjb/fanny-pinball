// Banc : où part la bille après un lancer, sans toucher aux palettes (cargo test --release banc_lancer -- --ignored --nocapture)
#[cfg(test)]
mod t {
    use crate::{physique, regles};
    use std::collections::BTreeMap;

    #[test]
    #[ignore]
    fn banc_lancer() {
        let chemin = concat!(env!("CARGO_MANIFEST_DIR"), "/donnees/monde.json");
        let mut sorties: BTreeMap<String, u32> = BTreeMap::new();
        for p10 in [3, 5, 7, 10] {
            for essai in 0..12 {
                let mut sim = physique::Sim::charger(chemin).unwrap();
                let mut r = regles::Regles::new(1234 + essai);
                let dt = 1000.0 / 60.0;
                r.on_switch(regles::sw::START, true);
                let mut lance = false;
                let mut dernier: Option<String> = None;
                let mut lanes = vec![];
                let mut evacuee = false;
                for k in 0..(60 * 40) {
                    if !lance && k == 60 { sim.force = physique::force_lanceur(p10 as f32 / 10.0); r.on_switch(regles::sw::LAUNCH, true); lance = true; }
                    sim.step(dt);
                    for (id, f) in std::mem::take(&mut sim.contacts) {
                        if f && regles::sw::LOWER_LANES.contains(&id.as_str()) { dernier = Some(id.clone()); lanes.push(id.clone()); }
                        if id == regles::sw::DRAIN && f { evacuee = true; }
                        r.on_switch(&id, f);
                    }
                    r.tick(sim.time);
                    let s = std::mem::take(&mut r.sorties);
                    for b in s.bobines { sim.coil(b); }
                    if evacuee { break; }
                }
                let cle = format!("tirage {:>3}% → {}", p10 * 10, dernier.clone().unwrap_or("centre".into()));
                *sorties.entry(cle).or_default() += 1;
                println!("p={} essai {essai}: couloirs {:?} temps {:.1}s", p10, lanes, sim.time / 1000.0);
            }
        }
        for (k, n) in sorties { println!("{k} : {n}"); }
    }
}

#[cfg(test)]
mod t2 {
    use crate::{physique, regles};
    use std::collections::BTreeMap;

    /// billes lâchées en haut du plateau (positions et vitesses variées), palettes au repos : par où sortent-elles,
    /// et combien de coups de lance-pierre avant ?
    #[test]
    #[ignore]
    fn banc_sorties() {
        let chemin = concat!(env!("CARGO_MANIFEST_DIR"), "/donnees/monde.json");
        let mut tot: BTreeMap<String, u32> = BTreeMap::new();
        let mut slings_tot = 0;
        let n = 60;
        for k in 0..n {
            let mut sim = physique::Sim::charger(chemin).unwrap();
            sim.secoue_auto = false;
            let x = 90.0 + (k as f32 * 37.0) % 300.0;
            let y = 450.0 + (k as f32 * 53.0) % 250.0;
            let i = sim.make_ball(x, y);
            let a = k as f32 * 0.9;
            sim.set_roulement(i, 0.6 * a.cos(), 0.6 * a.sin().abs());
            let mut seq = vec![];
            let mut slings = 0;
            for _ in 0..(480 * 20) {
                sim.step(1000.0 / 480.0);
                let mut fin = false;
                for (id, f) in std::mem::take(&mut sim.contacts) {
                    if !f { continue; }
                    if regles::sw::SLINGS.contains(&id.as_str()) { slings += 1; seq.push(id.clone()); }
                    if regles::sw::LOWER_LANES.contains(&id.as_str()) { seq.push(id.clone()); }
                    if id == regles::sw::DRAIN { fin = true; }
                }
                if fin { break; }
            }
            let out = seq.iter().rev().find(|s| regles::sw::LOWER_LANES.contains(&s.as_str())).cloned();
            let cle = match out.as_deref() { Some("outL") => "couloir extérieur G", Some("outR") => "couloir extérieur D",
                Some(s) if s.starts_with("in") => "couloir de retour → milieu", _ => "milieu (entre les palettes)" };
            *tot.entry(cle.into()).or_default() += 1;
            slings_tot += slings;
            println!("{k:2} départ ({x:.0},{y:.0}) : {:?}", seq);
        }
        for (k, v) in tot { println!("{k} : {v}/{n}"); }
        println!("coups de lance-pierre : {:.2} par bille", slings_tot as f32 / n as f32);
    }
}

#[cfg(test)]
mod t3 {
    use crate::physique;

    /// billes posées autour du poteau de tête des séparateurs extérieurs (pas de 4 mm, vitesses variées) : aucune ne
    /// doit rester bloquée (immobile plus d'1 s) entre le poteau et le mur
    #[test]
    #[ignore]
    fn banc_poteau_ext() {
        let chemin = concat!(env!("CARGO_MANIFEST_DIR"), "/donnees/monde.json");
        let s0 = physique::Sim::charger(chemin).unwrap();
        std::panic::set_hook(Box::new(|_| {}));
        let sep = s0.geo["separators"].clone();
        let mut bloquees = 0;
        let mut n = 0;
        for cote in 0..2 {
            let (px, py) = (sep[cote][0][0].as_f64().unwrap() as f32, sep[cote][0][1].as_f64().unwrap() as f32);
            for dy in (-60..=20).step_by(4) {
                for dx in (-40..=40).step_by(4) {
                    for (vx, vy) in [(0.0, 0.0), (0.4, 0.3), (-0.4, 0.3), (0.0, 0.8)] {
                        let (x, y) = (px + dx as f32, py + dy as f32);
                        if x < 14.0 || x > s0.w - 14.0 { continue; }
                        let r = std::panic::catch_unwind(|| {
                        let mut s = physique::Sim::charger(chemin).unwrap();
                        s.secoue_auto = false;
                        let i = s.make_ball(x, y);
                        s.set_roulement(i, vx, vy);
                        let mut immobile = 0.0;
                        let mut fini = false;
                        for _ in 0..(480 * 6) {
                            s.step(1000.0 / 480.0);
                            if s.billes[i].retiree || std::mem::take(&mut s.contacts).iter().any(|(c, f)| *f && c == "drain") { fini = true; break; }
                            if s.vitesse(i) < 0.01 { immobile += 1000.0 / 480.0; if immobile > 1000.0 { break; } } else { immobile = 0.0; }
                        }
                        let (bx, by) = s.position(i);
                        (!fini && immobile > 1000.0 && by < 1000.0, bx, by)
                        });
                        n += 1;
                        if let Ok((true, bx, by)) = r {
                            bloquees += 1;
                            println!("bloquée : départ ({x:.0},{y:.0}) v ({vx},{vy}) → arrêtée en ({bx:.0},{by:.0})");
                        }
                    }
                }
            }
        }
        println!("{bloquees} billes bloquées sur {n}");
    }
}
