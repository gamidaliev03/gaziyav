// The old edge trim (controllers/resize-controller.ts: a plain drag of a clip's edge) tells here when it starts and
// ends, so the player shows the two frames of its cut like for every trim of the model. Nothing else of it changes.
export interface LegacyTrim {
	trackId: string;
	elementId: string;
	side: "left" | "right";
}

type Listener = (trim: LegacyTrim | null) => void;
const listeners = new Set<Listener>();

export const legacyTrim = {
	start(trim: LegacyTrim): void {
		for (const listener of listeners) listener(trim);
	},
	end(): void {
		for (const listener of listeners) listener(null);
	},
	watch(listener: Listener): () => void {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	},
};
