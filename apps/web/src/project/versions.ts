// The open project's versions, as the editor lists them (Project menu → Versions…): the browser store's own (on open,
// ⌘S, every 2 minutes; the last 10) and the ones kept on disk by time, outside that store (every 10 minutes of
// editing, the last 24 — services/storage/server/project-files.ts), so a version survives the store it protects.
// A version opens as a copy: the project itself is never touched. IDEAL reliable §4, audit #7–9, #11.
import { EditorCore } from "@/core";
import { generateUUID } from "@/utils/id";
import { isOpenableProject } from "@/services/storage/recovery";
import { storageService } from "@/services/storage/service";
import type { SerializedProject } from "@/services/storage/types";

export type ProjectVersion = {
	/** when it was kept (ms) */
	at: number;
	where: "disk" | "browser";
	reason: string;
	/** the disk version's file, or the browser version's time */
	key: string;
};

export async function listProjectVersions(projectId: string): Promise<ProjectVersion[]> {
	const out: ProjectVersion[] = [];
	const browser = await EditorCore.getInstance().project.listVersions({ id: projectId }).catch(() => []);
	for (const b of browser) out.push({ at: b.createdAt, where: "browser", reason: b.reason, key: String(b.createdAt) });
	try {
		const res = await fetch(`/api/project-files/${encodeURIComponent(projectId)}/versions`, { cache: "no-store" });
		const disk = res.ok ? ((await res.json()) as Array<{ file: string; savedAt: number }>) : [];
		for (const d of Array.isArray(disk) ? disk : []) out.push({ at: d.savedAt, where: "disk", reason: "kept", key: d.file });
	} catch {}
	return out.sort((a, b) => b.at - a.at);
}

async function serializedOf(projectId: string, v: ProjectVersion): Promise<SerializedProject | null> {
	if (v.where === "browser") {
		const list = await EditorCore.getInstance().project.listVersions({ id: projectId });
		return list.find((b) => String(b.createdAt) === v.key)?.project ?? null;
	}
	const res = await fetch(`/api/project-files/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(v.key)}`, { cache: "no-store" });
	if (!res.ok) return null;
	const copy = (await res.json().catch(() => null)) as { project?: unknown } | null;
	return copy && isOpenableProject(copy.project) ? copy.project : null;
}

/**
 * The version as a new project «<name> — <time>», with this project's media (copied as Duplicate copies them);
 * returns the new project's id, or null when the version can't be read.
 */
export async function openVersionAsCopy(projectId: string, v: ProjectVersion, name: string): Promise<string | null> {
	const serialized = await serializedOf(projectId, v);
	if (!serialized) return null;
	const core = EditorCore.getInstance();
	// what is on the screen goes to storage first; the copy gets this project's media (files and their records)
	await core.save.flush().catch(() => false);
	const newId = generateUUID();
	const now = new Date().toISOString();
	// a stored record carries its store key as `id`: the copy must not keep the project's (it was written over it)
	const { id: _ownId, ...content } = serialized as SerializedProject & { id?: string };
	await storageService.saveSerializedProject({ serialized: { ...content, metadata: { ...serialized.metadata, id: newId, name, createdAt: now, updatedAt: now, renamed: true } } });
	const media = await storageService.loadAllMediaAssets({ projectId }).catch(() => []);
	for (const mediaAsset of media) await storageService.saveMediaAsset({ projectId: newId, mediaAsset });
	await core.project.loadAllProjects();
	return newId;
}
