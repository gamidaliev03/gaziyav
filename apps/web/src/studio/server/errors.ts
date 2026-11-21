// Every failure becomes "what happened + what to do", so the user never sees "unknown error".
import { vpnWhy } from "@/net/proxy";

/**
 * Users meet what a service does, never who runs it: provider names live only in Settings → API keys and
 * About → Credits. Every message that leaves the server goes through this (StudioError and explain()).
 */
const VENDORS: Array<[RegExp, string]> = [
	// Provider web addresses first (details of raw errors), then the names.
	// fal.ai is the one service the user set up (Settings shows it): its name stays, only its long links go.
	[/https?:\/\/[\w.-]*fal\.(?:ai|run|media)\/[\w./?=&%-]*/gi, "fal.ai"],
	[/(?:https?:\/\/)?[\w.-]*(?:deepseek|sync\.so|wavespeed|aliyun(?:cs)?|dashscope)\.[\w./?=&%-]*/gi, "the service"],
	[/\bDeepSeek\b/gi, "Gaziyav AI"],
	[/\b(?:Alibaba )?DashScope\b|\bsync\.so\b|\bWaveSpeed\b/gi, "lipsync service"],
	[/\bMuseTalk\b/gi, "on-device lipsync"],
	[/\bQwen(?:[ -]?TTS)?\b/gi, "on-device voice"],
	[/\bwhisper(?:[.-]cpp|-cli)?\b/gi, "speech engine"],
	[/\bRemotion\b/gi, "AI layer renderer"],
];

export function brandText(text: string): string {
	let out = text;
	for (const [re, label] of VENDORS) out = out.replace(re, label);
	// A sentence that now starts with a lower-case label gets its capital back.
	return out.replace(/(^|[.!?]\s+|\n)(voice service|lipsync service|on-device|speech engine|the service)/g, (_, a: string, b: string) => a + b[0].toUpperCase() + b.slice(1));
}

export class StudioError extends Error {
	/** A provider's own sentence, whole: no network hint is added to it (kie.ai's «timed out» is not our connection). */
	readonly plain: boolean;
	/** A bad moment, not a refusal (the connection dropped, a 429/5xx): a paid job that is being followed tries again. */
	readonly transient: boolean;
	/** A stable name of the failure («lipsync.timeout»), beside the English text: the page shows its own words for it. */
	readonly key?: string;
	/** The numbers the key's sentence needs ({ seconds: 30 }). */
	readonly vars?: Record<string, string | number>;
	constructor(message: string, o: { plain?: boolean; transient?: boolean; key?: string; vars?: Record<string, string | number> } = {}) {
		super(brandText(message));
		this.name = "StudioError";
		this.plain = !!o.plain;
		this.transient = !!o.transient;
		this.key = o.key;
		this.vars = o.vars;
	}
}

export class CancelledError extends Error {
	constructor() {
		super("Cancelled");
		this.name = "CancelledError";
	}
}

/** The stable key of a failure, when it has one (a cancel is «cancelled»). */
export function errorKey(error: unknown): { key?: string; vars?: Record<string, string | number> } {
	if (error instanceof CancelledError) return { key: "cancelled" };
	if (error instanceof StudioError) return error.key ? { key: error.key, ...(error.vars ? { vars: error.vars } : {}) } : {};
	return {};
}

/** A limit as a person reads it: «30 s», «1 min 30 s», «20 min» — never rounded up to a minute it isn't. */
export function limitText(ms: number): string {
	const s = Math.max(1, Math.round(ms / 1000));
	if (s < 60) return `${s} s`;
	const m = Math.floor(s / 60);
	const rest = s % 60;
	return rest ? `${m} min ${rest} s` : `${m} min`;
}

export function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw new CancelledError();
}

