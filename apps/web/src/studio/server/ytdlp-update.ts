// yt-dlp keeps up with YouTube by updating every few weeks; the app's built-in copy can't. When YouTube starts failing
// (or at most once a day) the newest release is fetched from yt-dlp's GitHub, but only if its checksum list carries a
// valid signature by yt-dlp's own key, shipped inside the app (a checksum from the same server would prove nothing).
// The new copy lives in its own folder; the built-in one is never touched, and anything wrong means the built-in one.
import fs from "node:fs";
import path from "node:path";
import { downloadFile } from "@/ondevice/download";
import { supportDir, ytdlpCommand } from "@/platform/paths";
import { ensureComponent, installedComponent } from "./components";
import { StudioError } from "./errors";
import { routed } from "./http";
import { verifyDetached } from "./openpgp";
import { findTool, run, type RunResult } from "./tools";

/** yt-dlp's release signing key (github.com/yt-dlp/yt-dlp/blob/master/public.key), fingerprint AC0C BBE6 848D 6A87 3464 AF4E 57CF 6593 3B5A 7581. */
export const YTDLP_KEY = `-----BEGIN PGP PUBLIC KEY BLOCK-----

mQINBGP78C4BEAD0rF9zjGPAt0thlt5C1ebzccAVX7Nb1v+eqQjk+WEZdTETVCg3
WAM5ngArlHdm/fZqzUgO+pAYrB60GKeg7ffUDf+S0XFKEZdeRLYeAaqqKhSibVal
DjvOBOztu3W607HLETQAqA7wTPuIt2WqmpL60NIcyr27LxqmgdN3mNvZ2iLO+bP0
nKR/C+PgE9H4ytywDa12zMx6PmZCnVOOOu6XZEFmdUxxdQ9fFDqd9LcBKY2LDOcS
Yo1saY0YWiZWHtzVoZu1kOzjnS5Fjq/yBHJLImDH7pNxHm7s/PnaurpmQFtDFruk
t+2lhDnpKUmGr/I/3IHqH/X+9nPoS4uiqQ5HpblB8BK+4WfpaiEg75LnvuOPfZIP
KYyXa/0A7QojMwgOrD88ozT+VCkKkkJ+ijXZ7gHNjmcBaUdKK7fDIEOYI63Lyc6Q
WkGQTigFffSUXWHDCO9aXNhP3ejqFWgGMtCUsrbkcJkWuWY7q5ARy/05HbSM3K4D
U9eqtnxmiV1WQ8nXuI9JgJQRvh5PTkny5LtxqzcmqvWO9TjHBbrs14BPEO9fcXxK
L/CFBbzXDSvvAgArdqqlMoncQ/yicTlfL6qzJ8EKFiqW14QMTdAn6SuuZTodXCTi
InwoT7WjjuFPKKdvfH1GP4bnqdzTnzLxCSDIEtfyfPsIX+9GI7Jkk/zZjQARAQAB
tDdTaW1vbiBTYXdpY2tpICh5dC1kbHAgc2lnbmluZyBrZXkpIDxjb250YWN0QGdy
dWI0ay54eXo+iQJOBBMBCgA4FiEErAy75oSNaoc0ZK9OV89lkztadYEFAmP78C4C
GwMFCwkIBwIGFQoJCAsCBBYCAwECHgECF4AACgkQV89lkztadYEVqQ//cW7TxhXg
7Xbh2EZQzXml0egn6j8QaV9KzGragMiShrlvTO2zXfLXqyizrFP4AspgjSn/4NrI
8mluom+Yi+qr7DXT4BjQqIM9y3AjwZPdywe912Lxcw52NNoPZCm24I9T7ySc8lmR
FQvZC0w4H/VTNj/2lgJ1dwMflpwvNRiWa5YzcFGlCUeDIPskLx9++AJE+xwU3LYm
jQQsPBqpHHiTBEJzMLl+rfd9Fg4N+QNzpFkTDW3EPerLuvJniSBBwZthqxeAtw4M
UiAXh6JvCc2hJkKCoygRfM281MeolvmsGNyQm+axlB0vyldiPP6BnaRgZlx+l6MU
cPqgHblb7RW5j9lfr6OYL7SceBIHNv0CFrt1OnkGo/tVMwcs8LH3Ae4a7UJlIceL
V54aRxSsZU7w4iX+PB79BWkEsQzwKrUuJVOeL4UDwWajp75OFaUqbS/slDDVXvK5
OIeuth3mA/adjdvgjPxhRQjA3l69rRWIJDrqBSHldmRsnX6cvXTDy8wSXZgy51lP
m4IVLHnCy9m4SaGGoAsfTZS0cC9FgjUIyTyrq9M67wOMpUxnuB0aRZgJE1DsI23E
qdvcSNVlO+39xM/KPWUEh6b83wMn88QeW+DCVGWACQq5N3YdPnAJa50617fGbY6I
gXIoRHXkDqe23PZ/jURYCv0sjVtjPoVC+bg=
=bJkn
-----END PGP PUBLIC KEY BLOCK-----`;

