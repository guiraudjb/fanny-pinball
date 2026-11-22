//! Lecteur minimal de fichiers glTF binaires (`.glb`) produits par `outils/cao_web.py`.
//! Zéro dépendance externe : parseur JSON minimal + extraction des positions (`VEC3 f32`),
//! indices (`u16`/`u32`), catégories et métadonnées de la caisse.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct GlbNode {
    pub name: String,
    pub categorie: String,
    pub positions: Vec<[f32; 3]>,
    pub indices: Vec<u32>,
}

#[derive(Debug, Clone, Copy)]
pub struct CaisseExtras {
    pub pf_x: f32,
    pub pf_y: f32,
    pub pf_z: f32,
    pub pf_pente_deg: f32,
    pub cs_largeur: f32,
    pub cs_longueur: f32,
    pub cs_ep: f32,
    pub cs_h_arriere: f32,
    pub fr_l: f32,
    pub fr_h: f32,
    pub fr_p_haut: f32,
    pub fr_p_bas: f32,
    pub h_sol: f32,
    pub lanceur_axe: [f32; 3],
}

impl Default for CaisseExtras {
    fn default() -> Self {
        Self {
            pf_x: 22.4,
            pf_y: 31.0,
            pf_z: 330.0,
            pf_pente_deg: 6.5,
            cs_largeur: 558.8,
            cs_longueur: 1308.1,
            cs_ep: 19.0,
            cs_h_arriere: 609.6,
            fr_l: 730.25,
            fr_h: 723.9,
            fr_p_haut: 250.83,
            fr_p_bas: 161.93,
            h_sol: 528.16,
            lanceur_axe: [0.0, -0.99357, -0.11320],
        }
    }
}

pub struct GlbScene {
    pub nodes: Vec<GlbNode>,
    pub caisse: Option<CaisseExtras>,
}

