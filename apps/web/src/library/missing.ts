// library, offline for a remote one). The clip plays from the project's own copy (Media keeps one of every library
// sound used: media/library-sync.tsx); with no copy either, the timeline marks the clip «Missing · Replace» and the
// export goes on without it (silence there). In CapCut such a project just loses its music.
import { create } from "zustand";

export interface ReplaceTarget {
	trackId: string;
	elementId: string;
	name: string;
	kind: "music" | "sfx";
}

interface MissingLibraryState {
	/** Library file URLs that neither the library nor the project's Media could give. */
	urls: ReadonlySet<string>;
	/** «Replace» was pressed on this clip: the next sound picked in the Audio library takes its place. */
	replacing: ReplaceTarget | null;
	markMissing: (url: string) => void;
	markFound: (url: string) => void;
	startReplace: (target: ReplaceTarget | null) => void;
}

export const useMissingLibrary = create<MissingLibraryState>()((set) => ({
	urls: new Set(),
	replacing: null,
	markMissing: (url) =>
		set((s) => (s.urls.has(url) ? s : { urls: new Set([...s.urls, url]) })),
	markFound: (url) =>
		set((s) =>
			s.urls.has(url)
				? { urls: new Set([...s.urls].filter((u) => u !== url)) }
				: s,
		),
	startReplace: (replacing) => set({ replacing }),
}));

/** The project's own copy of a library sound (its Media file), or null. */
export async function libraryCopy(url: string): Promise<File | null> {
	const { EditorCore } = await import("@/core");
	return (
		EditorCore.getInstance()
			.media.getAssets()
			.find((a) => a.librarySourceUrl === url)?.file ?? null
	);
}
