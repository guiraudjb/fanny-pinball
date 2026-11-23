// Rendu OpenGL 3.3 de la scène exportée du jeu web (donnees/scene.glb, outils/exporter_scene_natif.mjs) : la même
// caisse habillée, le même plateau peint (4 042 px de haut), la même rampe décorée. Textures avec mipmaps et filtrage
// anisotrope. Les pièces mobiles (dyn_*) sont animées depuis la physique, les matériaux lampe_* et emis_* s'allument
// selon les règles, comme js/render3d.js draw().

use gl::types::*;
use nalgebra::{Matrix3, Matrix4, Point3, Quaternion, UnitQuaternion, Vector3, Vector4};
use std::collections::HashMap;
use std::ffi::CString;

pub struct Texture { id: GLuint }

/// Panneau des afficheurs du fronton (texture « afficheurs » de la scène, exportée éteinte) : les segments allumés
/// sont redessinés sur une copie du fond, avec la même géométrie que js/segfont.js drawSegDisplay
pub struct Afficheurs { tex: GLuint, w: u32, h: u32, fond: Vec<u8>, score: [f32; 4], info: [f32; 4], texte: String }

/// police 7 segments des TM1637 (js/segfont.js SEG) : bit0 = a … bit6 = g
pub fn segments(c: char) -> u8 {
    match c {
        '-' => 0x40, '_' => 0x08, '=' => 0x48, '\'' => 0x02, '"' => 0x22,
        '0' => 0x3f, '1' => 0x06, '2' => 0x5b, '3' => 0x4f, '4' => 0x66, '5' => 0x6d, '6' => 0x7d, '7' => 0x07, '8' => 0x7f, '9' => 0x6f,
        'b' => 0x7c, 'c' => 0x58, 'd' => 0x5e, 'h' => 0x74, 'n' => 0x54, 'o' => 0x5c, 'r' => 0x50, 'u' => 0x1c,
        _ => match c.to_ascii_uppercase() {
            'A' => 0x77, 'B' => 0x7c, 'C' => 0x39, 'D' => 0x5e, 'E' => 0x79, 'F' => 0x71, 'G' => 0x3d, 'H' => 0x76, 'I' => 0x06,
            'J' => 0x1e, 'K' => 0x75, 'L' => 0x38, 'M' => 0x37, 'N' => 0x54, 'O' => 0x3f, 'P' => 0x73, 'Q' => 0x67, 'R' => 0x50,
            'S' => 0x6d, 'T' => 0x78, 'U' => 0x3e, 'V' => 0x1c, 'W' => 0x2a, 'X' => 0x76, 'Y' => 0x6e, 'Z' => 0x5b, _ => 0,
        },
    }
}

