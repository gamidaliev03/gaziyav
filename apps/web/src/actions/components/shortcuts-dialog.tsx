"use client";

import { useEffect, useMemo, useState } from "react";
import { ACTIONS, type TActionWithOptionalArgs } from "@/actions";
import { generateKeybindingString, useKeybindingsStore } from "@/actions/keybindings-store";
import { formatShortcut, getShortcutParts, type ShortcutKey } from "@/actions/keybinding";
import {
	getPresetBindings,
	KEYMAP_PRESET_IDS,
	KEYMAP_PRESETS,
	type KeymapPresetId,
} from "@/actions/keybindings/presets";
import {
	assignInDraft,
	clearInDraft,
	findConflict,
	getTabActions,
	isSameKeymap,
	keysByAction,
	SHORTCUT_TABS,
	type ShortcutTab,
	validateShortcut,
} from "@/actions/keybindings/shortcuts-editor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { isAppleDevice } from "@/utils/platform";
import { cn } from "@/utils/ui";
import { useT } from "@/i18n";

/** Keys that work by context (not rebindable): asset tiles, dialogs, timeline mouse. Shown on the Other tab. */
const CONTEXTUAL_KEYS: Array<[string, string]> = [
	["Move between tiles (Media, Audio, Text, Effects…)", "← → ↑ ↓"],
	["Apply / add the tile (effects, transitions, stickers, text…)", "Double-click, ↩"],
	["Play / pause from anywhere (except while typing)", "Space"],
	["Leave the tiles", "Esc"],
	["Source preview (a media item clicked): play / shuttle / mark", "Space · J K L · I O"],
	["Insert the source In→Out at the playhead", "↩ / double-click / drag"],
	["Confirm a dialog", "↩"],
	["Close a dialog or menu", "Esc"],
	["Select a range of clips", "⇧ Click"],
	["Add or remove a clip from the selection", "⌘ Click"],
	["Duplicate a clip while dragging", "⌥ Drag"],
	["Drag without snapping", "⌘ Drag"],
	["Zoom the timeline", "⌘ / ⌥ Scroll, Pinch"],
];

type Prompt =
	| { kind: "conflict"; key: ShortcutKey; action: TActionWithOptionalArgs; owner: TActionWithOptionalArgs }
	| { kind: "invalid"; message: string }
	| { kind: "discard" };

const describe = (action: TActionWithOptionalArgs) => ACTIONS[action].description;

/**
 * Shortcuts — CapCut's window (docs/capcut/screens/shortcuts-window.jpg): Timeline / Player / Basic / Other, the preset
 * list, two columns of commands; click a command and press the new keys. A key that belongs to another command asks
 * «Override it?». Nothing changes until Save; Cancel or closing with edits asks first; Reset goes back to the preset.
 */
