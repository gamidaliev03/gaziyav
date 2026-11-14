// The AI tab's panel in the browser edition (BrowserAi.panel): the visitor's own fal.ai key — paste, keep in this
// browser, forget. The field never shows the key back (only «…ab12»).
import { useState } from "react";
import { useFal } from "@/fal/client";
import { forgetKey, keyHint, readKey, saveKey } from "./key";
import type { Lang } from "./sentences";

const T = {
	ru: { title: "Липсинк в браузере", note: "Ключ fal.ai хранится только в этом браузере и уходит только на fal.ai.", save: "Сохранить", forget: "Забыть ключ", saved: "Ключ", placeholder: "Ключ fal.ai" },
	en: { title: "Lipsync in the browser", note: "The fal.ai key stays in this browser and goes only to fal.ai.", save: "Save", forget: "Forget the key", saved: "Key", placeholder: "fal.ai key" },
};

export function KeyPanel({ lang = "ru" }: { lang?: Lang }) {
	const t = T[lang];
	const [hint, setHint] = useState(() => keyHint(readKey()));
	const [draft, setDraft] = useState("");
	const changed = () => {
		setHint(keyHint(readKey()));
		setDraft("");
		void useFal.getState().refresh();
	};
	return (
		<div className="flex flex-col gap-2 p-3 text-sm" data-weblip-key>
			<div className="font-medium">{t.title}</div>
			<div className="text-muted-foreground text-xs">{t.note}</div>
			{hint ? (
				<div className="flex items-center gap-2">
					<span className="text-xs">
						{t.saved} {hint}
					</span>
					<button type="button" className="text-xs underline" onClick={() => (forgetKey(), changed())}>
						{t.forget}
					</button>
				</div>
			) : (
				<form
					className="flex gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						saveKey(draft);
						changed();
					}}
				>
					<input type="password" autoComplete="off" spellCheck={false} className="bg-background min-w-0 flex-1 rounded border px-2 py-1 text-xs" placeholder={t.placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} />
					<button type="submit" className="rounded border px-2 py-1 text-xs" disabled={!draft.trim()}>
						{t.save}
					</button>
				</form>
			)}
		</div>
	);
}
