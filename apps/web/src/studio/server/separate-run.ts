// One way to run the separation helper (GaziyavShell/native/local-separate.py) for everything that separates: the
// two-way «Separate voice and music» (audio-ai.ts) and the song's four parts (hear/score-server.ts).
// The engine: the same Demucs model in Apple's MLX when its part is on this Mac (ondevice/manifest.ts PARTS,
// «separate-mlx»: measured 2.2–3× faster and 0.6 GB lighter than PyTorch on an M1 Pro), PyTorch otherwise — and
// PyTorch again whenever the MLX run fails, is killed or leaves no answer. Callers see one result and never an error
// of the engine that was replaced. Call it inside heavy() (ml-queue.ts): both tries then sit in one turn of the queue.
import fs from "node:fs";
import path from "node:path";
import { ondevicePython, ondeviceState } from "@/ondevice/server";
import { IS_MAC } from "@/platform/os";
import { modelDirs } from "@/platform/paths";
import { reason, type RunOptions, type RunResult, run } from "./tools";

const bin = (name: string) => path.join(process.env.STUDIO_BIN_DIR || "", name);

export type SeparateEngine = "mlx" | "torch";

/**
 * Longer sound goes to PyTorch as it always did: MLX keeps the whole answer in the GPU's memory (about 0.17 GB a
 * minute on top of 1.4 GB; measured up to 5 minutes), and nothing longer than a long song was tried.
 */
export const MLX_MAX_SECONDS = 15 * 60;

/** macOS memory pressure: 1 normal, 2 warning, 4 critical (kern.memorystatus_vm_pressure_level). */
export const PRESSURE_CRITICAL = 4;

/** The engine a separation starts with (pure: the unit test drives it). */
export function pickEngine({ installed, seconds, pressure, forced }: { installed: boolean; seconds: number; pressure: number; forced?: string }): SeparateEngine {
	if (forced === "torch" || !installed) return "torch";
	if (!(seconds > 0) || seconds > MLX_MAX_SECONDS) return "torch";
	// Memory is critically short: nothing new is tried, today's path answers.
	if (pressure >= PRESSURE_CRITICAL) return "torch";
	return "mlx";
}

async function memoryPressure(): Promise<number> {
	if (!IS_MAC) return 1;
	try {
		const r = await run("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"], { timeout: 5 });
		return r.status === 0 ? Number(r.stdout.trim()) || 1 : 1;
	} catch {
		return 1;
	}
}

function mlxInstalled(): boolean {
	try {
		return ondeviceState("separate-mlx").installed;
	} catch {
		return false; // Windows, or a build that doesn't know the part
	}
}

export interface SeparateJob {
	/** The mix: raw 32-bit float, interleaved stereo, 44.1 kHz. */
	input: string;
	/** What to make: ["--voice", a, "--music", b] and/or ["--stems", dir]. */
	args: string[];
	/** Every file the helper must leave. */
	outputs: string[];
	/** Length of the mix. */
	seconds: number;
}

/** The files a run left, complete (the helper writes a part's WAV under a dot name first and renames it). */
const made = (outputs: string[]) => outputs.every((f) => fs.existsSync(f) && fs.statSync(f).size > 0);

export async function runSeparate(job: SeparateJob, options: RunOptions = {}): Promise<RunResult & { engine: SeparateEngine }> {
	// STUDIO_SEPARATE_ENGINE=torch: tests compare the two engines on one build.
	const engine = pickEngine({ installed: mlxInstalled(), seconds: job.seconds, pressure: await memoryPressure(), forced: process.env.STUDIO_SEPARATE_ENGINE });
	if (engine === "mlx") {
		let error = "";
		let why = "";
		try {
			const root = path.join(modelDirs.separate(), "mlx");
			const r = await run(ondevicePython("separate-mlx"), ["-I", bin("local-separate.py"), "--engine", "mlx", "--weights", root, "--input", job.input, ...job.args], {
				...options,
				// A stuck MLX run gives way long before the PyTorch limit (it needs about 5 % of the sound's length).
				timeout: Math.min(options.timeout ?? 900, Math.max(180, job.seconds * 2)),
				// Its errors stay here: the caller hears only of the engine that answers.
				onLine: (line) => {
					if (line.startsWith("ERROR ")) error = line.slice(6);
					else options.onLine?.(line);
				},
			});
			if (options.signal?.aborted) return { ...r, engine };
			if (r.status === 0 && made(job.outputs)) return { ...r, engine };
			why = error || reason(r);
		} catch (e) {
			if (options.signal?.aborted) throw e;
			why = (e as Error).message;
		}
		// To the app's log: a fallback is rare and worth a line there. Written to stderr by hand — the shell keeps the
		// server's stderr in studio.log, and the production build strips every console call.
		process.stderr.write(`[separate] the MLX engine gave no answer (${why.replace(/\s+/g, " ").slice(0, 200)}): PyTorch takes over\n`);
		// Nothing half-made stays for the second try (or for the caller, should that fail too).
		for (const f of job.outputs) {
			fs.rmSync(f, { force: true });
			fs.rmSync(path.join(path.dirname(f), `.${path.basename(f)}`), { force: true });
		}
		options.onLine?.("PROGRESS 0");
	}
	const r = await run(ondevicePython("separate"), ["-I", bin("local-separate.py"), "--models", modelDirs.separate(), "--input", job.input, ...job.args], options);
	return { ...r, engine: "torch" };
}
