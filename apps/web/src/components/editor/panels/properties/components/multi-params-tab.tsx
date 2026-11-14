"use client";

import { resolveAnimationPathValueAtTime } from "@/animation";
import { MIN_TRANSFORM_SCALE } from "@/animation/transform";
import { useEditor } from "@/editor/use-editor";
import type { NumberParamDefinition, ParamValue } from "@/params";
import {
	getElementParams,
	readElementParamValue,
	type ElementParamDefinition,
} from "@/params/registry";
import type { TimelineElement } from "@/timeline";
import { ZERO_MEDIA_TIME } from "@/wasm";
import { buildParamUpdates } from "../hooks/apply-params";
import { labelScrub } from "../hooks/label-scrub";
import { getElementPlayhead } from "../hooks/use-element-playhead";
import { InspectorGroup, InspectorMore, InspectorRow, InspectorSlider, Split } from "./inspector-ui";
import { NumberParamField, PropertyParamField } from "./property-param-field";

type Item = { trackId: string; element: TimelineElement };
type NumberParam = ElementParamDefinition & NumberParamDefinition;

/** Text style shared by several selected text/caption clips. */
const TEXT_KEYS: Array<{ key: string; label: string }> = [
	{ key: "fontFamily", label: "Font" },
	{ key: "fontSize", label: "Size" },
	{ key: "fontWeight", label: "Weight" },
	{ key: "color", label: "Color" },
	{ key: "textTransform", label: "Case" },
	{ key: "stroke.enabled", label: "Stroke" },
	{ key: "stroke.color", label: "Stroke color" },
	{ key: "stroke.width", label: "Stroke width" },
	{ key: "shadow.enabled", label: "Shadow" },
	{ key: "highlight.mode", label: "Highlight" },
	{ key: "highlight.color", label: "Highlight color" },
];

/**
 * Several clips selected: only what they all have, in the same groups and rows as for one clip.
 * A change goes to every selected clip in one step (one ⌘Z). Values that differ read "Mixed".
 */
