"use client";

// The voice model right where a voice is made (AI → Voice, Text → Text-to-speech, the Lipsync window) — the same choice
// as Settings → Services. Only «Qwen3 TTS» could be seen there before; MiniMax was a trip to Settings away.
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { manyKeys, onOffer } from "@/fal/video";
import { useT } from "@/i18n";
import { cn } from "@/utils/ui";
import { unitPrice, useChoice, useFal, useKeys } from "../client";
import { apiOf, byPrice, comparable, falModel, isQwenVoice, modelsFor, price, usd } from "../models";

/** What cloning a new voice costs with this speech model (a Qwen clone: a fraction of a cent, MiniMax: $1.50). */
const clonePrice = (id: string) => {
	const clone = falModel(isQwenVoice(id) ? "fal-ai/qwen-3-tts/clone-voice/1.7b" : "fal-ai/minimax/voice-clone");
	return clone ? price(clone, 30) : 0;
};

export function VoiceModelSelect({ className }: { className?: string }) {
	const t = useT();
	const keys = useKeys();
	const current = useChoice("tts");
	// The API is named when more than one has a key, or none has: then every row says which key it needs.
	const anyKey = !!keys && (keys.fal || keys.kie || !!keys.argo);
	const both = manyKeys(keys) || !anyKey;
	const on = onOffer(keys);
	const choose = (id: string) =>
		void useFal
			.getState()
			.choose("tts", id)
			.catch((e) => toast.error((e as Error).message));
	return (
		<Select value={current.id} onValueChange={choose}>
			<SelectTrigger className={cn("h-8 text-xs", className)} data-voice-model-trigger aria-label={t("Voice model")}>
				<SelectValue>
					<span className="truncate">{current.title}</span>
				</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{byPrice(modelsFor("tts", keys), (m) => comparable(m, unitPrice(m))).map((m) => {
					// (with only an ArgoLink key the voice list still shows fal's and kie's models: they say which key they need)
					const noKey = anyKey && !on.includes(apiOf(m));
					return (
						<SelectItem key={m.id} value={m.id} className="text-xs" data-voice-model={m.id} data-model-no-key={noKey ? apiOf(m) : undefined}>
							<span className="flex w-full min-w-0 items-baseline gap-2">
								<span className="font-medium">{m.title}</span>
								{(both || noKey) && <span className="text-muted-foreground/70" data-model-api={apiOf(m)}>{apiOf(m)}</span>}
								{noKey ? <span className="truncate text-amber-500">{t("needs a {api} key", { api: apiOf(m) === "kie" ? "kie.ai" : apiOf(m) === "argo" ? "ArgoLink" : "fal.ai" })}</span> : apiOf(m) === "fal" && <span className="text-muted-foreground truncate">{t("new voice {p}", { p: usd(clonePrice(m.id)) })}</span>}
								<span className="ml-auto shrink-0 tabular-nums">{usd(unitPrice(m))}/1k</span>
							</span>
						</SelectItem>
					);
				})}
			</SelectContent>
		</Select>
	);
}
