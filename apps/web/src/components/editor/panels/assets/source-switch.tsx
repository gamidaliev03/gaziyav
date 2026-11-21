"use client";

// Where a panel's search looks (principle 1): All · each keyed service by name · Free web · My library, as filter chips
// (the panels' own chip look). The choice is kept by the server (search-sources.json), so the chat's and the connector's
// search tools use the same one; the small line under it names the sites really searched.
import { useEffect, useState } from "react";
import { Chip } from "@/components/ui/chips";
import { useT } from "@/i18n";

export type SearchKind = "picture" | "video" | "music" | "sound";
export type SourcePick = "all" | "pixabay" | "pexels" | "web" | "library";

export interface SourcesView {
	kind: SearchKind;
	pick: SourcePick;
	keyed: Array<{ id: "pixabay" | "pexels"; name: string }>;
	searched: string[];
	library: boolean;
	noAudio: string[];
}

const views = new Map<SearchKind, SourcesView>();
const listeners = new Set<() => void>();
const say = () => {
	for (const fn of listeners) fn();
};

async function load(kind: SearchKind) {
	try {
		const r = await fetch(`/api/images/sources?kind=${kind}`);
		if (r.ok) {
			views.set(kind, (await r.json()) as SourcesView);
			say();
		}
	} catch {}
}

/** The kept choice of a kind (asked once per panel opening) and the way to change it. */
export function useSearchSource(kind: SearchKind) {
	const [, tick] = useState(0);
	useEffect(() => {
		const fn = () => tick((n) => n + 1);
		listeners.add(fn);
		void load(kind);
		return () => {
			listeners.delete(fn);
		};
	}, [kind]);
	const view = views.get(kind) ?? null;
	const setPick = async (pick: SourcePick) => {
		const was = views.get(kind);
		if (was) views.set(kind, { ...was, pick });
		say();
		try {
			const r = await fetch("/api/images/source", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio": "1" }, body: JSON.stringify({ kind, pick }) });
			if (r.ok) views.set(kind, (await r.json()) as SourcesView);
		} catch {}
		say();
	};
	return { view, pick: view?.pick ?? "all", setPick };
}

/** The chips and the line «Searches: …». `kinds` share one switch (the Media panel: pictures and clips). */
export function SourceSwitch({ kinds, audio = false }: { kinds: SearchKind[]; audio?: boolean }) {
	const t = useT();
	const first = useSearchSource(kinds[0]);
	const second = useSearchSource(kinds[1] ?? kinds[0]);
	const view = first.view;
	if (!view) return null;
	const pick = view.pick;
	const choose = (p: SourcePick) => {
		void first.setPick(p);
		if (kinds[1]) void second.setPick(p);
	};
	const choices: Array<{ id: SourcePick; label: string }> = [
		{ id: "all", label: t("All") },
		...view.keyed.map((k) => ({ id: k.id, label: k.name })),
		{ id: "web", label: t("Free web") },
		{ id: "library", label: audio ? t("My library") : t("My media") },
	];
	const searched = [...new Set([...(view.searched ?? []), ...(kinds[1] ? (second.view?.searched ?? []) : [])])];
	return (
		<div className="flex flex-col gap-1" data-search-source={kinds.join(",")} data-search-pick={pick}>
			<div className="flex flex-wrap gap-1">
				{choices.map((c) => (
					<Chip key={c.id} active={pick === c.id} onClick={() => choose(c.id)} data-search-source-choice={c.id} data-no-translate={c.id === "pixabay" || c.id === "pexels" ? "" : undefined}>
						{c.label}
					</Chip>
				))}
			</div>
			<p className="text-muted-foreground text-[10px] leading-tight" data-search-searched="">
				{pick === "library"
					? audio
						? t("Searches: the Gaziyav library")
						: t("Searches: this project's media")
					: `${t("Searches:")} ${[...(audio && pick === "all" ? ["Gaziyav"] : []), ...searched].join(" · ")}`}
				{audio && view.noAudio.length > 0 && ` · ${t("{names}: no music or sounds in their API", { names: view.noAudio.join(", ") })}`}
			</p>
		</div>
	);
}
