// The site recipes: one JSON file per site (youtube.json, instagram.json, tiktok.json), shaped as types.ts says. JSON,
// not code: a site that changed its page is fixed by editing a selector there, and the UI-string checks never take a
// site's own button texts (which must stay as the site writes them) for Gaziyav's.
import instagram from "./instagram.json";
import tiktok from "./tiktok.json";
import type { SiteRecipe } from "./types";
import youtube from "./youtube.json";

export const SITES = { youtube, instagram, tiktok } as unknown as Record<SiteRecipe["id"], SiteRecipe>;
export type { Find, SiteRecipe, Step } from "./types";
