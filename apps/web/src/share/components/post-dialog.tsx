"use client";

// Share → Post: YouTube Shorts, Instagram Reels and TikTok at once or one by one, one description and one hashtag
// line, Post now or Schedule, and the list of posts (progress, link, Retry, Cancel). The ticked accounts get the video
// through Late's API — no window, nothing to press on a site. Without a Late key the sheet's one step is pasting it
// (checked with Late, then the accounts appear in place): no site window to post through any more (docs/SHARE.md).
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import { cn } from "@/utils/ui";
import { captionFor, isVertical, LIMITS, parseHashtags, PLATFORM_LABEL, type Platform, type PostText, textIssues } from "../caption";
import { canUseLate, connectLate, mainVideoIds, needsLateKey, PostCancelled, shareApi, startPost, type TikTokOptions, tiktokOptions, timelineSeconds, usePostDraft, useShare, watchShare, writeWithAgent } from "../client";
import { openSettings } from "@/settings/settings-store";
import { KEY_REFUSED, LATE_KEYS_URL, LATE_PLATFORMS, type LateAccount, type TikTokChoice } from "../late";
import type { Post } from "../types";
import { Avatar, LateKeyForm } from "./share-settings";

const NO_TIKTOK: TikTokChoice = {
	privacyLevel: "",
	allowComment: false,
	allowDuet: false,
	allowStitch: false,
};

const EMPTY: PostText = { title: "", description: "", hashtags: "" };

/** «2026-11-04T09:30» for a datetime-local field, in this Mac's time zone. */
function localValue(ms: number): string {
	const d = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const inAnHour = () => Math.ceil((Date.now() + 3600_000) / 300_000) * 300_000;
const when = (ms: number) =>
	new Date(ms).toLocaleString(undefined, {
		weekday: "short",
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});

export function PostDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{open && <PostSheet close={() => onOpenChange(false)} />}
		</Dialog>
	);
}