export function ShortcutsDialog({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
	const t = useT();
	const savedKeybindings = useKeybindingsStore((s) => s.keybindings);
	const savedPreset = useKeybindingsStore((s) => s.preset);
	const saveKeymap = useKeybindingsStore((s) => s.saveKeymap);
	const setIsRecording = useKeybindingsStore((s) => s.setIsRecording);

	const [tab, setTab] = useState<ShortcutTab>("timeline");
	const [preset, setPreset] = useState<KeymapPresetId>(savedPreset);
	const [draft, setDraft] = useState(() => new Map(savedKeybindings));
	const [recording, setRecording] = useState<TActionWithOptionalArgs | null>(null);
	const [prompt, setPrompt] = useState<Prompt | null>(null);
	const isMac = typeof navigator === "undefined" ? true : isAppleDevice();

	// Each opening starts from what is saved.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only when the window opens
	useEffect(() => {
		if (!isOpen) return;
		setPreset(savedPreset);
		setDraft(new Map(savedKeybindings));
		setPrompt(null);
		setRecording(null);
	}, [isOpen]);

	const isDirty = preset !== savedPreset || !isSameKeymap(draft, savedKeybindings);
	const keys = useMemo(() => keysByAction(draft), [draft]);
	const actions = useMemo(() => getTabActions(tab), [tab]);

	const stopRecording = () => {
		setRecording(null);
		setIsRecording(false);
	};

	const assign = (key: ShortcutKey, action: TActionWithOptionalArgs) => setDraft((current) => assignInDraft({ keymap: current, key, action }));

	// The next key combination goes to the row that is recording.
	// biome-ignore lint/correctness/useExhaustiveDependencies: stopRecording only clears this window's own state
	useEffect(() => {
		if (!recording) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (["Meta", "Control", "Alt", "Shift", "CapsLock", "Fn"].includes(event.key)) return;
			event.preventDefault();
			event.stopPropagation();
			if (event.key === "Escape" && !event.shiftKey && !event.metaKey && !event.altKey && !event.ctrlKey) {
				stopRecording();
				return;
			}
			const key = generateKeybindingString(event, isMac);
			if (!key) return;
			stopRecording();
			const invalid = validateShortcut(key);
			if (invalid) {
				setPrompt({ kind: "invalid", message: invalid });
				return;
			}
			const owner = findConflict({ keymap: draft, key, action: recording });
			if (owner) {
				setPrompt({ kind: "conflict", key, action: recording, owner });
				return;
			}
			assign(key, recording);
		};
		window.addEventListener("keydown", onKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
	}, [recording, draft, isMac]);

	// Never leave every hotkey (Space too) switched off if the window goes away mid-recording.
	useEffect(() => () => setIsRecording(false), [setIsRecording]);

	const close = () => {
		stopRecording();
		setPrompt(null);
		onOpenChange(false);
	};
	const requestClose = () => (isDirty ? setPrompt({ kind: "discard" }) : close());
	const save = () => {
		saveKeymap({ preset, keybindings: draft });
		close();
	};

	return (
		<Dialog open={isOpen} onOpenChange={(open) => (open ? onOpenChange(true) : requestClose())}>
			<DialogContent className="flex h-[min(42rem,88vh)] max-w-4xl flex-col gap-0 overflow-hidden p-0" data-testid="shortcuts-dialog">
				<div className="flex items-center justify-center border-b px-5 py-3">
					<DialogTitle className="text-sm font-semibold">Shortcuts</DialogTitle>
					<DialogDescription className="sr-only">Click a command, then press its new keys. Save keeps the changes.</DialogDescription>
				</div>

				<div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
					<div className="bg-muted flex rounded-md p-0.5" role="tablist" aria-label="Shortcut groups">
						{SHORTCUT_TABS.map(({ id, label }) => (
							<button
								key={id}
								type="button"
								role="tab"
								aria-selected={tab === id}
								data-testid={`shortcuts-tab-${id}`}
								onClick={() => setTab(id)}
								className={cn(
									"rounded px-4 py-1.5 text-xs font-medium transition-colors",
									tab === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
								)}
							>
								{label}
							</button>
						))}
					</div>
					<select
						aria-label="Shortcut preset"
						data-testid="shortcuts-preset"
						value={preset}
						onChange={(event) => {
							const next = event.target.value as KeymapPresetId;
							setPreset(next);
							setDraft(getPresetBindings({ preset: next }));
							setPrompt(null);
						}}
						className="bg-muted text-foreground h-8 rounded-md border px-2 text-xs"
					>
						{KEYMAP_PRESET_IDS.map((id) => (
							<option key={id} value={id}>
								{KEYMAP_PRESETS[id].label}
							</option>
						))}
					</select>
				</div>

				{prompt && (
					<div
						className="mx-5 mb-2 flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
						data-testid={`shortcuts-prompt-${prompt.kind}`}
						role="alertdialog"
						aria-live="polite"
					>
						<span>
							{prompt.kind === "conflict" ? (
								<>
									<b>{formatShortcut({ shortcut: prompt.key, isMac })}</b> {t("shortcut already belongs to “{owner}”. Override it?", { owner: describe(prompt.owner) })}
								</>
							) : prompt.kind === "invalid" ? (
								prompt.message
							) : (
								t("Your changes are not saved. Close without saving?")
							)}
						</span>
						<span className="flex shrink-0 gap-1">
							<Button size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={() => setPrompt(null)}>
								{prompt.kind === "discard" ? t("Keep editing") : prompt.kind === "invalid" ? t("OK") : t("Cancel")}
							</Button>
							{prompt.kind !== "invalid" && (
								<Button
									size="sm"
									className="h-6 px-2 text-xs"
									data-testid="shortcuts-prompt-confirm"
									onClick={() => {
										if (prompt.kind === "conflict") {
											assign(prompt.key, prompt.action);
											setPrompt(null);
										} else close();
									}}
								>
									{prompt.kind === "conflict" ? t("Override") : t("Discard")}
								</Button>
							)}
						</span>
					</div>
				)}

				<div className="scrollbar-thin mx-5 flex-1 overflow-y-auto rounded-md border bg-black/10 px-4 py-2" role="tabpanel">
					<div className="columns-1 gap-8 md:columns-2 md:[column-rule:1px_solid_var(--border)]">
						{actions.map((action) => (
							<ShortcutRow
								key={action}
								action={action}
								keys={keys.get(action) ?? []}
								isMac={isMac}
								isRecording={recording === action}
								onRecord={() => {
									setPrompt(null);
									setRecording(action);
									setIsRecording(true);
								}}
								onClear={() => setDraft((current) => clearInDraft({ keymap: current, action }))}
							/>
						))}
					</div>
					{tab === "other" && (
						<section className="mt-4 border-t pt-3" data-testid="shortcuts-contextual">
							<h3 className="text-muted-foreground mb-1 text-xs font-semibold">In panels and dialogs</h3>
							{CONTEXTUAL_KEYS.map(([label, contextKeys]) => (
								<div key={label} className="flex items-center justify-between py-1.5">
									<span className="text-sm">{label}</span>
									<span className="text-muted-foreground text-xs">{contextKeys.replace(/\bSpace\b/g, t("Space"))}</span>
								</div>
							))}
						</section>
					)}
				</div>

				<div className="flex items-center justify-between px-5 py-3">
					<Button
						variant="secondary"
						size="sm"
						data-testid="shortcuts-reset"
						onClick={() => {
							setDraft(getPresetBindings({ preset }));
							setPrompt(null);
						}}
					>
						Reset
					</Button>
					<span className="text-muted-foreground text-xs">{recording ? "Press the new shortcut · Esc to cancel" : ""}</span>
					<div className="flex gap-2">
						<Button size="sm" disabled={!isDirty} onClick={save} data-testid="shortcuts-save">
							Save
						</Button>
						<Button variant="secondary" size="sm" onClick={requestClose} data-testid="shortcuts-cancel">
							Cancel
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function ShortcutRow({
	action,
	keys,
	isMac,
	isRecording,
	onRecord,
	onClear,
}: {
	action: TActionWithOptionalArgs;
	keys: ShortcutKey[];
	isMac: boolean;
	isRecording: boolean;
	onRecord: () => void;
	onClear: () => void;
}) {
	return (
		<div className="group flex break-inside-avoid items-center justify-between gap-3 py-2.5" data-action={action}>
			<button type="button" onClick={onRecord} className="min-w-0 flex-1 cursor-pointer text-left text-sm" title="Click, then press the new keys">
				{describe(action)}
			</button>
			<div className="flex shrink-0 items-center gap-1">
				<button
					type="button"
					onClick={onRecord}
					className={cn("flex min-h-6 cursor-pointer items-center gap-2 rounded px-1 text-sm", isRecording && "ring-primary ring-1")}
					data-testid="shortcuts-keys"
				>
					{isRecording ? (
						<span className="text-primary px-1 text-xs">Press keys…</span>
					) : keys.length === 0 ? (
						<span className="text-muted-foreground px-1 text-xs"> </span>
					) : (
						keys.map((key, index) => (
							<span key={key} className="flex items-center gap-2">
								{index > 0 && <span className="text-muted-foreground text-xs">/</span>}
								{getShortcutParts({ shortcut: key, isMac }).map((part, partIndex) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
									<span key={partIndex} className="font-medium" data-no-translate>
										{part}
									</span>
								))}
							</span>
						))
					)}
				</button>
				<button
					type="button"
					aria-label="Remove shortcut"
					title="Remove shortcut"
					onClick={onClear}
					className={cn("text-muted-foreground hover:text-foreground invisible size-5 rounded text-xs", keys.length > 0 && "group-hover:visible")}
				>
					×
				</button>
			</div>
		</div>
	);
}
