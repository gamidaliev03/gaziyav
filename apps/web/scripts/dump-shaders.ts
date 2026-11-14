// Dumps every runtime WGSL shader body (effects + transitions) to a folder so
// the Rust test `effects/tests/validate_dir.rs` can validate them with naga.
// Usage: bun apps/web/scripts/dump-shaders.ts <outDir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { studioEffectDefinitions } from "../src/effects/definitions/studio";
import { ALL_TRANSITIONS as TRANSITIONS } from "../src/transitions/definitions";

const out = process.argv[2] ?? "/tmp/fx-wgsl";
mkdirSync(out, { recursive: true });
let n = 0;
for (const definition of studioEffectDefinitions) {
	for (const shader of definition.shaders ?? []) {
		writeFileSync(join(out, `${shader.id}.wgsl`), shader.wgsl);
		n++;
	}
}
for (const transition of TRANSITIONS) {
	writeFileSync(join(out, `${transition.type}.wgsl`), transition.wgsl);
	n++;
}
console.log(`dumped ${n} shaders to ${out}`);
