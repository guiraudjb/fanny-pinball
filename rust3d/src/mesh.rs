//! Construction de maillages 3D (VBO/VAO OpenGL 3.3 Core) :
//! fusion de pièces CAO par matériau + primitives procédurales (billes, batteurs, bumpers,
//! rampe PVC 3D, fils chromés wireforms, plans texturés).

use std::f32::consts::PI;
use std::ffi::c_void;
use std::mem::size_of;

use crate::gl::{
    self, GLint, GLsizei, GLsizeiptr, GLuint, Gl, ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, FALSE, FLOAT,
    STATIC_DRAW, TRIANGLES, UNSIGNED_INT,
};
use crate::math3d::Vec3;
use crate::table::{z_rampe, FlipperDef, TableGeo, Vec2};

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct Vertex {
    pub pos: [f32; 3],
    pub nrm: [f32; 3],
    pub uv: [f32; 2],
}

pub struct GpuMesh {
    pub vao: GLuint,
    pub vbo: GLuint,
    pub ebo: GLuint,
    pub index_count: GLsizei,
}

impl GpuMesh {
    pub unsafe fn draw(&self, gl: &Gl) {
        if self.index_count == 0 {
            return;
        }
        (gl.BindVertexArray)(self.vao);
        (gl.DrawElements)(TRIANGLES, self.index_count, UNSIGNED_INT, std::ptr::null());
    }
}

pub struct MeshBuilder {
    pub verts: Vec<Vertex>,
    pub indices: Vec<u32>,
}

