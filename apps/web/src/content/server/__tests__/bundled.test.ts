// The full build's stickers are inside the app: the content route serves them from public/ (never the cloud), also when
// build.sh SLIM=1 kept a PNG as lossless WebP or a Lottie JSON gzipped. The light build has none: the cloud cache.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundledFileOf } from "../files";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gaziyav-bundled-"));
const put = (rel: string) => {
	fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
	fs.writeFileSync(path.join(root, rel), "x");
};
put("stickers/emoji3d/as-is.png");
put("stickers/emoji3d/slim.webp");
put("stickers/noto-animated/wave.json.gz");
put("stickers/noto-animated/plain.json");
const of = (part: string, file: string) => bundledFileOf({ part, file }, root);

describe("bundled cloud files", () => {
	test("a PNG inside as it is", () => {
		expect(of("stickers/emoji3d", "as-is.png")).toEqual({ path: path.join(root, "stickers/emoji3d/as-is.png"), type: "image/png" });
	});
	test("a PNG kept as WebP is served as WebP", () => {
		expect(of("stickers/emoji3d", "slim.png")).toEqual({ path: path.join(root, "stickers/emoji3d/slim.webp"), type: "image/webp" });
	});
	test("a gzipped JSON keeps its type and says it is gzip", () => {
		expect(of("stickers/noto-animated", "wave.json")).toEqual({ path: path.join(root, "stickers/noto-animated/wave.json.gz"), type: "application/json", encoding: "gzip" });
		expect(of("stickers/noto-animated", "plain.json")?.encoding).toBeUndefined();
	});
	test("not inside (the light build): null, the cloud serves it", () => {
		expect(of("stickers/emoji3d", "missing.png")).toBeNull();
		expect(of("stickers/noto-animated", "missing.json")).toBeNull();
	});
});
