import { describe, expect, test } from "bun:test";
import { watchCutPress } from "@/timeline/cut-press";

// The "+" at a cut covers the middle of both clips' trim handles: a press-and-drag there selected the cut instead of
// trimming. Past 3 px it becomes a trim of the pressed side's edge; a press that doesn't move stays a click.
function setup({ startX, cutX = 100 }: { startX: number; cutX?: number }) {
	const target = new EventTarget();
	const trims: { side: string; startX: number; x: number }[] = [];
	let trimmed = 0;
	watchCutPress({
		startX,
		startY: 20,
		cutX,
		target,
		startTrim: ({ side, startX, x }) => {
			trims.push({ side, startX, x });
			return true;
		},
		onTrim: () => trimmed++,
	});
	const move = (x: number) => target.dispatchEvent(Object.assign(new Event("mousemove"), { clientX: x, clientY: 20 }));
	const up = () => target.dispatchEvent(new Event("mouseup"));
	return { trims, move, up, trimmed: () => trimmed };
}

describe("press on a cut's +", () => {
	test("left half dragged → trims the left clip's end, from where it was pressed", () => {
		const g = setup({ startX: 98 });
		g.move(97);
		expect(g.trims).toEqual([]);
		g.move(80);
		expect(g.trims).toEqual([{ side: "left", startX: 98, x: 80 }]);
		expect(g.trimmed()).toBe(1);
		g.move(60); // the trim controller has the gesture now: no second hand-off
		expect(g.trims.length).toBe(1);
	});

	test("right half dragged → trims the right clip's start", () => {
		const g = setup({ startX: 102 });
		g.move(120);
		expect(g.trims).toEqual([{ side: "right", startX: 102, x: 120 }]);
	});

	test("a press released without moving stays a click", () => {
		const g = setup({ startX: 99 });
		g.move(101);
		g.up();
		g.move(140);
		expect(g.trims).toEqual([]);
		expect(g.trimmed()).toBe(0);
	});
	test("a press whose mouseup was swallowed ends at the first move without a button: no trim later", () => {
		const target = new EventTarget();
		let trims = 0;
		watchCutPress({ startX: 98, startY: 20, cutX: 100, target, startTrim: () => { trims++; return true; }, onTrim: () => {} });
		const move = (x: number, buttons: number) => target.dispatchEvent(Object.assign(new Event("mousemove"), { clientX: x, clientY: 20, buttons }));
		move(40, 0);
		move(20, 1);
		expect(trims).toBe(0);
	});
	test("mouseup is heard in the capture phase", () => {
		const added: Array<[string, boolean | undefined]> = [];
		const target = { addEventListener: (type: string, _l: unknown, capture?: boolean) => added.push([type, capture]), removeEventListener: () => {} };
		watchCutPress({ startX: 98, startY: 20, cutX: 100, target: target as unknown as EventTarget, startTrim: () => true, onTrim: () => {} });
		expect(added).toContainEqual(["mouseup", true]);
	});
});
