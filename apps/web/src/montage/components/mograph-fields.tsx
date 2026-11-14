"use client";

// Inspector extras of a ready-made motion graphic, under its texts, colours and font: the picture it shows (logo,
// product photo, avatar — picked from Media) and its length (the hold stretches; the entrance and exit keep their pace).
import { useEffect, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import type { GraphicElement } from "@/timeline";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";
import { AI_PREFIX } from "../catalog";
import { MOGRAPH_BY_KIND } from "../mograph";
import { ImageField } from "./ai-fields";

export const mographOf = (definitionId: string) =>
	MOGRAPH_BY_KIND.get(definitionId.slice(AI_PREFIX.length));

export const MIN_SECONDS = 0.5;

/** The longest the clip may get: up to the next clip on its track (never over it). */
export function maxSeconds(
	element: { id: string; startTime: number },
	others: { id: string; startTime: number }[],
): number {
	const next = others
		.filter((e) => e.id !== element.id && e.startTime > element.startTime)
		.reduce((min, e) => Math.min(min, e.startTime), Number.POSITIVE_INFINITY);
	return Number.isFinite(next)
		? (next - element.startTime) / TICKS_PER_SECOND
		: 60;
}

export function MographExtras({
	element,
	trackId,
}: {
	element: GraphicElement;
	trackId: string;
}) {
	const editor = useEditor();
	const kind = mographOf(element.definitionId);
	const seconds = element.duration / TICKS_PER_SECOND;
	const [draft, setDraft] = useState(seconds.toFixed(1));
	useEffect(() => setDraft(seconds.toFixed(1)), [seconds]);
	if (!kind) return null;
	// The field's own value: a paste and a quick Tab can blur before the typed state re-renders.
	const commit = (typed: string) => {
		const track = editor.timeline.getTrackById({ trackId });
		const limit = maxSeconds(element, track?.elements ?? []);
		const next = Math.min(
			limit,
			Math.max(MIN_SECONDS, Number(typed.replace(",", ".")) || seconds),
		);
		setDraft(next.toFixed(1));
		if (Math.abs(next - seconds) < 0.01) return;
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					patch: {
						duration: mediaTime({ ticks: Math.round(next * TICKS_PER_SECOND) }),
					},
				},
			],
		});
	};
	return (
		<div
			className="flex flex-col gap-3 px-3 pb-3"
			data-mograph-fields={kind.kind}
		>
			{kind.images?.map((image) => (
				<div key={image.key} className="flex flex-col gap-1.5">
					<span className="text-muted-foreground text-xs">{image.label}</span>
					<ImageField element={element} assetKey={image.key} />
				</div>
			))}
			<label className="flex items-center justify-between gap-2 text-xs">
				<span className="text-muted-foreground">Duration</span>
				<span className="flex items-center gap-1">
					<input
						value={draft}
						inputMode="decimal"
						aria-label="Duration in seconds"
						data-mograph-duration
						onChange={(e) => setDraft(e.target.value)}
						onBlur={(e) => commit(e.currentTarget.value)}
						onKeyDown={(e) =>
							e.key === "Enter" && (e.target as HTMLInputElement).blur()
						}
						className="border-input h-7 w-16 rounded-md border bg-transparent px-2 text-right tabular-nums outline-none focus:border-primary"
					/>
					<span className="text-muted-foreground">s</span>
				</span>
			</label>
		</div>
	);
}
