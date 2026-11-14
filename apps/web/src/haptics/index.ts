// The Force Touch trackpad's tap under the finger, the way Final Cut and Keynote use it: once, at the moment something
// snaps, aligns, reaches its limit or is dropped. The Mac app performs it (preload: studioApp.haptic → main.js → the
// native helper Resources/bin/haptic, NSHapticFeedbackManager); anywhere else this does nothing. Settings → General
// «Trackpad feedback» turns it off; the Mac's own Trackpad setting is honoured by the helper. Fire-and-forget: a call
// costs a comparison and, at most once per 80 ms, one IPC message.
import { useAppPrefs } from "@/settings/app-prefs";
import { createEngageTracker, createLimiter, createLimitTracker, guideAppeared, type HapticKind } from "./core";

export { crossesDetent, sliderDetents, type HapticKind } from "./core";

type Bridge = (kind: HapticKind) => void;
let bridge: Bridge | null | undefined;
function getBridge(): Bridge | null {
	if (bridge !== undefined) return bridge;
	const app = typeof window === "undefined" ? undefined : (window as unknown as { studioApp?: { haptic?: Bridge } }).studioApp;
	bridge = typeof app?.haptic === "function" ? app.haptic : null;
	return bridge;
}

const limiter = createLimiter();

/** One tap now (rate-limited to one per 80 ms); false when nothing was sent. */
export function haptic(kind: HapticKind): boolean {
	const send = getBridge();
	if (!send) return false;
	if (useAppPrefs.getState().trackpadFeedback === false) return false;
	if (!limiter.allow(performance.now())) return false;
	try {
		send(kind);
	} catch {}
	return true;
}

type SnapLike = { time: number; type: string } | null;
const sameSnap = (a: { time: number; type: string }, b: { time: number; type: string }) => a.time === b.time && a.type === b.type;

/** The timeline's snap point of the drag in progress (clip move, trim, marker, a drop from Media): a tap as it engages. */
const timelineSnap = createEngageTracker(sameSnap);
export function hapticTimelineSnap(point: SnapLike): void {
	if (timelineSnap.update(point)) haptic("snap");
}

/** The playhead dragged onto a clip edge or a marker. */
const playheadSnap = createEngageTracker(sameSnap);
export function hapticPlayheadSnap(point: SnapLike): void {
	if (playheadSnap.update(point)) haptic("snap");
}

/** A trim reaching the end of the clip's source (or its neighbour, or its shortest length). */
const trimLimit = createLimitTracker();
export function hapticTrimLimit(atLimit: boolean): void {
	if (trimLimit.update(atLimit)) haptic("limit");
}

/** The player's alignment guides: a tap as a guide appears. */
let guides: readonly { type: string; position: number }[] = [];
export function hapticGuides(next: readonly { type: string; position: number }[]): void {
	const appeared = next.length > 0 && guideAppeared(guides, next);
	guides = next;
	if (appeared) haptic("align");
}
