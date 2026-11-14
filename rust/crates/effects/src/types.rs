use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct EffectPass {
    pub shader: String,
    pub uniforms: HashMap<String, UniformValue>,
    /// Auxiliary texture references (compositor texture ids), bound to aux0/aux1.
    pub textures: Vec<String>,
}

#[derive(Clone, Debug)]
pub enum UniformValue {
    Number(f32),
    Vector(Vec<f32>),
}
