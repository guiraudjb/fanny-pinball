// Décor 3D de la version d'origine (donnees/decor, préparé par decor_glb.py depuis natif/donnees/scene.glb) :
// chaque groupe (une matière, ou une pièce mobile) devient une primitive VPX à maillage, sans collision.
// La physique reste aux éléments VPX (murs, palettes, cibles…), dont on cache alors le rendu.
use flate2::{Compression, write::ZlibEncoder};
use serde_json::Value;
use std::io::Write;
use std::path::Path;
use vpin::vpx::{
    color::Color,
    gameitem::{GameItemEnum, primitive::Primitive, vertex3d::Vertex3D},
    image::ImageData,
    material::{SaveMaterial, SavePhysicsMaterial},
};

fn zlib(data: &[u8]) -> Vec<u8> {
    let mut e = ZlibEncoder::new(Vec::new(), Compression::best());
    e.write_all(data).unwrap();
    e.finish().unwrap()
}

pub struct Decor {
    pub items: Vec<GameItemEnum>,
    pub images: Vec<ImageData>,
    pub materiaux: Vec<SaveMaterial>,
    pub physiques: Vec<SavePhysicsMaterial>,
    pub plateau: std::path::PathBuf,
}

/// pivots : position (unités VP) des pièces mobiles dont on connaît l'axe (palettes)
pub fn charger(dossier: &Path, pivots: &[(&str, f32, f32)], image: impl Fn(&str, &Path, bool) -> ImageData) -> Decor {
    let d: Value = serde_json::from_str(&std::fs::read_to_string(dossier.join("decor.json")).expect("donnees/decor (python3 decor_glb.py)")).unwrap();
    let mut out = Decor { items: vec![], images: vec![], materiaux: vec![], physiques: vec![], plateau: dossier.join(d["plateau"].as_str().unwrap()) };
    let mut deja: Vec<String> = vec![];
    for (k, g) in d["groupes"].as_array().unwrap().iter().enumerate() {
        let octets = std::fs::read(dossier.join(g["fichier"].as_str().unwrap())).unwrap();
        let ns = g["sommets"].as_u64().unwrap() as usize;
        let nt = g["triangles"].as_u64().unwrap() as usize;
        let mut sommets: Vec<f32> = octets[..ns * 32].chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect();
        let indices: Vec<u32> = octets[ns * 32..].chunks_exact(4).map(|b| u32::from_le_bytes(b.try_into().unwrap())).collect();
        assert_eq!(indices.len(), nt * 3);

        // pièce mobile : maillage ramené autour de son pivot, la primitive est posée sur le pivot
        let mobile = g["mobile"].as_str().map(String::from);
        let mut pos = [0.0f32; 3];
        if let Some(m) = &mobile {
            if let Some(&(_, x, y)) = pivots.iter().find(|p| p.0 == m) { pos = [x, y, 0.0]; }
            else { pos = [g["pivot"][0].as_f64().unwrap() as f32, g["pivot"][1].as_f64().unwrap() as f32, 0.0]; }
            for v in sommets.chunks_exact_mut(8) { v[0] -= pos[0]; v[1] -= pos[1]; }
        }
        let vbytes: Vec<u8> = sommets.iter().flat_map(|f| f.to_le_bytes()).collect();
        let ibytes: Vec<u8> = if ns > 65535 { indices.iter().flat_map(|i| i.to_le_bytes()).collect() }
            else { indices.iter().flat_map(|&i| (i as u16).to_le_bytes()).collect() };
        let cv = zlib(&vbytes);
        let ci = zlib(&ibytes);

        // matière
        let mnom = format!("Decor{k:03}");
        let opacite = g["opacite"].as_f64().unwrap_or(1.0) as f32;
        // alpha de la texture : « masque » = test alpha (découpes nettes), « fondu » = mélange ; sinon opaque
        let alpha = g["alpha"].as_str().unwrap_or("");
        let actif = opacite < 0.99 || !alpha.is_empty();
        let rug = g["rugosite"].as_f64().unwrap_or(0.8) as f32;
        let metal = g["metal"].as_bool().unwrap_or(false);
        let couleur = g["couleur"].as_u64().unwrap_or(0xffffff) as u32;
        out.materiaux.push(SaveMaterial {
            name: mnom.clone(), base_color: Color::from_rgb(couleur),
            glossy_color: Color::from_rgb(if metal { couleur } else { 0x303030 }), clearcoat_color: Color::from_rgb(0),
            wrap_lighting: 0.3, is_metal: metal, roughness: (1.0 - rug).clamp(0.0, 1.0), glossy_image_lerp: 255, edge: 1.0,
            thickness: 13, opacity: opacite, opacity_active_edge_alpha: if actif { 255 } else { 254 },
        });
        out.physiques.push(SavePhysicsMaterial { name: mnom.clone(), elasticity: 0.3, elasticity_falloff: 0.0, friction: 0.3, scatter_angle: 0.0 });

        // texture
        let mut tex = String::new();
        if let Some(t) = g["texture"].as_str() {
            tex = format!("decor_{}", t.split('.').next().unwrap());
            if !deja.contains(&tex) {
                deja.push(tex.clone());
                out.images.push(image(&tex, &dossier.join(t), alpha == "masque"));
            }
        }
        let nom = match &mobile { Some(m) => m.clone(), None => format!("Decor{k:03}") };
        let mut p = Primitive {
            name: if mobile.is_some() { format!("{nom}_{k:03}") } else { nom },
            position: Vertex3D::new(pos[0], pos[1], pos[2]), size: Vertex3D::new(1.0, 1.0, 1.0),
            image: tex, material: mnom.clone(), is_visible: true, is_collidable: false, is_toy: true, use_3d_mesh: true,
            static_rendering: mobile.is_none(), hit_event: false, ..Default::default()
        };
        p.rot_and_tra = [0.0; 9];
        p.backfaces_enabled = Some(g["deux_faces"].as_bool().unwrap_or(false) || actif);
        if g["emissif"].as_bool().unwrap_or(false) { p.disable_lighting_top = Some(0.6); }
        p.num_vertices = Some(ns as u32);
        p.compressed_vertices_len = Some(cv.len() as u32);
        p.compressed_vertices_data = Some(cv);
        p.num_indices = Some((nt * 3) as u32);
        p.compressed_indices_len = Some(ci.len() as u32);
        p.compressed_indices_data = Some(ci);
        out.items.push(GameItemEnum::Primitive(Box::new(p)));
    }
    out
}