function PostSheet({ close }: { close: () => void }) {
	const t = useT();
	const editor = useEditor();
	const project = editor.project.getActive();
	const projectId = project.metadata.id;
	const canvas = useEditor(
		(e) =>
			e.project.getActiveOrNull()?.settings.canvasSize ?? {
				width: 1080,
				height: 1920,
			},
	);
	const seconds = useEditor((e) => timelineSeconds(e));
	const share = useShare((s) => s.state);
	const draft = usePostDraft();
	const [text, setTextState] = useState<PostText>(() => draft.texts[projectId] ?? { ...EMPTY, title: project.metadata.name });
	const [privacy, setPrivacy] = useState<"public" | "unlisted" | "private">("public");
	const [mode, setMode] = useState<"now" | "schedule">("now");
	const [at, setAt] = useState(inAnHour);
	// Not 9:16: the posted file is made vertical (the existing reframe, outside ⌘Z) when Post is pressed, unless unticked.
	const [makeVertical, setMakeVertical] = useState(true);
	const [busy, setBusy] = useState<null | Platform | "post" | "write">(null);
	const [progress, setProgress] = useState<{
		value: number;
		stage: string;
	} | null>(null);
	const [needsAi, setNeedsAi] = useState(false);
	/** Cancel while the post is made vertical / exported / handed over. */
	const run = useRef<AbortController | null>(null);
	const [cancelling, setCancelling] = useState(false);
	// While Post makes the posted file vertical the project is 9:16 for a moment: the sheet keeps showing its own size.
	const [postCanvas, setPostCanvas] = useState<typeof canvas | null>(null);
	const shownCanvas = postCanvas ?? canvas;

	useEffect(() => {
		const stop = watchShare(true);
		// Late's accounts asked again, not the server's minute of cache: an expired sign-in shows Reconnect at once.
		void useShare.getState().refresh(true);
		return stop;
	}, []);

	const setText = (patch: Partial<PostText>) =>
		setTextState((prev) => {
			const next = { ...prev, ...patch };
			usePostDraft.getState().setText(projectId, next);
			return next;
		});

	// The ticked Late accounts (every connected one until the person chooses). No key yet (or Late refused it): the key step.
	const keyStep = !!share && needsLateKey(share);
	const lateOn = !!share && !keyStep;
	const lateAccounts = lateOn ? (share?.late?.accounts ?? []) : [];
	const [picked, setPicked] = useState<string[] | null>(() => draft.accounts);
	const pickedIds = picked ?? lateAccounts.map((a) => a.id);
	const lateTargets = lateAccounts.filter((a) => !a.reconnect && pickedIds.includes(a.id));
	const pick = (id: string, on: boolean) => {
		const next = on ? [...new Set([...pickedIds, id])] : pickedIds.filter((x) => x !== id);
		setPicked(next);
		usePostDraft.getState().setAccounts(next);
	};
	const targets: Platform[] = LATE_PLATFORMS.filter((p) => lateTargets.some((a) => a.platform === p));
	const shown = targets;

	// TikTok's own options for the (first) ticked TikTok account: who can watch, the interactions it allows.
	const tiktokAccount = lateTargets.find((a) => a.platform === "tiktok");
	const [tk, setTk] = useState<TikTokOptions | { error: string } | null>(null);
	const [tiktok, setTiktokState] = useState<TikTokChoice>(() => draft.tiktok ?? NO_TIKTOK);
	const tiktokNow = useRef(tiktok);
	tiktokNow.current = tiktok;
	const tiktokId = tiktokAccount?.id;
	useEffect(() => {
		if (!tiktokId) return;
		let live = true;
		setTk(null);
		tiktokOptions(tiktokId)
			.then((o) => {
				if (!live) return;
				setTk(o);
				// The first post: TikTok's open setting is chosen for the person (final-B I2, 07.11: «Post now» stayed off until
				// «Who can watch» was picked, every time); a choice made once is remembered (usePostDraft) and comes back.
				if (!("privacyLevels" in o) || o.privacyLevels.some((l) => l.value === tiktokNow.current.privacyLevel)) return;
				const open = ["PUBLIC_TO_EVERYONE", "FOLLOWER_OF_CREATOR", "MUTUAL_FOLLOW_FRIENDS"].find((v) => o.privacyLevels.some((l) => l.value === v));
				if (!open) return;
				const next = { ...tiktokNow.current, privacyLevel: open };
				usePostDraft.getState().setTiktok(next);
				setTiktokState(next);
			})
			.catch((e) => live && setTk({ error: (e as Error).message }));
		return () => {
			live = false;
		};
	}, [tiktokId]);
	const setTiktok = (patch: Partial<TikTokChoice>) =>
		setTiktokState((prev) => {
			const next = { ...prev, ...patch };
			usePostDraft.getState().setTiktok(next);
			return next;
		});
	const tkOptions = tk && "privacyLevels" in tk ? tk : null;
	const tiktokChoice: TikTokChoice | undefined = tkOptions
		? {
				privacyLevel: tkOptions.privacyLevels.some((l) => l.value === tiktok.privacyLevel) ? tiktok.privacyLevel : "",
				allowComment: tiktok.allowComment && tkOptions.allow.comment,
				allowDuet: tiktok.allowDuet && tkOptions.allow.duet,
				allowStitch: tiktok.allowStitch && tkOptions.allow.stitch,
			}
		: undefined;
	const tiktokBlocked = !!tiktokAccount && (!tkOptions || !tiktokChoice?.privacyLevel || !tkOptions.canPostMore || (!!tkOptions.maxSeconds && seconds > tkOptions.maxSeconds));
	const vertical = isVertical(shownCanvas);
	const issues = useMemo(() => textIssues(targets, text, seconds), [targets, text, seconds]);
	const blocked = issues.some((i) => i.blocking);
	const caption = captionFor(text);
	const tagCount = parseHashtags(text.hashtags).length;
	const scheduleAt = mode === "schedule" ? at : null;
	const tooSoon = mode === "schedule" && at < Date.now() + 2 * 60_000;
	const postable = targets.length > 0 && !blocked && !busy && !tooSoon && !tiktokBlocked;

	const write = async () => {
		setBusy("write");
		setNeedsAi(false);
		const before = text;
		try {
			const r = await writeWithAgent(editor, targets.length ? targets : LATE_PLATFORMS);
			setText({
				title: r.title || before.title,
				description: r.description || before.description,
				hashtags: r.hashtags || before.hashtags,
			});
			toast.success(t("Gaziyav AI wrote the title, description and hashtags"), {
				action: { label: t("Undo"), onClick: () => setText(before) },
			});
		} catch (error) {
			if ((error as { setup?: boolean }).setup) setNeedsAi(true);
			else toast.error((error as Error).message);
		} finally {
			setBusy(null);
		}
	};

	/** Export the timeline (its posted file made vertical when asked) and hand it to the ticked accounts: one press. */
	const submit = async () => {
		const toVertical = !vertical && makeVertical;
		if (toVertical && !mainVideoIds(editor).length) return toast.error(t("Put a video clip on the main track first."));
		setBusy("post");
		setPostCanvas(canvas);
		setCancelling(false);
		const controller = new AbortController();
		run.current = controller;
		try {
			setProgress({ value: 0, stage: toVertical ? t("Making it vertical…") : t("Exporting the video") });
			await startPost(editor, {
				platforms: targets,
				targets: lateTargets,
				tiktok: tiktokAccount ? tiktokChoice : undefined,
				text,
				privacy,
				at: scheduleAt,
				vertical: toVertical,
				signal: controller.signal,
				onProgress: (value, stage) => setProgress({ value, stage }),
			});
			toast.success(scheduleAt ? t("Scheduled") : t("Posting — progress is in the list below and in the header"));
		} catch (error) {
			if (error instanceof PostCancelled) toast(error.message);
			else toast.error((error as Error).message);
		} finally {
			run.current = null;
			setPostCanvas(null);
			setBusy(null);
			setProgress(null);
			setCancelling(false);
		}
	};
	const cancelRun = () => {
		setCancelling(true);
		run.current?.abort();
	};

	/** Connect (or Reconnect: the same account, `reconnect` its id — without it Late made a second account). */
	const connectTo = async (p: Platform, reconnect?: string) => {
		setBusy(p);
		try {
			await connectLate(p, reconnect);
		} catch (error) {
			const detail = (error as { detail?: string }).detail;
			toast.error((error as Error).message, detail ? { description: detail } : undefined);
		} finally {
			setBusy(null);
		}
	};

	const posts = share?.posts ?? [];

	return (
		<DialogContent data-post-sheet className="flex max-h-[min(46rem,92vh)] w-[min(36rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0">
			<DialogTitle className="px-5 pt-4 pb-1 text-base">{t("Post")}</DialogTitle>
			<DialogDescription className="text-muted-foreground px-5 pb-3 text-xs">{t("Shorts, Reels and TikTok: all at once or the ones you tick.")}</DialogDescription>
			<div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4">
				{keyStep && <LateKeyStep refused={share?.late?.error === KEY_REFUSED} />}
				{lateOn && <LateWhere accounts={lateAccounts} picked={pickedIds} pick={pick} busy={busy} connectTo={(p, reconnect) => void connectTo(p, reconnect)} />}

				{!vertical && (
					<div className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs" data-post-not-vertical>
						<Checkbox id="post-make-vertical" checked={makeVertical} onCheckedChange={(v) => setMakeVertical(!!v)} className="mt-0.5" data-post-make-vertical />
						<label htmlFor="post-make-vertical">
							{makeVertical
								? t("Make it vertical (9:16) when posting: this project is {w}×{h}. Only the posted video is made vertical, the face or subject kept in the frame; the project stays as it is.", { w: shownCanvas.width, h: shownCanvas.height })
								: t("Posting as it is ({w}×{h}): Shorts, Reels and TikTok will show it with bars.", { w: shownCanvas.width, h: shownCanvas.height })}
						</label>
					</div>
				)}

				<div className="flex items-center justify-between gap-2">
					<span className="text-muted-foreground text-xs">{t("Title, description, hashtags (for every site)")}</span>
					<Button size="sm" variant="secondary" className="h-7 gap-1 px-2 text-xs" disabled={!!busy} onClick={() => void write()} data-post-write title={t("Gaziyav AI writes them from the project: its speech, the text on screen, the clips")}>
						{busy === "write" ? t("Writing…") : t("✨ Write with Gaziyav AI")}
					</Button>
				</div>
				{needsAi && (
					<p className="text-muted-foreground -mt-2 flex items-center gap-2 text-xs" data-post-needs-ai>
						{t("Gaziyav AI has no AI yet. Set one up, or write it yourself.")}
						<button type="button" className="text-primary underline" onClick={() => openSettings("ai")}>
							{t("Settings → AI")}
						</button>
					</p>
				)}

				<section className="flex flex-col gap-2">
					{shown.includes("youtube") && (
						<div className="flex flex-col gap-1">
							<label className="text-muted-foreground text-xs" htmlFor="post-title">
								{t("Title (YouTube)")}{" "}
								<span className="tabular-nums">
									· {text.title.trim().length}/{LIMITS.youtube.title}
								</span>
							</label>
							<Input id="post-title" value={text.title} maxLength={140} onChange={(e) => setText({ title: e.target.value })} data-post-title />
						</div>
					)}
					<div className="flex flex-col gap-1">
						<label className="text-muted-foreground text-xs" htmlFor="post-description">
							{t("Description")}
						</label>
						<Textarea id="post-description" rows={4} value={text.description} onChange={(e) => setText({ description: e.target.value })} placeholder={t("What the video is about")} data-post-description />
					</div>
					<div className="flex flex-col gap-1">
						<label className="text-muted-foreground text-xs" htmlFor="post-hashtags">
							{t("Hashtags")}
						</label>
						<Input id="post-hashtags" value={text.hashtags} onChange={(e) => setText({ hashtags: e.target.value })} placeholder="#shorts #reels #travel" data-post-hashtags />
					</div>
					<div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums" data-post-counters>
						{(["youtube", "instagram", "tiktok"] as const).map((p) => (
							<span key={p} className={cn(caption.length > LIMITS[p].caption && "text-destructive")} data-post-counter={p}>
								{PLATFORM_LABEL[p].split(" ").pop()} {caption.length}/{LIMITS[p].caption}
								{LIMITS[p].hashtags ? ` · # ${tagCount}/${LIMITS[p].hashtags}` : ""}
							</span>
						))}
					</div>
					{issues.map((i) => (
						<p key={i.message} className={cn("text-xs", i.blocking ? "text-destructive" : "text-muted-foreground")} data-post-issue={i.platform}>
							{t(i.message, i.vars)}
						</p>
					))}
				</section>

				{targets.includes("youtube") && (
					<section className="flex flex-col gap-1">
						<div className="flex items-center gap-2">
							<span className="text-muted-foreground text-xs">{t("Who can watch (Shorts)")}</span>
							<Select value={privacy} onValueChange={(v) => setPrivacy(v as typeof privacy)}>
								<SelectTrigger className="h-7 w-32 text-xs" data-post-privacy>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="public">{t("Public")}</SelectItem>
									<SelectItem value="unlisted">{t("Unlisted")}</SelectItem>
									<SelectItem value="private">{t("Private")}</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</section>
				)}

				{tiktokAccount && <TikTokOptionsBox info={tk} choice={tiktok} effective={tiktokChoice} set={setTiktok} seconds={seconds} />}

				<section className="flex flex-col gap-2" data-post-when>
					<div className="bg-foreground/[0.05] flex w-fit gap-0.5 rounded-lg p-0.5">
						{(["now", "schedule"] as const).map((m) => (
							<button key={m} type="button" onClick={() => setMode(m)} data-post-mode={m} aria-pressed={mode === m} className={cn("h-7 rounded-md px-3 text-xs", mode === m ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}>
								{m === "now" ? t("Now") : t("Schedule")}
							</button>
						))}
					</div>
					{mode === "schedule" && (
						<>
							<Input type="datetime-local" className="h-8 w-56 text-sm" value={localValue(at)} min={localValue(Date.now() + 2 * 60_000)} onChange={(e) => e.target.value && setAt(new Date(e.target.value).getTime())} data-post-at />
							{tooSoon && <p className="text-destructive text-xs">{t("Pick a time at least 2 minutes from now.")}</p>}
							<p className="text-muted-foreground text-[11px] leading-snug" data-post-local-note>
								{t("Late posts it at that time, even while Gaziyav is closed.")}
							</p>
						</>
					)}
				</section>

				{posts.length > 0 && <PostList posts={posts} />}
			</div>
			{progress && (
				<div className="flex shrink-0 flex-col gap-1 border-t px-5 pt-3" data-post-progress>
					<div className="text-muted-foreground flex items-center gap-2 text-xs">
						<span className="min-w-0 flex-1 truncate" data-post-progress-stage>
							{cancelling ? t("Cancelling…") : progress.stage}
						</span>
						<span className="tabular-nums">{Math.round(progress.value * 100)}%</span>
						{/* Stops the export (or the hand-over); nothing is posted. */}
						<Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={cancelling} onClick={cancelRun} data-post-cancel-run="export">
							{t("Cancel")}
						</Button>
					</div>
					<Progress value={progress.value * 100} className="h-1" />
				</div>
			)}
			<div className="flex shrink-0 items-center gap-3 border-t px-5 py-3">
				<p className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{keyStep ? t("Paste your Late key first") : lateTargets.length ? lateTargets.map((a) => a.name).join(" · ") : t("Tick where to post")}</p>
				<Button variant="ghost" onClick={close}>
					{t("Close")}
				</Button>
				<Button disabled={!postable} onClick={() => void submit()} data-post-submit>
					{busy === "post" ? t("Exporting…") : mode === "schedule" ? t("Schedule") : t("Post now")}
				</Button>
			</div>
		</DialogContent>
	);
}

function PostList({ posts }: { posts: Post[] }) {
	const t = useT();
	const apply = (run: Promise<unknown>) => void run.catch((e) => toast.error((e as Error).message));
	const scheduled = posts.filter((p) => p.state === "scheduled");
	const rest = posts.filter((p) => p.state !== "scheduled").slice(0, 12);
	const row = (p: Post) => (
		<div key={p.id} className="bg-foreground/[0.04] flex flex-col gap-1 rounded-lg px-3 py-2" data-post-row={p.id} data-post-state={p.state} data-post-row-platform={p.platform}>
			<div className="flex items-center gap-2">
				<span className="text-xs font-medium">{PLATFORM_LABEL[p.platform]}</span>
				{p.accountName && (
					<span className="text-muted-foreground max-w-[9rem] truncate text-xs" data-no-translate data-post-row-account>
						{p.accountName}
					</span>
				)}
				<span className="text-muted-foreground min-w-0 flex-1 truncate text-xs" data-no-translate>
					{p.title || p.project}
				</span>
				{p.url && (
					<Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => window.open(p.url, "_blank")} data-post-open>
						{t("Open the post")}
					</Button>
				)}
				{p.state === "failed" && (
					<Button size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={() => apply(shareApi.retry(p.id))} data-post-retry>
						{t("Retry")}
					</Button>
				)}
				{p.state === "manual" && (
					<Button size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={() => apply(shareApi.show(p.id))} data-post-show>
						{t("Show the window")}
					</Button>
				)}
				{(p.state === "scheduled" || p.state === "queued") && (
					<Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => apply(shareApi.cancel(p.id))} data-post-cancel>
						{t("Cancel")}
					</Button>
				)}
				{/* While its video is still going up to Late: Cancel stops it, nothing is posted. */}
				{p.state === "uploading" && p.cancellable && (
					<Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => apply(shareApi.cancel(p.id))} data-post-cancel-run={p.id}>
						{t("Cancel")}
					</Button>
				)}
				{(p.state === "done" || p.state === "failed" || p.state === "cancelled") && (
					<button type="button" className="text-muted-foreground hover:text-foreground px-1 text-xs" aria-label={t("Remove from the list")} title={t("Remove from the list")} onClick={() => apply(shareApi.remove(p.id))} data-post-remove>
						×
					</button>
				)}
			</div>
			<div className={cn("text-xs", p.state === "failed" ? "text-destructive whitespace-pre-line" : "text-muted-foreground")} data-post-status>
				{p.state === "scheduled" && p.at ? `${t("Posts at")} ${when(p.at)}` : null}
				{p.state === "queued" ? t("Opening the site") : null}
				{p.state === "uploading" ? (p.stage ? t(p.stage) : t("Uploading")) : null}
				{p.state === "manual" ? p.stage : null}
				{p.state === "done" ? t("Posted") : null}
				{p.state === "cancelled" ? t("Cancelled") : null}
				{p.state === "failed" ? (p.error ? t(p.error) : t("The post failed.")) : null}
			</div>
			{p.state === "failed" && p.errorDetail && (
				<div className="text-muted-foreground text-[11px] break-words" data-no-translate data-post-error-detail>
					{p.errorDetail}
				</div>
			)}
			{p.state === "uploading" && <Progress value={p.progress * 100} className="h-1" />}
			{p.stage && p.state === "done" && <div className="text-muted-foreground text-[11px]">{t(p.stage)}</div>}
		</div>
	);
	return (
		<section className="flex flex-col gap-1.5" data-post-list>
			{scheduled.length > 0 && <div className="text-muted-foreground text-xs font-medium">{t("Scheduled")}</div>}
			{scheduled.map(row)}
			{rest.length > 0 && <div className="text-muted-foreground mt-1 text-xs font-medium">{t("Posts")}</div>}
			{rest.map(row)}
		</section>
	);
}

