"use client";

// Media, Audio and AI avatar laid out like CapCut 9.5 (docs/capcut/materials.md): the section column on the left, the
// section on the right. fal.ai sits where CapCut has its cloud AI (pictures, video, voice, lipsync); without a key its
// places say where the key goes.
import { DEMO } from "@/demo/flag";
import { MaterialsLayout, type NavItem } from "./materials-nav";
import { MediaView } from "./views/assets";
import { LocalGenerator } from "@/generate/components/generate-view";
import { PointView } from "@/cloud/components/point-view";
import { SoundsPanel } from "@/sounds/components/library-view";
import { LipsyncView } from "@/studio/components/lipsync-view";
import { PhotoAvatar } from "@/studio/components/photo-avatar";
import { VideoTranslator } from "@/generate/components/video-translator";
import { DownloadsView, useWithDownloads } from "@/platform/desktop-sections";
import { ToolHub, ToolRow, type Tool } from "./ai-hub";
import { AudioWave01Icon, Folder01Icon, Image01Icon, Mic01Icon, MusicNote01Icon, TranslateIcon, Video01Icon, VoiceIcon } from "@hugeicons/core-free-icons";

// over them (polish3 D, 13.11): with one place there is no section column at all (MaterialsLayout).
const MEDIA_NAV: NavItem[] = [{ key: "media", label: "Media" }];

const ALL_AUDIO_NAV: NavItem[] = [
	{ key: "music", label: "Music" },
	{ key: "sfx", label: "Sound effects" },
	{ key: "tts", label: "Voice", badge: "AI" },
	{ key: "mine", label: "Yours" },
];
// (the browser edition: the whole music and sound library, public/sound-library.json, and the visitor's saved sounds;
// the voice generator needs the Mac app)
const AUDIO_NAV: NavItem[] = ALL_AUDIO_NAV.filter((item) => !DEMO || item.key !== "tts");

// Audio and AI as tools, not as a tree: one row of names (Audio), one shelf of cards (AI). The keys are the store's
// sections, so a place is remembered as before; the icons show only on the AI shelf.
const AUDIO_TOOLS: Tool[] = AUDIO_NAV.map((item): Tool => {
	const icon = item.key === "music" ? MusicNote01Icon : item.key === "sfx" ? AudioWave01Icon : item.key === "tts" ? VoiceIcon : Folder01Icon;
	return { key: item.key, label: item.label, icon, ...(item.badge ? { badge: item.badge } : {}) };
});

const AI_TOOLS: Tool[] = [
	{ key: "ai-image", label: "AI image", line: "A picture from a description", icon: Image01Icon },
	{ key: "ai-video", label: "AI video", line: "A short clip from a description", icon: Video01Icon },
	{ key: "photo", label: "Lipsync", line: "Make a face say new words", icon: Mic01Icon },
	{ key: "translator", label: "Translator", line: "Dub a clip into another language", icon: TranslateIcon },
	{ key: "voice", label: "Voice-over", line: "Text to a voice, 10 languages", icon: VoiceIcon, badge: "AI" },
];

export function MediaTab() {
	const items = useWithDownloads(MEDIA_NAV);
	return (
		<MaterialsLayout
			tab="media"
			items={items}
			render={(section) =>
				section === "downloads" ? <DownloadsView /> : <MediaView />
			}
		/>
	);
}

export function AudioTab() {
	return (
		<ToolRow
			tab="sounds"
			tools={AUDIO_TOOLS}
			render={(section) =>
				section === "tts" ? (
					<div className="min-h-0 flex-1" data-tts>
						<LocalGenerator kind="voice" />
					</div>
				) : (
					<SoundsPanel key={section} section={section as "sfx" | "music" | "mine"} />
				)
			}
		/>
	);
}

export function AvatarTab() {
	return (
		<ToolHub
			tab="avatar"
			tools={AI_TOOLS}
			render={(section) =>
				section === "ai-image" ? (
					<PointView key="image" kind="image" title="AI image" />
				) : section === "ai-video" ? (
					<PointView key="video" kind="video" title="AI video" />
				) : section === "translator" ? (
					<div className="min-h-0 flex-1 overflow-y-auto" data-avatar-section="translator">
						<VideoTranslator />
					</div>
				) : section === "voice" ? (
					<div className="min-h-0 flex-1" data-avatar-section="voice" data-tts>
						<LocalGenerator kind="voice" />
					</div>
				) : (
					<div className="min-h-0 flex-1 overflow-y-auto" data-avatar-section={section}>
						{section === "photo" && <PhotoAvatar />}
						<LipsyncView />
					</div>
				)
			}
		/>
	);
}

// Captions (Auto captions · Templates · Auto lyrics · Add captions): subtitles/components/captions-tab.tsx.
export { CaptionsTab } from "@/subtitles/components/captions-tab";
