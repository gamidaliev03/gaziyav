import { afterAll, afterEach, expect, test } from "bun:test";
import { isKeyboardOverlayOpen, isModalOverlayOpen } from "@/keyboard/navigation";

// Every key press asks whether a dialog or menu owns the keyboard, two or three times. Each lookup walked the whole
// document: it is done once per task now, and a dialog opened later is seen by the next key.
type Fake = { getAttribute: (name: string) => string | null; closest: (selector: string) => object | null };
const overlay = (role: string, inPopper = false): Fake => ({
	getAttribute: (name) => (name === "role" ? role : null),
	closest: () => (inPopper ? {} : null),
});
let open: Fake[] = [];
let lookups = 0;
const g = globalThis as { document?: unknown };
const realDocument = g.document;
g.document = {
	querySelectorAll: () => {
		lookups++;
		return open;
	},
};
afterAll(() => {
	g.document = realDocument;
});
afterEach(async () => {
	await Promise.resolve();
	open = [];
	lookups = 0;
});

test("a key press looks the overlays up once, however often it asks", () => {
	expect(isModalOverlayOpen()).toBe(false);
	expect(isKeyboardOverlayOpen()).toBe(false);
	expect(isKeyboardOverlayOpen()).toBe(false);
	expect(lookups).toBe(1);
});

test("the next key sees a dialog opened in between; a popover keeps Space for the timeline, a menu doesn't", async () => {
	expect(isKeyboardOverlayOpen()).toBe(false);
	open = [overlay("dialog", true)];
	await Promise.resolve();
	expect(isKeyboardOverlayOpen()).toBe(true);
	expect(isModalOverlayOpen()).toBe(false);
	open = [overlay("dialog", true), overlay("menu")];
	await Promise.resolve();
	expect(isModalOverlayOpen()).toBe(true);
	expect(lookups).toBe(3);
});