/** Where to post through Late: every connected account, ticked or not; a platform with none offers Connect. */
function LateWhere({ accounts, picked, pick, busy, connectTo }: { accounts: LateAccount[]; picked: string[]; pick: (id: string, on: boolean) => void; busy: string | null; connectTo: (p: Platform, reconnect?: string) => void }) {
	const t = useT();
	return (
		<section className="flex flex-col gap-1.5" data-post-platforms data-post-late>
			<span className="text-muted-foreground text-xs">{t("Where to post")}</span>
			{LATE_PLATFORMS.map((p) => {
				const mine = accounts.filter((a) => a.platform === p);
				if (!mine.length)
					return (
						<div key={p} className="bg-foreground/[0.04] flex items-center gap-2.5 rounded-lg px-3 py-2" data-post-platform={p} data-post-ready="0">
							<Avatar platform={p} size="size-6" />
							<span className="min-w-0 flex-1">
								<span className="block text-sm font-medium">{PLATFORM_LABEL[p]}</span>
								<span className="text-muted-foreground block text-xs">{t("Not connected")}</span>
							</span>
							{canUseLate() && (
								<Button size="sm" variant="secondary" disabled={!!busy} onClick={() => connectTo(p)} data-post-connect={p}>
									{busy === p ? t("Signing in…") : t("Connect…")}
								</Button>
							)}
						</div>
					);
				return mine.map((a) => (
					<div key={a.id} className="bg-foreground/[0.04] flex items-center gap-2.5 rounded-lg px-3 py-2" data-post-platform={p} data-post-account-row={a.id} data-post-ready={a.reconnect ? "0" : "1"}>
						<Checkbox id={`post-acc-${a.id}`} checked={!a.reconnect && picked.includes(a.id)} disabled={!!a.reconnect} onCheckedChange={(v) => pick(a.id, !!v)} data-post-check={p} data-post-check-account={a.id} />
						<label htmlFor={`post-acc-${a.id}`} className="flex min-w-0 flex-1 items-center gap-2">
							<Avatar platform={p} src={a.avatar} size="size-6" />
							<span className="min-w-0">
								<span className="block text-sm font-medium">{PLATFORM_LABEL[p]}</span>
								<span className={a.reconnect ? "block truncate text-xs text-amber-500" : "text-muted-foreground block truncate text-xs"} data-post-account={p}>
									{a.reconnect ? t("The sign-in has expired: connect it again.") : a.name}
								</span>
							</span>
						</label>
						{/* The same account renewed (its id): without it Late connected a second, duplicate account. */}
						{a.reconnect && canUseLate() && (
							<Button size="sm" variant="secondary" disabled={!!busy} onClick={() => connectTo(p, a.id)} data-post-connect={p} data-post-reconnect={a.id}>
								{busy === p ? t("Signing in…") : t("Reconnect")}
							</Button>
						)}
					</div>
				));
			})}
			{!accounts.length && (
				<button type="button" className="text-primary w-fit text-xs underline" onClick={() => openSettings("share")} data-post-open-settings>
					{t("Settings → Share")}
				</button>
			)}
		</section>
	);
}