impl Afficheurs {
    /// met à jour la texture si le texte a changé (score sur 8 caractères, info sur 4)
    pub fn ecrire(&mut self, score: &str, info: &str) {
        let texte = format!("{score}|{info}");
        if texte == self.texte { return; }
        self.texte = texte;
        let mut px = self.fond.clone();
        let (w, h) = (self.w as f32, self.h as f32);
        for (txt, r, coul) in [(score, self.score, [255u8, 59, 31]), (info, self.info, [255, 176, 32])] {
            let (rx, ry, cw, ch) = (r[0] * w, r[1] * h, r[2] * w, r[3] * h);
            let car: Vec<char> = txt.chars().collect();
            let n = car.len().max(1) as f32;
            let pad = ch * 0.12;
            let dw = (cw - pad * 2.0) / n;
            let hh = ch - pad * 2.0;
            let sw = (dw * 0.72).min(hh * 0.55);
            let t = (sw * 0.17).max(2.0);
            for (i, &c) in car.iter().enumerate() {
                let bits = segments(c);
                let x = rx + pad + i as f32 * dw + (dw - sw) / 2.0 + hh * 0.04;
                let y = ry + pad;
                let segs = [
                    [x + t * 0.6, y, sw - t * 1.2, t],
                    [x + sw - t, y + t * 0.6, t, hh / 2.0 - t * 0.9],
                    [x + sw - t, y + hh / 2.0 + t * 0.3, t, hh / 2.0 - t * 0.9],
                    [x + t * 0.6, y + hh - t, sw - t * 1.2, t],
                    [x, y + hh / 2.0 + t * 0.3, t, hh / 2.0 - t * 0.9],
                    [x, y + t * 0.6, t, hh / 2.0 - t * 0.9],
                    [x + t * 0.6, y + hh / 2.0 - t / 2.0, sw - t * 1.2, t],
                ];
                for (k, q) in segs.iter().enumerate() {
                    if bits & (1 << k) == 0 { continue; }
                    let cy = q[1] + q[3] / 2.0;
                    for py in q[1].floor().max(0.0) as i32..(q[1] + q[3]).ceil().min(h) as i32 {
                        let dx = -0.08 * (py as f32 + 0.5 - cy);       // léger penché, comme le jeu web
                        for pxx in (q[0] + dx).floor().max(0.0) as i32..(q[0] + q[2] + dx).ceil().min(w) as i32 {
                            let o = (((self.h - 1 - py as u32) * self.w + pxx as u32) * 4) as usize;   // image exportée tête-bêche (flipY du canevas)
                            px[o..o + 3].copy_from_slice(&coul);
                            px[o + 3] = 255;
                        }
                    }
                }
            }
        }
        unsafe {
            gl::BindTexture(gl::TEXTURE_2D, self.tex);
            gl::PixelStorei(gl::UNPACK_ALIGNMENT, 1);
            gl::TexSubImage2D(gl::TEXTURE_2D, 0, 0, 0, self.w as i32, self.h as i32, gl::RGBA, gl::UNSIGNED_BYTE, px.as_ptr() as *const _);
            gl::GenerateMipmap(gl::TEXTURE_2D);
        }
    }
}

#[derive(Clone)]
pub struct Materiau {
    pub nom: String,
    pub couleur: [f32; 4],
    pub tex: Option<usize>,
    pub metal: f32,
    pub rugosite: f32,
    pub emission: [f32; 3],
    pub emission_tex: Option<usize>,
    pub intensite: f32,          // multiplicateur d'émission piloté par le jeu (lampes, bumpers)
    pub transparent: bool,
    pub double_face: bool,
    pub sans_eclairage: bool,
}

struct Primitive { vao: GLuint, n: i32, mat: usize }

pub struct Noeud {
    pub nom: String,
    pub parent: Option<usize>,
    pub t: Vector3<f32>,
    pub r: UnitQuaternion<f32>,
    pub s: Vector3<f32>,
    pub t0: Vector3<f32>,
    pub r0: UnitQuaternion<f32>,
    pub visible: bool,
    maillage: Option<usize>,
    pub monde: Matrix4<f32>,
}

#[derive(Clone, Debug)]
pub struct Camera { pub nom: String, pub format: String, pub matrice: Matrix4<f32>, pub fov: f32, pub near: f32, pub far: f32 }

pub struct Scene {
    textures: Vec<Texture>,
    pub materiaux: Vec<Materiau>,
    maillages: Vec<Vec<Primitive>>,
    pub noeuds: Vec<Noeud>,
    pub noms: HashMap<String, usize>,
    pub mat_noms: HashMap<String, usize>,
    pub cameras: Vec<Camera>,
    programme: GLuint,
    u: HashMap<&'static str, GLint>,
    bille: (GLuint, i32),
    blanc: GLuint,
    pub afficheurs: Option<Afficheurs>,
}

const VS: &str = r#"#version 330 core
layout(location=0) in vec3 p; layout(location=1) in vec3 n; layout(location=2) in vec2 uv;
uniform mat4 M, VP; uniform mat3 N;
out vec3 wp; out vec3 wn; out vec2 vuv;
void main(){ vec4 w = M * vec4(p,1.0); wp = w.xyz; wn = normalize(N * n); vuv = uv; gl_Position = VP * w; }"#;

