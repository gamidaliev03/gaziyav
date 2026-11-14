"use client";

import { Button } from "../ui/button";
import { useEffect, useRef, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { TrashProjectDialog } from "@/project/components/trash-project-dialog";
import { useRouter } from "next/navigation";
import { ExportButton } from "./export-button";
import { AssembleMount } from "@/assemble/components/assemble";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import {
	ArrowDown01Icon,
	Home01Icon,
	Tick02Icon,
	CommandIcon,
	KeyboardIcon,
	LayoutTwoColumnIcon,
	Delete02Icon,
	Edit03Icon,
	Settings01Icon,
	SlidersHorizontalIcon,
	Clock01Icon,
	AiMagicIcon,
	FolderAddIcon,
} from "@hugeicons/core-free-icons";
import { invokeAction } from "@/actions";
import { EditorVersionsDialog } from "@/project/components/editor-versions-dialog";
import { HugeiconsIcon } from "@/components/ui/icon";
import { ShortcutsDialog } from "@/actions/components/shortcuts-dialog";
import { SettingsView } from "./panels/assets/views/settings";
import { JobsChip } from "@/jobs/components/jobs-chip";
import { useShellStore } from "./shell-store";
import { cn } from "@/utils/ui";
import { OndeviceDialogs } from "@/ondevice/components/ondevice-dialogs";
import { openSettings } from "@/settings/settings-store";
import { t, useT } from "@/i18n";
import { headerControls, stepControl } from "./header-keys";
import { type LayoutId, usePanelStore } from "@/editor/panel-store";
import { ShareButton } from "./share-button";
import { SectionSwitch } from "@/platform/desktop-sections";
import { ToolSearch, ToolSearchButton } from "./tool-search/tool-search";
import { AgentPill } from "@/agentview/components/agent-view";

// of each build (src/family/edition.ts): the owner's build carries neither module.

/** name (project menu) · the activity icon · search · Export. The bar also drags the window. */
export function EditorHeader() {
	const ref = useRef<HTMLElement>(null);
	// ←/→ between the header's buttons. A window capture listener runs before the editor's global hotkeys (a
	// document capture listener), which would otherwise step a frame.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const header = ref.current;
			const active = document.activeElement;
			if (!header || !(active instanceof HTMLElement) || !header.contains(active)) return;
			if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
			if (event.metaKey || event.ctrlKey || event.altKey || active.matches("input, textarea, [contenteditable]")) return;
			const next = stepControl(headerControls(header), active, event.key === "ArrowRight" ? 1 : -1);
			if (!next) return;
			event.preventDefault();
			event.stopPropagation();
			next.focus();
		};
		window.addEventListener("keydown", onKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
	}, []);
	return (
		<header
			ref={ref}
			// One of the editor's panels for Tab / ⇧Tab; landing on it focuses its first button.
			data-panel
			role="toolbar"
			aria-label={t("Project")}
			onFocus={(event) => {
				if (event.target !== event.currentTarget) return;
				const header = event.currentTarget;
				// After the panel switcher has drawn its outline on the header: the move then blurs it, which clears it.
				queueMicrotask(() => headerControls(header)[0]?.focus());
			}}
			className="studio-titlebar pc-header relative flex h-9 items-center justify-between gap-3 pr-3 pl-2"
		>
			{/*
			    saved), the project name centred, then one activity icon · search · Export (Share in its ▾). Undo and Redo
			    sit in the timeline's toolbar; home, Layout, Shortcuts and Assemble are in the project menu. */}
			<div className="flex min-w-0 items-center gap-3 pl-[73px]">
				<SectionSwitch />
				{/* (no room next to the centred project name in a small window) */}
				<span className="hidden min-[1100px]:contents">
					<SaveStatus />
					</span>
			</div>
			<div
				className={"absolute top-1/2 left-1/2 flex max-w-[32%] min-w-0 -translate-x-1/2 -translate-y-1/2 items-center"}
				data-project-title
			>
				<ProjectMenu />
			</div>
			<nav className="flex shrink-0 items-center gap-2">
				{/*
				    Assemble are in the project menu (and ⌘K, ⌘/); Claude shows in the activity icon. */}
				<JobsChip />
				<ToolSearchButton />
				<AgentPill />
				<AssembleMount />
				{/* Share folds into Export: its ▾ right of the button (the owner, 12.11) */}
				<span className="flex items-center gap-px">
					<ExportButton />
					<ShareButton />
				</span>
			</nav>
			<ProjectDialogs />
			<ToolSearch />
		</header>
	);
}

