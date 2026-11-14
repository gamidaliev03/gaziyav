"use client";

import { installDragGhost } from "./drag-ghost";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { t } from "@/i18n";
import { useEditor } from "@/editor/use-editor";
import { isTypableDOMElement } from "@/utils/browser";
import { processMediaAssets } from "@/media/processing";
import { useStudioStore } from "@/studio/client/studio-store";
import { useAssetsPanelStore } from "./panels/assets/assets-panel-store";
import { useShellStore } from "./shell-store";
import { createProject, takePendingImport } from "@/app/projects/new-project";
import { placeFirstVideoIfEmpty, useImportedSelection } from "./panels/assets/views/auto-place";
import { splitKnownFiles } from "./panels/assets/views/known-files";
import { openSettings } from "@/settings/settings-store";
import { invokeAction } from "@/actions";
import { isKeyboardOverlayOpen } from "@/keyboard/navigation";

type MenuHandler = (command: string) => boolean;

interface StudioApp {
	setContext?: (context: string) => void;
}

/**
 * Registers what the Mac menu bar does on this page. The shell calls window.__studioMenu(name);
 * returning false lets it fall back to the native action (text-field undo, copy, …).
 */
export function useNativeMenu(context: "editor" | "projects", handler: MenuHandler) {
	const ref = useRef(handler);
	ref.current = handler;
	useEffect(() => {
		const w = window as unknown as Record<string, unknown> & { studioApp?: StudioApp };
		w.studioApp?.setContext?.(context);
		w.__studioMenu = (cmd: string) => ref.current(cmd);
		return () => {
			delete w.__studioMenu;
			w.studioApp?.setContext?.("projects");
		};
	}, [context]);
}