// éclairage : salle sombre, lumière principale au-dessus de la caisse, appoint de face, ciel diffus ; reflets selon la
// rugosité (Blinn-Phong normalisé), métal teinté, environnement simplifié (dégradé), émission des lampes
const FS: &str = r#"#version 330 core
in vec3 wp; in vec3 wn; in vec2 vuv; out vec4 frag;
uniform sampler2D tex; uniform sampler2D etex; uniform vec4 couleur; uniform vec3 emission; uniform float metal, rugo, intens;
uniform vec3 oeil; uniform int double_face; uniform int unlit;
uniform vec3 Ldir[3]; uniform vec3 Lcol[3];
vec3 ciel(vec3 d){ return mix(vec3(0.05,0.035,0.03), vec3(0.55,0.52,0.48), clamp(d.y*0.5+0.5,0.0,1.0)); }
void main(){
  vec4 b = texture(tex, vuv) * couleur;
  if (b.a < 0.02) discard;
  if (unlit == 1) { vec3 u = b.rgb / (1.0 + b.rgb * 0.25); frag = vec4(pow(u, vec3(1.0/2.2)), b.a); return; }
  vec3 N = normalize(wn); vec3 V = normalize(oeil - wp);
  if (double_face == 1 && dot(N, V) < 0.0) N = -N;
  vec3 diff = b.rgb * (1.0 - metal);
  vec3 F0 = mix(vec3(0.04), b.rgb, metal);
  float r = clamp(rugo, 0.04, 1.0); float sh = 2.0 / (r*r*r*r) - 2.0;
  vec3 c = diff * ciel(N) * 0.35;
  for (int i = 0; i < 3; i++) {
    vec3 L = normalize(-Ldir[i]); float nl = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V); float s = pow(max(dot(N, H), 0.0), sh) * (sh + 8.0) / 25.0;
    c += Lcol[i] * nl * (diff + F0 * s);
  }
  vec3 R = reflect(-V, N); float fr = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  c += ciel(R) * mix(F0, vec3(1.0), fr) * (1.0 - r) * 0.8;
  c += emission * texture(etex, vuv).rgb * intens;
  c = c / (1.0 + c * 0.25);
  frag = vec4(pow(c, vec3(1.0/2.2)), b.a);
}"#;

unsafe fn shader(src: &str, kind: GLenum) -> GLuint {
    let s = gl::CreateShader(kind);
    let c = CString::new(src).unwrap();
    gl::ShaderSource(s, 1, &c.as_ptr(), std::ptr::null());
    gl::CompileShader(s);
    let mut ok = 0;
    gl::GetShaderiv(s, gl::COMPILE_STATUS, &mut ok);
    if ok == 0 {
        let mut buf = vec![0u8; 4096];
        let mut l = 0;
        gl::GetShaderInfoLog(s, 4096, &mut l, buf.as_mut_ptr() as *mut _);
        panic!("shader : {}", String::from_utf8_lossy(&buf[..l as usize]));
    }
    s
}

fn texture_rgba(w: u32, h: u32, px: &[u8], aniso: f32) -> GLuint {
    let mut id = 0;
    unsafe {
        gl::GenTextures(1, &mut id);
        gl::BindTexture(gl::TEXTURE_2D, id);
        gl::PixelStorei(gl::UNPACK_ALIGNMENT, 1);
        gl::TexImage2D(gl::TEXTURE_2D, 0, gl::SRGB8_ALPHA8 as i32, w as i32, h as i32, 0, gl::RGBA, gl::UNSIGNED_BYTE, px.as_ptr() as *const _);
        gl::GenerateMipmap(gl::TEXTURE_2D);
        gl::TexParameteri(gl::TEXTURE_2D, gl::TEXTURE_MIN_FILTER, gl::LINEAR_MIPMAP_LINEAR as i32);
        gl::TexParameteri(gl::TEXTURE_2D, gl::TEXTURE_MAG_FILTER, gl::LINEAR as i32);
        gl::TexParameteri(gl::TEXTURE_2D, gl::TEXTURE_WRAP_S, gl::REPEAT as i32);
        gl::TexParameteri(gl::TEXTURE_2D, gl::TEXTURE_WRAP_T, gl::REPEAT as i32);
        if aniso > 1.0 { gl::TexParameterf(gl::TEXTURE_2D, 0x84FE, aniso); }   // GL_TEXTURE_MAX_ANISOTROPY
    }
    id
}

