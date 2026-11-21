// Face swap on fal.ai (PixVerse Swap, the user's fal key): the clip's visible piece gets a new face (one of the app's
// made-up faces, or a photo the user has the right to use). One job: cut the piece → swap on fal → tag colours.
// Principle 1: with no fal key, or fal's balance empty, the same press swaps on this Mac (local-faceswap.py: HyperSwap +
// GFPGAN, the on-device «Face swap» model) when that model is installed, and says so once; otherwise one line.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addSpend, falKey, fetchResult, modelFor, runFal, uploadFile } from "@/fal/server";
import { price } from "@/fal/models";
import { swapInput } from "@/fal/wire";
import { colourTags, matchColour, probe, trimVideo } from "./media";
import { CancelledError, StudioError } from "./errors";
import { getFile, newFile } from "./files";
import { type Job, startJob } from "./jobs";
import { faceFile } from "./my-faces";
import { faceLook } from "@/trending/looks";
import { ondevicePython, ondeviceUnavailable } from "@/ondevice/server";
import { LIPMARKS, modelDirs } from "@/platform/paths";
import { findTool, reason, run } from "./tools";

const helper = (name: string) => path.join(process.env.STUDIO_BIN_DIR || "", name);
const LOCAL_LINE = "Swapped on this Mac for free (the on-device face model): top up fal.ai to get its swap back.";
/** fal refused this very try for its balance or its key (not a network fault, a safety refusal or a bad input). */
const takesOver = (e: unknown) => /balance is empty|top it up|\b402\b|didn't accept the key|add your fal\.ai key/i.test(String((e as Error)?.message ?? e));

/** Whether the on-device face model can swap now. This edition's manifest may not know the model at all (its lookup
 * throws «Unknown on-device feature»): then there is no free route, and the paid one runs exactly as before. */
function localSwapReady(): boolean {
	try {
		return !ondeviceUnavailable("faceswap") && fs.existsSync(helper("local-faceswap.py"));
	} catch {
		return false;
	}
}

/** The swap on this Mac (the same call as the on-device manager's self-test, Core ML first, then the CPU). */
async function swapHere(job: Job, piece: string, face: string, out: string, signal: AbortSignal) {
	const python = ondevicePython("faceswap");
	const args = ["-I", helper("local-faceswap.py"), "--models", modelDirs.faceswap(), "--lipmarks", helper(LIPMARKS), "--ffmpeg", findTool("ffmpeg"), "--face", face, "--video", piece, "--out", out];
	let error = "";
	const onLine = (line: string) => {
		if (line.startsWith("PROGRESS ")) job.progress("swap", Number(line.slice(9)) || 0);
		else if (line.startsWith("ERROR ")) error = line.slice(6);
	};
	const length = Math.max(1, (await probe(piece, signal)).duration);
	let r = await run(python, args, { heavy: true, timeout: Math.max(900, length * 60), signal, onLine });
	if (signal.aborted) throw new CancelledError();
	if (r.status !== 0 || !fs.existsSync(out)) r = await run(python, [...args, "--cpu"], { heavy: true, timeout: Math.max(900, length * 120), signal, onLine });
	if (signal.aborted) throw new CancelledError();
	if (r.status !== 0 || !fs.existsSync(out)) throw new StudioError(`The face swap on this Mac didn't work: ${error || reason(r)}`);
	job.detail("swap", LOCAL_LINE);
}

/** The made-up faces that ship with the app (public/faces/<id>.jpg, made with the image generator). Nobody real. */
export const FACE_PRESETS = ["hero", "diva", "rebel", "noir", "elf", "viking", "idol", "sage", "android"] as const;

export function facePresetFile(id: string): string | null {
	if (!(FACE_PRESETS as readonly string[]).includes(id)) return null;
	const file = path.join(process.cwd(), "public", "faces", `${id}.jpg`);
	return fs.existsSync(file) ? file : null;
}

