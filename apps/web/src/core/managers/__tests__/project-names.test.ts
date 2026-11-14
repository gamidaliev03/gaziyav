import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TProject, TProjectMetadata } from "@/project/types";

let core: typeof import("@/core");
let manager: typeof import("../project-manager");
let storage: typeof import("@/services/storage/service");
let wasm: typeof import("@/wasm");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	manager = await import("../project-manager");
	storage = await import("@/services/storage/service");
	wasm = await import("@/wasm");
});

function meta({ name, index }: { name: string; index: number }): TProjectMetadata {
	return {
		id: `p${index}`,
		name,
		createdAt: new Date(index),
		updatedAt: new Date(index),
		duration: wasm.mediaTime({ ticks: 0 }),
	};
}

const sorted = (names: string[]) => [...names].sort((a, b) => manager.compareProjectNames({ a, b }));
const sign = ({ a, b }: { a: string; b: string }) => Math.sign(manager.compareProjectNames({ a, b }));

// H2-7: the Projects page sorted "alpha" after every capitalised name (raw UTF-16 compare).
describe("project names sort the way people read them", () => {
	test("case does not split the list", () => {
		expect(sorted(["Bravo", "alpha", "Charlie"])).toEqual(["alpha", "Bravo", "Charlie"]);
	});

	test("numbers inside names sort as numbers", () => {
		expect(sorted(["Video 10", "Video 2", "Video 1"])).toEqual(["Video 1", "Video 2", "Video 10"]);
	});

	test("Cyrillic and accents", () => {
		expect(sorted(["Яблоко", "арбуз", "Банан"])).toEqual(["арбуз", "Банан", "Яблоко"]);
		expect(sorted(["élan", "Zeta", "eagle"])).toEqual(["eagle", "élan", "Zeta"]);
	});

	test("names equal but for case keep one fixed order", () => {
		expect(sign({ a: "alpha", b: "Alpha" })).not.toBe(0);
		expect(sign({ a: "alpha", b: "Alpha" })).toBe(-sign({ a: "Alpha", b: "alpha" }));
	});

	test("Projects page: Name ↑ and ↓", () => {
		const { EditorCore } = core;
		EditorCore.reset();
		const pm = EditorCore.getInstance().project;
		Reflect.set(pm, "savedProjects", ["Bravo", "alpha", "Charlie"].map((name, index) => meta({ name, index })));
		const names = (sortOption: "name-asc" | "name-desc") =>
			pm.getFilteredAndSortedProjects({ searchQuery: "", sortOption }).map((project) => project.name);
		expect(names("name-asc")).toEqual(["alpha", "Bravo", "Charlie"]);
		expect(names("name-desc")).toEqual(["Charlie", "Bravo", "alpha"]);
	});
});

// H2-6: the Projects page dialog saved "" / "   " as the project name.
describe("renameProject refuses blank names and trims the rest", () => {
	test("blank names keep the old name, padded names are trimmed", async () => {
		const { EditorCore } = core;
		EditorCore.reset();
		const pm = EditorCore.getInstance().project;
		const saved: string[] = [];
		const service = storage.storageService;
		const original = { load: service.loadProject, save: service.saveProject };
		// renameProject only reads and rewrites the metadata of the stored project.
		const project: Pick<TProject, "metadata"> = { metadata: meta({ name: "Bravo", index: 1 }) };
		Reflect.set(service, "loadProject", async () => ({ project }));
		Reflect.set(service, "saveProject", async ({ project: next }: { project: Pick<TProject, "metadata"> }) => {
			saved.push(next.metadata.name);
		});
		try {
			await pm.renameProject({ id: "p1", name: "" });
			await pm.renameProject({ id: "p1", name: "   " });
			expect(saved).toEqual([]);
			await pm.renameProject({ id: "p1", name: "  Clip 1  " });
			expect(saved).toEqual(["Clip 1"]);
		} finally {
			Reflect.set(service, "loadProject", original.load);
			Reflect.set(service, "saveProject", original.save);
		}
	});
});
