// Music and sounds that aren't inside the app: the app carries only the catalog (name, length, tags, a small wave);
// each file comes from the content cloud (content/server/cloud.ts — the upload folder, our Hugging Face dataset, or
// its publisher) the first time it is played or put on the timeline, checked (size + SHA-256) and kept in the cache.
// A catalog row is the cloud's file of its part folder (Music/…, Sound Effects/…).
import { type CloudFile, cachedPath, ensureCached as ensureCloud, isCached as isCloud, prefetchFiles, prefetchTop as prefetchCloud, resetPrefetch as resetCloud, sourcesOf as cloudSources } from "@/content/server/cloud";

export { downloadStats } from "@/content/server/cloud";

/** A catalog row's download facts (the extra fields of a library.json row). */
export type RemoteRow = Omit<CloudFile, "part">;

const asFile = (part: string, row: RemoteRow): CloudFile => ({ ...row, part });
export const cachedFile = (part: string, row: RemoteRow) => cachedPath(asFile(part, row));
export const sourcesOf = (part: string, row: RemoteRow) => cloudSources(asFile(part, row));
export const isCached = (part: string, row: RemoteRow) => isCloud(asFile(part, row));
export const ensureCached = (part: string, row: RemoteRow, opts?: { background?: boolean; first?: boolean }) => ensureCloud(asFile(part, row), opts);
export const prefetchTop = (rows: Array<{ part: string; row: RemoteRow }>) => prefetchCloud(rows.map((r) => asFile(r.part, r.row)), "library");
export const prefetchRows = (rows: Array<{ part: string; row: RemoteRow }>) => prefetchFiles(rows.map((r) => asFile(r.part, r.row)));
export const resetPrefetch = resetCloud;
