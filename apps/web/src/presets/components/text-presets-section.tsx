"use client";

// The user's own looks: Text → Yours (text looks saved from a clip) and Templates → My templates («Create with AI» and
// the plates / templates kept from the timeline), next to the built-in ones.
import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";
import { tileActivation } from "@/components/editor/panels/assets/tile-activation";
import { useEditor } from "@/editor/use-editor";
import { textParamsToCss } from "@/text/preview-css";
import { cn } from "@/utils/ui";
import { designLayerPreset, insertUserTextPreset } from "../actions";
import { type UserTextPreset, useUserPresets } from "../user-presets";
import { CreatePresetTile } from "./create-preset";

const LayerPreview = dynamic(() => import("./layer-preview"), { ssr: false });

/** Text → Yours: the text looks kept from a text clip (a plate or template made by AI is in Templates → My templates). */
export function UserTextPresets() {
	const presets = useUserPresets((state) => state.text).filter((preset) => preset.type === "text");
	return (
		<div className="mb-4">
			<div className="text-muted-foreground mb-2 text-xs">My presets</div>
			<div className="grid grid-cols-2 gap-2">
				{presets.map((preset) => (
					<UserPresetTile key={preset.id} preset={preset} />
				))}
			</div>
		</div>
	);
}

/**
 * Templates → My templates: «Create with AI» (Gaziyav AI designs a plate / template from the user's words; it lands
 * at the playhead as an ordinary editable layer — its texts and colours in the clip's Template tab — and stays here),
 * then the templates kept from the timeline (right-click → Save preset) and made before.
 */
export function MyTemplates() {
	const editor = useEditor();
	const presets = useUserPresets((state) => state.text).filter((preset) => preset.type === "layers");
	const addText = useUserPresets((state) => state.addText);
	return (
		<div className="mb-4" data-my-templates>
			<div className="grid grid-cols-2 gap-2">
				<CreatePresetTile
					runKey="templates"
					label="Create with AI"
					placeholder="A neon lower third with a glowing line…"
					previewClassName="h-16"
					create={async ({ description, signal, onStep }) => {
						const preset = await designLayerPreset({ editor, description, signal, onStep });
						addText(preset);
						// on the timeline right away, at the playhead, as layers of its own
						await insertUserTextPreset({ editor, preset });
					}}
				/>
				{presets.map((preset) => (
					<UserPresetTile key={preset.id} preset={preset} />
				))}
			</div>
		</div>
	);
}

function UserPresetTile({ preset }: { preset: UserTextPreset }) {
	const editor = useEditor();
	const [hovered, setHovered] = useState(false);

	const remove = () => {
		const store = useUserPresets.getState();
		const removed = store.remove("text", preset.id);
		if (!removed) return;
		toast(`“${preset.name}” deleted`, {
			action: { label: "Undo", onClick: () => useUserPresets.getState().restore("text", removed.item, removed.index) },
		});
	};

	// Two sibling buttons, not one inside the other: both reachable by keyboard and screen readers.
	return (
		<div className="group relative" data-user-preset={preset.id}>
			<button
				type="button"
				{...tileActivation(() => void insertUserTextPreset({ editor, preset }))}
				onPointerEnter={() => setHovered(true)}
				onPointerLeave={() => setHovered(false)}
				onFocus={() => setHovered(true)}
				onBlur={() => setHovered(false)}
				title={`${preset.name} — double-click to add at the playhead`}
				className="hover:border-foreground/40 flex w-full flex-col items-center gap-1.5 rounded-md border p-1.5 text-left transition-colors"
			>
				<div className="flex h-16 w-full items-center justify-center overflow-hidden rounded bg-neutral-700 px-1.5 text-center">
					{preset.type === "layers" ? (
						<LayerPreview preset={preset} playing={hovered} />
					) : (
						<span
							style={{ ...textParamsToCss({ params: preset.params, px: 13 }), display: "inline-block" }}
							className="max-w-full leading-tight whitespace-pre-line"
						>
							{preset.content}
						</span>
					)}
				</div>
				<span className="text-muted-foreground max-w-full truncate text-xs">{preset.name}</span>
			</button>
			<button
				type="button"
				aria-label={`Delete ${preset.name}`}
				title="Delete preset"
				onClick={remove}
				className={cn(
					"bg-background/80 text-muted-foreground hover:text-foreground absolute top-1 right-1 flex size-5 items-center justify-center rounded-sm text-sm leading-none",
					"opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100",
				)}
			>
				×
			</button>
		</div>
	);
}
