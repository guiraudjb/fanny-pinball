//! Chargeur minimal OpenGL 3.3 Core via `sdl2::VideoSubsystem::gl_get_proc_address`.
//! Zéro dépendance externe : fonctionne sur Linux (GLX/EGL/Wayland), Windows et Raspberry Pi.

#![allow(non_snake_case, dead_code)]

use std::ffi::{c_char, c_void, CString};
use std::mem::transmute;
use sdl2::VideoSubsystem;

pub type GLenum = u32;
pub type GLuint = u32;
pub type GLint = i32;
pub type GLsizei = i32;
pub type GLboolean = u8;
pub type GLbitfield = u32;
pub type GLfloat = f32;
pub type GLsizeiptr = isize;

pub const FALSE: GLboolean = 0;
pub const TRUE: GLboolean = 1;

pub const COLOR_BUFFER_BIT: GLbitfield = 0x0000_4000;
pub const DEPTH_BUFFER_BIT: GLbitfield = 0x0000_0100;

pub const TRIANGLES: GLenum = 0x0004;
pub const UNSIGNED_INT: GLenum = 0x1405;
pub const UNSIGNED_BYTE: GLenum = 0x1401;
pub const FLOAT: GLenum = 0x1406;

pub const DEPTH_TEST: GLenum = 0x0B71;
pub const BLEND: GLenum = 0x0BE2;
pub const CULL_FACE: GLenum = 0x0B44;
pub const MULTISAMPLE: GLenum = 0x809D;
pub const SRC_ALPHA: GLenum = 0x0302;
pub const ONE_MINUS_SRC_ALPHA: GLenum = 0x0303;

pub const ARRAY_BUFFER: GLenum = 0x8892;
pub const ELEMENT_ARRAY_BUFFER: GLenum = 0x8893;
pub const STATIC_DRAW: GLenum = 0x88E4;

pub const FRAGMENT_SHADER: GLenum = 0x8B30;
pub const VERTEX_SHADER: GLenum = 0x8B31;
pub const COMPILE_STATUS: GLenum = 0x8B81;
pub const LINK_STATUS: GLenum = 0x8B82;

pub const TEXTURE_2D: GLenum = 0x0DE1;
pub const TEXTURE0: GLenum = 0x84C0;
pub const RGBA: GLenum = 0x1908;
pub const RGBA8: GLenum = 0x8058;
pub const TEXTURE_MIN_FILTER: GLenum = 0x2801;
pub const TEXTURE_MAG_FILTER: GLenum = 0x2800;
pub const TEXTURE_WRAP_S: GLenum = 0x2802;
pub const TEXTURE_WRAP_T: GLenum = 0x2803;
pub const LINEAR: GLint = 0x2601;
pub const LINEAR_MIPMAP_LINEAR: GLint = 0x2703;
pub const CLAMP_TO_EDGE: GLint = 0x812F;
pub const REPEAT: GLint = 0x2901;

pub struct Gl {
    pub Viewport: unsafe extern "system" fn(GLint, GLint, GLsizei, GLsizei),
    pub ClearColor: unsafe extern "system" fn(GLfloat, GLfloat, GLfloat, GLfloat),
    pub Clear: unsafe extern "system" fn(GLbitfield),
    pub Enable: unsafe extern "system" fn(GLenum),
    pub Disable: unsafe extern "system" fn(GLenum),
    pub DepthMask: unsafe extern "system" fn(GLboolean),
    pub BlendFunc: unsafe extern "system" fn(GLenum, GLenum),

    pub CreateShader: unsafe extern "system" fn(GLenum) -> GLuint,
    pub ShaderSource: unsafe extern "system" fn(GLuint, GLsizei, *const *const c_char, *const GLint),
    pub CompileShader: unsafe extern "system" fn(GLuint),
    pub GetShaderiv: unsafe extern "system" fn(GLuint, GLenum, *mut GLint),
    pub GetShaderInfoLog: unsafe extern "system" fn(GLuint, GLsizei, *mut GLsizei, *mut c_char),
    pub DeleteShader: unsafe extern "system" fn(GLuint),

    pub CreateProgram: unsafe extern "system" fn() -> GLuint,
    pub AttachShader: unsafe extern "system" fn(GLuint, GLuint),
    pub LinkProgram: unsafe extern "system" fn(GLuint),
    pub GetProgramiv: unsafe extern "system" fn(GLuint, GLenum, *mut GLint),
    pub GetProgramInfoLog: unsafe extern "system" fn(GLuint, GLsizei, *mut GLsizei, *mut c_char),
    pub UseProgram: unsafe extern "system" fn(GLuint),
    pub GetUniformLocation: unsafe extern "system" fn(GLuint, *const c_char) -> GLint,

