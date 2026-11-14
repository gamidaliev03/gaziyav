use std::cell::RefCell;
use std::collections::HashMap;

use bytemuck::{Pod, Zeroable};
use gpu::{FULLSCREEN_SHADER_SOURCE, GpuContext, wgpu};
use thiserror::Error;
use wgpu::util::DeviceExt;

use crate::registry::{lookup_shader, shader_version};
use crate::{EffectPass, UniformValue};

/// Source of render targets for effect passes. The compositor plugs in its
/// per-frame texture pool; standalone callers use `FreshTextures`.
pub trait TextureAllocator {
    fn acquire(&mut self, context: &GpuContext, width: u32, height: u32) -> wgpu::Texture;
    /// Called when an intermediate pass output is no longer needed in this frame.
    fn release(&mut self, _texture: &wgpu::Texture) {}
}

pub struct FreshTextures;

impl TextureAllocator for FreshTextures {
    fn acquire(&mut self, context: &GpuContext, width: u32, height: u32) -> wgpu::Texture {
        context.create_render_texture(width, height, "effects-pass-output")
    }
}

pub struct ApplyEffectsOptions<'a> {
    pub source: &'a wgpu::Texture,
    /// Bound as `orig` (defaults to `source`). Transitions pass the "to" layer here.
    pub orig: Option<&'a wgpu::Texture>,
    pub width: u32,
    pub height: u32,
    pub passes: &'a [EffectPass],
    /// Resolves `EffectPass::textures` ids (LUT strips etc.).
    pub textures: &'a dyn Fn(&str) -> Option<wgpu::Texture>,
}

struct CachedPipeline {
    version: u64,
    pipeline: wgpu::RenderPipeline,
}

pub struct EffectPipeline {
    uniform_bind_group_layout: wgpu::BindGroupLayout,
    aux_bind_group_layout: wgpu::BindGroupLayout,
    pipeline_layout: wgpu::PipelineLayout,
    vertex_shader_module: wgpu::ShaderModule,
    pipelines: RefCell<HashMap<String, CachedPipeline>>,
    dummy_texture: wgpu::Texture,
}

#[derive(Debug, Error)]
pub enum EffectsError {
    #[error("At least one effect pass is required")]
    MissingEffectPasses,
    #[error("Unknown effect shader '{shader}'")]
    UnknownEffectShader { shader: String },
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct FxUniforms {
    resolution: [f32; 2],
    time: f32,
    progress: f32,
    frame: f32,
    _pad: [f32; 3],
    params: [[f32; 4]; 8],
}

fn texture_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture {
            multisampled: false,
            view_dimension: wgpu::TextureViewDimension::D2,
            sample_type: wgpu::TextureSampleType::Float { filterable: true },
        },
        count: None,
    }
}