const REPO = "https://github.com/yt-dlp/yt-dlp";
const LATEST = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const WINDOWS = process.platform === "win32";
/** The one-folder build (starts in 0.3 s; the one-file build unpacks itself for ~9 s on every run). */
const ASSET = WINDOWS ? "yt-dlp_win.zip" : "yt-dlp_macos.zip";
const EXE = WINDOWS ? "yt-dlp.exe" : "yt-dlp_macos";
const DAY = 24 * 3600_000;
/** After a YouTube failure: one check per this long at most (a private video fails every time; GitHub is asked once). */
const AFTER_FAILURE = 3600_000;

interface State {
	/** The installed update: its version and program. */
	version?: string;
	exe?: string;
	/** When GitHub was last asked, and why nothing was installed then (for diagnostics). */
	checkedAt?: number;
	note?: string;
}

const home = () => path.join(supportDir(), "Tools", "yt-dlp");
const stateFile = () => path.join(home(), "state.json");

function readState(): State {
	try {
		return JSON.parse(fs.readFileSync(stateFile(), "utf8")) as State;
	} catch {
		return {};
	}
}

function writeState(s: State) {
	fs.mkdirSync(home(), { recursive: true });
	fs.writeFileSync(`${stateFile()}.tmp`, JSON.stringify(s));
	fs.renameSync(`${stateFile()}.tmp`, stateFile());
}

/** The yt-dlp updates start from: a copy inside the app (a development build), else the one fetched on first use. */
function baseYtdlp(): string | null {
	try {
		return findTool("yt-dlp");
	} catch {
		return installedComponent("yt-dlp");
	}
}

/** The yt-dlp to run: the installed update when there is a working one, else the base one. */
export function ytdlpBinary(): string {
	const s = readState();
	if (s.exe?.startsWith(home()) && fs.existsSync(s.exe)) return s.exe;
	const base = baseYtdlp();
	if (!base) throw new StudioError("The link downloader isn't on this Mac yet. Import by link again to get it.");
	return base;
}

/** The first import by link fetches yt-dlp (once, ≈ 54 MB; studio/server/components.ts). */
export async function ensureYtdlp(onProgress?: (fraction: number) => void): Promise<void> {
	const s = readState();
	if ((s.exe?.startsWith(home()) && fs.existsSync(s.exe)) || baseYtdlp()) return;
	await ensureComponent("yt-dlp", onProgress);
}