/** CapCut's «Auto saved: 22:51:57» right of the window buttons: when the project was last saved. */
function SaveStatus() {
	const t = useT();
	const editor = useEditor();
	const [saving, setSaving] = useState(false);
	const [savedAt, setSavedAt] = useState<Date | null>(() => editor.project.getActiveOrNull()?.metadata.updatedAt ?? null);
	// The save manager says when edits start waiting and when they are on disk (perfb: it polled every 300 ms before).
	useEffect(() => {
		let wasDirty = false;
		let timer = 0;
		const changed = () => {
			const dirty = editor.save.getIsDirty();
			window.clearTimeout(timer);
			if (dirty && !wasDirty) timer = window.setTimeout(() => setSaving(editor.save.getIsDirty()), 1500);
			if (!dirty) setSaving(false);
			if (!dirty && wasDirty) setSavedAt(new Date());
			wasDirty = dirty;
		};
		const unsubscribe = editor.save.subscribeDirty(changed);
		changed();
		return () => {
			unsubscribe();
			window.clearTimeout(timer);
		};
	}, [editor]);
	const time = savedAt ? new Date(savedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null;
	// only while edits wait to be saved for more than a moment (a failing save keeps it on). The time is in its tooltip.
	return (
		<span
			aria-live="polite"
			data-save-status={saving ? "saving" : "saved"}
			title={saving ? t("Saving…") : time ? t("Auto saved: {time}", { time }) : undefined}
			className="text-muted-foreground flex size-3 shrink-0 items-center justify-center"
		>
			{saving && <span className="bg-muted-foreground/70 size-1.5 rounded-full" aria-label={t("Saving…")} />}
		</span>
	);
}

function useExitProject() {
	const [isExiting, setIsExiting] = useState(false);
	const router = useRouter();
	const editor = useEditor();
	const exit = async () => {
		if (isExiting) return;
		setIsExiting(true);
		try {
			await editor.project.prepareExit();
		} catch (error) {
			console.error("Failed to prepare project exit:", error);
		} finally {
			editor.project.closeProject();
			router.push("/projects");
		}
	};
	return { exit, isExiting };
}

const SHORTCUT = "after:text-muted-foreground after:ml-auto after:pl-4 after:text-xs after:tracking-widest after:content-[attr(data-shortcut)]";

/** Project name; a click opens the project menu (rename, project settings, the app's Settings, shortcuts, delete). */
function ProjectMenu() {
	const t = useT();
	const editor = useEditor();
	const projectName = useEditor((e) => e.project.getActiveOrNull()?.metadata.name ?? "");
	const projectId = useEditor((e) => e.project.getActiveOrNull()?.metadata.id ?? "");
	const renaming = useShellStore((s) => s.renaming);
	const setRenaming = useShellStore((s) => s.setRenaming);
	const setDialog = useShellStore((s) => s.setDialog);
	const { exit, isExiting } = useExitProject();
	const [versionsOpen, setVersionsOpen] = useState(false);

	const openKeys = () => openSettings();
	// «Собрать проект»: the files this project uses from their places on the Mac are copied into it (media/originals.ts)
	const collect = async () => {
		if (!projectId) return;
		const n = editor.media.getInPlaceAssets().length;
		if (!n) {
			toast(t("Nothing to collect: every file is in the project already"));
			return;
		}
		const id = toast.loading(t("Collecting {n} file(s) into the project…", { n }));
		const { collected, failed } = await editor.media.collectIntoProject({ projectId }).catch(() => ({ collected: 0, failed: [t("the files")] }));
		toast.dismiss(id);
		if (failed.length) toast.error(t("Couldn't collect into the project: {names}", { names: failed.slice(0, 3).join(", ") }));
		else toast.success(t("Collected {n} file(s) into the project", { n: collected }));
	};

	if (renaming) {
		return (
			<ProjectNameInput
				name={projectName}
				onDone={async (next) => {
					setRenaming(false);
					if (!next || next === projectName || !projectId) return;
					try {
						await editor.project.renameProject({ id: projectId, name: next });
					} catch (error) {
						toast.error(t("Couldn't rename the project"), {
							description: error instanceof Error ? error.message : t("Please try again"),
						});
					}
				}}
			/>
		);
	}

	return (
		<>
		<EditorVersionsDialog open={versionsOpen} onOpenChange={setVersionsOpen} projectId={projectId} projectName={projectName} />
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="h-6 min-w-0 gap-1 px-1.5 text-[14px] font-semibold"
					onDoubleClick={() => setRenaming(true)}
					data-testid="project-menu"
				>
					<span className="truncate" data-no-translate>
						{projectName}
					</span>
					<HugeiconsIcon icon={ArrowDown01Icon} className="text-muted-foreground size-3" />
				</Button>
			</DropdownMenuTrigger>
			{/* This video first, then the app under its own label: «Project settings» right next to a bare «Settings…»
			    read as the same thing twice. Shortcuts are drawn by CSS, so an item's text stays just its name. */}
			<DropdownMenuContent align="start" className="z-100 w-60">
				<DropdownMenuItem onClick={exit} disabled={isExiting} icon={<HugeiconsIcon icon={Home01Icon} />} data-testid="back-to-projects" data-shortcut="⌥⌘Q" className={SHORTCUT}>
					{t("Back to home page")}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={() => setRenaming(true)} icon={<HugeiconsIcon icon={Edit03Icon} />}>
					{t("Rename")}
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={() => setDialog("settings")}
					icon={<HugeiconsIcon icon={SlidersHorizontalIcon} />}
					title={t("Name, frame rate, size and background of this video")}
				>
					{t("Project settings")}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => setVersionsOpen(true)} icon={<HugeiconsIcon icon={Clock01Icon} />} data-testid="project-versions">
					{t("Versions…")}
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={() => void collect()}
					icon={<HugeiconsIcon icon={FolderAddIcon} />}
					data-testid="collect-project"
					title={t("Copy into the project the files it uses from their places on this Mac: then it needs none of them")}
				>
					{t("Collect files into the project")}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => invokeAction("open-assemble")} icon={<HugeiconsIcon icon={AiMagicIcon} />} data-assemble-button>
					{t("Assemble")}
				</DropdownMenuItem>
				<LayoutSubmenu />
				<DropdownMenuSeparator />
				<DropdownMenuLabel className="px-2.5 pt-1">{t("App")}</DropdownMenuLabel>
				<DropdownMenuItem onClick={openKeys} icon={<HugeiconsIcon icon={Settings01Icon} />} data-shortcut="⌘," className={SHORTCUT}>
					{t("Settings…")}
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={() => setDialog("shortcuts")}
					icon={<HugeiconsIcon icon={CommandIcon} />}
					data-shortcut="⌘/"
					className={SHORTCUT}
				>
					{t("Keyboard shortcuts")}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					variant="destructive"
					onClick={() => setDialog("delete")}
					icon={<HugeiconsIcon icon={Delete02Icon} />}
				>
					{t("Move to Trash")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
		</>
	);
}

