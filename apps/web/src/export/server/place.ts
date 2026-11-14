// A finished file reaches its name in one step (render, 11.11): nobody — Finder, an upload, a crash, a full disk — ever
// sees half of it under that name. The same volume: a rename. Another volume: a copy beside the target under a hidden
// part name that carries the owner's pid («.<name>.<pid>-<rand>.gaziyav-part», the same names GaziyavShell's
// modules/export-save.js writes and sweeps at the next start), on the disk, then the rename.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PART_EXT = ".gaziyav-part";

/** «.<name>.<pid>-<rand>.gaziyav-part» beside `target`. */
export function partPath(target: string, pid = process.pid): string {
	const base = path.basename(target).slice(0, 160);
	return path.join(path.dirname(target), `.${base}.${pid}-${randomBytes(3).toString("hex")}${PART_EXT}`);
}

function syncPath(file: string, flags: "r" | "r+") {
	let fd: number | null = null;
	try {
		fd = fs.openSync(file, flags);
		fs.fsyncSync(fd);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (flags === "r+" && (code === "ENOSPC" || code === "EIO")) throw error;
	} finally {
		if (fd !== null) fs.closeSync(fd);
	}
}

/** Puts `file` at `target` (a path nothing is at) in one step; the source is gone after, or whole after a failure. */
export function placeFile(file: string, target: string): void {
	try {
		fs.renameSync(file, target);
		syncPath(path.dirname(target), "r");
		return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
	}
	const part = partPath(target);
	try {
		fs.copyFileSync(file, part);
		syncPath(part, "r+");
		fs.renameSync(part, target);
		syncPath(path.dirname(target), "r");
	} catch (error) {
		fs.rmSync(part, { force: true });
		throw error;
	}
	fs.rmSync(file, { force: true });
}
