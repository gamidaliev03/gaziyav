// The pointer shape of each trim, so the hand knows what a drag will do before it starts: two bars with arrows on a cut
// (roll), a bracket hugging its clip with an arrow (ripple, amber as in Premiere), a window with arrows inside (slip),
// a clip with arrows outside (slide). 24 × 24, the hot spot in the middle.
import type { TrimCursor } from "./zones";

const svg = (body: string) =>
	`url("data:image/svg+xml,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g stroke="#111" stroke-width="1" stroke-linejoin="round">${body}</g></svg>`,
	)}") 12 12, ew-resize`;

const WHITE = `fill="#fff"`;
const AMBER = `fill="#ffc53d"`;

export const TRIM_CURSORS: Record<TrimCursor, string> = {
	roll: svg(
		`<rect ${WHITE} x="9" y="4.5" width="2.2" height="15"/><rect ${WHITE} x="12.8" y="4.5" width="2.2" height="15"/><path ${WHITE} d="M7 8.5 2 12l5 3.5z"/><path ${WHITE} d="M17 8.5 22 12l-5 3.5z"/>`,
	),
	// the tail of a clip: the bracket closes the clip on its left
	"ripple-right": svg(`<path ${AMBER} d="M7.5 4.5h6v15h-6v-2.4h3.4V6.9H7.5z"/><path ${AMBER} d="M16 8.5 21.5 12 16 15.5z"/><path ${AMBER} d="M5.5 9.5 2 12l3.5 2.5z"/>`),
	// the head of a clip: the bracket opens the clip on its right
	"ripple-left": svg(`<path ${AMBER} d="M16.5 4.5h-6v15h6v-2.4h-3.4V6.9h3.4z"/><path ${AMBER} d="M8 8.5 2.5 12 8 15.5z"/><path ${AMBER} d="M18.5 9.5 22 12l-3.5 2.5z"/>`),
	slip: svg(
		`<rect ${WHITE} x="2.5" y="4.5" width="2.2" height="15"/><rect ${WHITE} x="19.3" y="4.5" width="2.2" height="15"/><path ${WHITE} d="M11 8.5 6.5 12l4.5 3.5z"/><path ${WHITE} d="M13 8.5 17.5 12 13 15.5z"/>`,
	),
	slide: svg(`<rect ${WHITE} x="8.5" y="6" width="7" height="12" rx="1"/><path ${WHITE} d="M6.5 8.5 1.5 12l5 3.5z"/><path ${WHITE} d="M17.5 8.5 22.5 12l-5 3.5z"/>`),
};

/** Over the tracks while hovering a zone; on the whole page while a trim is in the hand (the pointer may leave the timeline). */
export const TRIM_CURSOR_CSS = [
	...(Object.keys(TRIM_CURSORS) as TrimCursor[]).map(
		(kind) =>
			`[data-trim-cursor="${kind}"],[data-trim-cursor="${kind}"] *,html[data-trim-drag="${kind}"],html[data-trim-drag="${kind}"] *{cursor:${TRIM_CURSORS[kind]} !important}`,
	),
	// the Trim tool over a clip it cannot slip (a title, a picture: no file to slip in)
	`[data-trim-cursor="none"],[data-trim-cursor="none"] *{cursor:not-allowed !important}`,
].join("\n");