unsafe fn vao(pos: &[[f32; 3]], nor: &[[f32; 3]], uv: &[[f32; 2]], idx: &[u32]) -> GLuint {
    let mut v = 0;
    gl::GenVertexArrays(1, &mut v);
    gl::BindVertexArray(v);
    for (k, (data, n)) in [(pos.as_ptr() as *const f32, 3), (nor.as_ptr() as *const f32, 3), (uv.as_ptr() as *const f32, 2)].iter().enumerate() {
        let mut b = 0;
        gl::GenBuffers(1, &mut b);
        gl::BindBuffer(gl::ARRAY_BUFFER, b);
        gl::BufferData(gl::ARRAY_BUFFER, (pos.len() * n * 4) as isize, *data as *const _, gl::STATIC_DRAW);
        gl::EnableVertexAttribArray(k as u32);
        gl::VertexAttribPointer(k as u32, *n as i32, gl::FLOAT, gl::FALSE, 0, std::ptr::null());
    }
    let mut e = 0;
    gl::GenBuffers(1, &mut e);
    gl::BindBuffer(gl::ELEMENT_ARRAY_BUFFER, e);
    gl::BufferData(gl::ELEMENT_ARRAY_BUFFER, (idx.len() * 4) as isize, idx.as_ptr() as *const _, gl::STATIC_DRAW);
    gl::BindVertexArray(0);
    v
}

fn normales(pos: &[[f32; 3]], idx: &[u32]) -> Vec<[f32; 3]> {
    let mut n = vec![Vector3::zeros(); pos.len()];
    for t in idx.chunks(3) {
        let (a, b, c) = (Vector3::from(pos[t[0] as usize]), Vector3::from(pos[t[1] as usize]), Vector3::from(pos[t[2] as usize]));
        let f = (b - a).cross(&(c - a));
        for &i in t { n[i as usize] += f; }
    }
    n.iter().map(|v| { let v = v.try_normalize(1e-12).unwrap_or(Vector3::z()); [v.x, v.y, v.z] }).collect()
}

