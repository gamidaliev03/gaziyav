// What Claude keeps about one project between chats: a short brief (intent, platform, preset, decisions), and which of
// this project's Media items are the pictures of each cast character (the library itself is cross-project:
// mcp/server/memory.ts). One small file per project in the app's folder (mcp/projects/<id>.json): a new Claude chat
// reads it at the top of the project digest and goes on where the last one stopped.
import fs from "node:fs";
import path from "node:path";
import { mcpDir } from "./hub";

export interface ProjectNotes {
	name?: string;
	notes: string;
	/** Character name → the Media ids of its pictures in this project (imported once from the cast library). */
	castMedia: Record<string, string[]>;
	updatedAt?: number;
}

const dir = () => {
	const d = path.join(mcpDir(), "projects");
	fs.mkdirSync(d, { recursive: true, mode: 0o700 });
	return d;
};
const file = (projectId: string) => path.join(dir(), `${projectId.replace(/[^\w-]/g, "").slice(0, 80) || "none"}.json`);

export function readNotes(projectId: string): ProjectNotes {
	try {
		const j = JSON.parse(fs.readFileSync(file(projectId), "utf8")) as Partial<ProjectNotes>;
		return { name: j.name, notes: typeof j.notes === "string" ? j.notes : "", castMedia: j.castMedia && typeof j.castMedia === "object" ? j.castMedia : {}, updatedAt: j.updatedAt };
	} catch {
		return { notes: "", castMedia: {} };
	}
}

function write(projectId: string, n: ProjectNotes) {
	const out = file(projectId);
	fs.writeFileSync(`${out}.tmp`, JSON.stringify({ ...n, updatedAt: Date.now() }), { mode: 0o600 });
	fs.renameSync(`${out}.tmp`, out);
}

export function saveNotes(projectId: string, change: { notes?: unknown; name?: unknown; castMedia?: { name: string; ids: string[] } }): ProjectNotes {
	const n = readNotes(projectId);
	if (typeof change.notes === "string") n.notes = change.notes.trim().slice(0, 1500);
	if (typeof change.name === "string" && change.name.trim()) n.name = change.name.trim().slice(0, 80);
	if (change.castMedia?.name) n.castMedia = { ...n.castMedia, [change.castMedia.name.toLowerCase()]: change.castMedia.ids.slice(0, 8) };
	write(projectId, n);
	return n;
}
