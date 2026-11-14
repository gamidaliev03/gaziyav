// The written export is looked at before «Done» (app/api/export/verify): null = whole, else what is wrong, in words.
import { t } from "@/i18n";

type Expect = { seconds?: number; fps?: number | null; audio?: boolean; format?: string; width?: number | null } | undefined;

const AUDIO = /^(mp3|wav|m4a|aac|ogg|flac|opus)$/i;

export async function checkWrittenExport(file: string, expect: Expect): Promise<string | null> {
	return (await lookAtWrittenExport(file, expect)).problem;
}

/**
 * The same look, saying also whether it was really made: `verified` is true only when the server looked at the file
 * and found it whole (a check that could not run never blocks an export, but it proves nothing either — the
 * «file is verified» signal, export/proven.ts, is sent only for a file that was looked at).
 */
export async function lookAtWrittenExport(file: string, expect: Expect): Promise<{ problem: string | null; verified: boolean }> {
	try {
		const res = await fetch("/api/export/verify", {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-studio": "1" },
			body: JSON.stringify({ file, expect: { seconds: expect?.seconds ?? 0, fps: expect?.fps ?? null, audio: expect?.audio === true, video: !(expect && (AUDIO.test(expect.format ?? "") || (expect.width == null && expect.fps == null && expect.audio))) } }),
			signal: AbortSignal.timeout(120_000),
		});
		if (!res.ok) return { problem: null, verified: false }; // an older server, a refused check: never block a good export on the check itself
		const r = (await res.json()) as { ok?: boolean; problems?: { text: string; vars?: Record<string, string | number> }[] };
		if (r.ok !== false) return { problem: null, verified: r.ok === true };
		return { problem: (r.problems ?? []).map((p) => t(p.text, p.vars)).join("; ") || t("the file can't be read as a video or sound file"), verified: false };
	} catch {
		return { problem: null, verified: false };
	}
}
