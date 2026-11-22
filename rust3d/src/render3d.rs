//! Moteur de rendu 3D natif OpenGL 3.3 Core pour Fanny Pinball.
//! Charge directement les maillages CAO (`assets/cao/pieces.glb`, `assets/cao/caisse.glb`),
//! fusionnés par matériau pour un rendu ultra-fluide (60–144 FPS, < 35 appels de dessin/image).

use std::collections::HashMap;
use std::f32::consts::PI;
use std::ffi::c_void;
use std::path::Path;

use sdl2::image::LoadSurface;
use sdl2::pixels::PixelFormatEnum;
use sdl2::surface::Surface;

use crate::gl::{
    self, GLint, GLsizei, GLuint, Gl, BLEND, CLAMP_TO_EDGE, COLOR_BUFFER_BIT, DEPTH_BUFFER_BIT,
    DEPTH_TEST, FALSE, LINEAR, LINEAR_MIPMAP_LINEAR, MULTISAMPLE, ONE_MINUS_SRC_ALPHA, RGBA,
    RGBA8, SRC_ALPHA, TEXTURE0, TEXTURE_2D, TEXTURE_MAG_FILTER, TEXTURE_MIN_FILTER,
    TEXTURE_WRAP_S, TEXTURE_WRAP_T, TRUE, UNSIGNED_BYTE,
};
use crate::glb::{load_glb, CaisseExtras};
use crate::math3d::{Mat4, Vec3};
use crate::mesh::{build_flipper_meshes, build_ramp_3d, build_wireforms_3d, GpuMesh, MeshBuilder};
use crate::rules::Rules;
use crate::sim::Sim;
use crate::table::{TableGeo, BALL_R, CX, H, W};

const VERT_SRC: &str = r#"#version 330 core
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_nrm;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_mvp;
uniform mat4 u_model;

out vec3 v_world;
out vec3 v_nrm;
out vec2 v_uv;

void main() {
    vec4 wp = u_model * vec4(a_pos, 1.0);
    v_world = wp.xyz;
    v_nrm = normalize(mat3(transpose(inverse(u_model))) * a_nrm);
    v_uv = a_uv;
    gl_Position = u_mvp * vec4(a_pos, 1.0);
}
"#;

const FRAG_SRC: &str = r#"#version 330 core
in vec3 v_world;
in vec3 v_nrm;
in vec2 v_uv;

uniform vec3 u_cam;
uniform vec4 u_color;
uniform vec3 u_emissive;
uniform float u_metallic;
uniform float u_roughness;
uniform int u_use_tex;
uniform int u_unlit;
uniform sampler2D u_tex;

out vec4 frag_color;

vec3 env_room(vec3 r) {
    float h = clamp(r.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(vec3(0.18, 0.11, 0.07), vec3(0.42, 0.36, 0.30), h);
    // Reflets des néons/plafonniers et du fronton éclairé
    float ceil_band = smoothstep(0.68, 0.94, r.y) * smoothstep(0.55, 0.05, abs(r.x));
    float backbox_glow = smoothstep(0.45, 0.92, -r.z) * smoothstep(0.65, 0.0, abs(r.y - 0.25));
    float side_cool = smoothstep(0.62, 0.95, abs(r.x)) * smoothstep(0.55, 0.0, abs(r.y - 0.15));
    col += vec3(1.55, 1.45, 1.30) * ceil_band;
    col += vec3(0.95, 0.65, 0.32) * backbox_glow;
    col += vec3(0.30, 0.45, 0.65) * side_cool;
    return col;
}

void main() {
    vec4 base = u_color;
    if (u_use_tex != 0) {
        vec4 t = texture(u_tex, v_uv);
        base.rgb *= t.rgb;
        base.a *= t.a;
    }
    if (u_unlit != 0) {
        frag_color = vec4(base.rgb + u_emissive, base.a);
        return;
    }

    vec3 N = normalize(v_nrm);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(u_cam - v_world);

    vec3 L1 = normalize(vec3(-0.30, 0.88, 0.38));
    vec3 L2 = normalize(vec3(0.44, 0.52, 0.73));

    float ndl1 = max(dot(N, L1), 0.0);
    float ndl2 = max(dot(N, L2), 0.0);
    float hemi = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);

    vec3 ambient = mix(vec3(0.16, 0.10, 0.07), vec3(0.44, 0.41, 0.37), hemi);
    vec3 diffuse = (ambient + vec3(1.05, 0.99, 0.90) * ndl1 + vec3(0.24, 0.30, 0.40) * ndl2)
                   * base.rgb * (1.0 - u_metallic * 0.72);

    vec3 H1 = normalize(L1 + V);
    vec3 H2 = normalize(L2 + V);
    float shininess = mix(140.0, 10.0, clamp(u_roughness, 0.05, 1.0));
    float spec1 = pow(max(dot(N, H1), 0.0), shininess);
    float spec2 = pow(max(dot(N, H2), 0.0), shininess * 0.7);
    vec3 f0 = mix(vec3(0.05), base.rgb, u_metallic);
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    vec3 spec = (f0 + (vec3(1.0) - f0) * fresnel * 0.5)
                * (vec3(1.3, 1.25, 1.15) * spec1 + vec3(0.35, 0.45, 0.65) * spec2)
                * (1.15 - u_roughness * 0.75);

    vec3 R = reflect(-V, N);
    float env_k = (u_metallic * 0.85 + fresnel * 0.32) * (1.0 - u_roughness * 0.75);
    vec3 env = env_room(R) * mix(vec3(1.0), base.rgb, u_metallic) * env_k;

    vec3 final_col = diffuse + spec + env + u_emissive;
    // Tone-mapping doux (évite l'écrasement au blanc)
    final_col = final_col / (final_col + vec3(0.85)) * 1.48;
    frag_color = vec4(final_col, base.a);
}
"#;

#[derive(Debug, Clone, Copy)]
struct Material {
    color: [f32; 4],
    emissive: [f32; 3],
    metallic: f32,
    roughness: f32,
    tex: GLuint,
    unlit: bool,
}

impl Material {
    const fn solid(r: f32, g: f32, b: f32, metallic: f32, roughness: f32) -> Self {
        Self {
            color: [r, g, b, 1.0],
            emissive: [0.0, 0.0, 0.0],
            metallic,
            roughness,
            tex: 0,
            unlit: false,
        }
    }
}

