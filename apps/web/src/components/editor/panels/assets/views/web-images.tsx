"use client";

import { materialGrid, TileAddButton } from "@/components/editor/panels/assets/material-grid";
import { tileActivation } from "../tile-activation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useEditor } from "@/editor/use-editor";
import { processMediaAssets } from "@/media/processing";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { stillDuration } from "@/timeline/creation";
import { creditLine, PROVIDER_NAME, type WebImage, type WebImageSearchResult } from "@/media/web-images/types";
import { mediaTimeFromSeconds } from "@/wasm";
import { SourceSwitch, useSearchSource } from "../source-switch";
import { useT } from "@/i18n";
import { jobCenter } from "@/jobs/store";
import { generateUUID } from "@/utils/id";

/** A response body read with its progress (Content-Length known), as a Blob. */
async function readWithProgress(res: Response, onProgress: (f: number) => void): Promise<Blob> {
	const total = Number(res.headers.get("content-length")) || 0;
	if (!res.body || !total) return res.blob();
	const reader = res.body.getReader();
	const parts: Uint8Array[] = [];
	let got = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		parts.push(value);
		got += value.byteLength;
		onProgress(Math.min(1, got / total));
	}
	return new Blob(parts as BlobPart[], { type: res.headers.get("content-type") ?? "" });
}


/** A found clip of the free web or a keyed service (find_content stock's items, the same server search). */
interface WebClip {
	item: string;
	title: string;
	source: string;
	seconds?: number;
	width?: number;
	height?: number;
	mb?: number;
	license?: string;
	thumb?: string;
}

const CLIP_SOURCE: Record<string, string> = { pixabay: "Pixabay", pexels: "Pexels", commons: "Wikimedia Commons", archive: "Internet Archive" };

/** The source's name in a tile's corner (every result says where it came from). */
function SourceMark({ name }: { name: string }) {
	return (
		<span className="pointer-events-none absolute bottom-0.5 left-0.5 max-w-[calc(100%-4px)] truncate rounded-sm bg-black/60 px-1 text-[9px] leading-[14px] text-white" data-source-mark={name} data-no-translate>
			{name}
		</span>
	);
}

