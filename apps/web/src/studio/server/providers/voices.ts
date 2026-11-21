// The voices of the services (Settings → Services → Voice-over), beside Gaziyav's own in every voice picker: the
// voices OpenFilm's providers offer (voices.json: ElevenLabs, Inworld, Cartesia with their samples; OpenAI, Google,
// Groq, Xiaomi MiMo as their modules list them; Microsoft Azure's from its service once its key is in). A voice is
// `svc:<service>:<voice>`; one whose service has no key yet is listed with its service, and asks for the key when used.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StudioError } from "../errors";
import { probe } from "../media";
import { studioHome } from "../settings";
import { findTool, run } from "../tools";
import { routed } from "../http";
import catalog from "./voices.json";
import { needsKeyLine, SERVICES } from "./registry";
import { chosen, keysReady, PORTED, runService, serviceKey } from "./services";

type Row = { p: string; id: string; n: string; g: string; l: string; d: string; s: string; f: number };

export interface ServiceVoice {
	id: string;
	name: string;
	service: string;
	serviceName: string;
	gender: "f" | "m" | "";
	language: string;
	note: string;
	/** Its sample (played through this app), or null. */
	sample: string | null;
	/** Its service has a key now. */
	ready: boolean;
	featured: boolean;
}

const nameOf = (id: string) => SERVICES.find((s) => s.id === id)?.name ?? id;
const SAMPLE_HOST = () => (process.env.STUDIO_EXTRA_AUDIO_URL || "https://assets.openfilm.dev/library").replace(/\/+$/, "");

/** The voices a module lists by itself (no call to its service). */
const listed = new Map<string, Array<{ voiceId: string; name: string; language?: string | null; gender?: string | null; description?: string | null }>>();
async function moduleVoices(id: string): Promise<Array<{ voiceId: string; name: string; language?: string | null; gender?: string | null; description?: string | null }>> {
	const hit = listed.get(id);
	if (hit && id !== "azure") return hit;
	const key = serviceKey(id);
	if (id === "azure" && !key) return [];
	try {
		const into = fs.mkdtempSync(path.join(os.tmpdir(), "gz-voices-"));
		try {
			const r = await PORTED[id].run("voice", { limit: 1000 }, { key: key || "-", root: into, signal: AbortSignal.timeout(15_000), say: () => {}, read: async () => new Uint8Array() });
			const voices = ((r.receipt as { voices?: unknown }).voices ?? []) as Array<{ voiceId: string; name: string }>;
			listed.set(id, voices);
			return voices;
		} finally {
			fs.rmSync(into, { recursive: true, force: true });
		}
	} catch {
		return hit ?? [];
	}
}

/** Every service voice, the ones whose service has a key first. */
export async function serviceVoices(): Promise<ServiceVoice[]> {
	const out: ServiceVoice[] = (catalog as Row[]).map((r) => ({
		id: `svc:${r.p}:${r.id}`,
		name: r.n,
		service: r.p,
		serviceName: nameOf(r.p),
		gender: r.g === "f" || r.g === "m" ? r.g : "",
		language: r.l,
		note: r.d,
		sample: r.s ? `/api/services/voice-sample?p=${encodeURIComponent(r.p)}&v=${encodeURIComponent(r.id)}` : null,
		ready: false,
		featured: r.f === 1,
	}));
	for (const id of ["openai", "google", "groq", "mimo", "azure"]) {
		for (const v of await moduleVoices(id)) {
			out.push({ id: `svc:${id}:${v.voiceId}`, name: v.name, service: id, serviceName: nameOf(id), gender: v.gender === "f" || v.gender === "m" ? v.gender : "", language: v.language ?? "", note: v.description ?? "", sample: null, ready: false, featured: false });
		}
	}
	const keys = new Map<string, boolean>();
	for (const v of out) {
		if (!keys.has(v.service)) keys.set(v.service, !!serviceKey(v.service));
		v.ready = keys.get(v.service) === true;
	}
	return out;
}

export const isServiceVoice = (id: string | undefined): boolean => /^svc:[a-z]+:.{1,200}$/.test(String(id ?? ""));

function parse(id: string): { service: string; voice: string } {
	const m = /^svc:([a-z]+):(.{1,200})$/.exec(id);
	if (!m || !PORTED[m[1]]) throw new StudioError("This voice isn't available.");
	return { service: m[1], voice: m[2] };
}

/** A catalog voice's sample, fetched once from its publisher and kept. */
export async function voiceSampleFile(service: string, voice: string): Promise<string> {
	const row = (catalog as Row[]).find((r) => r.p === service && r.id === voice);
	if (!row?.s) throw new StudioError("This voice has no sample.");
	const dir = path.join(studioHome(), "service-voice-samples", service);
	const file = path.join(dir, `${voice.replace(/[^\w-]+/g, "_")}${path.extname(row.s) || ".m4a"}`);
	if (fs.existsSync(file)) return file;
	const res = await fetch(routed(`${SAMPLE_HOST()}/${row.s.split("/").map(encodeURIComponent).join("/")}`), { signal: AbortSignal.timeout(20_000) }).catch(() => null);
	if (!res?.ok) throw new StudioError("The sample can't be reached: check the internet connection.");
	const bytes = Buffer.from(await res.arrayBuffer());
	if (bytes.length < 512 || bytes.length > 5e6) throw new StudioError("This voice has no sample.");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(file, bytes);
	return file;
}

/** The voice the Voice-over row's chosen service speaks with when a Gaziyav voice was picked: its featured one of that sex. */
export async function stand_in(service: string, female: boolean): Promise<string | null> {
	const all = (await serviceVoices()).filter((v) => v.service === service);
	const same = all.filter((v) => v.gender === (female ? "f" : "m"));
	const pick = same.find((v) => v.featured) ?? same[0] ?? all.find((v) => v.featured) ?? all[0];
	return pick?.id ?? null;
}

/** Text → speech by a service voice, into `out` (.m4a AAC, or .wav): its length. */
export async function speakService(voiceId: string, text: string, out: string, o: { signal?: AbortSignal; onStatus?: (t: string) => void; language?: string } = {}): Promise<{ seconds: number }> {
	const { service, voice } = parse(voiceId);
	await keysReady();
	if (!serviceKey(service)) throw new StudioError(needsKeyLine(service, true));
	const row = chosen("tts");
	const into = fs.mkdtempSync(path.join(os.tmpdir(), "gz-speak-"));
	try {
		o.onStatus?.(`voicing on ${nameOf(service)}`);
		const r = await runService(service, "tts", { text, voice, out: "voice", ...(o.language ? { language: o.language } : {}) }, { model: row.provider === service ? row.model : undefined, into, signal: o.signal });
		const made = r.files.find((f) => /\.(mp3|wav|m4a|ogg)$/i.test(f)) ?? r.files[0];
		if (!made) throw new StudioError("The service didn't make it — nothing was changed. Another service can be picked in Settings → Services.");
		const wav = out.toLowerCase().endsWith(".wav");
		const done = await run(findTool("ffmpeg"), ["-y", "-v", "error", "-i", made, "-ac", "1", ...(wav ? ["-ar", "48000", "-c:a", "pcm_s16le"] : ["-c:a", "aac", "-b:a", "160k"]), out], { timeout: 300, signal: o.signal });
		if (done.status !== 0) throw new StudioError("Couldn't save the voice — nothing was changed.");
		return { seconds: (await probe(out, o.signal)).duration };
	} finally {
		fs.rmSync(into, { recursive: true, force: true });
	}
}
