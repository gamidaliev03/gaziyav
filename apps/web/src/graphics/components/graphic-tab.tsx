"use client";

import { useRef } from "react";
import { useElementPlayhead } from "@/components/editor/panels/properties/hooks/use-element-playhead";
import {
	useKeyframedParamProperty,
	type KeyframedParamPropertyResult,
} from "@/components/editor/panels/properties/hooks/use-keyframed-param-property";
import type { ParamDefinition, ParamValues } from "@/params";
import type { GraphicElement } from "@/timeline";
import { graphicsRegistry, registerDefaultGraphics, resolveGraphicElementParamsAtTime } from "@/graphics";
import { useElementPreview } from "@/timeline/hooks/use-element-preview";
import { useEditor } from "@/editor/use-editor";
import { InspectorGroup } from "@/components/editor/panels/properties/components/inspector-ui";
import { PropertyParamField } from "@/components/editor/panels/properties/components/property-param-field";
import { Switch } from "@/components/ui/switch";
import type { MediaTime } from "@/wasm";
import { AiCustomFields } from "@/montage/components/ai-fields";
import { MographExtras, mographOf } from "@/montage/components/mograph-fields";
import { generatorOf } from "@/generators/document";
import { COMPOSITION_DEF } from "@/montage/flatten";
import { GeneratorTab } from "@/generators/components/generator-tab";

registerDefaultGraphics();

const DEFAULT_STROKE_WIDTH = 2;

export function GraphicTab(props: { element: GraphicElement; trackId: string }) {
	// A compound clip (⌥G) is the clips inside it, not an AI composition: its «AI Composition / With alpha» fields are
	if (props.element.definitionId === COMPOSITION_DEF && props.element.params?.compound === true) return null;
	// Gaziyav AI's own components declare their own fields (texts, colours, sizes, timings, pictures).
	if (props.element.definitionId === "ai.Custom") return <AiCustomFields {...props} />;
	if (generatorOf(props.element)) return <GeneratorTab {...props} />;
	// Ready-made motion graphics: their fields, plus the picture they show and their length.
	if (mographOf(props.element.definitionId)) {
		return (
			<>
				<GraphicParamsTab {...props} />
				<MographExtras {...props} />
			</>
		);
	}
	return <GraphicParamsTab {...props} />;
}

function GraphicParamsTab({
	element,
	trackId,
}: {
	element: GraphicElement;
	trackId: string;
}) {
	const definition = graphicsRegistry.get(element.definitionId);
	const { localTime, isPlayheadWithinElementRange } = useElementPlayhead({
		startTime: element.startTime,
		duration: element.duration,
	});
	const { renderElement } = useElementPreview({
		trackId,
		elementId: element.id,
		fallback: element,
	});

	const liveElement = renderElement as GraphicElement;
	const resolvedParams = resolveGraphicElementParamsAtTime({
		element: liveElement,
		localTime,
	});

	const shapeParams = definition.params.filter((p) => p.group !== "stroke");
	const hasStrokeParams = definition.params.some((p) => p.group === "stroke");

	return (
		<>
			<InspectorGroup id="graphic" title={definition.name}>
				{shapeParams.map((param) => (
					<AnimatedGraphicParamField
						key={param.key}
						param={param}
						trackId={trackId}
						element={liveElement}
						localTime={localTime}
						isPlayheadWithinElementRange={isPlayheadWithinElementRange}
						resolvedParams={resolvedParams}
					/>
				))}
			</InspectorGroup>
			{hasStrokeParams && <StrokeSection element={element} trackId={trackId} />}
		</>
	);
}

function StrokeSection({
	element,
	trackId,
}: {
	element: GraphicElement;
	trackId: string;
}) {
	const editor = useEditor();
	const definition = graphicsRegistry.get(element.definitionId);
	const { localTime, isPlayheadWithinElementRange } = useElementPlayhead({
		startTime: element.startTime,
		duration: element.duration,
	});
	const { renderElement } = useElementPreview({
		trackId,
		elementId: element.id,
		fallback: element,
	});

	const liveElement = renderElement as GraphicElement;
	const resolvedParams = resolveGraphicElementParamsAtTime({
		element: liveElement,
		localTime,
	});
	const strokeParams = definition.params.filter((p) => p.group === "stroke");
	const lastStrokeWidth = useRef(DEFAULT_STROKE_WIDTH);
	const isStrokeEnabled = Number(element.params.strokeWidth ?? 0) > 0;

	const toggleStroke = () => {
		if (isStrokeEnabled) {
			lastStrokeWidth.current = Number(
				element.params.strokeWidth ?? DEFAULT_STROKE_WIDTH,
			);
			editor.timeline.updateElements({
				updates: [
					{
						trackId,
						elementId: element.id,
						patch: { params: { ...element.params, strokeWidth: 0 } },
					},
				],
			});
		} else {
			editor.timeline.updateElements({
				updates: [
					{
						trackId,
						elementId: element.id,
						patch: {
							params: {
								...element.params,
								strokeWidth: lastStrokeWidth.current,
							},
						},
					},
				],
			});
		}
	};

	// the same group as a text's Stroke: a switch in the header, the rows only while it is on
	return (
		<InspectorGroup id="graphic.stroke" title="Stroke" trailing={<Switch aria-label="Stroke on" checked={isStrokeEnabled} onCheckedChange={toggleStroke} />}>
			{isStrokeEnabled
				? strokeParams.map((param) => (
						<AnimatedGraphicParamField
							key={param.key}
							param={param}
							trackId={trackId}
							element={liveElement}
							localTime={localTime}
							isPlayheadWithinElementRange={isPlayheadWithinElementRange}
							resolvedParams={resolvedParams}
						/>
					))
				: null}
		</InspectorGroup>
	);
}

function AnimatedGraphicParamField({
	param,
	trackId,
	element,
	localTime,
	isPlayheadWithinElementRange,
	resolvedParams,
}: {
	key?: string;
	param: ParamDefinition;
	trackId: string;
	element: GraphicElement;
	localTime: MediaTime;
	isPlayheadWithinElementRange: boolean;
	resolvedParams: ParamValues;
}) {
	const animatedParam: KeyframedParamPropertyResult = useKeyframedParamProperty(
		{
			param,
			trackId,
			elementId: element.id,
			animations: element.animations,
			localTime,
			isPlayheadWithinElementRange,
			resolvedValue: resolvedParams[param.key] ?? param.default,
			buildBaseUpdates: ({ value }) => ({
				params: {
					...element.params,
					[param.key]: value,
				},
			}),
		},
	);

	return (
		<PropertyParamField
			param={param}
			value={resolvedParams[param.key] ?? param.default}
			onPreview={animatedParam.onPreview}
			onCommit={animatedParam.onCommit}
			keyframe={{
				isActive: animatedParam.isKeyframedAtTime,
				isAnimated: animatedParam.hasAnimatedKeyframes,
				isDisabled: !isPlayheadWithinElementRange,
				onToggle: animatedParam.toggleKeyframe,
				onReset: animatedParam.resetParam,
			}}
		/>
	);
}
