//! Effect shader registry: built-in shaders plus shaders registered at runtime
//! (from the web app) as WGSL bodies that implement `fn effect(uv) -> vec4f`.
use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use gpu::wgpu::naga;

pub(crate) const PRELUDE: &str = include_str!("shaders/prelude.wgsl");
const EPILOGUE: &str = "\n@fragment\nfn fragment_main(input: VertexOutput) -> @location(0) vec4f {\n    return effect(input.tex_coord);\n}\n";

const BUILTINS: &[(&str, &str)] = &[("gaussian-blur", include_str!("shaders/gaussian_blur.wgsl"))];

struct Entry {
    source: String,
    version: u64,
}

thread_local! {
    static SHADERS: RefCell<HashMap<String, Entry>> = RefCell::new(HashMap::new());
    static NEXT_VERSION: Cell<u64> = const { Cell::new(1) };
}

/// A body that already declares `@fragment fn fragment_main` (e.g. a GL
/// Transition converted by naga with the same bindings) is used verbatim;
/// otherwise the prelude and the `effect(uv)` epilogue are added.
pub fn compose_shader_source(body: &str) -> String {
    if body.contains("fn fragment_main(") && body.contains("@fragment") {
        return body.to_string();
    }
    format!("{PRELUDE}\n{body}\n{EPILOGUE}")
}

fn validate(source: &str) -> Result<(), String> {
    let module = naga::front::wgsl::parse_str(source).map_err(|e| e.emit_to_string(source))?;
    naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::empty(),
    )
    .validate(&module)
    .map_err(|e| e.emit_to_string(source))?;
    Ok(())
}

/// Registers (or replaces) a runtime shader. The body is validated with naga
/// first so a broken shader never reaches the GPU device.
pub fn register_effect_shader(id: &str, body: &str) -> Result<(), String> {
    let source = compose_shader_source(body);
    validate(&source)?;
    let version = NEXT_VERSION.with(|v| {
        let next = v.get();
        v.set(next + 1);
        next
    });
    SHADERS.with(|shaders| {
        shaders
            .borrow_mut()
            .insert(id.to_string(), Entry { source, version });
    });
    Ok(())
}

pub fn has_effect_shader(id: &str) -> bool {
    BUILTINS.iter().any(|(name, _)| *name == id)
        || SHADERS.with(|shaders| shaders.borrow().contains_key(id))
}

/// Returns the full shader source and its version (0 for built-ins).
pub(crate) fn lookup_shader(id: &str) -> Option<(String, u64)> {
    if let Some(found) =
        SHADERS.with(|shaders| shaders.borrow().get(id).map(|e| (e.source.clone(), e.version)))
    {
        return Some(found);
    }
    BUILTINS
        .iter()
        .find(|(name, _)| *name == id)
        .map(|(_, body)| (compose_shader_source(body), 0))
}

pub(crate) fn shader_version(id: &str) -> Option<u64> {
    if let Some(v) = SHADERS.with(|shaders| shaders.borrow().get(id).map(|e| e.version)) {
        return Some(v);
    }
    BUILTINS.iter().any(|(name, _)| *name == id).then_some(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtins_validate() {
        for (id, body) in BUILTINS {
            validate(&compose_shader_source(body)).unwrap_or_else(|e| panic!("{id}: {e}"));
        }
    }

    #[test]
    fn rejects_broken_shader() {
        assert!(register_effect_shader("broken", "fn effect(uv: vec2f) -> vec4f { return 1; }").is_err());
        assert!(!has_effect_shader("broken"));
    }
}
