// The fonts downloaded on first use (remote-fonts.json, made by scripts/font-catalog.py): each family's files with
// their size, SHA-256 and sources, and the metrics of the stand-in face shown until the file is here.
import catalog from "./remote-fonts.json";
import type { RemoteRow } from "@/library/server/remote";

export interface RemoteFace extends RemoteRow {
	file: string;
	weight: string;
}

export interface RemoteFont {
	group: string;
	faces: RemoteFace[];
	/** Shares of the em: what the stand-in face is shaped to (its line box and its average width). */
	metrics: { ascent: number; descent: number; lineGap: number; sizeAdjust: number };
}

export const REMOTE_FONTS = (catalog as unknown as { fonts: Record<string, RemoteFont> }).fonts;

const byFile = new Map(Object.values(REMOTE_FONTS).flatMap((font) => font.faces.map((face) => [face.file, face] as const)));

/** The catalog row of a font file (the API serves only these). */
export const remoteFontRow = (file: string): RemoteFace | undefined => byFile.get(file);
