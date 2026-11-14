// A map that remembers how big each entry is and which was used last (Map order: oldest first, a hit moves to the
// end). The media caches under platform/memory-budget.ts keep their entries in one of these.
export class LruBytes<K, V> {
	private map = new Map<K, { value: V; bytes: number }>();
	bytes = 0;

	constructor(private onEvict?: (key: K, value: V) => void) {}

	get size(): number {
		return this.map.size;
	}

	has(key: K): boolean {
		return this.map.has(key);
	}

	/** The entry, now the most recently used. */
	get(key: K): V | undefined {
		const entry = this.map.get(key);
		if (!entry) return undefined;
		this.map.delete(key);
		this.map.set(key, entry);
		return entry.value;
	}

	set(key: K, value: V, bytes: number): void {
		const old = this.map.get(key);
		if (old) {
			this.bytes -= old.bytes;
			this.map.delete(key);
		}
		this.map.set(key, { value, bytes });
		this.bytes += bytes;
	}

	/** Its size became known later (a decode finished). */
	resize(key: K, bytes: number): void {
		const entry = this.map.get(key);
		if (!entry) return;
		this.bytes += bytes - entry.bytes;
		entry.bytes = bytes;
	}

	delete(key: K): boolean {
		const entry = this.map.get(key);
		if (!entry) return false;
		this.map.delete(key);
		this.bytes -= entry.bytes;
		return true;
	}

	clear(): void {
		this.map.clear();
		this.bytes = 0;
	}

	keys(): IterableIterator<K> {
		return this.map.keys();
	}

	/** Drops the least recently used entries until at most `limit` bytes are held (`keep` says which must stay). */
	shrinkTo(limit: number, keep?: (key: K, value: V) => boolean): number {
		let dropped = 0;
		for (const [key, entry] of [...this.map]) {
			if (this.bytes <= limit) break;
			if (keep?.(key, entry.value)) continue;
			this.map.delete(key);
			this.bytes -= entry.bytes;
			dropped++;
			this.onEvict?.(key, entry.value);
		}
		return dropped;
	}
}