struct Batch {
    mesh: GpuMesh,
    mat: Material,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CameraMode {
    Joueur,
    Haute,
    Tour,
    Lilliputien,
}

impl CameraMode {
    pub fn next(self) -> Self {
        match self {
            CameraMode::Joueur => CameraMode::Haute,
            CameraMode::Haute => CameraMode::Tour,
            CameraMode::Tour => CameraMode::Joueur,
            CameraMode::Lilliputien => CameraMode::Joueur,
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            CameraMode::Joueur => "Joueur",
            CameraMode::Haute => "Haute",
            CameraMode::Tour => "Tour",
            CameraMode::Lilliputien => "Lilliputien",
        }
    }
}

pub struct CameraState {
    pub mode: CameraMode,
    pub orbit_yaw: f32,
    pub orbit_pitch: f32,
    pub orbit_dist: f32,
    pub lilli_pos: Vec3, // repère table (x, y, hauteur positive)
    pub lilli_yaw: f32,
    pub lilli_pitch: f32,
}

impl Default for CameraState {
    fn default() -> Self {
        Self {
            mode: CameraMode::Joueur,
            orbit_yaw: 0.42,
            orbit_pitch: 0.36,
            orbit_dist: 2050.0,
            lilli_pos: Vec3::new(CX, H - 150.0, 42.0),
            lilli_yaw: 0.0,
            lilli_pitch: -0.10,
        }
    }
}

pub struct Renderer3D {
    gl: Gl,
    prog: GLuint,
    u_mvp: GLint,
    u_model: GLint,
    u_cam: GLint,
    u_color: GLint,
    u_emissive: GLint,
    u_metallic: GLint,
    u_roughness: GLint,
    u_use_tex: GLint,
    u_unlit: GLint,
    u_tex: GLint,

    caisse_extras: CaisseExtras,
    m_machine_from_table: Mat4,

    // Maillages statiques fusionnés
    playfield_mesh: GpuMesh,
    playfield_tex: GLuint,
    fronton_glass_mesh: GpuMesh,
    fronton_tex: GLuint,
    led_panel_mesh: GpuMesh,
    led_tex: GLuint,
    led_buf: Vec<u8>,
    last_disp: (String, String),
    floor_room_mesh: GpuMesh,
    escale_sign_mesh: GpuMesh,

    cao_table_batches: Vec<Batch>,
    cao_caisse_batches: Vec<Batch>,
    cao_plunger_batches: Vec<Batch>,
    wireforms_mesh: GpuMesh,
    ramp_mesh: GpuMesh,
    slings_body_mesh: GpuMesh,
    slings_rubber_mesh: GpuMesh,
    saucer_mesh: GpuMesh,

    // Maillages dynamiques
    ball_mesh: GpuMesh,
    shadow_disc_mesh: GpuMesh,
    flipper_l_body: GpuMesh,
    flipper_l_rub: GpuMesh,
    flipper_r_body: GpuMesh,
    flipper_r_rub: GpuMesh,
    bumper_base_mesh: GpuMesh,
    bumper_body_mesh: GpuMesh,
    bumper_ring_mesh: GpuMesh,
    bumper_cap_mesh: GpuMesh,
    drop_mesh: GpuMesh,
    standup_mesh: GpuMesh,
    left_target_mesh: GpuMesh,
    lamp_disc_mesh: GpuMesh,
    lamp_bezel_mesh: GpuMesh,
    rollover_wire_mesh: GpuMesh,
    spinner_frame_mesh: GpuMesh,
    spinner_blade_mesh: GpuMesh,
    fallback_plunger_mesh: GpuMesh,

