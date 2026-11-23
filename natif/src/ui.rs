// Interface 2D par-dessus la scène : panneaux à coins arrondis (distance signée dans le shader), dégradés, texte.
// Les glyphes sont rastérisés à la demande par fontdue (polices libres OFL de donnees/polices) dans un atlas de
// 2048 × 2048 ; tout ce qui est dessiné dans une image part en un seul appel de dessin.

use gl::types::*;
use std::collections::HashMap;
use std::ffi::CString;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Police { Titre, Texte }

#[derive(Clone, Copy, PartialEq)]
pub enum Align { Gauche, Centre, Droite }

pub type Rgba = [f32; 4];

pub const fn rgba(r: u8, g: u8, b: u8, a: f32) -> Rgba { [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, a] }

#[derive(Clone, Copy)]
struct Glyphe { u0: f32, v0: f32, u1: f32, v1: f32, w: f32, h: f32, xmin: f32, ymin: f32, avance: f32 }

const ATLAS: i32 = 2048;

pub struct Ui {
    polices: HashMap<Police, fontdue::Font>,
    glyphes: HashMap<(Police, u32, char), Glyphe>,
    atlas: GLuint,
    rangee: (i32, i32, i32),       // curseur de l'atlas : x, y, hauteur de la rangée
    prog: GLuint,
    vao: GLuint,
    vbo: GLuint,
    u_ecran: GLint,
    sommets: Vec<f32>,
    pub w: f32,
    pub h: f32,
}

// sommet : position (px), uv, couleur, [genre, demi-largeur, demi-hauteur, rayon]
// genre 0 : rectangle arrondi (uv = position par rapport au centre, en px) ; 1 : glyphe (uv dans l'atlas)
const VS: &str = r#"#version 330 core
layout(location=0) in vec2 p; layout(location=1) in vec2 uv; layout(location=2) in vec4 c; layout(location=3) in vec4 e;
uniform vec2 ecran; out vec2 vuv; out vec4 vc; out vec4 ve;
void main(){ gl_Position = vec4(p.x / ecran.x * 2.0 - 1.0, 1.0 - p.y / ecran.y * 2.0, 0.0, 1.0); vuv = uv; vc = c; ve = e; }"#;
const FS: &str = r#"#version 330 core
in vec2 vuv; in vec4 vc; in vec4 ve; out vec4 frag; uniform sampler2D atlas;
void main(){
  float a;
  if (ve.x < 0.5) {
    vec2 q = abs(vuv) - ve.yz + ve.w;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - ve.w;
    a = clamp(0.5 - d, 0.0, 1.0);
  } else a = texture(atlas, vuv).r;
  frag = vec4(vc.rgb, vc.a * a);
}"#;

unsafe fn compiler(src: &str, kind: GLenum) -> GLuint {
    let s = gl::CreateShader(kind);
    let c = CString::new(src).unwrap();
    gl::ShaderSource(s, 1, &c.as_ptr(), std::ptr::null());
    gl::CompileShader(s);
    s
}

