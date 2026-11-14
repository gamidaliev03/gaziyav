"use client";
// Properties of a Gaziyav AI layer with its own code: the fields its component declared (texts, colours, sizes,
// key timings, pictures) plus every text inside its lists. Edits are instant (no new AI call), one ⌘Z each, and
// stay when Gaziyav AI is asked for a follow-up (it gets the edited values). Pictures show their credit and can
// be replaced from the project's Media.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Section, SectionContent, SectionFields, SectionHeader, SectionTitle } from "@/components/section";
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import type { GraphicElement } from "@/timeline/types";
import { patchAiLayer } from "../compositions";
import { JSON_PREFIX, type PropValue } from "../types";
import { useT } from "@/i18n";

export interface AiField {
	key: string;
	label: string;
	type: "text" | "color" | "number" | "time" | "image";
	min?: number;
	max?: number;
	step?: number;
	/** Inside a list prop: the path to the string (["items", 0, "label"]). */
	path?: (string | number)[];
}

interface AssetEntry {
	type: string;
	name: string;
	title?: string;
	credit?: string;
	author?: string;
	license?: string;
	mediaId?: string;
	w?: number;
	h?: number;
}

/** Set by a timeline double-click: the fields of this layer take the focus when they appear. */
export const fieldsFocus = { pending: "" };

const parse = <T,>(v: unknown, d: T): T => {
	if (typeof v !== "string" || !v) return d;
	try {
		return JSON.parse(v.startsWith(JSON_PREFIX) ? v.slice(JSON_PREFIX.length) : v) as T;
	} catch {
		return d;
	}
};

/** The editable fields of an AI layer: its schema, then every string inside its list props. */
export function aiFields(params: Record<string, unknown>): AiField[] {
	const out: AiField[] = parse<AiField[]>(params.schema, []).filter((f) => f && typeof f.key === "string");
	const seen = new Set(out.map((f) => f.key));
	for (const [key, a] of Object.entries(parse<Record<string, AssetEntry>>(params.assets, {}))) {
		if (a?.type === "image" && !seen.has(key)) {
			out.unshift({ key, label: `Picture · ${key}`, type: "image" });
			seen.add(key);
		}
	}
	for (const [key, v] of Object.entries(params)) {
		if (seen.has(key) || typeof v !== "string" || !v.startsWith(JSON_PREFIX)) continue;
		const walk = (x: unknown, path: (string | number)[], name: string) => {
			if (typeof x === "string" && /\p{L}/u.test(x) && !/^#[0-9a-f]{3,8}$/i.test(x)) out.push({ key, label: name, type: "text", path });
			else if (Array.isArray(x)) x.forEach((y, i) => {
				walk(y, [...path, i], `${name} ${i + 1}`);
			});
			else if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) walk(y, [...path, k], `${name} · ${k}`);
		};
		walk(parse(v, null), [], key.replace(/^\w/, (c) => c.toUpperCase()));
	}
	return out.slice(0, 40);
}

/** Reads a field's current value (list paths included). */
export function fieldValue(params: Record<string, unknown>, f: AiField): PropValue | undefined {
	if (!f.path) return params[f.key] as PropValue | undefined;
	let x: unknown = parse(params[f.key], null);
	for (const p of f.path) x = (x as Record<string | number, unknown> | null)?.[p];
	return typeof x === "string" ? x : undefined;
}

/** A params patch that sets one field (list paths written back into their JSON). */
export function withField(params: GraphicElement["params"], f: AiField, value: PropValue): GraphicElement["params"] {
	if (!f.path?.length) return { ...params, [f.key]: value };
	const root = parse<unknown>(params[f.key], null);
	if (!root || typeof root !== "object") return params;
	const copy = JSON.parse(JSON.stringify(root)) as Record<string | number, unknown>;
	let x: Record<string | number, unknown> = copy;
	for (const p of f.path.slice(0, -1)) x = x[p] as Record<string | number, unknown>;
	x[f.path[f.path.length - 1]] = value;
	return { ...params, [f.key]: `${JSON_PREFIX}${JSON.stringify(copy)}` };
}

export function AiCustomFields({ element }: { element: GraphicElement; trackId: string }) {
	const t = useT();
	const fields = useMemo(() => aiFields(element.params), [element.params]);
	const box = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (fieldsFocus.pending !== element.id) return;
		fieldsFocus.pending = "";
		requestAnimationFrame(() => box.current?.querySelector<HTMLElement>("input, textarea")?.focus());
	}, [element.id]);
	const set = (f: AiField, value: PropValue) => patchAiLayer({ elementId: element.id, patch: (p) => withField(p, f, value) });
	const name = typeof element.params.component === "string" ? element.params.component : "Motion";
	return (
		<div className="flex flex-col" data-ai-fields ref={box}>
			<Section collapsible sectionKey={`${element.id}:ai-fields`}>
				<SectionHeader>
					<SectionTitle>{t("Gaziyav AI · {name}", { name })}</SectionTitle>
				</SectionHeader>
				<SectionContent>
					<SectionFields>
						{fields.length === 0 && <p className="text-muted-foreground text-xs">This layer has no editable fields. Ask Gaziyav AI to change it.</p>}
						{fields.map((f) => (
							<FieldRow key={`${f.key}:${f.path?.join(".") ?? ""}`} field={f} element={element} onSet={(v) => set(f, v)} />
						))}
					</SectionFields>
				</SectionContent>
			</Section>
		</div>
	);
}

