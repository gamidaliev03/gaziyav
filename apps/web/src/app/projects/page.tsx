"use client";

// типа ИИ-субтитры … как в КапКате — это же просто монтажка»). No menu column, banner, tiles or tagline: the AI tools,
// Assemble and the library are in the editor (home-sections.tsx says where). Search · view · Trash · New project ▾.
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent } from "react";
import type { IconSvgElement } from "@/components/ui/icon";
import { useEffect, useMemo, useRef, useState } from "react";
import { smartFilter } from "@/search/smart";
import { toast } from "sonner";
import { MigrationDialog } from "@/project/components/migration-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditor } from "@/editor/use-editor";
import { useProjectsStore } from "./store";
import { createProject } from "./new-project";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { useNativeMenu } from "@/components/editor/native-bridge";
import type { TProjectMetadata, TProjectSortKey, TProjectSortOption } from "@/project/types";
import { formatTimecode, mediaTimeToSeconds } from "opencut-wasm";
import { formatDate } from "@/utils/date";
import { HugeiconsIcon } from "@/components/ui/icon";
import {
	ArrowDown01Icon,
	CloudIcon,
	Copy01Icon,
	DashboardSquare02Icon,
	Delete02Icon,
	Edit03Icon,
	GridViewIcon,
	Clock01Icon,
	InformationCircleIcon,
	LeftToRightListDashIcon,
	Message01Icon,
	MoreHorizontalIcon,
	Search01Icon,
	Settings01Icon,
	Share08Icon,
	UserAdd01Icon,
} from "@hugeicons/core-free-icons";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectInfoDialog } from "@/project/components/project-info-dialog";
import { RenameProjectDialog } from "@/project/components/rename-project-dialog";
import { RestoreVersionDialog } from "@/project/components/restore-version-dialog";
import { TrashProjectDialog } from "@/project/components/trash-project-dialog";
import { PointMark } from "@/components/brand/point-mark";
import { openSettings } from "@/settings/settings-store";
import { cn } from "@/utils/ui";
import { MEDIA_ACCEPT, NewProjectButton, type StartOptions, type StartProject } from "./home-sections";
import { TrashView } from "./trash-view";
import { McpBridge } from "@/mcp/bridge";
import { t, useT } from "@/i18n";
import { SectionSwitch } from "@/platform/desktop-sections";

const formatProjectDuration = (duration: number | undefined): string | null => {
	if (duration === undefined || duration <= 0) return null;
	const seconds = mediaTimeToSeconds({ time: duration });
	return formatTimecode({ time: duration, format: seconds >= 3600 ? "HH:MM:SS" : "MM:SS" }) ?? null;
};

/** "Edited 5 min ago", "Edited yesterday", "Edited Oct 12". */
function editedAgo(date: Date): string {
	const ms = Date.now() - new Date(date).getTime();
	const min = Math.round(ms / 60_000);
	if (min < 1) return t("Edited just now");
	if (min < 60) return t("Edited {n} min ago", { n: min });
	const hours = Math.round(min / 60);
	if (hours < 24) return t("Edited {n} h ago", { n: hours });
	if (hours < 48) return t("Edited yesterday");
	const days = Math.round(hours / 24);
	if (days < 7) return t("Edited {n} days ago", { n: days });
	return t("Edited {date}", { date: formatDate({ date: new Date(date) }) });
}

const SORT_LABELS: Record<TProjectSortKey, string> = {
	updatedAt: "Last modified",
	createdAt: "Date created",
	name: "Name",
	duration: "Duration",
};

const VIEW_MODE_OPTIONS = [
	{ mode: "grid" as const, icon: GridViewIcon, label: "Grid" },
	{ mode: "list" as const, icon: LeftToRightListDashIcon, label: "List" },
];

/** CapCut's toast after Move to Trash, with the way to it. */
function announceTrashed(count: number) {
	toast(count === 1 ? "Project moved to Trash." : "Projects moved to Trash.", {
		id: "moved-to-trash",
		action: { label: "See Trash", onClick: () => useProjectsStore.getState().setPage("trash") },
	});
}

