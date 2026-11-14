"use client";
// Inside a compound clip (CapCut's subproject): one slim row — Back (Esc) and where you are. The AI prompt, draw tools,
// layers and versions of the old AI composition editor are gone (docs/EDITOR-MAP.md).
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import { closeComposition, findCompositionOwner } from "@/montage/compositions";
import { useKeybindingsStore } from "@/actions/keybindings-store";
import { formatShortcut } from "@/actions/keybinding";
import { isAppleDevice } from "@/utils/platform";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
export function NestedTimelineBar() {
	const t = useT();
	const where = useEditor((e) => {
		const active = e.scenes.getActiveSceneOrNull();
		if (!active) return "";
		const owner = findCompositionOwner(e.scenes.getScenes(), active.id);
		if (owner) return `${owner.scene.isMain ? "Main" : owner.scene.name}\u0000${active.name}`;
		// opened from Media (a compound clip placed nowhere): Back leads to the main timeline
		return active.inMedia && !active.isMain ? `Main\u0000${active.name}` : "";
	}, ["scenes"]);
	// the real key of «Back» in the keymap (⌘↑ by default; Esc never leaves a timeline: it deselects)
	const backKey = useKeybindingsStore((state) => {
		for (const [key, action] of state.keybindings) if (action === "exit-composition") return formatShortcut({ shortcut: key, isMac: isAppleDevice() });
		return "";
	});
	if (!where) return null;
	const [parent, name] = where.split("\u0000");
	return (
		<div data-nested-bar className="flex h-8 items-center gap-1 border-b px-2">
			<Button variant="text" size="sm" className="shrink-0 gap-1 px-1.5" title={`${t("Back to the parent timeline")}${backKey ? ` (${backKey})` : ""}`} onClick={() => void closeComposition()}>
				<HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
				{t("Back")}
			</Button>
			<div className="text-muted-foreground min-w-0 truncate text-xs">
				<button type="button" className="hover:text-foreground hover:underline" onClick={() => void closeComposition()}>
					{t(parent)}
				</button>{" "}
				<HugeiconsIcon icon={ArrowRight01Icon} className="size-3 opacity-60" /> <span className="text-foreground font-medium">{name}</span>
			</div>
		</div>
	);
}
