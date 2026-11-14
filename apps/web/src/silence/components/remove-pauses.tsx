"use client";
// «Remove pauses»: one click finds silences (and "uh/um") in the whole edit with the local recognizer and
// cuts them out as one undoable step. The list shows what was removed; unticking an item puts it back.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Section, SectionContent, SectionHeader, SectionTitle } from "@/components/section";
import { useEditor } from "@/editor/use-editor";
import type { SceneTracks } from "@/timeline";
import { engineStatus } from "@/transcribe/client";
import { transcribeTimeline } from "@/transcribe/timeline";
import { TICKS_PER_SECOND } from "@/wasm";
import { type Cut, DEFAULT_MIN_PAUSE, findCuts, totalLength } from "../detect";
import { applyCuts } from "../remove";
import { useT } from "@/i18n";

type State =
	| { phase: "idle"; error?: string; note?: string }
	| { phase: "working"; stage: string; progress?: number }
	| { phase: "applied"; cuts: Cut[]; enabled: boolean[] };

const fmtTime = (s: number) => {
	const m = Math.floor(s / 60);
	return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
};
const fmtLen = (s: number) => `${s.toFixed(1)} s`;

export function RemovePauses({ language = "auto" }: { language?: string }) {
	const t = useT();
	const editor = useEditor();
	const [state, setState] = useState<State>({ phase: "idle" });
	const [minPause, setMinPause] = useState(DEFAULT_MIN_PAUSE);
	const [fillers, setFillers] = useState(true);
	const [more, setMore] = useState(false);
	const controller = useRef<AbortController | null>(null);
	// Opening the Captions tab warms the recognizer up, so the first «Generate captions» is fast.
	useEffect(() => {
		void engineStatus();
	}, []);
	/** The timeline right after our edit: undo/re-apply only while nothing else changed it. */
	const applied = useRef<SceneTracks | null>(null);

	// ⌘Z (or any other edit) after the cut: the list no longer describes the timeline, so it closes.
	const tracksAreOurs = useEditor((e) => applied.current !== null && e.scenes.getActiveSceneOrNull()?.tracks === applied.current);
	useEffect(() => {
		if (state.phase === "applied" && !tracksAreOurs) {
			applied.current = null;
			setState({ phase: "idle" });
		}
	}, [tracksAreOurs, state.phase]);

	const stillOurs = () => applied.current !== null && editor.scenes.getActiveScene().tracks === applied.current;

	const apply = (cuts: Cut[]) => {
		applied.current = applyCuts(editor, cuts, TICKS_PER_SECOND);
	};

	const run = async () => {
		const ac = new AbortController();
		controller.current = ac;
		setState({ phase: "working", stage: "Listening for pauses" });
		try {
			const t = await transcribeTimeline({
				editor,
				language,
				wholeTimeline: true,
				signal: ac.signal,
				title: "Finding pauses",
				onProgress: (stage, progress) => setState({ phase: "working", stage, progress }),
			});
			const cuts = findCuts({ words: t.words, speech: t.speech, duration: t.to, minPause, fillers });
			if (cuts.length === 0) {
				setState({ phase: "idle", note: `No pauses longer than ${minPause.toFixed(2)} s.` });
				return;
			}
			apply(cuts);
			setState({ phase: "applied", cuts, enabled: cuts.map(() => true) });
		} catch (error) {
			if ((error as Error)?.name === "AbortError") setState({ phase: "idle" });
			else setState({ phase: "idle", error: (error as Error)?.message || "Could not remove pauses. Try again." });
		} finally {
			controller.current = null;
		}
	};

	const toggle = (index: number) => {
		if (state.phase !== "applied") return;
		if (!stillOurs()) {
			setState({ phase: "idle", note: "The timeline changed since then. Use ⌘Z to undo the cut." });
			return;
		}
		const enabled = state.enabled.map((v, i) => (i === index ? !v : v));
		editor.command.undo();
		applied.current = null;
		const chosen = state.cuts.filter((_, i) => enabled[i]);
		if (chosen.length) apply(chosen);
		setState({ ...state, enabled });
	};

	const restore = () => {
		if (stillOurs()) editor.command.undo();
		applied.current = null;
		setState({ phase: "idle" });
	};

	const working = state.phase === "working";
	const chosen = state.phase === "applied" ? state.cuts.filter((_, i) => state.enabled[i]) : [];

	return (
		<Section showTopBorder showBottomBorder={false}>
			<SectionHeader>
				<SectionTitle>Pauses</SectionTitle>
			</SectionHeader>
			<SectionContent className="flex flex-col gap-3">
				<div className="flex gap-2">
					<Button type="button" variant="outline" className="flex-1" onClick={run} disabled={working}>
						{working && <Spinner className="mr-1" />}
						{working
							? `${state.stage}${state.progress != null && state.progress > 0 ? ` ${Math.round(state.progress * 100)}%` : ""}`
							: "Remove pauses"}
					</Button>
					{working && (
						<Button type="button" variant="ghost" onClick={() => controller.current?.abort()}>
							Cancel
						</Button>
					)}
				</div>

				<button
					type="button"
					className="text-muted-foreground hover:text-foreground self-start text-xs"
					onClick={() => setMore((v) => !v)}
				>
					{more ? "Less" : "More"}
				</button>
				{more && (
					<div className="flex flex-col gap-3">
						<div className="flex flex-col gap-1.5">
							<div className="flex justify-between text-xs">
								<span>Pauses longer than</span>
								<span className="text-muted-foreground">{minPause.toFixed(2)} s</span>
							</div>
							<Slider min={0.2} max={1.5} step={0.05} value={[minPause]} onValueChange={([v]) => setMinPause(v)} />
						</div>
						<label className="flex items-center gap-2 text-xs">
							<Checkbox checked={fillers} onCheckedChange={(v) => setFillers(v === true)} />
							Also cut “uh”, “um”, “э”
						</label>
					</div>
				)}

				{state.phase === "idle" && state.error && (
					<div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
						<p className="text-destructive text-sm">{state.error}</p>
					</div>
				)}
				{state.phase === "idle" && state.note && <p className="text-muted-foreground text-xs">{state.note}</p>}

				{state.phase === "applied" && (
					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between text-xs">
							<span>
								{t("Removed {n} of {total} · {length}", { n: chosen.length, total: state.cuts.length, length: fmtLen(totalLength(chosen)) })}
							</span>
							<Button type="button" variant="ghost" size="sm" onClick={restore}>
								Undo
							</Button>
						</div>
						<ul className="max-h-48 overflow-y-auto rounded-md border text-xs" data-testid="pause-list">
							{state.cuts.map((c, i) => (
								<li key={`${c.start}-${c.end}`} className="flex items-center gap-2 border-b px-2 py-1 last:border-b-0">
									<Checkbox checked={state.enabled[i]} onCheckedChange={() => toggle(i)} />
									<span className="text-muted-foreground w-12 tabular-nums">{fmtTime(c.start)}</span>
									<span className="flex-1">{c.kind === "filler" ? `“${c.text ?? "uh"}”` : "Pause"}</span>
									<span className="text-muted-foreground tabular-nums">{fmtLen(c.end - c.start)}</span>
								</li>
							))}
						</ul>
					</div>
				)}
			</SectionContent>
		</Section>
	);
}