/** Lets the Mac menu (Edit → Undo/Redo, File → Import/Export, …) and window closing talk to the editor. */
export function NativeBridge() {
	// One clean drag picture for every panel tile (drag-ghost.ts).
	useEffect(() => installDragGhost(), []);
	const editor = useEditor();
	const router = useRouter();
	const fileInput = useRef<HTMLInputElement>(null);

	useNativeMenu("editor", (cmd) => {
		const el = document.activeElement;
		const typing = el instanceof HTMLElement && isTypableDOMElement({ element: el });
		switch (cmd) {
			// Not under a dialog or a menu either: ⌘Z with the shortcuts sheet open took a clip off the timeline behind it
			// (targeted test 05.11).
			case "undo":
				if (typing || isKeyboardOverlayOpen()) return false; // text fields use the native undo/clipboard
				editor.command.undo();
				return true;
			case "redo":
				if (typing || isKeyboardOverlayOpen()) return false;
				editor.command.redo();
				return true;
			// Edit → Copy / Cut / Select All act on the timeline's clips (as ⌘C ⌘X ⌘A do); the native ones only knew page
			// text, so Copy left the clipboard empty and Select All highlighted the page. Paste already arrives as a DOM
			// paste event the timeline takes. Not while typing, in a dialog or menu, or with page text selected: there the
			// native command is the right one (Cut in the shortcuts dialog removed a clip).
			case "copy":
			case "cut":
			case "selectAll": {
				const textSelected = !(window.getSelection()?.isCollapsed ?? true);
				if (typing || isKeyboardOverlayOpen() || textSelected) return false;
				invokeAction(cmd === "copy" ? "copy-selected" : cmd === "cut" ? "cut-selected" : "select-all");
				return true;
			}
			case "export":
				useShellStore.getState().setExportOpen(true);
				return true;
			case "shortcuts":
				useShellStore.getState().setDialog("shortcuts");
				return true;
			case "keys":
				openSettings();
				return true;
			case "import":
				useAssetsPanelStore.getState().setActiveTab("media");
				fileInput.current?.click();
				return true;
			case "youtube":
				useAssetsPanelStore.getState().setActiveTab("media");
				useStudioStore.getState().setYoutubeOpen(true);
				return true;
			case "new-project":
				void (async () => {
					await editor.save.flush();
					const id = await createProject(editor);
					router.push(`/editor/${id}`);
				})().catch((error) =>
					toast.error("Couldn't create a project", {
						description: error instanceof Error ? error.message : "Please try again",
					}),
				);
				return true;
			// ⌘W in the editor (main.js shows «Close Project» there, «Close Window» at Home)
			case "close-project":
				invokeAction("close-project");
				return true;
			case "projects":
				void (async () => {
					try {
						await editor.project.prepareExit();
					} finally {
						editor.project.closeProject();
						router.push("/projects");
					}
				})();
				return true;
			default:
				return false;
		}
	});

	useEffect(() => {
		const w = window as unknown as Record<string, unknown>;
		// Called before the window closes (main.js waits ≤ 2.5 s): copy pending edits to the recovery
		// journal synchronously, then save for real. If the save can't finish, the next open offers
		// "Restore unsaved changes?".
		w.__studioBeforeClose = async () => {
			// An untouched new project is not kept, even when the app is quit from it.
			if (await editor.project.discardIfEmpty().catch(() => false)) return true;
			if (editor.save.getIsDirty()) {
				try {
					editor.save.writeEmergencyJournal();
				} catch {}
				await editor.save.flush().catch(() => false);
			}
			// Quitting from here has no exit step: the home page's card still shows the timeline as it is now.
			await editor.project.refreshCard({ within: 1000 });
			// Nothing unsaved: close right away (quitting must never wait on a full re-save). The view (zoom, scroll,
			// playhead) moved since the last save rides with no save of its own (perf, 13.11): it is written now.
			if (!editor.save.getIsDirty() && !editor.save.hasViewPending()) return true;
			return editor.save.flush();
		};
		return () => {
			delete w.__studioBeforeClose;
		};
	}, [editor]);

	// Files dropped on the start page come in as soon as their new project is open.
	const activeProjectId = useEditor(
		(e) => (e.scenes.getActiveSceneOrNull() ? (e.project.getActiveOrNull()?.metadata.id ?? "") : ""),
		["project", "scenes"],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: importFiles reads the editor at call time
	useEffect(() => {
		if (!activeProjectId) return;
		const files = takePendingImport(activeProjectId);
		if (files.length) void importFiles(files);
	}, [activeProjectId]);

	const importFiles = async (picked: File[]) => {
		const project = editor.project.getActiveOrNull();
		if (!project || picked.length === 0) return;
		// A file already in Media is shown, not added a second time (as the Media panel's Import does): File → Import
		// of a file imported before (or after a restart) made a second tile of it.
		const { fresh: files, known } = splitKnownFiles({
			files: picked,
			assets: editor.media.getAssets(),
			originalSizeOf: (id) => editor.media.getEditingOriginal(id)?.file.size,
		});
		if (known.length > 0) {
			useAssetsPanelStore.getState().requestRevealMedia(known[0].assetId);
			toast(known.length === 1 ? t("{name} is already in Media", { name: known[0].file.name }) : t("{n} files are already in Media", { n: known.length }));
		}
		if (files.length === 0) return;
		const id = toast.loading(files.length === 1 ? t("Importing {name}", { name: files[0].name }) : t("Importing {n} files", { n: files.length }));
		try {
			const assets = await processMediaAssets({ files });
			const added = [];
			for (const asset of assets) {
				added.push(await editor.media.addMediaAsset({ projectId: project.metadata.id, asset: { ...asset, origin: "source" } }));
			}
			placeFirstVideoIfEmpty(editor, added);
			useImportedSelection.getState().set(added.flatMap((asset) => (asset ? [asset.id] : [])));
			// Nothing could be read: processMediaAssets already said why for each file, so no green "Added 0 files".
			if (assets.length === 0) toast.dismiss(id);
			else toast.success(assets.length === 1 ? t("Added {name}", { name: assets[0].name }) : t("Added {n} files", { n: assets.length }), { id });
		} catch (error) {
			toast.error(t("Couldn't import the files"), {
				id,
				description: error instanceof Error ? t(error.message) : t("The file may be damaged or in an unsupported format."),
			});
		}
	};

	return (
		<input
			ref={fileInput}
			type="file"
			accept="image/*,video/*,audio/*"
			multiple
			hidden
			onChange={(e) => {
				const files = Array.from(e.currentTarget.files ?? []);
				e.currentTarget.value = "";
				void importFiles(files);
			}}
		/>
	);
}