/** Adds the likely fix to raw provider/HTTP messages. */
function hint(text: string): string {
	const t = text.toLowerCase();
	// The YouTube sign-in from a browser (Add from a link): Safari's cookies need Full Disk Access, the others a
	// system permission once (the macOS Keychain) and a signed-in YouTube tab.
	if (t.includes("binarycookies") || (t.includes("operation not permitted") && t.includes("cookies"))) {
		return " → macOS doesn't let Gaziyav read Safari's sign-in. Allow Gaziyav in System Settings → Privacy & Security → Full Disk Access, or pick another browser.";
	}
	if (t.includes("cookie") && /could not find|failed to (decrypt|load)|cannot decrypt|keychain|keyring|database/.test(t)) {
		return " → Gaziyav couldn't read the YouTube sign-in from that browser. Open YouTube there once (signed in), allow the system prompt if one shows, then press Open again — or pick another browser.";
	}
	// First: yt-dlp's text for it mentions "authentication", which is not about an API key.
	if (t.includes("sign in to confirm") || t.includes("not a bot")) {
		return " → YouTube paused downloads from this network for a few minutes (too many requests). Wait a little, then press Retry, or open the video in a browser once.";
	}
	if (/http 401|invalid api key|authentication|unauthorized|invalid_api_key/.test(t)) {
		return " → Invalid API key: check it in Settings → Services (⌘,). Nothing was charged.";
	}
	if (/http 402|insufficient|balance|exhausted|payment required/.test(t)) {
		return " → The service balance is empty. Top it up, then press Retry. Nothing was charged.";
	}
	if (t.includes("http 403")) return " → Access denied (the key has no rights for this model or region).";
	if (t.includes("http 413") || t.includes("too large")) return " → The file is too large. Use a shorter piece.";
	if (t.includes("http 429") || t.includes("rate limit")) return " → Too many requests. Wait a minute and retry.";
	if (/http 5\d\d/.test(t)) {
		return " → The service failed on its side. Retry in a couple of minutes or pick another model.";
	}
	// yt-dlp (any video site)
	if (t.includes("unsupported url")) return " → This site isn't supported, or the link isn't a video page. Open the video itself and copy its link.";
	if (/unable to download (webpage|api page|video data)|urlopen error|nodename nor servname|name or service not known|name resolution|errno 8|network is unreachable|connection (reset|refused|aborted)|timed out|read timeout/.test(t)) {
		return " → Can't reach the site. Check your internet connection, then press Retry.";
	}
	if (t.includes("http error 404")) return " → The video wasn't found (deleted, private or a wrong link).";
	if (t.includes("http error 429")) return " → The site limits downloads right now. Wait a few minutes, then press Retry.";
	if (t.includes("http error 403")) return " → The site refused the download. Press Retry later, or try another link.";
	if (t.includes("video unavailable") || t.includes("private video")) {
		return " → The video is unavailable (deleted, private or blocked in your region).";
	}
	if (t.includes("no face") || t.includes("face not")) {
		return " → No face found in the frame. Pick a piece where the face is clearly visible.";
	}
	return "";
}

export function explain(error: unknown, stage?: string): string {
	return brandText(explainRaw(error, stage));
}

function explainRaw(error: unknown, stage?: string): string {
	const prefix = stage ? `${stage}: ` : "";
	if (error instanceof CancelledError) return "Cancelled";
	if (error instanceof StudioError) return prefix + (error.plain ? error.message : humanize(error.message));
	const e = error as { name?: string; message?: string; code?: string; cause?: { code?: string; hostname?: string } };
	if (e?.name === "AbortError") return "Cancelled";
	const code = e?.cause?.code ?? e?.code;
	const host = e?.cause?.hostname ? ` (${e.cause.hostname})` : "";
	const vpn = vpnWhy();
	switch (code) {
		case "ENOTFOUND":
		case "EAI_AGAIN":
			return `${prefix}${vpn ? `Can't reach the server${host}: ${vpn}` : `Can't reach the server${host}. Check your internet or VPN.`}`;
		case "ECONNREFUSED":
		case "ECONNRESET":
		case "EPIPE":
		case "UND_ERR_SOCKET":
			return `${prefix}${vpn ? `The connection dropped${host}: ${vpn}` : `The connection dropped${host}. Check the network and press Retry.`}`;
		case "ETIMEDOUT":
		case "UND_ERR_CONNECT_TIMEOUT":
		case "UND_ERR_HEADERS_TIMEOUT":
			return `${prefix}The server didn't answer in time${host}. Retry in a minute usually helps.`;
		case "ENOSPC":
			return `${prefix}The disk is full. Free some space and retry.`;
		case "ENOENT":
			return `${prefix}File not found — it may have been deleted. Run the step again.`;
		case "EACCES":
		case "EPERM":
			return `${prefix}No access to the file or folder.`;
	}
	if (e?.message === "fetch failed") {
		return `${prefix}${vpn ? `The server is unreachable${host}: ${vpn}` : `No internet or the server is unreachable${host}. Check the network and retry.`}`;
	}
	const msg = e?.message?.trim();
	return prefix + (msg ? humanize(msg) : "The step failed without details. Run it again; if it repeats, send this text to support.");
}

/** Services as users know them (messages are already branded when they get here); whole words only ("fal" ≠ "failed"). */
const SERVICES: Array<[RegExp, string]> = [
	[/\bGaziyavAI\b/i, "Gaziyav AI"],
	[/\bvoice service\b/i, "voice service"],
	[/\blipsync service\b/i, "lipsync service"],
	[/\bYouTube\b/, "YouTube"],
];

/**
 * One human line first («fal: invalid API key — check it under Keys»), the raw provider text after
 * "\n\nDetails:" (the panel shows it collapsed).
 */
function humanize(msg: string): string {
	if (msg.includes("\n\nDetails:")) return msg;
	const h = hint(msg);
	if (!h) return msg;
	const service = SERVICES.find(([re]) => re.test(msg))?.[1];
	let line = h.replace(/^ → /, "");
	// Name the service in the sentence itself: «Invalid lipsync service API key. Check it in Settings → API keys.»
	if (service) line = line.replace("API key", `${service} API key`).replace(/^The service/, `The ${service}`).replace(/^Access denied/, `${service}: access denied`);
	return `${line}\n\nDetails: ${msg}`;
}