impl EffectPipeline {
    pub fn new(context: &GpuContext) -> Self {
        let device = context.device();
        let uniform_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("effects-uniform-bind-group-layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });
        let aux_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("effects-aux-bind-group-layout"),
                entries: &[texture_entry(0), texture_entry(1), texture_entry(2)],
            });
        let vertex_shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("effects-fullscreen-shader"),
            source: wgpu::ShaderSource::Wgsl(FULLSCREEN_SHADER_SOURCE.into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("effects-pipeline-layout"),
            bind_group_layouts: &[
                Some(context.texture_sampler_bind_group_layout()),
                Some(&uniform_bind_group_layout),
                Some(&aux_bind_group_layout),
            ],
            immediate_size: 0,
        });
        let dummy_texture = context.create_render_texture(1, 1, "effects-dummy-texture");
        context.queue().write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &dummy_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &[0, 0, 0, 0],
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4),
                rows_per_image: Some(1),
            },
            wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
        );

        Self {
            uniform_bind_group_layout,
            aux_bind_group_layout,
            pipeline_layout,
            vertex_shader_module,
            pipelines: RefCell::new(HashMap::new()),
            dummy_texture,
        }
    }

    /// Lazily compiles (and caches) the pipeline for a shader id.
    fn pipeline_for(&self, context: &GpuContext, shader: &str) -> Option<wgpu::RenderPipeline> {
        let version = shader_version(shader)?;
        if let Some(cached) = self.pipelines.borrow().get(shader)
            && cached.version == version
        {
            return Some(cached.pipeline.clone());
        }
        let (source, version) = lookup_shader(shader)?;
        let device = context.device();
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("effects-shader"),
            source: wgpu::ShaderSource::Wgsl(source.into()),
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("effects-pipeline"),
            layout: Some(&self.pipeline_layout),
            vertex: wgpu::VertexState {
                module: &self.vertex_shader_module,
                entry_point: Some("vertex_main"),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<[f32; 2]>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &[wgpu::VertexAttribute {
                        format: wgpu::VertexFormat::Float32x2,
                        offset: 0,
                        shader_location: 0,
                    }],
                }],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fragment_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: context.texture_format(),
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        self.pipelines.borrow_mut().insert(
            shader.to_string(),
            CachedPipeline {
                version,
                pipeline: pipeline.clone(),
            },
        );
        Some(pipeline)
    }

    /// Standalone application (effect thumbnails). Returns the source when no
    /// pass could run.
    pub fn apply(
        &self,
        context: &GpuContext,
        options: ApplyEffectsOptions<'_>,
    ) -> Result<wgpu::Texture, EffectsError> {
        let mut encoder =
            context
                .device()
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("effects-command-encoder"),
                });
        let source = options.source.clone();
        let output =
            self.apply_with_encoder(context, &mut encoder, &mut FreshTextures, options)?;
        context.queue().submit([encoder.finish()]);
        Ok(output.unwrap_or(source))
    }

    /// Records all passes. Returns `None` when no pass ran (unknown shaders are
    /// skipped instead of failing the whole frame).
    pub fn apply_with_encoder(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        allocator: &mut dyn TextureAllocator,
        ApplyEffectsOptions {
            source,
            orig,
            width,
            height,
            passes,
            textures,
        }: ApplyEffectsOptions<'_>,
    ) -> Result<Option<wgpu::Texture>, EffectsError> {
        let orig_texture = orig.unwrap_or(source);
        let orig_view = orig_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut current_texture: Option<wgpu::Texture> = None;

        for pass in passes {
            let Some(pipeline) = self.pipeline_for(context, &pass.shader) else {
                continue;
            };
            let input_texture = current_texture.as_ref().unwrap_or(source);
            let output_texture = allocator.acquire(context, width, height);
            let input_view = input_texture.create_view(&wgpu::TextureViewDescriptor::default());
            let output_view = output_texture.create_view(&wgpu::TextureViewDescriptor::default());
            let aux: Vec<wgpu::Texture> = (0..2)
                .map(|index| {
                    pass.textures
                        .get(index)
                        .and_then(|id| textures(id))
                        .unwrap_or_else(|| self.dummy_texture.clone())
                })
                .collect();
            let aux0_view = aux[0].create_view(&wgpu::TextureViewDescriptor::default());
            let aux1_view = aux[1].create_view(&wgpu::TextureViewDescriptor::default());

            let device = context.device();
            let texture_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("effects-texture-bind-group"),
                layout: context.texture_sampler_bind_group_layout(),
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&input_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(context.linear_sampler()),
                    },
                ],
            });
            let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("effects-uniform-buffer"),
                contents: bytemuck::bytes_of(&pack_effect_uniforms(pass, width, height)),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            });
            let uniform_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("effects-uniform-bind-group"),
                layout: &self.uniform_bind_group_layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform_buffer.as_entire_binding(),
                }],
            });
            let aux_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("effects-aux-bind-group"),
                layout: &self.aux_bind_group_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&orig_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(&aux0_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: wgpu::BindingResource::TextureView(&aux1_view),
                    },
                ],
            });

            {
                let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("effects-render-pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &output_view,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    occlusion_query_set: None,
                    timestamp_writes: None,
                    multiview_mask: None,
                });
                render_pass.set_pipeline(&pipeline);
                render_pass.set_vertex_buffer(0, context.fullscreen_quad().slice(..));
                render_pass.set_bind_group(0, &texture_bind_group, &[]);
                render_pass.set_bind_group(1, &uniform_bind_group, &[]);
                render_pass.set_bind_group(2, &aux_bind_group, &[]);
                render_pass.draw(0..6, 0..1);
            }

            if let Some(previous) = current_texture.replace(output_texture) {
                allocator.release(&previous);
            }
        }

        Ok(current_texture)
    }
}

fn first_number(value: &UniformValue) -> f32 {
    match value {
        UniformValue::Number(n) => *n,
        UniformValue::Vector(v) => v.first().copied().unwrap_or(0.0),
    }
}

fn pack_effect_uniforms(pass: &EffectPass, width: u32, height: u32) -> FxUniforms {
    let mut uniforms = FxUniforms {
        resolution: [width as f32, height as f32],
        time: 0.0,
        progress: 0.0,
        frame: 0.0,
        _pad: [0.0; 3],
        params: [[0.0; 4]; 8],
    };
    for (name, value) in &pass.uniforms {
        match name.as_str() {
            "u_time" => uniforms.time = first_number(value),
            "u_progress" => uniforms.progress = first_number(value),
            "u_frame" => uniforms.frame = first_number(value),
            "u_params" => {
                let values: &[f32] = match value {
                    UniformValue::Number(n) => std::slice::from_ref(n),
                    UniformValue::Vector(v) => v.as_slice(),
                };
                for (index, v) in values.iter().take(32).enumerate() {
                    uniforms.params[index / 4][index % 4] = *v;
                }
            }
            // Legacy gaussian-blur uniforms → params[0].
            "u_sigma" => uniforms.params[0][0] = first_number(value),
            "u_step" => uniforms.params[0][1] = first_number(value),
            "u_direction" => {
                if let UniformValue::Vector(v) = value {
                    uniforms.params[0][2] = v.first().copied().unwrap_or(0.0);
                    uniforms.params[0][3] = v.get(1).copied().unwrap_or(0.0);
                }
            }
            _ => {}
        }
    }
    uniforms
}
