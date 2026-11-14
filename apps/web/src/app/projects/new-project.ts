// One way to start a video: a dated name, a format (16:9 by default, as CapCut) and, optionally, the files to bring in.
import type { EditorCore } from "@/core";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import type { TCanvasSize } from "@/project/types";
import { useLang } from "@/i18n";

export type ProjectFormat = "9:16" | "16:9" | "1:1";

export const PROJECT_FORMATS: Array<{ id: ProjectFormat; label: string; hint: string; size: TCanvasSize }> = [
	{ id: "16:9", label: "Wide", hint: "YouTube, presentations", size: { width: 1920, height: 1080 } },
	{ id: "9:16", label: "Vertical", hint: "Reels, TikTok, Shorts", size: { width: 1080, height: 1920 } },
	{ id: "1:1", label: "Square", hint: "Feed posts", size: { width: 1080, height: 1080 } },
];

/** "Video Oct 21, 03:10" — unique enough to tell drafts apart without typing a name. */
export function defaultProjectName(date = new Date(), lang: "en" | "ru" = currentLang()): string {
	const day = lang === "ru" ? date.toLocaleDateString("ru-RU", { month: "short", day: "numeric" }) : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
	const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
	return lang === "ru" ? `Видео ${day}, ${time}` : `Video ${day}, ${time}`;
}

/** The interface language (a Russian interface names the draft in Russian: «Видео 7 нояб., 03:30»). */
function currentLang(): "en" | "ru" {
	try {
		return useLang.getState().lang === "ru" ? "ru" : "en";
	} catch {
		return "en";
	}
}

/** CapCut: a project named like one already there gets « (2)», then « (3)»… (two drafts started in one minute). */
export function uniqueProjectName(base: string, taken: readonly string[]): string {
	if (!taken.includes(base)) return base;
	for (let n = 2; ; n++) {
		const name = `${base} (${n})`;
		if (!taken.includes(name)) return name;
	}
}

const FORMAT_KEY = "gaziyav.project.format";

/** The format the last project was given (New project → Video format): the next one starts with it (check-flow, 06.11). */
export function lastFormat(): ProjectFormat | undefined {
	try {
		const v = localStorage.getItem(FORMAT_KEY);
		return PROJECT_FORMATS.some((f) => f.id === v) ? (v as ProjectFormat) : undefined;
	} catch {
		return undefined;
	}
}

let remembered: ProjectFormat | undefined;
function rememberFormat(size: TCanvasSize | undefined) {
	const f = size && PROJECT_FORMATS.find((x) => x.size.width === size.width && x.size.height === size.height);
	if (!f || f.id === remembered) return;
	remembered = f.id;
	try {
		localStorage.setItem(FORMAT_KEY, f.id);
	} catch {}
}

// Files dropped on the start page wait here until the editor of their new project is open.
let pending: { projectId: string; files: File[] } | null = null;

/** The files to import into this project right after it opens (once). */
export function takePendingImport(projectId: string): File[] {
	if (!pending || pending.projectId !== projectId) return [];
	const { files } = pending;
	pending = null;
	return files;
}

export async function createProject(
	editor: EditorCore,
	{ format, files }: { format?: ProjectFormat; files?: File[] } = {},
): Promise<string> {
	// 16:9 (the default) lets the first clip set the exact canvas, as CapCut's «Original»; an explicit 9:16 or 1:1 stays —
	// and so does the format the last project was given (a creator of vertical video picks 9:16 once).
	const want = format ?? lastFormat();
	const chosen = want && want !== "16:9" ? PROJECT_FORMATS.find((f) => f.id === want)?.size : undefined;
	const name = uniqueProjectName(defaultProjectName(), editor.project.getSavedProjects().map((project) => project.name));
	const projectId = await editor.project.createNewProject({ name, canvasSize: chosen });
	if (format) rememberFormat(PROJECT_FORMATS.find((f) => f.id === format)?.size);
	// Video format changed in the editor afterwards: remembered too (until another project is opened).
	const off = editor.project.subscribe(() => {
		const active = editor.project.getActiveOrNull();
		if (!active || active.metadata.id !== projectId) return off();
		rememberFormat(active.settings.canvasSize);
	});
	pending = files?.length ? { projectId, files } : null;
	useAssetsPanelStore.getState().setActiveTab("media");
	return projectId;
}