function FieldRow({ field, element, onSet }: { field: AiField; element: GraphicElement; onSet: (v: PropValue) => void }) {
	const value = field.type === "image" ? undefined : fieldValue(element.params, field);
	return (
		<label className="flex flex-col gap-1" data-ai-field={field.key}>
			<span className="text-muted-foreground text-[11px]">{field.label}</span>
			{field.type === "image" ? (
				<ImageField element={element} assetKey={field.key} />
			) : field.type === "color" ? (
				<ColorField value={typeof value === "string" ? value : "#ffffff"} onSet={onSet} />
			) : field.type === "number" || field.type === "time" ? (
				<NumberField value={typeof value === "number" ? value : Number(value) || 0} field={field} onSet={onSet} />
			) : (
				<TextField value={typeof value === "string" ? value : ""} onSet={onSet} />
			)}
		</label>
	);
}

function TextField({ value, onSet }: { value: string; onSet: (v: string) => void }) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const commit = () => draft !== value && onSet(draft);
	const long = value.length > 36 || value.includes("\n");
	return long ? (
		<Textarea
			value={draft}
			rows={2}
			className="min-h-0 text-xs"
			onChange={(e) => setDraft(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
				e.stopPropagation();
			}}
		/>
	) : (
		<Input
			value={draft}
			className="h-7 text-xs"
			onChange={(e) => setDraft(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === "Enter") commit();
				e.stopPropagation();
			}}
		/>
	);
}

function ColorField({ value, onSet }: { value: string; onSet: (v: string) => void }) {
	return (
		<div className="flex items-center gap-2">
			<input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"} className="h-7 w-9 cursor-pointer rounded border bg-transparent" onChange={(e) => onSet(e.target.value)} />
			<span className="text-muted-foreground font-mono text-[11px]">{value}</span>
		</div>
	);
}

function NumberField({ value, field, onSet }: { value: number; field: AiField; onSet: (v: number) => void }) {
	const [draft, setDraft] = useState(String(value));
	useEffect(() => setDraft(String(value)), [value]);
	const commit = () => {
		let n = Number(draft);
		if (!Number.isFinite(n)) return setDraft(String(value));
		if (field.min !== undefined) n = Math.max(field.min, n);
		if (field.max !== undefined) n = Math.min(field.max, n);
		if (n !== value) onSet(n);
	};
	return (
		<div className="flex items-center gap-1.5">
			<Input
				type="number"
				value={draft}
				step={field.step ?? (field.type === "time" ? 0.05 : 1)}
				className="h-7 w-24 text-xs"
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter") commit();
					e.stopPropagation();
				}}
			/>
			{field.type === "time" && <span className="text-muted-foreground text-[11px]">s from the layer start</span>}
		</div>
	);
}

/** The picture of an AI layer: what it is, its credit, and Replace from the project's Media. */
export function ImageField({ element, assetKey, onDone }: { element: GraphicElement; assetKey: string; onDone?: () => void }) {
	const assets = parse<Record<string, AssetEntry>>(element.params.assets, {});
	const current = assets[assetKey];
	const images = useEditor((e) => e.media.getAssets().filter((a) => a.type === "image" && !a.ephemeral), ["media"]);
	const [busy, setBusy] = useState("");
	const replace = async (mediaId: string) => {
		const editor = EditorCore.getInstance();
		const asset = editor.media.getAssets().find((a) => a.id === mediaId);
		if (!asset?.file) return;
		setBusy(asset.name);
		try {
			const res = await fetch("/api/montage/media", { method: "POST", headers: { "X-Studio": "1" }, body: await asset.file.arrayBuffer() });
			const info = (await res.json()) as { name?: string; w?: number; h?: number; error?: string };
			if (!res.ok || !info.name) throw new Error(info.error || "The picture couldn't be used.");
			const attribution = (asset as { attribution?: { title: string; author: string; license: string } }).attribution;
			const credit = attribution ? [attribution.title, attribution.author, attribution.license].filter(Boolean).join(" · ") : "";
			patchAiLayer({
				elementId: element.id,
				patch: (p) => {
					const next = { ...parse<Record<string, AssetEntry>>(p.assets, {}) };
					next[assetKey] = { type: "image", name: info.name!, title: asset.name, credit, mediaId: asset.id, w: info.w, h: info.h };
					return { ...p, assets: JSON.stringify(next) };
				},
			});
			onDone?.();
		} finally {
			setBusy("");
		}
	};
	return (
		<div className="flex flex-col gap-1.5" data-ai-image={assetKey}>
			<div className="flex items-center gap-2">
				{current?.name && <img src={`/api/montage/asset/${encodeURIComponent(current.name)}`} alt="" className="size-10 rounded object-cover" />}
				<div className="min-w-0 flex-1">
					<div className="truncate text-xs">{current?.title || "No picture"}</div>
					{current?.credit && <div className="text-muted-foreground truncate text-[10px]" title={current.credit}>{current.credit}</div>}
				</div>
				<Popover>
					<PopoverTrigger asChild>
						<Button type="button" size="sm" variant="outline" className="h-7 shrink-0 text-xs" data-replace-image>
							{busy ? "Replacing…" : "Replace…"}
						</Button>
					</PopoverTrigger>
					<PopoverContent align="end" className="w-72 p-2">
						<div className="text-muted-foreground mb-1.5 text-[11px]">Pick a picture from Media</div>
						{images.length === 0 && <div className="text-muted-foreground text-xs">No pictures in Media yet. Import one (⌘I) or search the web in Media.</div>}
						<div className="grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto">
							{images.map((a) => (
								<button key={a.id} type="button" title={a.name} data-media-pick={a.name} className="hover:ring-foreground/50 aspect-square overflow-hidden rounded ring-1 ring-transparent" onClick={() => void replace(a.id)}>
									{a.thumbnailUrl || a.url ? <img src={a.thumbnailUrl || a.url} alt="" className="size-full object-cover" /> : <span className="text-[10px]">{a.name}</span>}
								</button>
							))}
						</div>
					</PopoverContent>
				</Popover>
			</div>
		</div>
	);
}