pub fn load_glb(path: &Path) -> Result<GlbScene, String> {
    let data = fs::read(path).map_err(|e| format!("Lecture {} : {e}", path.display()))?;
    if data.len() < 28 || u32::from_le_bytes(data[0..4].try_into().unwrap()) != 0x4654_6C67 {
        return Err(format!("{} : en-tête GLB invalide", path.display()));
    }
    let json_len = u32::from_le_bytes(data[12..16].try_into().unwrap()) as usize;
    if 20 + json_len + 8 > data.len() {
        return Err(format!("{} : GLB tronqué", path.display()));
    }
    let json_str = std::str::from_utf8(&data[20..20 + json_len])
        .map_err(|e| format!("JSON UTF-8 invalide : {e}"))?;
    let bin_off = 20 + json_len + 8;
    let bin = &data[bin_off..];

    let root = JsonParser::new(json_str).parse_value()?;
    let accessors = root.get("accessors").and_then(Json::as_arr).ok_or("accessors manquant")?;
    let views = root.get("bufferViews").and_then(Json::as_arr).ok_or("bufferViews manquant")?;
    let meshes = root.get("meshes").and_then(Json::as_arr).ok_or("meshes manquant")?;
    let jnodes = root.get("nodes").and_then(Json::as_arr).ok_or("nodes manquant")?;

    let read_vec3 = |acc_idx: usize| -> Result<Vec<[f32; 3]>, String> {
        let acc = accessors.get(acc_idx).ok_or("accessor invalide")?;
        let bv_idx = acc.get_usize("bufferView").ok_or("bufferView manquant")?;
        let count = acc.get_usize("count").ok_or("count manquant")?;
        let bv = views.get(bv_idx).ok_or("bufferView invalide")?;
        let off = bv.get_usize("byteOffset").unwrap_or(0) + acc.get_usize("byteOffset").unwrap_or(0);
        let need = off + count * 12;
        if need > bin.len() {
            return Err("buffer VEC3 hors limites".into());
        }
        let mut out = Vec::with_capacity(count);
        for i in 0..count {
            let p = off + i * 12;
            let x = f32::from_le_bytes(bin[p..p + 4].try_into().unwrap());
            let y = f32::from_le_bytes(bin[p + 4..p + 8].try_into().unwrap());
            let z = f32::from_le_bytes(bin[p + 8..p + 12].try_into().unwrap());
            out.push([x, y, z]);
        }
        Ok(out)
    };

    let read_indices = |acc_idx: usize| -> Result<Vec<u32>, String> {
        let acc = accessors.get(acc_idx).ok_or("accessor indices invalide")?;
        let bv_idx = acc.get_usize("bufferView").ok_or("bufferView manquant")?;
        let count = acc.get_usize("count").ok_or("count manquant")?;
        let comp = acc.get_usize("componentType").unwrap_or(5125);
        let bv = views.get(bv_idx).ok_or("bufferView invalide")?;
        let off = bv.get_usize("byteOffset").unwrap_or(0) + acc.get_usize("byteOffset").unwrap_or(0);
        let mut out = Vec::with_capacity(count);
        if comp == 5123 {
            if off + count * 2 > bin.len() {
                return Err("buffer u16 hors limites".into());
            }
            for i in 0..count {
                let p = off + i * 2;
                out.push(u16::from_le_bytes(bin[p..p + 2].try_into().unwrap()) as u32);
            }
        } else {
            if off + count * 4 > bin.len() {
                return Err("buffer u32 hors limites".into());
            }
            for i in 0..count {
                let p = off + i * 4;
                out.push(u32::from_le_bytes(bin[p..p + 4].try_into().unwrap()));
            }
        }
        Ok(out)
    };

    let mut nodes = Vec::with_capacity(jnodes.len());
    for n in jnodes {
        let Some(mesh_idx) = n.get_usize("mesh") else { continue };
        let Some(mesh) = meshes.get(mesh_idx) else { continue };
        let Some(prims) = mesh.get("primitives").and_then(Json::as_arr) else { continue };
        let Some(prim) = prims.first() else { continue };
        let Some(pos_acc) = prim.get("attributes").and_then(|a| a.get_usize("POSITION")) else { continue };
        let Some(idx_acc) = prim.get_usize("indices") else { continue };

        let name = n.get("name").and_then(Json::as_str).unwrap_or("").to_string();
        let categorie = n
            .get("extras")
            .and_then(|e| e.get("categorie"))
            .and_then(Json::as_str)
            .unwrap_or("")
            .to_string();
        let positions = read_vec3(pos_acc)?;
        let indices = read_indices(idx_acc)?;
        nodes.push(GlbNode {
            name,
            categorie,
            positions,
            indices,
        });
    }

    // Métadonnées optionnelles de la caisse (`caisse.glb`)
    let mut caisse = None;
    if let Some(ex) = root
        .get("scenes")
        .and_then(Json::as_arr)
        .and_then(|s| s.first())
        .and_then(|s| s.get("extras"))
    {
        if let (Some(pf), Some(cs), Some(fr)) = (ex.get("plateau"), ex.get("caisse"), ex.get("fronton")) {
            let mut ce = CaisseExtras::default();
            ce.pf_x = pf.get_f32("x").unwrap_or(ce.pf_x);
            ce.pf_y = pf.get_f32("y").unwrap_or(ce.pf_y);
            ce.pf_z = pf.get_f32("z").unwrap_or(ce.pf_z);
            ce.pf_pente_deg = pf.get_f32("pente_deg").unwrap_or(ce.pf_pente_deg);
            ce.cs_largeur = cs.get_f32("largeur").unwrap_or(ce.cs_largeur);
            ce.cs_longueur = cs.get_f32("longueur").unwrap_or(ce.cs_longueur);
            ce.cs_ep = cs.get_f32("ep").unwrap_or(ce.cs_ep);
            ce.cs_h_arriere = cs.get_f32("h_arriere").unwrap_or(ce.cs_h_arriere);
            ce.fr_l = fr.get_f32("l").unwrap_or(ce.fr_l);
            ce.fr_h = fr.get_f32("h").unwrap_or(ce.fr_h);
            ce.fr_p_haut = fr.get_f32("p_haut").unwrap_or(ce.fr_p_haut);
            ce.fr_p_bas = fr.get_f32("p_bas").unwrap_or(ce.fr_p_bas);
            ce.h_sol = ex.get_f32("h_sol").unwrap_or(ce.h_sol);
            if let Some(axe) = ex.get("lanceur").and_then(|l| l.get("axe")).and_then(Json::as_arr) {
                if axe.len() == 3 {
                    ce.lanceur_axe = [
                        axe[0].as_f64().unwrap_or(0.0) as f32,
                        axe[1].as_f64().unwrap_or(-1.0) as f32,
                        axe[2].as_f64().unwrap_or(0.0) as f32,
                    ];
                }
            }
            caisse = Some(ce);
        }
    }

    Ok(GlbScene { nodes, caisse })
}

// ============================================================================
// Parseur JSON minimal (zéro crate)
// ============================================================================

#[derive(Debug)]
enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(HashMap<String, Json>),
}

