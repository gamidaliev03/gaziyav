import { describe, expect, test } from "bun:test";
import { classify, existingComponents, visibleStrings } from "../server/agent";
import type { PlanRequest } from "../server/plan";

const base: PlanRequest = { request: "", width: 608, height: 1080, fps: 60, duration: 7, playhead: 0, alpha: true, clips: [], words: [], layers: [] };

describe("AI composition agent", () => {
	test("creates by default; the kit only when asked to be quick", () => {
		expect(classify({ ...base, request: "hook сверху" }).mode).toBe("full");
		expect(classify({ ...base, request: "быстро хук сверху" }).mode).toBe("quick");
		expect(classify({ ...base, request: "сделай анимацию карты на основе его слов" }).mode).toBe("full");
		expect(classify({ ...base, request: "сделай полноэкранное интро на первые 2 секунды" }).mode).toBe("full");
		expect(classify({ ...base, request: "карточка с фактом" }).mode).toBe("full");
		expect(classify({ ...base, request: "карточка с фактом из готовых" }).mode).toBe("quick");
		expect(classify({ ...base, request: "hook", force: "full" }).mode).toBe("full");
	});
	test("a follow-up on its own components stays in full mode and keeps their code", () => {
		const r = { ...base, request: "сделай крупнее", layers: [{ id: "a", kind: "Custom", from: 0, to: 2, props: { component: "Intro", code: "export const Intro = () => null;" } }] };
		expect(classify(r).mode).toBe("full");
		expect(existingComponents(r)).toEqual({ Intro: "export const Intro = () => null;" });
	});
	test("the fact check reads on-screen text, not code or timings", () => {
		const code = "import React from 'react';\nexport const M = (p) => { const halo = S(3);\n return (<div>{p.title}</div>); };";
		const strings = visibleStrings({ kind: "Custom", from: 0, to: 2, props: { component: "M", code, title: "топ-5 настроек", at: 3.05, items: 'json:[{"label":"для инстаграма","at":2.1}]' } });
		expect(strings).toEqual(["топ-5 настроек", "для инстаграма"]);
	});
});
