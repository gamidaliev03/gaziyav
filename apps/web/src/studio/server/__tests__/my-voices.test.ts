import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// «My voices» live in Application Support/Gaziyav/Voices, not among the working files: those go after two days, and a
// voice cloned last week broke the next voice-over ("file not found").
const support = fs.mkdtempSync(path.join(os.tmpdir(), "gaziyav-myvoices-"));
const saved = { STUDIO_SUPPORT_DIR: process.env.STUDIO_SUPPORT_DIR, STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR };
beforeAll(() => {
	process.env.STUDIO_SUPPORT_DIR = support;
	delete process.env.STUDIO_DATA_DIR;
});
afterAll(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	fs.rmSync(support, { recursive: true, force: true });
});

describe("My voices", () => {
	test("a cloned voice is kept with its sample and words, outlives the working files, renames and goes", async () => {
		const { loadVoices, myVoice, publicVoices, removeVoice, renameVoice, saveVoice, voicesDir } = await import("../my-voices");
		const { newFile } = await import("../files");
		// The sample as the clone job leaves it: a working file.
		const work = newFile("sample.wav");
		fs.writeFileSync(work.path, Buffer.alloc(48_000, 1));
		const voice = saveVoice(work.path, "Привет, это мой голос для озвучки.", "  Иван  ", 14.2);
		expect(voice.id).toMatch(/^local:[0-9a-f]{12}$/);
		expect(voice.name).toBe("Иван");

		// The working files are cleared: the voice still speaks.
		fs.rmSync(path.dirname(work.path), { recursive: true, force: true });
		const mine = myVoice(voice.id);
		expect(mine?.path.startsWith(voicesDir())).toBe(true);
		expect(fs.statSync(mine!.path).size).toBe(48_000);
		expect(mine?.text).toBe("Привет, это мой голос для озвучки.");
		expect(mine?.name).toBe("Иван");

		// The page sees the voice, never a path or the words.
		const second = saveVoice(mine!.path, "Second voice.", "", 9);
		expect(second.name).toBe("My voice");
		expect(publicVoices().map((v) => v.id)).toEqual([second.id, voice.id]);
		expect(Object.keys(publicVoices()[0]).sort()).toEqual(["createdAt", "id", "name", "seconds"]);

		renameVoice(voice.id, "Голос Ивана");
		expect(loadVoices().find((v) => v.id === voice.id)?.name).toBe("Голос Ивана");

		removeVoice(voice.id);
		expect(myVoice(voice.id)).toBeNull();
		expect(fs.existsSync(mine!.path)).toBe(false);
		expect(publicVoices().map((v) => v.id)).toEqual([second.id]);

		// A voice whose sample was removed by hand isn't offered.
		fs.rmSync(path.join(voicesDir(), loadVoices()[0].file));
		expect(publicVoices()).toEqual([]);
		expect(myVoice(second.id)).toBeNull();
	});

	test("no voice model on this Mac (voices are made on fal); ready voices are recordings", async () => {
		const { MODELS } = await import("@/ondevice/manifest");
		expect(MODELS.map((m) => m.id)).not.toContain("voices");
		expect(MODELS.map((m) => m.id)).not.toContain("voice");
		// A ready voice is a recording the voice model speaks from (Resources/voices next to the helpers' bin).
		const { readyVoice } = await import("../ready-voices");
		const res = path.join(support, "Resources");
		fs.mkdirSync(path.join(res, "bin"), { recursive: true });
		fs.mkdirSync(path.join(res, "voices"));
		fs.writeFileSync(path.join(res, "voices", "voices.json"), JSON.stringify({ text: "Hi there!", speakers: ["ryan", "serena"] }));
		fs.writeFileSync(path.join(res, "voices", "serena-calm.m4a"), "m4a");
		const bin = process.env.STUDIO_BIN_DIR;
		process.env.STUDIO_BIN_DIR = path.join(res, "bin");
		try {
			expect(readyVoice("serena", "спокойно, мягко")).toEqual({ ref: path.join(res, "bin", "..", "voices", "serena-calm.m4a"), text: "Hi there!" });
			expect(readyVoice("serena", "news anchor")).toBeNull();
		} finally {
			if (bin === undefined) delete process.env.STUDIO_BIN_DIR;
			else process.env.STUDIO_BIN_DIR = bin;
		}
	});
});
