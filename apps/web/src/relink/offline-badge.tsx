"use client";

// On a clip whose media file is lost (relink/offline.ts): «⚠ Offline · name» over the whole clip, striped, with
// Relink… — the user picks the folder the file is in now. Nothing shows while the project's media is still loading.
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import type { TimelineElement } from "@/timeline/types";
import { isDamaged } from "./damaged";
import { clipMediaId, pickFolderAndRelink } from "./offline";

export function OfflineMediaBadge({ element }: { element: TimelineElement }) {
	const t = useT();
	const mediaId = clipMediaId(element);
	const offline = useEditor(
		(e) => !!mediaId && !e.media.isLoadingMedia() && !e.project.getIsLoading() && !e.media.getAssets().some((asset) => asset.id === mediaId),
		["media", "project"],
	);
	if (!offline) return null;
	const damaged = !!mediaId && isDamaged(mediaId);
	return (
		<div
			className="pointer-events-none absolute inset-0 z-10 flex items-center gap-1.5 overflow-hidden px-2 text-[11px] font-medium text-white"
			style={{ background: "repeating-linear-gradient(135deg, rgba(190,40,40,0.85) 0 8px, rgba(120,20,20,0.85) 8px 16px)" }}
			data-media-offline={element.id}
			data-media-damaged={damaged ? element.id : undefined}
			title={damaged ? t("The project's copy of this clip's file is damaged: it can't be read") : t("The media file of this clip is missing from the project")}
		>
			<span className="truncate">{damaged ? t("⚠ Damaged file · {name}", { name: element.name }) : t("⚠ Offline · {name}", { name: element.name })}</span>
			<button
				type="button"
				data-relink
				className="pointer-events-auto shrink-0 rounded bg-white/25 px-1.5 py-0.5 hover:bg-white/35"
				onPointerDown={(event) => event.stopPropagation()}
				onMouseDown={(event) => event.stopPropagation()}
				onClick={(event) => {
					event.stopPropagation();
					pickFolderAndRelink(EditorCore.getInstance());
				}}
			>
				{t("Relink…")}
			</button>
		</div>
	);
}
