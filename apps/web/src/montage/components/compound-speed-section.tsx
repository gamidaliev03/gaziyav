"use client";

// Speed tab of a compound clip (montage/compound-speed.ts): one speed for all of it, the same slider and field as a
// video's (0.1× … 10×, log scale, 1× in the middle), the length it gets and Keep pitch. Each change is one ⌘Z.
import { useState } from "react";
import { InspectorGroup, InspectorRow, InspectorSlider, Split } from "@/components/editor/panels/properties/components/inspector-ui";
import { registerInspectorSection } from "@/components/editor/panels/properties/slots";
import { NumberField } from "@/components/ui/number-field";
import { Switch } from "@/components/ui/switch";
import { useEditor } from "@/editor/use-editor";
import { COMPOUND_KEEP_PITCH, compoundRate } from "@/montage/compound-speed";
import { parseSpeedInput, rateToDisplay } from "@/speed/speed-input";
import { setCompoundSpeed } from "@/timeline/compound";
import type { TimelineElement } from "@/timeline/types";
import { TICKS_PER_SECOND } from "@/wasm";

const toSlider = (rate: number) => (Math.log10(rate) + 1) * 50;
const fromSlider = (value: number) => Math.round(10 ** (value / 50 - 1) * 100) / 100;
const ONE_X = [toSlider(1)];

const isCompound = (e: TimelineElement) => e.type === "graphic" && e.params?.compound === true;

function CompoundSpeed({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const editor = useEditor();
	const rate = compoundRate(element);
	const [dragged, setDragged] = useState<number | null>(null);
	const [typed, setTyped] = useState<string | null>(null);
	const shown = dragged ?? rate;
	const commit = (next: number) => setCompoundSpeed(editor, trackId, element.id, next);
	const keepPitch = element.params?.[COMPOUND_KEEP_PITCH] === true;
	const seconds = ((element.duration / TICKS_PER_SECOND) * rate) / shown;
	return (
		<InspectorGroup id="compound-speed" title="Speed" defaultOpen>
			<div className="flex flex-col gap-2" data-compound-speed>
				<InspectorRow rowId="speed.rate" label="Speed" isDefault={rate === 1} onReset={() => commit(1)}>
					<Split slider>
						<div data-speed-slider className="min-w-0">
							<InspectorSlider
								label="Speed"
								min={0}
								max={100}
								step={0.5}
								detents={ONE_X}
								value={toSlider(shown)}
								onChange={(value) => setDragged(fromSlider(value))}
								onCommit={() => {
									if (dragged !== null) commit(dragged);
									setDragged(null);
								}}
							/>
						</div>
						<NumberField
							value={typed ?? rateToDisplay({ rate })}
							suffix="×"
							suffixClassName="text-muted-foreground text-xs"
							className="h-7 text-xs"
							data-compound-speed-field
							onFocus={() => setTyped(rateToDisplay({ rate }))}
							onChange={(event) => setTyped(event.currentTarget.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") event.currentTarget.blur();
								if (event.key === "Escape") setTyped(null);
							}}
							onBlur={() => {
								const next = typed === null ? null : parseSpeedInput({ input: typed.replace(",", ".") });
								setTyped(null);
								if (next !== null) commit(next);
							}}
						/>
					</Split>
				</InspectorRow>
				<InspectorRow rowId="speed.length" label="Duration" hint="How long the clip is at this speed">
					<span className="text-muted-foreground flex h-7 items-center text-xs tabular-nums" data-speed-length>
						{seconds.toFixed(1)} s
					</span>
				</InspectorRow>
				<InspectorRow rowId="speed.pitch" label="Keep pitch" hint="Voices keep their pitch while the speed changes" inline>
					<Switch
						aria-label="Keep pitch"
						checked={keepPitch}
						onCheckedChange={(checked) =>
							editor.timeline.updateElements({
								updates: [{ trackId, elementId: element.id, patch: { params: { ...element.params, [COMPOUND_KEEP_PITCH]: checked } } }],
							})
						}
					/>
				</InspectorRow>
			</div>
		</InspectorGroup>
	);
}

// «speed@compound»: the inspector places it in the Speed tab (layout-places.ts drops the @… part).
registerInspectorSection({
	id: "speed@compound",
	tab: "speed",
	title: "Speed",
	order: 100,
	bare: true,
	appliesTo: isCompound,
	render: ({ element, trackId }) => <CompoundSpeed element={element} trackId={trackId} />,
});
