import { describe, expect, test } from "bun:test";
import { captionFor, isVertical, parseHashtags, textIssues, youtubeTags, youtubeTitle } from "../caption";

describe("share caption", () => {
	test("hashtags: one # each, commas and spaces, no repeats, junk dropped", () => {
		expect(parseHashtags("sale, #Summer  #summer;travel-tips ## #мода")).toEqual(["#sale", "#Summer", "#traveltips", "#мода"]);
		expect(parseHashtags("   ")).toEqual([]);
	});
	test("caption: description, an empty line, the hashtags", () => {
		expect(captionFor({ title: "", description: " Hello ", hashtags: "a b" })).toBe("Hello\n\n#a #b");
		expect(captionFor({ title: "", description: "", hashtags: "a" })).toBe("#a");
		expect(captionFor({ title: "", description: "Hi", hashtags: "" })).toBe("Hi");
	});
	test("YouTube title: Title field, else the first line, else the project; 100 characters", () => {
		expect(youtubeTitle({ title: "", description: "First line\nsecond", hashtags: "" }, "P")).toBe("First line");
		expect(youtubeTitle({ title: " T <b> ", description: "x", hashtags: "" }, "P")).toBe("T b");
		expect(youtubeTitle({ title: "", description: "", hashtags: "" }, "Project")).toBe("Project");
		expect(youtubeTitle({ title: "x".repeat(150), description: "", hashtags: "" }, "P").length).toBe(100);
	});
	test("YouTube tags: hashtags without #, 500 characters in all", () => {
		expect(youtubeTags({ title: "", description: "", hashtags: "#a #b" })).toEqual(["a", "b"]);
		const many = Array.from({ length: 80 }, (_, i) => `tag${i}xxxx`).join(" ");
		expect(youtubeTags({ title: "", description: "", hashtags: many }).join(",").length).toBeLessThanOrEqual(500);
	});
	test("limits: Reels 30 hashtags and 2200 characters, Shorts 3 minutes", () => {
		const tags = Array.from({ length: 31 }, (_, i) => `t${i}`).join(" ");
		const issues = textIssues(["instagram", "youtube"], { title: "", description: "x".repeat(2300), hashtags: tags }, 200);
		expect(issues.filter((i) => i.platform === "instagram" && i.blocking).length).toBe(2);
		expect(issues.some((i) => i.platform === "youtube" && i.vars.max === 180)).toBe(true);
		expect(textIssues(["youtube"], { title: "", description: "ok", hashtags: "a" }, 30)).toEqual([]);
	});
	test("vertical: 9:16 only", () => {
		expect(isVertical({ width: 1080, height: 1920 })).toBe(true);
		expect(isVertical({ width: 720, height: 1280 })).toBe(true);
		expect(isVertical({ width: 1920, height: 1080 })).toBe(false);
		expect(isVertical({ width: 1080, height: 1350 })).toBe(false);
	});
});

describe("share caption writer", () => {
	test("Gaziyav AI's JSON → title, description without hashtags; 5 hashtags at most with Instagram, 8 without", async () => {
		const { parseCaption } = await import("../server/caption-writer");
		const r = parseCaption('Sure! {"title":"Sunset <b>hike</b>","description":"Golden hour in the hills #nope","hashtags":["sunset","#travel","#travel","a","b","c","d","e","f","g","h","i"]}', ["instagram"]);
		expect(r.title).toBe("Sunset bhike/b");
		expect(r.description).toBe("Golden hour in the hills");
		expect(r.hashtags.split(" ").length).toBe(5);
		expect(r.hashtags.startsWith("#sunset #travel #a")).toBe(true);
		const t = parseCaption('{"title":"Hike","description":"Hills","hashtags":["a","b","c","d","e","f","g","h","i","j"]}', ["tiktok", "youtube"]);
		expect(t.hashtags.split(" ").length).toBe(8);
		expect(() => parseCaption("no json", ["tiktok"])).toThrow();
	});
});