export function startFaceSwap(body: { fileId?: string; from?: number; to?: number; preset?: string; faceFileId?: string; myFace?: string; consent?: boolean; look?: string }) {
	// the free route: the on-device face model, when it is installed (Settings → On-device AI)
	const local = localSwapReady();
	if (!falKey() && !local) throw new StudioError("Add your fal.ai key first: Settings → Services (fal.ai) — or download the free Face swap model in Settings → AI on this Mac.");
	const clip = getFile(String(body.fileId ?? ""));
	// A trending look restyles the person's own face: no other face, nothing to consent to.
	const look = faceLook(body.look);
	if (look) throw new StudioError("Face looks need the on-device face model, which this app doesn't carry. Pick a face to swap instead.");
	// One of «My faces» (kept for every project), a photo sent with the request, or a made-up face.
	const mine = body.myFace ? faceFile(String(body.myFace)) : null;
	if (body.myFace && !mine) throw new StudioError("That face is no longer on this Mac. Add it again.");
	const face = look ? null : body.preset ? facePresetFile(String(body.preset)) : (mine ?? (body.faceFileId ? getFile(String(body.faceFileId)).path : null));
	if (!face && !look) throw new StudioError("Pick a face first.");
	if (!look && !body.preset && body.consent !== true) throw new StudioError("Confirm you have the right to use this person's face.");
	const from = Math.max(0, Number(body.from) || 0);
	const to = Number(body.to) > from ? Number(body.to) : from + 600;
	return startJob(
		"faceswap",
		[
			{ id: "cut", title: "Preparing the clip", timeout: 300 },
			{ id: "swap", title: "Swapping the face on fal.ai", timeout: 3600 },
		],
		async (job: Job) => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gaziyav-faceswap-"));
			try {
				const piece = path.join(dir, "piece.mp4");
				const colour = await colourTags(clip.path);
				await job.step("cut", async (signal) => {
					const info = await probe(clip.path, signal);
					const length = Math.max(0.1, Math.min(to, info.duration || to) - from);
					await trimVideo(clip.path, from, length, piece, signal);
				});
				const out = newFile(`${path.basename(clip.name, path.extname(clip.name)) || "Clip"} · Face swap.mp4`);
				await job.step("swap", async (signal) => {
					const swapped = path.join(dir, "swapped.mp4");
					// no fal key: on this Mac, nothing paid. With a key the paid swap is always tried first (an earlier
					// «empty» mark never skips it); only a refusal of THIS try goes on here.
					if (local && !falKey()) {
						await swapHere(job, piece, face as string, swapped, signal);
						if (!(await matchColour(swapped, colour, out.path, signal))) fs.renameSync(swapped, out.path);
						return;
					}
					const model = modelFor("faceswap");
					const info = await probe(piece, signal);
					if (model.maxSeconds && info.duration > model.maxSeconds) throw new StudioError(`Face swap takes pieces up to ${model.maxSeconds} s. Trim the clip or split it.`);
					job.detail("swap", "sending the piece to fal.ai");
					let r: { video?: { url?: string } };
					try {
						const [video_url, image_url] = [await uploadFile(piece, signal), await uploadFile(face as string, signal)];
						r = await runFal<{ video?: { url?: string } }>(
							model.id,
							swapInput(video_url, image_url),
							{ signal, resumeKey: `swap:${clip.path}:${from}:${to}:${face}`, expectSeconds: 60 + info.duration * 8, timeoutSeconds: 3600, onStatus: (t) => job.detail("swap", t), onProgress: (p) => job.progress("swap", p) },
						);
					} catch (error) {
						// fal refused for its balance or its key: the same press goes on here when the model is installed
						if (signal.aborted || !local || !takesOver(error)) throw error;
						await swapHere(job, piece, face as string, swapped, signal);
						if (!(await matchColour(swapped, colour, out.path, signal))) fs.renameSync(swapped, out.path);
						return;
					}
					await fetchResult(r.video?.url, swapped, signal);
					const cost = price(model, info.duration);
					job.charge(cost);
					addSpend("faceswap", cost);
					if (!(await matchColour(swapped, colour, out.path, signal))) fs.renameSync(swapped, out.path);
				});
				const { duration } = await probe(out.path);
				return { fileId: out.id, name: out.name, duration, from };
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		},
	);
}