    pub cam: CameraState,
}

impl Renderer3D {
    pub fn new(gl: Gl, geo: &TableGeo, assets_dir: &Path) -> Result<Self, String> {
        let prog = unsafe { gl.compile_program(VERT_SRC, FRAG_SRC)? };
        let (u_mvp, u_model, u_cam, u_color, u_emissive, u_metallic, u_roughness, u_use_tex, u_unlit, u_tex) = unsafe {
            (
                gl.uniform_loc(prog, "u_mvp"),
                gl.uniform_loc(prog, "u_model"),
                gl.uniform_loc(prog, "u_cam"),
                gl.uniform_loc(prog, "u_color"),
                gl.uniform_loc(prog, "u_emissive"),
                gl.uniform_loc(prog, "u_metallic"),
                gl.uniform_loc(prog, "u_roughness"),
                gl.uniform_loc(prog, "u_use_tex"),
                gl.uniform_loc(prog, "u_unlit"),
                gl.uniform_loc(prog, "u_tex"),
            )
        };

        unsafe {
            (gl.Enable)(DEPTH_TEST);
            (gl.Enable)(MULTISAMPLE);
            (gl.BlendFunc)(SRC_ALPHA, ONE_MINUS_SRC_ALPHA);
        }

        // Textures image (plateau, fronton)
        let playfield_tex = load_texture_file(&gl, &assets_dir.join("plateau.jpg")).unwrap_or(0);
        let fronton_tex = load_texture_file(&gl, &assets_dir.join("fronton.jpg")).unwrap_or(0);

        // Texture dynamique pour les afficheurs LED ambre du fronton (512 × 128)
        let led_buf = vec![0u8; 512 * 128 * 4];
        let led_tex = unsafe { create_rgba_texture(&gl, 512, 128, &led_buf, false) };

        // 1. Chargement CAO `pieces.glb` (fusion par catégorie)
        let mut cao_table_batches = Vec::new();
        if let Ok(scene) = load_glb(&assets_dir.join("cao/pieces.glb")) {
            let mut by_cat: HashMap<String, MeshBuilder> = HashMap::new();
            for node in &scene.nodes {
                if node.categorie == "guide" {
                    continue; // remplacé par les wireforms chromés
                }
                let mb = by_cat.entry(node.categorie.clone()).or_insert_with(MeshBuilder::new);
                mb.add_indexed_flat(&node.positions, &node.indices);
            }
            for (cat, mb) in by_cat {
                if mb.is_empty() {
                    continue;
                }
                let mat = match cat.as_str() {
                    "plastique" => Material::solid(0.24, 0.22, 0.48, 0.08, 0.35),
                    "tablier" => Material::solid(0.07, 0.07, 0.09, 0.12, 0.38),
                    "poteau" => Material::solid(0.95, 0.93, 0.89, 0.0, 0.42),
                    "cible" => Material::solid(0.16, 0.16, 0.20, 0.1, 0.50),
                    "face" => Material::solid(0.86, 0.24, 0.18, 0.05, 0.32),
                    "support" => Material::solid(0.84, 0.86, 0.90, 0.92, 0.24),
                    _ => Material::solid(0.75, 0.75, 0.78, 0.2, 0.45),
                };
                cao_table_batches.push(Batch {
                    mesh: unsafe { mb.upload(&gl) },
                    mat,
                });
            }
        }

        // 2. Chargement CAO `caisse.glb` (fusion par matériau + pièces mobiles du lanceur)
        let mut caisse_extras = CaisseExtras::default();
        let mut cao_caisse_batches = Vec::new();
        let mut cao_plunger_batches = Vec::new();
        if let Ok(scene) = load_glb(&assets_dir.join("cao/caisse.glb")) {
            if let Some(ex) = scene.caisse {
                caisse_extras = ex;
            }
            let mut static_by_cat: HashMap<String, MeshBuilder> = HashMap::new();
            let mut plunger_by_cat: HashMap<String, MeshBuilder> = HashMap::new();
            for node in &scene.nodes {
                let smooth = matches!(
                    node.categorie.as_str(),
                    "barre" | "baguette" | "lanceur" | "lanceur_tige" | "pommeau" | "embout"
                );
                let is_plunger = matches!(
                    node.categorie.as_str(),
                    "lanceur_tige" | "pommeau" | "embout"
                );
                let map = if is_plunger { &mut plunger_by_cat } else { &mut static_by_cat };
                let mb = map.entry(node.categorie.clone()).or_insert_with(MeshBuilder::new);
                if smooth {
                    mb.add_indexed_smooth(&node.positions, &node.indices);
                } else {
                    mb.add_indexed_flat(&node.positions, &node.indices);
                }
            }
            let caisse_mat = |cat: &str| -> Material {
                match cat {
                    "bois" => Material::solid(0.30, 0.18, 0.10, 0.02, 0.65),
                    "fronton_fond" => Material::solid(0.11, 0.07, 0.05, 0.0, 0.82),
                    "pied" => Material::solid(0.09, 0.09, 0.11, 0.15, 0.48),
                    "quincaillerie" | "charniere" => Material::solid(0.76, 0.78, 0.82, 0.88, 0.34),
                    "barre" => Material::solid(0.86, 0.88, 0.91, 0.95, 0.28),
                    "baguette" | "finition_chrome" | "lanceur" | "lanceur_tige" => {
                        Material::solid(0.88, 0.90, 0.93, 0.98, 0.18)
                    }
                    "pommeau" => Material::solid(0.05, 0.05, 0.06, 0.10, 0.22),
                    "embout" | "finition_noir" => Material::solid(0.10, 0.10, 0.12, 0.05, 0.72),
                    _ => Material::solid(0.45, 0.35, 0.28, 0.1, 0.55),
                }
            };
            for (cat, mb) in static_by_cat {
                if !mb.is_empty() {
                    let mat = caisse_mat(&cat);
                    cao_caisse_batches.push(Batch {
                        mesh: unsafe { mb.upload(&gl) },
                        mat,
                    });
                }
            }
            for (cat, mb) in plunger_by_cat {
                if !mb.is_empty() {
                    let mat = caisse_mat(&cat);
                    cao_plunger_batches.push(Batch {
                        mesh: unsafe { mb.upload(&gl) },
                        mat,
                    });
                }
            }
        }

        // Transformation table -> caisse (identique à js/render3d.js lignes 1368-1374)
        let vers_caisse = Mat4::translation(caisse_extras.pf_x, caisse_extras.pf_y, caisse_extras.pf_z)
            .mul(Mat4::rotation_x(caisse_extras.pf_pente_deg.to_radians()))
            .mul(Mat4::rotation_x(PI))
            .mul(Mat4::translation(0.0, -H, 0.0));
        let m_machine_from_table = vers_caisse.inverse_rigid();

        // 3. Plan du plateau (`assets/plateau.jpg`)
        let mut pf_mb = MeshBuilder::new();
        pf_mb.add_quad(
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(0.0, H, 0.0),
            Vec3::new(W, H, 0.0),
            Vec3::new(W, 0.0, 0.0),
            [0.0, 0.0],
            [0.0, 1.0],
            [1.0, 1.0],
            [1.0, 0.0],
        );
        let playfield_mesh = unsafe { pf_mb.upload(&gl) };

        // 4. Vitre du fronton + panneau LED (repère caisse, identique à js/render3d.js 1451-1486)
        let (fronton_glass_mesh, led_panel_mesh) = build_fronton_panels(&gl, &caisse_extras);

        // 5. Sol de la salle sous la machine (repère caisse)
        let mut floor_mb = MeshBuilder::new();
        let fz = -caisse_extras.h_sol;
        let fcx = caisse_extras.cs_largeur * 0.5;
        let fcy = caisse_extras.cs_longueur * 0.5;
        floor_mb.add_quad(
            Vec3::new(fcx - 3000.0, fcy - 3000.0, fz),
            Vec3::new(fcx + 3000.0, fcy - 3000.0, fz),
            Vec3::new(fcx + 3000.0, fcy + 3000.0, fz),
            Vec3::new(fcx - 3000.0, fcy + 3000.0, fz),
            [0.0, 0.0],
            [1.0, 0.0],
            [1.0, 1.0],
            [0.0, 1.0],
        );
        let floor_room_mesh = unsafe { floor_mb.upload(&gl) };

        // 6. Enseigne ESCALE inclinée au-dessus de l'entrée de rampe
        let mut esc_mb = MeshBuilder::new();
        let ep = geo.enseigne_pts;
        let z_front = -56.0_f32;
        let z_back = -69.0_f32;
        esc_mb.add_quad(
            Vec3::new(ep[0].x, ep[0].y, z_front),
            Vec3::new(ep[1].x, ep[1].y, z_front),
            Vec3::new(ep[2].x, ep[2].y, z_back),
            Vec3::new(ep[3].x, ep[3].y, z_back),
            [0.0, 0.0],
            [1.0, 0.0],
            [1.0, 1.0],
            [0.0, 1.0],
        );
        let escale_sign_mesh = unsafe { esc_mb.upload(&gl) };

        // 7. Wireforms chromés + Rampe PVC 3D + Slingshots + Le Cercle
        let wireforms_mesh = build_wireforms_3d(&gl, geo);
        let ramp_mesh = build_ramp_3d(&gl, geo);

        let mut sl_body = MeshBuilder::new();
        let mut sl_rub = MeshBuilder::new();
        for sl in &geo.slings {
            sl_body.add_extruded_poly(&sl.posts, 28.0, 32.0);
            for p in sl.posts {
                sl_body.add_cyl_table(p.x, p.y, 0.0, 30.0, 4.5, 4.5, 12);
            }
            let rpts: Vec<Vec3> = sl.poly.iter().map(|p| Vec3::new(p.x, p.y, -BALL_R)).collect();
            sl_rub.add_tube(&rpts, 3.0, 8, true);
        }
        let slings_body_mesh = unsafe { sl_body.upload(&gl) };
        let slings_rubber_mesh = unsafe { sl_rub.upload(&gl) };

        let mut sc_mb = MeshBuilder::new();
        sc_mb.add_cyl_table(geo.saucer.pos.x, geo.saucer.pos.y, 0.0, 1.8, geo.saucer.ring, geo.saucer.ring - 2.0, 24);
        let saucer_mesh = unsafe { sc_mb.upload(&gl) };

        // 8. Primitives dynamiques (bille, ombre, batteurs, bumpers, cibles, inserts, rollovers, tourniquet)
        let mut ball_mb = MeshBuilder::new();
        ball_mb.add_sphere(BALL_R, 16, 24);
        let ball_mesh = unsafe { ball_mb.upload(&gl) };

        let mut sh_mb = MeshBuilder::new();
        sh_mb.add_cyl_table(0.0, 0.0, 0.0, 0.5, BALL_R * 0.92, BALL_R * 0.92, 18);
        let shadow_disc_mesh = unsafe { sh_mb.upload(&gl) };

        let (flipper_l_body, flipper_l_rub) = build_flipper_meshes(&gl, geo.flippers[0]);
        let (flipper_r_body, flipper_r_rub) = build_flipper_meshes(&gl, geo.flippers[1]);

        let mut bb_mb = MeshBuilder::new();
        bb_mb.add_cyl_table(0.0, 0.0, 0.0, 2.2, 30.0, 29.0, 24); // wafer
        bb_mb.add_cyl_table(0.0, 0.0, 2.2, 8.0, 28.0, 19.5, 24); // jupe conique
        let bumper_base_mesh = unsafe { bb_mb.upload(&gl) };

        let mut bbody_mb = MeshBuilder::new();
        bbody_mb.add_cyl_table(0.0, 0.0, 8.0, 31.0, 19.0, 25.0, 20); // corps translucide
        let bumper_body_mesh = unsafe { bbody_mb.upload(&gl) };

        let mut bring_mb = MeshBuilder::new();
        bring_mb.add_cyl_table(0.0, 0.0, 16.0, 22.0, 28.5, 27.5, 24); // anneau frappeur chrome
        let bumper_ring_mesh = unsafe { bring_mb.upload(&gl) };

        let mut bcap_mb = MeshBuilder::new();
        bcap_mb.add_cyl_table(0.0, 0.0, 31.0, 36.5, 34.0, 31.5, 24);
        bcap_mb.add_cyl_table(0.0, 0.0, 36.5, 39.5, 31.5, 18.0, 24);
        let bumper_cap_mesh = unsafe { bcap_mb.upload(&gl) };

        let mut drop_mb = MeshBuilder::new();
        drop_mb.add_box(0.0, 0.0, -16.5, 22.5, 7.5, 33.0);
        let drop_mesh = unsafe { drop_mb.upload(&gl) };

        let mut st_mb = MeshBuilder::new();
        st_mb.add_cyl_table(0.0, 0.0, 0.0, 26.0, 10.5, 10.5, 18);
        let standup_mesh = unsafe { st_mb.upload(&gl) };

        let mut lt_mb = MeshBuilder::new();
        lt_mb.add_box(0.0, 0.0, -14.0, 7.0, 34.0, 28.0);
        let left_target_mesh = unsafe { lt_mb.upload(&gl) };

        let mut lamp_d = MeshBuilder::new();
        lamp_d.add_cyl_table(0.0, 0.0, 0.0, 0.7, 1.0, 1.0, 20);
        let lamp_disc_mesh = unsafe { lamp_d.upload(&gl) };

        let mut lamp_b = MeshBuilder::new();
        lamp_b.add_cyl_table(0.0, 0.0, 0.0, 0.45, 1.12, 1.12, 20);
        let lamp_bezel_mesh = unsafe { lamp_b.upload(&gl) };

        let mut ro_mb = MeshBuilder::new();
        ro_mb.add_tube(&[Vec3::new(0.0, -14.0, -1.0), Vec3::new(0.0, 0.0, -7.0), Vec3::new(0.0, 14.0, -1.0)], 1.0, 6, false);
        let rollover_wire_mesh = unsafe { ro_mb.upload(&gl) };

        // Tourniquet (étrier fixe + palette tournante autour de son axe à z = -33.5)
        let mut sp_fr = MeshBuilder::new();
        sp_fr.add_tube(
            &[
                Vec3::new(-24.5, 0.0, 0.0),
                Vec3::new(-24.5, 0.0, -33.5),
                Vec3::new(24.5, 0.0, -33.5),
                Vec3::new(24.5, 0.0, 0.0),
            ],
            1.6,
            8,
            false,
        );
        let spinner_frame_mesh = unsafe { sp_fr.upload(&gl) };

        let mut sp_bl = MeshBuilder::new();
        sp_bl.add_box(0.0, 0.0, 0.0, 30.0, 1.6, 44.0);
        let spinner_blade_mesh = unsafe { sp_bl.upload(&gl) };

        let mut fb_pl = MeshBuilder::new();
        fb_pl.add_cyl_table(0.0, 0.0, 0.0, 18.0, 8.0, 8.0, 14);
        let fallback_plunger_mesh = unsafe { fb_pl.upload(&gl) };

        Ok(Self {
            gl,
            prog,
            u_mvp,
            u_model,
            u_cam,
            u_color,
            u_emissive,
            u_metallic,
            u_roughness,
            u_use_tex,
            u_unlit,
            u_tex,
            caisse_extras,
            m_machine_from_table,
            playfield_mesh,
            playfield_tex,
            fronton_glass_mesh,
            fronton_tex,
            led_panel_mesh,
            led_tex,
            led_buf,
            last_disp: (String::new(), String::new()),
            floor_room_mesh,
            escale_sign_mesh,
            cao_table_batches,
            cao_caisse_batches,
            cao_plunger_batches,
            wireforms_mesh,
            ramp_mesh,
            slings_body_mesh,
            slings_rubber_mesh,
            saucer_mesh,
            ball_mesh,
            shadow_disc_mesh,
            flipper_l_body,
            flipper_l_rub,
            flipper_r_body,
            flipper_r_rub,
            bumper_base_mesh,
            bumper_body_mesh,
            bumper_ring_mesh,
            bumper_cap_mesh,
            drop_mesh,
            standup_mesh,
            left_target_mesh,
            lamp_disc_mesh,
            lamp_bezel_mesh,
            rollover_wire_mesh,
            spinner_frame_mesh,
            spinner_blade_mesh,
            fallback_plunger_mesh,
            cam: CameraState::default(),
        })
    }

