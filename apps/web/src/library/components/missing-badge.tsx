"use client";

// On a library sound's clip whose file is gone (the library no longer has it and the project has no copy): «⚠ Missing»
// with Replace — the Audio library opens on a search for its name and the sound picked there takes the clip's place.
import { useEffect } from "react";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import type { AudioElement } from "@/timeline/types";
import { libraryCopy, useMissingLibrary } from "../missing";
import { useT } from "@/i18n";

const checked = new Set<string>();

/** Once per URL and session: is the file still there (the library's, else the project's copy)? */
async function check(url: string) {
	if (checked.has(url)) return;
	checked.add(url);
	try {
		// The library route serves GET with ranges (not HEAD): one byte. Only «not found» means gone.
		const r = await fetch(url, { headers: { Range: "bytes=0-0" } });
		void r.body?.cancel();
		if (r.status !== 404 && r.status !== 410) return;
	} catch {
		return;
	}
	if (await libraryCopy(url)) return;
	useMissingLibrary.getState().markMissing(url);
}

export function MissingLibraryBadge({
	element,
	trackId,
}: {
	element: AudioElement;
	trackId: string;
}) {
	const t = useT();
	const url = element.sourceType === "library" ? element.sourceUrl : null;
	const missing = useMissingLibrary((s) => !!url && s.urls.has(url));
	useEffect(() => {
		if (url) void check(url);
	}, [url]);
	if (!missing) return null;
	const replace = () => {
		// A song from Music ducks under the voice (library/client.ts); a sound effect doesn't.
		const kind = element.params?.duckUnderVoice ? "music" : "sfx";
		useMissingLibrary.getState().startReplace({
			trackId,
			elementId: element.id,
			name: element.name,
			kind,
		});
		const panel = useAssetsPanelStore.getState();
		panel.setActiveTab("sounds");
		panel.setSection("sounds", kind);
	};
	return (
		<div
			className="pointer-events-none absolute inset-0 z-10 flex items-center gap-1.5 bg-black/55 px-2 text-[11px] text-white"
			data-library-missing={element.id}
		>
			<span className="truncate">{t("⚠ Missing · {name}", { name: element.name })}</span>
			<button
				type="button"
				data-library-replace
				className="pointer-events-auto shrink-0 rounded bg-white/20 px-1.5 py-0.5 font-medium hover:bg-white/30"
				onPointerDown={(e) => e.stopPropagation()}
				onClick={(e) => {
					e.stopPropagation();
					replace();
				}}
			>
				Replace
			</button>
		</div>
	);
}
