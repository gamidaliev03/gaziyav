import { execFileSync } from "node:child_process";
import fs from "node:fs";

/**
 * A copy of `from` at `to` that costs no disk where the disk can: APFS clones with `cp -c` (clonefile(2)). Node's own
 * copyFile never clones on macOS — libuv's COPYFILE_FICLONE falls back to a full copy and COPYFILE_FICLONE_FORCE is
 * ENOSYS (perf, 13.11: «upload-path» of a 57 MB clip still wrote 57 MB). Elsewhere, or across disks, a plain copy.
 */
/** The clone: macOS cp's clonefile(2) (exported for the count test, which runs this very command). */
export const CLONE_COMMAND = ["/bin/cp", "-c"] as const;

export function cloneOrCopy(from: string, to: string): "clone" | "copy" {
	if (process.platform === "darwin") {
		try {
			execFileSync(CLONE_COMMAND[0], [...CLONE_COMMAND.slice(1), from, to], { stdio: "ignore" });
			return "clone";
		} catch {
			fs.rmSync(to, { force: true });
		}
	}
	fs.copyFileSync(from, to);
	return "copy";
}