impl Scene {
    pub fn charger(chemin: &str) -> Result<Scene, String> {
        let (doc, buffers, images) = gltf::import(chemin).map_err(|e| format!("{chemin} : {e}"))?;
        let mut aniso = 1.0f32;
        unsafe { gl::GetFloatv(0x84FF, &mut aniso); }
        let aniso = aniso.min(16.0);
        // textures (images glTF décodées, converties en RGBA)
        let mut textures = vec![];
        let mut pixels: Vec<(u32, u32, Vec<u8>)> = vec![];
        for im in &images {
            use gltf::image::Format::*;
            let px: Vec<u8> = match im.format {
                R8G8B8A8 => im.pixels.clone(),
                R8G8B8 => im.pixels.chunks(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect(),
                R8 => im.pixels.iter().flat_map(|&c| [c, c, c, 255]).collect(),
                R8G8 => im.pixels.chunks(2).flat_map(|c| [c[0], c[0], c[0], c[1]]).collect(),
                _ => vec![255; (im.width * im.height * 4) as usize],
            };
            textures.push(Texture { id: texture_rgba(im.width, im.height, &px, aniso) });
            pixels.push((im.width, im.height, px));
        }
        let tex_image = |t: gltf::texture::Texture| t.source().index();
        let materiaux: Vec<Materiau> = doc.materials().map(|m| {
            let pbr = m.pbr_metallic_roughness();
            let e = m.emissive_factor();
            Materiau {
                nom: m.name().unwrap_or("").to_string(),
                couleur: pbr.base_color_factor(),
                tex: pbr.base_color_texture().map(|t| tex_image(t.texture())),
                metal: pbr.metallic_factor(),
                rugosite: pbr.roughness_factor(),
                emission: e,
                emission_tex: m.emissive_texture().map(|t| tex_image(t.texture())),
                intensite: m.emissive_strength().unwrap_or(1.0),
                transparent: m.alpha_mode() == gltf::material::AlphaMode::Blend,
                double_face: m.double_sided(),
                sans_eclairage: m.unlit(),
            }
        }).collect();
        let defaut = materiaux.len();
        let mut materiaux = materiaux;
        materiaux.push(Materiau { nom: "défaut".into(), couleur: [0.8, 0.8, 0.8, 1.0], tex: None, metal: 0.0, rugosite: 0.6,
            emission: [0.0; 3], emission_tex: None, intensite: 1.0, transparent: false, double_face: false, sans_eclairage: false });
        let mut maillages = vec![];
        for m in doc.meshes() {
            let mut prims = vec![];
            for p in m.primitives() {
                if p.mode() != gltf::mesh::Mode::Triangles { continue; }
                let r = p.reader(|b| Some(&buffers[b.index()]));
                let Some(pos) = r.read_positions() else { continue };
                let pos: Vec<[f32; 3]> = pos.collect();
                let idx: Vec<u32> = r.read_indices().map(|i| i.into_u32().collect()).unwrap_or_else(|| (0..pos.len() as u32).collect());
                let nor: Vec<[f32; 3]> = r.read_normals().map(|n| n.collect()).unwrap_or_else(|| normales(&pos, &idx));
                let uv: Vec<[f32; 2]> = r.read_tex_coords(0).map(|t| t.into_f32().collect()).unwrap_or_else(|| vec![[0.0, 0.0]; pos.len()]);
                let v = unsafe { vao(&pos, &nor, &uv, &idx) };
                prims.push(Primitive { vao: v, n: idx.len() as i32, mat: p.material().index().unwrap_or(defaut) });
            }
            maillages.push(prims);
        }
        // nœuds : hiérarchie aplatie (parent avant enfants)
        let mut noeuds: Vec<Noeud> = vec![];
        fn ajouter(n: gltf::Node, parent: Option<usize>, out: &mut Vec<Noeud>) {
            let (t, r, s) = n.transform().decomposed();
            let rq = UnitQuaternion::from_quaternion(Quaternion::new(r[3], r[0], r[1], r[2]));
            out.push(Noeud { nom: n.name().unwrap_or("").to_string(), parent, t: Vector3::from(t), r: rq, s: Vector3::from(s),
                t0: Vector3::from(t), r0: rq, visible: true, maillage: n.mesh().map(|m| m.index()), monde: Matrix4::identity() });
            let me = out.len() - 1;
            for c in n.children() { ajouter(c, Some(me), out); }
        }
        let sc = doc.default_scene().or_else(|| doc.scenes().next()).ok_or("scène vide")?;
        for n in sc.nodes() { ajouter(n, None, &mut noeuds); }
        let mut cameras = vec![];
        let mut rects: Option<([f32; 4], [f32; 4])> = None;
        if let Some(x) = sc.extras() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(x.get()) {
                for c in v["cameras"].as_array().into_iter().flatten() {
                    let m: Vec<f32> = c["matrice"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap() as f32).collect();
                    cameras.push(Camera { nom: c["nom"].as_str().unwrap_or("").into(), format: c["format"].as_str().unwrap_or("").into(),
                        matrice: Matrix4::from_column_slice(&m), fov: c["fov"].as_f64().unwrap_or(34.0) as f32,
                        near: c["near"].as_f64().unwrap_or(10.0) as f32, far: c["far"].as_f64().unwrap_or(12000.0) as f32 });
                }
                let r4 = |a: &serde_json::Value| -> Option<[f32; 4]> {
                    let a = a.as_array()?; if a.len() != 4 { return None; }
                    Some([0, 1, 2, 3].map(|i| a[i].as_f64().unwrap_or(0.0) as f32))
                };
                if let (Some(sc), Some(inf)) = (r4(&v["afficheurs"]["score"]), r4(&v["afficheurs"]["info"])) { rects = Some((sc, inf)); }
            }
        }
        let noms = noeuds.iter().enumerate().filter(|(_, n)| !n.nom.is_empty()).map(|(i, n)| (n.nom.clone(), i)).collect();
        let mat_noms = materiaux.iter().enumerate().filter(|(_, m)| !m.nom.is_empty()).map(|(i, m)| (m.nom.clone(), i)).collect();
        let (programme, u) = unsafe {
            let p = gl::CreateProgram();
            gl::AttachShader(p, shader(VS, gl::VERTEX_SHADER));
            gl::AttachShader(p, shader(FS, gl::FRAGMENT_SHADER));
            gl::LinkProgram(p);
            let mut u = HashMap::new();
            for k in ["M", "VP", "N", "tex", "etex", "couleur", "emission", "metal", "rugo", "intens", "oeil", "double_face", "unlit", "Ldir", "Lcol"] {
                let c = CString::new(k).unwrap();
                u.insert(k, gl::GetUniformLocation(p, c.as_ptr()));
            }
            (p, u)
        };
        let blanc = texture_rgba(1, 1, &[255, 255, 255, 255], 1.0);
        let bille = unsafe { sphere(13.5, 48, 32) };
        let afficheurs = rects.and_then(|(score, info)| {
            let m: &Materiau = materiaux.iter().find(|m| m.nom == "afficheurs")?;
            let t = m.tex?;
            let (w, h, px) = pixels.swap_remove(t);
            Some(Afficheurs { tex: textures[t].id, w, h, fond: px, score, info, texte: String::new() })
        });
        let mut s = Scene { textures, materiaux, maillages, noeuds, noms, mat_noms, cameras, programme, u, bille, blanc, afficheurs };
        s.mettre_a_jour();
        Ok(s)
    }

