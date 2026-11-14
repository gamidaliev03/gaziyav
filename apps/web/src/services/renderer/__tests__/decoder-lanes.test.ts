import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks } from "@/timeline";
import type { MediaAsset } from "@/media/types";
import type { AnyBaseNode } from "../nodes/base-node";

// The scene builder imports the wasm bindings (ticks): loaded after the shim.
let buildScene: typeof import("../scene-builder").buildScene;
let VideoNode: typeof import("../nodes/video-node").VideoNode;
let BlurBackgroundNode: typeof import("../nodes/blur-background-node").BlurBackgroundNode;
let T = 0;
beforeAll(async () => {
	await installOpenCutWasm();
	({ buildScene } = await import("../scene-builder"));
	({ VideoNode } = await import("../nodes/video-node"));
	({ BlurBackgroundNode } = await import("../nodes/blur-background-node"));
	T = (await import("@/wasm")).TICKS_PER_SECOND;
});

const asset = (id: string) =>
	({ id, name: id, type: "video", file: new File([], `${id}.mp4`), url: `blob:${id}`, duration: 60 }) as unknown as MediaAsset;

/** A piece of `mediaId` at timeline `at` s showing source `from` s, `length` s long. */
function piece(id: string, mediaId: string, at: number, from: number, length: number) {
	return { id, type: "video", name: id, mediaId, startTime: at * T, duration: length * T, trimStart: from * T, trimEnd: (60 - from - length) * T, params: {} };
}

function keysOf(root: AnyBaseNode): Record<string, string> {
	const out: Record<string, string> = {};
	const walk = (node: AnyBaseNode, inTransition: boolean) => {
		if (node instanceof VideoNode) {
			const name = `${node.params.elementId ?? "?"}${inTransition ? "'" : ""}`;
			out[name] = node.params.decoderKey ?? node.params.mediaId;
		}
		for (const child of node.children) walk(child, inTransition || node.constructor.name === "TransitionNode");
	};
	walk(root, false);
	return out;
}

function scene(tracks: SceneTracks, blur = false) {
	return buildScene({
		tracks,
		mediaAssets: [asset("x"), asset("y")],
		duration: 60 * T,
		canvasSize: { width: 1080, height: 1920 },
		background: blur ? { type: "blur", blurIntensity: 20 } : { type: "color", color: "#000000" },
		isPreview: true,
	} as Parameters<typeof buildScene>[0]);
}

function tracksOf(main: unknown[], overlay: unknown[] = [], transitions: unknown[] = []): SceneTracks {
	return {
		main: { id: "main", type: "video", name: "Main", elements: main, transitions, muted: false, hidden: false },
		overlay: overlay.length ? [{ id: "ov", type: "video", name: "V2", elements: overlay, muted: false, hidden: false }] : [],
		audio: [],
	} as unknown as SceneTracks;
}

describe("decoder lanes", () => {
	test("jump cuts of one file alternate decoders; a plain split keeps its decoder", () => {
		const keys = keysOf(
			scene(
				tracksOf([
					piece("a", "x", 0, 0, 1.4),
					piece("b", "x", 1.4, 2, 1.4), // pause removed: jumps in the source
					piece("c", "x", 2.8, 3.4, 1), // plain split of b: continues it
					piece("d", "x", 3.8, 6, 1), // jumps again
					piece("e", "y", 4.8, 0, 1), // another file
					piece("f", "x", 5.8, 9, 1), // x after y: its own decoder is free again
				]),
			),
		);
		expect(keys).toEqual({ a: "x", b: "x#b", c: "x#b", d: "x", e: "y", f: "x" });
	});

	test("the same file on an overlay track has its own decoder", () => {
		const keys = keysOf(scene(tracksOf([piece("a", "x", 0, 0, 5)], [piece("o", "x", 1, 10, 2)])));
		expect(keys.a).toBe("x");
		expect(keys.o).toBe("x@ov");
	});

	test("a blurred backdrop reads its clip's decoder", () => {
		const root = scene(tracksOf([piece("a", "x", 0, 0, 1.4), piece("b", "x", 1.4, 2, 1.4)]), true);
		const backdrops = root.children.filter((n) => n instanceof BlurBackgroundNode).map((n) => (n.params as { decoderKey?: string }).decoderKey);
		expect(backdrops).toEqual([undefined, "x#b"]);
	});

	test("a transition's incoming clip reads the clip's own decoder unless the outgoing one does", () => {
		const transition = (from: string, to: string) => ({ id: `t-${from}`, type: "studio.transition.flash", fromElementId: from, toElementId: to, duration: 0.5 * T });
		const lanes = keysOf(
			scene(tracksOf([piece("a", "x", 0, 0, 1.4), piece("b", "x", 1.4, 2, 1.4)], [], [transition("a", "b")])),
		);
		expect(lanes["a'"]).toBe("x");
		expect(lanes["b'"]).toBe("x#b");
		// A plain split with a transition: both sides would read one decoder.
		const split = keysOf(
			scene(tracksOf([piece("a", "x", 0, 0, 1.4), piece("b", "x", 1.4, 1.4, 1.4)], [], [transition("a", "b")])),
		);
		expect(split["a'"]).toBe("x");
		expect(split["b'"]).toBe("x#transition-in");
	});
});
