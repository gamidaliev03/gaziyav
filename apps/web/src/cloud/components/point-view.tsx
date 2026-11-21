"use client";

// AI image / AI video (Media → Generate): pictures and clips from fal.ai's models on the user's own fal key, the price
// on the button before anything runs. Finished results drag onto the timeline or into Media like files.
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { cn } from "@/utils/ui";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { Alert02Icon, Cancel01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { estimatePoint, jobModelId, type Kind, modelName, type PointInput, type PointJob, type PointModel, pointModels, pointReference, resultToMedia, resultToTimeline, usePoint } from "../client";
import { useT } from "@/i18n";
import { usd } from "@/fal/models";
import { manyKeys } from "@/fal/video";
import { openFalSettings, useAnyKey, useFal, useKeys } from "@/fal/client";
import { ActiveJobLine } from "./active-job";
import { VideoComposer } from "./video-composer";

/** A refusal for an empty balance (fal, kie.ai, ArgoLink, a service): the card offers the same words free. */
const EMPTY_BALANCE = /balance|баланс|exhausted|top (it )?up|пополн|no money|нет денег/i;

const KINDS: { id: Kind; label: string; placeholder: string }[] = [
	{ id: "video", label: "Video", placeholder: "What happens in the shot: subject, action, camera, light, style…" },
	{ id: "image", label: "Image", placeholder: "Describe the picture: subject, setting, light, style…" },
];

/** The model's unit price, for its menu line. */
const fromPrice = (m: PointModel): number | null => (typeof m.usd === "number" ? m.usd : null);

const bolt = (n: number | null | undefined) => (n == null ? "" : usd(n));

/** The generator. Placed where CapCut has its cloud AI (Media → Generate → AI image / AI video): `kind` fixes the
 * mode there and `title` names the place; without a fal key it says where the key goes. */
export function PointView({ kind, title = "AI" }: { kind?: Kind; title?: string } = {}) {
	const { status, jobs: allJobs, refresh, start, poll } = usePoint();
	// Each project sees only the generations made in it (the owner, 16.11: no list of other projects' results).
	const projectId = useEditor((e) => e.project.getActiveOrNull()?.metadata.id ?? "");
	const jobs = useMemo(() => allJobs.filter((j) => j.projectId === projectId), [allJobs, projectId]);
	// Settings is a dialog over this panel: a key saved there fires no window focus, the panel follows the key itself.
	const keySet = useAnyKey();
	const keys = useKeys();
	const keysSig = keys ? `${+keys.fal}${+keys.kie}` : "";
	useEffect(() => {
		if (!useFal.getState().status) void useFal.getState().refresh();
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: keySet is the reason to read again
	useEffect(() => {
		void refresh();
	}, [refresh, keySet, keysSig]);

	// Back from Settings (a key added): read again.
	useEffect(() => {
		let last = 0;
		const onFocus = () => {
			if (Date.now() - last < 10_000) return;
			last = Date.now();
			void refresh();
		};
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [refresh]);

	// Active generations are followed every few seconds while the tab is open.
	useEffect(() => {
		if (!jobs.some((j) => j.state === "queued" || j.state === "running")) return;
		const t = window.setInterval(() => void poll(), 4000);
		return () => window.clearInterval(t);
	}, [jobs, poll]);

	if (!status) {
		return (
			<PanelView title={title}>
				<div className="flex h-40 items-center justify-center">
					<Spinner />
				</div>
			</PanelView>
		);
	}

	if (!status.connected) {
		return (
			<PanelView title={title}>
				<div className="flex flex-col items-center gap-3 px-4 pt-6 pb-4 text-center" data-ai-nokey>
					<p className="text-sm font-semibold">Pictures and clips from text</p>
					<Button onClick={openFalSettings} data-ai-open-settings>
						<HugeiconsIcon icon={Settings01Icon} className="mr-1.5 size-3.5" />
						Add a key
					</Button>
				</div>
			</PanelView>
		);
	}

	return (
		<PanelView
			title={title}
			// the video form is as tall as the panel (its form scrolls inside, Generate stays under it); Results lie below
			contentClassName={kind === "video" ? "flex h-full flex-col" : undefined}
			// No header row of its own: it held one small word («Models»), and it stood as an empty band above the form
			hideHeader
		>
			{/* Video: the results live inside the form's scroller (one scroller under the pinned Generate bar). */}
			{kind === "video" ? (
				<VideoComposer onStart={start} results={<Results jobs={jobs} />} />
			) : (
				<>
					<Composer onStart={start} kind={kind} />
					<Results jobs={jobs} scrollToNew />
				</>
			)}
		</PanelView>
	);
}

/** A picture, clip or sound from Media chosen as a reference (sent to fal.ai when Generate is pressed). */
function MediaPick({ type, value, onChange, placeholder, exclude = [], field }: { type: "image" | "video" | "audio"; value: string; onChange: (id: string) => void; placeholder: string; exclude?: string[]; field: string }) {
	const assets = useEditor((e) => e.media.getAssets().filter((a) => a.type === type && !a.ephemeral), ["media"]);
	const list = assets.filter((a) => a.id === value || !exclude.includes(a.id));
	return (
		<Select value={value || "none"} onValueChange={(v) => onChange(v === "none" ? "" : v)}>
			<SelectTrigger className="h-8 text-xs" data-point-field={field}>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="none" className="text-xs">
					{list.length ? placeholder : `${placeholder} — add one to Media first`}
				</SelectItem>
				{list.map((a) => (
					<SelectItem key={a.id} value={a.id} className="text-xs">
						{a.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function Composer({ onStart, kind: fixed }: { onStart: ReturnType<typeof usePoint.getState>["start"]; kind?: Kind }) {
	const t = useT();
	// A request started on the home page (AI tiles) opens here in its mode, already typed.
	const [draft] = useState(() => usePoint.getState().draft);
	const [kind, setKind] = useState<Kind>(fixed ?? draft?.kind ?? "video");
	const [models, setModels] = useState<PointModel[]>([]);
	const [modelId, setModelId] = useState("");
	const keys = useKeys();
	const keysSig = keys ? `${+keys.fal}${+keys.kie}` : "";
	const both = manyKeys(keys);
	const [prompt, setPrompt] = useState(draft?.prompt ?? "");
	const [aspect, setAspect] = useState("");
	const [duration, setDuration] = useState(0);
	const [quality, setQuality] = useState("");
	// References from Media: the video's start frame, pictures an image model follows, a clip and a sound for video.
	const [startFrame, setStartFrame] = useState("");
	const [pictures, setPictures] = useState<string[]>([]);
	const [price, setPrice] = useState<number | null>(null);
	const [busy, setBusy] = useState(false);
	/** Set at once on press (state is async: a fast double click would start two paid jobs). */
	const running = useRef(false);
	/** When the last job was started: the second click of a double click (even after an instant answer) is ignored. */
	const lastStart = useRef(0);
	/** What that last press asked for: only the same request again within the second is a double click. */
	const lastSig = useRef("");
	const canvas = useEditor((e) => e.project.getActiveOrNull()?.settings.canvasSize ?? null, ["project"]);
	const portrait = !canvas || canvas.height >= canvas.width;
	/** References already sent to fal, by Media id: pressing Generate again doesn't upload them again. */
	const uploaded = useRef(new Map<string, string>());

	useEffect(() => {
		if (draft) usePoint.getState().setDraft(null);
	}, [draft]);

	useEffect(() => {
		let off = false;
		setModels([]);
		pointModels(kind)
			.then((list) => {
				if (off) return;
				setModels(list);
			})
			.catch((e) => toast.error((e as Error).message));
		return () => {
			off = true;
		};
	}, [kind, keysSig]);

	const shown = models;
	useEffect(() => {
		setModelId((cur) => (shown.some((m) => m.id === cur) ? cur : (shown.find((m) => m.default) ?? shown[0])?.id ?? ""));
	}, [shown]);

	const model = useMemo(() => shown.find((m) => m.id === modelId), [shown, modelId]);
	const aspects = model?.limits?.supported_aspect_ratios ?? [];
	const durations = model?.limits?.supported_durations_seconds ?? [];
	const qualities = model?.limits?.supported_qualities ?? [];
	const maxPictures = model?.limits?.max_reference_images ?? (kind === "image" ? 4 : 0);
	const maxChars = model?.limits?.max_prompt_characters ?? model?.limits?.max_simple_prompt_characters ?? 5000;

	// Sensible defaults per model: the project's own shape, a short take, the lowest quality (cheapest). Choices the
	// new model also offers are kept.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the defaults are picked when the model or the project shape changes, not when the lists are rebuilt
	useEffect(() => {
		if (!model) return;
		setAspect((cur) => (aspects.includes(cur) ? cur : aspects.includes(portrait ? "9:16" : "16:9") ? (portrait ? "9:16" : "16:9") : (aspects[0] ?? "")));
		setDuration((cur) => (durations.includes(cur) ? cur : durations.includes(5) ? 5 : (durations[0] ?? 0)));
		setQuality((cur) => (qualities.includes(cur) ? cur : (qualities[0] ?? "")));
		setPictures((cur) => cur.slice(0, Math.max(0, maxPictures)));
	}, [model, portrait]);

	const refs = kind === "video" ? (startFrame ? [startFrame] : []) : kind === "image" ? pictures : [];
	const input: PointInput = {
		kind,
		prompt: prompt.trim(),
		model: modelId,
		...(aspect ? { aspect_ratio: aspect } : {}),
		...(kind === "video" && duration ? { duration_seconds: duration } : {}),
		...(kind === "video" && quality ? { quality } : {}),
		...(refs.length ? { reference_count: refs.length } : {}),
	};
	const key = JSON.stringify(input);
	const timer = useRef<number | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: key is the request itself (JSON)
	useEffect(() => {
		setPrice(null);
		if (!input.prompt || !input.model) return;
		if (timer.current) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			estimatePoint(input).then(setPrice).catch(() => setPrice(null));
		}, 450);
		return () => {
			if (timer.current) window.clearTimeout(timer.current);
		};
	}, [key]);

	/** fal's ids of the chosen Media files (uploaded once). */
	const upload = async (ids: string[], as: Kind): Promise<string[]> => {
		const assets = EditorCore.getInstance().media.getAssets();
		const out: string[] = [];
		for (const id of ids) {
			const asset = assets.find((a) => a.id === id);
			if (!asset) throw new Error("A reference was removed from Media. Pick it again.");
			let pointId = uploaded.current.get(id);
			if (!pointId) {
				pointId = await pointReference(asset.file, as);
				uploaded.current.set(id, pointId);
			}
			out.push(pointId);
		}
		return out;
	};

	const generate = async () => {
		// A double click is the same request twice within a second: dropped. New words or settings pressed right after a run
		// are a new request and go (ai-matrix on v63k: a new prompt pressed 0.7 s after the last run did nothing at all).
		const sig = JSON.stringify([input, pictures, startFrame]);
		if (running.current || (sig === lastSig.current && Date.now() - lastStart.current < 1000)) return;
		running.current = true;
		lastStart.current = Date.now();
		lastSig.current = sig;
		setBusy(true);
		try {
			const { reference_count: _count, ...request } = input;
			if (kind === "video") {
				if (startFrame) request.image_asset_ids = await upload([startFrame], "image");
			} else if (kind === "image" && pictures.length) {
				request.image_asset_ids = await upload(pictures, "image");
			}
			// Everything stays as it is: the same settings can be generated again or changed a little.
			await onStart(request);
		} catch (e) {
			const message = (e as Error).message;
			if (/key/i.test(message)) toast.error(message, { action: { label: "Settings", onClick: openFalSettings } });
			else toast.error(message);
		} finally {
			running.current = false;
			setBusy(false);
		}
	};

	const placeholder = KINDS.find((k) => k.id === kind)?.placeholder;

	return (
		<div className="flex flex-col gap-2 px-2 pb-2.5">
			{!fixed && <div className="bg-accent/60 grid grid-cols-2 gap-1 rounded-lg p-1">
				{KINDS.map((k) => (
					<button
						key={k.id}
						type="button"
						onClick={() => setKind(k.id)}
						className={cn("rounded-md py-1.5 text-xs font-medium", kind === k.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
					>
						{k.label}
					</button>
				))}
			</div>}
			<div className="flex items-center gap-1.5">
			<Select value={modelId} onValueChange={setModelId}>
				<SelectTrigger className="h-8 min-w-0 flex-1 text-xs" data-point-field="model">
					<SelectValue placeholder={models.length ? "Model" : "Loading models…"} />
				</SelectTrigger>
				<SelectContent>
					{shown.map((m) => (
						<SelectItem key={m.id} value={m.id} className="text-xs">
							{m.title} <span className="text-muted-foreground ml-1">{m.maker ? `${m.maker} · ` : ""}{m.kind === "video" ? t("{price}/s", { price: bolt(fromPrice(m)) }) : bolt(fromPrice(m))}</span>
							{both && <span className="text-muted-foreground/70 ml-1" data-model-api={m.api ?? "fal"}>{m.api ?? "fal"}</span>}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
				{/* where the models and the keys live, on the model's own row: a header band of its own stood empty above the form */}
				<button
					type="button"
					onClick={openFalSettings}
					title={t("Models and API keys")}
					aria-label={t("Models and API keys")}
					data-ai-open-settings
					className="text-muted-foreground hover:bg-accent hover:text-foreground grid size-8 shrink-0 place-items-center rounded-md border transition-colors"
				>
					<HugeiconsIcon icon={Settings01Icon} className="size-3.5" />
				</button>
			</div>
			{kind === "video" && <MediaPick field="start-frame" type="image" value={startFrame} onChange={setStartFrame} placeholder={model?.needsImage ? "Start frame (needed)" : "Start frame: none (from text)"} />}
			{kind === "image" && maxPictures > 0 && (
				<div className="flex flex-col gap-1.5">
					{[...pictures, ""].slice(0, maxPictures).map((id, i) => (
						<MediaPick
							key={id || "add"}
							field={`picture-${i}`}
							type="image"
							value={id}
							exclude={pictures}
							placeholder={i === 0 ? `Reference picture: none (up to ${maxPictures})` : "Another reference picture"}
							onChange={(v) => setPictures((cur) => (v ? [...cur.slice(0, i), v, ...cur.slice(i + 1)] : cur.filter((_, j) => j !== i)))}
						/>
					))}
				</div>
			)}
			<div className="relative">
				<Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={placeholder} className="min-h-24 resize-none pb-5 text-sm" maxLength={maxChars} data-point-field="prompt" />
				{prompt.length > maxChars * 0.8 && <span className="text-muted-foreground pointer-events-none absolute right-2 bottom-1 text-[10px]">{`${prompt.length} / ${maxChars}`}</span>}
			</div>
			{(aspects.length > 1 || (kind === "video" && durations.length > 1) || (kind === "video" && qualities.length > 1)) && (
				<div className="flex gap-1.5">
					{aspects.length > 1 && <Options field="aspect" value={aspect} options={aspects} onChange={setAspect} />}
					{kind === "video" && durations.length > 1 && <Options field="duration" value={String(duration)} options={durations.map(String)} label={(v) => `${v} s`} onChange={(v) => setDuration(Number(v))} />}
					{kind === "video" && qualities.length > 1 && <Options field="quality" value={quality} options={qualities} onChange={setQuality} />}
				</div>
			)}
			<Button disabled={busy || !input.prompt || !input.model} onClick={generate} data-point-generate>
				{busy ? <Spinner className="mr-2 size-3.5" /> : null}
				{/* The list price of one picture until the description gives the exact one: the price shows before anything runs. */}
				Generate{(price ?? (model ? fromPrice(model) : null)) != null ? ` · ≈ ${bolt(price ?? (model ? fromPrice(model) : null))}` : ""}
			</Button>
			<ActiveJobLine kind={kind} />
		</div>
	);
}

function Options({ value, options, onChange, label, field }: { value: string; options: string[]; onChange: (v: string) => void; label?: (v: string) => string; field: string }) {
	return (
		<Select value={value} onValueChange={onChange}>
			<SelectTrigger className="h-7 flex-1 px-2 text-xs" data-point-field={field}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{options.map((o) => (
					<SelectItem key={o} value={o} className="text-xs">
						{label ? label(o) : o}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function Results({ jobs, scrollToNew = false }: { jobs: PointJob[]; scrollToNew?: boolean }) {
	// A new job's card comes into view (it lies under the form, often below the panel's edge: check-ai D6 / check-flow A5, 06.11).
	const box = useRef<HTMLDivElement>(null);
	const newest = jobs[0]?.id;
	useEffect(() => {
		if (newest && scrollToNew) box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}, [newest, scrollToNew]);
	if (!jobs.length) return null;
	return (
		<div ref={box} className="flex flex-col gap-2 border-t px-3 pt-3 pb-4" data-point-results>
			<div className="grid grid-cols-2 gap-2">
				{jobs.map((j) => (
					<ResultCard key={j.id} job={j} />
				))}
			</div>
		</div>
	);
}

/** A result stays here until taken: + adds it to Media, a drag or a double-click puts it on the timeline. */
function ResultCard({ job }: { job: PointJob }) {
	const t = useT();
	const forget = usePoint((s) => s.forget);
	const active = job.state === "queued" || job.state === "running";
	// Stop frees the queue: the card goes and the form keeps every setting, so the same Generate runs it again. A provider
	// that may still bill a started job (kie.ai, ArgoLink) keeps the card with that one line.
	const stop = () =>
		void usePoint
			.getState()
			.cancel(job.id)
			.then(() => {
				const now = usePoint.getState().jobs.find((j) => j.id === job.id);
				if (!now?.error || now.error === "Cancelled") forget(job.id);
			})
			.catch((e) => toast.error((e as Error).message));
	const editor = useEditor();
	const [adding, setAdding] = useState(false);
	const ready = job.state === "succeeded" && job.files.length > 0;
	// The model's title on the card, its fal id in the tooltip.
	const modelId = jobModelId(job);
	const title = modelName(modelId);
	const src = ready ? `/api/cloud/file/${job.id}/0` : null;
	const add = async (where: "timeline" | "media") => {
		setAdding(true);
		try {
			if (where === "timeline") await resultToTimeline(job);
			else toast.success(`${(await resultToMedia(job)).name} added to Media`);
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setAdding(false);
		}
	};
	return (
		// biome-ignore lint/a11y: dragging a finished take to the timeline (and its double-click) are pointer shortcuts; the card's buttons do the same
		<div
			className={cn("bg-accent group relative flex flex-col overflow-hidden rounded-md", job.state === "failed" ? "min-h-24" : "aspect-[3/4] min-h-min", ready && "cursor-grab")}
			draggable={ready}
			onDragStart={(e) => {
				if (!ready) return;
				// Into Media only when it lands on the timeline.
				editor.timeline.dragSource.begin({
					dataTransfer: e.dataTransfer,
					dragData: { id: job.id, type: "source-file", name: job.prompt.slice(0, 40) || title, mediaType: job.kind, dur: job.kind === "image" ? 0 : (job.duration ?? 5), take: () => resultToMedia(job) },
				});
			}}
			onDragEnd={() => editor.timeline.dragSource.end()}
			onDoubleClick={() => ready && void add("timeline")}
			title={job.prompt}
			data-point-result={job.id}
			data-point-state={job.state}
		>
			<div className="relative min-h-0 flex-1 overflow-hidden">
				{/* biome-ignore lint/performance/noImgElement: a result served by the app's own local server, offline — next/image can't optimize it */}
				{/* it arrives: colour settles in and one soft sweep passes (CRAFT.md §4) */}
				{src && job.kind !== "audio" && <span aria-hidden className="gz-sweep pointer-events-none absolute inset-0 z-10 overflow-hidden" data-point-arrived />}
				{src && job.kind === "image" && <img src={src} alt="" className="size-full animate-[gz-colour-in_320ms_cubic-bezier(0.22,1,0.36,1)] object-cover" draggable={false} />}
				{src && job.kind === "video" && (
					<video src={src} muted loop playsInline className="size-full animate-[gz-colour-in_320ms_cubic-bezier(0.22,1,0.36,1)] object-cover" onMouseEnter={(e) => void e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />
				)}
				{src && job.kind === "audio" && (
					<div className="flex size-full items-center justify-center p-2">
						{/* biome-ignore lint/a11y/useMediaCaption: music or a voice preview */}
						<audio src={src} controls className="w-full" />
					</div>
				)}
				{!ready && (
					<div className="flex size-full flex-col items-center justify-center gap-2 p-2 text-center">
						{job.state === "failed" ? (
							<>
								{/* Failure is calm and on the object (CRAFT.md §5): the card dims, one retry glyph; the whole sentence (with
								    «Nothing was charged») is its tooltip and stays readable to a screen reader. */}
								<div className="absolute inset-0 bg-black/30" aria-hidden />
								{/* the one line it failed with, on the card (a balance refusal says where to top up); the form above keeps
								    the settings, so Generate runs it again — no separate Retry */}
								<HugeiconsIcon icon={Alert02Icon} className="relative size-4 text-white/80" aria-hidden />
								<span className="relative line-clamp-4 text-[11px] leading-snug text-white" data-point-error>
									{t((job.error ?? "Failed").split("\n\nDetails:")[0].split("\n")[0]).replace(/,? then press Retry\./, ".")}
								</span>
								{/* An empty balance: the same words free — Media's web pictures and stock clips, one press (the form keeps
								    the settings for when the balance is topped up). */}
								{EMPTY_BALANCE.test(job.error ?? "") && job.prompt?.trim() && (
									<button
										type="button"
										className="relative rounded bg-white/90 px-2 py-0.5 text-[11px] font-medium text-black hover:bg-white"
										onClick={() => useAssetsPanelStore.getState().searchMedia(job.prompt)}
										onDoubleClick={(e) => e.stopPropagation()}
										data-point-free
									>
										{t("Find it free on the web")}
									</button>
								)}
								<button
									type="button"
									aria-label={t("Remove")}
									title={t("Remove")}
									className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/50 text-white hover:bg-black/75"
									onClick={() => forget(job.id)}
									onDoubleClick={(e) => e.stopPropagation()}
									data-point-dismiss
								>
									<HugeiconsIcon icon={Cancel01Icon} className="size-3" />
								</button>
							</>
						) : (
							<>
								{/* Behaviour, not words (the owner, 13.11): waiting its turn it breathes; then it fills with its percent. */}
								{job.state === "queued" ? (
									<div className="absolute inset-0 animate-[gz-breathe_1.6s_ease-in-out_infinite] bg-muted/60" data-point-wait />
								) : (
									<div className="absolute inset-0 origin-bottom bg-white/10" style={{ transform: `scaleY(${(job.progress ?? 0) / 100})`, transition: "transform var(--gz-t3) var(--gz-ease)" }} data-point-fill />
								)}
								{job.state !== "queued" && <span className="text-muted-foreground relative text-xs tabular-nums" data-point-percent>{job.progress}%</span>}
								<button
									type="button"
									aria-label={t("Stop")}
									title={t("Stop")}
									className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/50 text-white hover:bg-black/75"
									onClick={stop}
									onDoubleClick={(e) => e.stopPropagation()}
									data-point-cancel
								>
									<HugeiconsIcon icon={Cancel01Icon} className="size-3" />
								</button>
							</>
						)}
					</div>
				)}
				{adding && (
					<div className="absolute inset-0 flex items-center justify-center bg-black/40">
						<Spinner />
					</div>
				)}
			</div>
			<div className="flex items-center gap-1 px-1.5 py-1 text-[0.65rem]">
				<span className="text-muted-foreground min-w-0 flex-1 truncate" title={modelId} data-point-model={modelId}>
					{title}
				</span>
				<span className="text-muted-foreground tabular-nums">{bolt(job.cost)}</span>
			</div>
			{ready && (
				// Always on screen, with words (they showed on hover only, as bare «+» and «↓»: check-flow A5, 06.11).
				// Whole words: in a narrow tile the second button wraps under the first, and a long label («↓ Заменить картинку») onto two lines, instead of being cut («↓ Timeli…», final-B D9).
				<div className="flex flex-wrap gap-1 px-1 pb-1 text-[0.65rem]">
					<button type="button" className="hover:bg-background/80 bg-background/60 max-w-full min-w-0 flex-1 basis-[3.5rem] rounded px-1 py-0.5 leading-tight" onClick={() => void add("media")} onDoubleClick={(e) => e.stopPropagation()} title={t("Add to Media")} data-point-to-media>
						+ {t("Media")}
					</button>
					{job.kind !== "audio" && (
						<button type="button" className="hover:bg-background/80 bg-background/60 max-w-full min-w-0 flex-1 basis-[5rem] rounded px-1 py-0.5 leading-tight" onClick={() => void add("timeline")} onDoubleClick={(e) => e.stopPropagation()} title={t(job.replaces ? "Put it in the picture's place" : "Put on the timeline")} data-point-to-timeline>
							↓ {t(job.replaces ? "Replace the picture" : "Timeline")}
						</button>
					)}
				</div>
			)}
			<div className="absolute top-1 right-1 flex gap-1">
				<button
					type="button"
					className="rounded bg-black/70 px-1.5 py-0.5 text-[0.65rem] text-white"
					onClick={() => {
						// A running job is stopped on fal too (nothing more is billed), then removed.
						if (active) stop();
						forget(job.id);
					}}
					onDoubleClick={(e) => e.stopPropagation()}
					title="Remove from this list"
					aria-label="Remove from this list"
				>
					<HugeiconsIcon icon={Cancel01Icon} className="size-3" />
				</button>
			</div>
		</div>
	);
}
