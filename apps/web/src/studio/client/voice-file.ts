// "Use audio file…": the user's own recording (or a stock voice) stands in for the voice-over — no MiniMax, free.
import type { EditorCore } from "@/core";
import { processMediaAssets } from "@/media/processing";
import { uploadOnce } from "./api";
import { useStudioStore } from "./studio-store";

/** `key`: the clip's draft key (or a project id: its chosen clip). */
export async function setVoiceFromFile(editor: EditorCore, key: string, file: File): Promise<void> {
	const projectId = key.split("|")[0];
	if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) {
		throw new Error("Choose an audio file (MP3, WAV, M4A)");
	}
	const up = await uploadOnce(`voicefile:${file.name}:${file.size}:${file.lastModified}`, file);
	if (!up.hasAudio) throw new Error("This file has no sound");
	let mediaId: string | undefined;
	const project = editor.project.getActiveOrNull();
	if (project?.metadata.id === projectId) {
		const [processed] = await processMediaAssets({ files: [file] });
		if (processed) mediaId = (await editor.media.addMediaAsset({ projectId, asset: processed }))?.id;
	}
	const store = useStudioStore.getState();
	store.patch(key, {
		voice: "file",
		voiceName: file.name,
		speech: { fileId: up.fileId, mediaId, name: file.name, seconds: up.duration, text: "", voiceId: "file" },
	});
}
