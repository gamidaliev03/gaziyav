"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { useKeybindingsListener } from "@/actions/use-keybindings";
import { useKeybindingsStore } from "@/actions/keybindings-store";
import { useTimelineStore } from "@/timeline/timeline-store";
import { useEditorActions } from "@/actions/use-editor-actions";
import { loadFontAtlas } from "@/fonts/google-fonts";
import {
	initializeGpuRenderer,
	isGpuAvailable,
} from "@/services/renderer/gpu-renderer";
import { RecoveryDialog } from "@/reliability/recovery-dialog";
import { loadHardware } from "@/platform/hardware-client";
import { packMainTrack } from "@/timeline/placement/main-track";
import { mainHoles } from "@/timeline/gaps";
import { t } from "@/i18n";
import { TracksSnapshotCommand } from "@/commands/timeline/tracks-snapshot";
import { ProjectLoadError } from "@/reliability/project-load-error";
import { usePanelStore } from "@/editor/panel-store";
import { setStillShareReader, timelineStillShare } from "@/export/still-share";

/**
 * The magnet switched on over a main track with gaps: one step that closes them. ⌘Z gives the gaps back and switches
 * the magnet off with them (a magnet on over gaps is a state the editor never shows: fuzz 03.11), ⇧⌘Z both again.
 */
class MagnetOnCommand extends TracksSnapshotCommand {
	private magnet(on: boolean) {
		EditorCore.getInstance().command.isRippleEnabled = on;
		useTimelineStore.setState({ rippleEditingEnabled: on });
	}

	execute() {
		this.magnet(true);
		return super.execute();
	}

	undo() {
		super.undo();
		this.magnet(false);
	}
}

interface EditorProviderProps {
	projectId: string;
	children: React.ReactNode;
}

