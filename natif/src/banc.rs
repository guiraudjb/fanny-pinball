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
