"use client";

// Inspector → AI → Face swap: a trending look on the person's own face, one of the app's made-up faces, or one of «My
// faces» (photos of people who agreed to it, kept for every project; «+» adds another, × removes one).
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@/components/ui/icon";
import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { registerInspectorSection } from "@/components/editor/panels/properties/slots";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { TimelineElement } from "@/timeline";
import { cn } from "@/utils/ui";
import { useEditor } from "@/editor/use-editor";
import { falChoice, useFal } from "@/fal/client";
import { price, usd } from "@/fal/models";
import { TICKS_PER_SECOND } from "@/wasm";
import { faceUrl, useMyFaces } from "./my-faces";
import { FACES, faceSwapClip, swapPiece, useFaceSwapStore } from "./run";
import { TrendLabel } from "@/trending/components/trend-voices";
import { useLang, useT } from "@/i18n";

registerInspectorSection({
	id: "faceswap",
	tab: "ai",
	title: "Face swap",
	order: 150,
	appliesTo: (element) => element.type === "video",
	render: ({ element }) => <FaceSwapSection element={element} />,
});

function FaceSwapSection({ element }: { element: TimelineElement }) {
	const running = useFaceSwapStore((s) => s.running[element.id]);
	// Runs on fal.ai: without a key the button is off with one line saying where the key goes.
	const fal = useFal((s) => s.status);
	useEffect(() => {
		if (!useFal.getState().status) void useFal.getState().refresh();
	}, []);
	// With only a kie.ai key it says why: face swap is fal's alone.
	const unsupported = fal && !fal.key ? (fal.kie.key ? "Face swap isn't on kie.ai: it runs on fal.ai. Add a fal.ai key in Settings → AI." : "Add your fal.ai key in Settings → AI (fal.ai) to swap faces.") : undefined;
	const [pick, setPick] = useState<string>("hero");
	const [consent, setConsent] = useState(false);
	const [adding, setAdding] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);
	const mine = useMyFaces((s) => s.faces);
	const myFace = pick.startsWith("my:") ? mine.find((f) => f.id === pick.slice(3)) : undefined;
	const own = !!myFace;
	const look = pick.startsWith("look:") ? pick.slice(5) : null;
	const ui = useLang((s) => s.lang);
	const t = useT();

	useEffect(() => {
		if (!useMyFaces.getState().loaded) void useMyFaces.getState().refresh().catch(() => {});
	}, []);

	const addPhoto = async (file: File | undefined) => {
		if (!file) return;
		setAdding(true);
		try {
			const face = await useMyFaces.getState().add(file);
			setPick(`my:${face.id}`);
			setConsent(false);
		} catch (error) {
			toast.error((error as Error).message);
		} finally {
			setAdding(false);
		}
	};
	const removeFace = (id: string) => {
		if (pick === `my:${id}`) setPick("hero");
		void useMyFaces.getState().remove(id).catch((error) => toast.error((error as Error).message));
	};

	// The piece that goes (the visible part and its handles), priced before the press: PixVerse doubles past 5 s.
	const visible = element.duration / TICKS_PER_SECOND;
	const from = ((element as { trimStart?: number }).trimStart ?? 0) / TICKS_PER_SECOND;
	const source = useEditor((e) => e.media.getAssets().find((a) => a.id === (element as { mediaId?: string }).mediaId)?.duration);
	const piece = swapPiece(from, from + visible, source ?? Number.POSITIVE_INFINITY);
	const cost = usd(price(falChoice("faceswap"), piece.to - piece.from));
	const run = () => void faceSwapClip(element.id, look ? { look } : myFace ? { myFace: myFace.id, name: myFace.name, consent } : { preset: pick });

	return (
		<div className="flex flex-col gap-3" data-faceswap>
			<TrendLabel>Faces</TrendLabel>
			<div className="-mt-1.5 grid grid-cols-5 gap-2">
				{FACES.map((f) => (
					<button
						key={f.id}
						type="button"
						title={f.name}
						aria-label={f.name}
						data-face={f.id}
						onClick={() => setPick(f.id)}
						className={cn(
							"aspect-square overflow-hidden rounded-full ring-2 ring-offset-2 ring-offset-background transition-all duration-150",
							pick === f.id ? "ring-primary scale-105" : "ring-transparent opacity-80 hover:opacity-100",
						)}
					>
						{/* biome-ignore lint/performance/noImgElement: a small tile the app ships (public/faces); nothing for next/image to do */}
						<img src={`/faces/${f.id}.thumb.jpg`} alt="" className="size-full object-cover" draggable={false} />
					</button>
				))}
				{mine.map((f) => (
					<div key={f.id} className="group relative">
						<button
							type="button"
							title={f.name}
							aria-label={f.name}
							data-my-face={f.id}
							onClick={() => {
								setPick(`my:${f.id}`);
								setConsent(false);
							}}
							className={cn(
								"block aspect-square w-full overflow-hidden rounded-full ring-2 ring-offset-2 ring-offset-background transition-all duration-150",
								pick === `my:${f.id}` ? "ring-primary scale-105" : "ring-transparent opacity-80 hover:opacity-100",
							)}
						>
							{/* biome-ignore lint/performance/noImgElement: served by the app's own local server (/api/faces), offline — next/image can't optimize it */}
							<img src={faceUrl(f.id)} alt="" className="size-full object-cover" draggable={false} />
						</button>
						<button
							type="button"
							title={t("Remove from My faces")}
							aria-label={t("Remove from My faces")}
							data-my-face-remove={f.id}
							onClick={() => removeFace(f.id)}
							className={cn(
								"bg-background/90 text-muted-foreground hover:text-foreground absolute -top-1 -right-1 size-4 place-items-center rounded-full border",
								// the picked face always shows it (also without a mouse); the others on hover
								pick === `my:${f.id}` ? "grid" : "hidden group-hover:grid",
							)}
						>
							<HugeiconsIcon icon={Cancel01Icon} className="size-2.5" />
						</button>
					</div>
				))}
				{/* Always there: another face can be added at any time (the first one doesn't take its place). */}
				<button
					type="button"
					title={t("Add a face (a photo of someone who agreed)")}
					aria-label={t("Add a face")}
					data-face="add"
					disabled={adding}
					onClick={() => fileRef.current?.click()}
					className="border-border text-muted-foreground hover:text-foreground grid aspect-square place-items-center overflow-hidden rounded-full border border-dashed transition-all duration-150"
				>
					<HugeiconsIcon icon={Add01Icon} className="size-4" />
				</button>
				<input
					ref={fileRef}
					type="file"
					accept="image/*"
					className="hidden"
					onChange={(e) => {
						void addPhoto(e.target.files?.[0]);
						e.target.value = "";
					}}
				/>
			</div>
			{own && (
				<label htmlFor="faceswap-consent" className="text-muted-foreground flex items-start gap-2 text-xs leading-snug">
					<Checkbox id="faceswap-consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-px" data-faceswap-consent />
					This person agreed to have their face used
				</label>
			)}
			{unsupported && (
				<div className="text-muted-foreground text-xs" data-faceswap-unsupported>
					{unsupported}
				</div>
			)}
			{running ? (
				<div className="bg-muted relative h-8 overflow-hidden rounded-md" data-faceswap-running>
					<div className="bg-primary/25 absolute inset-y-0 left-0 transition-[width] duration-300" style={{ width: `${Math.round(running.progress * 100)}%` }} />
					<div className="relative flex h-full items-center justify-between px-3 text-xs">
						<span className="truncate">{running.stage}</span>
						<button type="button" aria-label="Cancel" className="text-muted-foreground hover:text-foreground" onClick={running.cancel}>
							<HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
						</button>
					</div>
				</div>
			) : (
				<Button size="sm" className="w-full" disabled={(own && !consent) || !!unsupported} onClick={run} data-faceswap-run>
					{look ? t("Apply look") : t("Swap face")}
					<span className="ml-1.5 tabular-nums opacity-75" data-faceswap-price>
						≈ {cost}
					</span>
				</Button>
			)}
		</div>
	);
}
