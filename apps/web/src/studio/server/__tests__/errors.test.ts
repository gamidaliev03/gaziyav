import { describe, expect, test } from "bun:test";
import { explain, StudioError } from "../errors";

describe("error hints", () => {
	test("YouTube's bot check is not taken for a bad API key (its text mentions authentication)", () => {
		const text = explain(
			new StudioError(
				"YouTube: [youtube] AYcqLymo6M4: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.",
			),
		);
		expect(text).toContain("YouTube paused downloads");
		expect(text).not.toContain("API key");
	});

	test("a real 401 still points to the key", () => {
		expect(explain(new StudioError("Lipsync service: HTTP 401 unauthorized"))).toMatch(/Invalid .*API key/);
	});
});
