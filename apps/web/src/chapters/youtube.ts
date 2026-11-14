// «Copy chapters for YouTube»: «00:00 Title» lines for a video's description, with one line when YouTube would not
// show them (fewer than three chapters, or one shorter than 10 seconds).
import { toast } from "sonner";
import { t } from "@/i18n";
import { TICKS_PER_SECOND } from "@/wasm";
import { currentChapters } from "./commands";
import { type Chapter, youtubeChapters } from "./model";

const name = (c: Chapter) => c.title ?? t("Scene {n}", { n: c.index + 1 });

export function youtubeText(): { text: string; problem: "fewer" | "short" | null } | null {
	const chapters = currentChapters();
	if (chapters.length === 0) return null;
	return youtubeChapters(chapters, TICKS_PER_SECOND, name);
}

export async function copyYouTubeChapters(): Promise<boolean> {
	const out = youtubeText();
	if (!out) {
		toast.warning(t("No scenes yet. Find scenes first."));
		return false;
	}
	try {
		await navigator.clipboard.writeText(out.text);
	} catch {
		toast.error(t("Could not copy. Try again."));
		return false;
	}
	(window as unknown as { __chapterYouTube?: string }).__chapterYouTube = out.text;
	const warn =
		out.problem === "fewer"
			? t("YouTube shows chapters only when there are at least three.")
			: out.problem === "short"
				? t("YouTube needs every chapter to be at least 10 seconds long.")
				: null;
	if (warn) toast.warning(t("Chapters copied."), { description: warn });
	else toast.success(t("Chapters copied. Paste them into the video's description."));
	return true;
}
