import type { TimelineElement, TimelineTrack } from "@/timeline";
import { getSourceTimeAtClipTime } from "@/retime";
import { TICKS_PER_SECOND } from "@/wasm";
import type { AnyBaseNode } from "@/services/renderer/nodes/base-node";
import { ImageNode } from "@/services/renderer/nodes/image-node";
import { TransitionNode } from "@/services/renderer/nodes/transition-node";
import { VideoNode } from "@/services/renderer/nodes/video-node";
import { getTransitionDefinition } from "./definitions";
import type { TimelineTransition } from "./types";

/** Clips closer than this (ticks) count as touching. */
const ADJACENT_TOLERANCE = TICKS_PER_SECOND / 50;

export function getTrackTransitions(track: TimelineTrack): TimelineTransition[] {
	if (track.type !== "video") return [];
	return (track as { transitions?: TimelineTransition[] }).transitions ?? [];
}

export function findCut({
	track,
	transition,
}: {
	track: TimelineTrack;
	transition: Pick<TimelineTransition, "fromElementId" | "toElementId">;
}): { from: TimelineElement; to: TimelineElement; cut: number } | null {
	const from = track.elements.find((e) => e.id === transition.fromElementId);
	const to = track.elements.find((e) => e.id === transition.toElementId);
	if (!from || !to) return null;
	if ("hidden" in from && from.hidden) return null;
	if ("hidden" in to && to.hidden) return null;
	const end = from.startTime + from.duration;
	if (Math.abs(end - to.startTime) > ADJACENT_TOLERANCE) return null;
	return { from, to, cut: to.startTime };
}

/** Half-length actually used (never more than half of either clip). */
export function effectiveHalf(transition: TimelineTransition, from: TimelineElement, to: TimelineElement): number {
	return Math.max(0, Math.min(transition.duration / 2, from.duration / 2, to.duration / 2));
}

/**
 * Wraps the nodes of one track with transition nodes. A plays past its end
 * (using its trimEnd handle) and B starts early (trimStart handle); without a
 * handle the edge frame is held. A and B are hidden inside the window.
 */
export function applyTrackTransitions({
	track,
	nodes,
	nodeByElementId,
}: {
	track: TimelineTrack;
	nodes: AnyBaseNode[];
	nodeByElementId: Map<string, AnyBaseNode>;
}): void {
	for (const transition of getTrackTransitions(track)) {
		if (!getTransitionDefinition(transition.type)) continue;
		const found = findCut({ track, transition });
		if (!found) continue;
		const { from, to, cut } = found;
		const fromNode = nodeByElementId.get(from.id);
		const toNode = nodeByElementId.get(to.id);
		if (!fromNode || !toNode) continue;
		const half = effectiveHalf(transition, from, to);
		if (half <= 0) continue;
		const start = cut - half;
		const end = cut + half;

		const outgoing = cloneOutgoing(fromNode, half);
		const incoming = cloneIncoming(toNode, half, outgoing instanceof VideoNode ? (outgoing.params.decoderKey ?? outgoing.params.mediaId) : null);
		if (!outgoing || !incoming) continue;

		excludeRange(fromNode, start, end);
		excludeRange(toNode, start, end);

		const transitionNode = new TransitionNode({
			transitionType: transition.type,
			transitionParams: transition.params ?? {},
			start,
			duration: end - start,
		});
		transitionNode.add(outgoing);
		transitionNode.add(incoming);
		const index = nodes.indexOf(toNode);
		nodes.splice(index >= 0 ? index + 1 : nodes.length, 0, transitionNode);
	}
}

function excludeRange(node: AnyBaseNode, start: number, end: number) {
	if (node instanceof VideoNode || node instanceof ImageNode) {
		node.params.excludeRanges = [...(node.params.excludeRanges ?? []), { start, end }];
	}
}

function cloneOutgoing(node: AnyBaseNode, half: number): AnyBaseNode | null {
	if (node instanceof VideoNode) {
		const p = node.params;
		const span = getSourceTimeAtClipTime({ clipTime: p.duration, retime: p.retime });
		const mediaEnd = p.trimStart + span + Math.max(0, p.trimEnd);
		const oneFrame = TICKS_PER_SECOND / 60;
		return new VideoNode({
			...p,
			excludeRanges: undefined,
			duration: p.duration + half,
			sourceClamp: { min: 0, max: Math.max(p.trimStart, mediaEnd - oneFrame) },
		});
	}
	if (node instanceof ImageNode) {
		return new ImageNode({ ...node.params, excludeRanges: undefined, duration: node.params.duration + half });
	}
	return null;
}

function cloneIncoming(node: AnyBaseNode, half: number, outgoingKey: string | null): AnyBaseNode | null {
	if (node instanceof VideoNode) {
		const p = node.params;
		const lead = getSourceTimeAtClipTime({ clipTime: half, retime: p.retime });
		const ownKey = p.decoderKey ?? p.mediaId;
		return new VideoNode({
			...p,
			excludeRanges: undefined,
			timeOffset: p.timeOffset - half,
			duration: p.duration + half,
			trimStart: p.trimStart - lead,
			sourceClamp: { min: 0, max: Number.MAX_SAFE_INTEGER },
			// B' reads B's own decoder, which B then simply decodes on from (a separate one switched decoders at
			// the end of the transition); only when A' already reads that decoder does B' get its own.
			decoderKey: ownKey === outgoingKey ? `${ownKey}#transition-in` : p.decoderKey,
		});
	}
	if (node instanceof ImageNode) {
		return new ImageNode({
			...node.params,
			excludeRanges: undefined,
			timeOffset: node.params.timeOffset - half,
			duration: node.params.duration + half,
		});
	}
	return null;
}