    pub fn update_lilliputien(&mut self, dt_s: f32, fwd: f32, right: f32, up: f32, sprint: bool) {
        if self.cam.mode != CameraMode::Lilliputien {
            return;
        }
        let spd = if sprint { 420.0 } else { 190.0 };
        let (sy, cy) = self.cam.lilli_yaw.sin_cos();
        // yaw = 0 regarde vers le haut du plateau (-Y table)
        let fx = sy;
        let fy = -cy;
        let rx = cy;
        let ry = sy;
        self.cam.lilli_pos.x = (self.cam.lilli_pos.x + (fx * fwd + rx * right) * spd * dt_s).clamp(-140.0, W + 140.0);
        self.cam.lilli_pos.y = (self.cam.lilli_pos.y + (fy * fwd + ry * right) * spd * dt_s).clamp(-140.0, H + 180.0);
        self.cam.lilli_pos.z = (self.cam.lilli_pos.z + up * spd * 0.7 * dt_s).clamp(4.0, 260.0);
    }

    pub fn mouse_drag(&mut self, dx: f32, dy: f32) {
        match self.cam.mode {
            CameraMode::Tour => {
                self.cam.orbit_yaw -= dx * 0.006;
                self.cam.orbit_pitch = (self.cam.orbit_pitch + dy * 0.005).clamp(0.08, 1.25);
            }
            CameraMode::Lilliputien => {
                self.cam.lilli_yaw += dx * 0.0045;
                self.cam.lilli_pitch = (self.cam.lilli_pitch - dy * 0.0045).clamp(-1.35, 1.35);
            }
            _ => {}
        }
    }