impl Ui {
    pub fn new(dossier: &std::path::Path) -> Result<Ui, String> {
        let charger = |f: &str| -> Result<fontdue::Font, String> {
            let b = std::fs::read(dossier.join(f)).map_err(|e| format!("{f} : {e}"))?;
            fontdue::Font::from_bytes(b, fontdue::FontSettings::default()).map_err(|e| e.to_string())
        };
        let mut polices = HashMap::new();
        polices.insert(Police::Titre, charger("Lobster-Regular.ttf")?);
        polices.insert(Police::Texte, charger("Baloo2.ttf")?);
        unsafe {
            let prog = gl::CreateProgram();
            gl::AttachShader(prog, compiler(VS, gl::VERTEX_SHADER));
            gl::AttachShader(prog, compiler(FS, gl::FRAGMENT_SHADER));
            gl::LinkProgram(prog);
            let c = CString::new("ecran").unwrap();
            let u_ecran = gl::GetUniformLocation(prog, c.as_ptr());
            let mut atlas = 0;
            gl::GenTextures(1, &mut atlas);
            gl::BindTexture(gl::TEXTURE_2D, atlas);
            gl::PixelStorei(gl::UNPACK_ALIGNMENT, 1);
            gl::TexImage2D(gl::TEXTURE_2D, 0, gl::R8 as i32, ATLAS, ATLAS, 0, gl::RED, gl::UNSIGNED_BYTE, std::ptr::null());
            gl::TexParameteri(gl::TEXTURE_2D, gl::TEXTURE_MIN_FILTER, gl::LINEAR as i32);
            gl::TexParameteri(gl::TEXTURE_2D, gl::TEXTURE_MAG_FILTER, gl::LINEAR as i32);
            gl::TexParameteri(gl::TEXTURE_2D, gl::TEXTURE_WRAP_S, gl::CLAMP_TO_EDGE as i32);
            gl::TexParameteri(gl::TEXTURE_2D, gl::TEXTURE_WRAP_T, gl::CLAMP_TO_EDGE as i32);
            let (mut vao, mut vbo) = (0, 0);
            gl::GenVertexArrays(1, &mut vao);
            gl::BindVertexArray(vao);
            gl::GenBuffers(1, &mut vbo);
            gl::BindBuffer(gl::ARRAY_BUFFER, vbo);
            let pas = 12 * 4;
            for (k, (n, off)) in [(2, 0), (2, 2), (4, 4), (4, 8)].iter().enumerate() {
                gl::EnableVertexAttribArray(k as u32);
                gl::VertexAttribPointer(k as u32, *n, gl::FLOAT, gl::FALSE, pas, (*off * 4) as *const _);
            }
            gl::BindVertexArray(0);
            Ok(Ui { polices, glyphes: HashMap::new(), atlas, rangee: (1, 1, 0), prog, vao, vbo, u_ecran, sommets: vec![], w: 1.0, h: 1.0 })
        }
    }

    pub fn debut(&mut self, w: u32, h: u32) { self.w = w as f32; self.h = h as f32; self.sommets.clear(); }

    fn quad(&mut self, x0: f32, y0: f32, x1: f32, y1: f32, uv: [f32; 4], haut: Rgba, bas: Rgba, e: [f32; 4]) {
        let s = &mut self.sommets;
        let mut v = |x: f32, y: f32, u: f32, w: f32, c: Rgba| s.extend_from_slice(&[x, y, u, w, c[0], c[1], c[2], c[3], e[0], e[1], e[2], e[3]]);
        v(x0, y0, uv[0], uv[1], haut); v(x1, y0, uv[2], uv[1], haut); v(x1, y1, uv[2], uv[3], bas);
        v(x0, y0, uv[0], uv[1], haut); v(x1, y1, uv[2], uv[3], bas); v(x0, y1, uv[0], uv[3], bas);
    }

    /// rectangle aux coins arrondis de rayon r, dégradé vertical de « haut » à « bas »
    pub fn panneau(&mut self, x: f32, y: f32, w: f32, h: f32, r: f32, haut: Rgba, bas: Rgba) {
        let (hw, hh) = (w / 2.0, h / 2.0);
        let m = 1.0;      // marge d'anticrénelage
        self.quad(x - m, y - m, x + w + m, y + h + m, [-hw - m, -hh - m, hw + m, hh + m], haut, bas, [0.0, hw, hh, r.min(hw).min(hh)]);
    }

    /// panneau avec ombre portée douce et liseré
    pub fn cadre(&mut self, x: f32, y: f32, w: f32, h: f32, r: f32, fond: Rgba, liseré: Rgba) {
        for k in 0..6 {
            let d = 4.0 + k as f32 * 3.0;
            self.panneau(x - d * 0.5 + 6.0, y - d * 0.5 + 10.0, w + d, h + d, r + d * 0.5, [0.0, 0.0, 0.0, 0.05], [0.0, 0.0, 0.0, 0.05]);
        }
        let ep = (self.h / 360.0).max(2.0);
        self.panneau(x - ep, y - ep, w + 2.0 * ep, h + 2.0 * ep, r + ep, liseré, liseré);
        let bas = [fond[0] * 0.8, fond[1] * 0.8, fond[2] * 0.8, fond[3]];
        self.panneau(x, y, w, h, r, fond, bas);
    }

