// A song's beats and bar starts by the beat network (GaziyavShell/native/local-beats.py, Beat This!), when its part
// is on this Mac (ondevice/manifest.ts PARTS, «separate-beats»). It is a second opinion for the song's own grid
// (hear/net-grid.ts decides what to take from it), never a requirement: no part, a long file, memory critically
// short, a failed or killed helper, a wrong answer — all give null, and today's grid stands.
// The helper runs on Separate's Python (PyTorch) with the part's three packages added, in the one-heavy-model queue.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NetBeats } from "@/hear/net-grid";
import { BEATS_WEIGHTS, modelSpec } from "@/ondevice/manifest";
import { ondevicePython, ondeviceState, sitePackagesOf } from "@/ondevice/server";
import { IS_MAC } from "@/platform/os";
import { CancelledError } from "./errors";
import { heavy } from "./ml-queue";
import { findTool, run } from "./tools";

const bin = (name: string) => path.join(process.env.STUDIO_BIN_DIR || "", name);

/** A song, not a film: the network walks the whole sound in 30 s pieces. */
export const BEATS_MAX_SECONDS = 15 * 60;

/** The beat model's weights when the part is installed and whole; null otherwise (and on Windows, where it isn't offered). */
export function beatsReady(): string | null {
	try {
		const part = modelSpec("separate-beats");
		if (!part || process.env.STUDIO_BEATS === "off" || !ondeviceState("separate-beats").installed) return null;
		const weights = path.join(part.root(), BEATS_WEIGHTS);
		return fs.existsSync(weights) ? weights : null;
	} catch {
		return null;
	}
}

async function memoryCritical(): Promise<boolean> {
	if (!IS_MAC) return false;
	try {
		const r = await run("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"], { timeout: 5 });
		return r.status === 0 && Number(r.stdout.trim()) >= 4;
	} catch {
		return false;
	}
}

const times = (v: unknown, seconds: number): number[] | null =>
	Array.isArray(v) && v.every((t, i) => typeof t === "number" && Number.isFinite(t) && t >= 0 && t <= seconds + 1 && (i === 0 || t > (v[i - 1] as number))) ? (v as number[]) : null;

/** The network's beats and bar starts of a sound file (file seconds), or null. Throws only when `signal` is aborted. */
export async function netBeats(file: string, seconds: number, { signal, onStatus }: { signal?: AbortSignal; onStatus?: (text: string) => void } = {}): Promise<NetBeats | null> {
	const weights = beatsReady();
	const part = modelSpec("separate-beats");
	if (!weights || !part || !(seconds >= 8) || seconds > BEATS_MAX_SECONDS || (await memoryCritical())) return null;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gaziyav-beats-"));
	let why = "";
	try {
		const mono = path.join(dir, "mono.f32");
		const out = path.join(dir, "beats.json");
		const read = await run(findTool("ffmpeg"), ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-map", "0:a:0", "-ac", "1", "-ar", "22050", "-f", "f32le", "-c:a", "pcm_f32le", mono], { timeout: 300, signal });
		if (read.status !== 0) why = "the sound couldn't be read";
		else {
			const r = await heavy(() =>
				run(ondevicePython("separate"), ["-I", bin("local-beats.py"), "--weights", weights, "--site", sitePackagesOf(part), "--input", mono, "--out", out], {
					heavy: true,
					timeout: Math.max(180, seconds * 2),
					signal,
					onLine: (line) => {
						if (line.startsWith("STATUS ")) onStatus?.(line.slice(7));
						else if (line.startsWith("ERROR ")) why = line.slice(6);
					},
				}),
			);
			if (r.status === 0 && fs.existsSync(out)) {
				const answer = JSON.parse(fs.readFileSync(out, "utf8")) as { beats?: unknown; downbeats?: unknown };
				const beats = times(answer.beats, seconds);
				const downbeats = times(answer.downbeats, seconds);
				if (beats && downbeats) return { beats, downbeats };
				why = "a wrong answer";
			} else why ||= `the helper ended with ${r.status}`;
		}
	} catch (e) {
		if (signal?.aborted) throw new CancelledError();
		why = (e as Error).message;
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	if (signal?.aborted) throw new CancelledError();
	// To the app's log by hand: the production build strips console calls, the shell keeps the server's stderr.
	process.stderr.write(`[beats] the beat model gave no answer (${why.replace(/\s+/g, " ").slice(0, 200)}): today's grid stands\n`);
	return null;
}