    pub fn mouse_wheel(&mut self, delta_y: f32) {
        match self.cam.mode {
            CameraMode::Tour => {
                self.cam.orbit_dist = (self.cam.orbit_dist - delta_y * 120.0).clamp(900.0, 3600.0);
            }
            CameraMode::Lilliputien => {
                self.update_lilliputien(0.08, delta_y * 1.5, 0.0, 0.0, false);
            }
            _ => {}
        }
    }

    unsafe fn draw_mesh(&self, mesh: &GpuMesh, vp: Mat4, model: Mat4, mat: Material) {
        let mvp = vp.mul(model);
        (self.gl.UniformMatrix4fv)(self.u_mvp, 1, FALSE, mvp.m.as_ptr());
        (self.gl.UniformMatrix4fv)(self.u_model, 1, FALSE, model.m.as_ptr());
        (self.gl.Uniform4f)(self.u_color, mat.color[0], mat.color[1], mat.color[2], mat.color[3]);
        (self.gl.Uniform3f)(self.u_emissive, mat.emissive[0], mat.emissive[1], mat.emissive[2]);
        (self.gl.Uniform1f)(self.u_metallic, mat.metallic);
        (self.gl.Uniform1f)(self.u_roughness, mat.roughness);
        (self.gl.Uniform1i)(self.u_unlit, if mat.unlit { 1 } else { 0 });
        if mat.tex != 0 {
            (self.gl.ActiveTexture)(TEXTURE0);
            (self.gl.BindTexture)(TEXTURE_2D, mat.tex);
            (self.gl.Uniform1i)(self.u_use_tex, 1);
            (self.gl.Uniform1i)(self.u_tex, 0);
        } else {
            (self.gl.Uniform1i)(self.u_use_tex, 0);
        }
        mesh.draw(&self.gl);
    }