    pub fn noeud(&self, nom: &str) -> Option<usize> { self.noms.get(nom).copied() }
    pub fn mat(&mut self, nom: &str) -> Option<&mut Materiau> { self.mat_noms.get(nom).copied().map(move |i| &mut self.materiaux[i]) }

    pub fn mettre_a_jour(&mut self) {
        for i in 0..self.noeuds.len() {
            let n = &self.noeuds[i];
            let local = Matrix4::new_translation(&n.t) * n.r.to_homogeneous() * Matrix4::new_nonuniform_scaling(&n.s);
            let m = match n.parent { Some(p) => self.noeuds[p].monde * local, None => local };
            self.noeuds[i].monde = m;
        }
    }
    fn visible(&self, mut i: usize) -> bool {
        loop {
            if !self.noeuds[i].visible { return false; }
            match self.noeuds[i].parent { Some(p) => i = p, None => return true }
        }
    }

    /// dessine la scène ; billes : positions (x, y, z) en mm dans le repère de la table, et leur rotation
    pub fn dessiner(&self, cam: &Camera, aspect: f32, billes: &[(Vector3<f32>, UnitQuaternion<f32>)], table: Option<usize>) {
        let vue = cam.matrice.try_inverse().unwrap_or_else(Matrix4::identity);
        let proj = Matrix4::new_perspective(aspect, cam.fov.to_radians(), cam.near, cam.far);
        let vp = proj * vue;
        let oeil = cam.matrice.transform_point(&Point3::origin());
        // dessins : opaques d'abord, puis transparents du plus loin au plus près
        let mut opaques = vec![];
        let mut transp = vec![];
        for (i, n) in self.noeuds.iter().enumerate() {
            let Some(mi) = n.maillage else { continue };
            if !self.visible(i) { continue; }
            for p in &self.maillages[mi] {
                let m = &self.materiaux[p.mat];
                if m.transparent || m.couleur[3] < 0.999 {
                    let c = n.monde.transform_point(&Point3::origin());
                    transp.push(((c - oeil).norm(), i, p));
                } else { opaques.push((i, p)); }
            }
        }
        transp.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
        unsafe {
            gl::UseProgram(self.programme);
            gl::UniformMatrix4fv(self.u["VP"], 1, gl::FALSE, vp.as_ptr());
            gl::Uniform3f(self.u["oeil"], oeil.x, oeil.y, oeil.z);
            // lumières (repère du monde Three : y vers le haut, mm)
            let ldir: [f32; 9] = [0.15, -1.0, -0.35, -0.4, -0.5, -1.0, 0.6, -0.3, 0.2];
            let lcol: [f32; 9] = [1.05, 1.0, 0.92, 0.42, 0.42, 0.46, 0.22, 0.2, 0.25];
            gl::Uniform3fv(self.u["Ldir"], 3, ldir.as_ptr());
            gl::Uniform3fv(self.u["Lcol"], 3, lcol.as_ptr());
            gl::Uniform1i(self.u["tex"], 0);
            gl::Uniform1i(self.u["etex"], 1);
            gl::Enable(gl::DEPTH_TEST);
            gl::DepthMask(gl::TRUE);
            gl::Disable(gl::BLEND);
            for (i, p) in opaques { self.primitive(&self.noeuds[i].monde, p.vao, p.n, &self.materiaux[p.mat]); }
            // billes d'acier : repère de la table
            if let Some(t) = table {
                let acier = Materiau { nom: "acier".into(), couleur: [0.86, 0.87, 0.9, 1.0], tex: None, metal: 1.0, rugosite: 0.12,
                    emission: [0.0; 3], emission_tex: None, intensite: 0.0, transparent: false, double_face: false, sans_eclairage: false };
                for (p, q) in billes {
                    let m = self.noeuds[t].monde * Matrix4::new_translation(p) * q.to_homogeneous();
                    self.primitive(&m, self.bille.0, self.bille.1, &acier);
                }
            }
            gl::Enable(gl::BLEND);
            gl::BlendFunc(gl::SRC_ALPHA, gl::ONE_MINUS_SRC_ALPHA);
            gl::DepthMask(gl::FALSE);
            for (_, i, p) in transp { self.primitive(&self.noeuds[i].monde, p.vao, p.n, &self.materiaux[p.mat]); }
            gl::DepthMask(gl::TRUE);
            gl::Disable(gl::BLEND);
        }
    }

