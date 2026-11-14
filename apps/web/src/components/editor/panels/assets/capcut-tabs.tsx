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

// over them (polish3 D, 13.11): with one place there is no section column at all (MaterialsLayout).
const MEDIA_NAV: NavItem[] = [{ key: "media", label: "Media" }];

const ALL_AUDIO_NAV: NavItem[] = [
	{ key: "music", label: "Music" },
	{ key: "sfx", label: "Sound effects" },
	{ key: "tts", label: "Voice", badge: "AI" },
	{ key: "mine", label: "Yours" },
];
// (the browser edition: the site's own sound pack and the visitor's saved sounds; a music catalog and the voice
// generator need the Mac app)
const AUDIO_NAV: NavItem[] = ALL_AUDIO_NAV.filter((item) => !DEMO || item.key === "sfx" || item.key === "mine");

// AI: the generators in one place — a picture, a video, a talking avatar, a translated video.
const AVATAR_NAV: NavItem[] = [
	{ key: "ai-image", label: "AI image" },
	{ key: "ai-video", label: "AI video" },
	{ key: "photo", label: "Lipsync" },
	{ key: "translator", label: "Translator" },
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
		<MaterialsLayout
			tab="sounds"
			items={AUDIO_NAV}
			render={(section) =>
				section === "tts" ? (
					<div className="min-h-0 flex-1 overflow-y-auto">
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
		<MaterialsLayout
			tab="avatar"
			items={AVATAR_NAV}
			render={(section) =>
				section === "ai-image" ? (
					<PointView key="image" kind="image" title="AI image" />
				) : section === "ai-video" ? (
					<PointView key="video" kind="video" title="AI video" />
				) : section === "translator" ? (
					<div className="min-h-0 flex-1 overflow-y-auto" data-avatar-section="translator">
						<VideoTranslator />
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