impl MeshBuilder {
    pub fn new() -> Self {
        Self {
            verts: Vec::new(),
            indices: Vec::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.indices.is_empty()
    }

    pub fn push_tri(&mut self, a: Vec3, b: Vec3, c: Vec3, n: Vec3) {
        let base = self.verts.len() as u32;
        self.verts.push(Vertex { pos: [a.x, a.y, a.z], nrm: [n.x, n.y, n.z], uv: [0.0, 0.0] });
        self.verts.push(Vertex { pos: [b.x, b.y, b.z], nrm: [n.x, n.y, n.z], uv: [0.0, 0.0] });
        self.verts.push(Vertex { pos: [c.x, c.y, c.z], nrm: [n.x, n.y, n.z], uv: [0.0, 0.0] });
        self.indices.extend_from_slice(&[base, base + 1, base + 2]);
    }

    /// Ajoute un maillage indexé avec normales plates par triangle (arêtes vives façon CAO).
    pub fn add_indexed_flat(&mut self, positions: &[[f32; 3]], indices: &[u32]) {
        for tri in indices.chunks_exact(3) {
            let pa = positions[tri[0] as usize];
            let pb = positions[tri[1] as usize];
            let pc = positions[tri[2] as usize];
            let a = Vec3::new(pa[0], pa[1], pa[2]);
            let b = Vec3::new(pb[0], pb[1], pb[2]);
            let c = Vec3::new(pc[0], pc[1], pc[2]);
            let n = b.sub(a).cross(c.sub(a)).norm();
            self.push_tri(a, b, c, n);
        }
    }

    /// Ajoute un maillage indexé avec normales lissées (surfaces courbes : barre, lanceur).
    pub fn add_indexed_smooth(&mut self, positions: &[[f32; 3]], indices: &[u32]) {
        let mut nrms = vec![Vec3::new(0.0, 0.0, 0.0); positions.len()];
        for tri in indices.chunks_exact(3) {
            let (ia, ib, ic) = (tri[0] as usize, tri[1] as usize, tri[2] as usize);
            let a = Vec3::new(positions[ia][0], positions[ia][1], positions[ia][2]);
            let b = Vec3::new(positions[ib][0], positions[ib][1], positions[ib][2]);
            let c = Vec3::new(positions[ic][0], positions[ic][1], positions[ic][2]);
            let n = b.sub(a).cross(c.sub(a));
            nrms[ia] = nrms[ia].add(n);
            nrms[ib] = nrms[ib].add(n);
            nrms[ic] = nrms[ic].add(n);
        }
        let base = self.verts.len() as u32;
        for (i, p) in positions.iter().enumerate() {
            let n = nrms[i].norm();
            self.verts.push(Vertex {
                pos: *p,
                nrm: [n.x, n.y, n.z],
                uv: [0.0, 0.0],
            });
        }
        for &idx in indices {
            self.indices.push(base + idx);
        }
    }

    pub fn add_quad(&mut self, p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, uv0: [f32; 2], uv1: [f32; 2], uv2: [f32; 2], uv3: [f32; 2]) {
        let n = p1.sub(p0).cross(p2.sub(p0)).norm();
        let base = self.verts.len() as u32;
        self.verts.push(Vertex { pos: [p0.x, p0.y, p0.z], nrm: [n.x, n.y, n.z], uv: uv0 });
        self.verts.push(Vertex { pos: [p1.x, p1.y, p1.z], nrm: [n.x, n.y, n.z], uv: uv1 });
        self.verts.push(Vertex { pos: [p2.x, p2.y, p2.z], nrm: [n.x, n.y, n.z], uv: uv2 });
        self.verts.push(Vertex { pos: [p3.x, p3.y, p3.z], nrm: [n.x, n.y, n.z], uv: uv3 });
        self.indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }

    /// Boîte centrée en `(cx, cy, cz)` de dimensions `(sx, sy, sz)`.
    pub fn add_box(&mut self, cx: f32, cy: f32, cz: f32, sx: f32, sy: f32, sz: f32) {
        let (hx, hy, hz) = (sx * 0.5, sy * 0.5, sz * 0.5);
        let (x0, x1) = (cx - hx, cx + hx);
        let (y0, y1) = (cy - hy, cy + hy);
        let (z0, z1) = (cz - hz, cz + hz);
        // 6 faces
        self.add_quad(Vec3::new(x0, y0, z1), Vec3::new(x1, y0, z1), Vec3::new(x1, y1, z1), Vec3::new(x0, y1, z1), [0.0,0.0],[1.0,0.0],[1.0,1.0],[0.0,1.0]);
        self.add_quad(Vec3::new(x1, y0, z0), Vec3::new(x0, y0, z0), Vec3::new(x0, y1, z0), Vec3::new(x1, y1, z0), [0.0,0.0],[1.0,0.0],[1.0,1.0],[0.0,1.0]);
        self.add_quad(Vec3::new(x0, y1, z1), Vec3::new(x1, y1, z1), Vec3::new(x1, y1, z0), Vec3::new(x0, y1, z0), [0.0,0.0],[1.0,0.0],[1.0,1.0],[0.0,1.0]);
        self.add_quad(Vec3::new(x0, y0, z0), Vec3::new(x1, y0, z0), Vec3::new(x1, y0, z1), Vec3::new(x0, y0, z1), [0.0,0.0],[1.0,0.0],[1.0,1.0],[0.0,1.0]);
        self.add_quad(Vec3::new(x1, y0, z1), Vec3::new(x1, y0, z0), Vec3::new(x1, y1, z0), Vec3::new(x1, y1, z1), [0.0,0.0],[1.0,0.0],[1.0,1.0],[0.0,1.0]);
        self.add_quad(Vec3::new(x0, y0, z0), Vec3::new(x0, y0, z1), Vec3::new(x0, y1, z1), Vec3::new(x0, y1, z0), [0.0,0.0],[1.0,0.0],[1.0,1.0],[0.0,1.0]);
    }

    /// Cylindre ou tronc de cône vertical dans le repère de la table (`z = -hauteur` vers le haut).
    pub fn add_cyl_table(&mut self, cx: f32, cy: f32, h0: f32, h1: f32, r0: f32, r1: f32, segs: usize) {
        let z0 = -h0;
        let z1 = -h1;
        let dz = h1 - h0;
        let dr = r0 - r1;
        let slope_len = dz.hypot(dr).max(1e-5);
        let nz_side = -dr / slope_len;
        let nr_side = dz / slope_len;

        // Paroi latérale
        let base = self.verts.len() as u32;
        for i in 0..=segs {
            let a = (2.0 * PI * i as f32) / segs as f32;
            let (sa, ca) = a.sin_cos();
            let n = [ca * nr_side, sa * nr_side, nz_side];
            self.verts.push(Vertex { pos: [cx + ca * r0, cy + sa * r0, z0], nrm: n, uv: [i as f32 / segs as f32, 0.0] });
            self.verts.push(Vertex { pos: [cx + ca * r1, cy + sa * r1, z1], nrm: n, uv: [i as f32 / segs as f32, 1.0] });
        }
        for i in 0..segs {
            let k = base + (i as u32) * 2;
            self.indices.extend_from_slice(&[k, k + 1, k + 3, k, k + 3, k + 2]);
        }

        // Disque supérieur (en z1, normale vers le haut = -Z table)
        if r1 > 0.01 {
            let c_idx = self.verts.len() as u32;
            self.verts.push(Vertex { pos: [cx, cy, z1], nrm: [0.0, 0.0, -1.0], uv: [0.5, 0.5] });
            for i in 0..=segs {
                let a = (2.0 * PI * i as f32) / segs as f32;
                let (sa, ca) = a.sin_cos();
                self.verts.push(Vertex {
                    pos: [cx + ca * r1, cy + sa * r1, z1],
                    nrm: [0.0, 0.0, -1.0],
                    uv: [0.5 + 0.5 * ca, 0.5 + 0.5 * sa],
                });
            }
            for i in 0..segs {
                self.indices.extend_from_slice(&[c_idx, c_idx + 1 + i as u32 + 1, c_idx + 1 + i as u32]);
            }
        }
    }

    /// Sphère UV centrée à l'origine (bille acier, dômes).
    pub fn add_sphere(&mut self, r: f32, rings: usize, segs: usize) {
        let base = self.verts.len() as u32;
        for iy in 0..=rings {
            let v = iy as f32 / rings as f32;
            let phi = v * PI;
            let (sp, cp) = phi.sin_cos();
            for ix in 0..=segs {
                let u = ix as f32 / segs as f32;
                let th = u * 2.0 * PI;
                let (st, ct) = th.sin_cos();
                let nx = sp * ct;
                let ny = cp;
                let nz = sp * st;
                self.verts.push(Vertex {
                    pos: [nx * r, ny * r, nz * r],
                    nrm: [nx, ny, nz],
                    uv: [u, v],
                });
            }
        }
        let stride = (segs + 1) as u32;
        for iy in 0..rings as u32 {
            for ix in 0..segs as u32 {
                let a = base + iy * stride + ix;
                let b = a + stride;
                self.indices.extend_from_slice(&[a, b, a + 1, b, b + 1, a + 1]);
            }
        }
    }

    /// Tube cylindrique 3D le long d'une polyligne (wireforms chromés, cordes caoutchouc).
    pub fn add_tube(&mut self, pts: &[Vec3], radius: f32, radial: usize, closed: bool) {
        if pts.len() < 2 {
            return;
        }
        let n = pts.len();
        let ring_count = if closed { n + 1 } else { n };
        let base = self.verts.len() as u32;
        let mut prev_n = Vec3::new(0.0, 0.0, -1.0);

        for ri in 0..ring_count {
            let i = ri % n;
            let p = pts[i];
            let tang = if closed {
                pts[(i + 1) % n].sub(pts[(i + n - 1) % n]).norm()
            } else if i == 0 {
                pts[1].sub(pts[0]).norm()
            } else if i == n - 1 {
                pts[n - 1].sub(pts[n - 2]).norm()
            } else {
                pts[i + 1].sub(pts[i - 1]).norm()
            };
            // Repère orthogonal stable le long du tube
            let mut side = tang.cross(prev_n);
            if side.len() < 1e-4 {
                let alt = if tang.z.abs() < 0.8 { Vec3::new(0.0, 0.0, -1.0) } else { Vec3::new(1.0, 0.0, 0.0) };
                side = tang.cross(alt);
            }
            side = side.norm();
            let up = side.cross(tang).norm();
            prev_n = up;

            for k in 0..=radial {
                let a = (2.0 * PI * k as f32) / radial as f32;
                let (sa, ca) = a.sin_cos();
                let nrm = side.scale(ca).add(up.scale(sa)).norm();
                let pos = p.add(nrm.scale(radius));
                self.verts.push(Vertex {
                    pos: [pos.x, pos.y, pos.z],
                    nrm: [nrm.x, nrm.y, nrm.z],
                    uv: [k as f32 / radial as f32, ri as f32],
                });
            }
        }
        let stride = (radial + 1) as u32;
        for ri in 0..(ring_count - 1) as u32 {
            for k in 0..radial as u32 {
                let a = base + ri * stride + k;
                let b = a + stride;
                self.indices.extend_from_slice(&[a, b, a + 1, b, b + 1, a + 1]);
            }
        }
    }

    /// Extrusion 3D d'un polygone 2D du plateau, de `h0` à `h1` (`z = -h`).
    pub fn add_extruded_poly(&mut self, pts: &[Vec2], h0: f32, h1: f32) {
        if pts.len() < 3 {
            return;
        }
        let z0 = -h0;
        let z1 = -h1;
        let n = pts.len();
        // Orientation (aire signée) pour des normales sortantes cohérentes
        let mut area = 0.0;
        for i in 0..n {
            let a = pts[i];
            let b = pts[(i + 1) % n];
            area += a.x * b.y - b.x * a.y;
        }
        let rev = area < 0.0;
        let p_at = |i: usize| if rev { pts[n - 1 - i] } else { pts[i] };

        // Faces latérales
        for i in 0..n {
            let a = p_at(i);
            let b = p_at((i + 1) % n);
            let p0 = Vec3::new(a.x, a.y, z0);
            let p1 = Vec3::new(b.x, b.y, z0);
            let p2 = Vec3::new(b.x, b.y, z1);
            let p3 = Vec3::new(a.x, a.y, z1);
            self.add_quad(p0, p1, p2, p3, [0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]);
        }
        // Chapeau supérieur (éventail depuis le centroïde — parfait pour palettes / lance-pierres convexes)
        let mut cx = 0.0;
        let mut cy = 0.0;
        for p in pts {
            cx += p.x;
            cy += p.y;
        }
        cx /= n as f32;
        cy /= n as f32;
        let center = Vec3::new(cx, cy, z1);
        for i in 0..n {
            let a = p_at(i);
            let b = p_at((i + 1) % n);
            self.push_tri(
                center,
                Vec3::new(b.x, b.y, z1),
                Vec3::new(a.x, a.y, z1),
                Vec3::new(0.0, 0.0, -1.0),
            );
        }
    }

    pub unsafe fn upload(self, gl: &Gl) -> GpuMesh {
        let mut vao = 0;
        let mut vbo = 0;
        let mut ebo = 0;
        (gl.GenVertexArrays)(1, &mut vao);
        (gl.GenBuffers)(1, &mut vbo);
        (gl.GenBuffers)(1, &mut ebo);

        (gl.BindVertexArray)(vao);
        (gl.BindBuffer)(ARRAY_BUFFER, vbo);
        (gl.BufferData)(
            ARRAY_BUFFER,
            (self.verts.len() * size_of::<Vertex>()) as GLsizeiptr,
            self.verts.as_ptr() as *const c_void,
            STATIC_DRAW,
        );
        (gl.BindBuffer)(ELEMENT_ARRAY_BUFFER, ebo);
        (gl.BufferData)(
            ELEMENT_ARRAY_BUFFER,
            (self.indices.len() * size_of::<u32>()) as GLsizeiptr,
            self.indices.as_ptr() as *const c_void,
            STATIC_DRAW,
        );

        let stride = size_of::<Vertex>() as GLsizei;
        (gl.EnableVertexAttribArray)(0);
        (gl.VertexAttribPointer)(0, 3, FLOAT, FALSE, stride, 0 as *const c_void);
        (gl.EnableVertexAttribArray)(1);
        (gl.VertexAttribPointer)(1, 3, FLOAT, FALSE, stride, (3 * size_of::<f32>()) as *const c_void);
        (gl.EnableVertexAttribArray)(2);
        (gl.VertexAttribPointer)(2, 2, FLOAT, FALSE, stride, (6 * size_of::<f32>()) as *const c_void);
        (gl.BindVertexArray)(0);

        GpuMesh {
            vao,
            vbo,
            ebo,
            index_count: self.indices.len() as GLsizei,
        }
    }
}

/// Construit les deux maillages d'une palette 3D (corps crème + caoutchouc rouge) dans le repère pivot-centré à angle 0.
pub fn build_flipper_meshes(gl: &Gl, def: FlipperDef) -> (GpuMesh, GpuMesh) {
    let sgn = if def.is_left { 1.0_f32 } else { -1.0_f32 };
    let contour = |ra: f32, rb: f32| -> Vec<Vec2> {
        let mut pts = Vec::new();
        for i in 0..=10 {
            let a = -PI * 0.5 + PI * (i as f32) / 10.0;
            pts.push(Vec2::new((def.len + a.cos() * rb) * sgn, a.sin() * rb));
        }
        for i in 0..=12 {
            let a = PI * 0.5 + PI * (i as f32) / 12.0;
            pts.push(Vec2::new((a.cos() * ra) * sgn, a.sin() * ra));
        }
        pts
    };

    let mut body = MeshBuilder::new();
    let body_pts = contour(def.r1 - 3.6, def.r2 - 3.0);
    body.add_extruded_poly(&body_pts, 2.0, 26.0);
    body.add_cyl_table(0.0, 0.0, 0.0, 27.0, 4.0, 4.0, 14);

    let mut rubber = MeshBuilder::new();
    let rub_pts: Vec<Vec3> = contour(def.r1 - 1.9, def.r2 - 1.9)
        .into_iter()
        .map(|p| Vec3::new(p.x, p.y, -13.5))
        .collect();
    rubber.add_tube(&rub_pts, 2.4, 8, true);

    unsafe { (body.upload(gl), rubber.upload(gl)) }
}

/// Construit la rampe PVC 3D (fond + deux flancs de 25 mm) le long de `geo.ramp_path` avec le profil exact `z_rampe`.
pub fn build_ramp_3d(gl: &Gl, geo: &TableGeo) -> GpuMesh {
    let mut mb = MeshBuilder::new();
    let pts = &geo.ramp_path.pts;
    let total_len = geo.ramp_path.length;
    let hw_base = 19.5_f32;
    let wall_h = 25.0_f32;
    let evase = geo.ramp_entry.evase;
    let hw_mouth = geo.ramp_entry.half;

    let half_w = |s: f32| -> f32 {
        if s < evase {
            let t = (s / evase).clamp(0.0, 1.0);
            hw_mouth + (hw_base - hw_mouth) * t
        } else {
            hw_base
        }
    };

    for i in 0..(pts.len() - 1) {
        let a = pts[i];
        let b = pts[i + 1];
        let d = b.pos.sub(a.pos).norm();
        let n = Vec2::new(-d.y, d.x);

        let ha = half_w(a.s);
        let hb = half_w(b.s);
        let za = -z_rampe(a.s, total_len);
        let zb = -z_rampe(b.s, total_len);

        let al = Vec3::new(a.pos.x - n.x * ha, a.pos.y - n.y * ha, za);
        let ar = Vec3::new(a.pos.x + n.x * ha, a.pos.y + n.y * ha, za);
        let bl = Vec3::new(b.pos.x - n.x * hb, b.pos.y - n.y * hb, zb);
        let br = Vec3::new(b.pos.x + n.x * hb, b.pos.y + n.y * hb, zb);

        // Fond de la rampe (double face pour transparence propre)
        mb.add_quad(al, ar, br, bl, [0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]);

        // Flanc gauche (hauteur 25 mm vers -Z)
        let alt = Vec3::new(al.x, al.y, al.z - wall_h);
        let blt = Vec3::new(bl.x, bl.y, bl.z - wall_h);
        mb.add_quad(al, bl, blt, alt, [0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]);

        // Flanc droit
        let art = Vec3::new(ar.x, ar.y, ar.z - wall_h);
        let brt = Vec3::new(br.x, br.y, br.z - wall_h);
        mb.add_quad(br, ar, art, brt, [0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]);
    }
    unsafe { mb.upload(gl) }
}

/// Construit tous les guides de bille en wireform d'acier inox chromé (identiques à `buildWireformGuides` de `js/render3d.js`).
pub fn build_wireforms_3d(gl: &Gl, geo: &TableGeo) -> GpuMesh {
    let mut mb = MeshBuilder::new();

    let mut add_wire_guide = |pts: &[Vec2], r1: f32, r2: f32, z1: f32, z2: f32, z3: f32| {
        if pts.len() < 2 {
            return;
        }
        let p0 = pts[0];
        let pn = *pts.last().unwrap();
        // Fil bas + coudes plantés dans le plateau
        let mut low = Vec::with_capacity(pts.len() + 2);
        low.push(Vec3::new(p0.x, p0.y, 0.0));
        for &p in pts {
            low.push(Vec3::new(p.x, p.y, -z1));
        }
        low.push(Vec3::new(pn.x, pn.y, 0.0));
        mb.add_tube(&low, r1, 7, false);

        // Fil supérieur
        let mut high = Vec::with_capacity(pts.len() + 2);
        high.push(Vec3::new(p0.x, p0.y, -z1));
        for &p in pts {
            high.push(Vec3::new(p.x, p.y, -z2));
        }
        high.push(Vec3::new(pn.x, pn.y, -z1));
        mb.add_tube(&high, r2, 6, false);

        if z3 > 0.0 {
            let mut top = Vec::with_capacity(pts.len() + 2);
            top.push(Vec3::new(p0.x, p0.y, -z2));
            for &p in pts {
                top.push(Vec3::new(p.x, p.y, -z3));
            }
            top.push(Vec3::new(pn.x, pn.y, -z2));
            mb.add_tube(&top, r2, 6, false);
        }

        // Rondelles aux extrémités
        mb.add_cyl_table(p0.x, p0.y, 0.0, 2.0, 3.4, 3.4, 10);
        mb.add_cyl_table(pn.x, pn.y, 0.0, 2.0, 3.4, 3.4, 10);
    };

    for s in &geo.separators {
        add_wire_guide(s, 2.0, 1.5, 13.5, 23.0, 0.0);
    }
    for &(a, b) in &geo.dividers {
        add_wire_guide(&[a, b], 2.0, 1.5, 13.5, 23.0, 0.0);
    }
    add_wire_guide(&geo.bonus_guide, 2.0, 1.5, 13.5, 23.0, 0.0);
    for &(x, y1, y2) in &geo.lane_posts {
        add_wire_guide(&[Vec2::new(x, y1), Vec2::new(x, y2)], 1.75, 1.4, 13.5, 22.0, 0.0);
    }
    add_wire_guide(&[geo.deflector.0, geo.deflector.1], 2.0, 1.5, 13.5, 23.0, 0.0);
    add_wire_guide(
        &[Vec2::new(geo.lane_sep_x, geo.lane_sep_y1), Vec2::new(geo.lane_sep_x, geo.apron.lane - 6.0)],
        1.8,
        1.5,
        13.5,
        21.0,
        28.5,
    );

    // Arche supérieure
    let mut arc = Vec::with_capacity(49);
    for i in 0..=48 {
        let a = PI + (PI * i as f32) / 48.0;
        let nx = a.cos() / geo.ellipse_rx;
        let ny = a.sin() / geo.ellipse_ry;
        let nl = nx.hypot(ny).max(1e-6);
        let x = (geo.ellipse_cx + geo.ellipse_rx * a.cos() + (nx / nl) * 3.0).clamp(2.0, 512.0);
        let y = geo.ellipse_cy + geo.ellipse_ry * a.sin() + (ny / nl) * 3.0;
        arc.push(Vec2::new(x, y));
    }
    add_wire_guide(&arc, 2.0, 1.55, 13.5, 22.0, 30.5);

    // Arceau de protection de la bielle du tourniquet
    add_wire_guide(&geo.spinner_guard, 1.75, 1.45, 13.5, 26.0, 0.0);

    unsafe { mb.upload(gl) }
}

/// Vérifie qu'on ne génère aucun warning de constante inutilisée.
#[allow(dead_code)]
fn _keep_gl_imports() {
    let _ = gl::LINEAR as GLint;
}
