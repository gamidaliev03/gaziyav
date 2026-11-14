"use client";

// AI avatar → Photo to avatar with a photo picked on the timeline: the lipsync moves the lips of a clip, so the photo
// first becomes a still clip in its place (same start, length and framing; one ⌘Z) — then the Lipsync steps below make
// it talk. As CapCut makes an avatar of a photo. The still is made on this Mac (studio/server/convert.ts, "still").
import { useRef, useState } from "react";
import { BatchCommand } from "@/commands";
import { DeleteElementsCommand, InsertElementCommand } from "@/commands/timeline";
import { Button } from "@/components/ui/button";
import type { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import { convertForImport } from "@/media/convert";
import { importToMedia } from "@/studio/client/editor-bridge";
import { useStudioStore } from "@/studio/client/studio-store";
import type { CreateTimelineElement, TimelineElement } from "@/timeline";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";

/** The still clip is this long (convert.ts STILL_SECONDS): the clip can't be longer than its file. */
const STILL_SECONDS = 15;

function selectedPhoto(editor: EditorCore): { trackId: string; element: TimelineElement & { mediaId: string } } | null {
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return null;
	const picked = editor.selection.getSelectedElements();
	for (const track of [tracks.main, ...tracks.overlay]) {
		for (const element of track.elements as TimelineElement[]) {
			if (element.type === "image" && picked.some((s) => s.elementId === element.id)) return { trackId: track.id, element: element as TimelineElement & { mediaId: string } };
		}
	}
	return null;
}

export function PhotoAvatar() {
	const t = useT();
	const editor = useEditor();
	const photoKey = useEditor((e) => {
		const p = selectedPhoto(e);
		return p ? `${p.element.id}|${p.element.mediaId}` : "";
	});
	const projectId = useEditor((e) => e.project.getActiveOrNull()?.metadata.id ?? "");
	const [progress, setProgress] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const abort = useRef<AbortController | null>(null);
	if (!photoKey) return null;
	const name = photoKey ? (editor.media.getAssets().find((a) => a.id === photoKey.split("|")[1])?.name ?? "") : "";

	const run = async () => {
		const photo = selectedPhoto(editor);
		const asset = photo && editor.media.getAssets().find((a) => a.id === photo.element.mediaId);
		if (!photo || !asset?.file) {
			setError(t("This photo's file isn't in the project any more. Import it again."));
			return;
		}
		const ctl = new AbortController();
		abort.current = ctl;
		setError(null);
		setProgress(0);
		try {
			const still = await convertForImport({ file: asset.file, kind: "video", still: true, onProgress: setProgress, signal: ctl.signal });
			const stem = asset.name.replace(/\.[^.]+$/, "");
			const media = await importToMedia(editor, new File([still], `${stem} · avatar.mp4`, { type: "video/mp4" }), projectId);
			if (ctl.signal.aborted) return;
			const seconds = Math.min(STILL_SECONDS, mediaTimeToSeconds({ time: photo.element.duration }));
			const base = buildElementFromMedia({
				mediaId: media.id,
				mediaType: "video",
				name: media.name,
				duration: mediaTimeFromSeconds({ seconds }),
				startTime: photo.element.startTime,
			});
			// The photo's framing stays: where it is, its size, opacity and look.
			const { transform, opacity, params } = photo.element as TimelineElement & { transform?: unknown; opacity?: unknown };
			const element = { ...base, ...(transform ? { transform } : {}), ...(opacity !== undefined ? { opacity } : {}), ...(params ? { params } : {}) } as CreateTimelineElement;
			const insert = new InsertElementCommand({ element, placement: { mode: "explicit", trackId: photo.trackId } });
			editor.command.execute({
				command: new BatchCommand([new DeleteElementsCommand({ elements: [{ trackId: photo.trackId, elementId: photo.element.id }] }), insert]),
			});
			editor.selection.setSelectedElements({ elements: [{ trackId: photo.trackId, elementId: insert.getElementId() }] });
			useStudioStore.getState().pin(projectId, insert.getElementId());
		} catch (e) {
			const err = e as Error;
			if (err.name !== "AbortError" && !ctl.signal.aborted) setError(err.message);
		} finally {
			if (abort.current === ctl) abort.current = null;
			setProgress(null);
		}
	};

	return (
		<div className="mx-3 mt-3 flex flex-col gap-2 rounded-md border p-2.5" data-photo-avatar>
			<p className="text-xs leading-snug">
				<span className="font-medium">{name}</span>
				<span className="text-muted-foreground"> — {t("this photo becomes the avatar: a still clip in its place, then the voice and the lips below.")}</span>
			</p>
			{progress === null ? (
				<Button size="sm" onClick={() => void run()} data-photo-avatar-run>
					{t("Use this photo")}
				</Button>
			) : (
				<div className="bg-muted relative h-8 overflow-hidden rounded-md" data-photo-avatar-running>
					<div className="bg-primary/25 absolute inset-y-0 left-0 transition-[width] duration-300" style={{ width: `${Math.round(progress * 100)}%` }} />
					<div className="relative flex h-full items-center justify-between px-3 text-xs">
						<span>{t("Making the clip")}</span>
						<button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => abort.current?.abort()}>
							{t("Cancel")}
						</button>
					</div>
				</div>
			)}
			{error && (
				<p className="text-destructive text-xs" data-photo-avatar-error>
					{error}
				</p>
			)}
		</div>
	);
}