    fn glyphe(&mut self, p: Police, taille: u32, c: char) -> Glyphe {
        if let Some(g) = self.glyphes.get(&(p, taille, c)) { return *g; }
        let (m, px) = self.polices[&p].rasterize(c, taille as f32);
        let (w, h) = (m.width as i32, m.height as i32);
        let (mut x, mut y, mut rh) = self.rangee;
        if x + w + 2 > ATLAS { x = 1; y += rh + 2; rh = 0; }
        if y + h + 2 > ATLAS {          // atlas plein : on recommence (les glyphes de l'image en cours sont redessinés)
            self.glyphes.clear();
            x = 1; y = 1; rh = 0;
        }
        if w > 0 && h > 0 {
            unsafe {
                gl::BindTexture(gl::TEXTURE_2D, self.atlas);
                gl::PixelStorei(gl::UNPACK_ALIGNMENT, 1);
                gl::TexSubImage2D(gl::TEXTURE_2D, 0, x, y, w, h, gl::RED, gl::UNSIGNED_BYTE, px.as_ptr() as *const _);
            }
        }
        let a = ATLAS as f32;
        let g = Glyphe { u0: x as f32 / a, v0: y as f32 / a, u1: (x + w) as f32 / a, v1: (y + h) as f32 / a, w: w as f32, h: h as f32,
            xmin: m.xmin as f32, ymin: m.ymin as f32, avance: m.advance_width };
        self.rangee = (x + w + 2, y, rh.max(h));
        self.glyphes.insert((p, taille, c), g);
        g
    }

    pub fn largeur(&mut self, p: Police, taille: f32, s: &str) -> f32 {
        let t = taille.round().max(6.0) as u32;
        s.chars().map(|c| self.glyphe(p, t, c).avance).sum()
    }

    /// texte dont la ligne de base est à y ; renvoie sa largeur
    pub fn texte(&mut self, p: Police, taille: f32, x: f32, y: f32, c: Rgba, align: Align, s: &str) -> f32 {
        let t = taille.round().max(6.0) as u32;
        let l = self.largeur(p, taille, s);
        let mut cx = match align { Align::Gauche => x, Align::Centre => x - l / 2.0, Align::Droite => x - l };
        for ch in s.chars() {
            let g = self.glyphe(p, t, ch);
            if g.w > 0.0 {
                let x0 = (cx + g.xmin).round();
                let y0 = (y - g.ymin - g.h).round();
                self.quad(x0, y0, x0 + g.w, y0 + g.h, [g.u0, g.v0, g.u1, g.v1], c, c, [1.0, 0.0, 0.0, 0.0]);
            }
            cx += g.avance;
        }
        l
    }

    /// texte avec ombre portée (lisible sur la scène 3D)
    pub fn texte_ombre(&mut self, p: Police, taille: f32, x: f32, y: f32, c: Rgba, align: Align, s: &str) -> f32 {
        let d = (taille / 18.0).max(1.5);
        self.texte(p, taille, x + d, y + d, [0.0, 0.0, 0.0, 0.55 * c[3]], align, s);
        self.texte(p, taille, x, y, c, align, s)
    }

    pub fn dessiner(&mut self) {
        if self.sommets.is_empty() { return; }
        unsafe {
            gl::Disable(gl::DEPTH_TEST);
            gl::Disable(gl::CULL_FACE);
            gl::Enable(gl::BLEND);
            gl::BlendFunc(gl::SRC_ALPHA, gl::ONE_MINUS_SRC_ALPHA);
            gl::UseProgram(self.prog);
            gl::Uniform2f(self.u_ecran, self.w, self.h);
            gl::ActiveTexture(gl::TEXTURE0);
            gl::BindTexture(gl::TEXTURE_2D, self.atlas);
            gl::BindVertexArray(self.vao);
            gl::BindBuffer(gl::ARRAY_BUFFER, self.vbo);
            gl::BufferData(gl::ARRAY_BUFFER, (self.sommets.len() * 4) as isize, self.sommets.as_ptr() as *const _, gl::STREAM_DRAW);
            gl::DrawArrays(gl::TRIANGLES, 0, (self.sommets.len() / 12) as i32);
            gl::BindVertexArray(0);
            gl::Disable(gl::BLEND);
            gl::Enable(gl::DEPTH_TEST);
        }
        self.sommets.clear();
    }
}
