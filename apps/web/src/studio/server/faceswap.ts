// Face swap on fal.ai (PixVerse Swap, the user's fal key): the clip's visible piece gets a new face (one of the app's
// made-up faces, or a photo the user has the right to use). One job: cut the piece → swap on fal → tag colours.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addSpend, falKey, fetchResult, modelFor, runFal, uploadFile } from "@/fal/server";
import { price } from "@/fal/models";
import { swapInput } from "@/fal/wire";
import { colourTags, matchColour, probe, trimVideo } from "./media";
import { StudioError } from "./errors";
import { getFile, newFile } from "./files";
import { type Job, startJob } from "./jobs";
import { faceFile } from "./my-faces";
import { faceLook } from "@/trending/looks";

/** The made-up faces that ship with the app (public/faces/<id>.jpg, made with the image generator). Nobody real. */
export const FACE_PRESETS = ["hero", "diva", "rebel", "noir", "elf", "viking", "idol", "sage", "android"] as const;

export function facePresetFile(id: string): string | null {
	if (!(FACE_PRESETS as readonly string[]).includes(id)) return null;
	const file = path.join(process.cwd(), "public", "faces", `${id}.jpg`);
	return fs.existsSync(file) ? file : null;
}

export function startFaceSwap(body: { fileId?: string; from?: number; to?: number; preset?: string; faceFileId?: string; myFace?: string; consent?: boolean; look?: string }) {
	if (!falKey()) throw new StudioError("Add your fal.ai key first: Settings → AI (fal.ai).");
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
					const model = modelFor("faceswap");
					const info = await probe(piece, signal);
					if (model.maxSeconds && info.duration > model.maxSeconds) throw new StudioError(`Face swap takes pieces up to ${model.maxSeconds} s. Trim the clip or split it.`);
					job.detail("swap", "sending the piece to fal.ai");
					const [video_url, image_url] = [await uploadFile(piece, signal), await uploadFile(face as string, signal)];
					const r = await runFal<{ video?: { url?: string } }>(
						model.id,
						swapInput(video_url, image_url),
						{ signal, resumeKey: `swap:${clip.path}:${from}:${to}:${face}`, expectSeconds: 60 + info.duration * 8, timeoutSeconds: 3600, onStatus: (t) => job.detail("swap", t), onProgress: (p) => job.progress("swap", p) },
					);
					const swapped = path.join(dir, "swapped.mp4");
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
