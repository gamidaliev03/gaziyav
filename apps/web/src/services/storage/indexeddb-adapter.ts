import type { StorageAdapter } from "./types";

// One open connection per database, shared by every adapter instance.
// Opening a new connection for every read/write (the old behaviour) leaked
// connections and made loading a project with many media files slow.
const connections = new Map<string, Promise<IDBDatabase>>();

function openDatabase({
	dbName,
	storeName,
	version,
}: {
	dbName: string;
	storeName: string;
	version: number;
}): Promise<IDBDatabase> {
	const cached = connections.get(dbName);
	if (cached) return cached;

	const promise = new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(dbName, version);

		request.onerror = () => {
			connections.delete(dbName);
			reject(request.error);
		};
		request.onblocked = () => {
			// Another tab holds an older version open; the open completes once it closes.
			console.warn(`[storage] IndexedDB "${dbName}" open is blocked`);
		};
		request.onsuccess = () => {
			const db = request.result;
			db.onversionchange = () => {
				db.close();
				connections.delete(dbName);
			};
			db.onclose = () => {
				connections.delete(dbName);
			};
			resolve(db);
		};

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(storeName)) {
				db.createObjectStore(storeName, { keyPath: "id" });
			}
		};
	});

	connections.set(dbName, promise);
	return promise;
}

/** Forgets a cached connection (used after a database is deleted). */
export function forgetDatabaseConnection({ dbName }: { dbName: string }): void {
	const cached = connections.get(dbName);
	connections.delete(dbName);
	void cached?.then((db) => db.close()).catch(() => {});
}

export class IndexedDBAdapter<T> implements StorageAdapter<T> {
	private dbName: string;
	private storeName: string;
	private version: number;

	constructor({
		dbName,
		storeName,
		version = 1,
	}: {
		dbName: string;
		storeName: string;
		version?: number;
	}) {
		this.dbName = dbName;
		this.storeName = storeName;
		this.version = version;
	}

	private async getDB(): Promise<IDBDatabase> {
		return openDatabase({
			dbName: this.dbName,
			storeName: this.storeName,
			version: this.version,
		});
	}

	private async transaction(
		mode: IDBTransactionMode,
	): Promise<IDBTransaction> {
		// A write is on the disk when it says «complete» (Chromium's default since 121 is "relaxed": the last saves
		// could vanish when the power goes). IDEAL reliable, audit #3.
		const options: IDBTransactionOptions | undefined = mode === "readwrite" ? { durability: "strict" } : undefined;
		try {
			const db = await this.getDB();
			return db.transaction([this.storeName], mode, options);
		} catch (error) {
			// The cached connection may have been closed by the browser; retry once.
			if (error instanceof DOMException && error.name === "InvalidStateError") {
				connections.delete(this.dbName);
				const db = await this.getDB();
				return db.transaction([this.storeName], mode, options);
			}
			throw error;
		}
	}

	async get(key: string): Promise<T | null> {
		const transaction = await this.transaction("readonly");
		const store = transaction.objectStore(this.storeName);

		return new Promise((resolve, reject) => {
			const request = store.get(key);
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result || null);
		});
	}

	/**
	 * Resolves only when the transaction has COMMITTED. Resolving on the
	 * request's success (the old behaviour) reported a save as done even when
	 * the transaction later aborted, e.g. with QuotaExceededError — the edit
	 * was silently lost.
	 */
	async set({
		key,
		value,
	}: {
		key: string;
		value: T;
	}): Promise<void> {
		const transaction = await this.transaction("readwrite");
		const store = transaction.objectStore(this.storeName);
		return new Promise((resolve, reject) => {
			transaction.oncomplete = () => resolve();
			transaction.onabort = () =>
				reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
			transaction.onerror = () => {
				// onabort follows; keep the most specific error.
			};
			try {
				// The key wins: a record read back from this store carries its old `id`, and spread last it overwrote the key —
				// a version opened as a copy was written over the project it came from (polish, 11.11).
				store.put({ ...value, id: key });
			} catch (error) {
				reject(error);
			}
		});
	}

	async remove(key: string): Promise<void> {
		const transaction = await this.transaction("readwrite");
		const store = transaction.objectStore(this.storeName);

		return new Promise((resolve, reject) => {
			transaction.oncomplete = () => resolve();
			transaction.onabort = () =>
				reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
			store.delete(key);
		});
	}

	async list(): Promise<string[]> {
		const transaction = await this.transaction("readonly");
		const store = transaction.objectStore(this.storeName);

		return new Promise((resolve, reject) => {
			const request = store.getAllKeys();
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result as string[]);
		});
	}

	async getAll(): Promise<T[]> {
		const transaction = await this.transaction("readonly");
		const store = transaction.objectStore(this.storeName);

		return new Promise((resolve, reject) => {
			const request = store.getAll();
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result || []);
		});
	}

	async clear(): Promise<void> {
		const transaction = await this.transaction("readwrite");
		const store = transaction.objectStore(this.storeName);

		return new Promise((resolve, reject) => {
			transaction.oncomplete = () => resolve();
			transaction.onabort = () =>
				reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
			store.clear();
		});
	}
}

export async function deleteDatabase({
	dbName,
}: {
	dbName: string;
}): Promise<void> {
	forgetDatabaseConnection({ dbName });
	return new Promise((resolve, reject) => {
		const request = indexedDB.deleteDatabase(dbName);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}