impl Json {
    fn get(&self, k: &str) -> Option<&Json> {
        match self {
            Json::Obj(m) => m.get(k),
            _ => None,
        }
    }
    fn as_arr(&self) -> Option<&[Json]> {
        match self {
            Json::Arr(v) => Some(v),
            _ => None,
        }
    }
    fn as_str(&self) -> Option<&str> {
        match self {
            Json::Str(s) => Some(s),
            _ => None,
        }
    }
    fn as_f64(&self) -> Option<f64> {
        match self {
            Json::Num(n) => Some(*n),
            _ => None,
        }
    }
    fn get_usize(&self, k: &str) -> Option<usize> {
        self.get(k).and_then(Json::as_f64).map(|n| n as usize)
    }
    fn get_f32(&self, k: &str) -> Option<f32> {
        self.get(k).and_then(Json::as_f64).map(|n| n as f32)
    }
}

struct JsonParser<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> JsonParser<'a> {
    fn new(s: &'a str) -> Self {
        Self { b: s.as_bytes(), i: 0 }
    }
    fn skip_ws(&mut self) {
        while self.i < self.b.len() && matches!(self.b[self.i], b' ' | b'\n' | b'\r' | b'\t') {
            self.i += 1;
        }
    }
    fn peek(&mut self) -> Option<u8> {
        self.skip_ws();
        self.b.get(self.i).copied()
    }
    fn parse_value(&mut self) -> Result<Json, String> {
        match self.peek().ok_or("Fin JSON inattendue")? {
            b'{' => self.parse_obj(),
            b'[' => self.parse_arr(),
            b'"' => self.parse_str().map(Json::Str),
            b't' => {
                self.i += 4;
                Ok(Json::Bool(true))
            }
            b'f' => {
                self.i += 5;
                Ok(Json::Bool(false))
            }
            b'n' => {
                self.i += 4;
                Ok(Json::Null)
            }
            _ => self.parse_num(),
        }
    }
    fn parse_str(&mut self) -> Result<String, String> {
        self.skip_ws();
        if self.b.get(self.i) != Some(&b'"') {
            return Err("Chaîne JSON attendue".into());
        }
        self.i += 1;
        let mut s = String::new();
        while self.i < self.b.len() {
            let c = self.b[self.i];
            self.i += 1;
            if c == b'"' {
                return Ok(s);
            }
            if c == b'\\' && self.i < self.b.len() {
                let esc = self.b[self.i];
                self.i += 1;
                match esc {
                    b'"' => s.push('"'),
                    b'\\' => s.push('\\'),
                    b'/' => s.push('/'),
                    b'n' => s.push('\n'),
                    b'r' => s.push('\r'),
                    b't' => s.push('\t'),
                    b'u' if self.i + 4 <= self.b.len() => {
                        let hex = std::str::from_utf8(&self.b[self.i..self.i + 4]).unwrap_or("003F");
                        self.i += 4;
                        if let Ok(code) = u32::from_str_radix(hex, 16) {
                            if let Some(ch) = char::from_u32(code) {
                                s.push(ch);
                            }
                        }
                    }
                    _ => s.push(esc as char),
                }
            } else {
                s.push(c as char);
            }
        }
        Err("Chaîne JSON non fermée".into())
    }
    fn parse_num(&mut self) -> Result<Json, String> {
        self.skip_ws();
        let start = self.i;
        while self.i < self.b.len()
            && matches!(self.b[self.i], b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E')
        {
            self.i += 1;
        }
        let s = std::str::from_utf8(&self.b[start..self.i]).map_err(|_| "Nombre JSON invalide")?;
        s.parse::<f64>()
            .map(Json::Num)
            .map_err(|_| format!("Nombre JSON invalide : {s}"))
    }
    fn parse_arr(&mut self) -> Result<Json, String> {
        self.i += 1; // '['
        let mut out = Vec::new();
        if self.peek() == Some(b']') {
            self.i += 1;
            return Ok(Json::Arr(out));
        }
        loop {
            out.push(self.parse_value()?);
            match self.peek() {
                Some(b',') => self.i += 1,
                Some(b']') => {
                    self.i += 1;
                    return Ok(Json::Arr(out));
                }
                _ => return Err("Tableau JSON invalide".into()),
            }
        }
    }
    fn parse_obj(&mut self) -> Result<Json, String> {
        self.i += 1; // '{'
        let mut out = HashMap::new();
        if self.peek() == Some(b'}') {
            self.i += 1;
            return Ok(Json::Obj(out));
        }
        loop {
            let k = self.parse_str()?;
            if self.peek() != Some(b':') {
                return Err("':' attendu dans JSON".into());
            }
            self.i += 1;
            let v = self.parse_value()?;
            out.insert(k, v);
            match self.peek() {
                Some(b',') => self.i += 1,
                Some(b'}') => {
                    self.i += 1;
                    return Ok(Json::Obj(out));
                }
                _ => return Err("Objet JSON invalide".into()),
            }
        }
    }
}
