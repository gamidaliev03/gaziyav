// The AI tools of a clip in the inspector, and the AI tools on sound (an audio clip's Audio tab, a video's Audio tab):
// Enhance voice, Separate voice and music, Voice changer — after the clip's Volume / Voice and music / Clean-up groups.
import { registerInspectorSection } from "@/components/editor/panels/properties/slots";
import { EditorCore } from "@/core";
import type { TimelineElement } from "@/timeline";
import { AutoColor, ColorMatch, EnhanceVoice, RemoveFlickers, RetouchFace, SeparateVoice, VoiceChanger } from "./components/ai-tools";
import { NeuralInspector } from "./components/inspector-ai";

// Each AI tool in its one home (docs/EDITOR-MAP.md): Fix (Remove flickers, Enhance picture, Reduce noise), Retouch
// (Face), Color (AI color correction, Color match), AI (Upscale). Every step made by one of them is a switch there.
const isVideo = (element: TimelineElement) => element.type === "video";
const one = (family: "enhance" | "denoise" | "upscale") =>
	function OneTool({ element, trackId }: { element: TimelineElement; trackId: string }) {
		return (
			<div className="flex flex-col gap-2 px-4 pb-3" data-ai-tool={family}>
				<NeuralInspector element={element} trackId={trackId} only={family} />
			</div>
		);
	};

registerInspectorSection({ id: "video.deflicker", tab: "fix", title: "Remove flickers", order: 100, appliesTo: isVideo, render: (props) => <RemoveFlickers {...props} /> });
registerInspectorSection({ id: "fix.enhance", tab: "fix", title: "Enhance picture", order: 200, appliesTo: isVideo, render: one("enhance") });
registerInspectorSection({ id: "fix.denoise", tab: "fix", title: "Reduce noise", order: 300, defaultOpen: false, appliesTo: isVideo, render: one("denoise") });
registerInspectorSection({ id: "retouch.face", tab: "retouch", title: "Face", order: 50, appliesTo: isVideo, render: (props) => <RetouchFace {...props} /> });
registerInspectorSection({ id: "adjust.autoColor", tab: "color", title: "AI color correction", order: 60, defaultOpen: false, appliesTo: isVideo, render: (props) => <AutoColor {...props} /> });
registerInspectorSection({ id: "adjust.colorMatch", tab: "color", title: "Color match", order: 70, defaultOpen: false, appliesTo: isVideo, render: (props) => <ColorMatch {...props} /> });
registerInspectorSection({ id: "ai.upscale", tab: "ai", title: "Upscale", order: 200, defaultOpen: false, appliesTo: isVideo, render: one("upscale") });

const isUploadAudio = (e: TimelineElement) => e.type === "audio" && e.sourceType === "upload";
const videoWithSound = (e: TimelineElement) =>
	e.type === "video" && e.isSourceAudioEnabled !== false && EditorCore.getInstance().media.getAssets().find((a) => a.id === e.mediaId)?.hasAudio !== false;

const SOUND_TOOLS = [
	{ id: "audio.enhanceVoice", title: "Enhance voice", order: 400, render: EnhanceVoice, defaultOpen: true },
	{ id: "audio.separate", title: "Separate voice and music", order: 410, render: SeparateVoice, defaultOpen: true },
	{ id: "audio.voiceChanger", title: "Voice changer", order: 420, render: VoiceChanger, defaultOpen: false },
];
for (const tool of SOUND_TOOLS) {
	// An audio clip's own tab is "basic" (shown as Audio); a video's sound has the Audio tab.
	registerInspectorSection({ id: `${tool.id}@basic`, tab: "basic", title: tool.title, order: tool.order, defaultOpen: tool.defaultOpen, appliesTo: isUploadAudio, render: (props) => <tool.render {...props} /> });
	registerInspectorSection({ id: `${tool.id}@audio`, tab: "audio", title: tool.title, order: tool.order, defaultOpen: tool.defaultOpen, appliesTo: videoWithSound, render: (props) => <tool.render {...props} /> });
}