    pub fn render(&mut self, win_w: u32, win_h: u32, sim: &Sim, rules: &Rules, rot_deg: i32) {
        let now_ms = rules.now_ms;
        let disp = rules.display();
        if disp != self.last_disp {
            paint_led_display(&mut self.led_buf, 512, 128, &disp.0, &disp.1);
            unsafe {
                (self.gl.BindTexture)(TEXTURE_2D, self.led_tex);
                (self.gl.TexSubImage2D)(
                    TEXTURE_2D,
                    0,
                    0,
                    0,
                    512,
                    128,
                    RGBA,
                    UNSIGNED_BYTE,
                    self.led_buf.as_ptr() as *const c_void,
                );
            }
            self.last_disp = disp;
        }

        // Secousse visuelle du bourrage
        let mut shake = Vec3::new(0.0, 0.0, 0.0);
        let sh_el = sim.time_ms.saturating_sub(sim.shake_at_ms);
        if sh_el < 140 {
            let k = 1.0 - (sh_el as f32 / 140.0);
            if sim.shake_dx != 0 {
                shake.x = -(sim.shake_dx as f32) * 8.0 * k;
            } else {
                shake.z = -7.0 * k;
            }
        }

        // Repère monde de la table inclinée
        let slope_rad = sim.slope_deg.to_radians();
        let m_tilt = Mat4::translation(shake.x, shake.y, shake.z).mul(Mat4::rotation_x(slope_rad));
        let m_table = m_tilt
            .mul(Mat4::translation(-W * 0.5, 0.0, -H * 0.5))
            .mul(Mat4::rotation_x(PI * 0.5));
        let m_machine = m_table.mul(self.m_machine_from_table);

        // Caméra + projection avec rotation matérielle 0° / +90° / -90°
        let rotated = rot_deg == 90 || rot_deg == -90;
        let aspect = if rotated {
            (win_h as f32) / (win_w as f32).max(1.0)
        } else {
            (win_w as f32) / (win_h as f32).max(1.0)
        };
        let (eye, target, fov_deg, near) = self.compute_camera(m_table, aspect);
        let proj = Mat4::rotation_z(-(rot_deg as f32).to_radians()).mul(Mat4::perspective(
            fov_deg.to_radians(),
            aspect,
            near,
            12_000.0,
        ));
        let view = Mat4::look_at(eye, target, Vec3::new(0.0, 1.0, 0.0));
        let vp = proj.mul(view);

        let lamps = rules.lamps();
        let blink_on = (now_ms / 180) % 2 == 0;

        unsafe {
            (self.gl.Viewport)(0, 0, win_w as GLsizei, win_h as GLsizei);
            (self.gl.ClearColor)(0.09, 0.05, 0.03, 1.0);
            (self.gl.Clear)(COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT);
            (self.gl.UseProgram)(self.prog);
            (self.gl.Uniform3f)(self.u_cam, eye.x, eye.y, eye.z);
            (self.gl.Disable)(BLEND);
            (self.gl.DepthMask)(TRUE);

            // 1. Sol de la salle + caisse WPC CAO + lanceur coulissant
            self.draw_mesh(
                &self.floor_room_mesh,
                vp,
                m_machine,
                Material::solid(0.15, 0.10, 0.07, 0.0, 0.88),
            );
            for b in &self.cao_caisse_batches {
                self.draw_mesh(&b.mesh, vp, m_machine, b.mat);
            }
            let pull_mm = sim.tirage * 50.0;
            let axe = self.caisse_extras.lanceur_axe;
            let m_plunger_caisse = m_machine.mul(Mat4::translation(
                axe[0] * pull_mm,
                axe[1] * pull_mm,
                axe[2] * pull_mm,
            ));
            for b in &self.cao_plunger_batches {
                self.draw_mesh(&b.mesh, vp, m_plunger_caisse, b.mat);
            }
            if self.cao_plunger_batches.is_empty() {
                let m_fb = m_table.mul(Mat4::translation(
                    sim.geo.plunger_x,
                    sim.geo.plunger_top + pull_mm,
                    0.0,
                ));
                self.draw_mesh(&self.fallback_plunger_mesh, vp, m_fb, Material::solid(0.82, 0.85, 0.90, 0.9, 0.25));
            }

            // 2. Vitre rétroéclairée du fronton + afficheurs LED ambre
            self.draw_mesh(
                &self.fronton_glass_mesh,
                vp,
                m_machine,
                Material {
                    color: [1.0, 1.0, 1.0, 1.0],
                    emissive: [0.0, 0.0, 0.0],
                    metallic: 0.0,
                    roughness: 0.4,
                    tex: self.fronton_tex,
                    unlit: true,
                },
            );
            self.draw_mesh(
                &self.led_panel_mesh,
                vp,
                m_machine,
                Material {
                    color: [1.0, 1.0, 1.0, 1.0],
                    emissive: [0.0, 0.0, 0.0],
                    metallic: 0.0,
                    roughness: 0.3,
                    tex: self.led_tex,
                    unlit: true,
                },
            );

            // 3. Plateau 3D (`assets/plateau.jpg`)
            self.draw_mesh(
                &self.playfield_mesh,
                vp,
                m_table,
                Material {
                    color: if self.playfield_tex != 0 {
                        [1.0, 1.0, 1.0, 1.0]
                    } else {
                        [0.85, 0.72, 0.48, 1.0]
                    },
                    emissive: [0.0, 0.0, 0.0],
                    metallic: 0.04,
                    roughness: 0.28,
                    tex: self.playfield_tex,
                    unlit: false,
                },
            );

            // 4. 32 inserts lumineux encastrés dans le plateau
            for (i, lamp) in sim.geo.lamps.iter().enumerate() {
                let st = lamps[i];
                let lit = st == 1 || (st == 2 && blink_on);
                let m_lamp = m_table
                    .mul(Mat4::translation(lamp.pos.x, lamp.pos.y, 0.0))
                    .mul(Mat4::scale(lamp.r, lamp.r, 1.0));
                self.draw_mesh(&self.lamp_bezel_mesh, vp, m_lamp, Material::solid(0.08, 0.06, 0.05, 0.0, 0.7));
                let r = lamp.rgb.0 as f32 / 255.0;
                let g = lamp.rgb.1 as f32 / 255.0;
                let b = lamp.rgb.2 as f32 / 255.0;
                let mat = if lit {
                    Material {
                        color: [r, g, b, 1.0],
                        emissive: [r * 0.95, g * 0.95, b * 0.95],
                        metallic: 0.0,
                        roughness: 0.18,
                        tex: 0,
                        unlit: false,
                    }
                } else {
                    Material::solid(r * 0.48, g * 0.48, b * 0.48, 0.0, 0.30)
                };
                self.draw_mesh(&self.lamp_disc_mesh, vp, m_lamp, mat);
            }

            // 5. Pièces CAO statiques + wireforms chromés + slingshots + Cercle + enseigne ESCALE
            for b in &self.cao_table_batches {
                self.draw_mesh(&b.mesh, vp, m_table, b.mat);
            }
            let chrome = Material::solid(0.88, 0.91, 0.95, 0.98, 0.14);
            self.draw_mesh(&self.wireforms_mesh, vp, m_table, chrome);
            self.draw_mesh(&self.slings_body_mesh, vp, m_table, Material::solid(0.18, 0.28, 0.56, 0.08, 0.35));
            let sling_lit = now_ms.saturating_sub(sim.flash.sling[0]) < 120
                || now_ms.saturating_sub(sim.flash.sling[1]) < 120;
            self.draw_mesh(
                &self.slings_rubber_mesh,
                vp,
                m_table,
                Material {
                    color: [0.95, 0.93, 0.88, 1.0],
                    emissive: if sling_lit { [0.6, 0.45, 0.15] } else { [0.0, 0.0, 0.0] },
                    metallic: 0.0,
                    roughness: 0.65,
                    tex: 0,
                    unlit: false,
                },
            );
            self.draw_mesh(&self.saucer_mesh, vp, m_table, Material::solid(0.75, 0.78, 0.82, 0.85, 0.25));
            self.draw_mesh(
                &self.escale_sign_mesh,
                vp,
                m_table,
                Material {
                    color: [0.14, 0.22, 0.52, 1.0],
                    emissive: [0.12, 0.16, 0.30],
                    metallic: 0.1,
                    roughness: 0.3,
                    tex: 0,
                    unlit: false,
                },
            );

            // 6. 10 fils de rollover animés (4 haut + 6 bas)
            for (i, lane) in sim.geo.lanes.iter().enumerate() {
                let dz = if sim.rollover_down[i] { 5.0 } else { 0.0 };
                let m = m_table.mul(Mat4::translation(lane.pos.x, lane.pos.y, dz));
                self.draw_mesh(&self.rollover_wire_mesh, vp, m, chrome);
            }
            for (i, lane) in sim.geo.lower_lanes.iter().enumerate() {
                let dz = if sim.rollover_down[4 + i] { 5.0 } else { 0.0 };
                let m = m_table.mul(Mat4::translation(lane.pos.x, lane.pos.y, dz));
                self.draw_mesh(&self.rollover_wire_mesh, vp, m, chrome);
            }

            // 7. 3 Pop Bumpers 3D complets (anneau frappeur animé + flash lumineux)
            for (i, bmp) in sim.geo.bumpers.iter().enumerate() {
                let el = now_ms.saturating_sub(sim.flash.bumper[i]);
                let hit = el < 130;
                let k = if hit { 1.0 - (el as f32 / 130.0) } else { 0.0 };
                let m_b = m_table.mul(Mat4::translation(bmp.pos.x, bmp.pos.y, 0.0));
                self.draw_mesh(&self.bumper_base_mesh, vp, m_b, Material::solid(0.14, 0.14, 0.16, 0.1, 0.5));
                self.draw_mesh(
                    &self.bumper_body_mesh,
                    vp,
                    m_b,
                    Material {
                        color: [0.98, 0.80, 0.32, 1.0],
                        emissive: [0.22 + 0.85 * k, 0.16 + 0.65 * k, 0.04 + 0.25 * k],
                        metallic: 0.0,
                        roughness: 0.25,
                        tex: 0,
                        unlit: false,
                    },
                );
                let m_ring = m_b.mul(Mat4::translation(0.0, 0.0, 9.5 * k));
                self.draw_mesh(&self.bumper_ring_mesh, vp, m_ring, chrome);
                self.draw_mesh(
                    &self.bumper_cap_mesh,
                    vp,
                    m_b,
                    Material {
                        color: [0.80, 0.19, 0.15, 1.0],
                        emissive: [0.30 * k, 0.12 * k, 0.04 * k],
                        metallic: 0.05,
                        roughness: 0.22,
                        tex: 0,
                        unlit: false,
                    },
                );
            }

            // 8. Cibles tombantes F-A-N-N-Y + cibles fixes + mur gauche
            for (i, d) in sim.geo.drops.iter().enumerate() {
                let z_off = if sim.drops_up[i] { 0.0 } else { 31.0 };
                let m_d = m_table
                    .mul(Mat4::translation(d.pos.x, d.pos.y, z_off))
                    .mul(Mat4::rotation_z(d.angle));
                let hit = now_ms.saturating_sub(sim.flash.drop[i]) < 150;
                self.draw_mesh(
                    &self.drop_mesh,
                    vp,
                    m_d,
                    Material {
                        color: [0.98, 0.80, 0.22, 1.0],
                        emissive: if hit { [0.5, 0.35, 0.05] } else { [0.0, 0.0, 0.0] },
                        metallic: 0.05,
                        roughness: 0.32,
                        tex: 0,
                        unlit: false,
                    },
                );
            }
            for (i, st) in sim.geo.standups.iter().enumerate() {
                let hit = now_ms.saturating_sub(sim.flash.standup[i]) < 150;
                let m_s = m_table.mul(Mat4::translation(st.pos.x, st.pos.y, 0.0));
                self.draw_mesh(
                    &self.standup_mesh,
                    vp,
                    m_s,
                    Material {
                        color: [0.90, 0.28, 0.20, 1.0],
                        emissive: if hit { [0.8, 0.5, 0.1] } else { [0.0, 0.0, 0.0] },
                        metallic: 0.05,
                        roughness: 0.28,
                        tex: 0,
                        unlit: false,
                    },
                );
            }
            for (i, lt) in sim.geo.left_targets.iter().enumerate() {
                let lit = now_ms.saturating_sub(sim.flash.target[i]) < 150 || rules.targets[i];
                let m_lt = m_table.mul(Mat4::translation(lt.pos.x, lt.pos.y, 0.0));
                self.draw_mesh(
                    &self.left_target_mesh,
                    vp,
                    m_lt,
                    Material {
                        color: [0.92, 0.25, 0.56, 1.0],
                        emissive: if lit { [0.55, 0.12, 0.32] } else { [0.0, 0.0, 0.0] },
                        metallic: 0.05,
                        roughness: 0.3,
                        tex: 0,
                        unlit: false,
                    },
                );
            }

            // 9. Tourniquet (spinner) 3D rotatif à 360°
            let sp = sim.geo.spinner;
            let sp_ang_z = sp.v.y.atan2(sp.v.x);
            let m_sp = m_table
                .mul(Mat4::translation(sp.pos.x, sp.pos.y, 0.0))
                .mul(Mat4::rotation_z(sp_ang_z));
            self.draw_mesh(&self.spinner_frame_mesh, vp, m_sp, chrome);
            let sp_hit = now_ms.saturating_sub(sim.flash.spinner) < 120;
            let m_blade = m_sp
                .mul(Mat4::translation(0.0, 0.0, -33.5))
                .mul(Mat4::rotation_x(sim.spinner_angle));
            self.draw_mesh(
                &self.spinner_blade_mesh,
                vp,
                m_blade,
                Material {
                    color: [0.92, 0.72, 0.30, 1.0],
                    emissive: if sp_hit { [0.45, 0.35, 0.10] } else { [0.0, 0.0, 0.0] },
                    metallic: 0.65,
                    roughness: 0.22,
                    tex: 0,
                    unlit: false,
                },
            );

            // 10. Batteurs 3D (corps crème + caoutchouc rouge)
            let mat_flip_body = Material::solid(0.98, 0.96, 0.91, 0.02, 0.32);
            let mat_flip_rub = Material::solid(0.84, 0.18, 0.14, 0.0, 0.52);
            for fi in 0..2 {
                let def = sim.geo.flippers[fi];
                let m_f = m_table
                    .mul(Mat4::translation(def.pivot.x, def.pivot.y, 0.0))
                    .mul(Mat4::rotation_z(sim.flippers[fi].angle));
                let (mb, mr) = if fi == 0 {
                    (&self.flipper_l_body, &self.flipper_l_rub)
                } else {
                    (&self.flipper_r_body, &self.flipper_r_rub)
                };
                self.draw_mesh(mb, vp, m_f, mat_flip_body);
                self.draw_mesh(mr, vp, m_f, mat_flip_rub);
            }

            // 11. Billes acier chromé miroir
            let steel = Material::solid(0.96, 0.98, 1.0, 1.0, 0.07);
            for b in &sim.balls {
                let m_ball = m_table.mul(Mat4::translation(b.pos.x, b.pos.y, -(b.z + BALL_R)));
                self.draw_mesh(&self.ball_mesh, vp, m_ball, steel);
            }

            // 12. Passe transparente (ombres douces des billes + rampe PVC translucide)
            (self.gl.Enable)(BLEND);
            (self.gl.DepthMask)(FALSE);
            let sh_mat = Material {
                color: [0.0, 0.0, 0.0, 0.42],
                emissive: [0.0, 0.0, 0.0],
                metallic: 0.0,
                roughness: 1.0,
                tex: 0,
                unlit: true,
            };
            for b in &sim.balls {
                let m_sh = m_table.mul(Mat4::translation(b.pos.x + 3.0, b.pos.y + 4.0, -b.z - 0.6));
                self.draw_mesh(&self.shadow_disc_mesh, vp, m_sh, sh_mat);
            }
            self.draw_mesh(
                &self.ramp_mesh,
                vp,
                m_table,
                Material {
                    color: [0.76, 0.90, 0.98, 0.34],
                    emissive: [0.02, 0.04, 0.06],
                    metallic: 0.15,
                    roughness: 0.12,
                    tex: 0,
                    unlit: false,
                },
            );
            (self.gl.DepthMask)(TRUE);
            (self.gl.Disable)(BLEND);
        }
    }

