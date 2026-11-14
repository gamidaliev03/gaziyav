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
import { creditLine, type WebImage, type WebImageSearchResult } from "@/media/web-images/types";
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


/** Web images for the current search (Wikimedia Commons). One click adds the image at the playhead. */
export function WebImages({ query }: { query: string }) {
	const t = useT();
	const editor = useEditor();
	const [result, setResult] = useState<WebImageSearchResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [page, setPage] = useState(1);
	const q = query.trim();
	const requestId = useRef(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new search starts again from page 1
	useEffect(() => {
		setPage(1);
	}, [q]);

	useEffect(() => {
		if (q.length < 2) {
			setResult(null);
			setError(null);
			return;
		}
		const id = ++requestId.current;
		setLoading(true);
		const t = window.setTimeout(async () => {
			try {
				const res = await fetch(`/api/images/search?q=${encodeURIComponent(q)}&page=${page}`);
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
	}, [q, page]);

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

	if (q.length < 2) return null;

	return (
		<div className="flex flex-col gap-2" data-testid="web-images">
			<div className="flex items-center justify-between">
				<h4 className="text-muted-foreground text-xs font-medium">Images from the web</h4>
				<span className="text-muted-foreground text-[10px]">
					Wikimedia Commons
				</span>
			</div>
			{error && <p className="text-destructive text-xs">{error}</p>}
			{!error && !loading && result && result.items.length === 0 && (
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
		</div>
	);
}
