// Clips whose media file is no longer in the project. The project keeps its own copy of every imported file, so moving,
// renaming or unplugging the user's originals changes nothing; a copy can still be lost (an import cut short by a crash
// or a full disk, a damaged library, an old profile). Such a clip played and exported as black without a word. Now the
// clip says «Offline», the project says so when it opens, the export refuses to render it black, and Relink finds the
// files in the folder the user points at (by name and size, in any sub-folder) and puts them back under the same clips,
// trims and effects.
import { toast } from "sonner";
import type { EditorCore } from "@/core";
import { t } from "@/i18n";
import { processMediaAssets } from "@/media/processing";
import type { MediaAsset } from "@/media/types";
import { storageService } from "@/services/storage/service";
import type { SceneTracks, TimelineElement } from "@/timeline/types";
import { damagedOriginalOf, isDamaged } from "./damaged";

export interface OfflineClip {
	trackId: string;
	elementId: string;
	mediaId: string;
	name: string;
}

/** The media id of a clip that plays a file of the project (not a library sound: those have their own «Missing»). */
export function clipMediaId(element: TimelineElement): string | null {
	if (!("mediaId" in element) || !element.mediaId) return null;
	if ((element as { sourceType?: string }).sourceType === "library") return null;
	return element.mediaId;
}

/**
 * Clips on these tracks whose file is not among the project's media. `rendered`: only what an export would draw or
 * play (a hidden track or clip, a muted sound track, is left out).
 */
export function offlineClips({
	tracks,
	assets,
	rendered = false,
}: {
	tracks: SceneTracks;
	assets: readonly MediaAsset[];
	rendered?: boolean;
}): OfflineClip[] {
	const have = new Set(assets.map((asset) => asset.id));
	const out: OfflineClip[] = [];
	for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio]) {
		const off = track as { hidden?: boolean; muted?: boolean; type?: string };
		if (rendered && (off.hidden || (off.type === "audio" && off.muted))) continue;
		for (const element of track.elements as TimelineElement[]) {
			const mediaId = clipMediaId(element);
			if (!mediaId || have.has(mediaId)) continue;
			if (rendered && (element as { hidden?: boolean }).hidden) continue;
			out.push({ trackId: track.id, elementId: element.id, mediaId, name: element.name });
		}
	}
	return out;
}

/** Every offline clip of the open project, on all its timelines. */
export function projectOfflineClips(editor: EditorCore): OfflineClip[] {
	const assets = editor.media.getAssets();
	return editor.scenes.getScenes().flatMap((scene) => offlineClips({ tracks: scene.tracks, assets }));
}

/** «Interview A.mp4, B.mp4 +3» */
export function offlineNames(clips: readonly OfflineClip[]): string {
	const names = [...new Set(clips.map((clip) => clip.name))];
	return names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
}

/** The export's answer when clips have no file: it refuses (it rendered them as black before). */
export function offlineExportError(clips: readonly OfflineClip[]): string {
	// a stored file that is there but can't be read says so by name (relink/damaged.ts)
	const bad = clips.filter((clip) => isDamaged(clip.mediaId));
	const lost = clips.filter((clip) => !isDamaged(clip.mediaId));
	const parts: string[] = [];
	if (bad.length)
		parts.push(t("{n} clip(s) have a damaged media file: {names}. Relink a good copy (the ⚠ mark on the clip) or remove them, then export again.", { n: bad.length, names: offlineNames(bad) }));
	if (lost.length)
		parts.push(t("{n} clip(s) have no media file (offline): {names}. Relink them (the ⚠ mark on the clip) or remove them, then export again.", { n: lost.length, names: offlineNames(lost) }));
	return parts.join(" ");
}

/**
 * The clips on these tracks whose media is an editing copy with a damaged original behind it (relink/damaged.ts): the
 * export renders them from the copy. Unique names of the originals.
 */
export function damagedOriginalsIn(tracks: SceneTracks): string[] {
	const names = new Set<string>();
	for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio]) {
		for (const element of track.elements as TimelineElement[]) {
			const mediaId = clipMediaId(element);
			const name = mediaId ? damagedOriginalOf(mediaId) : null;
			if (name) names.add(name);
		}
	}
	return [...names];
}

/** What the export says when it renders from editing copies because their originals are damaged. */
export function fromCopyNotice(names: readonly string[]): string {
	return t("The original of {names} is damaged: the video is made from its editing copy.", { names: names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "") });
}

