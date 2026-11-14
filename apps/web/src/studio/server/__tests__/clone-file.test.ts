import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLONE_COMMAND, cloneOrCopy } from "@/studio/server/clone-file";

// perf, 13.11: a clip handed to the server by its place («upload-path») is stored as an APFS clone — no data written.
// Node's own copyFile cannot clone on macOS (COPYFILE_FICLONE copies, FICLONE_FORCE is ENOSYS): the 57 MB clip of the
// night's probe was still written whole.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clone-file-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const src = path.join(dir, "talk.mp4");
fs.writeFileSync(src, Buffer.alloc(32 << 20, 7));

// The bytes a command wrote to disk: read from the macOS process record (proc_pid_rusage) of the finished command
// before it is reaped — a parent that has not waited yet still sees it.
const CHILD_IO = `
import ctypes, json, subprocess, sys, time
class R(ctypes.Structure):
    _fields_ = [("uuid", ctypes.c_uint8 * 16)] + [("f%d" % i, ctypes.c_uint64) for i in range(16)] + [("rd", ctypes.c_uint64), ("wr", ctypes.c_uint64)]
lib = ctypes.CDLL("/usr/lib/libproc.dylib")
p = subprocess.Popen(sys.argv[1:])
for _ in range(600):
    st = subprocess.run(["/bin/ps", "-o", "stat=", "-p", str(p.pid)], capture_output=True, text=True).stdout.strip()
    if not st or st.startswith("Z"): break
    time.sleep(0.05)
r = R(); ok = lib.proc_pid_rusage(p.pid, 2, ctypes.byref(r)) == 0
code = p.wait()
print(json.dumps({"exit": code, "written": r.wr if ok else None}))
`;
const written = (cmd: string[]) => JSON.parse(spawnSync("/usr/bin/python3", ["-I", "-c", CHILD_IO, ...cmd], { encoding: "utf8" }).stdout) as { exit: number; written: number | null };

test("the clip is cloned here and the clone has its bytes", () => {
	const to = path.join(dir, "stored.mp4");
	expect(cloneOrCopy(src, to)).toBe(process.platform === "darwin" ? "clone" : "copy");
	expect(fs.statSync(to).size).toBe(32 << 20);
	expect(fs.readFileSync(to).subarray(-4)).toEqual(Buffer.alloc(4, 7));
});

test.if(process.platform === "darwin")("counted: the clone writes 0 bytes of a 32 MB clip; a copy writes all 32 MB", () => {
	const cloned = written([...CLONE_COMMAND, src, path.join(dir, "c1.mp4")]);
	const copied = written(["/bin/cp", src, path.join(dir, "c2.mp4")]);
	expect(cloned.exit).toBe(0);
	expect(copied.written).toBeGreaterThanOrEqual(32 << 20);
	expect(cloned.written).toBeLessThan(64 << 10);
});
