"use client";

// Settings (⌘, · Gaziyav → Settings…) as in CapCut 9.5 (docs/capcut/settings/*.jpg): Draft · Edit · Performance ·
// General across the top, then AI (AI on this Mac · API keys · Connect Claude). As in CapCut, changes wait for Save and
// Cancel drops them; the cache bins act at once. CapCut's cloud rows (sync, spaces, downloads) are not here, and its
// Performance → «Rendering cache» neither: Draft → Cache size is the one place every cache is cleared from. The
// Shortcuts window is its own (⌘/ and the keyboard button), as in CapCut.
import { HelpCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { Delete02Icon, FolderOpenIcon } from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { create } from "zustand";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type AppPrefs, CACHE_LIMITS_GB, LOUDNESS_TARGETS, PROJECT_FRAME_RATES, useAppPrefs } from "./app-prefs";
import { PointMark } from "@/components/brand/point-mark";
import { type LangChoice, setLanguage, useLang, useT } from "@/i18n";
import { LanguageList } from "@/i18n/language-choice";
import { cn } from "@/utils/ui";
import { type SettingsSection, useSettingsStore } from "./settings-store";
import { AiSection } from "./ai-section";
import { ShareSettings } from "@/share/components/share-settings";
import { LibraryRow } from "@/ondevice/components/ondevice-dialogs";
import { THIS_COMPUTER } from "@/utils/platform";
import { type BuildCacheInfo, buildCacheInfo } from "@/export/build/cache-client";
import { buildExportOn } from "@/export/build/switch";
import { AppearanceSection } from "@/themes/appearance-section";

const FAMILY_SETTINGS: { CallSettings: () => null; WorkshopThemeRow: () => null } | null = null;

const SECTIONS: Array<{ id: SettingsSection; label: string }> = [
	{ id: "projects", label: "Draft" },
	{ id: "edit", label: "Edit" },
	{ id: "performance", label: "Performance" },
	{ id: "general", label: "General" },
	{ id: "appearance", label: "Themes" },
	{ id: "ai", label: "Services" },
	{ id: "share", label: "Share" },
	...(FAMILY_SETTINGS ? [{ id: "calls" as const, label: "Calls" }] : []),
];

type Draft = Partial<AppPrefs> & { language?: LangChoice; theme?: string };

/** What was changed in the window and not saved yet. */
const useDraft = create<{ draft: Draft; set: (patch: Draft) => void; clear: () => void }>((set) => ({
	draft: {},
	set: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
	clear: () => set({ draft: {} }),
}));

/** The saved settings with the window's unsaved changes on top; `setPrefs` changes the draft. */
function usePrefs() {
	const saved = useAppPrefs();
	const draft = useDraft((state) => state.draft);
	const { language: _language, theme: _theme, ...prefs } = draft;
	return { ...saved, ...prefs, setPrefs: (patch: Partial<AppPrefs>) => useDraft.getState().set(patch) };
}

const studio = () => (window as unknown as { studioApp?: { reveal?: (file: string) => void; setTheme?: (t: string) => void } }).studioApp;

