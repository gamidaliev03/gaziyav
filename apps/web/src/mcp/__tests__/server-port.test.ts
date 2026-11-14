import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// Claude starts the connector with no GAZIYAV_URL: its default must be the port the installed app listens on. It once
describe("the connector's default address", () => {
	test("is the app's own port from main.js", () => {
		const web = path.resolve(import.meta.dir, "..", "..", "..");
		const server = fs.readFileSync(path.join(web, "mcp", "server.mjs"), "utf8");
		const main = fs.readFileSync(path.resolve(web, "..", "..", "..", "GaziyavShell", "main.js"), "utf8");
		const edition = fs.readFileSync(path.resolve(web, "..", "..", "..", "GaziyavShell", "modules", "edition.js"), "utf8");
		expect(/const PORT = TEST \? [^:]+: EDITOR_PORT;/.test(main)).toBe(true);
		const appPort = /EDITOR_PORT: FAMILY \? \d+ : (\d+),/.exec(edition)?.[1];
		const serverPort = /GAZIYAV_URL \|\| "http:\/\/127\.0\.0\.1:(\d+)"/.exec(server)?.[1];
		expect(appPort).toBe("47831");
		expect(serverPort).toBe(appPort);
	});
});
