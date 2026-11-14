// CleanUp on this Mac: removes an object (a person, a logo, a burned-in caption) from a photo or a clip's visible piece
// and fills in the background (local-cleanup.py: SAM 2.1 tiny outline, carried along the clip; background from the
// other frames, LaMa for what no frame shows). Two jobs: the outline preview on one frame, and the removal itself.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ondevicePython, ondeviceUnavailable } from "@/ondevice/server";
import { modelDirs } from "@/platform/paths";
import { colourTags, matchColour, probe, trimVideo } from "./media";
import { StudioError } from "./errors";
import { getFile, newFile } from "./files";
import { type Job, startJob } from "./jobs";
import { heavy } from "./ml-queue";
import { findTool, reason, run } from "./tools";

const bin = (name: string) => path.join(process.env.STUDIO_BIN_DIR || "", name);

/** A click on the object (1) or on what must stay (0), as 0–1 of the frame. */
export type CleanupPoint = [number, number, 0 | 1];

interface CleanupBody {
	fileId?: string;
	/** Clip: the visible piece (seconds in the file); a photo has none. */
	from?: number;
	to?: number;
	/** The frame the user marked (seconds in the file). */
	at?: number;
	points?: unknown;
	/** The brush stroke (PNG, white = remove), uploaded as a file. */
	brushFileId?: string;
}

export function cleanupMarks(body: CleanupBody) {
	const points = (Array.isArray(body.points) ? body.points : [])
		.filter((p): p is [number, number, number] => Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === "number" && Number.isFinite(v)))
		.slice(0, 16)
		.map(([x, y, l]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)), l ? 1 : 0] as CleanupPoint);
	const brush = body.brushFileId ? getFile(String(body.brushFileId)).path : "";
	if (!points.some((p) => p[2] === 1) && !brush) throw new StudioError("Click the object or paint over it first.");
	return { points, brush };
}

function engine(input: string, out: string, at: number, points: CleanupPoint[], brush: string, extra: string[], job: Job, stage: string, signal: AbortSignal) {
	let error = "";
	const args = ["-I", bin("local-cleanup.py"), "--models", modelDirs.cleanup(), "--ffmpeg", findTool("ffmpeg"), "--input", input, "--out", out, "--at", at.toFixed(3), "--points", JSON.stringify(points), ...extra];
	if (brush) args.push("--brush", brush);
	let area = 0;
	return run("/usr/bin/nice", ["-n", "5", ondevicePython("cleanup"), ...args], {
		heavy: true,
		timeout: 3600,
		signal,
		onLine: (line) => {
			if (line.startsWith("PROGRESS ")) job.progress(stage, Number(line.slice(9)) || 0);
			else if (line.startsWith("STATUS ")) job.detail(stage, line.slice(7));
			else if (line.startsWith("AREA ")) area = Number(line.slice(5)) || 0;
			else if (line.startsWith("ERROR ")) error = line.slice(6);
		},
	}).then((r) => {
		if (r.status !== 0 || !fs.existsSync(out)) throw new StudioError(`CleanUp: ${error || reason(r)}`);
		return area;
	});
}

const isPhoto = (file: string) => /\.(png|jpe?g|webp|heic|bmp|tiff?)$/i.test(file);

/** The object's outline on the marked frame (PNG, white = object) — shown over the frame before removing. */
export function startCleanupPreview(body: CleanupBody) {
	const why = ondeviceUnavailable("cleanup");
	if (why) throw new StudioError(why);
	const src = getFile(String(body.fileId ?? ""));
	const { points, brush } = cleanupMarks(body);
	const at = Math.max(0, Number(body.at) || 0);
	return startJob("cleanup-preview", [{ id: "mask", title: "Finding the object", timeout: 300 }], async (job: Job) =>
		heavy(() =>
			job.step("mask", async (signal) => {
				const out = newFile("Object.png");
				const area = await engine(src.path, out.path, at, points, brush, ["--preview"], job, "mask", signal);
				return { fileId: out.id, area };
			}),
		),
	);
}

/** The object removed from a photo or from a clip's visible piece (plus ½ s handles); the result is a new file. */
export function startCleanup(body: CleanupBody) {
	const why = ondeviceUnavailable("cleanup");
	if (why) throw new StudioError(why);
	const src = getFile(String(body.fileId ?? ""));
	const { points, brush } = cleanupMarks(body);
	const photo = isPhoto(src.path);
	const from = Math.max(0, Number(body.from) || 0);
	const to = Number(body.to) > from ? Number(body.to) : from + 600;
	return startJob(
		"cleanup",
		[
			{ id: "cut", title: "Preparing", timeout: 300 },
			{ id: "clean", title: "Removing the object", timeout: 3600 },
		],
		async (job: Job) => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gaziyav-cleanup-"));
			try {
				const base = path.basename(src.name, path.extname(src.name)) || "Clip";
				if (photo) {
					const out = newFile(`${base} · CleanUp.png`);
					await job.step("clean", (signal) => heavy(() => engine(src.path, out.path, 0, points, brush, [], job, "clean", signal)));
					return { fileId: out.id, name: out.name, duration: 0, from: 0, photo: true };
				}
				const piece = path.join(dir, "piece.mp4");
				const colour = await colourTags(src.path);
				await job.step("cut", async (signal) => {
					const info = await probe(src.path, signal);
					await trimVideo(src.path, from, Math.max(0.1, Math.min(to, info.duration || to) - from), piece, signal);
				});
				const out = newFile(`${base} · CleanUp.mp4`);
				await job.step("clean", async (signal) => {
					const cleaned = path.join(dir, "clean.mp4");
					// The marked frame, counted from the start of the piece.
					const at = Math.max(0, (Number(body.at) || from) - from);
					await heavy(() => engine(piece, cleaned, at, points, brush, [], job, "clean", signal));
					if (!(await matchColour(cleaned, colour, out.path, signal))) fs.renameSync(cleaned, out.path);
				});
				const { duration } = await probe(out.path);
				return { fileId: out.id, name: out.name, duration, from, photo: false };
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		},
	);
}