/** Pictures and clips from the web for the current search, by the source switch. One click adds one at the playhead. */
export function WebImages({ query }: { query: string }) {
	const t = useT();
	const editor = useEditor();
	const { pick } = useSearchSource("picture");
	const [clips, setClips] = useState<{ items: WebClip[]; notes: string[] } | null>(null);
	const [clipsLoading, setClipsLoading] = useState(false);
	const clipRequest = useRef(0);
	const [result, setResult] = useState<WebImageSearchResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [page, setPage] = useState(1);
	const q = query.trim();
	const requestId = useRef(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new search (or source) starts again from page 1
	useEffect(() => {
		setPage(1);
	}, [q, pick]);

	// Clips from the web: the same server search as the chat's find_content stock.
	useEffect(() => {
		if (q.length < 2 || pick === "library") {
			setClips(null);
			return;
		}
		const id = ++clipRequest.current;
		setClipsLoading(true);
		const timer = window.setTimeout(async () => {
			try {
				const c = editor.project.getActiveOrNull()?.settings.canvasSize;
				const res = await fetch(`/api/images/clips?q=${encodeURIComponent(q)}&vertical=${c && c.width > c.height ? 0 : 1}&source=${pick}`);
				const data = (await res.json()) as { items?: WebClip[]; notes?: string[]; error?: string };
				if (id === clipRequest.current) setClips({ items: data.items ?? [], notes: data.notes ?? (data.error ? [data.error] : []) });
			} catch {
				if (id === clipRequest.current) setClips({ items: [], notes: [] });
			} finally {
				if (id === clipRequest.current) setClipsLoading(false);
			}
		}, 600);
		return () => window.clearTimeout(timer);
	}, [q, pick, editor]);

	useEffect(() => {
		if (pick === "library") {
			setResult(null);
			setError(null);
			setLoading(false);
			return;
		}
		if (q.length < 2) {
			setResult(null);
			setError(null);
			return;
		}
		const id = ++requestId.current;
		setLoading(true);
		const t = window.setTimeout(async () => {
			try {
				const res = await fetch(`/api/images/search?q=${encodeURIComponent(q)}&page=${page}&source=${pick}`);
				const data = (await res.json()) as WebImageSearchResult & { error?: string };
				if (id !== requestId.current) return;
				if (!res.ok) throw new Error(data.error || "Image search failed — try again.");
				setResult((prev) => (page > 1 && prev ? { ...data, items: [...prev.items, ...data.items] } : data));
				setError(data.items.length ? null : (data.error ?? null));
			} catch (e) {
				if (id === requestId.current) setError(e instanceof Error ? e.message : "Image search failed — try again.");
			} finally {
				if (id === requestId.current) setLoading(false);
			}
		}, page > 1 ? 0 : 500);
		return () => window.clearTimeout(t);
	}, [q, page, pick]);

	// The picture is in Media the moment it is asked for (grey, its thumbnail), fills with colour as it downloads and goes
	// onto the timeline at the playhead when it lands; a failure stays there with a retry glyph. No toasts (the owner, 13.11).
	const add = async (image: WebImage, assetId = generateUUID()) => {
		const project = editor.project.getActiveOrNull();
		if (!project) return;
		const projectId = project.metadata.id;
		const at = editor.playback.getCurrentTime();
		const controller = new AbortController();
		const title = image.title.slice(0, 60).replace(/[/\\:]/g, " ");
		const jobId = jobCenter.start({
			id: `web-image:${assetId}`,
			kind: "other",
			title: image.title,
			tab: "media",
			progress: 0,
			place: { media: { assetId, projectId, name: `${title}.jpg`, type: "image", origin: "source", still: image.thumbUrl } },
			cancel: () => controller.abort(),
		});
		try {
			let res = await fetch(`/api/images/file?u=${encodeURIComponent(image.fullUrl)}`, { signal: controller.signal });
			if (!res.ok) res = await fetch(`/api/images/file?u=${encodeURIComponent(image.thumbUrl)}`, { signal: controller.signal });
			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(data?.error || "The image could not be downloaded.");
			}
			const blob = await readWithProgress(res, (f) => jobCenter.update(jobId, { progress: 0.9 * f }));
			jobCenter.update(jobId, { progress: 0.92, cancel: undefined });
			const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : blob.type.includes("gif") ? "gif" : "jpg";
			const name = `${title}.${ext}`;
			const [processed] = await processMediaAssets({ files: [new File([blob], name, { type: blob.type })] });
			if (!processed) throw new Error("The editor couldn't read this image.");
			const asset = await editor.media.addMediaAsset({
				projectId,
				asset: {
					...processed,
					id: assetId,
					origin: "source",
					attribution: { title: image.title, author: image.author, license: image.license, sourceUrl: image.sourceUrl },
				},
			});
			if (!asset) throw new Error("Not enough editor storage space — free some disk space and retry.");
			if (editor.project.getActiveOrNull()?.metadata.id === projectId) {
				editor.timeline.insertElement({
					element: buildElementFromMedia({
						mediaId: asset.id,
						mediaType: asset.type,
						name: asset.name,
						duration: stillDuration(),
						startTime: at,
					}),
					placement: { mode: "auto" },
				});
			}
			jobCenter.finish(jobId, creditLine(image));
		} catch (e) {
			if (controller.signal.aborted) {
				jobCenter.cancelled(jobId);
				return;
			}
			jobCenter.fail(jobId, e instanceof Error && e.message ? e.message : "The image could not be downloaded.");
			jobCenter.update(jobId, {
				retry: () => {
					jobCenter.remove(jobId);
					void add(image, assetId);
				},
			});
		}
	};

	// A clip: in Media at once (grey, its still), filled as it downloads, on the timeline at the playhead when it lands.
	const addClip = async (clip: WebClip, assetId = generateUUID()) => {
		const project = editor.project.getActiveOrNull();
		if (!project) return;
		const projectId = project.metadata.id;
		const at = editor.playback.getCurrentTime();
		const controller = new AbortController();
		const jobId = jobCenter.start({
			id: `web-clip:${assetId}`,
			kind: "other",
			title: clip.title,
			tab: "media",
			progress: 0,
			place: { media: { assetId, projectId, name: `${clip.title.slice(0, 60)}.mp4`, type: "video", origin: "source", ...(clip.thumb ? { still: clip.thumb } : {}) } },
			cancel: () => controller.abort(),
		});
		try {
			const res = await fetch(`/api/mcp/stock/file?item=${encodeURIComponent(clip.item.replace(/^stock:/, ""))}`, { headers: { "X-Studio": "1" }, signal: controller.signal });
			if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "The clip didn't download.");
			const blob = await readWithProgress(res, (f) => jobCenter.update(jobId, { progress: 0.9 * f }));
			jobCenter.update(jobId, { progress: 0.92, cancel: undefined });
			const license = res.headers.get("x-license") ?? clip.license ?? "free licence";
			const name = `${clip.title.slice(0, 60).replace(/[/\\:]/g, " ")}.${blob.type.includes("webm") ? "webm" : "mp4"}`;
			const [processed] = await processMediaAssets({ files: [new File([blob], name, { type: blob.type || "video/mp4" })] });
			if (!processed) throw new Error("The editor couldn't read this clip.");
			const source = CLIP_SOURCE[clip.source] ?? clip.source;
			const asset = await editor.media.addMediaAsset({ projectId, asset: { ...processed, id: assetId, origin: "source", attribution: { title: clip.title, author: license.split(" · ")[1] ?? source, license: license.split(" · ")[0], sourceUrl: license.split(" · ")[2] ?? "" } } });
			if (!asset) throw new Error("Not enough editor storage space — free some disk space and retry.");
			if (editor.project.getActiveOrNull()?.metadata.id === projectId) {
				editor.timeline.insertElement({
					element: buildElementFromMedia({ mediaId: asset.id, mediaType: asset.type, name: asset.name, duration: mediaTimeFromSeconds({ seconds: asset.duration ?? clip.seconds ?? 5 }), startTime: at }),
					placement: { mode: "auto" },
				});
			}
			jobCenter.finish(jobId, `${clip.title} · ${source}`);
		} catch (e) {
			if (controller.signal.aborted) {
				jobCenter.cancelled(jobId);
				return;
			}
			jobCenter.fail(jobId, e instanceof Error && e.message ? e.message : "The clip didn't download.");
			jobCenter.update(jobId, { retry: () => { jobCenter.remove(jobId); void addClip(clip, assetId); } });
		}
	};

	if (q.length < 2) return null;

	return (
		<div className="flex flex-col gap-2" data-testid="web-images">
			<h4 className="text-muted-foreground text-xs font-medium">From the web</h4>
			<SourceSwitch kinds={["picture", "video"]} />
			{pick !== "library" && result?.note && <p className="text-muted-foreground text-[10px]">{result.note}</p>}
			{error && <p className="text-destructive text-xs">{error}</p>}
			{pick !== "library" && !error && !loading && result && result.items.length === 0 && (
				<p className="text-muted-foreground text-xs">{t("No images for “{q}”. Try other words.", { q })}</p>
			)}
			<div style={materialGrid()} data-material-grid>
				{result?.items.map((image) => (
					<div key={image.id} className="group relative">
						<button
							type="button"
							title={`${creditLine(image)}\nDouble-click to add at the playhead`}
							{...tileActivation(() => add(image))}
				data-no-translate
							data-web-image={image.id}
							className="bg-accent relative aspect-square w-full overflow-hidden rounded-md"
						>
							{/* biome-ignore lint/performance/noImgElement: remote thumbnails, no optimisation server */}
							<img src={image.thumbUrl} alt={image.title} loading="lazy" className="size-full object-cover" />
							<SourceMark name={PROVIDER_NAME[image.provider] ?? image.provider} />
						</button>
						<TileAddButton onAdd={() => add(image)} />
					</div>
				))}
			</div>
			{loading && (
				<div className="text-muted-foreground flex items-center gap-2 text-xs">
					<Spinner className="size-3.5" /> Searching…
				</div>
			)}
			{!loading && result?.hasMore && (
				<Button variant="ghost" size="sm" className="self-start text-xs" onClick={() => setPage((p) => p + 1)}>
					More images
				</Button>
			)}
			{pick !== "library" && (clipsLoading || (clips && clips.items.length > 0)) && (
				<div className="flex flex-col gap-2" data-web-clips>
					<h4 className="text-muted-foreground text-xs font-medium">Clips from the web</h4>
					{clips && clips.items.length > 0 && (
						<div style={materialGrid()} data-material-grid>
							{clips.items.map((clip) => (
								<div key={clip.item} className="group relative">
									<button
										type="button"
										title={`${clip.title} · ${CLIP_SOURCE[clip.source] ?? clip.source}${clip.seconds ? ` · ${Math.round(clip.seconds)} s` : ""}${clip.license ? ` · ${clip.license}` : ""}\nDouble-click to add at the playhead`}
										{...tileActivation(() => addClip(clip))}
										data-no-translate
										data-web-clip={clip.item}
										className="bg-accent relative aspect-square w-full overflow-hidden rounded-md"
									>
										{clip.thumb ? (
											// biome-ignore lint/performance/noImgElement: remote stills, no optimisation server
											<img src={clip.thumb} alt={clip.title} loading="lazy" className="size-full object-cover" />
										) : (
											<span className="text-muted-foreground absolute inset-1 line-clamp-3 text-[10px]">{clip.title}</span>
										)}
										{clip.seconds ? <span className="pointer-events-none absolute top-0.5 right-0.5 rounded-sm bg-black/60 px-1 text-[9px] leading-[14px] text-white tabular-nums">{Math.round(clip.seconds)} s</span> : null}
										<SourceMark name={CLIP_SOURCE[clip.source] ?? clip.source} />
									</button>
									<TileAddButton onAdd={() => addClip(clip)} />
								</div>
							))}
						</div>
					)}
					{clipsLoading && (
						<div className="text-muted-foreground flex items-center gap-2 text-xs">
							<Spinner className="size-3.5" /> Searching…
						</div>
					)}
				</div>
			)}
		</div>
	);
}
