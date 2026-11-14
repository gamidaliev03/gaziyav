// The caption editor in the right panel (CapCut: a selected caption shows all captions of its track to edit), at the
// top of the Text tab of a caption clip. Registered once when the editor loads (export-button / captions-tab).
import { registerInspectorSection } from "@/components/editor/panels/properties/slots";
import type { TextElement } from "@/timeline";
import { isCaptionElement } from "./apply-style";
import { CaptionEditor } from "./components/caption-editor";

registerInspectorSection({
	id: "subtitles.captions",
	tab: "text",
	title: "Captions",
	order: 50,
	appliesTo: (element) => isCaptionElement(element),
	render: ({ element, trackId }) => <CaptionEditor element={element as TextElement} trackId={trackId} />,
});
