// Converts the GL Transitions pack (MIT / BSD, gl-transitions contributors)
// shipped with Kadr into WGSL for our engine, mechanically, with naga:
//   GLSL 450 wrapper (this file) → rust/tools/gl2wgsl (naga glsl-in → wgsl-out).
// Items that do not convert cleanly are dropped (listed on stderr).
//
// Usage (repo root):
//   cargo build --release --manifest-path rust/tools/gl2wgsl/Cargo.toml
// Output: apps/web/src/transitions/gl/gl-pack.json (+ LICENSE-gl-transitions.txt)
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");
const SRC = process.argv[2] ?? "";
const OUT_DIR = join(ROOT, "apps/web/src/transitions/gl");
const TOOL = join(ROOT, "rust/tools/gl2wgsl/target/release/gl2wgsl");
// Not shipped: ad platforms restrict cannabis imagery (effects-research.md §2).
const EXCLUDE = new Set(["cannabisleaf.glsl"]);

type UniformType = "float" | "int" | "bool" | "vec2" | "ivec2" | "vec3" | "vec4";
interface Uniform { name: string; type: UniformType; defaults: number[] }
export interface GlParam {
	key: string;
	label: string;
	type: "number" | "int" | "bool" | "vec2" | "color";
	default: number[];
	min: number;
	max: number;
	slot: number; // first float index in fx.params
	size: number;
}
export interface GlTransition {
	id: string;
	file: string;
	name: string;
	group: string;
	author: string;
	license: string;
	params: GlParam[];
	wgsl: string;
}

function prettyName(s: string): string {
	const chars = [...s.replace(/[_-]/g, " ")];
	let out = "";
	chars.forEach((c, i) => {
		if (i > 0 && /[A-Z]/.test(c) && /[a-z]/.test(chars[i - 1])) out += " ";
		out += i === 0 ? c.toUpperCase() : c;
	});
	return out
		.replace("Rigth", "Right")
		.split(" ")
		.filter(Boolean)
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join(" ");
}

// Kadr GLTransitionPlugin.category()
function category(s: string): string {
	const has = (list: string[]) => list.some((k) => s.includes(k));
	if (has(["glitch", "static", "tv", "datamosh", "noise", "flicker", "signal"])) return "Glitch & TV";
	if (has(["zoom", "dreamy", "blur", "defocus", "overexposure"])) return "Zoom & Blur";
	if (has(["burn", "film", "luma", "melt", "fade", "dissolve", "colour", "color", "hsv"])) return "Film & Fade";
	if (has(["warp", "ripple", "swirl", "wave", "water", "morph", "displace", "kaleido", "crazy", "flyeye", "butterfly", "polar", "perlin", "wind"])) return "Distort";
	if (has(["cube", "flip", "door", "page", "book", "fold", "revolve", "rotate", "spin", "pinwheel", "angular", "bounce", "box", "stereo"])) return "3D & Motion";
	if (has(["wipe", "slide", "open", "close", "push", "directional", "left", "right", "top", "bottom", "rolls", "slides"])) return "Wipe & Slide";
	return "Shapes & Patterns";
}

const SIZES: Record<UniformType, number> = { float: 1, int: 1, bool: 1, vec2: 2, ivec2: 2, vec3: 3, vec4: 4 };

function parseUniforms(glsl: string): { body: string; uniforms: Uniform[] } | null {
	const uniforms: Uniform[] = [];
	const re = /^[ \t]*uniform[ \t]+(\w+)[ \t]+(\w+)[ \t]*;[ \t]*(?:\/\/[ \t]*=?[ \t]*(.*))?$/gm;
	const body = glsl.replace(re, (_m, type: string, name: string, def = "") => {
		const cleaned = String(def).replace(/\b(?:vec|ivec|bvec|float|int|half)\d?\b/g, "");
		let nums = [...cleaned.matchAll(/-?\d*\.?\d+(?:[eE]-?\d+)?/g)].map((m) => Number(m[0]));
		if (type === "bool") nums = [String(def).includes("true") ? 1 : 0];
		uniforms.push({ name, type: type as UniformType, defaults: nums });
		return "";
	});
	if (!uniforms.every((u) => u.type in SIZES)) return null;
	return { body, uniforms };
}

