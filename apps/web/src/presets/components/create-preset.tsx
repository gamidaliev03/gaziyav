"use client";

// The "+" tile of the Text and Captions tabs: the user describes a look in their own words and Gaziyav AI makes it.
// The run outlives the popover and the tab: closing either doesn't stop Gaziyav AI, the tile spins again when the
// tab is back, and the new preset shows up when it is ready.
import { useState, type ReactNode } from "react";
import { create } from "zustand";
import { AgentAvatar } from "@/components/brand/point-mark";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/utils/ui";

interface Run {
	step: string | null;
	error: string | null;
	controller: AbortController | null;
}

const IDLE: Run = { step: null, error: null, controller: null };

/** Runs by tile ("text", "captions"), kept outside the components. */
const useRuns = create<{ runs: Record<string, Run>; set: (key: string, run: Partial<Run>) => void }>((set) => ({
	runs: {},
	set: (key, run) => set((state) => ({ runs: { ...state.runs, [key]: { ...(state.runs[key] ?? IDLE), ...run } } })),
}));

export function CreatePresetTile({
	runKey,
	label,
	placeholder,
	create,
	className,
	previewClassName,
}: {
	/** Which tile this is: its run is kept under this key. */
	runKey: string;
	label: string;
	placeholder: string;
	/** Makes the preset and saves it; `onStep` shows what Gaziyav AI is doing. */
	create: (args: { description: string; signal: AbortSignal; onStep: (step: string) => void }) => Promise<void>;
	className?: string;
	previewClassName?: string;
}) {
	const [open, setOpen] = useState(false);
	const [description, setDescription] = useState("");
	const { step, error, controller } = useRuns((state) => state.runs[runKey] ?? IDLE);
	const update = (run: Partial<Run>) => useRuns.getState().set(runKey, run);

	const start = async () => {
		const text = description.trim();
		if (!text || useRuns.getState().runs[runKey]?.controller) return;
		const next = new AbortController();
		update({ controller: next, error: null, step: "Gaziyav AI is working" });
		try {
			await create({ description: text, signal: next.signal, onStep: (step) => update({ step }) });
			setDescription("");
			setOpen(false);
		} catch (caught) {
			if ((caught as Error)?.name !== "AbortError") {
				update({ error: caught instanceof Error && caught.message ? caught.message : "Gaziyav AI couldn't make it. Try again." });
				setOpen(true);
			}
		} finally {
			update({ controller: null, step: null });
		}
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={label}
					title={label}
					data-create-preset
					className={cn("hover:border-foreground/40 flex flex-col items-center gap-1.5 rounded-md border border-dashed p-1.5 transition-colors", className)}
				>
					<div className={cn("text-muted-foreground flex w-full items-center justify-center rounded", previewClassName)}>
						{step ? <Spinner /> : <span className="text-2xl leading-none font-light">+</span>}
					</div>
					<Label>{step ? "Creating…" : label}</Label>
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="flex w-72 flex-col gap-2 p-3">
				<Textarea
					autoFocus
					data-keep-enter
					value={description}
					disabled={step !== null}
					placeholder={placeholder}
					onChange={(event) => setDescription(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
							event.preventDefault();
							void start();
						}
					}}
					className="min-h-20 resize-none text-sm"
				/>
				{error && <p className="text-destructive text-xs">{error}</p>}
				<div className="flex items-center gap-2">
					{step ? (
						<>
							<Spinner className="shrink-0" />
							<span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{step}</span>
							<Button type="button" variant="ghost" size="sm" onClick={() => controller?.abort()}>
								Cancel
							</Button>
						</>
					) : (
						<Button type="button" size="sm" className="ml-auto" disabled={!description.trim()} onClick={() => void start()}>
							<AgentAvatar className="mr-1 size-4" />
							Create
						</Button>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}

function Label({ children }: { children: ReactNode }) {
	return <span className="text-muted-foreground text-xs">{children}</span>;
}
