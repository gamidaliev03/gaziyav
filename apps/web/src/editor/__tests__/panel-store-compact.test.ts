import { beforeEach, expect, test } from "bun:test";
import { usePanelStore } from "../panel-store";

beforeEach(() => usePanelStore.setState({ compactSide: "media", compactFolded: false, sizes: {}, revision: 0 }));

test("a tab opens its panel in the side column, unfolding it", () => {
	usePanelStore.getState().setCompactFolded(true);
	usePanelStore.getState().setCompactSide("details", true);
	expect(usePanelStore.getState()).toMatchObject({ compactSide: "details", compactFolded: false });
});

test("choosing a side without opening keeps a folded column folded", () => {
	usePanelStore.getState().setCompactFolded(true);
	usePanelStore.getState().setCompactSide("details");
	expect(usePanelStore.getState()).toMatchObject({ compactSide: "details", compactFolded: true });
});

test("a double-click resets only its own group and rebuilds the groups", () => {
	usePanelStore.getState().setGroupSizes("rows", [70, 30]);
	usePanelStore.getState().setGroupSizes("compact-top", [40, 60]);
	usePanelStore.getState().resetGroup("rows");
	const s = usePanelStore.getState();
	expect(s.sizes).toEqual({ "compact-top": [40, 60] });
	expect(s.revision).toBe(1);
});
