import type { TimelineElement } from "@/timeline";
import type { EditorCore } from "@/core";
import {
	buildEffectEntry,
	buildPasteClipboardCommand,
	copyClipboardEntry,
	type ClipboardEntry,
	type CopyContext,
	type PasteContext,
} from "@/clipboard";
import type { MediaTime } from "@/wasm";
import { BatchCommand } from "@/commands/batch-command";
import { AddScenesCommand, prepareCompositionPaste, rememberCompositionScenes } from "@/montage/compositions";

export class ClipboardManager {
	private entry: ClipboardEntry | null = null;
	private listeners = new Set<() => void>();

	constructor(private editor: EditorCore) {}

	getEntry(): ClipboardEntry | null {
		return this.entry;
	}

	hasEntry(): boolean {
		return this.entry !== null;
	}

	copy(): boolean {
		const entry = copyClipboardEntry({
			context: this.getCopyContext(),
		});
		if (!entry) {
			return false;
		}

		this.entry = entry;
		// AI compositions travel with their inner timelines, so a paste (here or in another project) is independent.
		rememberCompositionScenes(entry);
		this.notify();
		return true;
	}

	/** The ⧉ button of an effect in the Adjust tab: ⌘V then adds it (with its keys) to the selected clips. */
	copyEffect({ element, effectId }: { element: TimelineElement; effectId: string }): boolean {
		const entry = buildEffectEntry({ element, effectId });
		if (!entry) return false;
		this.entry = entry;
		this.notify();
		return true;
	}

	paste({ time, mode }: { time?: MediaTime; mode?: "insert" | "over" } = {}): boolean {
		if (!this.entry) {
			return false;
		}

		const prepared = prepareCompositionPaste(this.entry);
		const command = buildPasteClipboardCommand({
			entry: prepared.entry,
			context: { ...this.getPasteContext({ time }), mode },
		});
		if (!command) {
			return false;
		}

		this.editor.command.execute({ command: prepared.scenes.length ? new BatchCommand([new AddScenesCommand(prepared.scenes), command]) : command });
		return true;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private getCopyContext(): CopyContext {
		return {
			editor: this.editor,
			selectedElements: this.editor.selection.getSelectedElements(),
			selectedKeyframes: this.editor.selection.getSelectedKeyframes(),
		};
	}

	private getPasteContext({ time }: { time?: MediaTime }): PasteContext {
		return {
			editor: this.editor,
			selectedElements: this.editor.selection.getSelectedElements(),
			selectedKeyframes: this.editor.selection.getSelectedKeyframes(),
			time: time ?? this.editor.playback.getCurrentTime(),
		};
	}

	private notify(): void {
		this.listeners.forEach((listener) => {
			listener();
		});
	}
}