/** A program that didn't start at all (damaged download, missing library): not YouTube's answer. */
function didNotStart(r: RunResult): boolean {
	return r.status !== 0 && /\[PYI-\d+|Failed to (load|execute) Python|Traceback \(most recent call last\)|cannot execute|Bad CPU type/i.test(r.stderr);
}

/** Runs yt-dlp; an update that can't start is dropped for good and the app's own yt-dlp does the job. */
export async function runYtdlp(args: string[], opts: Parameters<typeof run>[2] = {}): Promise<RunResult> {
	await ensureYtdlp();
	const exe = ytdlpBinary();
	const cmd = ytdlpCommand(exe, args);
	const base = baseYtdlp();
	const updated = exe !== base;
	let r: RunResult;
	try {
		r = await run(cmd.bin, cmd.argv, opts);
	} catch (error) {
		if (!updated || !/Couldn't start/.test((error as Error).message)) throw error;
		r = { status: -1, stdout: "", stderr: "Failed to execute" };
	}
	if (!updated || !didNotStart(r)) return r;
	dropUpdate(`the update didn't start: ${r.stderr.slice(-200)}`);
	if (!base) return r;
	const own = ytdlpCommand(base, args);
	return run(own.bin, own.argv, opts);
}

function dropUpdate(note: string) {
	const s = readState();
	if (s.version) fs.rmSync(path.join(home(), s.version), { recursive: true, force: true });
	writeState({ checkedAt: s.checkedAt, note });
}

/** Errors that a newer yt-dlp may fix (YouTube changed something), as opposed to a private video or no internet. */
export function looksOutdated(text: string): boolean {
	return /unable to extract|extraction failed|nsig|n challenge|signature (function|extraction)|precondition check failed|requested format is not available|http error 403|player response|please report this issue|confirm you.re not a bot/i.test(text);
}

/** "2026.10.21" > "2026.08.19" (also with a ".123" nightly suffix). */
function newer(a: string, b: string): boolean {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return d > 0;
	}
	return false;
}

let builtInVersion: Promise<string> | null = null;
function ownVersion(): Promise<string> {
	builtInVersion ??= (async () => {
		const own = baseYtdlp();
		if (!own) return "0";
		const cmd = ytdlpCommand(own, ["--version"]);
		const r = await run(cmd.bin, cmd.argv, { timeout: 60 });
		return r.stdout.trim();
	})().catch(() => "0");
	return builtInVersion;
}

async function getText(url: string, seconds: number): Promise<string> {
	const r = await fetch(routed(url), { headers: { "User-Agent": "Gaziyav", Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(seconds * 1000) });
	if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
	return r.text();
}

async function getBytes(url: string, seconds: number): Promise<Buffer> {
	const r = await fetch(routed(url), { headers: { "User-Agent": "Gaziyav" }, signal: AbortSignal.timeout(seconds * 1000) });
	if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
	return Buffer.from(await r.arrayBuffer());
}

/** The program inside an unpacked release (at its top, or one folder down). */
function findExe(dir: string): string | null {
	for (const p of [path.join(dir, EXE), ...fs.readdirSync(dir).map((d) => path.join(dir, d, EXE))]) if (fs.existsSync(p)) return p;
	return null;
}

/**
 * Installs the newest signed release when it is newer than what runs now. Resolves to the version installed, or null
 * (nothing newer, or anything failed: then nothing changes). Never throws.
 */
export async function installLatest(signal: AbortSignal = AbortSignal.timeout(10 * 60_000)): Promise<string | null> {
	const state = readState();
	const work: string[] = [];
	try {
		const release = JSON.parse(await getText(LATEST, 20)) as { tag_name?: string; assets?: Array<{ name: string; size: number }> };
		const tag = String(release.tag_name ?? "");
		if (!/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(tag)) throw new Error(`unexpected release name «${tag}»`);
		const current = state.version && newer(state.version, await ownVersion()) ? state.version : await ownVersion();
		if (!newer(tag, current)) {
			writeState({ ...state, checkedAt: Date.now(), note: `up to date (${current})` });
			return null;
		}
		const base = `${REPO}/releases/download/${tag}`;
		const [sums, sig] = await Promise.all([getBytes(`${base}/SHA2-256SUMS`, 30), getBytes(`${base}/SHA2-256SUMS.sig`, 30)]);
		if (!verifyDetached(sums, sig, YTDLP_KEY)) throw new Error("the checksum list isn't signed by yt-dlp's key");
		const line = sums
			.toString("utf8")
			.split("\n")
			.find((l) => l.trim().endsWith(`  ${ASSET}`) || l.trim().endsWith(` *${ASSET}`));
		const sha = line?.trim().split(/\s+/)[0]?.toLowerCase();
		if (!sha || !/^[0-9a-f]{64}$/.test(sha)) throw new Error(`${ASSET} is not in the signed list`);
		const size = release.assets?.find((a) => a.name === ASSET)?.size;
		fs.mkdirSync(home(), { recursive: true });
		const zip = path.join(home(), `${tag}.zip`);
		work.push(zip);
		await downloadFile(`${base}/${ASSET}`, zip, size, sha, signal, () => {}, { name: "the YouTube downloader update" });
		const unpack = path.join(home(), `${tag}.unpack`);
		work.push(unpack);
		fs.rmSync(unpack, { recursive: true, force: true });
		fs.mkdirSync(unpack, { recursive: true });
		const r = WINDOWS ? await run("tar", ["-xf", zip, "-C", unpack], { timeout: 300, signal }) : await run("/usr/bin/ditto", ["-x", "-k", zip, unpack], { timeout: 300, signal });
		if (r.status !== 0) throw new Error(`couldn't unpack: ${r.stderr.slice(-200)}`);
		const exe = findExe(unpack);
		if (!exe) throw new Error(`${EXE} is missing in the release`);
		if (!WINDOWS) fs.chmodSync(exe, 0o755);
		// It must run and say its version before anything uses it.
		const check = ytdlpCommand(exe, ["--version"]);
		const v = await run(check.bin, check.argv, { timeout: 120, signal });
		if (v.status !== 0 || v.stdout.trim() !== tag) throw new Error(`the new version didn't start (${v.stderr.slice(-200) || v.stdout.trim()})`);
		const dest = path.join(home(), tag);
		fs.rmSync(dest, { recursive: true, force: true });
		fs.renameSync(unpack, dest);
		const installed = path.join(dest, path.relative(unpack, exe));
		writeState({ version: tag, exe: installed, checkedAt: Date.now(), note: `installed ${tag}` });
		if (state.version && state.version !== tag) fs.rmSync(path.join(home(), state.version), { recursive: true, force: true });
		return tag;
	} catch (error) {
		writeState({ ...readState(), checkedAt: Date.now(), note: `not updated: ${(error as Error).message}`.slice(0, 400) });
		return null;
	} finally {
		for (const w of work) fs.rmSync(w, { recursive: true, force: true });
	}
}

/** The update, waited for at most `seconds` (it carries on in the background after that). */
export function updateWithin(seconds: number): Promise<string | null> {
	return Promise.race([updateYtdlp("failure"), new Promise<null>((r) => setTimeout(() => r(null), seconds * 1000).unref?.())]);
}

let running: Promise<string | null> | null = null;

/**
 * Checks for a newer yt-dlp in the background: once a day on a normal day, sooner after YouTube failed in a way an
 * update may fix. The same check is shared by everyone asking meanwhile.
 */
export function updateYtdlp(why: "daily" | "failure"): Promise<string | null> {
	if (running) return running;
	if (process.env.STUDIO_TEST === "1" && !process.env.STUDIO_FAKE_NET) return Promise.resolve(null);
	const last = readState().checkedAt ?? 0;
	if (Date.now() - last < (why === "daily" ? DAY : AFTER_FAILURE)) return Promise.resolve(null);
	running = installLatest().finally(() => {
		running = null;
	});
	return running;
}
