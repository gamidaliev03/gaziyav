"use client";

// Speed → Normal: one speed for the whole clip. The row holds the slider (0.1× … 10× on a log scale, 1× in the middle,
// CapCut's) and the field («1,5» is 1.5×; ↑/↓ by 0.01×, Shift 0.1×; drag its handle); a drag previews and the release is
// one ⌘Z. Under it the length the clip gets, and Keep pitch.
import { useRef } from "react";
import { useEditor } from "@/editor/use-editor";
import { NumberField } from "@/components/ui/number-field";
import { Switch } from "@/components/ui/switch";
import { InspectorRow, InspectorSlider, Split } from "@/components/editor/panels/properties/components/inspector-ui";
import { usePropertyDraft } from "@/components/editor/panels/properties/hooks/use-property-draft";
import { buildConstantRetime } from "@/retime";
import { DEFAULT_RETIME_RATE, MAX_RETIME_RATE, clampRetimeRate, canMaintainPitch } from "@/retime/rate";
import type { AudioElement, RetimeConfig, VideoElement } from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";
import { constantRetimeFrom, isSpeedChange, MIN_SPEED, parseSpeedInput, rateToDisplay, SPEED_STEP } from "../speed-input";

function buildRetime({ rate, maintainPitch }: { rate: number; maintainPitch: boolean }) {
	if (rate === DEFAULT_RETIME_RATE && !maintainPitch) return undefined;
	return buildConstantRetime({ rate, maintainPitch });
}

/** The slider runs 0.1× … 10× on a log scale with 1× in the middle (CapCut's speed slider). */
const toSlider = (rate: number) => (Math.log10(rate) + 1) * 50;
// 1× is the slider's natural stop: a drag across it taps the trackpad (haptics).
const ONE_X = [toSlider(1)];
const fromSlider = (value: number) => Math.round(10 ** (value / 50 - 1) * 100) / 100;

export function SpeedFields({ element, trackId }: { element: AudioElement | VideoElement; trackId: string }) {
	const editor = useEditor();
	const rate = clampRetimeRate({ rate: element.retime?.rate ?? DEFAULT_RETIME_RATE });
	const isPitchPreserveAvailable = canMaintainPitch({ rate });
	const maintainPitch = element.retime?.maintainPitch ?? false;
	const pendingRateRef = useRef(rate);
	// The clip as saved, not as the inspector shows it: while typing or dragging, the inspector shows the live preview.
	const committedRetime = (): RetimeConfig | undefined => {
		const [found] = editor.timeline.getElementsWithTracks({ elements: [{ trackId, elementId: element.id }] });
		const committed = found?.element;
		return committed && (committed.type === "video" || committed.type === "audio") ? committed.retime : element.retime;
	};

	const commitRetime = ({ rate: nextRate, maintainPitch: nextMaintainPitch }: { rate: number; maintainPitch: boolean }) => {
		// A typed speed is constant (no curve); optical flow and frame-rate settings stay (read from the saved
		// clip: the previewed one has lost them).
		editor.timeline.updateElementRetime({
			trackId,
			elementId: element.id,
			retime: constantRetimeFrom({ committed: committedRetime(), rate: nextRate, maintainPitch: nextMaintainPitch }),
		});
	};

	const speedDraft = usePropertyDraft({
		displayValue: rateToDisplay({ rate }),
		parse: (input) => parseSpeedInput({ input }),
		// «1,5» is 1.5×; ↑/↓ change it by 0.01× (Shift 0.1×)
		numeric: true,
		nudge: { step: SPEED_STEP, format: (nextRate) => rateToDisplay({ rate: nextRate }) },
		onPreview: (nextRate) => {
			pendingRateRef.current = nextRate;
			editor.timeline.previewElements({
				updates: [{ trackId, elementId: element.id, updates: { retime: buildRetime({ rate: nextRate, maintainPitch }) } }],
			});
		},
		onCommit: () => {
			// Only visited, or the same speed typed again: no undo step, and a speed ramp stays a ramp.
			if (!isSpeedChange({ committed: committedRetime(), rate: pendingRateRef.current, maintainPitch })) {
				editor.timeline.discardPreview();
				return;
			}
			commitRetime({ rate: pendingRateRef.current, maintainPitch });
		},
	});

	// the slider: the dragged speed, previewed; the release commits once against the saved speed
	const dragging = useRef<number | null>(null);
	const shown = dragging.current ?? rate;
	// the source the clip plays, over the speed: the length it will have
	const sourceSeconds = (element.duration / TICKS_PER_SECOND) * rate;

	return (
		<>
			<InspectorRow rowId="speed.rate" label="Speed" isDefault={rate === DEFAULT_RETIME_RATE} onReset={() => commitRetime({ rate: DEFAULT_RETIME_RATE, maintainPitch })}>
				<Split slider>
					<div data-speed-slider className="min-w-0">
						<InspectorSlider
							label="Speed"
							min={0}
							max={100}
							step={0.5}
							detents={ONE_X}
							value={toSlider(shown)}
							onChange={(value) => {
								const next = clampRetimeRate({ rate: fromSlider(value) });
								dragging.current = next;
								editor.timeline.previewElements({
									updates: [{ trackId, elementId: element.id, updates: { retime: constantRetimeFrom({ committed: committedRetime(), rate: next, maintainPitch }) } }],
								});
							}}
							onCommit={() => {
								const next = dragging.current;
								dragging.current = null;
								if (next === null || next === clampRetimeRate({ rate: committedRetime()?.rate ?? DEFAULT_RETIME_RATE })) {
									editor.timeline.discardPreview();
									return;
								}
								commitRetime({ rate: next, maintainPitch });
							}}
						/>
					</div>
					<NumberField
						value={speedDraft.displayValue}
						suffix="×"
						suffixClassName="text-muted-foreground text-xs"
						className="h-7 text-xs"
						scrubRanges={[
							{ from: MIN_SPEED, to: 1, pixelsPerUnit: 160 },
							{ from: 1, to: 5, pixelsPerUnit: 48 },
						]}
						scrubClamp={{ min: MIN_SPEED, max: MAX_RETIME_RATE }}
						onFocus={() => {
							pendingRateRef.current = rate;
							speedDraft.onFocus();
						}}
						onChange={speedDraft.onChange}
						// Esc throws the typing away (the field turns Esc into a blur, which would otherwise commit).
						onKeyDown={speedDraft.onKeyDown}
						onBlur={speedDraft.onBlur}
						onScrub={speedDraft.scrubTo}
						onScrubEnd={speedDraft.commitScrub}
					/>
				</Split>
			</InspectorRow>
			<InspectorRow rowId="speed.length" label="Duration" hint="How long the clip is at this speed">
				<span className="text-muted-foreground flex h-7 items-center text-xs tabular-nums" data-speed-length>
					{(sourceSeconds / shown).toFixed(1)} s
				</span>
			</InspectorRow>
			<InspectorRow rowId="speed.pitch" label="Keep pitch" hint="Voices keep their pitch while the speed changes" inline>
				<Switch
					aria-label="Keep pitch"
					title={isPitchPreserveAvailable ? "Voices keep their pitch while the speed changes" : "Not at this speed"}
					checked={maintainPitch}
					disabled={!isPitchPreserveAvailable}
					onCheckedChange={(checked) => commitRetime({ rate, maintainPitch: checked })}
				/>
			</InspectorRow>
		</>
	);
}