export function MultiParamsTab({ items }: { items: Item[] }) {
	const editor = useEditor();
	// The playhead matters only for animated clips (their value is the one at the playhead); the others
	// don't re-render the panel on every frame of playback.
	const anyAnimated = items.some(({ element }) => Object.keys(element.animations ?? {}).length > 0);
	const playheadTime = useEditor((e) => (anyAnimated ? e.playback.getCurrentTime() : ZERO_MEDIA_TIME));
	const playheadOf = (element: TimelineElement) =>
		getElementPlayhead({ playheadTime, startTime: element.startTime, duration: element.duration });
	const perElement = items.map(({ element }) => getElementParams({ element }));
	const common = (key: string): ElementParamDefinition | null => {
		const defs = perElement.map((params) => params.find((p) => p.key === key));
		return defs.every(Boolean) ? (defs[0] as ElementParamDefinition) : null;
	};
	/** What the clip shows now: for a keyframed value, its value at the playhead (as for one clip). */
	const valueAt = ({ element, param }: { element: TimelineElement; param: ElementParamDefinition }): ParamValue => {
		const own = getElementParams({ element }).find((p) => p.key === param.key) ?? param;
		const base = readElementParamValue({ element, param: own }) ?? param.default;
		return resolveAnimationPathValueAtTime({
			animations: element.animations,
			propertyPath: own.key,
			localTime: playheadOf(element).localTime,
			fallbackValue: base,
		});
	};
	const valuesOf = (param: ElementParamDefinition) => items.map(({ element }) => valueAt({ element, param }));
	const isMixed = (values: ParamValue[]) => values.some((v) => v !== values[0]);

	/**
	 * One preview for all clips; `build` gives each clip's new values. A keyframed value gets a key at the
	 * playhead, like the inspector does for one clip: writing its base value changed nothing on screen
	 * while the panel showed the new number.
	 */
	const preview = (build: (element: TimelineElement) => Array<{ key: string; value: ParamValue }>) => {
		editor.timeline.previewElements({
			updates: items.map(({ trackId, element }) => {
				const params = getElementParams({ element });
				const entries = build(element).flatMap(({ key, value }) => {
					const param = params.find((p) => p.key === key);
					return param ? [{ param, value }] : [];
				});
				const { localTime, isPlayheadWithinElementRange } = playheadOf(element);
				return {
					trackId,
					elementId: element.id,
					updates: buildParamUpdates({ element, entries, localTime, isPlayheadWithinElementRange }),
				};
			}),
		});
	};
	const commit = () => editor.timeline.commitPreview();
	const setAll = (key: string, value: ParamValue) => preview(() => [{ key, value }]);

	const row = (key: string, label?: string, override?: Partial<NumberParamDefinition>, unit?: string) => {
		const param = common(key);
		if (!param) return null;
		const values = valuesOf(param);
		const shown = override ? ({ ...param, ...override } as ElementParamDefinition) : param;
		return (
			<PropertyParamField
				key={key}
				param={shown}
				label={label}
				unit={unit}
				value={values[0]}
				mixed={isMixed(values)}
				onPreview={(value) => setAll(key, value)}
				onCommit={commit}
			/>
		);
	};

	const posX = common("transform.positionX") as NumberParam | null;
	const posY = common("transform.positionY") as NumberParam | null;
	const scaleX = common("transform.scaleX") as NumberParam | null;
	const scaleY = common("transform.scaleY") as NumberParam | null;
	const allText = items.every(({ element }) => element.type === "text");
	const hasTransform = Boolean(posX && posY && scaleX && scaleY);
	const hasOpacity = Boolean(common("opacity"));
	const hasAudio = Boolean(common("volume"));

	const scaleValues = scaleX ? valuesOf(scaleX).map((v) => Math.abs(Number(v)) * 100) : [];
	const setScale = (percent: number) =>
		preview((element) => {
			const sx = scaleX ? Number(valueAt({ element, param: scaleX })) : 1;
			const sy = scaleY ? Number(valueAt({ element, param: scaleY })) : 1;
			const magnitude = Math.max(MIN_TRANSFORM_SCALE, percent / 100);
			const ratio = Math.abs(sx) > 0 ? Math.abs(sy) / Math.abs(sx) : 1;
			return [
				{ key: "transform.scaleX", value: Math.sign(sx || 1) * magnitude },
				{ key: "transform.scaleY", value: Math.sign(sy || 1) * Math.max(MIN_TRANSFORM_SCALE, magnitude * ratio) },
			];
		});

	if (!allText && !hasTransform && !hasOpacity && !hasAudio) {
		return null;
	}

	return (
		<div data-inspector-tab="multi">
			{allText && (
				<InspectorGroup id="multi.text" title="Text style">
					{TEXT_KEYS.map(({ key, label }) => row(key, label))}
				</InspectorGroup>
			)}
			{hasTransform && posX && posY && scaleX && scaleY && (
				<InspectorGroup id="transform" title="Transform">
					{(() => {
						const xs = valuesOf(posX).map(Number);
						const ys = valuesOf(posY).map(Number);
						return (
							<InspectorRow rowId="position" label="Position">
								<Split stackWhenNarrow>
									<NumberParamField param={posX} value={xs[0]} mixed={isMixed(xs)} icon="X" onPreview={(v) => setAll(posX.key, v)} onCommit={commit} />
									<NumberParamField param={posY} value={ys[0]} mixed={isMixed(ys)} icon="Y" onPreview={(v) => setAll(posY.key, v)} onCommit={commit} />
								</Split>
							</InspectorRow>
						);
					})()}
					<InspectorRow rowId="scale" label="Scale" onLabelPointerDown={labelScrub({ value: scaleValues[0] ?? 100, perPixel: 1, onPreview: (v) => setScale(Math.round(v)), onCommit: commit })}>
						<Split slider>
							<InspectorSlider label="Scale" min={1} max={400} step={1} value={scaleValues[0] ?? 100} onChange={setScale} onCommit={commit} />
							<NumberParamField
								param={{ ...scaleX, min: MIN_TRANSFORM_SCALE * 100, max: undefined, step: 1, displayMultiplier: 1 }}
								value={scaleValues[0] ?? 100}
								mixed={isMixed(scaleValues)}
								unit="%"
								onPreview={setScale}
								onCommit={commit}
							/>
						</Split>
					</InspectorRow>
					{row("transform.rotate", "Rotate", undefined, "°")}
				</InspectorGroup>
			)}
			{hasOpacity && (
				<InspectorGroup id="opacity" title="Opacity">
					{row("opacity", "Opacity", { min: 0, max: 100, step: 1, displayMultiplier: 100 }, "%")}
					<InspectorMore id="opacity.more">{row("blendMode", "Blend mode")}</InspectorMore>
				</InspectorGroup>
			)}
			{hasAudio && (
				<InspectorGroup id="audio.volume" title="Volume">
					{row("volume", "Level", undefined, "dB")}
					{row("muted", "Mute")}
				</InspectorGroup>
			)}
		</div>
	);
}