    pub Uniform1i: unsafe extern "system" fn(GLint, GLint),
    pub Uniform1f: unsafe extern "system" fn(GLint, GLfloat),
    pub Uniform3f: unsafe extern "system" fn(GLint, GLfloat, GLfloat, GLfloat),
    pub Uniform4f: unsafe extern "system" fn(GLint, GLfloat, GLfloat, GLfloat, GLfloat),
    pub UniformMatrix4fv: unsafe extern "system" fn(GLint, GLsizei, GLboolean, *const GLfloat),

    pub GenVertexArrays: unsafe extern "system" fn(GLsizei, *mut GLuint),
    pub BindVertexArray: unsafe extern "system" fn(GLuint),
    pub DeleteVertexArrays: unsafe extern "system" fn(GLsizei, *const GLuint),
    pub GenBuffers: unsafe extern "system" fn(GLsizei, *mut GLuint),
    pub BindBuffer: unsafe extern "system" fn(GLenum, GLuint),
    pub BufferData: unsafe extern "system" fn(GLenum, GLsizeiptr, *const c_void, GLenum),
    pub DeleteBuffers: unsafe extern "system" fn(GLsizei, *const GLuint),
    pub EnableVertexAttribArray: unsafe extern "system" fn(GLuint),
    pub VertexAttribPointer: unsafe extern "system" fn(GLuint, GLint, GLenum, GLboolean, GLsizei, *const c_void),

    pub DrawElements: unsafe extern "system" fn(GLenum, GLsizei, GLenum, *const c_void),
    pub DrawArrays: unsafe extern "system" fn(GLenum, GLint, GLsizei),

    pub GenTextures: unsafe extern "system" fn(GLsizei, *mut GLuint),
    pub ActiveTexture: unsafe extern "system" fn(GLenum),
    pub BindTexture: unsafe extern "system" fn(GLenum, GLuint),
    pub TexParameteri: unsafe extern "system" fn(GLenum, GLenum, GLint),
    pub TexImage2D: unsafe extern "system" fn(GLenum, GLint, GLint, GLsizei, GLsizei, GLint, GLenum, GLenum, *const c_void),
    pub TexSubImage2D: unsafe extern "system" fn(GLenum, GLint, GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, *const c_void),
    pub GenerateMipmap: unsafe extern "system" fn(GLenum),
}

fn load_fn<T>(video: &VideoSubsystem, name: &str) -> Result<T, String> {
    let ptr = video.gl_get_proc_address(name) as *const c_void;
    if ptr.is_null() {
        return Err(format!("Symbole OpenGL introuvable : {name}"));
    }
    Ok(unsafe { transmute_copy_ptr(ptr) })
}

#[inline]
unsafe fn transmute_copy_ptr<T>(ptr: *const c_void) -> T {
    assert_eq!(std::mem::size_of::<T>(), std::mem::size_of::<*const c_void>());
    let mut val = std::mem::MaybeUninit::<T>::uninit();
    std::ptr::copy_nonoverlapping(&ptr as *const *const c_void as *const u8, val.as_mut_ptr() as *mut u8, std::mem::size_of::<T>());
    val.assume_init()
}

