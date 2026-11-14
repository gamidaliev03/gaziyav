import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TimelineElement } from "@/timeline";
import type { MediaTime } from "@/wasm";

// Multi-select: Opacity 30 on a clip with opacity keyframes only changed its hidden base value (the clip
// kept showing 100 %) while the panel said 30. Each clip now gets what the one-clip inspector does.
let apply: typeof import("@/components/editor/panels/properties/hooks/apply-params");
let playhead: typeof import("@/components/editor/panels/properties/hooks/use-element-playhead");
let animation: typeof import("@/animation");
let params: typeof import("@/params");
let registry: typeof import("@/params/registry");

beforeAll(async () => {
	await installOpenCutWasm();
	animation = await import("@/animation");
	params = await import("@/params");
	registry = await import("@/params/registry");
	apply = await import("@/components/editor/panels/properties/hooks/apply-params");
	playhead = await import("@/components/editor/panels/properties/hooks/use-element-playhead");
});

const t = (seconds: number) => Math.round(seconds * 120_000) as MediaTime;

function video(withOpacityKeys: boolean): TimelineElement {
	const element = {
		id: "v",
		type: "video",
		name: "v",
		startTime: t(0),
		duration: t(6),
		trimStart: t(0),
		trimEnd: t(0),
		mediaId: "m",
		params: {
			"transform.positionX": 0,
			"transform.positionY": 0,
			"transform.scaleX": 1,
			"transform.scaleY": 1,
			"transform.rotate": 0,
			opacity: 1,
		},
	} as unknown as TimelineElement;
	if (!withOpacityKeys) return element;
	const param = opacityOf(element);
	let animations = element.animations;
	for (const time of [t(0.5), t(4)]) {
		animations = animation.upsertPathKeyframe({
			animations,
			propertyPath: "opacity",
			time,
			value: 1,
			channelLayout: params.getParamChannelLayout({ param }),
			coerceValue: ({ value }) => params.coerceParamValue({ param, value }),
		});
	}
	return { ...element, animations };
}

function opacityOf(element: TimelineElement) {
	const param = registry.getElementParams({ element }).find((p) => p.key === "opacity");
	if (!param) throw new Error("no opacity param");
	return param;
}

function shownOpacity(element: TimelineElement, atSeconds: number) {
	const { localTime } = playhead.getElementPlayhead({
		playheadTime: t(atSeconds),
		startTime: element.startTime,
		duration: element.duration,
	});
	return animation.resolveAnimationPathValueAtTime({
		animations: element.animations,
		propertyPath: "opacity",
		localTime,
		fallbackValue: Number(element.params.opacity),
	});
}

function setOpacity(element: TimelineElement, value: number, atSeconds: number): TimelineElement {
	const { localTime, isPlayheadWithinElementRange } = playhead.getElementPlayhead({
		playheadTime: t(atSeconds),
		startTime: element.startTime,
		duration: element.duration,
	});
	const updates = apply.buildParamUpdates({
		element,
		entries: [{ param: opacityOf(element), value }],
		localTime,
		isPlayheadWithinElementRange,
	});
	return { ...element, ...updates } as TimelineElement;
}

describe("a value set on several clips at once", () => {
	test("a clip with keyframes for it gets a key at the playhead and shows the new value", () => {
		const next = setOpacity(video(true), 0.3, 2);
		expect(shownOpacity(next, 2)).toBeCloseTo(0.3, 6);
		// the other keys stay
		expect(shownOpacity(next, 4)).toBeCloseTo(1, 6);
	});

	test("a clip without keyframes changes its value", () => {
		const next = setOpacity(video(false), 0.3, 2);
		expect(next.params.opacity).toBeCloseTo(0.3, 6);
		expect(next.animations).toBeUndefined();
	});

	test("the panel reads a keyframed value at the playhead, not its base", () => {
		const element = { ...video(true), params: { ...video(true).params, opacity: 0.2 } } as TimelineElement;
		expect(shownOpacity(element, 2)).toBeCloseTo(1, 6);
	});
});