    unsafe fn primitive(&self, m: &Matrix4<f32>, vao: GLuint, n: i32, mat: &Materiau) {
        let n3: Matrix3<f32> = m.fixed_view::<3, 3>(0, 0).into_owned().try_inverse().unwrap_or_else(Matrix3::identity).transpose();
        gl::UniformMatrix4fv(self.u["M"], 1, gl::FALSE, m.as_ptr());
        gl::UniformMatrix3fv(self.u["N"], 1, gl::FALSE, n3.as_ptr());
        gl::Uniform4fv(self.u["couleur"], 1, mat.couleur.as_ptr());
        let e = mat.emission;
        gl::Uniform3f(self.u["emission"], e[0], e[1], e[2]);
        gl::Uniform1f(self.u["intens"], mat.intensite);
        gl::Uniform1f(self.u["metal"], mat.metal);
        gl::Uniform1f(self.u["rugo"], mat.rugosite);
        gl::Uniform1i(self.u["double_face"], mat.double_face as i32);
        gl::Uniform1i(self.u["unlit"], mat.sans_eclairage as i32);
        if mat.double_face { gl::Disable(gl::CULL_FACE); } else { gl::Enable(gl::CULL_FACE); }
        gl::ActiveTexture(gl::TEXTURE0);
        gl::BindTexture(gl::TEXTURE_2D, mat.tex.map_or(self.blanc, |t| self.textures[t].id));
        gl::ActiveTexture(gl::TEXTURE1);
        gl::BindTexture(gl::TEXTURE_2D, mat.emission_tex.map_or(self.blanc, |t| self.textures[t].id));
        gl::BindVertexArray(vao);
        gl::DrawElements(gl::TRIANGLES, n, gl::UNSIGNED_INT, std::ptr::null());
    }
}

unsafe fn sphere(r: f32, nlon: u32, nlat: u32) -> (GLuint, i32) {
    let (mut p, mut n, mut uv, mut idx) = (vec![], vec![], vec![], vec![]);
    for j in 0..=nlat {
        let th = std::f32::consts::PI * j as f32 / nlat as f32;
        for i in 0..=nlon {
            let ph = std::f32::consts::TAU * i as f32 / nlon as f32;
            let d = [th.sin() * ph.cos(), th.cos(), th.sin() * ph.sin()];
            p.push([d[0] * r, d[1] * r, d[2] * r]);
            n.push(d);
            uv.push([i as f32 / nlon as f32, j as f32 / nlat as f32]);
        }
    }
    for j in 0..nlat { for i in 0..nlon {
        let a = j * (nlon + 1) + i; let b = a + nlon + 1;
        idx.extend_from_slice(&[a, a + 1, b, a + 1, b + 1, b]);
    } }
    (vao(&p, &n, &uv, &idx), idx.len() as i32)
}

/// vecteur colonne utilitaire (évite un avertissement si non utilisé ailleurs)
#[allow(dead_code)]
pub fn v4(x: f32, y: f32, z: f32) -> Vector4<f32> { Vector4::new(x, y, z, 1.0) }