impl Gl {
    pub fn load(video: &VideoSubsystem) -> Result<Self, String> {
        Ok(Self {
            Viewport: load_fn(video, "glViewport")?,
            ClearColor: load_fn(video, "glClearColor")?,
            Clear: load_fn(video, "glClear")?,
            Enable: load_fn(video, "glEnable")?,
            Disable: load_fn(video, "glDisable")?,
            DepthMask: load_fn(video, "glDepthMask")?,
            BlendFunc: load_fn(video, "glBlendFunc")?,

            CreateShader: load_fn(video, "glCreateShader")?,
            ShaderSource: load_fn(video, "glShaderSource")?,
            CompileShader: load_fn(video, "glCompileShader")?,
            GetShaderiv: load_fn(video, "glGetShaderiv")?,
            GetShaderInfoLog: load_fn(video, "glGetShaderInfoLog")?,
            DeleteShader: load_fn(video, "glDeleteShader")?,

            CreateProgram: load_fn(video, "glCreateProgram")?,
            AttachShader: load_fn(video, "glAttachShader")?,
            LinkProgram: load_fn(video, "glLinkProgram")?,
            GetProgramiv: load_fn(video, "glGetProgramiv")?,
            GetProgramInfoLog: load_fn(video, "glGetProgramInfoLog")?,
            UseProgram: load_fn(video, "glUseProgram")?,
            GetUniformLocation: load_fn(video, "glGetUniformLocation")?,

            Uniform1i: load_fn(video, "glUniform1i")?,
            Uniform1f: load_fn(video, "glUniform1f")?,
            Uniform3f: load_fn(video, "glUniform3f")?,
            Uniform4f: load_fn(video, "glUniform4f")?,
            UniformMatrix4fv: load_fn(video, "glUniformMatrix4fv")?,

            GenVertexArrays: load_fn(video, "glGenVertexArrays")?,
            BindVertexArray: load_fn(video, "glBindVertexArray")?,
            DeleteVertexArrays: load_fn(video, "glDeleteVertexArrays")?,
            GenBuffers: load_fn(video, "glGenBuffers")?,
            BindBuffer: load_fn(video, "glBindBuffer")?,
            BufferData: load_fn(video, "glBufferData")?,
            DeleteBuffers: load_fn(video, "glDeleteBuffers")?,
            EnableVertexAttribArray: load_fn(video, "glEnableVertexAttribArray")?,
            VertexAttribPointer: load_fn(video, "glVertexAttribPointer")?,

            DrawElements: load_fn(video, "glDrawElements")?,
            DrawArrays: load_fn(video, "glDrawArrays")?,

            GenTextures: load_fn(video, "glGenTextures")?,
            ActiveTexture: load_fn(video, "glActiveTexture")?,
            BindTexture: load_fn(video, "glBindTexture")?,
            TexParameteri: load_fn(video, "glTexParameteri")?,
            TexImage2D: load_fn(video, "glTexImage2D")?,
            TexSubImage2D: load_fn(video, "glTexSubImage2D")?,
            GenerateMipmap: load_fn(video, "glGenerateMipmap")?,
        })
    }

    pub unsafe fn uniform_loc(&self, prog: GLuint, name: &str) -> GLint {
        let cs = CString::new(name).unwrap();
        (self.GetUniformLocation)(prog, cs.as_ptr())
    }

    pub unsafe fn compile_program(&self, vs_src: &str, fs_src: &str) -> Result<GLuint, String> {
        let vs = self.compile_shader(VERTEX_SHADER, vs_src)?;
        let fs = self.compile_shader(FRAGMENT_SHADER, fs_src)?;
        let prog = (self.CreateProgram)();
        (self.AttachShader)(prog, vs);
        (self.AttachShader)(prog, fs);
        (self.LinkProgram)(prog);
        let mut ok = 0;
        (self.GetProgramiv)(prog, LINK_STATUS, &mut ok);
        (self.DeleteShader)(vs);
        (self.DeleteShader)(fs);
        if ok == 0 {
            let mut buf = vec![0u8; 1024];
            let mut len = 0;
            (self.GetProgramInfoLog)(prog, buf.len() as GLsizei, &mut len, buf.as_mut_ptr() as *mut c_char);
            buf.truncate(len.max(0) as usize);
            return Err(format!("Link shader : {}", String::from_utf8_lossy(&buf)));
        }
        Ok(prog)
    }

    unsafe fn compile_shader(&self, kind: GLenum, src: &str) -> Result<GLuint, String> {
        let sh = (self.CreateShader)(kind);
        let cs = CString::new(src).unwrap();
        let ptr = cs.as_ptr();
        (self.ShaderSource)(sh, 1, &ptr, std::ptr::null());
        (self.CompileShader)(sh);
        let mut ok = 0;
        (self.GetShaderiv)(sh, COMPILE_STATUS, &mut ok);
        if ok == 0 {
            let mut buf = vec![0u8; 1024];
            let mut len = 0;
            (self.GetShaderInfoLog)(sh, buf.len() as GLsizei, &mut len, buf.as_mut_ptr() as *mut c_char);
            buf.truncate(len.max(0) as usize);
            (self.DeleteShader)(sh);
            return Err(format!("Compile shader : {}", String::from_utf8_lossy(&buf)));
        }
        Ok(sh)
    }
}

#[allow(dead_code)]
fn _unused_transmute_guard() {
    let _ = transmute::<usize, usize>;
}