function layout(uniforms: Uniform[]): { params: GlParam[]; defines: string[] } | null {
	const params: GlParam[] = [];
	const defines: string[] = [];
	let slot = 0;
	const at = (i: number) => `fx.params[${i >> 2}].${"xyzw"[i & 3]}`;
	for (const u of uniforms) {
		const size = SIZES[u.type];
		if (size > 1 && slot % 4 !== 0 && (slot % 4) + size > 4) slot += 4 - (slot % 4);
		if (slot + size > 32) return null;
		const parts = Array.from({ length: size }, (_, k) => at(slot + k));
		let expr: string;
		switch (u.type) {
			case "float": expr = `(${parts[0]})`; break;
			case "int": expr = `int(${parts[0]})`; break;
			case "bool": expr = `(${parts[0]} > 0.5)`; break;
			case "ivec2": expr = `ivec2(${parts.join(", ")})`; break;
			default: expr = `${u.type}(${parts.join(", ")})`;
		}
		// a private global set in main(): survives parameter shadowing (unlike #define)
		const glType = u.type === "ivec2" ? "ivec2" : u.type;
		defines.push(`${glType} ${u.name};\u0000${u.name} = ${expr};`);
		const def = Array.from({ length: size }, (_, k) => u.defaults[k] ?? u.defaults[0] ?? (u.type === "int" ? 1 : 0.5));
		const d = def[0];
		const hi = u.type === "int" ? Math.max(10, d * 3) : d <= 1 && d >= 0 ? 1 : Math.max(1, Math.abs(d) * 3);
		params.push({
			key: u.name,
			label: prettyName(u.name),
			type: u.type === "float" ? "number" : u.type === "int" ? "int" : u.type === "bool" ? "bool" : u.type === "vec2" || u.type === "ivec2" ? "vec2" : "color",
			default: def,
			min: d < 0 ? -hi : 0,
			max: hi,
			slot,
			size,
		});
		slot += size;
	}
	return { params, defines };
}

function wrap(body: string, defines: string[]): string {
	return `#version 450
layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 out_color;
layout(set = 0, binding = 0) uniform texture2D src_tex;
layout(set = 0, binding = 1) uniform sampler lin_samp;
layout(set = 1, binding = 0) uniform FxUniforms {
    vec2 resolution;
    float time;
    float progress_;
    float frame;
    float pad0;
    float pad1;
    float pad2;
    vec4 params[8];
} fx;
layout(set = 2, binding = 0) uniform texture2D orig_tex;
float progress;
float ratio;
vec4 getFromColor(vec2 uv) { return textureLod(sampler2D(src_tex, lin_samp), vec2(uv.x, 1.0 - uv.y), 0.0); }
vec4 getToColor(vec2 uv) { return textureLod(sampler2D(orig_tex, lin_samp), vec2(uv.x, 1.0 - uv.y), 0.0); }
${defines.map((d) => d.split("\u0000")[0]).join("\n")}
${body}
void main() {
    progress = fx.progress_;
    ratio = fx.resolution.x / max(fx.resolution.y, 1.0);
${defines.map((d) => `    ${d.split("\u0000")[1]}`).join("\n")}
    out_color = transition(vec2(v_uv.x, 1.0 - v_uv.y));
}
`;
}

if (!existsSync(TOOL)) {
	console.error(`missing ${TOOL} — run: cargo build --release --manifest-path rust/tools/gl2wgsl/Cargo.toml`);
	process.exit(1);
}
const verified = new Set(readFileSync(join(SRC, "verified.txt"), "utf8").split(/\s+/).filter(Boolean));
const out: GlTransition[] = [];
const dropped: string[] = [];
for (const file of readdirSync(SRC).filter((f) => f.endsWith(".glsl")).sort()) {
	if (!verified.has(file) || EXCLUDE.has(file)) continue;
	const base = file.replace(/\.glsl$/, "");
	const glsl = readFileSync(join(SRC, file), "utf8");
	if (glsl.includes("sampler2D") || glsl.includes("gl_FragCoord")) { dropped.push(`${file}: needs textures/pixel coords`); continue; }
	const meta = (key: string) => glsl.split("\n").slice(0, 12).map((l) => l.trim()).find((l) => l.startsWith(`// ${key}:`))?.slice(key.length + 4).trim() ?? "";
	const parsed = parseUniforms(glsl);
	if (!parsed) { dropped.push(`${file}: unsupported uniform type`); continue; }
	const lay = layout(parsed.uniforms);
	if (!lay) { dropped.push(`${file}: too many uniforms`); continue; }
	let wgsl: string;
	try {
		wgsl = execFileSync(TOOL, { input: wrap(parsed.body, lay.defines), stdio: ["pipe", "pipe", "pipe"] }).toString();
	} catch (error) {
		const stderr = (error as { stderr?: Buffer }).stderr?.toString().split("\n").slice(0, 3).join(" ") ?? "";
		dropped.push(`${file}: naga: ${stderr}`);
		continue;
	}
	if (!/@fragment\s*\n\s*fn main\(/.test(wgsl)) { dropped.push(`${file}: no fragment entry`); continue; }
	wgsl = `// GL Transition "${base}" by ${meta("Author") || "unknown"} (${meta("License") || "MIT"}), converted with naga.\n${wgsl.replace(/@fragment\s*\n\s*fn main\(/, "@fragment\nfn fragment_main(")}`;
	const tags = meta("Tags").toLowerCase();
	out.push({
		id: `gl.transition.${base}`,
		file,
		name: prettyName(base),
		group: category(`${base.toLowerCase()} ${tags}`),
		author: meta("Author"),
		license: meta("License") || "MIT",
		params: lay.params,
		wgsl,
	});
}
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "gl-pack.json"), JSON.stringify(out));
copyFileSync(join(SRC, "LICENSE-gl-transitions.txt"), join(OUT_DIR, "LICENSE-gl-transitions.txt"));
console.log(`converted ${out.length}, dropped ${dropped.length}`);
for (const d of dropped) console.error(`  dropped ${d}`);