export function SettingsDialog() {
	const t = useT();
	const open = useSettingsStore((s) => s.open);
	const section = useSettingsStore((s) => s.section);
	const { setOpen, setSection } = useSettingsStore.getState();
	const { setTheme } = useTheme();
	// On-device models, API keys and Claude are groups of one AI section now; old links to them land there.
	const aliased: SettingsSection = section === "ondevice" || section === "claude" || section === "pointagent" || section === "services" ? "ai" : section;
	const current = SECTIONS.some((s) => s.id === aliased) ? aliased : "projects";

	// Outside the Mac app (no menu bar) ⌘, opens Settings from the keyboard.
	useEffect(() => {
		if ((window as unknown as { studioApp?: unknown }).studioApp) return;
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === ",") {
				e.preventDefault();
				useSettingsStore.setState({ open: true });
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const close = () => {
		useDraft.getState().clear();
		setOpen(false);
	};
	const save = () => {
		const { language, theme, ...prefs } = useDraft.getState().draft;
		if (Object.keys(prefs).length > 0) useAppPrefs.getState().setPrefs(prefs);
		if (language) setLanguage(language);
		if (theme) {
			setTheme(theme);
			studio()?.setTheme?.(theme);
		}
		close();
	};

	return (
		<Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
			<DialogContent
				data-settings
				className="flex h-[min(44rem,90vh)] w-[min(42rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0"
			>
				<DialogTitle className="px-5 pt-4 pb-3 text-[15px]">{t("Settings")}</DialogTitle>
				<DialogDescription className="sr-only">Draft, editing, performance, general preferences and on-device AI</DialogDescription>
				<nav className="bg-foreground/[0.05] mx-5 flex shrink-0 gap-0.5 rounded-lg p-0.5" aria-label={t("Settings")} data-settings-tabs>
					{SECTIONS.map((s) => (
						<button
							key={s.id}
							type="button"
							data-settings-section={s.id}
							aria-current={current === s.id ? "page" : undefined}
							onClick={() => setSection(s.id)}
							className={cn(
								"h-8 min-w-0 flex-auto truncate rounded-md px-2 text-[13px] transition-colors",
								current === s.id ? "bg-background text-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
							)}
						>
							{t(s.label)}
						</button>
					))}
				</nav>
				<div className="scrollbar-thin mt-3 min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7" data-settings-body>
					{current === "projects" && <DraftSection />}
					{current === "edit" && <EditSection />}
					{current === "performance" && <PerformanceSection />}
					{current === "general" && <GeneralSection />}
					{current === "appearance" && <AppearanceSection />}
					{current === "ai" && <AiSection />}
					{current === "share" && <ShareSettings />}
					{current === "calls" && FAMILY_SETTINGS && <FAMILY_SETTINGS.CallSettings />}
				</div>
				<div className="flex shrink-0 gap-3 border-t px-5 py-3" data-settings-footer>
					<Button variant="outline" className="flex-1" onClick={close} data-settings-cancel>
						{t("Cancel")}
					</Button>
					<Button className="flex-1" onClick={save} data-settings-save>
						{t("Save")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

/** CapCut's (?) beside a setting: what it does, on hover. */
function Help({ children }: { children: string }) {
	return (
		<span className="text-muted-foreground inline-flex cursor-help" role="img" title={children} aria-label={children} data-settings-help>
			<HugeiconsIcon icon={HelpCircleIcon} className="size-3.5" />
		</span>
	);
}

/** One CapCut settings row: the name on the left, the control (and CapCut's grey line under it) on the right. */
function SettingRow({ label, children, note, help }: { label: string; children: ReactNode; note?: ReactNode; help?: string }) {
	const t = useT();
	return (
		// 13rem: CapCut's longest label («Step forward or back many», RU «Большой шаг вперёд или назад») on one line.
		<div className="grid grid-cols-[13rem_1fr] items-start gap-4 py-2.5" data-setting-row={label}>
			<span className="text-muted-foreground flex items-center gap-1 pt-1.5 text-sm">
				{t(label)}
				{help && <Help>{t(help)}</Help>}
			</span>
			<div className="flex min-w-0 flex-col gap-1.5">
				{children}
				{note && <p className="text-muted-foreground text-xs leading-snug">{note}</p>}
			</div>
		</div>
	);
}

/** A headed group of rows on its own card (S3: an object on the sheet), the way General and AI draw theirs: a tab never
 */
function Group({ title, id, children }: { title: string; id: string; children: ReactNode }) {
	const t = useT();
	return (
		<section className="flex flex-col gap-2.5" data-settings-group={id}>
			<h3 className="text-[13px] font-semibold">{t(title)}</h3>
			<div className="bg-foreground/[0.04] flex flex-col rounded-lg px-3 py-1">{children}</div>
		</section>
	);
}

function CheckRow({ id, checked, onChange, children, help }: { id: string; checked: boolean; onChange: (checked: boolean) => void; children: ReactNode; help?: string }) {
	return (
		<div className="flex items-start gap-2 pt-1">
			<Checkbox id={id} data-setting={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
			<Label htmlFor={id} className="text-sm leading-snug font-normal">
				{children}
			</Label>
			{help && <Help>{help}</Help>}
		</div>
	);
}


/** A path in CapCut's grey box, with the folder button (shows it in Finder). */
function PathBox({ path, onReveal }: { path?: string; onReveal?: () => void }) {
	return (
		<div className="flex items-center gap-2">
			<p className="bg-foreground/[0.05] min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 font-mono text-xs" title={path} data-settings-path>
				{path ?? "…"}
			</p>
			{onReveal && (
				<Button size="icon" variant="outline" className="size-7 shrink-0" onClick={onReveal} title="Show in Finder" aria-label="Show in Finder" data-settings-reveal>
					<HugeiconsIcon icon={FolderOpenIcon} className="size-3.5" />
				</Button>
			)}
		</div>
	);
}

/** A size and CapCut's bin beside it (clears at once). */
function SizeWithBin({ size, onClear, kind }: { size: string; onClear: () => void; kind: "cache" | "media" | "export" }) {
	return (
		<div className="flex items-center gap-2">
			<span className="text-muted-foreground text-sm tabular-nums" data-settings-size={kind}>
				{size}
			</span>
			<Button size="icon" variant="ghost" className="size-7" onClick={onClear} title="Clear" aria-label="Clear" data-settings-bin={kind}>
				<HugeiconsIcon icon={Delete02Icon} className="size-3.5" />
			</Button>
		</div>
	);
}

/**
 * A number field with CapCut's unit after it («10 frames», «5.0 s»). The text is the field's own while typing (it may be
 * empty or out of range for a moment); a number in range is taken at once, anything else goes back on leaving.
 */
function NumberField({ id, value, min, max, step, unit, onChange }: { id: string; value: number; min: number; max: number; step: number; unit: string; onChange: (value: number) => void }) {
	const t = useT();
	const [text, setText] = useState(String(value));
	useEffect(() => setText(String(value)), [value]);
	return (
		<div className="flex items-center gap-2">
			{/* A text field with a decimal keyboard: a number input dropped the «.» while typing «2.5» and kept «25» (check-flow A6, 06.11). */}
			<Input
				type="text"
				inputMode="decimal"
				size="sm"
				className="w-20 tabular-nums"
				value={text}
				min={min}
				max={max}
				step={step}
				data-setting={id}
				onChange={(event) => {
					const raw = event.target.value.replace(",", ".");
					if (!/^\d*\.?\d*$/.test(raw)) return;
					setText(raw);
					const next = Number(raw);
					if (raw.trim() !== "" && raw !== "." && Number.isFinite(next) && next >= min && next <= max) onChange(next);
				}}
				onBlur={() => setText(String(value))}
			/>
			<span className="text-sm">{t(unit)}</span>
		</div>
	);
}

function GeneralSection() {
	const t = useT();
	const { theme } = useTheme();
	const savedLang = useLang((s) => s.choice);
	const draft = useDraft((s) => s.draft);
	const prefs = usePrefs();
	const lang = draft.language ?? savedLang;
	const shownTheme = draft.theme ?? theme;
	const desktop = typeof window !== "undefined" && !!(window as unknown as { studioApp?: unknown }).studioApp;
	return (
		<div data-settings-general className="flex flex-col gap-6">
			<section className="flex flex-col gap-2.5" data-settings-language>
				<h3 className="text-[0.95rem] font-medium">{t("Language")}</h3>
				{/* every language in its own name (src/i18n/language-choice.tsx); applied with Save, like the rest */}
				<div className="bg-foreground/[0.04] rounded-lg p-1.5">
					<LanguageList value={lang} onChange={(value) => useDraft.getState().set({ language: value })} />
				</div>
			</section>
			<section className="flex flex-col gap-2.5" data-settings-notifications>
				<h3 className="text-[0.95rem] font-medium">{t("Notification")}</h3>
				<div className="bg-foreground/[0.04] rounded-lg px-3 py-2.5">
					<CheckRow id="notifications" checked={prefs.notifications} onChange={(on) => prefs.setPrefs({ notifications: on })} help={t("When an export finishes while Gaziyav is in the background.")}>
						{t("Allow Gaziyav to send you notifications")}
					</CheckRow>
				</div>
			</section>
			{desktop && (
				<section className="flex flex-col gap-2.5" data-settings-haptics>
					<h3 className="text-[0.95rem] font-medium">{t("Trackpad feedback")}</h3>
					<div className="bg-foreground/[0.04] rounded-lg px-3 py-2.5">
						<CheckRow id="trackpad-feedback" checked={prefs.trackpadFeedback} onChange={(on) => prefs.setPrefs({ trackpadFeedback: on })} help={t("Follows the Mac's own setting: System Settings → Trackpad → Force Click and haptic feedback.")}>
							{t("A light tap under the finger when a clip snaps, a guide aligns or a trim reaches its end")}
						</CheckRow>
					</div>
				</section>
			)}
			{FAMILY_SETTINGS && (
				<section className="flex flex-col gap-2.5">
					<h3 className="text-[0.95rem] font-medium">{t("Appearance")}</h3>
					<div className="bg-foreground/[0.05] flex w-fit items-center rounded-full p-1" role="radiogroup" aria-label={t("Appearance")}>
						{(["dark", "light", "system"] as const).map((mode) => (
							// biome-ignore lint/a11y/useSemanticElements: a pill switch (buttons, not radio inputs)
							<button
								key={mode}
								type="button"
								role="radio"
								aria-checked={shownTheme === mode}
								data-theme-choice={mode}
								onClick={() => useDraft.getState().set({ theme: mode })}
								className={cn(
									"h-8 rounded-full px-4 text-sm transition-colors",
									shownTheme === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
								)}
							>
								{t(mode)}
							</button>
						))}
					</div>
					<FAMILY_SETTINGS.WorkshopThemeRow />
				</section>
			)}
			<section className="flex flex-col gap-3">
				<h3 className="text-[0.95rem] font-medium">{t("About")}</h3>
				<div className="bg-foreground/[0.03] ring-foreground/[0.06] flex items-center gap-4 rounded-xl p-4 ring-1">
					<PointMark className="size-10" pointClassName="text-popover" />
					<div className="flex min-w-0 flex-col">
						<span className="font-display text-sm font-semibold tracking-[-0.03em]">
							Gaziyav <AppVersion />
						</span>
					</div>
				</div>
				<Credits />
			</section>
		</div>
	);
}

/** The installed version next to the name (product review 04.11 №19: About showed none). */
function AppVersion() {
	const [version, setVersion] = useState("");
	useEffect(() => {
		let alive = true;
		fetch("/api/version")
			.then((r) => (r.ok ? r.json() : null))
			.then((j) => {
				if (alive && j?.version) setVersion(String(j.version));
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, []);
	return version ? <span className="text-muted-foreground font-normal" data-app-version>{version}</span> : null;
}

/** Open-source licenses and the services Gaziyav can connect to (the only other place providers are named). */
function Credits() {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	return (
		<div ref={ref} className="flex flex-col gap-2">
			<button type="button" onClick={() => setOpen(!open)} className="text-muted-foreground hover:text-foreground w-fit text-sm underline-offset-4 hover:underline">
				{open ? "Hide credits and licenses" : "Credits and licenses"}
			</button>
			{open && (
				<div className="text-muted-foreground flex flex-col gap-3 text-xs leading-relaxed">
					<p>
						Built on OpenCut (MIT license, © OpenCut contributors). Fonts: Golos Text and Unbounded and the caption fonts (SIL Open Font
						License). Transitions: GL Transitions (MIT). Emoji: Fluent Emoji (MIT, Microsoft). Speech recognition: whisper.cpp (MIT). Media
						tools: FFmpeg (LGPL), yt-dlp (Unlicense). AI layers rendered with Remotion. On-device lipsync: MuseTalk (MIT). On-device voices:
						Qwen3-TTS (Apache 2.0). Face swap: HyperSwap
						(FaceFusion, ResearchRAIL) with ArcFace face recognition (InsightFace, non-commercial research license), GFPGAN 1.4 (Apache
						2.0) and the BiSeNet face parser (MIT). ML runtimes: MLX (MIT), PyTorch (BSD), ONNX Runtime (MIT).
						Settings → Services, its voices and the extra music and sounds: from OpenFilm (MIT license, © OpenFilm contributors; its
						sounds and music CC0 1.0).
					</p>
					<p>
						Gaziyav AI works in the cloud: what you ask it is sent there to be answered. Web images come from Wikimedia Commons, under its
						terms.
					</p>
				</div>
			)}
		</div>
	);
}

type StorageReport = { support: string; data: string; total: number };

/** CapCut's sizes: «630.67MB», «0B» — the unit in the window's language («630.67 МБ», the glossary's units). */
const SIZE_UNITS = { B: "{n}B", KB: "{n}KB", MB: "{n}MB", GB: "{n}GB" } as const;
const formatSize = (bytes: number, t: (text: string, values?: Record<string, string | number>) => string) => {
	const [n, unit] =
		bytes === 0
			? (["0", "B"] as const)
			: bytes < 1_000_000
				? ([(bytes / 1000).toFixed(2), "KB"] as const)
				: bytes < 1_000_000_000
					? ([(bytes / 1_000_000).toFixed(2), "MB"] as const)
					: ([(bytes / 1_000_000_000).toFixed(2), "GB"] as const);
	return t(SIZE_UNITS[unit], { n });
};

/** The cache sizes from the app (and clearing them). */
function useStorage() {
	const [report, setReport] = useState<StorageReport | null>(null);
	const refresh = useCallback(async (body?: { olderThanDays?: number; limitBytes?: number }) => {
		try {
			const response = await fetch("/api/settings/storage", {
				method: body ? "POST" : "GET",
				headers: { "x-studio": "1", ...(body ? { "content-type": "application/json" } : {}) },
				body: body ? JSON.stringify(body) : undefined,
			});
			setReport((await response.json()) as StorageReport);
		} catch {}
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	return { report, refresh };
}

/** The content cloud's cache: music, sounds, stickers and graphics downloaded on use (and clearing it). */
function useCloudCache() {
	const [info, setInfo] = useState<{ bytes: number; limit: number } | null>(null);
	const refresh = useCallback(async (clear?: boolean) => {
		try {
			if (clear) await fetch("/api/content/cache", { method: "DELETE", headers: { "x-studio": "1" } });
			const response = await fetch("/api/content/cache", { headers: { "x-studio": "1" } });
			setInfo((await response.json()) as { bytes: number; limit: number });
		} catch {}
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	return { info, refresh };
}

/** The stretches of exported films kept for the next export (export/build): their size, and clearing them. */
function useExportCache() {
	const [info, setInfo] = useState<BuildCacheInfo | null>(null);
	const refresh = useCallback(async (clear?: boolean) => {
		setInfo(await buildCacheInfo(clear ? {} : undefined));
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	return { info, refresh };
}

/** CapCut's Draft tab: where projects are kept, the cache and how long it stays, the user's own library folder. */
function DraftSection() {
	const t = useT();
	const prefs = usePrefs();
	const { report, refresh } = useStorage();
	const cloud = useCloudCache();
	const exported = useExportCache();
	const reveal = studio()?.reveal;
	return (
		<div data-settings-projects className="flex flex-col gap-6">
			<Group title="Folders" id="folders">
				<SettingRow label="Save to" help="Projects, their media and versions are kept in the app's folder on this Mac.">
					<PathBox path={report?.support} onReveal={reveal && report ? () => reveal(report.data) : undefined} />
				</SettingRow>
				{/* The user's own folder of music, sounds, graphics and fonts: where the app's media lives, not under AI. */}
				<LibraryRow />
			</Group>
			<Group title="Disk space" id="disk">
				<SettingRow label="Cache">
					<RadioGroup
						value={prefs.cacheDays == null ? "keep" : "auto"}
						onValueChange={(value) => prefs.setPrefs({ cacheDays: value === "keep" ? null : (prefs.cacheDays ?? 30) })}
						className="gap-2"
						aria-label={t("Cache")}
					>
						<div className="flex items-center gap-2">
							<RadioGroupItem value="keep" id="cache-keep" data-setting="cache-keep" />
							<Label htmlFor="cache-keep" className="text-sm font-normal">
								{t("Don't delete")}
							</Label>
						</div>
						<div className="flex items-center gap-2">
							<RadioGroupItem value="auto" id="cache-auto" data-setting="cache-auto" />
							<Label htmlFor="cache-auto" className="text-sm font-normal">
								{t("Auto delete cache from")}
							</Label>
							<Select value={String(prefs.cacheDays ?? 30)} onValueChange={(value) => prefs.setPrefs({ cacheDays: Number(value) })}>
								<SelectTrigger size="sm" className="w-20" aria-label={t("Days")} data-setting="cache-days">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{[7, 15, 30, 60, 90].map((days) => (
										<SelectItem key={days} value={String(days)}>
											{days}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<span className="text-sm">{t("days ago")}</span>
						</div>
					</RadioGroup>
				</SettingRow>
				<SettingRow label="Keep the cache under" help="When the cache passes this size, what was used longest ago is deleted to make room for the new.">
					<Select
						value={prefs.cacheLimitGb == null ? "none" : String(prefs.cacheLimitGb)}
						onValueChange={(value) => {
							const gb = value === "none" ? null : Number(value);
							prefs.setPrefs({ cacheLimitGb: gb });
							if (gb != null) void refresh({ limitBytes: gb * 1_000_000_000 });
						}}
					>
						<SelectTrigger size="sm" className="w-28" aria-label={t("Keep the cache under")} data-setting="cache-limit">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{CACHE_LIMITS_GB.map((gb) => (
								<SelectItem key={gb} value={String(gb)}>
									{t("{n} GB", { n: gb })}
								</SelectItem>
							))}
							<SelectItem value="none">{t("No limit")}</SelectItem>
						</SelectContent>
					</Select>
				</SettingRow>
				<SettingRow label="Cache size" help="AI layer and AI effect renders, speech transcripts, unsaved exports. They are made again when needed.">
					<SizeWithBin
						size={report ? formatSize(report.total, t) : "…"}
						kind="cache"
						onClear={async () => {
							await refresh({});
							toast.success(t("Cache cleared"));
						}}
					/>
				</SettingRow>
				<SettingRow label="Downloaded media" help="Music, sounds and graphics from the library, kept after their first use. When it is full, the oldest make room; they download again when needed.">
					<SizeWithBin
						size={cloud.info ? `${formatSize(cloud.info.bytes, t)} / ${formatSize(cloud.info.limit, t)}` : "…"}
						kind="media"
						onClear={async () => {
							await cloud.refresh(true);
							toast.success(t("Downloaded media cleared"));
						}}
					/>
				</SettingRow>
				{/* (only while exports are made as a build — export/build/switch.ts — or something of it is still kept) */}
				{(buildExportOn() || (exported.info?.bytes ?? 0) > 0) && (
					<SettingRow label="Export cache" help="Parts of films you exported, kept on this Mac: an interrupted export goes on from where it stopped, and after a small change only what changed is rendered again. When it is full, the parts used longest ago make room. Clearing it loses nothing: the next export renders everything once.">
						<SizeWithBin
							size={exported.info ? `${formatSize(exported.info.bytes, t)} / ${formatSize(exported.info.limit, t)}` : "…"}
							kind="export"
							onClear={async () => {
								await exported.refresh(true);
								toast.success(t("Export cache cleared"));
							}}
						/>
					</SettingRow>
				)}
			</Group>
		</div>
	);
}

/** CapCut's Edit tab, its rows in its order: the many-frames step, picture length, loudness, new projects' rate, the chime. */
function EditSection() {
	const t = useT();
	const prefs = usePrefs();
	return (
		<div data-settings-edit className="flex flex-col gap-6">
			<Group title="Timeline" id="timeline">
				<SettingRow label="Step forward or back many" help="The big step of the playhead (⇧← / ⇧→) and the big nudge of the selected clips.">
					<NumberField id="step-frames" value={prefs.stepFrames} min={1} max={100} step={1} unit="frames" onChange={(value) => prefs.setPrefs({ stepFrames: Math.round(value) })} />
				</SettingRow>
				<SettingRow label="Image duration" help="How long a picture lasts on the timeline when it is added.">
					<NumberField id="image-duration" value={prefs.imageSeconds} min={0.1} max={60} step={0.1} unit="s" onChange={(value) => prefs.setPrefs({ imageSeconds: Math.round(value * 10) / 10 })} />
				</SettingRow>
			</Group>
			<Group title="New projects" id="new-projects">
				<SettingRow label="Frame rate" help="New projects start with it (Project settings change it for one project).">
					<Select value={String(prefs.projectFps)} onValueChange={(value) => prefs.setPrefs({ projectFps: Number(value) })}>
						<SelectTrigger size="sm" className="w-40" data-setting="project-fps">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PROJECT_FRAME_RATES.map((fps) => (
								<SelectItem key={fps} value={String(fps)} data-setting-option={fps}>
									{fps}.00 fps
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingRow>
			</Group>
			<Group title="Sound" id="sound">
				<SettingRow label="Target loudness" help="Export → More options → Even loudness brings the sound to this level.">
					<Select value={String(prefs.targetLufs)} onValueChange={(value) => prefs.setPrefs({ targetLufs: Number(value) })}>
						<SelectTrigger size="sm" className="w-60" data-setting="target-loudness">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{LOUDNESS_TARGETS.map((target) => (
								<SelectItem key={target.value} value={String(target.value)} data-setting-option={target.value}>
									{t(target.label)}
								</SelectItem>
							))}
							{/* a target of one's own, set where the loudness meter is (sound/targets.ts) */}
							{!LOUDNESS_TARGETS.some((target) => target.value === prefs.targetLufs) && (
								<SelectItem value={String(prefs.targetLufs)} data-setting-option={prefs.targetLufs}>
									{t("Custom ({n} LUFS)", { n: String(prefs.targetLufs).replace("-", "−") })}
								</SelectItem>
							)}
						</SelectContent>
					</Select>
				</SettingRow>
				<SettingRow label="Sound for export">
					<CheckRow id="export-sound" checked={prefs.exportSound} onChange={(on) => prefs.setPrefs({ exportSound: on })}>
						{t("Send a notification sound when export is complete")}
					</CheckRow>
				</SettingRow>
			</Group>
		</div>
	);
}

/** CapCut's Performance tab: hardware encoding. (No proxy row: what a heavy or foreign format needs to play is made
 * on import by itself, media/processing.ts — perf round B, the owner: no «proxy / not proxy» to think about.) */
function PerformanceSection() {
	const t = useT();
	const prefs = usePrefs();
	return (
		<div data-settings-performance className="flex flex-col gap-6">
			<Group title="Export" id="export">
				<SettingRow label="Encode and decode">
					<CheckRow
						id="hardware-encoding"
						checked={prefs.hardwareEncoding}
						onChange={(on) => prefs.setPrefs({ hardwareEncoding: on })}
						help={t("Exports are encoded by the Mac's media engine (H.264, HEVC, ProRes). Off: by the processor — slower, for checking a problem file.")}
					>
						{t("Speed up hardware encoding")}
					</CheckRow>
				</SettingRow>
			</Group>
		</div>
	);
}
