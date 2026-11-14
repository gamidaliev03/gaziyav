// Project-level tools for Claude (Gaziyav AI works inside one open project; Claude also needs to make and open them,
// save and export). Each runs the same editor code as the projects page and the Export window.
import { EditorCore } from "@/core";
import { openDiskExport } from "@/export/disk";
import { saveToFolder } from "@/export/deliver";
import type { ExportFormat, ExportOptions, ExportQuality } from "@/export";
import { outputSize } from "@/export/target";
import { floatToFrameRate, frameRateToFloat } from "@/fps/utils";
import { appPrefs } from "@/settings/app-prefs";
import { TICKS_PER_SECOND } from "@/wasm";
import { aspectOf, platformOf } from "./platforms";
import { coverImage } from "./share-tools";

type Args = Record<string, unknown>;

export interface ProjectToolResult {
	content: string;
	/** A page to go to once the answer is sent (opening a project). */
	navigate?: string;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const S = (description: string) => ({ type: "string", description });

const ASPECTS: Record<string, { width: number; height: number }> = {
	"9:16": { width: 1080, height: 1920 },
	"16:9": { width: 1920, height: 1080 },
	"1:1": { width: 1080, height: 1080 },
	"4:5": { width: 1080, height: 1350 },
};

export const PROJECT_TOOL_SPECS = [
	{
		name: "list_projects",
		description: "Every Gaziyav project on this Mac (id, name, last change), newest first, and which one is open.",
		parameters: obj({}),
	},
	{
		name: "create_project",
		description: "Make a new empty project and open it. Aspect 9:16 (Reels/TikTok/Shorts, default), 16:9, 1:1 or 4:5.",
		parameters: obj({ name: S("Project name"), aspect: S("9:16 | 16:9 | 1:1 | 4:5") }, ["name"]),
	},
	{
		name: "open_project",
		description: "Open a project by id (from list_projects). Wait for the answer, then call get_project.",
		parameters: obj({ id: S("Project id") }, ["id"]),
	},
	{
		name: "rename_project",
		description: "Rename a project (the open one when no id).",
		parameters: obj({ id: S("Project id (default: the open one)"), name: S("New name") }, ["name"]),
	},
	{
		name: "save_project",
		description: "Save the open project now (Gaziyav also saves by itself after every change).",
		parameters: obj({}),
	},
	{
		name: "export_project",
		description: "Render the open project to a file and say where it is (platform, quality, resolution, fps, format, from/to, loudness, cover; media = one Media item as its file).",
		parameters: obj({ platform: S("tiktok | reels | shorts | youtube | feed | vk | telegram"), name: S("File name without extension (default: the project name)"), quality: S("low | medium | high | very_high"), resolution: { type: "number", description: "Short side px" }, fps: { type: "number", description: "Frames per second" }, format: S("mp4 | mov | webm"), from: { type: "number", description: "Seconds" }, to: { type: "number", description: "Seconds" }, loudness: { type: "boolean", description: "−14 LUFS" }, cover: S("Seconds or a Media picture id"), media: S("A Media id: export that item's file instead"), folder: S("Absolute folder (default ~/Movies/Gaziyav)") }),
	},
	{
		name: "close_project",
		description: "Close the open project and go back to the projects list.",
		parameters: obj({}),
	},
	{
		name: "export_media",
		description: "Write one Media item (a video, picture or sound of the open project: imported, downloaded or generated) to a file and say where it is. For other apps (the DaVinci Resolve plugin) that need the file itself.",
		parameters: obj({ media: S("Media id (from get_project)"), name: S("File name without extension (default: the item's name)"), folder: S("Absolute folder (default ~/Movies/Gaziyav)") }, ["media"]),
	},
];

export const PROJECT_TOOL_NAMES = new Set(PROJECT_TOOL_SPECS.map((t) => t.name));

const editor = () => EditorCore.getInstance();

async function projectsLoaded() {
	if (!editor().project.getIsInitialized()) await editor().project.loadAllProjects();
}

export async function runProjectTool(name: string, args: Args, page: "editor" | "projects"): Promise<ProjectToolResult> {
	const project = editor().project;
	// On the projects page the last project may still be loaded, but nothing is open for the user.
	const open = page === "editor" ? project.getActiveOrNull() : null;
	switch (name) {
		case "list_projects": {
			await projectsLoaded();
			const list = project.getSavedProjects().map((p) => ({
				id: p.id,
				name: p.name,
				updated: new Date(p.updatedAt).toISOString().slice(0, 16).replace("T", " "),
			}));
			return { content: JSON.stringify({ open: open ? { id: open.metadata.id, name: open.metadata.name } : null, projects: list }) };
		}
		case "create_project": {
			const aspect = ASPECTS[String(args.aspect ?? "9:16")] ?? ASPECTS["9:16"];
			const id = await project.createNewProject({ name: String(args.name || "Claude edit").slice(0, 80), canvasSize: aspect });
			return { content: `Created project ${id} (${aspect.width}×${aspect.height}); it is opening now. Call get_project next.`, navigate: `/editor/${id}` };
		}
		case "open_project": {
			const id = String(args.id ?? "");
			await projectsLoaded();
			const found = project.getSavedProjects().find((p) => p.id === id || p.id.startsWith(id));
			if (!found) throw new Error(`No project ${id}. Call list_projects.`);
			if (open?.metadata.id === found.id) return { content: `“${found.name}” is already open.` };
			return { content: `Opening “${found.name}”. Call get_project next.`, navigate: `/editor/${found.id}` };
		}
		case "rename_project": {
			const id = String(args.id || open?.metadata.id || "");
			if (!id) throw new Error("No project is open; give its id.");
			const nameTo = String(args.name ?? "").trim().slice(0, 80);
			if (!nameTo) throw new Error("Give the new name.");
			await project.renameProject({ id, name: nameTo });
			return { content: `Renamed to “${nameTo}”.` };
		}
		case "save_project": {
			if (!open) throw new Error("No project is open.");
			await project.saveCurrentProject();
			return { content: `Saved “${open.metadata.name}”.` };
		}
		case "export_project": {
			if (!open) throw new Error("No project is open.");
			if (args.media) return runProjectTool("export_media", args, page);
			const { options, said } = await exportOptions(args);
			const disk = await openDiskExport();
			const t0 = Date.now();
			const result = await project.export({ options: { ...options, toFile: disk?.writer } });
			project.clearExportState();
			if (result.cancelled || !result.success || !(result.buffer || result.bytes)) disk?.discard();
			if (result.cancelled) throw new Error("The export was cancelled (in the app). Call export again if the user wants it.");
			if (!result.success || !(result.buffer || result.bytes)) throw new Error(`${result.error || "The export failed."} Check the timeline with get_project, then try again.`);
			const folder = String(args.folder || (await defaultFolder()));
			const base = String(args.name || open.metadata.name || "Gaziyav").replace(/[/:\\]+/g, "_").slice(0, 80);
			const ext = options.format === "mov" ? "mov" : options.format === "webm" ? "webm" : "mp4";
			if (result.buffer) disk?.discard();
			const path = result.buffer
				? await saveToFolder({ data: result.buffer, folder, name: `${base}.${ext}` })
				: await (disk as NonNullable<typeof disk>).moveTo(folder, `${base}.${ext}`).catch((error: unknown) => {
						// (a folder that is gone: the rendered master is not left on disk until the app quits)
						disk?.discard();
						throw error;
					});
			const bytes = result.bytes ?? result.buffer?.byteLength ?? 0;
			void import("@/platform/desktop-sections").then((m) => m.noteExport(path)).catch(() => {});
			return { content: `Exported ${path} · ${said} · ${(bytes / 1e6).toFixed(1)} MB · ${Math.round((Date.now() - t0) / 1000)} s to render` };
		}
		case "export_media": {
			if (!open) throw new Error("No project is open.");
			const id = String(args.media || "");
			const asset = editor()
				.media.getAssets()
				.find((a) => a.id === id || (id.length >= 6 && a.id.startsWith(id)));
			if (!asset?.file) throw new Error("No Media item with that id in the open project. Call get_project for the ids.");
			const folder = String(args.folder || (await defaultFolder()));
			const fromName = /\.([a-z0-9]{2,5})$/i.exec(asset.file.name || "")?.[1];
			const ext = (fromName || (asset.type === "audio" ? "wav" : asset.type === "image" ? "png" : "mp4")).toLowerCase();
			const base = String(args.name || asset.name || "media")
				.replace(/\.[a-z0-9]{2,5}$/i, "")
				.replace(/[/:\\]+/g, "_")
				.slice(0, 80);
			const path = await saveToFolder({ data: asset.file, folder, name: `${base}.${ext}` });
			return { content: JSON.stringify({ path, media: asset.id, name: asset.name, type: asset.type, duration: asset.duration ?? null }) };
		}
		case "close_project":
			if (open) await project.saveCurrentProject();
			return { content: "Closed; the projects list is open.", navigate: "/projects" };
		default:
			throw new Error(`Unknown tool ${name}.`);
	}
}

async function defaultFolder(): Promise<string> {
	const r = await fetch("/api/mcp/movies", { headers: { "X-Studio": "1" } });
	const j = (await r.json()) as { folder?: string };
	if (!j.folder) throw new Error("Give a folder to export to.");
	return j.folder;
}

/** Export options from Claude's words: a platform preset first, then whatever it named. */
async function exportOptions(args: Args): Promise<{ options: ExportOptions; said: string }> {
	const editor = EditorCore.getInstance();
	const p = editor.project.getActive();
	const canvas = p.settings.canvasSize;
	const preset = args.platform ? platformOf(args.platform) : null;
	if (args.platform && !preset) throw new Error(`Unknown platform "${String(args.platform)}": tiktok, reels, shorts, youtube, feed, vk, telegram, dzen, rutube.`);
	const notes: string[] = [];
	if (preset && aspectOf(canvas) !== preset.aspect) notes.push(`note: ${preset.label} wants ${preset.aspect}, the project is ${aspectOf(canvas)} (project settings or edit make_vertical)`);
	const seconds = editor.timeline.getTotalDuration() / TICKS_PER_SECOND;
	if (preset?.maxSeconds && seconds > preset.maxSeconds) notes.push(`note: ${preset.label} takes up to ${preset.maxSeconds} s, this is ${Math.round(seconds)} s`);
	const quality = (["low", "medium", "high", "very_high"].includes(String(args.quality)) ? args.quality : (preset?.quality ?? "high")) as ExportQuality;
	const format = (["mp4", "mov", "webm"].includes(String(args.format)) ? args.format : "mp4") as ExportFormat;
	const prefs = appPrefs();
	const options: ExportOptions = { format, quality, includeAudio: true, normalizeLoudness: args.loudness === undefined ? !!preset : !!args.loudness, targetLufs: preset?.lufs ?? prefs.targetLufs, hardwareEncoding: prefs.hardwareEncoding };
	const resolution = Number(args.resolution);
	const size = resolution >= 240 && resolution <= 4320 ? outputSize(canvas, resolution) : canvas;
	if (size.width !== canvas.width || size.height !== canvas.height) options.size = size;
	const fps = Number(args.fps);
	if (fps >= 1 && fps <= 120) options.fps = floatToFrameRate(fps);
	if (args.from !== undefined || args.to !== undefined) {
		const from = Math.max(0, Number(args.from) || 0);
		const to = Math.min(seconds, args.to === undefined ? seconds : Number(args.to));
		if (!(to - from >= 0.1)) throw new Error("from/to: give a range of at least 0.1 s inside the timeline.");
		options.range = { start: Math.round(from * TICKS_PER_SECOND), end: Math.round(to * TICKS_PER_SECOND) };
	}
	const cover = await coverImage(args.cover);
	if (cover) options.cover = cover;
	const length = options.range ? (options.range.end - options.range.start) / TICKS_PER_SECOND : seconds;
	const said = [`${Math.round(length * 10) / 10} s`, `${size.width}×${size.height}`, `${Math.round(fps >= 1 ? fps : frameRateToFloat(p.settings.fps))} fps`, format, quality, options.normalizeLoudness ? `${options.targetLufs} LUFS` : "", cover ? "cover" : "", ...notes].filter(Boolean).join(" · ");
	return { options, said };
}
