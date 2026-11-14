// Paid jobs whose file isn't on this Mac yet (fal/server.ts, kie/server.ts, argo/server.ts keep them so that «Retry» comes
// back to the job instead of paying for a second one). They lived in memory only: when Gaziyav restarted in the middle of a
// job — the switch to the VPN starts it again, a crash, ⌘Q — the provider kept working and billing, and Generate paid a second
// time for the same picture. Now every change is written to <Gaziyav's data>/paid-jobs.json (request ids and result links
// only: no key, no prompt, no file), and a restarted server takes the rows back. A row older than 3 hours is dropped.
import fs from "node:fs";
import path from "node:path";
// (not studio/server/settings: it leads back to the API clients that make these maps while they load)
import { supportDir } from "@/platform/paths";

const studioHome = () => process.env.LIPSYNC_HOME || supportDir();

const HOLD_MS = 3 * 3600 * 1000;
type Api = "fal" | "kie" | "argo";
type Row = { at: number; following?: boolean } & Record<string, unknown>;

const file = () => path.join(studioHome(), "paid-jobs.json");
/** A unit test without a data folder of its own must not read or write the profile of the Mac it runs on. */
const sandboxed = () => process.env.NODE_ENV === "test" && !process.env.LIPSYNC_HOME && !process.env.STUDIO_SUPPORT_DIR && !process.env.STUDIO_DATA_DIR;

function readAll(): Record<string, Record<string, Row>> {
	if (sandboxed()) return {};
	try {
		const j = JSON.parse(fs.readFileSync(file(), "utf8"));
		return j && typeof j === "object" ? j : {};
	} catch {
		return {};
	}
}

/** A Map that writes itself to disk on set/delete and after `save()` (for changes made inside a row). */
export class PaidMap<V extends Row> extends Map<string, V> {
	constructor(private readonly api: Api) {
		super();
		const rows = readAll()[api] ?? {};
		for (const [key, row] of Object.entries(rows)) {
			// (a row from before the restart is a finished attempt: nothing follows it now)
			if (row && typeof row.at === "number" && Date.now() - row.at < HOLD_MS) super.set(key, { ...row, following: false } as V);
		}
	}

	set(key: string, value: V) {
		super.set(key, value);
		this.save();
		return this;
	}

	delete(key: string) {
		const had = super.delete(key);
		if (had) this.save();
		return had;
	}

	save() {
		if (sandboxed()) return;
		try {
			const all = readAll();
			const rows: Record<string, Row> = {};
			for (const [key, row] of this) {
				const { following: _following, ...rest } = row;
				rows[key] = rest as Row;
			}
			all[this.api] = rows;
			fs.mkdirSync(studioHome(), { recursive: true });
			// Written beside and renamed over: a kill (⌘Q, a crash) in the middle of the write used to leave half a file, which
			// read as no file at all — every held job of every API gone, and the next Generate paid again.
			const tmp = `${file()}.tmp`;
			fs.writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
			fs.renameSync(tmp, file());
		} catch {
			// the list is only a help for the next attempt; a job never fails over it
		}
	}
}

/** The one map of an API, shared by every route of the server process. */
export function paidMap<V extends Row>(api: Api): PaidMap<V> {
	const slot = `__gaziyavPaid_${api}`;
	const g = globalThis as Record<string, unknown>;
	return (g[slot] as PaidMap<V>) ?? (g[slot] = new PaidMap<V>(api));
}
