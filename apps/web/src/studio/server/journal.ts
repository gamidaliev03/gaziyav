// Durable copy of the editor's recovery journal (unsaved edits after a failed
// save). The page also keeps one in localStorage, but Chromium writes
// localStorage to disk lazily, so a force-quit/crash of the whole app could
// lose it. Here every write is fsync'ed and renamed into place.
import fs from "node:fs";
import path from "node:path";
import { StudioError } from "./errors";
import { dataDir } from "./files";

const MAX_BYTES = 200 * 1024 * 1024;

function journalPath(projectId: string): string {
	if (!/^[A-Za-z0-9_-]{1,100}$/.test(projectId)) throw new StudioError("Invalid project id");
	const dir = path.join(dataDir(), "recovery");
	fs.mkdirSync(dir, { recursive: true });
	return path.join(dir, `${projectId}.json`);
}

export function writeJournal(projectId: string, raw: string) {
	if (raw.length > MAX_BYTES) throw new StudioError("The recovery copy is too large");
	const file = journalPath(projectId);
	const tmp = `${file}.${process.pid}.tmp`;
	const fd = fs.openSync(tmp, "w");
	try {
		fs.writeSync(fd, raw);
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	fs.renameSync(tmp, file);
}

export function readJournal(projectId: string): string | null {
	const file = journalPath(projectId);
	return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

export function removeJournal(projectId: string) {
	fs.rmSync(journalPath(projectId), { force: true });
}
