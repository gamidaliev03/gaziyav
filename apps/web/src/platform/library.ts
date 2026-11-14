// The content library: music, sound effects, Lottie graphics and fonts. The app ships one (Kadr's library, in
// Contents/Resources/library — the owner holds the rights to redistribute it, decided 2026-10-22); a folder the
// user picks (On-device AI → My library folder) is read instead, read-only and in place.
// A folder laid out like Kadr's (Library/Music/library.json …) is read through its indexes; any other folder
// is scanned for audio files.
import fs from "node:fs";
import path from "node:path";
import { bundledBinDir } from "./paths";
import { loadSettings } from "@/studio/server/settings";

const KADR_PARTS = ["Music", "Sound Effects", "Graphics", "Fonts"];

/** The folder the user picked ("" in settings = none). STUDIO_KADR_DIR overrides it for tests. */
export function userLibraryRoot(): string | null {
	const folder = process.env.STUDIO_KADR_DIR || loadSettings().libraryFolder;
	if (!folder) return null;
	try {
		return fs.statSync(folder).isDirectory() ? folder : null;
	} catch {
		return null;
	}
}

/** The library that ships inside the app (Contents/Resources/library: music, sound effects, graphics, fonts). */
export function bundledKadrLibrary(): string | null {
	const bin = bundledBinDir();
	const dir = bin ? path.join(bin, "..", "library") : null;
	return dir && KADR_PARTS.some((p) => fs.existsSync(path.join(dir, p, "library.json"))) ? dir : null;
}

/**
 * The Kadr-style "Library" folder inside the user's folder (or the folder itself), if it is one — otherwise the
 * one inside the app, so every Mac has ready music, sounds and graphics right after install.
 */
export function userKadrLibrary(): string | null {
	const root = userLibraryRoot();
	if (root) {
		for (const dir of [path.join(root, "Library"), root]) {
			if (KADR_PARTS.some((p) => fs.existsSync(path.join(dir, p, "library.json")))) return dir;
		}
	}
	return bundledKadrLibrary();
}
