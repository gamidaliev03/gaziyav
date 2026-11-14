// Prints what the «with models» build must carry, straight from the app's own manifest (run with bun from the web
// app, so "@/…" resolves): per model its folder under Application Support, every file (dest, size, sha256) and the
// Python lock. Used by make-seed.mjs.
import path from "node:path";
import { PYTHON_VERSION } from "@/ondevice/locks";
import { MODELS } from "@/ondevice/manifest";
import { supportDir } from "@/platform/paths";

const plan = {
	python: PYTHON_VERSION,
	models: MODELS.map((spec) => ({
		id: spec.id,
		root: path.relative(supportDir(), spec.root()),
		files: spec.files.map((f) => ({ dest: f.dest, size: f.size, sha256: f.sha256 })),
		lock: spec.python?.lock ?? null,
	})),
};
process.stdout.write(JSON.stringify(plan));