/** The bundled sample video (public/samples/sample.json names it), for a first result in a minute. */
function useStartProject() {
	const editor = useEditor();
	const router = useRouter();
	const [starting, setStarting] = useState(false);
	const start = async (opts: StartOptions = {}) => {
		if (starting) return;
		setStarting(true);
		try {
			const id = await createProject(editor, { format: opts.format, files: opts.files });
			if (opts.tab && opts.section) useAssetsPanelStore.getState().openSection(opts.tab, opts.section);
			else if (opts.tab) useAssetsPanelStore.getState().setActiveTab(opts.tab);
			router.push(`/editor/${id}`);
		} catch (error) {
			setStarting(false);
			toast.error("Couldn't create a project", {
				description: error instanceof Error ? error.message : "Free up some disk space and try again.",
			});
		}
	};
	return { start, starting };
}

export default function ProjectsPage() {
	const { searchQuery, sortKey, sortOrder, viewMode, page } = useProjectsStore();
	const editor = useEditor();
	const sortOption: TProjectSortOption = `${sortKey}-${sortOrder}`;
	const { start, starting } = useStartProject();
	const [dragging, setDragging] = useState(false);
	const dragDepth = useRef(0);
	// ⌘N makes a new project here too, as in the editor (final check 04.11 №10).
	useEffect(() => {
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "n") return;
			const target = e.target as HTMLElement | null;
			if (target?.closest?.("input, textarea, [contenteditable=true]")) return;
			e.preventDefault();
			void start();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [start]);

	const isLoading = useEditor((e) => e.project.getIsLoading());
	const isInitialized = useEditor((e) => e.project.getIsInitialized());
	const sortedProjects = useEditor((e) => e.project.getFilteredAndSortedProjects({ searchQuery: "", sortOption }));
	const totalProjects = sortedProjects.length;
	// Smart search (typos, RU↔EN layout, translit): best match first.
	const projectsToDisplay = useMemo(
		() => smartFilter({ items: sortedProjects, query: searchQuery, fields: (project) => [project.name] }),
		[sortedProjects, searchQuery],
	);
	const ids = useMemo(() => projectsToDisplay.map((p) => p.id), [projectsToDisplay]);

	// File → New Project (⌘N) from the Mac menu.
	useNativeMenu("projects", (cmd) => {
		if (cmd === "keys") {
			openSettings();
			return true;
		}
		if (cmd !== "new-project") return false;
		void start();
		return true;
	});

	useEffect(() => {
		if (!editor.project.getIsInitialized()) editor.project.loadAllProjects();
		// Every visit: untouched empty projects go, missing pictures get filled.
		else void editor.project.repairThumbnails();
	}, [editor.project]);

	// Back from the editor, home opens on Projects again (as in CapCut), not on Trash.
	useEffect(() => () => useProjectsStore.getState().setPage("home"), []);

	// Drop video files anywhere on the page: a new project opens with them.
	const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
	const dropProps = {
		onDragEnter: (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			dragDepth.current += 1;
			setDragging(true);
		},
		onDragOver: (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = "copy";
		},
		onDragLeave: (e: DragEvent) => {
			if (!hasFiles(e)) return;
			dragDepth.current = Math.max(0, dragDepth.current - 1);
			if (dragDepth.current === 0) setDragging(false);
		},
		onDrop: (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			dragDepth.current = 0;
			setDragging(false);
			const files = Array.from(e.dataTransfer.files).filter((f) => /^(video|audio|image)\//.test(f.type) || /\.(mov|mp4|m4v|webm|mkv|mp3|wav|m4a|aac|png|jpe?g|heic|gif|webp)$/i.test(f.name));
			if (files.length) void start({ files });
			else toast.error("Those files can't go into a video", { description: "Drop video, audio or image files." });
		},
	};

	const ready = !isLoading && isInitialized;

	return (
		<div className="pc-canvas text-foreground relative flex h-screen overflow-hidden" {...dropProps}>
			<MigrationDialog />
			<McpBridge page="projects" />
			<div className="flex min-w-0 flex-1 flex-col">
				<TitleBar />
				<div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
					<div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-8 pt-1 pb-16 xl:px-10">
						{page === "trash" ? (
							<TrashView thumb={(project) => <ProjectThumb project={project} cover />} />
						) : (
							<>
								{/* The page is "Projects" (window title, VoiceOver, tests). */}
								<h1 className="sr-only">Projects</h1>
								<section aria-label="Your projects" className="flex flex-col gap-4">
									<ProjectsToolbar projectIds={ids} onStart={start} starting={starting} />
									{!ready ? (
										<ProjectsSkeleton />
									) : totalProjects === 0 ? (
										<FirstProject onStart={start} starting={starting} />
									) : projectsToDisplay.length === 0 ? (
										<NoResults />
									) : viewMode === "grid" ? (
										<div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-x-5 gap-y-6">
											{projectsToDisplay.map((project, index) => (
												<ProjectItem key={project.id} project={project} allProjectIds={ids} index={index} />
											))}
										</div>
									) : (
										<div className="bg-foreground/[0.03] ring-foreground/[0.06] flex flex-col overflow-hidden rounded-xl ring-1">
											{projectsToDisplay.map((project, index) => (
												<ProjectItem key={project.id} project={project} allProjectIds={ids} index={index} />
											))}
										</div>
									)}
								</section>
							</>
						)}
					</div>
				</div>
			</div>
			{dragging && (
				<div className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-3xl border-2 border-dashed border-primary/70 bg-background/70 backdrop-blur-md">
					<div className="flex flex-col items-center gap-3 text-center">
						<PointMark className="size-14" />
						<p className="font-display text-xl font-semibold tracking-[-0.03em]">New project</p>
					</div>
				</div>
			)}
		</div>
	);
}

/** Window title bar: settings on the right; the bar drags the window. */
function TitleBar() {
	return (
		<header className="studio-titlebar flex h-11 shrink-0 items-center justify-end gap-1 !pl-6 pr-5">
			<SectionSwitch className="mr-auto ml-[54px]" />
			<TitleBarButton label="Settings" icon={Settings01Icon} onClick={() => openSettings()} />
		</header>
	);
}

function TitleBarButton({ label, icon, onClick }: { label: string; icon: IconSvgElement; onClick: () => void }) {
	const button = (
		<Button variant="ghost" size="icon" aria-label={label} onClick={onClick} className="text-muted-foreground hover:text-foreground size-8 rounded-lg">
			<HugeiconsIcon icon={icon} className="size-[18px]" />
		</Button>
	);
	return (
		<Tooltip>
			<TooltipTrigger asChild>{button}</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

const TOOLBAR_BUTTON =
	"bg-foreground/[0.06] hover:bg-foreground/[0.1] text-foreground/90 focus-visible:ring-primary flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2";

/** CapCut's search icon in the Projects header: it opens a field; ⌘F focuses it, Esc clears and closes it. */
function ProjectSearch() {
	const { searchQuery, setSearchQuery } = useProjectsStore();
	const [open, setOpen] = useState(!!searchQuery);
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (open) input.current?.focus();
	}, [open]);
	useEffect(() => {
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "f") return;
			e.preventDefault();
			setOpen(true);
			input.current?.focus();
			input.current?.select();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	if (!open) {
		return (
			<button type="button" aria-label="Search projects" title="Search (⌘F)" onClick={() => setOpen(true)} className={TOOLBAR_BUTTON}>
				<HugeiconsIcon icon={Search01Icon} className="size-4" />
			</button>
		);
	}
	return (
		<label className="bg-foreground/[0.06] focus-within:ring-primary/60 flex h-7 w-52 items-center gap-1.5 rounded-md px-2 ring-1 ring-transparent">
			<HugeiconsIcon icon={Search01Icon} className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
			<input
				ref={input}
				type="search"
				placeholder="Search projects"
				aria-label="Search projects"
				value={searchQuery}
				onChange={(e) => setSearchQuery({ query: e.target.value })}
				onKeyDown={(e) => {
					if (e.key !== "Escape") return;
					setSearchQuery({ query: "" });
					setOpen(false);
				}}
				onBlur={() => !searchQuery && setOpen(false)}
				className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[13px] outline-none [&::-webkit-search-cancel-button]:hidden"
			/>
		</label>
	);
}

/** CapCut's Projects header: search · view ▾ · Trash · Project sync; while choosing, the actions for the chosen. */
function ProjectsToolbar({ projectIds, onStart, starting }: { projectIds: string[]; onStart: StartProject; starting: boolean }) {
	const t = useT();
	const { selectedProjectIds, setSelectedProjects, clearSelectedProjects, setPage } = useProjectsStore();
	const selected = selectedProjectIds.length;
	const allSelected = projectIds.length > 0 && selected === projectIds.length;

	return (
		<div className="flex min-h-8 flex-wrap items-center justify-between gap-3">
			{selected > 0 ? (
				<div className="flex min-w-0 items-center gap-3">
					<Checkbox
						className="size-[18px]"
						aria-label="Select all"
						checked={allSelected ? true : "indeterminate"}
						onCheckedChange={(c) => (c === true ? setSelectedProjects({ projectIds }) : clearSelectedProjects())}
					/>
					<span className="text-sm font-medium tabular-nums">{t("{n} selected", { n: selected })}</span>
					<ProjectActions />
					<Button variant="ghost" size="sm" className="text-muted-foreground h-7 rounded-md px-2.5" onClick={clearSelectedProjects}>
						Done
					</Button>
				</div>
			) : (
				// no «Projects» title: the window is the projects (the owner, 13.11)
				<span />
			)}
			<div className="flex items-center gap-2">
				<ProjectSearch />
				<ViewMenu />
				<button type="button" data-testid="open-trash" onClick={() => setPage("trash")} className={TOOLBAR_BUTTON}>
					<HugeiconsIcon icon={Delete02Icon} className="size-4" />
					Trash
				</button>
				<NewProjectButton onStart={onStart} starting={starting} />
			</div>
		</div>
	);
}

/** CapCut's view button ▾: Grid or List — and here the sort order too. */
function ViewMenu() {
	const { viewMode, isHydrated, setViewMode, sortKey, setSortKey, sortOrder, setSortOrder } = useProjectsStore();
	const shown = isHydrated ? viewMode : "grid";
	const current = VIEW_MODE_OPTIONS.find((option) => option.mode === shown) ?? VIEW_MODE_OPTIONS[0];
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button type="button" aria-label="View and sort" title="View and sort" className={TOOLBAR_BUTTON}>
					<HugeiconsIcon icon={current.icon} className="size-4" />
					<HugeiconsIcon icon={ArrowDown01Icon} className="size-3" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-48" align="end">
				{VIEW_MODE_OPTIONS.map(({ mode, icon, label }) => (
					<DropdownMenuCheckboxItem key={mode} checked={shown === mode} onCheckedChange={() => setViewMode({ viewMode: mode })}>
						<HugeiconsIcon icon={icon} />
						{label}
					</DropdownMenuCheckboxItem>
				))}
				<DropdownMenuSeparator />
				<DropdownMenuLabel>Sort by</DropdownMenuLabel>
				{(Object.keys(SORT_LABELS) as TProjectSortKey[]).map((key) => (
					<DropdownMenuCheckboxItem key={key} checked={sortKey === key} onCheckedChange={() => setSortKey({ sortKey: key })}>
						{SORT_LABELS[key]}
					</DropdownMenuCheckboxItem>
				))}
				<DropdownMenuSeparator />
				<DropdownMenuCheckboxItem checked={sortOrder === "asc"} onCheckedChange={(on) => setSortOrder({ sortOrder: on ? "asc" : "desc" })}>
					Reverse order
				</DropdownMenuCheckboxItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Duplicate / Move to Trash for the chosen projects. */
function ProjectActions() {
	const editor = useEditor();
	const { selectedProjectIds, clearSelectedProjects } = useProjectsStore();
	const [confirming, setConfirming] = useState(false);
	const names = editor.project
		.getSavedProjects()
		.filter((p) => selectedProjectIds.includes(p.id))
		.map((p) => p.name);
	return (
		<>
			<Button
				variant="ghost"
				size="sm"
				className="h-7 gap-1.5 rounded-md px-2.5"
				onClick={async () => {
					await editor.project.duplicateProjects({ ids: selectedProjectIds });
					clearSelectedProjects();
				}}
			>
				<HugeiconsIcon icon={Copy01Icon} className="size-4" />
				Duplicate
			</Button>
			<Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 h-7 gap-1.5 rounded-md px-2.5" onClick={() => setConfirming(true)}>
				<HugeiconsIcon icon={Delete02Icon} className="size-4" />
				Move to Trash
			</Button>
			<TrashProjectDialog
				isOpen={confirming}
				onOpenChange={setConfirming}
				projectNames={names}
				onConfirm={async () => {
					setConfirming(false);
					await editor.project.trashProjects({ ids: selectedProjectIds });
					clearSelectedProjects();
					announceTrashed(selectedProjectIds.length);
				}}
			/>
		</>
	);
}

/** Old projects may carry a black first frame as their picture: those show the placeholder until reopened. */
function useBlackThumbnail(src: string | undefined): boolean {
	const [black, setBlack] = useState(false);
	useEffect(() => {
		setBlack(false);
		if (!src) return;
		const img = new window.Image();
		img.onload = () => {
			const c = document.createElement("canvas");
			c.width = 16;
			c.height = 16;
			const ctx = c.getContext("2d", { willReadFrequently: true });
			if (!ctx) return;
			ctx.drawImage(img, 0, 0, 16, 16);
			const d = ctx.getImageData(0, 0, 16, 16).data;
			let lit = 0;
			for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60 && d[i + 3] > 0) lit++;
			setBlack(lit < 16 * 16 * 0.04);
		};
		img.src = src;
	}, [src]);
	return black;
}

function ProjectThumb({ project, className, cover }: { project: TProjectMetadata; className?: string; cover?: boolean }) {
	const black = useBlackThumbnail(project.thumbnail);
	if (!project.thumbnail || black) {
		return (
			<div className={cn("flex size-full items-center justify-center bg-[radial-gradient(120%_80%_at_50%_0%,rgb(232_163_61/0.18),transparent_70%)]", className)}>
				<PointMark className="size-1/3 max-w-16 opacity-40 grayscale-[30%]" pointClassName="text-card" />
			</div>
		);
	}
	// CapCut's square cards show the frame cropped to fill.
	if (cover) return <Image src={project.thumbnail} alt="" fill sizes="320px" className={cn("object-cover", className)} />;
	return (
		<>
			{/* The same frame, blurred, fills the letterbox: every card reads as one picture. */}
			<div aria-hidden="true" className="absolute inset-0 scale-125 bg-cover bg-center opacity-60 blur-2xl" style={{ backgroundImage: `url("${project.thumbnail}")` }} />
			<Image src={project.thumbnail} alt="" fill sizes="320px" className={cn("object-contain", className)} />
		</>
	);
}

function ProjectItem({ project, allProjectIds, index }: { project: TProjectMetadata; allProjectIds: string[]; index: number }) {
	const { selectedProjectIds, viewMode, setProjectSelected, selectProjectRange } = useProjectsStore();
	const t = useT();
	const isSelected = selectedProjectIds.includes(project.id);
	const selecting = selectedProjectIds.length > 0;
	const [menuOpen, setMenuOpen] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [trashing, setTrashing] = useState(false);
	const [info, setInfo] = useState(false);
	const [versions, setVersions] = useState(false);
	const editor = useEditor();
	const router = useRouter();
	const duration = formatProjectDuration(project.duration);
	const href = `/editor/${project.id}`;

	const actions = {
		open: () => router.push(href),
		rename: () => setRenaming(true),
		duplicate: () => void editor.project.duplicateProjects({ ids: [project.id] }),
		trash: () => setTrashing(true),
		info: () => setInfo(true),
		versions: () => setVersions(true),
	};
	const meta = [duration, editedAgo(project.updatedAt)].filter(Boolean).join(" · ");

	const toggleSelected = (shiftKey: boolean) => {
		if (shiftKey && !isSelected) selectProjectRange({ projectId: project.id, allProjectIds });
		else setProjectSelected({ projectId: project.id, isSelected: !isSelected });
	};
	// While selecting, a click on a card selects it instead of opening it.
	const onCardClick = (e: MouseEvent) => {
		if (!selecting && !e.metaKey && !e.shiftKey) return;
		e.preventDefault();
		toggleSelected(e.shiftKey);
	};

	const checkbox = (
		<Checkbox
			checked={isSelected}
			aria-label={`Select ${project.name}`}
			onMouseDown={(e) => e.preventDefault()}
			onClick={(e) => {
				e.stopPropagation();
				toggleSelected(e.shiftKey);
			}}
			onCheckedChange={() => {}}
			className={cn(
				"bg-background/70 size-5 shrink-0 backdrop-blur transition-opacity",
				viewMode === "grid" && "absolute top-2 left-2 z-10",
				viewMode === "grid" && !isSelected && !selecting && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
			)}
		/>
	);

	const body =
		viewMode === "grid" ? (
			// pc-appear: opacity only — a tile that slid up while previews loaded took clicks meant for its neighbour (R5)
			<div className="group pc-appear relative" style={{ "--pc-delay": `${Math.min(index, 14) * 35}ms` } as CSSProperties}>
				<Link href={href} onClick={onCardClick} className="focus-visible:ring-primary block rounded-lg outline-none focus-visible:ring-2" data-project-card>
					<div
						className={cn(
							"relative aspect-square overflow-hidden rounded-lg bg-black ring-1 transition-shadow",
							isSelected ? "ring-primary ring-2" : "ring-foreground/[0.06] group-hover:ring-foreground/30",
						)}
					>
						<ProjectThumb project={project} cover className="transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.03]" />
					</div>
					<div className="px-0.5 pt-2">
						<h3 className="truncate text-[13px] leading-snug font-medium" title={project.name} data-no-translate>
							{project.name}
						</h3>
						{/* one line reserved: the length arrives after the card (R5) */}
						<p className="text-muted-foreground mt-0.5 h-4 truncate text-[11px] leading-4">{meta}</p>
					</div>
				</Link>
				{checkbox}
				{!selecting && (
					<div
						className={cn(
							"absolute top-2 right-2 z-10 transition-opacity duration-200",
							menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
						)}
					>
						<ProjectMenu open={menuOpen} onOpenChange={setMenuOpen} actions={actions} overlay />
					</div>
				)}
			</div>
		) : (
			<div
				className={cn(
					"group border-foreground/[0.06] hover:bg-foreground/[0.03] flex items-center gap-4 border-b px-4 py-2.5 transition-colors last:border-b-0",
					isSelected && "bg-primary/[0.07]",
				)}
			>
				{checkbox}
				<Link href={href} onClick={onCardClick} className="flex min-w-0 flex-1 items-center gap-3.5 outline-none" data-project-card>
					<div className="bg-card relative h-12 w-9 shrink-0 overflow-hidden rounded-lg ring-1 ring-foreground/[0.08]">
						<ProjectThumb project={project} />
					</div>
					<h3 className="min-w-0 flex-1 truncate text-sm font-medium" title={project.name}>
						{project.name}
					</h3>
					<span className="text-muted-foreground hidden w-16 shrink-0 text-right text-sm tabular-nums sm:block">{duration ?? "—"}</span>
					<span className="text-muted-foreground hidden w-40 shrink-0 text-right text-sm md:block">{editedAgo(project.updatedAt)}</span>
				</Link>
				{!selecting && <ProjectMenu open={menuOpen} onOpenChange={setMenuOpen} actions={actions} />}
			</div>
		);

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>{body}</ContextMenuTrigger>
				{/* Closing the menu doesn't hand the focus back to the card: the Rename / Trash window it opens keeps it. */}
				<ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
					<ContextMenuItem onClick={actions.open}>Open</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem icon={<HugeiconsIcon icon={Edit03Icon} />} onClick={actions.rename}>
						Rename
					</ContextMenuItem>
					<ContextMenuItem icon={<HugeiconsIcon icon={Copy01Icon} />} onClick={actions.duplicate}>
						Duplicate
					</ContextMenuItem>
					<ContextMenuItem icon={<HugeiconsIcon icon={InformationCircleIcon} />} onClick={actions.info}>
						Details
					</ContextMenuItem>
					<ContextMenuItem icon={<HugeiconsIcon icon={Clock01Icon} />} onClick={actions.versions}>
						Restore previous version
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem variant="destructive" icon={<HugeiconsIcon icon={Delete02Icon} />} onClick={actions.trash}>
						Move to Trash
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<RenameProjectDialog
				isOpen={renaming}
				onOpenChange={setRenaming}
				projectName={project.name}
				onConfirm={async (name) => {
					await editor.project.renameProject({ id: project.id, name });
					setRenaming(false);
				}}
			/>
			<TrashProjectDialog
				isOpen={trashing}
				onOpenChange={setTrashing}
				projectNames={[project.name]}
				onConfirm={async () => {
					setTrashing(false);
					await editor.project.trashProjects({ ids: [project.id] });
					announceTrashed(1);
				}}
			/>
			<ProjectInfoDialog isOpen={info} onOpenChange={setInfo} project={project} />
			<RestoreVersionDialog isOpen={versions} onOpenChange={setVersions} projectId={project.id} projectName={project.name} />
		</>
	);
}

function ProjectMenu({
	open,
	onOpenChange,
	actions,
	overlay,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	actions: Record<"open" | "rename" | "duplicate" | "trash" | "info" | "versions", () => void>;
	/** On the card's picture: a dark round button that reads on any frame. */
	overlay?: boolean;
}) {
	const stop = (e: MouseEvent | KeyboardEvent) => {
		if ("key" in e && e.key !== "Enter" && e.key !== " ") return;
		e.preventDefault();
		e.stopPropagation();
	};
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label="Project menu"
					title="More actions"
					onClick={stop}
					onKeyDown={stop}
					onMouseDown={(e) => e.stopPropagation()}
					className={cn(
						"flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
						overlay ? "bg-black/55 text-white backdrop-blur-md hover:bg-black/75" : "hover:bg-foreground/10 text-muted-foreground hover:text-foreground",
					)}
				>
					<HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" aria-hidden="true" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-44" align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
				<DropdownMenuItem onClick={actions.open}>Open</DropdownMenuItem>
				<DropdownMenuItem onClick={actions.rename}>
					<HugeiconsIcon icon={Edit03Icon} />
					Rename
				</DropdownMenuItem>
				<DropdownMenuItem onClick={actions.duplicate}>
					<HugeiconsIcon icon={Copy01Icon} />
					Duplicate
				</DropdownMenuItem>
				<DropdownMenuItem onClick={actions.info}>
					<HugeiconsIcon icon={InformationCircleIcon} />
					Details
				</DropdownMenuItem>
				<DropdownMenuItem onClick={actions.versions}>
					<HugeiconsIcon icon={Clock01Icon} />
					Restore previous version
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem variant="destructive" onClick={actions.trash}>
					<HugeiconsIcon icon={Delete02Icon} />
					Move to Trash
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ProjectsSkeleton() {
	return (
		<output className="flex flex-col gap-5" aria-busy="true" aria-label="Loading projects">
			{/* the real grid's geometry (columns, gaps, the square and the two caption lines): the tiles land where these stood (R5) */}
			<div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-x-5 gap-y-6">
				{Array.from({ length: 8 }, (_, i) => `s${i}`).map((id) => (
					<div key={id}>
						<Skeleton className="bg-foreground/[0.06] aspect-square rounded-lg" />
						<div className="px-0.5 pt-2">
							<Skeleton className="bg-foreground/[0.06] my-1 h-3 w-3/4 rounded-full" />
							<Skeleton className="bg-foreground/[0.06] mt-1.5 h-2.5 w-1/3 rounded-full" />
						</div>
					</div>
				))}
			</div>
		</output>
	);
}

/** First launch: one inviting place to drop a video. */
function FirstProject({ onStart, starting }: { onStart: StartProject; starting: boolean }) {
	const fileInput = useRef<HTMLInputElement>(null);
	// one quiet place (the owner, 12–13.11): a click chooses files, a drop anywhere on the page works too
	return (
		<>
			<button
				type="button"
				disabled={starting}
				onClick={() => fileInput.current?.click()}
				data-home-first
				className="pc-rise border-foreground/15 bg-foreground/[0.02] hover:bg-foreground/[0.04] relative flex flex-col items-center gap-3 rounded-xl border border-dashed px-8 py-16 text-center transition-colors"
				style={{ "--pc-delay": "160ms" } as CSSProperties}
			>
				<PointMark className="size-12" />
				<span className="text-muted-foreground text-xs" data-empty-line>
					Drop a video or click
				</span>
			</button>
			<input
				ref={fileInput}
				type="file"
				hidden
				multiple
				accept={MEDIA_ACCEPT}
				onChange={(e) => {
					const files = Array.from(e.currentTarget.files ?? []);
					e.currentTarget.value = "";
					if (files.length) onStart({ files });
				}}
			/>
		</>
	);
}

function NoResults() {
	const t = useT();
	const { searchQuery, setSearchQuery } = useProjectsStore();
	return (
		<div className="flex flex-col items-center gap-4 py-16 text-center">
			<div className="bg-foreground/[0.05] flex size-14 items-center justify-center rounded-2xl">
				<HugeiconsIcon icon={Search01Icon} className="text-muted-foreground size-6" />
			</div>
			<div className="flex flex-col gap-1.5">
				<h3 className="text-base font-medium">{t("Nothing matches “{q}”", { q: searchQuery })}</h3>
			</div>
			<Button variant="outline" onClick={() => setSearchQuery({ query: "" })}>
				Clear search
			</Button>
		</div>
	);
}
