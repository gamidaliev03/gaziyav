import { describe, expect, test } from "bun:test";
import { windowsCommand } from "../tools";

describe("windowsCommand", () => {
	test("env KEY=V… cmd becomes cmd with the variables", () => {
		expect(windowsCommand("/usr/bin/env", ["ELECTRON_RUN_AS_NODE=1", "C:\\Gaziyav\\Gaziyav.exe", "render.mjs", "args.json"])).toEqual({
			bin: "C:\\Gaziyav\\Gaziyav.exe",
			argv: ["render.mjs", "args.json"],
			env: { ELECTRON_RUN_AS_NODE: "1" },
			low: false,
		});
	});
	test("values may hold '=' and paths with spaces", () => {
		const r = windowsCommand("/usr/bin/env", ["UV_CACHE_DIR=C:\\Users\\A B\\x=y", "uv.exe", "pip", "sync"]);
		expect(r.env.UV_CACHE_DIR).toBe("C:\\Users\\A B\\x=y");
		expect(r.bin).toBe("uv.exe");
		expect(r.argv).toEqual(["pip", "sync"]);
	});
	test("nice -n N cmd runs cmd at low priority", () => {
		expect(windowsCommand("/usr/bin/nice", ["-n", "5", "python.exe", "-I", "x.py"])).toEqual({ bin: "python.exe", argv: ["-I", "x.py"], env: {}, low: true });
	});
	test("nice around env", () => {
		const r = windowsCommand("/usr/bin/nice", ["-n", "10", "/usr/bin/env", "A=1", "tool.exe", "B=2"]);
		expect(r).toEqual({ bin: "tool.exe", argv: ["B=2"], env: { A: "1" }, low: true });
	});
	test("a plain tool is unchanged", () => {
		expect(windowsCommand("C:\\bin\\ffmpeg.exe", ["-i", "a.mp4"])).toEqual({ bin: "C:\\bin\\ffmpeg.exe", argv: ["-i", "a.mp4"], env: {}, low: false });
	});
});
