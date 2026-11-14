// «My faces»: photos of people (who agreed to it) the user added for Face swap, kept in Application Support/Gaziyav/
// Faces for every project — not in one project's Media, where they were lost in the next project. Each is a JPEG made
// from the photo (any format the photo came in, at most 1024 px), which the face swap helper reads as it is.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { supportDir } from "@/platform/paths";
import { StudioError } from "./errors";
import { workDir } from "./files";
import { findTool, reason, run } from "./tools";

export interface MyFace {
	id: string;
	name: string;
	/** Milliseconds since 1970. */
	createdAt: number;
	/** The JPEG, a file in the Faces folder. */
	file: string;
}

export const facesDir = () => path.join(supportDir(), "Faces");
const indexFile = () => path.join(facesDir(), "faces.json");
const MAX_BYTES = 40 * 1024 * 1024;

function readIndex(): MyFace[] {
	try {
		const list = JSON.parse(fs.readFileSync(indexFile(), "utf8"));
		return Array.isArray(list) ? list.filter((f) => typeof f?.id === "string" && /^[0-9a-f]{16}$/.test(f.id) && typeof f.file === "string") : [];
	} catch {
		return [];
	}
}

function writeIndex(list: MyFace[]) {
	fs.mkdirSync(facesDir(), { recursive: true });
	const tmp = `${indexFile()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
	fs.renameSync(tmp, indexFile());
}

/** «My faces» whose photo is on this Mac, oldest first (the order they were added in). */
export function loadFaces(): MyFace[] {
	return readIndex()
		.filter((f) => fs.existsSync(path.join(facesDir(), f.file)))
		.sort((a, b) => a.createdAt - b.createdAt);
}

export function faceFile(id: string): string | null {
	const face = loadFaces().find((f) => f.id === id);
	return face ? path.join(facesDir(), face.file) : null;
}

/** Keeps a photo as one of «My faces» (converted to a JPEG of at most 1024 px). */
export async function addFace(bytes: Buffer, name: string, signal?: AbortSignal): Promise<MyFace> {
	if (!bytes.length) throw new StudioError("The photo is empty.");
	if (bytes.length > MAX_BYTES) throw new StudioError("The photo is too big (40 MB at most).");
	const work = workDir();
	const input = path.join(work.dir, "photo");
	fs.writeFileSync(input, bytes);
	try {
		const id = crypto.randomBytes(8).toString("hex");
		const file = `${id}.jpg`;
		fs.mkdirSync(facesDir(), { recursive: true });
		const r = await run(findTool("ffmpeg"), ["-y", "-v", "error", "-i", input, "-frames:v", "1", "-vf", "scale='min(1024,iw)':-2", "-q:v", "3", path.join(facesDir(), file)], { timeout: 60, signal });
		if (r.status !== 0 || !fs.existsSync(path.join(facesDir(), file))) throw new StudioError(`That photo can't be read: ${reason(r)}`);
		const face: MyFace = { id, name: name.trim().slice(0, 60) || "My face", createdAt: Date.now(), file };
		writeIndex([...readIndex(), face]);
		return face;
	} finally {
		work.dispose();
	}
}

export function removeFace(id: string) {
	const list = readIndex();
	const face = list.find((f) => f.id === id);
	if (!face) return;
	writeIndex(list.filter((f) => f.id !== id));
	fs.rmSync(path.join(facesDir(), face.file), { force: true });
}
