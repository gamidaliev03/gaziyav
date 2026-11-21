// The API keys the app keeps on disk (fal.ai, kie.ai, ArgoLink, Late, Pexels, Pixabay), sealed with a key of our own
// instead of the Mac's Keychain — the owner, 17.11: «при каждом открытии газиява какую-то авторизацию и пароль от мака
// требует, это не нужно».
//
// Why the Keychain had to go: `safeStorage` encrypts with an item in the login Keychain, and every ad-hoc-signed build is
// a different program to macOS — its «Always Allow» never survives an update, so the password prompt came back on every
// launch. The keys are sealed here with AES-256-GCM under a random 32-byte secret in the app's own folder (mode 600,
// as are the files). Same trust as before from the system's point of view: a program running as this user could read
// them either way; the difference is that the system stops asking for the Mac password.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/** Our format: «GZK1», a 12-byte IV, the 16-byte GCM tag, then the ciphertext. */
const MAGIC = Buffer.from("GZK1");

const folderOf = (userData) => (typeof userData === "function" ? userData() : userData);

/** The 32-byte secret, made on first use and kept beside the keys. */
function secret(userData, test) {
	const folder = folderOf(userData);
	const file = path.join(folder, test ? ".seal.test.key" : ".seal-key");
	try {
		const raw = fs.readFileSync(file);
		if (raw.length === 32) return raw;
	} catch {}
	const made = crypto.randomBytes(32);
	try {
		fs.mkdirSync(folder, { recursive: true });
		fs.writeFileSync(file, made, { mode: 0o600 });
		fs.chmodSync(file, 0o600);
	} catch {}
	return made;
}

function make({ userData, test = false, safeStorage = null }) {
	const key = () => secret(userData, test);

	const seal = (text) => {
		if (test) return Buffer.from(String(text), "utf8");
		const iv = crypto.randomBytes(12);
		const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
		const body = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
		return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
	};

	const open = (blob) => {
		try {
			if (test) return blob.toString("utf8").trim() || null;
			if (!Buffer.isBuffer(blob) || blob.length < 33 || !blob.subarray(0, 4).equals(MAGIC)) return null;
			const decipher = crypto.createDecipheriv("aes-256-gcm", key(), blob.subarray(4, 16));
			decipher.setAuthTag(blob.subarray(16, 32));
			return Buffer.concat([decipher.update(blob.subarray(32)), decipher.final()]).toString("utf8").trim() || null;
		} catch {
			return null;
		}
	};

	/** Writes a key (our format). Throws what fs throws; the caller turns it into a message. */
	const write = (file, value) => {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, seal(value), { mode: 0o600 });
		fs.chmodSync(file, 0o600);
	};

	/**
	 * Reads a key. A file written by an older build (the Keychain, `safeStorage`) is opened once and re-written in our
	 * format right away: the one prompt that migration may need happens at most once, never at every launch.
	 */
	const read = (file) => {
		let raw;
		try {
			raw = fs.readFileSync(file);
		} catch {
			return null;
		}
		if (test) return raw.toString("utf8").trim() || null;
		const ours = open(raw);
		if (ours) return ours;
		if (!safeStorage?.isEncryptionAvailable?.()) return null;
		try {
			const legacy = safeStorage.decryptString(raw).trim();
			if (!legacy) return null;
			write(file, legacy);
			return legacy;
		} catch {
			return null;
		}
	};

	return { seal, open, read, write };
}

module.exports = { make };