export function EditorProvider({ projectId, children }: EditorProviderProps) {
	// Only whether a project is open: the project object changes on every edit, and this is the editor's root.
	const hasActiveProject = useEditor(
		(e) => e.project.getActiveOrNull() !== null,
		["project"],
	);
	const router = useRouter();
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [retryCount, setRetryCount] = useState(0);
	const { setLoadingProject } = useKeybindingsStore();

	useEffect(() => {
		setLoadingProject(isLoading);
	}, [isLoading, setLoadingProject]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a retry loads the project again
	useEffect(() => {
		let cancelled = false;
		const editor = EditorCore.getInstance();

		const loadProject = async () => {
			try {
				setIsLoading(true);
				await initializeGpuRenderer();
				editor.renderer.setDegraded(!isGpuAvailable());
				await editor.project.loadProject({ id: projectId });

				if (cancelled) return;

				setIsLoading(false);
				loadFontAtlas();
			} catch (err) {
				if (cancelled) return;

				const isNotFound =
					err instanceof Error &&
					(err.message.includes("not found") ||
						err.message.includes("does not exist"));

				if (isNotFound) {
					try {
						const newProjectId = await editor.project.createNewProject({
							name: "Untitled Project",
						});
						router.replace(`/editor/${newProjectId}`);
					} catch (_createErr) {
						setError("Couldn't create a new project. Free up disk space and try again.");
						setIsLoading(false);
					}
				} else {
					const wasmPanic = (window as Window & { __wasmPanic?: string })
						.__wasmPanic;
					if (wasmPanic) {
						delete (window as Window & { __wasmPanic?: string }).__wasmPanic;
						setError(wasmPanic);
					} else {
						setError(
							err instanceof Error && err.message
								? err.message
								: "The project couldn't be opened.",
						);
					}
					setIsLoading(false);
				}
			}
		};

		loadProject();

		return () => {
			cancelled = true;
		};
	}, [projectId, router, retryCount]);

	if (error) {
		return (
			<ProjectLoadError
				projectId={projectId}
				details={error}
				onRetry={() => {
					setError(null);
					setRetryCount((count) => count + 1);
				}}
			/>
		);
	}

	if (isLoading) {
		return <ProjectStatusScreen label="Opening your project…" />;
	}

	if (!hasActiveProject) {
		return <ProjectStatusScreen label="Closing your project…" />;
	}

	return (
		<>
			<EditorRuntimeBindings />
			{children}
		</>
	);
}

function EditorRuntimeBindings() {
	const editor = useEditor();
	const rippleEditingEnabled = useTimelineStore(
		(state) => state.rippleEditingEnabled,
	);

	// The magnet switched on (CapCut): the main track closes up at once — its gaps go, one step ⌘Z takes back.
	const magnetWas = useRef<boolean | null>(null);
	useEffect(() => {
		editor.command.isRippleEnabled = rippleEditingEnabled;
		const was = magnetWas.current;
		magnetWas.current = rippleEditingEnabled;
		if (was !== false || !rippleEditingEnabled) return;
		const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
		const packed = tracks ? packMainTrack({ tracks }) : null;
		if (tracks && packed && packed !== tracks) {
			// one visible step (blind3 F5): one quiet line says how many gaps went; one ⌘Z brings them back
			const holes = mainHoles(tracks.main).length;
			// the step is made from the magnet off (it switches it on itself): ⌘Z gives the gaps back WITH the magnet off —
			// set on above, the history kept «on» as the state before and ⌘Z put a gap under the magnet (blind3 F5)
			editor.command.isRippleEnabled = false;
			editor.command.execute({ command: new MagnetOnCommand({ before: tracks, after: packed }) });
			if (holes > 0) toast(t("Gaps closed: {n}", { n: holes }), { id: "magnet", duration: 2000 });
		}
	}, [editor, rippleEditingEnabled]);
	// A ripple left items of locked tracks behind (blind3 rule 7): sync changed there, said in one line.
	useEffect(
		() =>
			editor.command.onLockedLeftBehind((count) => {
				toast(t("Locked tracks not moved: {n}", { n: count }), { id: "locked-left", duration: 2400 });
			}),
		[editor],
	);
	// ⌘Z / ⇧⌘Z bring the magnet of their state back with it (docs/TIMELINE.md O1): the button follows, and that state is
	// already what that magnet made — no packing, no step.
	useEffect(
		() =>
			editor.command.onMagnetRestored((on) => {
				magnetWas.current = on;
				useTimelineStore.setState({ rippleEditingEnabled: on });
			}),
		[editor],
	);

	// A project's shape picks its layout: a tall canvas opens in «Vertical» unless the owner picked a layout for this
	// project (editor/panel-store.ts autoLayout, final-A A3).
	const canvasVertical = useEditor((e) => {
		const size = e.project.getActiveOrNull()?.settings.canvasSize;
		return size ? size.height > size.width : null;
	});
	const layoutProjectId = useEditor((e) => e.project.getActiveOrNull()?.metadata.id ?? "");
	useEffect(() => {
		if (canvasVertical === null || !layoutProjectId) return;
		usePanelStore.getState().autoLayout({ projectId: layoutProjectId, vertical: canvasVertical });
	}, [layoutProjectId, canvasVertical]);

	// The Export window's size estimate reads how much of the timeline is still pictures (export/still-share.ts).
	useEffect(() => {
		setStillShareReader(() => timelineStillShare(editor.scenes.getActiveSceneOrNull()?.tracks));
		return () => setStillShareReader(null);
	}, [editor]);

	// This Mac (platform/hardware.ts): decoders, caches and the player's quality are sized for its tier.
	useEffect(() => {
		void loadHardware();
	}, []);

	// Linkage (`) and its settings: what follows main-track clips in every edit.
	const linkageEnabled = useTimelineStore((state) => state.linkageEnabled);
	const linkageKinds = useTimelineStore((state) => state.linkageKinds);
	useEffect(() => {
		editor.command.linkage = { enabled: linkageEnabled, kinds: linkageKinds };
	}, [editor, linkageEnabled, linkageKinds]);

	useEffect(() => {
		// Never lose edits on close/reload. A synchronous copy goes to the
		// recovery journal (offered on next open) and a real save is started.
		// Inside the Mac app the window close is handled by
		// window.__studioBeforeClose (saves, then closes) and "leave page?"
		// prompts are ignored, so only plain browsers get the native prompt.
		const isDesktopApp = "studioApp" in window;
		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			if (!editor.save.getIsDirty()) {
				// perf, 13.11: a moved view (zoom, scroll, playhead) waits for the next save; a reload takes it along (no
				// journal, no prompt: three numbers, never an edit)
				if (editor.save.hasViewPending()) void editor.save.flush();
				return;
			}
			editor.save.writeEmergencyJournal();
			void editor.save.flush();
			if (isDesktopApp) return;
			event.preventDefault();
			(event as unknown as { returnValue: string }).returnValue = "";
		};
		const handlePageHide = () => {
			editor.save.writeEmergencyJournal();
		};

		window.addEventListener("beforeunload", handleBeforeUnload);
		window.addEventListener("pagehide", handlePageHide);
		return () => {
			window.removeEventListener("beforeunload", handleBeforeUnload);
			window.removeEventListener("pagehide", handlePageHide);
		};
	}, [editor]);

	useEffect(
		() =>
			editor.command.onHistoryFailure(({ kind }) => {
				toast.error(
					kind === "undo" ? "Couldn't undo that step" : "Couldn't redo that step",
					{
						id: "history-failure",
						description:
							"The timeline was left as it was before. Your project is safe.",
					},
				);
			}),
		[editor],
	);

	useEditorActions();
	useKeybindingsListener();
	return <RecoveryDialog />;
}

/** The branded screen while a project opens or closes. */
function ProjectStatusScreen({ label }: { label: string }) {
	return (
		<div className="bg-background flex h-screen w-screen items-center justify-center" role="status" aria-live="polite">
			<div className="flex flex-col items-center gap-4">
				<Spinner className="text-muted-foreground size-6" />
				<div className="text-center">
					<p className="font-display text-foreground text-base font-semibold tracking-tight">Gaziyav</p>
					<p className="text-muted-foreground mt-1 text-sm">{label}</p>
				</div>
			</div>
		</div>
	);
}
