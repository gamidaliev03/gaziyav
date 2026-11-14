// The languages that have a dictionary (written by scripts/i18n-import.mjs): each is its own chunk, loaded when chosen.
// condition is the constant false there) offers English and Russian and has none of these chunks (trim, 12.11).
import type { LangPack } from "./lookup";

export const LOADERS: Record<string, () => Promise<LangPack>> = {};
