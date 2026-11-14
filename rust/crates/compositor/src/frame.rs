use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::BlendMode;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameDescriptor {
    pub width: u32,
    pub height: u32,
    pub clear: CanvasClearDescriptor,
    pub items: Vec<FrameItemDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasClearDescriptor {
    pub color: [f32; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FrameItemDescriptor {
    Layer(LayerDescriptor),
    #[serde(rename_all = "camelCase")]
    SceneEffect {
        effect_pass_groups: Vec<Vec<EffectPassDescriptor>>,
    },
    /// Two-input item: both layers are rendered, the first pass group runs with
    /// `src` = from and `orig` = to, then the result is blended over the scene.
    #[serde(rename_all = "camelCase")]
    Transition {
        from: Option<LayerDescriptor>,
        to: Option<LayerDescriptor>,
        effect_pass_groups: Vec<Vec<EffectPassDescriptor>>,
        #[serde(default = "default_blend_mode")]
        blend_mode: BlendMode,
    },
    /// Adjustment-layer transition between two composites of everything below it: `from` and `to` are drawn over
    /// a copy of the scene so far, the first pass group runs with `src` = from and `orig` = to, and the result
    /// (over the clear colour) replaces the scene.
    #[serde(rename_all = "camelCase")]
    SceneTransition {
        from: Vec<FrameItemDescriptor>,
        to: Vec<FrameItemDescriptor>,
        effect_pass_groups: Vec<Vec<EffectPassDescriptor>>,
    },
}

fn default_blend_mode() -> BlendMode {
    BlendMode::Normal
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerDescriptor {
    pub texture_id: String,
    pub transform: QuadTransformDescriptor,
    pub opacity: f32,
    pub blend_mode: BlendMode,
    #[serde(default)]
    pub effect_pass_groups: Vec<Vec<EffectPassDescriptor>>,
    pub mask: Option<LayerMaskDescriptor>,
    /// Passes run after the mask (a drop shadow follows the masked silhouette).
    #[serde(default)]
    pub after_mask_pass_groups: Vec<Vec<EffectPassDescriptor>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuadTransformDescriptor {
    pub center_x: f32,
    pub center_y: f32,
    pub width: f32,
    pub height: f32,
    pub rotation_degrees: f32,
    pub flip_x: bool,
    pub flip_y: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerMaskDescriptor {
    pub texture_id: String,
    pub feather: f32,
    pub inverted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectPassDescriptor {
    pub shader: String,
    pub uniforms: HashMap<String, EffectUniformValueDescriptor>,
    #[serde(default)]
    pub textures: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EffectUniformValueDescriptor {
    Number(f32),
    Vector(Vec<f32>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasTextureDescriptor {
    pub id: String,
    pub width: u32,
    pub height: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn struct_variant_fields_are_camel_case() {
        let json = r#"{"type":"transition","from":null,"to":null,"effectPassGroups":[],"blendMode":"normal"}"#;
        let item: FrameItemDescriptor = serde_json::from_str(json).expect("transition item");
        assert!(matches!(item, FrameItemDescriptor::Transition { .. }));
        let json = r#"{"type":"sceneEffect","effectPassGroups":[]}"#;
        let item: FrameItemDescriptor = serde_json::from_str(json).expect("scene effect item");
        assert!(matches!(item, FrameItemDescriptor::SceneEffect { .. }));
        let json = r#"{"type":"sceneTransition","from":[{"type":"sceneEffect","effectPassGroups":[]}],"to":[],"effectPassGroups":[]}"#;
        let item: FrameItemDescriptor = serde_json::from_str(json).expect("scene transition item");
        assert!(matches!(item, FrameItemDescriptor::SceneTransition { ref from, .. } if from.len() == 1));
    }
}
