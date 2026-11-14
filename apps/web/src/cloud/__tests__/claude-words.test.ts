// What Claude reads when a generation fails (10.11): «Press Retry» named a button Claude hasn't got (B19/A5), a stuck
// picture said nothing about the bill or what to do (B1), and a missing input came back one at a time (A14, 6 probes).
import { describe, expect, test } from "bun:test";
import { forClaude, lateLine, missingInputs } from "../claude-words";

describe("provider sentences in Claude's terms", () => {
	test("never «Press Retry»; «pick another model» names one", () => {
		const kie = "kie.ai couldn't make this: internal error. Nothing was charged. Press Retry, or pick another model.";
		expect(forClaude(kie, '"grok-imagine/image-to-video#image" (Grok Imagine, kie.ai)')).toBe('kie.ai couldn\'t make this: internal error. Nothing was charged. Send the same call again, or use "grok-imagine/image-to-video#image" (Grok Imagine, kie.ai).');
		const fal = forClaude("fal.ai: the account balance is empty. Top it up on fal.ai (Billing), then press Retry. Nothing was charged.");
		expect(fal).not.toMatch(/Retry/);
		expect(fal).toMatch(/then send the same call again/);
		expect(forClaude("The fal.ai service failed on its side. Press Retry in a couple of minutes.")).toBe("The fal.ai service failed on its side. Send the same call again in a couple of minutes.");
	});

	test("a job out of time: who, what, the bill, and what to use instead", () => {
		const ran = "kie.ai didn't finish within 4 min. It can't be stopped from here: if it finishes later and bills, kie.ai's log shows it. Press Retry to keep waiting for this task, or pick another model.";
		expect(lateLine(ran, "picture", '"nano-banana-2" (Nano Banana 2, kie.ai)')).toBe(`kie.ai didn't finish this picture in 4 min; nothing is charged if it never started (it was running, and kie.ai can't stop it: the same call again follows that task, never paid twice); use "nano-banana-2" (Nano Banana 2, kie.ai) or reword.`);
		const never = "kie.ai never started this task: it stayed waiting in its queue for 4 min. Nothing was charged. Press Retry, or pick another model. (kie.ai can't cancel it: if it starts later, its log shows it.)";
		expect(lateLine(never, "picture")).toMatch(/^kie\.ai didn't finish this picture in 4 min; it never started: nothing was charged; use another model/);
		expect(lateLine("fal.ai didn't finish within 15 min. The job was cancelled; press Retry.", "video")).toMatch(/^fal\.ai didn't finish this video in 15 min; fal\.ai cancelled it: nothing is charged for it;/);
		expect(lateLine("Some other error", "video")).toBeNull();
	});
});

describe("every input a mode needs, at once", () => {
	test("avatar without a photo or a sound says both, and that the prompt is optional", () => {
		expect(missingInputs("video", "avatar", { prompt: "she sings" })).toBe("Not run: video mode avatar needs from (Media photo of the person), sound (a Media sound (soundFrom/soundTo for a piece) or a timeline audio clip (only its trimmed piece is sent)), prompt (optional) — missing: from, sound. Nothing was spent.");
		expect(missingInputs("video", "avatar", { from: "ab12cd34", sound: "ef56" })).toBeNull();
	});
	test("frames, reference, a picture, and a start frame without words", () => {
		expect(missingInputs("video", "frames", { from: "a" })).toMatch(/missing: end, prompt\./);
		expect(missingInputs("video", "reference", { prompt: "x", cast: ["Линда"] })).toBeNull();
		expect(missingInputs("image", "", {})).toMatch(/^Not run: a picture needs prompt \(what to draw\) — missing: prompt\./);
		expect(missingInputs("video", "", { from: "a" })).toMatch(/video mode image needs from .*— missing: prompt\./);
	});
});
