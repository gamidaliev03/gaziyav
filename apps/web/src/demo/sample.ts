// The demo's sample project: three short abstract clips on the main track, a voice line and a music bed under them, a
// title over the start — made by script/web-demo.sh (ffmpeg and the Mac's `say`), shipped with the site in sample/.
// The project is built with the editor's own commands, as the user would build it, then kept in the browser (the demo's
// own IndexedDB / OPFS names): a reload opens it where the visitor left it, «Start over» builds it again.
import { EditorCore } from "@/core";
import { importToMedia, placeOnTimeline } from "@/studio/client/editor-bridge";
import { storageService } from "@/services/storage/service";
import { TEXT_PRESETS } from "@/text/presets";
import { buildPresetElement } from "@/text/insert-preset";

export const SAMPLE_FILES = [
	{ file: "clip-1.mp4", kind: "video" },
	{ file: "clip-2.mp4", kind: "video" },
	{ file: "clip-3.mp4", kind: "video" },
	{ file: "voice-{lang}.m4a", kind: "audio" },
	{ file: "music.m4a", kind: "audio" },
] as const;

// the project open in this browser, and which one is the sample
const CURRENT = "gzdemo.project";
const SAMPLE = "gzdemo.sample";

const read = (key: string): string | null => {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
};
const write = (key: string, id: string | null) => {
	try {
		if (id) localStorage.setItem(key, id);
		else localStorage.removeItem(key);
	} catch {}
};

export const storedSampleId = (): string | null => read(SAMPLE);
/** The project the editor opens next time (the File menu's new / opened / chosen project). */
export const rememberProject = (id: string | null) => write(CURRENT, id);

/** The project to open: the one the visitor had open in this browser, else the sample (built now the first time). */
export async function openSample({ ru, onStep }: { ru: boolean; onStep: (done: number, total: number) => void }): Promise<string> {
	for (const kept of [read(CURRENT), read(SAMPLE)]) {
		if (!kept) continue;
		const project = await storageService.loadProject({ id: kept }).catch(() => null);
		if (project) {
			rememberProject(kept);
			return kept;
		}
	}
	return buildSample({ ru, onStep });
}

export async function buildSample({ ru, onStep }: { ru: boolean; onStep: (done: number, total: number) => void }): Promise<string> {
	const editor = EditorCore.getInstance();
	const total = SAMPLE_FILES.length + 1;
	onStep(0, total);
	const files = await Promise.all(
		SAMPLE_FILES.map(async ({ file }) => {
			const response = await fetch(`sample/${file.replace("{lang}", ru ? "ru" : "en")}`);
			if (!response.ok) throw new Error(`sample/${file}: ${response.status}`);
			const blob = await response.blob();
			return new File([blob], file.replace("{lang}", ru ? "ru" : "en"), { type: blob.type || (file.endsWith(".mp4") ? "video/mp4" : "audio/mp4") });
		}),
	);
	const id = await editor.project.createNewProject({ name: ru ? "Пример" : "Sample", canvasSize: { width: 1280, height: 720 } });
	let at = 0;
	let done = 0;
	for (const [index, file] of files.entries()) {
		const asset = await importToMedia(editor, file, undefined, "source");
		const spec = SAMPLE_FILES[index];
		if (spec.kind === "video") {
			placeOnTimeline(editor, asset, at);
			at += asset.duration ?? 4;
		} else {
			placeOnTimeline(editor, asset, spec.file.startsWith("voice") ? 0.6 : 0);
		}
		onStep(++done, total);
	}
	const preset = TEXT_PRESETS.find((p) => p.id === "title-sub") ?? TEXT_PRESETS[0];
	if (preset) {
		const { element } = await buildPresetElement({ editor, preset, content: ru ? "Привет из Gaziyav" : "Hello from Gaziyav", at: 0.3 });
		editor.timeline.insertElement({ element, placement: { mode: "auto" } });
	}
	// the sample is where the visitor starts: its building is not an undo step of theirs
	editor.command.clear();
	await editor.project.saveCurrentProject();
	onStep(total, total);
	write(SAMPLE, id);
	rememberProject(id);
	return id;
}

/** «Start over»: the sample project is removed from this browser and built again on the next open. */
export async function forgetSample(): Promise<void> {
	const id = storedSampleId();
	write(SAMPLE, null);
	rememberProject(null);
	if (id) await EditorCore.getInstance().project.deleteProjects({ ids: [id] }).catch(() => {});
}
