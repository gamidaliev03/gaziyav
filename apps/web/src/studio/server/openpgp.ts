// Just enough OpenPGP (RFC 4880) to check a detached v4 RSA signature against a public key we ship: how the app
// knows an update file really comes from its authors (a checksum from the same server proves nothing).
import crypto from "node:crypto";

interface Packet {
	tag: number;
	body: Buffer;
}

/** Bytes of an ASCII-armored block, or the input itself when it is already binary. */
export function dearmor(input: string | Buffer): Buffer {
	const text = Buffer.isBuffer(input) ? input.toString("latin1") : input;
	if (!text.includes("-----BEGIN PGP")) return Buffer.isBuffer(input) ? input : Buffer.from(input, "latin1");
	const lines = text.split(/\r?\n/);
	const start = lines.findIndex((l) => l.startsWith("-----BEGIN PGP"));
	let i = start + 1;
	while (i < lines.length && lines[i].trim() !== "") i++; // armor headers end at the first empty line
	const b64: string[] = [];
	for (i++; i < lines.length && !lines[i].startsWith("-----END PGP"); i++) {
		if (lines[i].startsWith("=")) break; // CRC-24 line
		b64.push(lines[i].trim());
	}
	return Buffer.from(b64.join(""), "base64");
}

function packets(data: Buffer): Packet[] {
	const out: Packet[] = [];
	let p = 0;
	while (p < data.length) {
		const head = data[p++];
		if (!(head & 0x80)) throw new Error("not an OpenPGP packet");
		let tag: number;
		let len: number;
		if (head & 0x40) {
			tag = head & 0x3f;
			const o = data[p++];
			if (o < 192) len = o;
			else if (o < 224) len = ((o - 192) << 8) + data[p++] + 192;
			else if (o === 255) {
				len = data.readUInt32BE(p);
				p += 4;
			} else throw new Error("partial packet lengths are not supported");
		} else {
			tag = (head >> 2) & 0x0f;
			const type = head & 3;
			if (type === 0) len = data[p++];
			else if (type === 1) {
				len = data.readUInt16BE(p);
				p += 2;
			} else if (type === 2) {
				len = data.readUInt32BE(p);
				p += 4;
			} else len = data.length - p;
		}
		out.push({ tag, body: data.subarray(p, p + len) });
		p += len;
	}
	return out;
}

/** An MPI at `p`: its bytes and where the next field starts. */
function mpi(b: Buffer, p: number): [Buffer, number] {
	const bits = b.readUInt16BE(p);
	const n = Math.ceil(bits / 8);
	return [b.subarray(p + 2, p + 2 + n), p + 2 + n];
}

interface RsaKey {
	fingerprint: string;
	key: crypto.KeyObject;
	size: number;
}

/** The RSA keys (primary and subkeys) of a public key block, by v4 fingerprint. */
function rsaKeys(block: Buffer): RsaKey[] {
	const keys: RsaKey[] = [];
	for (const { tag, body } of packets(block)) {
		if (tag !== 6 && tag !== 14) continue; // public key, public subkey
		if (body[0] !== 4 || ![1, 3].includes(body[5])) continue; // v4 RSA only
		const [n, next] = mpi(body, 6);
		const [e] = mpi(body, next);
		const head = Buffer.from([0x99, (body.length >> 8) & 0xff, body.length & 0xff]);
		const fingerprint = crypto.createHash("sha1").update(head).update(body).digest("hex");
		const key = crypto.createPublicKey({ key: { kty: "RSA", n: n.toString("base64url"), e: e.toString("base64url") }, format: "jwk" });
		keys.push({ fingerprint, key, size: n.length });
	}
	return keys;
}

const HASHES: Record<number, string> = { 8: "sha256", 9: "sha384", 10: "sha512", 11: "sha224" };

/** Subpackets of a signature area: [type, data]. */
function subpackets(area: Buffer): Array<[number, Buffer]> {
	const out: Array<[number, Buffer]> = [];
	let p = 0;
	while (p < area.length) {
		let len = area[p++];
		if (len >= 192 && len < 255) len = ((len - 192) << 8) + area[p++] + 192;
		else if (len === 255) {
			len = area.readUInt32BE(p);
			p += 4;
		}
		out.push([area[p] & 0x7f, area.subarray(p + 1, p + len)]);
		p += len;
	}
	return out;
}

/**
 * Whether `signature` (detached, binary or armored) is a valid v4 RSA signature over `data` by a key in `publicKey`.
 * Only SHA-2 hashes; a signature naming another issuer, a broken file or anything unexpected is simply false.
 */
export function verifyDetached(data: Buffer, signature: string | Buffer, publicKey: string | Buffer): boolean {
	try {
		const keys = rsaKeys(dearmor(publicKey));
		const sig = packets(dearmor(signature)).find((p) => p.tag === 2)?.body;
		if (!sig || sig[0] !== 4) return false;
		const [type, algo, hashId] = [sig[1], sig[2], sig[3]];
		const hash = HASHES[hashId];
		if (!hash || ![1, 3].includes(algo) || (type !== 0x00 && type !== 0x01)) return false;
		const hashedLen = sig.readUInt16BE(4);
		const hashedEnd = 6 + hashedLen;
		const unhashedLen = sig.readUInt16BE(hashedEnd);
		const rest = hashedEnd + 2 + unhashedLen;
		const left16 = sig.subarray(rest, rest + 2);
		const [s] = mpi(sig, rest + 2);
		// Who signed: issuer fingerprint (33), or the 8-byte issuer key id (16), in either subpacket area.
		const subs = [...subpackets(sig.subarray(6, hashedEnd)), ...subpackets(sig.subarray(hashedEnd + 2, rest))];
		const fpr = subs.find(([t]) => t === 33)?.[1].subarray(1).toString("hex");
		const keyId = subs.find(([t]) => t === 16)?.[1].toString("hex");
		const signer = keys.find((k) => (fpr ? k.fingerprint === fpr : !!keyId && k.fingerprint.endsWith(keyId)));
		if (!signer) return false;
		const body = type === 0x01 ? Buffer.from(data.toString("utf8").replace(/\r?\n/g, "\r\n"), "utf8") : data;
		const hashed = sig.subarray(0, hashedEnd);
		const trailer = Buffer.from([0x04, 0xff, 0, 0, 0, 0]);
		trailer.writeUInt32BE(hashed.length, 2);
		const signed = Buffer.concat([body, hashed, trailer]);
		if (!crypto.createHash(hash).update(signed).digest().subarray(0, 2).equals(left16)) return false;
		const padded = Buffer.concat([Buffer.alloc(Math.max(0, signer.size - s.length)), s]);
		return crypto.verify(hash, signed, signer.key, padded);
	} catch {
		return false;
	}
}
