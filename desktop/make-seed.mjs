#!/usr/bin/env node
// The payload of the «with models» build (SEED_DIR for build.sh): exactly the files the app's manifest pins, nothing
// else, so the app installs every model on the first launch without the internet.
//
//   WEB_SRC=…/apps/web MODELS_FROM=~/Library/Application\ Support/Gaziyav OUT=…/seed node make-seed.mjs
//
//   seed/seed.json                      marks the build (the app looks for it)
//   seed/models/<id>/<dest>             every model file at its install path, sha256-checked (APFS clones of MODELS_FROM,
//                                       which must hold installed, verified models — e.g. this Mac's)
//   seed/runtime/python/                the uv-managed CPython the environments use
//   seed/runtime/uv-cache/              every locked wheel, for macOS 14, 15 and 26 (uv picks the wheel built for the Mac
//                                       it runs on, e.g. MLX has one per macOS), downloaded once with the app's own uv
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HERE = import.meta.dirname;
const WEB = process.env.WEB_SRC;
const FROM = process.env.MODELS_FROM;
const OUT = process.env.OUT;
const UV = process.env.UV || path.join(HERE, "vendor", "arm64", "bin", "uv");
const MACOS = (process.env.SEED_MACOS || "14.0,15.0,26.0").split(",");
if (!WEB || !FROM || !OUT) throw new Error("WEB_SRC, MODELS_FROM and OUT are required");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// 1. The plan, from the manifest itself.
const probe = path.join(WEB, "src", ".seed-plan.tmp.ts");
fs.copyFileSync(path.join(HERE, "seed-plan.ts"), probe);
let plan;
try {
	plan = JSON.parse(execFileSync(path.join(os.homedir(), ".bun", "bin", "bun"), [probe], { cwd: WEB, maxBuffer: 64 << 20 }).toString());
} finally {
	fs.rmSync(probe, { force: true });
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 2. Model files: clones, then size + sha256 against the manifest.
const sha256 = (file) =>
	new Promise((resolve, reject) => {
		const h = crypto.createHash("sha256");
		fs.createReadStream(file, { highWaterMark: 8 << 20 })
			.on("data", (d) => h.update(d))
			.on("end", () => resolve(h.digest("hex")))
			.on("error", reject);
	});
let bytes = 0;
for (const m of plan.models) {
	for (const f of m.files) {
		const src = path.join(FROM, m.root, f.dest);
		const dest = path.join(OUT, "models", m.id, f.dest);
		if (fs.statSync(src, { throwIfNoEntry: false })?.size !== f.size) throw new Error(`${m.id}: ${f.dest} is missing or has the wrong size in ${FROM}`);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		execFileSync("cp", ["-c", src, dest]);
		fs.chmodSync(dest, 0o644); // Hugging Face snapshots are read-only; the build clears attributes and signs the bundle
		if ((await sha256(dest)) !== f.sha256) throw new Error(`${m.id}: ${f.dest} sha256 differs from the manifest`);
		bytes += f.size;
	}
	log(`${m.id}: ${m.files.length} files ok`);
}

// 3. Python: the managed build the app's uv installs (same version), cloned from MODELS_FROM's runtime.
const pyFrom = path.join(FROM, "Runtime", "python");
const build = fs.readdirSync(pyFrom).find((d) => d.startsWith(`cpython-${plan.python}-macos-aarch64`));
if (!build) throw new Error(`no cpython-${plan.python} build in ${pyFrom}`);
fs.mkdirSync(path.join(OUT, "runtime", "python"), { recursive: true });
execFileSync("cp", ["-cR", path.join(pyFrom, build), path.join(OUT, "runtime", "python", build)]);
log(`python: ${build}`);

// 4. Wheels: every lock resolved for each macOS into a throwaway target; uv keeps the wheels in the seed's cache.
const cache = path.join(OUT, "runtime", "uv-cache");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "seed-"));
for (const m of plan.models.filter((x) => x.lock)) {
	const lock = path.join(scratch, `${m.id}.lock`);
	fs.writeFileSync(lock, m.lock);
	for (const v of MACOS) {
		const target = path.join(scratch, `${m.id}-${v}`);
		execFileSync(
			UV,
			["pip", "install", "--require-hashes", "--only-binary", ":all:", "--python-platform", "aarch64-apple-darwin", "--python-version", plan.python, "--target", target, "-r", lock],
			{
				env: {
					PATH: "/usr/bin:/bin",
					HOME: os.homedir(),
					UV_CACHE_DIR: cache,
					UV_PYTHON_INSTALL_DIR: path.join(OUT, "runtime", "python"),
					UV_PYTHON_PREFERENCE: "only-managed",
					UV_PYTHON_DOWNLOADS: "never",
					UV_NO_CONFIG: "1",
					UV_NO_PROGRESS: "1",
					UV_LINK_MODE: "copy",
					MACOSX_DEPLOYMENT_TARGET: v,
				},
				stdio: ["ignore", "ignore", "pipe"],
			},
		);
		fs.rmSync(target, { recursive: true, force: true });
	}
	log(`${m.id}: wheels for macOS ${MACOS.join(", ")}`);
}
fs.rmSync(scratch, { recursive: true, force: true });
// Not needed to install from the cache: uv's build environments and interpreter probes.
for (const d of fs.readdirSync(cache)) if (/^(builds|interpreter|environments|sdists)-v\d+$/.test(d) || d === ".tmp") fs.rmSync(path.join(cache, d), { recursive: true, force: true });

fs.writeFileSync(
	path.join(OUT, "seed.json"),
	JSON.stringify({ built: new Date().toISOString(), python: plan.python, macos: MACOS, models: plan.models.map((m) => m.id), modelBytes: bytes }, null, 1),
);
log(`seed ready: ${(bytes / 1e9).toFixed(2)} GB of models`);
