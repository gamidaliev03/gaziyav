// What a frame looked like, small (render, 11.11): 32 × 18 points of colour, each the average of its part of the frame.
// A kept stretch carries the fingerprints of its first and last frame; before it is used again its first frame is
// drawn anew and compared. A key says «nothing I know of changed»; this says «and it still looks the same» — whatever
// the key could not know about (a file replaced behind the app's back, a font, a look loaded from elsewhere) shows here.
export const FINGERPRINT_WIDTH = 32;
export const FINGERPRINT_HEIGHT = 18;

export interface Fingerprinter {
	/** The fingerprint of what the canvas shows now (RGB bytes). */
	of: (frame: CanvasImageSource) => Uint8Array;
}

export function makeFingerprinter(): Fingerprinter {
	const canvas = document.createElement("canvas");
	canvas.width = FINGERPRINT_WIDTH;
	canvas.height = FINGERPRINT_HEIGHT;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) throw new Error("no 2d canvas for fingerprints");
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";
	return {
		of: (frame) => {
			context.drawImage(frame, 0, 0, FINGERPRINT_WIDTH, FINGERPRINT_HEIGHT);
			const { data } = context.getImageData(0, 0, FINGERPRINT_WIDTH, FINGERPRINT_HEIGHT);
			const out = new Uint8Array(FINGERPRINT_WIDTH * FINGERPRINT_HEIGHT * 3);
			for (let i = 0, o = 0; i < data.length; i += 4) {
				out[o++] = data[i];
				out[o++] = data[i + 1];
				out[o++] = data[i + 2];
			}
			return out;
		},
	};
}

/**
 * The same picture? Every point within `tolerance` levels of 255 (drawing the same frame twice gives the same points;
 * the room is for a decoder that rounds a level differently on another run).
 */
export function sameFingerprint(a: Uint8Array, b: Uint8Array, tolerance = 3): boolean {
	if (a.length !== b.length || a.length === 0) return false;
	for (let i = 0; i < a.length; i++) {
		if (Math.abs(a[i] - b[i]) > tolerance) return false;
	}
	return true;
}
