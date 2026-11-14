// The editor's side of the one-timeline conversion (the pure part and its rule: timeline/join-timelines.ts). Before the
// editor shows a stored project — on open, and when a version or a recovery copy becomes the project — a document with
// several timelines is converted once:
//   1. the stored document as it is becomes a version («Before joining timelines», Project menu → Versions…; never
//      pruned with the 10 others — services/storage/recovery.ts), unless that version is already there (a run killed
//      between 1 and 2, or a restored old version: there is one «before-join» version per project);
//   2. the converted document is written in ONE store write (one IndexedDB put: kill −9 leaves the old document or the
//      new one, never a mix), only when every scene's counts are equal before and after (empty timelines excepted);
//   3. it opens as converted. The mark `timelineModel` makes every later open a no-op.
// The 8 s limit (round B, F1): before the write it opens the project as it was and convert() then writes NOTHING (a flag
// checked right before the version and right before the save) — a late write would put the snapshot read at open over
// edits made since. Once the save has begun the limit no longer applies: the open waits for it and shows the converted
// document (never the old one while the new one is being written).
// Any failure opens the project as it was, with one line in the flight recorder (notes/diag.ts). It never blocks opening.
import type { SerializedProject } from "@/services/storage/types";
import type { TProject } from "@/project/types";
import { countsEqual, joinTimelines, TIMELINE_MODEL, topLevelCount } from "@/timeline/join-timelines";

const LIMIT_MS = 8000;

/** What the conversion touches (the real store by default; the bun test gives slow fakes). */
export type JoinDeps = {
	read(id: string): Promise<unknown>;
	hasJoinVersion(id: string): Promise<boolean>;
	addJoinVersion(old: SerializedProject): Promise<void>;
	save(doc: SerializedProject): Promise<void>;
	deserialize(doc: SerializedProject): TProject;
	log(reason: string): void;
};

function recordLine(reason: string): void {
	console.warn("[join-timelines]", reason);
	try {
		(window as unknown as { studioApp?: { diag?: (batch: unknown[]) => void } }).studioApp?.diag?.([{ k: "job-failed", job: "join-timelines", reason }]);
	} catch {}
}

async function storeDeps(): Promise<JoinDeps> {
	const [{ projectBackups }, { storageService }] = await Promise.all([import("@/services/storage/recovery"), import("@/services/storage/service")]);
	return {
		read: (id) => storageService.readStoredProject({ id }),
		hasJoinVersion: async (id) => (await projectBackups.list({ projectId: id })).some((backup) => backup.reason === "before-join"),
		addJoinVersion: (old) => projectBackups.add({ serialized: old, reason: "before-join" }),
		save: (doc) => storageService.saveSerializedProject({ serialized: doc }),
		deserialize: (doc) => storageService.deserializeProject({ serializedProject: doc }),
		log: recordLine,
	};
}

/** The project to show: converted when the stored document held several timelines, else `project` itself (marked in
 * memory: a later save writes the mark). Never throws. */
export async function joinTimelinesOnOpen(id: string, project: TProject, given?: Partial<JoinDeps>, limitMs = LIMIT_MS): Promise<TProject> {
	let deps: JoinDeps;
	try {
		deps = { ...(given && Object.keys(given).length >= 6 ? ({} as JoinDeps) : await storeDeps()), ...given } as JoinDeps;
	} catch (error) {
		recordLine(`no store: ${error instanceof Error ? error.message : String(error)}`);
		return project;
	}
	if (project.timelineModel && project.timelineModel >= TIMELINE_MODEL) {
		// a marked document never converts again; one that still has two free-standing timelines is a bug somewhere: said once
		const free = topLevelCount(project);
		if (free > 1) deps.log(`a marked project has ${free} free-standing timelines`);
		return project;
	}
	let expired = false;
	let saving: Promise<TProject> | null = null;
	const convert = async (): Promise<TProject | null> => {
		const stored = await deps.read(id);
		const result = joinTimelines(stored);
		if (result.kind === "skipped") throw new Error(`unreadable: ${result.reason}`);
		if (result.kind !== "joined") return null;
		if (!countsEqual(result.report)) throw new Error("counts differ after the conversion");
		const has = await deps.hasJoinVersion(id);
		if (expired) return null;
		if (!has) await deps.addJoinVersion(stored as SerializedProject);
		if (expired) return null;
		const serialized = result.doc as unknown as SerializedProject;
		saving = deps.save(serialized).then(() => deps.deserialize(serialized));
		return saving;
	};
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const work = convert();
		const outcome = await Promise.race([work, new Promise<"limit">((resolve) => (timer = setTimeout(() => resolve("limit"), limitMs)))]);
		if (outcome !== "limit") return outcome ?? { ...project, timelineModel: TIMELINE_MODEL };
		expired = true;
		work.catch(() => {});
		// the write of the new document has begun: wait for it and show what is stored
		if (saving) return await saving;
		deps.log(`slower than ${Math.round(limitMs / 1000)} s: opened as it was`);
		return project;
	} catch (error) {
		deps.log(error instanceof Error ? error.message : String(error));
		return project;
	} finally {
		clearTimeout(timer);
	}
}

/** The same step for a document that becomes the project without a store read (a recovery copy): pure, no version. */
export function joinedDocument(doc: SerializedProject): SerializedProject {
	const result = joinTimelines(doc);
	return result.kind === "joined" && countsEqual(result.report) ? (result.doc as unknown as SerializedProject) : doc;
}
