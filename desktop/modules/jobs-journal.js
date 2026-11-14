// The durable side of the editor's one job model (src/jobs/durable.ts): one small file per long job in
// <user data>/Jobs/<id>.json, written atomically (a temp file, fsync, one rename), so a kill or a power cut loses none.
// The page writes a job when it starts and as it moves, removes it when it is done or cancelled, and on its next start
// lists them: a job of this very run (the page reloaded) continues; one of an earlier run of the app is shown failed and
// retryable — never lost, never run twice by itself. main.js only registers this.
"use strict";
const { app, ipcMain } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ID = /^[\w:.-]{1,120}$/;
const MAX_BYTES = 64 * 1024;
/** A failed job left alone for this long is dropped (the item it waited for is long gone). */
const KEEP_MS = 14 * 24 * 3600 * 1000;

function openJobs(dir, { pid = process.pid, now = () => Date.now() } = {}) {
	const run = `${pid}-${now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`;
	const file = (id) => path.join(dir, `${Buffer.from(id).toString("base64url")}.json`);
	const write = (target, text) => {
		const tmp = `${target}.${pid}.tmp`;
		try {
			fs.mkdirSync(dir, { recursive: true });
			const fd = fs.openSync(tmp, "w");
			try {
				fs.writeSync(fd, text);
				fs.fsyncSync(fd);
			} finally {
				fs.closeSync(fd);
			}
			fs.renameSync(tmp, target);
			return true;
		} catch {
			// a full disk: the record is a courtesy, the job itself goes on
			try {
				fs.rmSync(tmp, { force: true });
			} catch {}
			return false;
		}
	};
	return {
		run,
		put(job) {
			if (!job || typeof job !== "object" || !ID.test(String(job.id ?? ""))) return false;
			const text = JSON.stringify({ ...job, run, at: now() });
			if (text.length > MAX_BYTES) return false;
			return write(file(String(job.id)), text);
		},
		end(id) {
			if (!ID.test(String(id ?? ""))) return false;
			try {
				fs.rmSync(file(String(id)), { force: true });
			} catch {}
			return true;
		},
		/** Every job on disk, each marked `earlier` when an earlier run of the app wrote it. */
		list() {
			let names = [];
			try {
				names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
			} catch {
				return [];
			}
			const out = [];
			for (const name of names) {
				const full = path.join(dir, name);
				try {
					const job = JSON.parse(fs.readFileSync(full, "utf8"));
					if (!job?.id || now() - (job.at ?? 0) > KEEP_MS) {
						fs.rmSync(full, { force: true });
						continue;
					}
					out.push({ ...job, earlier: job.run !== run });
				} catch {
					fs.rmSync(full, { force: true });
				}
			}
			return out.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
		},
	};
}

/** deps: { fromApp(event) } */
function register({ fromApp }) {
	let jobs = null;
	const book = () => (jobs ??= openJobs(path.join(app.getPath("userData"), "Jobs")));
	ipcMain.handle("studio:jobs", (event, op, a) => {
		if (!fromApp(event)) return null;
		if (op === "put") return book().put(a);
		if (op === "end") return book().end(a);
		if (op === "list") return book().list();
		return null;
	});
	return { book };
}

module.exports = { register, openJobs };
