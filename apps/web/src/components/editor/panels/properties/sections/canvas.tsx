"use client";

// Basic → Canvas: what fills the frame around a clip that doesn't cover it (a horizontal video in a
// vertical project): a colour or a blurred copy of the picture. It is a project setting, the same one
// as Settings → Background, so it applies to every clip.
import { useMemo } from "react";
import { ColorPicker } from "@/components/ui/color-picker";
import { useEditor } from "@/editor/use-editor";
import type { TProjectSettings } from "@/project/types";
import {
	BACKGROUND_BLUR_INTENSITY_PRESETS,
	DEFAULT_BACKGROUND_BLUR_INTENSITY,
} from "@/background/blur";
import { DEFAULT_BACKGROUND_COLOR, isSameBackground } from "@/background/color";
import { InspectorGroup, InspectorRow, Segmented } from "../components/inspector-ui";
import { createLiveSetting } from "../hooks/live-setting";

type Background = TProjectSettings["background"];

/** The Canvas group of a main-track clip; an overlay clip gets nothing (the fill is the project's, under everything). */
export function CanvasSection({ trackId }: { trackId: string }) {
	const onMain = useEditor((e) => e.scenes.getActiveSceneOrNull()?.tracks.main.id === trackId, ["scenes", "timeline"]);
	if (!onMain) return null;
	return (
		<InspectorGroup id="canvas" title="Canvas">
			<CanvasRows />
		</InspectorGroup>
	);
}

function CanvasRows() {
	const editor = useEditor();
	const background = useEditor((e) => e.project.getActiveOrNull()?.settings.background ?? null, ["project"]);
	// The colour picker shows its colour live and saves it on release: one undo step back to the colour before.
	const liveBackground = useMemo(
		() =>
			createLiveSetting<Background | null>({
				read: () => editor.project.getActiveOrNull()?.settings.background ?? null,
				write: ({ value, pushHistory }) => {
					if (value) void editor.project.updateSettings({ settings: { background: value }, pushHistory });
				},
				isSame: isSameBackground,
			}),
		[editor],
	);
	if (!background) return null;

	const set = (next: Background, pushHistory = true) =>
		void editor.project.updateSettings({ settings: { background: next }, pushHistory });
	const blurPreset =
		background.type === "blur"
			? (BACKGROUND_BLUR_INTENSITY_PRESETS.find((p) => p.value === background.blurIntensity)?.value ?? null)
			: null;
	const color = background.type === "color" ? background.color : DEFAULT_BACKGROUND_COLOR;

	return (
		<>
			<InspectorRow
				rowId="canvas.type"
				label="Fill"
				isDefault={background.type === "color" && color.toLowerCase() === DEFAULT_BACKGROUND_COLOR}
				onReset={() => set({ type: "color", color: DEFAULT_BACKGROUND_COLOR })}
			>
				<Segmented
					label="Canvas fill"
					value={background.type}
					options={[
						{ value: "color", label: "Color" },
						{ value: "blur", label: "Blur" },
					]}
					onChange={(type) =>
						type === "blur"
							? set({ type: "blur", blurIntensity: BACKGROUND_BLUR_INTENSITY_PRESETS[0]?.value ?? DEFAULT_BACKGROUND_BLUR_INTENSITY })
							: set({ type: "color", color: DEFAULT_BACKGROUND_COLOR })
					}
				/>
			</InspectorRow>
			{background.type === "blur" ? (
				<InspectorRow rowId="canvas.blur" label="Amount" stackWhenNarrow>
					<Segmented
						label="Blur amount"
						value={String(blurPreset ?? "")}
						options={BACKGROUND_BLUR_INTENSITY_PRESETS.map((p) => ({ value: String(p.value), label: p.label }))}
						onChange={(value) => set({ type: "blur", blurIntensity: Number(value) })}
					/>
				</InspectorRow>
			) : (
				<InspectorRow rowId="canvas.color" label="Color">
					<ColorPicker
						className="w-full"
						value={color.replace(/^#/, "").toUpperCase()}
						onChange={(hex) => liveBackground.preview({ type: "color", color: `#${hex}` })}
						onChangeEnd={(hex) => liveBackground.commit({ type: "color", color: `#${hex}` })}
					/>
				</InspectorRow>
			)}
		</>
	);
}
