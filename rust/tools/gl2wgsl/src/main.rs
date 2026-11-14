//! Reads a GLSL 450 fragment shader on stdin, writes WGSL on stdout.
//! Exit code 1 with the error on stderr when parsing/validation fails.
use std::io::Read;

use naga::back::wgsl;
use naga::front::glsl;
use naga::valid::{Capabilities, ValidationFlags, Validator};

fn main() {
    let mut source = String::new();
    std::io::stdin().read_to_string(&mut source).expect("stdin");
    let mut frontend = glsl::Frontend::default();
    let options = glsl::Options::from(naga::ShaderStage::Fragment);
    let module = match frontend.parse(&options, &source) {
        Ok(module) => module,
        Err(error) => {
            eprintln!("{}", error.emit_to_string(&source));
            std::process::exit(1);
        }
    };
    let info = match Validator::new(ValidationFlags::all(), Capabilities::empty()).validate(&module) {
        Ok(info) => info,
        Err(error) => {
            eprintln!("{}", error.emit_to_string(&source));
            std::process::exit(1);
        }
    };
    match wgsl::write_string(&module, &info, wgsl::WriterFlags::empty()) {
        Ok(out) => print!("{out}"),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
