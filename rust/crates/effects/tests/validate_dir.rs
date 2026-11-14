//! Validates runtime shader bodies dumped by `apps/web/scripts/dump-shaders.ts`.
//! Run: FX_WGSL_DIR=/path/to/dump cargo test -p effects --test validate_dir -- --nocapture
#[test]
fn validate_dumped_shaders() {
    let Ok(dir) = std::env::var("FX_WGSL_DIR") else {
        eprintln!("FX_WGSL_DIR not set; skipping");
        return;
    };
    let mut failures = Vec::new();
    let mut count = 0;
    for entry in std::fs::read_dir(&dir).expect("read dir") {
        let path = entry.expect("entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("wgsl") {
            continue;
        }
        count += 1;
        let body = std::fs::read_to_string(&path).expect("read");
        let id = path.file_stem().unwrap().to_string_lossy().to_string();
        if let Err(error) = effects::register_effect_shader(&id, &body) {
            failures.push(format!("{id}:\n{error}"));
        }
    }
    eprintln!("validated {count} shaders, {} failed", failures.len());
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}