    fn compute_camera(&self, m_table: Mat4, aspect: f32) -> (Vec3, Vec3, f32, f32) {
        match self.cam.mode {
            CameraMode::Joueur => {
                // Vue joueur : afficheurs de score visibles en haut, plateau complet au centre, pommeau du lanceur en bas à droite
                let fov = 36.0_f32;
                let elev = 32.0_f32.to_radians();
                let target = Vec3::new(0.0, 65.0, 20.0);
                // Distance adaptée automatiquement à l'aspect (écran vertical ou paysage)
                let dist = if aspect < 0.75 { 1880.0 / aspect.max(0.45) * 0.62 } else { 1960.0 };
                let eye = Vec3::new(
                    0.0,
                    target.y + dist * elev.sin(),
                    target.z + dist * elev.cos(),
                );
                (eye, target, fov, 20.0)
            }
            CameraMode::Haute => {
                // Vue haute pincab : plateau quasi plein cadre (idéal pour écran vertical 90°)
                let fov = 30.0_f32;
                let elev = 62.0_f32.to_radians();
                let target = Vec3::new(0.0, -10.0, 35.0);
                let dist = if aspect < 0.75 { 2180.0 } else { 2280.0 };
                let eye = Vec3::new(
                    0.0,
                    target.y + dist * elev.sin(),
                    target.z + dist * elev.cos(),
                );
                (eye, target, fov, 20.0)
            }
            CameraMode::Tour => {
                let target = Vec3::new(0.0, 80.0, -20.0);
                let cp = self.cam.orbit_pitch.cos();
                let sp = self.cam.orbit_pitch.sin();
                let sy = self.cam.orbit_yaw.sin();
                let cy = self.cam.orbit_yaw.cos();
                let eye = Vec3::new(
                    target.x + self.cam.orbit_dist * cp * sy,
                    target.y + self.cam.orbit_dist * sp,
                    target.z + self.cam.orbit_dist * cp * cy,
                );
                (eye, target, 32.0, 20.0)
            }
            CameraMode::Lilliputien => {
                let p = self.cam.lilli_pos;
                let eye = m_table.transform_point(Vec3::new(p.x, p.y, -p.z));
                let (sy, cy) = self.cam.lilli_yaw.sin_cos();
                let (sp, cp) = self.cam.lilli_pitch.sin_cos();
                // Direction en coordonnées table : yaw=0 vers -Y (haut), pitch>0 vers -Z (haut)
                let dir_t = Vec3::new(sy * cp, -cy * cp, -sp);
                let look = m_table.transform_point(Vec3::new(
                    p.x + dir_t.x * 120.0,
                    p.y + dir_t.y * 120.0,
                    -p.z + dir_t.z * 120.0,
                ));
                (eye, look, 62.0, 1.5)
            }
        }
    }
}

fn build_fronton_panels(gl: &Gl, ex: &CaisseExtras) -> (GpuMesh, GpuMesh) {
    let lg = ex.cs_longueur;
    let e = ex.cs_ep;
    let har = ex.cs_h_arriere;
    let y_at = |z: f32| lg - ex.fr_p_bas - ((ex.fr_p_haut - ex.fr_p_bas) * (z - har)) / ex.fr_h;
    let zb = har + e;
    let zt = har + ex.fr_h - e;
    let origin = Vec3::new((ex.cs_largeur - ex.fr_l) * 0.5 + e, y_at(zb), zb);
    let up_raw = Vec3::new(0.0, y_at(zt) - origin.y, zt - zb);
    let hh = up_raw.len();
    let up = up_raw.norm();
    let ax = Vec3::new(1.0, 0.0, 0.0);
    let nrm = ax.cross(up).norm();
    let w = ex.fr_l - 2.0 * e;

    let make_plane = |v0: f32, ph: f32| -> GpuMesh {
        let mut mb = MeshBuilder::new();
        let base = origin.add(up.scale(v0)).add(nrm.scale(-6.0));
        let p0 = base;
        let p1 = base.add(ax.scale(w));
        let p2 = p1.add(up.scale(ph));
        let p3 = base.add(up.scale(ph));
        // UV : haut de l'image en haut (p3..p2)
        mb.add_quad(p0, p1, p2, p3, [0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]);
        unsafe { mb.upload(gl) }
    };

    let gh = (hh * 0.72).min((w * 832.0) / 1216.0);
    let ph = (hh - gh - 6.0).max(60.0);
    (make_plane(hh - gh, gh), make_plane(0.0, ph))
}

fn load_texture_file(gl: &Gl, path: &Path) -> Result<GLuint, String> {
    let surf = Surface::from_file(path).map_err(|e| format!("Image {} : {e}", path.display()))?;
    let rgba = surf
        .convert_format(PixelFormatEnum::ABGR8888)
        .map_err(|e| e.to_string())?;
    let w = rgba.width() as i32;
    let h = rgba.height() as i32;
    let tex = rgba.with_lock(|pixels| unsafe { create_rgba_texture(gl, w, h, pixels, true) });
    Ok(tex)
}

unsafe fn create_rgba_texture(gl: &Gl, w: i32, h: i32, data: &[u8], mipmap: bool) -> GLuint {
    let mut id = 0;
    (gl.GenTextures)(1, &mut id);
    (gl.BindTexture)(TEXTURE_2D, id);
    (gl.TexParameteri)(TEXTURE_2D, TEXTURE_WRAP_S, CLAMP_TO_EDGE);
    (gl.TexParameteri)(TEXTURE_2D, TEXTURE_WRAP_T, CLAMP_TO_EDGE);
    (gl.TexParameteri)(
        TEXTURE_2D,
        TEXTURE_MIN_FILTER,
        if mipmap { LINEAR_MIPMAP_LINEAR } else { LINEAR },
    );
    (gl.TexParameteri)(TEXTURE_2D, TEXTURE_MAG_FILTER, LINEAR);
    (gl.TexImage2D)(
        TEXTURE_2D,
        0,
        RGBA8 as GLint,
        w,
        h,
        0,
        RGBA,
        UNSIGNED_BYTE,
        data.as_ptr() as *const c_void,
    );
    if mipmap {
        (gl.GenerateMipmap)(TEXTURE_2D);
    }
    id
}

// ============================================================================
// Rendu du panneau LED ambre du fronton (mis à jour uniquement quand le texte change)
// ============================================================================

fn paint_led_display(buf: &mut [u8], w: usize, h: usize, score: &str, info: &str) {
    // Fond panneau noir bois / encadrement doré
    for px in buf.chunks_exact_mut(4) {
        px[0] = 0x16;
        px[1] = 0x0e;
        px[2] = 0x0a;
        px[3] = 0xff;
    }
    let mut fill_rect = |x0: usize, y0: usize, rw: usize, rh: usize, col: [u8; 4]| {
        for y in y0..(y0 + rh).min(h) {
            for x in x0..(x0 + rw).min(w) {
                let i = (y * w + x) * 4;
                buf[i..i + 4].copy_from_slice(&col);
            }
        }
    };
    // Fenêtres noires des 2 afficheurs
    fill_rect(18, 22, 316, 84, [0x07, 0x05, 0x04, 0xff]);
    fill_rect(352, 22, 144, 84, [0x07, 0x05, 0x04, 0xff]);

    let draw_str = |buf: &mut [u8], text: &str, x0: usize, y0: usize, col: [u8; 4]| {
        let dim = [0x24, 0x12, 0x08, 0xff];
        for (idx, ch) in text.chars().enumerate() {
            let g = glyph_5x7(ch);
            let gx = x0 + idx * 36;
            for (row, &bits) in g.iter().enumerate() {
                for bit in 0..5 {
                    let c = if (bits >> (4 - bit)) & 1 != 0 { col } else { dim };
                    let px0 = gx + bit * 6;
                    let py0 = y0 + row * 9;
                    for dy in 0..7 {
                        for dx in 0..5 {
                            let x = px0 + dx;
                            let y = py0 + dy;
                            if x < w && y < h {
                                let i = (y * w + x) * 4;
                                buf[i..i + 4].copy_from_slice(&c);
                            }
                        }
                    }
                }
            }
        }
    };

    draw_str(buf, score, 32, 33, [0xff, 0x9e, 0x28, 0xff]);
    draw_str(buf, info, 360, 33, [0xff, 0x5c, 0x24, 0xff]);
}

fn glyph_5x7(c: char) -> [u8; 7] {
    match c.to_ascii_uppercase() {
        '0' => [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E],
        '1' => [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
        '2' => [0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F],
        '3' => [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E],
        '4' => [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02],
        '5' => [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
        '6' => [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E],
        '7' => [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
        '8' => [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E],
        '9' => [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
        'A' => [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
        'B' => [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
        'C' => [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E],
        'D' => [0x1C, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1C],
        'E' => [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F],
        'F' => [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
        'G' => [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F],
        'H' => [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
        'I' => [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E],
        'J' => [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C],
        'K' => [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
        'L' => [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
        'M' => [0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11],
        'N' => [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
        'O' => [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
        'P' => [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
        'Q' => [0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D],
        'R' => [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
        'S' => [0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E],
        'T' => [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
        'U' => [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
        'V' => [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
        'W' => [0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11],
        'X' => [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
        'Y' => [0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04],
        'Z' => [0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F],
        '-' => [0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00],
        '/' => [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
        _ => [0x00; 7],
    }
}

#[allow(dead_code)]
fn _keep_gl_const() {
    let _ = gl::REPEAT;
}
