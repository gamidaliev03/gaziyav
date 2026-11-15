// Where paid work waits in this browser: every job's record (its state and the provider's request ids, written the
// moment the provider returns them) and the result files. IndexedDB (a write is durable when its transaction
// completes; localStorage lost the last writes on a killed process in the desktop's own test), a Map in unit tests.
import type { QueuedRequest } from "./provider";

/** A job's stage (the lipsync's: sample, speech, words, prepare, lipsync; the other kinds name their own). */
export type StageId = string;

export interface ParkedJob {
	id: string;
	/** voiceover, lipsync, or a kind another browser module registered (generate-voice, voice-clone, faceswap). */
	kind: string;
	/** What this run makes (inputs + model): a second run of the same thing follows the paid request, never pays again. */
	runKey: string;
	at: number;
	/** The provider's requests, by stage (or a slot of a stage), with the answer once it came (the file link). */
	reqs: Partial<Record<StageId, QueuedRequest & { answer?: unknown }>>;
	/** What collecting needs without the page's memory: the words, the language, the model, the voice already made. */
	input: Record<string, unknown>;
	/** The JobState as the page last showed it. */
	state: import("@/studio/server/jobs").JobState;
}

export interface ParkedFile {
	id: string;
	name: string;
	type: string;
	blob: Blob;
	at: number;
}

export interface Park {
	putJob(j: ParkedJob): Promise<void>;
	getJob(id: string): Promise<ParkedJob | undefined>;
	jobs(): Promise<ParkedJob[]>;
	deleteJob(id: string): Promise<void>;
	putFile(f: ParkedFile): Promise<void>;
	getFile(id: string): Promise<ParkedFile | undefined>;
	deleteFile(id: string): Promise<void>;
	/** Small facts kept between runs (a voice already cloned from a sample). */
	putFact(key: string, value: unknown): Promise<void>;
	getFact<T>(key: string): Promise<T | undefined>;
}

/** A copy that shares nothing with what the engine keeps changing (IndexedDB clones on write too). */
const copy = <T,>(v: T): T => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

export function memoryPark(): Park & { dump: () => { jobs: ParkedJob[]; facts: Record<string, unknown> } } {
	const jobs = new Map<string, ParkedJob>();
	const files = new Map<string, ParkedFile>();
	const facts = new Map<string, unknown>();
	return {
		putJob: async (j) => void jobs.set(j.id, copy(j)),
		getJob: async (id) => (jobs.has(id) ? copy(jobs.get(id) as ParkedJob) : undefined),
		jobs: async () => [...jobs.values()].map(copy),
		deleteJob: async (id) => void jobs.delete(id),
		putFile: async (f) => void files.set(f.id, f),
		getFile: async (id) => files.get(id),
		deleteFile: async (id) => void files.delete(id),
		putFact: async (k, v) => void facts.set(k, copy(v)),
		getFact: async <T,>(k: string) => facts.get(k) as T | undefined,
		dump: () => ({ jobs: [...jobs.values()], facts: Object.fromEntries(facts) }),
	};
}

export const DB_NAME = "gz-web-lipsync";

export function indexedDbPark(name = DB_NAME): Park {
	let db: Promise<IDBDatabase> | null = null;
	const open = () =>
		(db ??= new Promise((resolve, reject) => {
			const r = indexedDB.open(name, 1);
			r.onupgradeneeded = () => {
				for (const s of ["jobs", "files", "facts"]) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
			};
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		}));
	/** One request in its own transaction; resolves when the TRANSACTION completes (the write is on disk). */
	async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
		const d = await open();
		return new Promise<T>((resolve, reject) => {
			const t = d.transaction(store, mode, { durability: "strict" } as IDBTransactionOptions);
			const req = run(t.objectStore(store));
			t.oncomplete = () => resolve(req.result as T);
			t.onerror = () => reject(t.error);
			t.onabort = () => reject(t.error);
		});
	}
	return {
		putJob: (j) => tx("jobs", "readwrite", (s) => s.put(j, j.id)),
		getJob: (id) => tx("jobs", "readonly", (s) => s.get(id)),
		jobs: () => tx("jobs", "readonly", (s) => s.getAll()),
		deleteJob: (id) => tx("jobs", "readwrite", (s) => s.delete(id)),
		putFile: (f) => tx("files", "readwrite", (s) => s.put(f, f.id)),
		getFile: (id) => tx("files", "readonly", (s) => s.get(id)),
		deleteFile: (id) => tx("files", "readwrite", (s) => s.delete(id)),
		putFact: (k, v) => tx("facts", "readwrite", (s) => s.put(v, k)),
		getFact: (k) => tx("facts", "readonly", (s) => s.get(k)),
	};
}
