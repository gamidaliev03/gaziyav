"use client";

// One voice picker wherever a voice is chosen (Text to speech, Voice changer, Video translator, the Lipsync voice),
// as CapCut's Text to speech: category chips on top, then ONE grid of the same square cards. A click picks the voice
// and plays its sample (a click on the card that is playing stops it); ▶ only plays or stops; one sample at a time.
import { PlayIcon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { useLang, useT } from "@/i18n";
import { trendSampleUrl, trendVoicesFor } from "@/trending/voices";
import { cn } from "@/utils/ui";
import { VOICES } from "../voices";

export type VoiceGroup = "trending" | "narration" | "character" | "female" | "male" | "mine" | "filters";

export interface VoiceCard {
	id: string;
	name: string;
	/** What it sounds like (on hover). */
	hint?: string;
	/** Its sample (a URL), or null when there is none yet. */
	sample: string | null;
	groups: VoiceGroup[];
}

// CapCut's chip names (Text to speech: Trending, Narration, Character, Female); All first, then ours.
const CHIPS: Array<{ key: "all" | VoiceGroup; label: string }> = [
	{ key: "all", label: "All" },
	{ key: "filters", label: "Voice effects" },
	{ key: "trending", label: "Trending" },
	{ key: "narration", label: "Narration" },
	{ key: "character", label: "Character" },
	{ key: "female", label: "Female" },
	{ key: "male", label: "Male" },
	{ key: "mine", label: "My voices" },
];

const FEMALE = new Set(["vivian", "serena", "ono_anna", "sohee"]);
const NARRATION = new Set(["ryan", "eric", "uncle_fu", "serena", "narrator", "trailer", "news"]);
const CHARACTER = new Set(["dylan", "ono_anna", "chipmunk", "robot", "demon", "asmr"]);
const groupsOf = (id: string, speaker: string, extra: VoiceGroup[] = []): VoiceGroup[] => [
	...extra,
	...(NARRATION.has(id) ? (["narration"] as const) : []),
	...(CHARACTER.has(id) ? (["character"] as const) : []),
	FEMALE.has(speaker) ? "female" : "male",
];

/** The ready voices of the voice model (Resources/voices). */
export const readyCards = (): VoiceCard[] =>
	VOICES.map((v) => ({ id: v.id, name: v.name, hint: v.tone, sample: `/api/voice-sample/${v.id}`, groups: groupsOf(v.id, v.id) }));

/** The trending looks (a ready voice + its sound), `trend:<id>`: names in the interface's language, the sample in the
 * text's (Russian or English). */
export function trendCards(ui: "en" | "ru", sample: "en" | "ru" = ui): VoiceCard[] {
	return trendVoicesFor(ui).map((v) => ({ id: `trend:${v.id}`, name: v.label, hint: v.line, sample: trendSampleUrl(v.id, sample), groups: groupsOf(v.id, v.speaker, ["trending"]) }));
}

/** «My voices» (cloned on this Mac), `local:<id>`. */
export const myCards = (voices: Array<{ id: string; name: string; seconds?: number }>): VoiceCard[] =>
	voices.map((v) => ({ id: v.id, name: v.name, hint: "My voice", sample: `/api/voice-sample/${encodeURIComponent(v.id)}`, groups: ["mine"] }));

// ── one sample at a time, shared by every picker ──
const usePlaying = create<{ id: string | null }>(() => ({ id: null }));
let player: HTMLAudioElement | null = null;

export function stopSample() {
	player?.pause();
	player = null;
	usePlaying.setState({ id: null });
}

function playSample(card: VoiceCard) {
	const was = usePlaying.getState().id;
	stopSample();
	if (was === card.id || !card.sample) return;
	const audio = new Audio(card.sample);
	player = audio;
	// The tests listen to it (currentTime grows while it plays).
	(window as unknown as { __voiceSample?: HTMLAudioElement }).__voiceSample = audio;
	const end = () => {
		if (player === audio) usePlaying.setState({ id: null });
	};
	audio.onended = end;
	audio.onerror = end;
	usePlaying.setState({ id: card.id });
	void audio.play().catch(end);
}

export function VoicePicker({
	cards,
	value,
	onPick,
	onAdd,
	onRemove,
	first = "all",
	label,
}: {
	cards: VoiceCard[];
	value: string;
	onPick: (id: string) => void;
	/** «＋ Your voice»: shown in All and My voices. */
	onAdd?: () => void;
	onRemove?: (id: string) => void;
	/** The chip picked at first. */
	first?: "all" | VoiceGroup;
	label?: string;
}) {
	const t = useT();
	const playing = usePlaying((s) => s.id);
	const [chip, setChip] = useState<"all" | VoiceGroup>(first);
	useEffect(() => () => stopSample(), []);
	const chips = useMemo(() => CHIPS.filter((c) => c.key === "all" || cards.some((v) => v.groups.includes(c.key as VoiceGroup)) || (c.key === "mine" && onAdd)), [cards, onAdd]);
	const shown = chip === "all" ? cards : cards.filter((v) => v.groups.includes(chip));
	const tile = "relative aspect-square min-w-0";
	return (
		<div className="flex flex-col gap-2" data-voice-picker={label ?? ""}>
			<fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0" aria-label={t("Voice categories")}>
				{chips.map((c) => (
					<button
						key={c.key}
						type="button"
						data-voice-filter={c.key}
						aria-pressed={chip === c.key}
						onClick={() => setChip(c.key)}
						className={cn("h-6 rounded-full px-2.5 text-[11px] font-medium transition-colors", chip === c.key ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")}
					>
						{t(c.label)}
					</button>
				))}
			</fieldset>
			<div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }} data-voice-grid>
				{shown.map((v) => {
					const picked = value === v.id;
					const sounding = playing === v.id;
					return (
						<div key={v.id} className={cn(tile, "group")}>
							<button
								type="button"
								data-voice-card={v.id}
								aria-pressed={picked}
								data-playing={sounding || undefined}
								title={v.hint ? `${v.name} — ${t(v.hint)}` : v.name}
								onClick={() => {
									onPick(v.id);
									playSample(v);
								}}
								className={cn(
									"absolute inset-0 flex items-center justify-center rounded-md border-2 bg-muted/50 px-1.5 text-center transition-colors",
									picked ? "border-primary bg-primary/10" : "border-transparent hover:bg-accent",
								)}
							>
								<span className="line-clamp-2 text-xs leading-tight font-medium" data-no-translate>
									{v.name}
								</span>
							</button>
							<button
								type="button"
								data-voice-play={v.id}
								aria-label={sounding ? t("Stop") : t("Play")}
								disabled={!v.sample}
								onClick={() => playSample(v)}
								className={cn(
									"absolute bottom-1 left-1 grid size-5 place-items-center rounded-full transition-colors disabled:opacity-30",
									sounding ? "bg-primary text-primary-foreground" : "bg-background/80 text-muted-foreground hover:text-foreground",
								)}
							>
								<HugeiconsIcon icon={sounding ? StopIcon : PlayIcon} className="size-2.5" />
							</button>
							{onRemove && v.groups.includes("mine") && (
								<button
									type="button"
									data-voice-remove={v.id}
									title={t("Remove this voice")}
									aria-label={t("Remove this voice")}
									onClick={() => onRemove(v.id)}
									className={cn("text-muted-foreground hover:text-foreground absolute top-0.5 right-1 text-xs", picked ? "block" : "hidden group-hover:block")}
								>
									×
								</button>
							)}
						</div>
					);
				})}
				{onAdd && (chip === "all" || chip === "mine") && (
					<div className={tile}>
						<button
							type="button"
							data-testid="my-voices-add"
							onClick={onAdd}
							className="border-border hover:bg-accent absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-md border border-dashed px-1.5 text-center"
						>
							<span className="text-base leading-none">＋</span>
							<span className="text-xs leading-tight font-medium">{t("Your voice")}</span>
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

/** The interface's language, and the samples' (the typed text's language, else the interface's). */
export function useVoiceLang(text = ""): { ui: "en" | "ru"; sample: "en" | "ru" } {
	const ui = useLang((s) => s.lang);
	return { ui, sample: text.trim() ? (/[а-яё]/i.test(text) ? "ru" : "en") : ui };
}
