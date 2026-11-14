"use client";

// Inspector → Fix → Remove objects (CleanUp): on the frame at the playhead, click the object (⌥-click: keep this) or paint over it; the
// outline shows in red; Remove takes it out of the whole clip (or the photo) on this Mac.
import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@/components/ui/icon";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { registerInspectorSection } from "@/components/editor/panels/properties/slots";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { EditorCore } from "@/core";
import { useT } from "@/i18n";
import type { TimelineElement } from "@/timeline";
import { cn } from "@/utils/ui";
import { type CleanupMarks, cleanupClip, locate, markedSecond, previewObject, useCleanupStore } from "./run";

registerInspectorSection({
	id: "cleanup",
	tab: "fix",
	title: "Remove objects",
	order: 400,
	appliesTo: (element) => element.type === "video" || element.type === "image",
	render: ({ element }) => <CleanupSection element={element} />,
});

function CleanupSection({ element }: { element: TimelineElement }) {
	const running = useCleanupStore((s) => s.running[element.id]);
	const [open, setOpen] = useState(false);
	const t = useT();
	return (
		<div className="flex flex-col gap-2" data-cleanup>
			{running ? (
				<div className="bg-muted relative h-8 overflow-hidden rounded-md" data-cleanup-running>
					<div className="bg-primary/25 absolute inset-y-0 left-0 transition-[width] duration-300" style={{ width: `${Math.round(running.progress * 100)}%` }} />
					<div className="relative flex h-full items-center justify-between px-3 text-xs">
						<span className="truncate">{running.stage}</span>
						<button type="button" aria-label="Cancel" className="text-muted-foreground hover:text-foreground" onClick={running.cancel}>
							<HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
						</button>
					</div>
				</div>
			) : (
				<Button size="sm" variant="outline" className="w-full" title={t("Remove a person, a logo or a caption; the background is filled in. Free, on this Mac.")} onClick={() => setOpen(true)} data-cleanup-open>
					{t("Remove an object…")}
				</Button>
			)}
			{open && <CleanupDialog elementId={element.id} onClose={() => setOpen(false)} />}
		</div>
	);
}

type Mode = "click" | "brush";

/** The frame the user marks: the clip's picture at the playhead (or the photo), drawn into a canvas. */
async function grabFrame(elementId: string): Promise<{ canvas: HTMLCanvasElement; at: number } | null> {
	const editor = EditorCore.getInstance();
	const found = locate(editor, elementId);
	const asset = found ? editor.media.getAssets().find((a) => a.id === found.clip.mediaId) : undefined;
	if (!found || !asset?.file) return null;
	const at = markedSecond(editor, found.clip);
	const url = URL.createObjectURL(asset.file);
	try {
		const source: HTMLVideoElement | HTMLImageElement = await new Promise((resolve, reject) => {
			if (found.clip.type === "image") {
				const img = new Image();
				img.onload = () => resolve(img);
				img.onerror = () => reject(new Error("Couldn't read the photo"));
				img.src = url;
				return;
			}
			const v = document.createElement("video");
			v.muted = true;
			v.preload = "auto";
			v.onloadeddata = () => {
				v.onseeked = () => resolve(v);
				v.currentTime = Math.min(at, Math.max(0, v.duration - 0.05));
			};
			v.onerror = () => reject(new Error("Couldn't read the clip"));
			v.src = url;
		});
		const w = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
		const h = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		canvas.getContext("2d")?.drawImage(source, 0, 0, w, h);
		return { canvas, at };
	} finally {
		URL.revokeObjectURL(url);
	}
}

