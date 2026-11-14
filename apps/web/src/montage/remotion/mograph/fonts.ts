// The overlays' own looks (OFL, files of the app, the same in the player and the export): a camcorder / VCR pixel face,
// a comic-book face, a HUD monospace. Loaded once, on first use.
import "../local-fonts";
import { loadFont as bangers } from "@remotion/google-fonts/Bangers";
import { loadFont as shareTechMono } from "@remotion/google-fonts/ShareTechMono";
import { loadFont as vt323 } from "@remotion/google-fonts/VT323";

const loaders = {
	vcr: () => vt323("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily,
	comic: () => bangers("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily,
	mono: () => shareTechMono("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily,
};
const loaded = new Map<keyof typeof loaders, string>();

export function lookFont(key: keyof typeof loaders): string {
	let family = loaded.get(key);
	if (!family) {
		try {
			family = loaders[key]();
		} catch {
			family = "monospace";
		}
		loaded.set(key, family);
	}
	return `${family}, ui-monospace, monospace`;
}
