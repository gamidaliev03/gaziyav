"use client";
// The language pickers: each language in its own name and script (Авар мацӀ, Нохчийн мотт, Հայերեն …), its Russian
// name under it, and «перевод проверяется» on the machine translations a native speaker still has to check.
// - <LanguageChoice />: a small control for a top bar (the family home): the current language's own name; a tap opens
//   the list and a choice switches the app at once, without a restart, remembered on this Mac.
// - <LanguageList value onChange />: the same list inline (Settings → General → Language).
import { Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/utils/ui";
import { availableCodes, type LangChoice, setLanguage, useLang, useT } from "./index";
import { langInfo } from "./languages";

function Row({ code, on, onPick, systemLabel }: { code: string; on: boolean; onPick: () => void; systemLabel?: string }) {
	const info = code === "system" ? null : langInfo(code);
	return (
		// biome-ignore lint/a11y/useSemanticElements: a list with a tick (buttons, not radio inputs), like the rest of Settings
		<button
			type="button"
			role="radio"
			aria-checked={on}
			data-language={code}
			lang={info?.code}
			dir={info?.dir}
			onClick={onPick}
			className={cn("hover:bg-foreground/[0.06] flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1 text-start", on && "bg-foreground/[0.05]")}
		>
			<span className="text-primary flex w-4 shrink-0 justify-center">{on && <HugeiconsIcon icon={Tick02Icon} className="size-3.5" />}</span>
			<span className="flex min-w-0 flex-col leading-tight">
				<span className="truncate text-[13px] font-medium" data-no-translate>
					{info ? info.name : systemLabel}
				</span>
				{info && info.code !== "ru" && (
					<span className="text-muted-foreground truncate text-[11px]" data-no-translate>
						{info.ru}
						{info.review && <span className="text-amber-500/90"> · перевод проверяется</span>}
					</span>
				)}
			</span>
		</button>
	);
}

/** The whole list, inline: «As on this computer» and every language that has a dictionary. */
export function LanguageList({ value, onChange, columns = 2 }: { value: LangChoice; onChange: (code: LangChoice) => void; columns?: 1 | 2 }) {
	const t = useT();
	return (
		<div role="radiogroup" aria-label={t("Language")} data-language-list className={cn("grid gap-0.5", columns === 2 && "grid-cols-2")}>
			<Row code="system" on={value === "system"} onPick={() => onChange("system")} systemLabel={t("As on this computer")} />
			{availableCodes().map((code) => (
				<Row key={code} code={code} on={value === code} onPick={() => onChange(code)} />
			))}
		</div>
	);
}

/** The small control for a top bar: the current language's own name; a tap opens the list. */
export function LanguageChoice({ className }: { className?: string }) {
	const t = useT();
	const code = useLang((s) => s.code);
	const choice = useLang((s) => s.choice);
	const [open, setOpen] = useState(false);
	const info = langInfo(code);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					data-language-choice
					aria-label={t("Language")}
					title={t("Language")}
					className={cn("hover:bg-foreground/[0.06] flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium", className)}
				>
					<HugeiconsIcon icon={Globe02Icon} className="size-4 shrink-0" />
					<span lang={info.code} dir={info.dir} data-no-translate>
						{info.name}
					</span>
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="max-h-[min(520px,80vh)] w-[420px] max-w-[92vw] overflow-y-auto p-1.5">
				<LanguageList
					value={choice}
					onChange={(next) => {
						setLanguage(next);
						setOpen(false);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}
