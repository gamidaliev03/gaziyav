// An import from an ordinary place on this Mac keeps only where the file is: no 1 GB copy into the project, nothing a
// crash can cut. Files on removable media or in a temporary folder are still copied (they will go away), and so are the
// files the app makes (no place of the user's). At each open the Mac app hands the originals back as disk-backed files.
import type { ImportSource } from "@/services/storage/types";

type Place = "place" | "temporary" | "removable";
interface ShellOriginals {
	pathForFile?: (file: File) => string;
	originalsPlace?: (
		paths: string[],
	) => Promise<
		Array<{
			place: Place;
			dev?: number;
			ino?: number;
			size?: number;
			lastModified?: number;
		}>
	>;
	attachOriginals?: (
		selector: string,
		files: ImportSource[],
	) => Promise<
		Array<{
			status: string;
			path?: string;
			size?: number;
			lastModified?: number;
		}>
	>;
}

const shell = (): ShellOriginals | null =>
	typeof window === "undefined"
		? null
		: ((window as unknown as { studioApp?: ShellOriginals }).studioApp ?? null);

/**
 * Where a picked or dropped file is on this Mac and what the import does with it: `inPlace` = used where it is, else
 * copied into the project. Null for a file with no place of the user's (made in the window) or outside the Mac app.
 */
export async function importSourceOf(
	file: File,
): Promise<{ source: ImportSource; inPlace: boolean } | null> {
	const app = shell();
	if (!app?.pathForFile || !app.originalsPlace) return null;
	let at = "";
	try {
		at = app.pathForFile(file) ?? "";
	} catch {}
	if (!at) return null;
	const [info] = await app.originalsPlace([at]).catch(() => []);
	// the file on the disk must be the very one picked (same size)
	if (!info || (info.size !== undefined && info.size !== file.size))
		return null;
	return {
		source: {
			path: at,
			size: file.size,
			lastModified: file.lastModified,
			...(info.dev !== undefined && info.ino !== undefined
				? { dev: info.dev, ino: info.ino }
				: {}),
		},
		inPlace: info.place === "place",
	};
}

export interface Original {
	/** The user's file, disk-backed (nothing is read until it is used); null when it is not where it was. */
	file: File | null;
	/** ok · moved (found by its number after a rename or a move) · changed (another file at its place) · missing · unavailable */
	status: string;
	/** Where it is now (moved, changed). */
	source?: ImportSource;
}

let attachSeq = 0;

/** The originals of a project, as files, in the order asked (one round trip for all of them). */
export async function attachOriginals(
	sources: ImportSource[],
): Promise<Original[]> {
	const app = shell();
	if (!sources.length) return [];
	if (!app?.attachOriginals || typeof document === "undefined")
		return sources.map(() => ({ file: null, status: "unavailable" }));
	const token = `o${Date.now().toString(36)}${(attachSeq++).toString(36)}`;
	const input = document.createElement("input");
	input.type = "file";
	input.multiple = true;
	input.hidden = true;
	input.setAttribute("data-gz-originals", token);
	document.body.appendChild(input);
	try {
		type Found = {
			status: string;
			path?: string;
			size?: number;
			lastModified?: number;
		};
		const found: Found[] = await app
			.attachOriginals(`input[data-gz-originals="${token}"]`, sources)
			.catch(() => sources.map((): Found => ({ status: "unavailable" })));
		const files = Array.from(input.files ?? []);
		let next = 0;
		return sources.map((want, i) => {
			const f = found[i];
			if (!f?.path) return { file: null, status: f?.status ?? "missing" };
			const file = files[next++] ?? null;
			if (!file) return { file: null, status: "unavailable" };
			const moved = f.path !== want.path || f.status === "changed";
			return {
				file,
				status: f.status,
				...(moved
					? {
							source: {
								...want,
								path: f.path,
								size: file.size,
								lastModified: file.lastModified,
							},
						}
					: {}),
			};
		});
	} finally {
		input.remove();
	}
}

/**
 * A file of the user's that Gaziyav AI or the Downloads list names by its place (only what the server allows: the
 * user's folders, the space's downloads), taken where it is — disk-backed, nothing read or copied. Null outside the Mac
 * app or when the shell can't hand it over (the caller then reads it through the server, as before).
 */
export async function userFileAt(path: string, signal?: AbortSignal): Promise<File | null> {
	if (!shell()?.attachOriginals) return null;
	const res = await fetch(`/api/studio/local-file-info?path=${encodeURIComponent(path)}`, { headers: { "X-Studio": "1" }, signal }).catch(() => null);
	if (!res?.ok) return null;
	const info = (await res.json().catch(() => null)) as { path?: string; size?: number; lastModified?: number } | null;
	if (!info?.path || typeof info.size !== "number" || typeof info.lastModified !== "number") return null;
	const [got] = await attachOriginals([{ path: info.path, size: info.size, lastModified: info.lastModified }]);
	return got?.file ?? null;
}
