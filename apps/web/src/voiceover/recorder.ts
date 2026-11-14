// 🎙 Record voiceover (CapCut's timeline toolbar): the microphone records while the edit plays from the playhead; on
// stop the take goes into Media and onto an audio track where the recording started. One ⌘Z removes the clip.
import { toast } from "sonner";
import { DEMO } from "@/demo/flag";
import { create } from "zustand";
import { EditorCore } from "@/core";
import { processMediaAssets } from "@/media/processing";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { toElementDurationTicks } from "@/timeline/creation";
import type { MediaTime } from "@/wasm";

interface RecorderState {
	recording: boolean;
	startedAt: number;
}

export const useVoiceoverRecorder = create<RecorderState>()(() => ({ recording: false, startedAt: 0 }));

let session: { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; at: MediaTime } | null = null;
let takes = 0;

function pickMimeType(): string {
	for (const type of ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"]) {
		if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
	}
	return "";
}

export async function toggleVoiceover(): Promise<void> {
	if (session) {
		stopVoiceover();
		return;
	}
	const editor = EditorCore.getInstance();
	if (!editor.project.getActiveOrNull()) return;
	let stream: MediaStream;
	try {
		stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
	} catch {
		// the browser edition: the microphone is the browser's permission for the site, not the Mac's System Settings
		toast.error(DEMO ? "No microphone access: allow the microphone for this site in the browser" : "No microphone access: System Settings → Privacy → Microphone");
		return;
	}
	const mimeType = pickMimeType();
	const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
	const chunks: Blob[] = [];
	const at = editor.playback.getCurrentTime();
	session = { recorder, stream, chunks, at };
	recorder.ondataavailable = (event) => {
		if (event.data.size > 0) chunks.push(event.data);
	};
	recorder.onstop = () => void placeTake({ chunks, type: recorder.mimeType || mimeType || "audio/webm", at });
	recorder.start(250);
	useVoiceoverRecorder.setState({ recording: true, startedAt: performance.now() });
	// The edit plays under the voice, as in CapCut.
	if (!editor.playback.getIsPlaying()) editor.playback.play();
}

export function stopVoiceover(): void {
	if (!session) return;
	const { recorder, stream } = session;
	session = null;
	useVoiceoverRecorder.setState({ recording: false });
	const editor = EditorCore.getInstance();
	if (editor.playback.getIsPlaying()) editor.playback.pause();
	if (recorder.state !== "inactive") recorder.stop();
	for (const track of stream.getTracks()) track.stop();
}

async function placeTake({ chunks, type, at }: { chunks: Blob[]; type: string; at: MediaTime }): Promise<void> {
	if (chunks.length === 0) return;
	const editor = EditorCore.getInstance();
	const project = editor.project.getActiveOrNull();
	if (!project) return;
	takes += 1;
	const extension = type.includes("mp4") ? "m4a" : "webm";
	const file = new File(chunks, `Voiceover ${takes}.${extension}`, { type: type.split(";")[0] });
	try {
		const [processed] = await processMediaAssets({ files: [file] });
		if (!processed) throw new Error("unreadable recording");
		const asset = await editor.media.addMediaAsset({ projectId: project.metadata.id, asset: processed });
		if (!asset) throw new Error("not added");
		editor.timeline.insertElement({
			placement: { mode: "auto", trackType: "audio" },
			element: buildElementFromMedia({
				mediaId: asset.id,
				mediaType: "audio",
				name: asset.name,
				duration: toElementDurationTicks({ seconds: asset.duration }),
				startTime: at,
			}),
		});
		toast.success(`${asset.name} added under the clip`);
	} catch (error) {
		toast.error(`The recording could not be added: ${(error as Error).message}`);
	}
}
