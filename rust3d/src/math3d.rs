//! Mathématiques 3D (vecteurs et matrices 4×4 column-major pour OpenGL).

#[derive(Debug, Clone, Copy, Default)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vec3 {
    pub const fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }
    pub fn add(self, o: Self) -> Self {
        Self::new(self.x + o.x, self.y + o.y, self.z + o.z)
    }
    pub fn sub(self, o: Self) -> Self {
        Self::new(self.x - o.x, self.y - o.y, self.z - o.z)
    }
    pub fn scale(self, s: f32) -> Self {
        Self::new(self.x * s, self.y * s, self.z * s)
    }
    pub fn dot(self, o: Self) -> f32 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }
    pub fn cross(self, o: Self) -> Self {
        Self::new(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }
    pub fn len(self) -> f32 {
        (self.x * self.x + self.y * self.y + self.z * self.z).sqrt()
    }
    pub fn norm(self) -> Self {
        let l = self.len();
        if l > 1e-6 {
            self.scale(1.0 / l)
        } else {
            Self::new(0.0, 1.0, 0.0)
        }
    }
}

/// Matrice 4×4 en ordre colonne-majeur (compatible directement avec `glUniformMatrix4fv(..., GL_FALSE, ...)`).
#[derive(Debug, Clone, Copy)]
pub struct Mat4 {
    pub m: [f32; 16],
}

impl Mat4 {
    pub const fn identity() -> Self {
        Self {
            m: [
                1.0, 0.0, 0.0, 0.0,
                0.0, 1.0, 0.0, 0.0,
                0.0, 0.0, 1.0, 0.0,
                0.0, 0.0, 0.0, 1.0,
            ],
        }
    }

    pub fn mul(self, rhs: Self) -> Self {
        let mut out = [0.0f32; 16];
        for c in 0..4 {
            for r in 0..4 {
                out[c * 4 + r] = self.m[0 * 4 + r] * rhs.m[c * 4 + 0]
                    + self.m[1 * 4 + r] * rhs.m[c * 4 + 1]
                    + self.m[2 * 4 + r] * rhs.m[c * 4 + 2]
                    + self.m[3 * 4 + r] * rhs.m[c * 4 + 3];
            }
        }
        Self { m: out }
    }

    pub fn transform_point(self, p: Vec3) -> Vec3 {
        Vec3::new(
            self.m[0] * p.x + self.m[4] * p.y + self.m[8] * p.z + self.m[12],
            self.m[1] * p.x + self.m[5] * p.y + self.m[9] * p.z + self.m[13],
            self.m[2] * p.x + self.m[6] * p.y + self.m[10] * p.z + self.m[14],
        )
    }

    pub fn translation(x: f32, y: f32, z: f32) -> Self {
        let mut out = Self::identity();
        out.m[12] = x;
        out.m[13] = y;
        out.m[14] = z;
        out
    }

    pub fn scale(x: f32, y: f32, z: f32) -> Self {
        let mut out = Self::identity();
        out.m[0] = x;
        out.m[5] = y;
        out.m[10] = z;
        out
    }

    pub fn rotation_x(a: f32) -> Self {
        let (s, c) = a.sin_cos();
        Self {
            m: [
                1.0, 0.0, 0.0, 0.0,
                0.0, c,   s,   0.0,
                0.0, -s,  c,   0.0,
                0.0, 0.0, 0.0, 1.0,
            ],
        }
    }

    pub fn rotation_y(a: f32) -> Self {
        let (s, c) = a.sin_cos();
        Self {
            m: [
                c,   0.0, -s,  0.0,
                0.0, 1.0, 0.0, 0.0,
                s,   0.0, c,   0.0,
                0.0, 0.0, 0.0, 1.0,
            ],
        }
    }

    pub fn rotation_z(a: f32) -> Self {
        let (s, c) = a.sin_cos();
        Self {
            m: [
                c,   s,   0.0, 0.0,
                -s,  c,   0.0, 0.0,
                0.0, 0.0, 1.0, 0.0,
                0.0, 0.0, 0.0, 1.0,
            ],
        }
    }

    /// Inverse exacte d'une transformation rigide (rotation orthonormée + translation).
    pub fn inverse_rigid(self) -> Self {
        let r00 = self.m[0];
        let r10 = self.m[1];
        let r20 = self.m[2];
        let r01 = self.m[4];
        let r11 = self.m[5];
        let r21 = self.m[6];
        let r02 = self.m[8];
        let r12 = self.m[9];
        let r22 = self.m[10];
        let tx = self.m[12];
        let ty = self.m[13];
        let tz = self.m[14];
        Self {
            m: [
                r00, r01, r02, 0.0,
                r10, r11, r12, 0.0,
                r20, r21, r22, 0.0,
                -(r00 * tx + r10 * ty + r20 * tz),
                -(r01 * tx + r11 * ty + r21 * tz),
                -(r02 * tx + r12 * ty + r22 * tz),
                1.0,
            ],
        }
    }

    pub fn perspective(fov_y_rad: f32, aspect: f32, near: f32, far: f32) -> Self {
        let f = 1.0 / (fov_y_rad * 0.5).tan();
        let nf = 1.0 / (near - far);
        Self {
            m: [
                f / aspect.max(1e-4), 0.0, 0.0, 0.0,
                0.0, f, 0.0, 0.0,
                0.0, 0.0, (far + near) * nf, -1.0,
                0.0, 0.0, 2.0 * far * near * nf, 0.0,
            ],
        }
    }

    pub fn look_at(eye: Vec3, target: Vec3, up: Vec3) -> Self {
        let f = target.sub(eye).norm();
        let s = f.cross(up).norm();
        let u = s.cross(f);
        Self {
            m: [
                s.x, u.x, -f.x, 0.0,
                s.y, u.y, -f.y, 0.0,
                s.z, u.z, -f.z, 0.0,
                -s.dot(eye), -u.dot(eye), f.dot(eye), 1.0,
            ],
        }
    }
}
