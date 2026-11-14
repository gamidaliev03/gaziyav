"use client";

// A generator's own rows in the inspector: its typed params (colour, number, select, switch) in the product's own
// fields, each keyframable like any graphic param. A change of a value also updates the carrier's colour
// (document.ts: what an older build shows).
import { useElementPlayhead } from "@/components/editor/panels/properties/hooks/use-element-playhead";
import { useKeyframedParamProperty } from "@/components/editor/panels/properties/hooks/use-keyframed-param-property";
import { InspectorGroup } from "@/components/editor/panels/properties/components/inspector-ui";
import { PropertyParamField } from "@/components/editor/panels/properties/components/property-param-field";
import { resolveGraphicElementParamsAtTime } from "@/graphics";
import type { ParamDefinition, ParamValues } from "@/params";
import type { GraphicElement } from "@/timeline";
import { useElementPreview } from "@/timeline/hooks/use-element-preview";
import type { MediaTime } from "@/wasm";
import { generatorOf, withCarrierSynced } from "../document";

export function GeneratorTab({ element, trackId }: { element: GraphicElement; trackId: string }) {
	const spec = generatorOf(element);
	const { localTime, isPlayheadWithinElementRange } = useElementPlayhead({ startTime: element.startTime, duration: element.duration });
	const { renderElement } = useElementPreview({ trackId, elementId: element.id, fallback: element });
	if (!spec) return null;
	const live = renderElement as GraphicElement;
	const resolved = resolveGraphicElementParamsAtTime({ element: live, localTime });
	// rows follow the base values (a stop count keyframed up still lists the stops it reaches at the playhead)
	const rows = spec.params.filter((param) => spec.shows?.(param.key, resolved) ?? true);
	return (
		<InspectorGroup id="generator" title={spec.name}>
			{rows.map((param) => (
				<GeneratorParamField
					key={param.key}
					param={param}
					trackId={trackId}
					element={live}
					localTime={localTime}
					isPlayheadWithinElementRange={isPlayheadWithinElementRange}
					resolvedParams={resolved}
				/>
			))}
		</InspectorGroup>
	);
}

function GeneratorParamField({
	param,
	trackId,
	element,
	localTime,
	isPlayheadWithinElementRange,
	resolvedParams,
}: {
	param: ParamDefinition;
	trackId: string;
	element: GraphicElement;
	localTime: MediaTime;
	isPlayheadWithinElementRange: boolean;
	resolvedParams: ParamValues;
}) {
	const animated = useKeyframedParamProperty({
		param,
		trackId,
		elementId: element.id,
		animations: element.animations,
		localTime,
		isPlayheadWithinElementRange,
		resolvedValue: resolvedParams[param.key] ?? param.default,
		buildBaseUpdates: ({ value }) => ({ params: withCarrierSynced({ ...element.params, [param.key]: value }) }),
	});
	return (
		<PropertyParamField
			param={param}
			value={resolvedParams[param.key] ?? param.default}
			onPreview={animated.onPreview}
			onCommit={animated.onCommit}
			keyframe={{
				isActive: animated.isKeyframedAtTime,
				isAnimated: animated.hasAnimatedKeyframes,
				isDisabled: !isPlayheadWithinElementRange,
				onToggle: animated.toggleKeyframe,
				onReset: animated.resetParam,
			}}
		/>
	);
}
