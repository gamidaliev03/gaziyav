"use client";

// Every sound or song taken from the Audio library onto the timeline also shows up in Media (copied once per
// project), so "Reveal media" works for it and it can be reused like any file.
import { useEffect } from "react";
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { processMediaAssets } from "@/media/processing";
import type { TimelineElement } from "@/timeline";

const inFlight = new Set<string>();

async function copyIntoMedia(url: string, name: string) {
	const editor = EditorCore.getInstance();
	const project = editor.project.getActiveOrNull();
	if (!project || inFlight.has(url)) return;
	if (editor.media.getAssets().some((a) => a.librarySourceUrl === url)) return;
	inFlight.add(url);
	try {
		const response = await fetch(url);
		if (!response.ok) return;
		const blob = await response.blob();
		const ext = /\.(mp3|wav|m4a|ogg|aac|flac)(\?|$)/i.exec(url)?.[1] ?? "mp3";
		const fileName = /\.[a-z0-9]{2,4}$/i.test(name) ? name : `${name}.${ext}`;
		const [processed] = await processMediaAssets({ files: [new File([blob], fileName, { type: blob.type || "audio/mpeg" })] });
		if (!processed) return;
		if (editor.project.getActiveOrNull()?.metadata.id !== project.metadata.id) return;
		await editor.media.addMediaAsset({ projectId: project.metadata.id, asset: { ...processed, origin: "source", librarySourceUrl: url } });
	} catch {
		// Offline or the library file moved: the clip still plays from its own copy.
	} finally {
		inFlight.delete(url);
	}
}

/** Mounted once in the editor: watches the timeline for library audio clips and copies their files into Media. */
export function LibraryMediaSync() {
	const tracks = useEditor((e) => e.scenes.getActiveSceneOrNull()?.tracks ?? null, ["scenes", "timeline"]);
	useEffect(() => {
		if (!tracks) return;
		const timer = window.setTimeout(() => {
			const seen = new Map<string, string>();
			for (const track of tracks.audio) {
				for (const e of track.elements as TimelineElement[]) {
					if (e.type === "audio" && e.sourceType === "library" && e.sourceUrl) seen.set(e.sourceUrl, e.name);
				}
			}
			for (const [url, name] of seen) void copyIntoMedia(url, name);
		}, 600);
		return () => window.clearTimeout(timer);
	}, [tracks]);
	return null;
}
