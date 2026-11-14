"use client";

// Inspector → Basic → «Shadow» (docs/EDITOR-MAP.md: the clip's look, next to Blend; a text's Shadow is in its Text tab):
// the drop shadow of a video, photo, sticker, shape or AI layer (shadow/layer-shadow.ts). The same group as a text's
// Shadow: a switch in the header, the rows under it. Each change is one ⌘Z.
import { InspectorGroup } from "@/components/editor/panels/properties/components/inspector-ui";
import { ParamRows, type ParamRowSpec } from "@/components/editor/panels/properties/components/element-params-tab";
import { registerInspectorSection } from "@/components/editor/panels/properties/slots";
import { Switch } from "@/components/ui/switch";
import { useEditor } from "@/editor/use-editor";
import { getElementParam, readElementParamValue, writeElementParamValue } from "@/params/registry";
import type { TimelineElement } from "@/timeline";
import { SHADOW_ELEMENT_TYPES } from "./params";

const ROWS: ParamRowSpec[] = [
	{ key: "shadow.color", label: "Color" },
	{ key: "shadow.opacity", label: "Opacity", unit: "%" },
	{ key: "shadow.blur", label: "Blur", unit: "%" },
	{ key: "shadow.distance", label: "Distance", unit: "%" },
	{ key: "shadow.angle", label: "Angle", unit: "°" },
	{ key: "shadow.spread", label: "Spread", unit: "%" },
];

function ShadowSection({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const editor = useEditor();
	const toggle = getElementParam({ element, key: "shadow.enabled" });
	const enabled = toggle ? readElementParamValue({ element, param: toggle }) === true : false;
	return (
		<InspectorGroup
			id="shadow@basic"
			title="Shadow"
			trailing={
				toggle ? (
					<Switch
						aria-label="Shadow on"
						data-layer-shadow-toggle=""
						checked={enabled}
						onCheckedChange={(on) =>
							editor.timeline.updateElements({
								updates: [{ trackId, elementId: element.id, patch: writeElementParamValue({ element, param: toggle, value: on }) }],
							})
						}
					/>
				) : undefined
			}
		>
			{enabled ? <ParamRows element={element} trackId={trackId} rows={ROWS} /> : null}
		</InspectorGroup>
	);
}

registerInspectorSection({
	id: "shadow@basic",
	tab: "basic",
	title: "Shadow",
	order: 250,
	bare: true,
	appliesTo: (element) => (SHADOW_ELEMENT_TYPES as readonly string[]).includes(element.type),
	render: ({ element, trackId }) => <ShadowSection element={element} trackId={trackId} />,
});
