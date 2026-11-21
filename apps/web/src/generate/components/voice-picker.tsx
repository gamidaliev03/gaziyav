"use client";

// One voice picker wherever a voice is chosen (Text to speech, Voice changer, Video translator, the Lipsync voice), and
// it is the editor's own list: a labelled field with the voices grouped (My voices · Trending · Ready voices · Voice
// effects) and, beside it, ▶ for the chosen voice's sample and × to remove one of «My voices» (the owner, 17.11:
// «убрать плиточки голосов и оставить вызывающийся список» — one system, one style, as the Lipsync panel has).
import { Cancel01Icon, PlayIcon, StopIcon, VoiceIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { t, useLang, useT } from "@/i18n";
import { trendSampleUrl, trendVoicesFor } from "@/trending/voices";
import { VOICES } from "../voices";
import { EditorCore } from "@/core";
import { registerAudioPreview } from "@/preview/audio-focus";

export type VoiceGroup = "trending" | "narration" | "character" | "female" | "male" | "mine" | "filters" | "service" | "clip";

export interface VoiceCard {
	id: string;
	name: string;
	/** What it sounds like (one line under the name in the list). */
	hint?: string;
	/** Its sample (a URL), or null when there is none yet. */
	sample: string | null;
	groups: VoiceGroup[];
	/** A service's voice (Settings → Services): its service's name, and whether its key is in. */
	service?: { id: string; name: string; ready: boolean; key?: string };
}

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

/** «My voices» (cloned on this Mac), `local:<key>`: the key is what a voice-over speaks with. */
export const myCards = (voices: Array<{ id: string; name: string; seconds?: number }>): VoiceCard[] =>
	voices.map((v) => ({ id: v.id, name: v.name, hint: "My voice", sample: `/api/voice-sample/${encodeURIComponent(v.id)}`, groups: ["mine"] }));

// ── one sample at a time, shared by every picker ──
const usePlaying = create<{ id: string | null }>(() => ({ id: null }));
// The timeline starting to play stops this sample (preview/audio-focus.ts).
registerAudioPreview(stopSample);
let player: HTMLAudioElement | null = null;

export function stopSample() {
	player?.pause();
	player = null;
	usePlaying.setState({ id: null });
}

function playSample(card: VoiceCard | undefined) {
	const was = usePlaying.getState().id;
	// One sound at a time: the timeline stops for a voice sample, and the sample stops when the timeline starts.
	try {
		const playback = EditorCore.getInstance().playback;
		if (playback.getIsPlaying()) playback.pause();
	} catch {}
	stopSample();
	if (!card || was === card.id || !card.sample) return;
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

/**
 * The list's groups, in the order a person means them: this clip's own voice, his clones, the looks, the plain voices,
 * then each service's (one group per key route; a route with no key yet is listed apart, its voices greyed).
 */
export function useVoiceGroups(cards: VoiceCard[]) {
	const t = useT();
	return useMemo(() => {
		const of = (key: VoiceGroup) => cards.filter((c) => c.groups.includes(key));
		const mine = of("mine");
		const trend = of("trending");
		const effects = of("filters");
		const clip = of("clip");
		const ready = cards.filter((c) => !c.groups.includes("mine") && !c.groups.includes("trending") && !c.groups.includes("filters") && !c.groups.includes("service") && !c.groups.includes("clip"));
		// The services' voices after Gaziyav's own, one group per service (the ones with a key first).
		const services = new Map<string, { name: string; ready: boolean; key: string; items: VoiceCard[] }>();
		for (const c of cards) {
			if (!c.service) continue;
			const g = services.get(c.service.id) ?? { name: c.service.name, ready: c.service.ready, key: c.service.key ?? c.service.name, items: [] };
			g.items.push(c);
			services.set(c.service.id, g);
		}
		const serviceGroups = [...services.entries()]
			.sort((a, b) => Number(b[1].ready) - Number(a[1].ready))
			.map(([id, g]) => ({ key: `service:${id}`, label: g.ready ? g.name : `${g.name} · ${t("needs a {key} key", { key: g.key })}`, items: g.items, raw: true }));
		return [
			{ key: "clip", label: "This clip", items: clip },
			{ key: "mine", label: "My voices", items: mine },
			{ key: "trending", label: "Trending", items: trend },
			{ key: "ready", label: "Ready voices", items: ready },
			{ key: "filters", label: "Voice effects", items: effects },
			...serviceGroups,
		].filter((g) => g.items.length > 0);
	}, [cards, t]);
}

/** The line a voice shows while its service's key is missing (null: it speaks now). */
export function needsKey(card: VoiceCard | undefined): string | null {
	if (!card?.service || card.service.ready) return null;
	const key = card.service.key ?? card.service.name;
	return t("The {name} voice needs a {key} key: Settings → Services.", { name: card.service.name, key });
}

/** The groups as the items of a list (the shared picker's, the Lipsync window's own «Sound» list). */
export function VoiceGroupItems({ groups }: { groups: ReturnType<typeof useVoiceGroups> }) {
	const t = useT();
	return (
		<>
			{groups.map((g) => (
				<SelectGroup key={g.key}>
					<SelectLabel data-voice-filter={g.key}>{"raw" in g ? g.label : t(g.label)}</SelectLabel>
					{g.items.map((c) => {
						// a voice whose service's key he lacks: shown, not pickable, the key named on the row itself
						const off = !!c.service && !c.service.ready;
						const note = off ? t("needs a {key} key", { key: c.service?.key ?? c.service?.name ?? "" }) : c.hint ? t(c.hint) : undefined;
						return (
							<SelectItem key={c.id} value={c.id} className="text-xs" disabled={off} note={note} data-voice-card={c.id} data-voice-off={off ? "" : undefined}>
								<span data-no-translate>{c.id === "clone" ? t("Voice of this clip (cloned)") : c.name}</span>
							</SelectItem>
						);
					})}
				</SelectGroup>
			))}
		</>
	);
}

/** The list's groups, in the order a person means them: their own voices first, then the looks, then the plain ones. */
const ADD = "__your_voice__";

export function VoicePicker({
	cards,
	value,
	onPick,
	onAdd,
	onRemove,
	label,
	title = "Voice",
}: {
	cards: VoiceCard[];
	value: string;
	onPick: (id: string) => void;
	/** «＋ Your voice»: the last line of the list. */
	onAdd?: () => void;
	onRemove?: (id: string) => void;
	/** The data attribute tests and the panel's own styling look for. */
	label?: string;
	/** The field's name (Voice, Sound…); hidden with an empty string. */
	title?: string;
}) {
	const t = useT();
	const playing = usePlaying((s) => s.id);
	useEffect(() => () => stopSample(), []);
	const picked = cards.find((c) => c.id === value);
	const groups = useVoiceGroups(cards);
	const removable = !!onRemove && !!picked?.groups.includes("mine");
	return (
		<div className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2" data-voice-picker={label ?? ""}>
			{title ? <span className="text-muted-foreground text-[11px]">{t(title)}</span> : <span />}
			<div className="flex min-w-0 items-center gap-1">
				<Select
					value={picked ? value : undefined}
					onValueChange={(v) => {
						if (v === ADD) return onAdd?.();
						onPick(v);
					}}
				>
					<SelectTrigger className="h-8 min-w-0 flex-1 text-xs" data-voice-trigger aria-label={t(title || "Voice")}>
						<SelectValue placeholder={t("Choose a voice")}>
							{picked && (
								<span className="flex min-w-0 items-center gap-1.5">
									<HugeiconsIcon icon={VoiceIcon} className="text-primary size-3.5 shrink-0" />
									<span className="truncate font-medium" data-no-translate>
										{picked.name}
									</span>
								</span>
							)}
						</SelectValue>
					</SelectTrigger>
					<SelectContent data-voice-list>
						<VoiceGroupItems groups={groups} />
						{onAdd && (
							<>
								<SelectSeparator />
								<SelectItem value={ADD} className="text-xs" data-testid="my-voices-add">
									＋ {t("Your voice")}
								</SelectItem>
							</>
						)}
					</SelectContent>
				</Select>
								{/* ▶ the chosen voice's own recording (one sample at a time, shared by every picker) */}
				<Button
					type="button"
					size="icon"
					variant="ghost"
					className="size-8 shrink-0"
					data-voice-play={picked?.id}
					disabled={!picked?.sample}
					aria-label={playing === picked?.id ? t("Stop") : t("Listen to this voice")}
					title={playing === picked?.id ? t("Stop") : t("Listen to this voice")}
					onClick={() => playSample(picked)}
				>
					<HugeiconsIcon icon={playing === picked?.id ? StopIcon : PlayIcon} className="size-3.5" />
				</Button>
				{/* × one of «My voices» — its own button, so the tick of a picked voice never covers it (the owner, 17.11) */}
				{removable && (
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className="text-muted-foreground hover:text-foreground size-8 shrink-0"
						data-voice-remove={picked?.id}
						aria-label={t("Remove this voice")}
						title={t("Remove this voice")}
						onClick={() => picked && onRemove?.(picked.id)}
					>
						<HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
					</Button>
				)}
			</div>
			{/* a voice whose service has no key yet: picked, and it says which key it waits for (before Create is pressed) */}
			{picked && needsKey(picked) && (
				<p className="text-destructive col-start-2 text-[11px] leading-snug" data-voice-needs-key>
					{needsKey(picked)}
				</p>
			)}
		</div>
	);
}

/** The interface's language, and the samples' (the typed text's language, else the interface's). */
export function useVoiceLang(text = ""): { ui: "en" | "ru"; sample: "en" | "ru" } {
	const ui = useLang((s) => s.lang);
	return { ui, sample: text.trim() ? (/[а-яё]/i.test(text) ? "ru" : "en") : ui };
}

