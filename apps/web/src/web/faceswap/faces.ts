// «My faces» in the browser edition, as the Mac keeps them in Application Support/Gaziyav/Faces (studio/server/
// my-faces.ts): photos of people who agreed to it, each a JPEG of at most 1024 px wide, for every project — here in
// this browser's own database (park.ts). The page sees { id, name, createdAt } as from the Mac.
import type { Park } from "../lipsync/park";
import { WebLipError } from "../lipsync/sentences";

export interface MyFace {
	id: string;
	name: string;
	/** Milliseconds since 1970. */
	createdAt: number;
}

const LIST = "my-faces";
const MAX_BYTES = 40 * 1024 * 1024;
const fileOf = (id: string) => `face-${id}`;
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** A photo as the JPEG the face swap sends (the Mac: ffmpeg `scale='min(1024,iw)':-2`, q 3). */
export async function photoJpeg(photo: Blob): Promise<Blob> {
	try {
		const bitmap = await createImageBitmap(photo);
		const width = Math.min(1024, bitmap.width);
		const height = Math.max(2, Math.round((bitmap.height * width) / bitmap.width / 2) * 2);
		const canvas = new OffscreenCanvas(width, height);
		canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
		bitmap.close();
		return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
	} catch {
		throw new WebLipError("web.photo_bad");
	}
}

export function faceStore(park: Park, o: { now?: () => number; toJpeg?: (photo: Blob) => Promise<Blob> } = {}) {
	const now = o.now ?? (() => Date.now());
	const toJpeg = o.toJpeg ?? photoJpeg;
	const read = async (): Promise<MyFace[]> => {
		const list = await park.getFact<MyFace[]>(LIST).catch(() => undefined);
		return Array.isArray(list) ? list.filter((f) => typeof f?.id === "string" && /^[0-9a-f]{16}$/.test(f.id)) : [];
	};
	return {
		/** Oldest first (the order they were added in). */
		async list(): Promise<MyFace[]> {
			return (await read()).sort((a, b) => a.createdAt - b.createdAt);
		},
		async photo(id: string): Promise<Blob | null> {
			if (!(await read()).some((f) => f.id === id)) return null;
			return (await park.getFile(fileOf(id)).catch(() => undefined))?.blob ?? null;
		},
		async add(photo: Blob, name: string): Promise<MyFace> {
			if (!photo.size) throw new WebLipError("web.photo_bad", "empty");
			if (photo.size > MAX_BYTES) throw new WebLipError("web.photo_big");
			const jpeg = await toJpeg(photo);
			const id = hex(crypto.getRandomValues(new Uint8Array(8)));
			const face: MyFace = { id, name: name.trim().slice(0, 60) || "My face", createdAt: now() };
			await park.putFile({ id: fileOf(id), name: `${id}.jpg`, type: "image/jpeg", blob: jpeg, at: face.createdAt });
			await park.putFact(LIST, [...(await read()), face]);
			return face;
		},
		async remove(id: string): Promise<void> {
			const list = await read();
			if (!list.some((f) => f.id === id)) return;
			await park.putFact(LIST, list.filter((f) => f.id !== id));
			await park.deleteFile(fileOf(id)).catch(() => {});
		},
	};
}

export type FaceStore = ReturnType<typeof faceStore>;
