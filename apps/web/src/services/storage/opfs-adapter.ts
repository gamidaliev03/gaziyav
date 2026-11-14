import { isLeftoverName } from "./cut-copies";
import { writeOpfsFile } from "./opfs-write";
import type { StorageAdapter } from "./types";

export class OPFSAdapter implements StorageAdapter<File> {
	private directoryName: string;

	constructor(directoryName = "media") {
		this.directoryName = directoryName;
	}

	private async getDirectory(): Promise<FileSystemDirectoryHandle> {
		const opfsRoot = await navigator.storage.getDirectory();
		return await opfsRoot.getDirectoryHandle(this.directoryName, {
			create: true,
		});
	}

	async get(key: string): Promise<File | null> {
		try {
			const directory = await this.getDirectory();
			const fileHandle = await directory.getFileHandle(key);
			return await fileHandle.getFile();
		} catch (error) {
			if ((error as Error).name === "NotFoundError") {
				return null;
			}
			throw error;
		}
	}

	async set({
		key,
		value: file,
	}: {
		key: string;
		value: File;
	}): Promise<void> {
		const directory = await this.getDirectory();
		const fileHandle = await directory.getFileHandle(key, { create: true });
		// createWritable where the browser has it (a swap file, swapped in atomically; on failure aborted, so a
		// half-written file never replaces the old one); older Safari writes through a worker — see opfs-write.ts.
		await writeOpfsFile({ handle: fileHandle, path: [this.directoryName], name: key, parts: [file] });
	}

	async remove(key: string): Promise<void> {
		try {
			const directory = await this.getDirectory();
			await directory.removeEntry(key);
		} catch (error) {
			if ((error as Error).name !== "NotFoundError") {
				throw error;
			}
		}
	}

	async list(): Promise<string[]> {
		const directory = await this.getDirectory();
		const keys: string[] = [];

		for await (const name of directory.keys()) {
			keys.push(name);
		}

		return keys;
	}

	/** Removes the half-written files a crash left behind («<name>.crswap») that `take` accepts; returns how many. */
	async removeLeftovers(take: (name: string) => boolean = () => true): Promise<number> {
		const directory = await this.getDirectory();
		const names: string[] = [];
		for await (const name of directory.keys()) if (isLeftoverName(name) && take(name)) names.push(name);
		let removed = 0;
		for (const name of names) {
			try {
				await directory.removeEntry(name);
				removed++;
			} catch {}
		}
		return removed;
	}

	async clear(): Promise<void> {
		const directory = await this.getDirectory();

		for await (const name of directory.keys()) {
			await directory.removeEntry(name);
		}
	}

	// Helper method to check OPFS support
	static isSupported(): boolean {
		return "storage" in navigator && "getDirectory" in navigator.storage;
	}
}
