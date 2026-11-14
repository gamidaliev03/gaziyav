"use client";

// Basic → Transform in CapCut's order: Scale (uniform or X / Y), Uniform scale, Position (X | Y), Rotation, the align row, Flip.
// Every number can be typed, dragged on its handle (X, Y, %, °) or slid; each row has its own reset and keyframe ◆.
import { HugeiconsIcon } from "@/components/ui/icon";
import {
	AlignBottomIcon,
	AlignHorizontalCenterIcon,
	AlignLeftIcon,
	AlignRightIcon,
	AlignTopIcon,
	AlignVerticalCenterIcon,
	ArrowTurnBackwardIcon,
} from "@hugeicons/core-free-icons";
import { resolveAnimationPathValueAtTime } from "@/animation";
import { MIN_TRANSFORM_SCALE } from "@/animation/transform";
import { Switch } from "@/components/ui/switch";
import type { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import type { NumberParamDefinition } from "@/params";
import { getVisibleElementsWithBounds } from "@/preview/element-bounds";
import {
	getElementParams,
	readElementParamValue,
	type ElementParamDefinition,
} from "@/params/registry";
import type { TimelineElement } from "@/timeline";
import { useElementPlayhead } from "../hooks/use-element-playhead";
import { applyParamValues, keyframeState, keyStepper, toggleKeyframes } from "../hooks/apply-params";
import { labelScrub } from "../hooks/label-scrub";
import { resetParams } from "../hooks/reset-params";
import { usePropertiesStore } from "../stores/properties-store";
import { NumberParamField } from "../components/property-param-field";
import { InspectorMore, InspectorRow, InspectorSlider, Split } from "../components/inspector-ui";
import { Button } from "@/components/ui/button";
import { openCropForSelection } from "@/timeline/components/crop-dialog";

const SCALE_PERCENT_MAX = 400;
const SCALE_TYPED_MAX = 10_000;

type NumberParam = ElementParamDefinition & NumberParamDefinition;

export const TRANSFORM_KEYS = [
	"transform.positionX",
	"transform.positionY",
	"transform.scaleX",
	"transform.scaleY",
	"transform.rotate",
] as const;

export function TransformSection({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const editor = useEditor();
	const { localTime, isPlayheadWithinElementRange } = useElementPlayhead({
		startTime: element.startTime,
		duration: element.duration,
		animated: Object.keys(element.animations ?? {}).length > 0,
	});
	const uniform = usePropertiesStore((s) => s.isScaleUniform);
	const setUniform = usePropertiesStore((s) => s.setScaleUniform);
	const params = getElementParams({ element });
	const get = (key: string) => params.find((p) => p.key === key) as NumberParam | undefined;
	const posX = get("transform.positionX");
	const posY = get("transform.positionY");
	const scaleX = get("transform.scaleX");
	const scaleY = get("transform.scaleY");
	const rotate = get("transform.rotate");
	if (!posX || !posY || !scaleX || !scaleY || !rotate) return null;

	const value = (param: NumberParam) =>
		Number(
			resolveAnimationPathValueAtTime({
				animations: element.animations,
				propertyPath: param.key,
				localTime,
				fallbackValue: readElementParamValue({ element, param }) ?? param.default,
			}),
		);
	const x = value(posX);
	const y = value(posY);
	const sx = value(scaleX);
	const sy = value(scaleY);
	const rot = value(rotate);

	const write = (entries: Array<{ param: NumberParam; value: number }>, commit = false) =>
		applyParamValues({ editor, element, trackId, entries, localTime, isPlayheadWithinElementRange, commit });
	const commit = () => editor.timeline.commitPreview();
	// ↺ of a row: its keys go and the default comes back, one ⌘Z (it used to add a key with the default instead).
	const reset = (entries: Array<{ param: NumberParam; value: number }>) => resetParams({ editor, trackId, element, entries });
	const keyframe = (paths: NumberParam[], values: number[]) => {
		const state = keyframeState({ element, paths: paths.map((p) => p.key), localTime, isPlayheadWithinElementRange });
		return {
			...state,
			...keyStepper({ editor, element, paths: paths.map((p) => p.key), localTime }),
			isDisabled: !isPlayheadWithinElementRange,
			onToggle: () =>
				toggleKeyframes({
					editor,
					element,
					trackId,
					localTime,
					channels: paths.map((p, i) => ({ path: p.key, value: values[i] })),
				}),
		};
	};

	// Scale is shown as a percentage of the fitted size; a negative scale is a flip, so the sign is kept.
	const signX = sx < 0 ? -1 : 1;
	const signY = sy < 0 ? -1 : 1;
	const percentParam = (param: NumberParam, label: string): NumberParam => ({
		...param,
		label,
		min: MIN_TRANSFORM_SCALE * 100,
		// Typed past the slider's 400 % it still goes, up to 10 000 % (100000 % was taken as it was — blind test 05.11).
		max: SCALE_TYPED_MAX,
		step: 1,
		displayMultiplier: 1,
	});
	const scalePercent = percentParam(scaleX, "Scale");
	const setUniformScale = (percent: number, commitNow = false) => {
		const magnitude = Math.max(MIN_TRANSFORM_SCALE, percent / 100);
		const ratio = Math.abs(sx) > 0 ? Math.abs(sy) / Math.abs(sx) : 1;
		write(
			[
				{ param: scaleX, value: signX * magnitude },
				{ param: scaleY, value: signY * Math.max(MIN_TRANSFORM_SCALE, magnitude * ratio) },
			],
			commitNow,
		);
	};
	const setAxisScale = (param: NumberParam, sign: number, percent: number) =>
		write([{ param, value: sign * Math.max(MIN_TRANSFORM_SCALE, percent / 100) }]);

	const isDefaultScale = Math.abs(Math.abs(sx) - scaleX.default) < 1e-6 && Math.abs(Math.abs(sy) - scaleY.default) < 1e-6;

	// One Scale field only while X and Y are equal: stretched by the player's side handle the picture was 71 × 61 % and
	// the single field read 71, hiding it (targeted test 05.11). Unequal, both show until they are made equal again.
	const showUniform = uniform && Math.abs(Math.abs(sx) - Math.abs(sy)) < 1e-4;

	return (
		<>
			<InspectorRow
				rowId="position"
				label="Position"
				isDefault={x === posX.default && y === posY.default}
				onReset={() => reset([{ param: posX, value: posX.default }, { param: posY, value: posY.default }])}
				keyframe={keyframe([posX, posY], [x, y])}
			>
				<Split stackWhenNarrow>
					<NumberParamField param={posX} value={x} icon="X" onPreview={(v) => write([{ param: posX, value: v }])} onCommit={commit} />
					<NumberParamField param={posY} value={y} icon="Y" onPreview={(v) => write([{ param: posY, value: v }])} onCommit={commit} />
				</Split>
			</InspectorRow>

			{showUniform ? (
				<InspectorRow
					rowId="scale"
					label="Scale"
					isDefault={isDefaultScale}
					// Both axes back to the default (a flip stays a flip): setUniformScale keeps the X/Y ratio of a
					// non-uniform scale, so 200/100 reset to 100/50 and never to default.
					onReset={() =>
						reset([
							{ param: scaleX, value: signX * scaleX.default },
							{ param: scaleY, value: signY * scaleY.default },
						])
					}
					keyframe={keyframe([scaleX, scaleY], [sx, sy])}
					onLabelPointerDown={labelScrub({ value: Math.abs(sx) * 100, perPixel: 1, onPreview: (v) => setUniformScale(Math.round(v)), onCommit: commit })}
				>
					<Split slider>
						<InspectorSlider
							label="Scale"
							min={1}
							max={SCALE_PERCENT_MAX}
							step={1}
							value={Math.abs(sx) * 100}
							onChange={(v) => setUniformScale(v)}
							onCommit={commit}
						/>
						<NumberParamField param={scalePercent} value={Math.abs(sx) * 100} unit="%" onPreview={(v) => setUniformScale(v)} onCommit={commit} />
					</Split>
				</InspectorRow>
			) : (
				[
						{ param: scaleX, label: "Scale X", v: sx, sign: signX },
						{ param: scaleY, label: "Scale Y", v: sy, sign: signY },
					].map(({ param, label, v, sign }) => (
						<InspectorRow
							key={param.key}
							rowId={param.key}
							label={label}
							isDefault={Math.abs(Math.abs(v) - param.default) < 1e-6}
							onReset={() => reset([{ param, value: sign * param.default }])}
							keyframe={keyframe([param], [v])}
							onLabelPointerDown={labelScrub({ value: Math.abs(v) * 100, perPixel: 1, onPreview: (p) => setAxisScale(param, sign, Math.round(p)), onCommit: commit })}
						>
							<Split slider>
								<InspectorSlider
									label={label}
									min={1}
									max={SCALE_PERCENT_MAX}
									step={1}
									value={Math.abs(v) * 100}
									onChange={(p) => setAxisScale(param, sign, p)}
									onCommit={commit}
								/>
								<NumberParamField
									param={percentParam(param, label)}
									value={Math.abs(v) * 100}
									unit="%"
									onPreview={(p) => setAxisScale(param, sign, p)}
									onCommit={commit}
								/>
							</Split>
						</InspectorRow>
					))
			)}
			<InspectorRow
				rowId="rotation"
				label="Rotate"
				isDefault={rot === rotate.default}
				onReset={() => reset([{ param: rotate, value: rotate.default }])}
				keyframe={keyframe([rotate], [rot])}
				onLabelPointerDown={labelScrub({
					value: rot,
					perPixel: 1,
					onPreview: (v) => write([{ param: rotate, value: Math.max(rotate.min, Math.min(rotate.max ?? 360, Math.round(v))) }]),
					onCommit: commit,
				})}
			>
				<Split slider>
					<InspectorSlider
						label="Rotate"
						min={-180}
						max={180}
						step={1}
						value={rot}
						onChange={(v) => write([{ param: rotate, value: v }])}
						onCommit={commit}
					/>
					<NumberParamField param={rotate} value={rot} unit="°" onPreview={(v) => write([{ param: rotate, value: v }])} onCommit={commit} />
				</Split>
			</InspectorRow>

			<InspectorMore id="transform.more">
				<InspectorRow rowId="uniform-scale" label="Uniform scale">
					<div className="flex h-7 items-center">
						<Switch aria-label="Uniform scale" checked={uniform} onCheckedChange={(on) => setUniform({ uniform: on })} />
					</div>
				</InspectorRow>

				<InspectorRow rowId="align" label="Align">
					<div className="grid grid-cols-6 gap-1" data-align-row>
						{ALIGNS.map((align) => (
							<button
								key={align.id}
								type="button"
								aria-label={align.label}
								title={align.label}
								onClick={() => {
									const at = alignedPosition({ editor, element, align: align.id, own: { x, y } });
									if (!at) return;
									write(
										align.axis === "x" ? [{ param: posX, value: at.x }] : [{ param: posY, value: at.y }],
										true,
									);
								}}
								className="border-border bg-accent text-muted-foreground hover:text-foreground focus-visible:ring-ring flex h-7 min-w-0 cursor-pointer items-center justify-center rounded-md border outline-none focus-visible:ring-1"
							>
								<HugeiconsIcon icon={align.icon} className="size-3.5" />
							</button>
						))}
					</div>
				</InspectorRow>
				{(element.type === "video" || element.type === "image") && (
					<InspectorRow rowId="crop" label="Crop" inline>
						<Button size="sm" variant="secondary" className="h-7" data-transform-crop onClick={() => openCropForSelection(editor)}>
							Crop…
						</Button>
					</InspectorRow>
				)}
			</InspectorMore>
		</>
	);
}

/**
 * ↺ on the Transform section: Position, Scale (flips too) and Rotation back to their defaults with every key of
 * theirs gone — one ⌘Z. Shown only when there is something to reset.
 */
export function TransformResetButton({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const editor = useEditor();
	const params = getElementParams({ element });
	const entries = TRANSFORM_KEYS.flatMap((key) => {
		const param = params.find((p) => p.key === key) as NumberParam | undefined;
		return param ? [{ param, value: param.default }] : [];
	});
	const animated = TRANSFORM_KEYS.some((key) => element.animations?.[key]);
	const atDefault = entries.every(({ param }) => (readElementParamValue({ element, param }) ?? param.default) === param.default);
	if (entries.length === 0 || (!animated && atDefault)) return null;
	return (
		<button
			type="button"
			aria-label="Reset Transform"
			title="Reset Transform: position, scale, rotation and their keyframes"
			onClick={() => resetParams({ editor, trackId, element, entries })}
			className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-6 cursor-pointer items-center justify-center rounded-sm"
		>
			<HugeiconsIcon icon={ArrowTurnBackwardIcon} className="size-3.5" />
		</button>
	);
}

type AlignId = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** CapCut's row under Rotate: the clip's edge (its rotated box) onto the frame's edge or centre. */
const ALIGNS: Array<{ id: AlignId; axis: "x" | "y"; label: string; icon: typeof AlignLeftIcon }> = [
	{ id: "left", axis: "x", label: "Align left", icon: AlignLeftIcon },
	{ id: "hcenter", axis: "x", label: "Align center", icon: AlignHorizontalCenterIcon },
	{ id: "right", axis: "x", label: "Align right", icon: AlignRightIcon },
	{ id: "top", axis: "y", label: "Align top", icon: AlignTopIcon },
	{ id: "vcenter", axis: "y", label: "Align middle", icon: AlignVerticalCenterIcon },
	{ id: "bottom", axis: "y", label: "Align bottom", icon: AlignBottomIcon },
];

/** The position (canvas px from the centre) that puts the clip's box against that edge, or null when it isn't measurable. */
function alignedPosition({
	editor,
	element,
	align,
	own,
}: {
	editor: EditorCore;
	element: TimelineElement;
	align: AlignId;
	/** The position the inspector shows (at the playhead). */
	own: { x: number; y: number };
}): { x: number; y: number } | null {
	const scene = editor.scenes.getActiveSceneOrNull();
	const project = editor.project.getActiveOrNull();
	if (!scene || !project) return null;
	const { width: cw, height: ch } = project.settings.canvasSize;
	// measured where the playhead is when it is over the clip, else at the clip's first frame
	const now = Number(editor.playback.getCurrentTime());
	const time = now >= element.startTime && now < element.startTime + element.duration ? now : element.startTime;
	const found = getVisibleElementsWithBounds({ tracks: scene.tracks, currentTime: time, canvasSize: { width: cw, height: ch }, mediaAssets: editor.media.getAssets() }).find(
		(entry) => entry.elementId === element.id,
	);
	if (!found) return null;
	const { cx, cy, width, height, rotation } = found.bounds;
	const rad = (rotation * Math.PI) / 180;
	const halfW = (Math.abs(width * Math.cos(rad)) + Math.abs(height * Math.sin(rad))) / 2;
	const halfH = (Math.abs(width * Math.sin(rad)) + Math.abs(height * Math.cos(rad))) / 2;
	// the box may sit off its position (an animation or a tracker moving it): keep that offset
	const x = cx - cw / 2;
	const y = cy - ch / 2;
	const dx = own.x - x;
	const dy = own.y - y;
	switch (align) {
		case "left":
			return { x: Math.round(halfW - cw / 2 + dx), y: own.y };
		case "hcenter":
			return { x: Math.round(dx), y: own.y };
		case "right":
			return { x: Math.round(cw / 2 - halfW + dx), y: own.y };
		case "top":
			return { x: own.x, y: Math.round(halfH - ch / 2 + dy) };
		case "vcenter":
			return { x: own.x, y: Math.round(dy) };
		case "bottom":
			return { x: own.x, y: Math.round(ch / 2 - halfH + dy) };
	}
}
