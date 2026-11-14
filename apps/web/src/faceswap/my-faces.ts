// «My faces» in the window: the list kept on this Mac for every project (/api/faces), add and remove.
import { create } from "zustand";

export interface MyFace {
	id: string;
	name: string;
	createdAt: number;
}

interface Store {
	faces: MyFace[];
	loaded: boolean;
	refresh: () => Promise<void>;
	add: (file: File) => Promise<MyFace>;
	remove: (id: string) => Promise<void>;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`/api/faces/${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), "X-Studio": "1" } });
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.error || "Gaziyav's local server is not responding. Restart Gaziyav.");
	return data as T;
}

export const faceUrl = (id: string) => `/api/faces/file/${id}`;

export const useMyFaces = create<Store>((set, get) => ({
	faces: [],
	loaded: false,
	refresh: async () => {
		const { faces } = await call<{ faces: MyFace[] }>("list");
		set({ faces, loaded: true });
	},
	add: async (file) => {
		const name = file.name.replace(/\.[^.]+$/, "");
		const { face } = await call<{ face: MyFace }>(`add?name=${encodeURIComponent(name)}`, { method: "POST", body: file });
		set({ faces: [...get().faces.filter((f) => f.id !== face.id), face] });
		return face;
	},
	remove: async (id) => {
		const { faces } = await call<{ faces: MyFace[] }>(`remove/${id}`, { method: "POST" });
		set({ faces });
	},
}));
