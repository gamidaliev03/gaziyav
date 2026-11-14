import { expect, test } from "bun:test";
import { cssPath, describeAncestors, describeElement, type ElementLike } from "@/notes/describe";

type Node = ElementLike & { children: Node[] };
function el(tag: string, attrs: Record<string, string> = {}, opts: { text?: string; className?: string; id?: string } = {}): Node {
	const node: Node = {
		tagName: tag.toUpperCase(),
		id: opts.id ?? "",
		className: opts.className ?? "",
		attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
		getAttribute: (name) => attrs[name] ?? null,
		parentElement: null,
		innerText: opts.text ?? "",
		children: [],
		getBoundingClientRect: () => ({ x: 10.4, y: 20.6, width: 99.5, height: 30 }),
	};
	return node;
}
function put(parent: Node, ...kids: Node[]): Node {
	for (const k of kids) {
		k.parentElement = parent;
		parent.children.push(k);
	}
	return parent;
}

test("an element: test id, other data ids, role, label, folded text, rect", () => {
	const b = el("button", { "data-testid": "export-start", "data-kind": "primary", role: "button", "aria-label": "Export", "data-long": "x".repeat(80) }, { text: "  Export \n now " });
	const info = describeElement(b);
	expect(info.testid).toBe("export-start");
	expect(info.data).toEqual({ kind: "primary" });
	expect(info.role).toBe("button");
	expect(info.ariaLabel).toBe("Export");
	expect(info.text).toBe("Export now");
	expect(info.rect).toEqual({ x: 10, y: 21, w: 100, h: 30 });
	expect(info.path).toBe('button[data-testid="export-start"]');
});

test("text is cut at 120 characters", () => {
	expect(describeElement(el("p", {}, { text: "а".repeat(500) })).text.length).toBe(120);
});

test("the CSS path stops at the nearest test id or id, at most 4 steps, numbers same-tag siblings", () => {
	const body = el("body");
	const panel = el("div", { "data-testid": "inspector" });
	const row = el("div", {}, { className: "row hover:bg-x w-[3px]" });
	const a = el("span");
	const b = el("span");
	put(body, panel);
	put(panel, row);
	put(row, a, b);
	expect(cssPath(b)).toBe('div[data-testid="inspector"] > div.row > span:nth-of-type(2)');
	const deep = [el("div", {}, { id: "root" }), el("section"), el("div"), el("ul"), el("li"), el("i")];
	for (let i = 1; i < deep.length; i++) put(deep[i - 1], deep[i]);
	expect(cssPath(deep[5])).toBe("div > ul > li > i");
	const short = [el("main", {}, { id: "app" }), el("i")];
	put(short[0], short[1]);
	expect(cssPath(short[1])).toBe("main#app > i");
});

test("ancestors: up to 3 with a test id, nearest first", () => {
	const chain = [el("div", { "data-testid": "a" }), el("div", { "data-testid": "b" }), el("div"), el("div", { "data-testid": "c" }), el("div", { "data-testid": "d" }), el("span")];
	for (let i = 1; i < chain.length; i++) put(chain[i - 1], chain[i]);
	expect(describeAncestors(chain[5]).map((x) => x.testid)).toEqual(["d", "c", "b"]);
});