function CleanupDialog({ elementId, onClose }: { elementId: string; onClose: () => void }) {
	const [frame, setFrame] = useState<{ src: string; w: number; h: number; at: number } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [mode, setMode] = useState<Mode>("click");
	const [points, setPoints] = useState<CleanupMarks["points"]>([]);
	const [painted, setPainted] = useState(false);
	const [outline, setOutline] = useState<{ url: string; area: number } | null>(null);
	const [busy, setBusy] = useState(false);
	const [stage, setStage] = useState("");
	const brush = useRef<HTMLCanvasElement | null>(null);
	const view = useRef<HTMLCanvasElement>(null);
	const drawing = useRef(false);
	const t = useT();

	useEffect(() => {
		let live = true;
		grabFrame(elementId)
			.then((f) => {
				if (!live) return;
				if (!f) return setError("This clip's file is missing from the project");
				setFrame({ src: f.canvas.toDataURL("image/jpeg", 0.85), w: f.canvas.width, h: f.canvas.height, at: f.at });
				const b = document.createElement("canvas");
				b.width = f.canvas.width;
				b.height = f.canvas.height;
				brush.current = b;
			})
			.catch((e: Error) => live && setError(e.message));
		return () => {
			live = false;
		};
	}, [elementId]);

	// The brush layer shown over the frame (semi-transparent white).
	const redraw = () => {
		const v = view.current;
		const b = brush.current;
		if (!v || !b) return;
		const ctx = v.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, v.width, v.height);
		ctx.globalAlpha = 0.5;
		ctx.drawImage(b, 0, 0, v.width, v.height);
		ctx.globalAlpha = 1;
	};

	const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const r = e.currentTarget.getBoundingClientRect();
		return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
	};
	const paint = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const b = brush.current;
		const ctx = b?.getContext("2d");
		if (!b || !ctx) return;
		const { x, y } = pos(e);
		ctx.fillStyle = "#fff";
		ctx.beginPath();
		ctx.arc(x * b.width, y * b.height, Math.max(8, b.width * 0.025), 0, Math.PI * 2);
		ctx.fill();
		setPainted(true);
		redraw();
	};

	const marks = (): CleanupMarks => ({ at: frame?.at ?? 0, points, brush: null });
	const withBrush = async (): Promise<CleanupMarks> => {
		const b = brush.current;
		if (!painted || !b) return marks();
		const blob = await new Promise<Blob | null>((r) => b.toBlob(r, "image/png"));
		return { ...marks(), brush: blob };
	};

	const showOutline = async () => {
		setBusy(true);
		setError(null);
		setStage("");
		try {
			setOutline(await previewObject(elementId, await withBrush(), setStage));
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
			setStage("");
		}
	};

	const remove = async () => {
		const m = await withBrush();
		onClose();
		void cleanupClip(elementId, m);
	};

	const marked = points.some((p) => p[2] === 1) || painted;

	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="max-w-3xl" data-cleanup-dialog>
				<DialogHeader>
					<DialogTitle>CleanUp</DialogTitle>
					<DialogDescription>
						{t("Click the object to remove (⌥-click: keep this part) or paint over it. In a clip it is followed in every frame.")}
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="flex flex-col gap-3">
					<div className="flex gap-1.5">
						{(["click", "brush"] as const).map((m) => (
							<Button key={m} size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)} data-cleanup-mode={m}>
								{m === "click" ? t("Click the object") : t("Brush")}
							</Button>
						))}
						<Button
							size="sm"
							variant="ghost"
							disabled={!marked}
							onClick={() => {
								setPoints([]);
								setPainted(false);
								setOutline(null);
								brush.current?.getContext("2d")?.clearRect(0, 0, brush.current.width, brush.current.height);
								redraw();
							}}
						>
							{t("Clear")}
						</Button>
					</div>
					{error && <p className="text-destructive text-xs">{error}</p>}
					{!frame ? (
						<div className="text-muted-foreground flex h-64 items-center justify-center gap-2 text-sm">{!error && <Spinner className="size-4" />}{t("Getting the frame…")}</div>
					) : (
						<div className="relative mx-auto max-h-[60vh] overflow-hidden rounded-md" style={{ aspectRatio: `${frame.w} / ${frame.h}` }}>
							<img src={frame.src} alt="" className="size-full object-contain select-none" draggable={false} />
							{outline && <img src={outline.url} alt="" className="pointer-events-none absolute inset-0 size-full opacity-45 mix-blend-screen [filter:sepia(1)_saturate(8)_hue-rotate(-50deg)]" />}
							<canvas
								ref={view}
								width={frame.w}
								height={frame.h}
								className={cn("absolute inset-0 size-full", mode === "brush" ? "cursor-crosshair" : "cursor-pointer")}
								data-cleanup-canvas
								onPointerDown={(e) => {
									if (mode === "brush") {
										drawing.current = true;
										e.currentTarget.setPointerCapture(e.pointerId);
										paint(e);
										return;
									}
									const { x, y } = pos(e);
									setPoints((p) => [...p, [x, y, e.altKey ? 0 : 1]]);
									setOutline(null);
								}}
								onPointerMove={(e) => drawing.current && paint(e)}
								onPointerUp={() => {
									drawing.current = false;
									setOutline(null);
								}}
							/>
							{points.map(([x, y, l], i) => (
								<span
									// biome-ignore lint/suspicious/noArrayIndexKey: clicks in order
									key={i}
									className={cn("pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white", l ? "bg-red-500" : "bg-emerald-500")}
									style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
								/>
							))}
						</div>
					)}
				</DialogBody>
				<DialogFooter>
					{busy && stage && (
						<span className="text-muted-foreground mr-auto self-center truncate text-xs" data-cleanup-stage>
							{stage}
						</span>
					)}
					<Button size="sm" variant="outline" disabled={!marked || busy || !frame} onClick={() => void showOutline()} data-cleanup-preview>
						{busy && <Spinner className="size-3" />}{t("Show the outline")}
					</Button>
					<Button size="sm" disabled={!marked || !frame} onClick={() => void remove()} data-cleanup-run>
						{t("Remove")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
