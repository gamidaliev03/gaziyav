// A photo's Remove background, on this Mac and free: the bundled `neuralfx photo` (Apple Vision's subject lift on
// macOS 14+ — people, pets, things; its person segmentation before that) makes a PNG with alpha at the photo's own size
// in about a second (the very first run of a boot also loads Vision's model, ~20 s). Results are kept by the key the
// editor computes from the photo and the settings, next to the video results (ai-effects/), so a redo is instant.
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StudioError } from "./errors";
import { dataDir } from "./files";
import { findTool, run } from "./tools";

const OPTIONS = new Set(["mode", "color", "blur", "feather", "edge"]);

const resultPath = (key: string) => {
	const dir = path.join(dataDir(), "ai-effects");
	fs.mkdirSync(dir, { recursive: true });
	return path.join(dir, `${key}.png`);
};

/** The PNG for `key` (made now from the streamed photo, or the one made before). */
export async function photoMatte({ body, key, params }: { body: ReadableStream | null; key: string; params: Record<string, string | number> }): Promise<string> {
	if (!/^[0-9a-f]{16,64}$/.test(key)) throw new StudioError("Invalid AI effect key");
	const out = resultPath(key);
	if (fs.existsSync(out) && fs.statSync(out).size > 0) {
		await body?.cancel().catch(() => {});
		return out;
	}
	if (!body) throw new StudioError("Empty photo");
	const input = `${out}.in`;
	try {
		await pipeline(Readable.fromWeb(body as never), fs.createWriteStream(input));
		const args = ["photo", input, `${out}.part.png`];
		for (const [k, v] of Object.entries(params)) if (OPTIONS.has(k)) args.push(`--${k}`, String(v));
		let tool: string;
		try {
			tool = findTool("neuralfx");
		} catch {
			throw new StudioError("On-device AI effects aren't part of this build. Reinstall Gaziyav.");
		}
		const r = await run(tool, args, { timeout: 120, heavy: true });
		if (r.status !== 0 || !fs.existsSync(`${out}.part.png`)) {
			const line = (r.stderr || r.stdout || "").trim().split("\n").pop() ?? "";
			throw new StudioError(/nobody and nothing/.test(line) ? "Nothing to keep was found in this photo." : `Remove background failed: ${line.slice(0, 160)}`);
		}
		fs.renameSync(`${out}.part.png`, out);
		return out;
	} finally {
		fs.rmSync(input, { force: true });
		fs.rmSync(`${out}.part.png`, { force: true });
	}
}