const LAYOUT_ITEMS: Array<{ id: LayoutId; label: string; hint: string }> = [
	{ id: "default", label: "Default", hint: "Media, player and details over the timeline" },
	{ id: "media", label: "Media", hint: "The media panel full height on the left" },
	{ id: "attributes", label: "Attributes", hint: "Details full height on the right" },
	{ id: "vertical", label: "Vertical", hint: "A tall player on the right, for vertical videos" },
];

/** Layout ▾ (CapCut 9.5): Default · Media · Attributes · Vertical with a tick on the current one, then «Reset current
 * layout». Each layout arranges the panels its own way (editor/panel-store.ts). */
/** Layout, a submenu of the project menu (it was its own header button until 12.11). */
function LayoutSubmenu() {
	const t = useT();
	const layout = usePanelStore((s) => s.layout);
	const applyLayout = usePanelStore((s) => s.applyLayout);
	const resetLayout = usePanelStore((s) => s.resetLayout);
	// A layout picked here is this project's own (panel-store autoLayout keeps it over the shape's layout).
	const layoutProjectId = useEditor((e) => e.project.getActiveOrNull()?.metadata.id ?? "");
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger data-layout-menu className="gap-2">
				<HugeiconsIcon icon={LayoutTwoColumnIcon} className="size-4" />
				{t("Layout")}
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="z-100 w-56">
				{LAYOUT_ITEMS.map((item) => (
					<DropdownMenuItem key={item.id} onClick={() => applyLayout(item.id, layoutProjectId || undefined)} data-layout={item.id} title={t(item.hint)} className="gap-2">
						<HugeiconsIcon icon={Tick02Icon} className={cn("text-primary size-4", layout !== item.id && "invisible")} />
						{t(item.label)}
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={resetLayout} data-layout-reset className="pl-8">
					{t("Reset current layout")}
				</DropdownMenuItem>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

function ProjectNameInput({ name, onDone }: { name: string; onDone: (name: string) => void }) {
	const ref = useRef<HTMLInputElement>(null);
	const finished = useRef(false);
	useEffect(() => {
		ref.current?.select();
	}, []);
	const done = (value: string) => {
		if (finished.current) return;
		finished.current = true;
		onDone(value.trim());
	};
	return (
		<input
			ref={ref}
			type="text"
			defaultValue={name}
			aria-label={t("Project name")}
			onBlur={(e) => done(e.currentTarget.value)}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					done(e.currentTarget.value);
				} else if (e.key === "Escape") {
					e.preventDefault();
					done(name);
				}
			}}
			style={{ fieldSizing: "content" }}
			className={cn("h-8 min-w-24 rounded-sm bg-transparent px-2 py-1 text-[0.9rem] outline-none ring-1 ring-ring")}
		/>
	);
}

function ProjectDialogs() {
	const dialog = useShellStore((s) => s.dialog);
	const setDialog = useShellStore((s) => s.setDialog);
	const editor = useEditor();
	const router = useRouter();
	// perf, 13.11: the name and whether a project is open, not the project object — it is a new one after every save,
	// and these closed dialogs re-rendered (~30 components) twice per edit.
	const hasProject = useEditor((e) => !!e.project.getActiveOrNull(), ["project"]);
	const projectName = useEditor((e) => e.project.getActiveOrNull()?.metadata.name ?? "", ["project"]);

	const handleDelete = async () => {
		const project = editor.project.getActiveOrNull();
		if (!project) return;
		try {
			// As in CapCut: the project goes to Trash (30 days), not away for good.
			await editor.project.trashProjects({ ids: [project.metadata.id] });
			router.push("/projects");
			toast(t("Project moved to Trash."));
		} catch (error) {
			toast.error(t("Couldn't move to Trash"), {
				description: error instanceof Error ? error.message : t("Please try again"),
			});
		} finally {
			setDialog(null);
		}
	};

	return (
		<>
			<Dialog open={dialog === "settings"} onOpenChange={(open) => setDialog(open ? "settings" : null)}>
				{/* Pinned at the top (not centred): its tabs are of different heights, and a centred dialog jumped 53 px on
				    every tab switch. The header and the tabs stay put; only the bottom edge follows the content. */}
				<DialogContent className="top-[12vh] flex max-h-[80vh] max-w-md translate-y-0 flex-col overflow-hidden p-0 [&>button:last-child]:top-3.5 [&>button:last-child]:right-3 [&_[data-settings-tabs]]:mr-9">
					<DialogTitle className="sr-only">Project settings</DialogTitle>
					{/* Sized to its content (no empty bottom); long tabs scroll inside. */}
					<div className="flex min-h-0 flex-col [&>div]:h-auto [&>div]:max-h-[80vh] [&>div]:min-h-0 [&>div>div:last-child]:min-h-0 [&>div>div:last-child]:flex-1 [&>div>div:last-child]:pb-3">
						{hasProject && <SettingsView />}
					</div>
				</DialogContent>
			</Dialog>
			<TrashProjectDialog
				isOpen={dialog === "delete"}
				onOpenChange={(open) => setDialog(open ? "delete" : null)}
				onConfirm={handleDelete}
				projectNames={[projectName || ""]}
			/>
			<ShortcutsDialog
				isOpen={dialog === "shortcuts"}
				onOpenChange={(open) => setDialog(open ? "shortcuts" : null)}
			/>
			<OndeviceDialogs />
		</>
	);
}

/** The keyboard icon of CapCut's top bar: opens the Shortcuts window (also ⌘/ and Help › Keyboard Shortcuts). */
function ShortcutsButton() {
	const t = useT();
	const setDialog = useShellStore((s) => s.setDialog);
	return (
		<Button
			variant="ghost"
			size="icon"
			className="text-foreground/85 hover:text-foreground size-6 rounded-[5px]"
			onClick={() => setDialog("shortcuts")}
			aria-label={t("Keyboard shortcuts")}
			title={t("Keyboard shortcuts (⌘/)")}
			data-testid="header-shortcuts"
		>
			<HugeiconsIcon icon={KeyboardIcon} className="size-[17px]" />
		</Button>
	);
}