/** No Late key yet (or Late refused the saved one): the one step before the first post, right here — Save checks it
 *  with Late and the accounts appear in place. (It fell back to posting through the sites in a Share window.) */
function LateKeyStep({ refused }: { refused: boolean }) {
	const t = useT();
	return (
		<section className="flex flex-col gap-2 rounded-lg border px-3 py-3" data-post-key-step>
			<span className="text-sm font-medium">{t("Connect your accounts once: paste your Late key")}</span>
			<p className="text-muted-foreground text-xs leading-relaxed">{t("Late posts to YouTube, Instagram and TikTok through their official APIs. After the key, connect each account with the platform's own sign-in; then one press posts.")}</p>
			{refused && (
				<p className="text-xs text-amber-500" data-post-key-refused>
					{t(KEY_REFUSED)}
				</p>
			)}
			<LateKeyForm replacing={refused} />
			<button type="button" className="text-primary w-fit text-xs underline" onClick={() => window.open(LATE_KEYS_URL, "_blank")} data-late-get-key>
				{t("Get a key at zernio.com")}
			</button>
		</section>
	);
}

/** TikTok's own post settings (its rules): who can watch — no default the first time —, the interactions, the consent line. */
function TikTokOptionsBox({ info, choice, effective, set, seconds }: { info: TikTokOptions | { error: string } | null; choice: TikTokChoice; effective?: TikTokChoice; set: (patch: Partial<TikTokChoice>) => void; seconds: number }) {
	const t = useT();
	if (!info)
		return (
			<p className="text-muted-foreground text-xs" data-post-tiktok-loading>
				{t("Asking TikTok for this account's options…")}
			</p>
		);
	if ("error" in info)
		return (
			<p className="text-destructive text-xs" data-post-tiktok-error>
				{info.error}
			</p>
		);
	const toggles = [
		["allowComment", "comment", "Comments"],
		["allowDuet", "duet", "Duets"],
		["allowStitch", "stitch", "Stitches"],
	] as const;
	return (
		<section className="flex flex-col gap-2 rounded-lg border px-3 py-2.5" data-post-tiktok>
			<div className="flex items-center gap-2">
				<span className="text-muted-foreground text-xs">{t("Who can watch (TikTok)")}</span>
				<Select value={effective?.privacyLevel || undefined} onValueChange={(v) => set({ privacyLevel: v })}>
					<SelectTrigger className="h-7 w-48 text-xs" data-post-tiktok-privacy>
						<SelectValue placeholder={t("Choose…")} />
					</SelectTrigger>
					<SelectContent>
						{info.privacyLevels.map((l) => (
							<SelectItem key={l.value} value={l.value} data-post-tiktok-level={l.value}>
								{t(l.label)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
				<span className="text-muted-foreground">{t("Allow")}</span>
				{toggles.map(([field, allow, label]) => (
					<label key={field} htmlFor={`post-tiktok-${allow}`} className={cn("flex items-center gap-1.5", !info.allow[allow] && "opacity-50")}>
						<Checkbox id={`post-tiktok-${allow}`} checked={!!effective?.[field]} disabled={!info.allow[allow]} onCheckedChange={(v) => set({ [field]: !!v })} data-post-tiktok-allow={allow} />
						{t(label)}
					</label>
				))}
			</div>
			{!effective?.privacyLevel && <p className="text-muted-foreground text-xs">{t("TikTok: choose who can watch.")}</p>}
			{!info.canPostMore && <p className="text-destructive text-xs">{t("TikTok says this account can't post more right now. Try again later.")}</p>}
			{!!info.maxSeconds && seconds > info.maxSeconds && (
				<p className="text-destructive text-xs">
					{t("TikTok: this account can post videos up to {max} s.", {
						max: info.maxSeconds,
					})}
				</p>
			)}
			<p className="text-muted-foreground text-[11px] leading-snug" data-post-tiktok-consent>
				{t("By posting, you agree to TikTok's Music Usage Confirmation.")}
			</p>
			{choice.privacyLevel === "SELF_ONLY" && <p className="text-muted-foreground text-[11px]">{t("Only you will see it on TikTok.")}</p>}
		</section>
	);
}