/** Said once when a project with offline clips opens. */
export function reportOfflineOnOpen(editor: EditorCore): void {
	const originals = [...new Set(editor.scenes.getScenes().flatMap((scene) => damagedOriginalsIn(scene.tracks)))];
	if (originals.length) toast.warning(fromCopyNotice(originals), { id: "media-original-damaged", duration: 15_000 });
	const clips = projectOfflineClips(editor);
	if (!clips.length) return;
	const bad = clips.filter((clip) => isDamaged(clip.mediaId));
	if (bad.length) {
		toast.warning(t("{n} clip(s) have a damaged file: {names}", { n: bad.length, names: offlineNames(bad) }), {
			id: "media-offline",
			description: t("The project's copy of the file can't be read. The rest plays; Relink: choose the folder with a good copy."),
			duration: 15_000,
			action: { label: t("Relink…"), onClick: () => pickFolderAndRelink(editor) },
		});
		return;
	}
	toast.warning(t("{n} clip(s) are offline: {names}", { n: clips.length, names: offlineNames(clips) }), {
		id: "media-offline",
		description: t("Their media files are missing from the project. Relink: choose the folder they are in now."),
		duration: 15_000,
		action: { label: t("Relink…"), onClick: () => pickFolderAndRelink(editor) },
	});
}

const stem = (name: string) => name.toLowerCase().replace(/\.[^./]+$/, "");

/**
 * The file in the picked folder for a lost one: the same name (any letter case), the same size first. An import that
 * was converted on the way in (MKV, AVI, WMV…) is stored as «name.mp4»: then the user's own «name.mkv» is it — the
 * same first name, a file of the same kind first.
 */
export function pickRelinkFile(
	files: readonly File[],
	want: { name: string; size?: number; type?: string },
): File | null {
	const sameName = files.filter((file) => file.name.toLowerCase() === want.name.toLowerCase());
	const exact = sameName.find((file) => want.size !== undefined && file.size === want.size) ?? sameName[0];
	if (exact) return exact;
	const sameStem = files.filter((file) => stem(file.name) === stem(want.name));
	return sameStem.find((file) => !!want.type && file.type.startsWith(want.type)) ?? sameStem[0] ?? null;
}

/**
 * Puts files back under the offline clips: each lost file is looked for among `files` (pickRelinkFile). A found file is processed as an import and stored under the old media id, so every clip that
 * used it plays again as it was edited. Returns the media ids relinked and the names not found.
 */
export async function relinkFromFiles(editor: EditorCore, files: readonly File[]): Promise<{ relinked: string[]; missing: string[] }> {
	const project = editor.project.getActiveOrNull();
	if (!project) return { relinked: [], missing: [] };
	const projectId = project.metadata.id;
	const clips = projectOfflineClips(editor);
	const wanted = new Map<string, { name: string; size?: number; type?: string; origin?: MediaAsset["origin"] }>();
	for (const clip of clips) {
		if (wanted.has(clip.mediaId)) continue;
		const meta = await storageService.loadMediaMetadata({ projectId, id: clip.mediaId });
		wanted.set(clip.mediaId, { name: meta?.name ?? clip.name, size: meta?.size, type: meta?.type, origin: meta?.origin });
	}
	const relinked: string[] = [];
	const missing: string[] = [];
	for (const [mediaId, want] of wanted) {
		const file = pickRelinkFile(files, want);
		if (!file) {
			missing.push(want.name);
			continue;
		}
		try {
			const [processed] = await processMediaAssets({ files: [file] });
			if (!processed) throw new Error("unreadable");
			const { editingOriginal, ...rest } = processed;
			const asset: MediaAsset = { ...rest, id: mediaId, origin: want.origin ?? "source" };
			await storageService.saveMediaAsset({ projectId, mediaAsset: asset });
			if (editingOriginal) await editor.media.keepEditingOriginal({ projectId, of: asset, file: editingOriginal });
			relinked.push(mediaId);
		} catch (error) {
			console.error("[relink] could not store", want.name, error);
			missing.push(want.name);
		}
	}
	if (relinked.length) await editor.media.loadProjectMedia({ projectId });
	return { relinked, missing };
}

/** Relink…: the user picks the folder the files are in now (sub-folders included). */
export function pickFolderAndRelink(editor: EditorCore): void {
	if (typeof document === "undefined") return;
	for (const old of document.querySelectorAll("input[data-relink-folder]")) old.remove();
	const input = document.createElement("input");
	input.type = "file";
	input.multiple = true;
	(input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
	input.setAttribute("data-relink-folder", "");
	input.style.display = "none";
	document.body.appendChild(input);
	input.addEventListener(
		"change",
		() => {
			const files = Array.from(input.files ?? []);
			input.remove();
			void relinkAndSay(editor, files);
		},
		{ once: true },
	);
	input.addEventListener("cancel", () => input.remove(), { once: true });
	input.click();
}

async function relinkAndSay(editor: EditorCore, files: File[]): Promise<void> {
	const id = toast.loading(t("Looking for the offline files…"));
	try {
		const { relinked, missing } = await relinkFromFiles(editor, files);
		if (relinked.length && !missing.length) toast.success(t("Relinked {n} file(s)", { n: relinked.length }), { id });
		else if (relinked.length) toast.warning(t("Relinked {n} file(s); not in that folder: {names}", { n: relinked.length, names: missing.join(", ") }), { id, duration: 12_000 });
		else toast.error(t("Not in that folder: {names}", { names: missing.join(", ") || "—" }), { id, duration: 12_000 });
	} catch (error) {
		toast.error(t("Couldn't relink"), { id, description: error instanceof Error ? error.message : undefined });
	}
}
