use std::collections::HashMap;

use gpu::{GpuContext, wgpu};

type TextureKey = (u32, u32);

#[derive(Default)]
pub struct TexturePool {
    available: HashMap<TextureKey, Vec<wgpu::Texture>>,
    in_use: Vec<(TextureKey, wgpu::Texture)>,
}

impl TexturePool {
    pub fn recycle_frame(&mut self) {
        for (key, texture) in self.in_use.drain(..) {
            self.available.entry(key).or_default().push(texture);
        }
    }

    pub fn acquire(
        &mut self,
        context: &GpuContext,
        width: u32,
        height: u32,
        label: &'static str,
    ) -> wgpu::Texture {
        let key = (width, height);
        let texture = self
            .available
            .get_mut(&key)
            .and_then(Vec::pop)
            .unwrap_or_else(|| context.create_render_texture(width, height, label));
        self.in_use.push((key, texture.clone()));
        texture
    }

    /// Returns a texture acquired this frame to the pool early (its contents are
    /// no longer needed by any later operation of the frame).
    pub fn release(&mut self, texture: &wgpu::Texture) {
        if let Some(index) = self.in_use.iter().position(|(_, t)| t == texture) {
            let (key, texture) = self.in_use.swap_remove(index);
            self.available.entry(key).or_default().push(texture);
        }
    }
}

impl effects::TextureAllocator for TexturePool {
    fn acquire(&mut self, context: &GpuContext, width: u32, height: u32) -> wgpu::Texture {
        TexturePool::acquire(self, context, width, height, "effects-pass-output")
    }

    fn release(&mut self, texture: &wgpu::Texture) {
        TexturePool::release(self, texture);
    }
}
