import { describe, expect, test } from "bun:test";
import { visibleStrings } from "../server/agent";
import { factProblems } from "../server/facts";
import { factSource, type PlanRequest } from "../server/plan";

const base: PlanRequest = { request: "", width: 1080, height: 1920, fps: 30, duration: 7, playhead: 0, alpha: true, clips: [], words: [], layers: [] };
const speech = "Привет всем сегодня расскажу как я монтирую ролики".split(" ").map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.3 }));

describe("fact guard on the agent's own components", () => {
	test("schema labels, colours, CSS and timings are not on-screen words", () => {
		const schema = JSON.stringify([
			{ key: "name", label: "Name", type: "text" },
			{ key: "role", label: "Role", type: "text" },
			{ key: "accent", label: "Accent", type: "color" },
			{ key: "cutAt", label: "Cut at", type: "time" },
			{ key: "plateWidth", label: "Plate width", type: "number", min: 0, max: 1 },
		]);
		const l = {
			kind: "Custom",
			from: 0,
			to: 5,
			props: { component: "Plate", name: "Илон Маск", role: "автор", accent: "#5B8CFF", shadow: "0 20px 60px rgba(0,0,0,.35)", ease: "out", align: "left", cutAt: 1.2, plateWidth: 0.7, schema, code: "export const Plate = (p) => <div>{p.name}</div>;" },
		};
		expect(visibleStrings(l)).toEqual(["Илон Маск", "автор"]);
		const src = factSource({ ...base, request: "фото Илона Маска разрезается на части, плашка с его фото", words: speech });
		const pseudo = visibleStrings(l).map((text) => ({ kind: "Custom", from: 0, to: 5, props: { text } }));
		expect(factProblems(pseudo, src)).toEqual([]);
	});
	test("a follow-up keeps the name an earlier request gave (history and current layers count as said)", () => {
		const r: PlanRequest = {
			...base,
			words: speech,
			request: "сделай плашку крупнее и опусти её к самому низу кадра",
			history: [
				{ role: "user", text: "плашка с именем «Иван Петров» и подписью «автор»" },
				{ role: "assistant", text: "Added a name plate" },
			],
			layers: [{ id: "a", kind: "Custom", from: 0, to: 7, props: { component: "NamePlate", name: "Иван Петров", role: "автор" } }],
		};
		const p = factProblems([{ kind: "LowerThird", from: 0, to: 7, props: { name: "Иван Петров", role: "автор" } }], factSource(r));
		expect(p).toEqual([]);
		// Still catches a name nobody gave.
		const bad = factProblems([{ kind: "LowerThird", from: 0, to: 7, props: { name: "Алекс Морган", role: "автор" } }], factSource(r));
		expect(bad.length).toBe(1);
	});
});
