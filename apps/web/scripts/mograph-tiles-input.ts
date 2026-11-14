// What scripts/mograph-tiles.mjs renders (printed as JSON): every motion graphic on a square frame at the moment its
// tile shows, and every template on a 9:16 frame at its cover moment — the same inputs the live previews build
// (src/montage/components/mograph-preview.tsx, src/templates/components/template-preview.tsx). `@ORIGIN@` stands for
// the server the renderer loads the app's public files from.
import { MOGRAPH_KINDS, mographDefaults, themePhoto } from "@/montage/mograph";
import { coverMoment, layerParams, placeTemplate, TEMPLATES, templateSeconds } from "@/templates/catalog";

const O = "@ORIGIN@";

export type TileJob = { id: string; at: number; seconds: number; items: unknown[] };

/** The stills' inputs; the hash of each is kept in public/mograph/tiles/manifest.json (a test checks they are current). */
export function tileInputs(): { kinds: TileJob[]; templates: TileJob[] } {
	return { kinds: kindJobs(), templates: templateJobs() };
}

export const jobKey = (job: TileJob) => JSON.stringify({ at: job.at, seconds: job.seconds, items: job.items });

const kindJobs = () => MOGRAPH_KINDS.map((k) => {
	const photo = `${O}${themePhoto(k.themes[0])}`;
	const slots = Object.fromEntries((k.images ?? []).filter((i) => i.key !== "logo").map((i) => [`${i.key}Url`, photo]));
	return { id: k.kind, at: k.previewAt ?? Math.min(k.dur * 0.55, 2.2), seconds: k.dur, items: [{ id: `tile-${k.kind}`, kind: k.kind, from: 0, dur: k.dur, props: { ...mographDefaults(k), ...slots } }] };
});

const templateJobs = () => TEMPLATES.filter((tp) => tp.parts.some((p) => "mg" in p)).map((tp) => {
	const cover = `${O}${tp.cover}`;
	const slots = { photoUrl: cover, leftUrl: cover, rightUrl: cover, screenUrl: cover, photo2Url: cover, photo3Url: cover };
	const items = placeTemplate(tp, 0).flatMap(({ part, start, dur }, index) => {
		if (!("mg" in part) || start == null || dur == null) return [];
		return [{ id: `${tp.id}-${index}`, kind: part.mg, from: start, dur, props: { ...layerParams(tp, part), ...slots } }];
	});
	return { id: tp.id, at: coverMoment(tp), seconds: templateSeconds(tp), items: [...items].reverse() };
});

if (import.meta.main) console.log(JSON.stringify(tileInputs()));
