"use client";

// The language beside the voice (one control everywhere a voice is chosen): «Авто» = the text's own; otherwise the
// language the speech model is told (MiniMax: language_boost; Qwen: its language; ElevenLabs: language_code). The list is
// the voice model's own (fal/model-voices.ts); picking a voice of a language sets it.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useChoice } from "@/fal/client";
import { languagesOf } from "@/fal/model-voices";
import { useLang, useT } from "@/i18n";

export function VoiceLanguage({ value, onChange }: { value: string; onChange: (code: string) => void }) {
	const t = useT();
	const ru = useLang((s) => s.lang) === "ru";
	const model = useChoice("tts").id;
	const langs = languagesOf(model);
	const now = value !== "auto" && langs.some((l) => l.code === value) ? value : "auto";
	return (
		<div className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2" data-voice-language>
			<span className="text-muted-foreground text-[11px]">{t("Language")}</span>
			<Select value={now} onValueChange={onChange}>
				<SelectTrigger className="h-8 min-w-0 text-xs" aria-label={t("Language")} data-voice-language-trigger>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="auto" className="text-xs" data-voice-language-option="auto">
						{t("Auto (the text's language)")}
					</SelectItem>
					{langs.map((l) => (
						<SelectItem key={l.code} value={l.code} className="text-xs" data-voice-language-option={l.code}>
							<span data-no-translate>{ru ? l.ru : l.en}</span>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
