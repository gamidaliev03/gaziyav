// The system the server runs on, read when it runs. The production build (Turbopack) replaces `process.platform` and
// `process.arch` with the build machine's values, so a Windows or Intel copy built on an Apple silicon Mac would take
// itself for one: server code asks here instead (a function call the build can't fold).
import os from "node:os";

export const IS_WINDOWS = os.platform() === "win32";
export const IS_MAC = os.platform() === "darwin";
/** "arm64" or "x64". */
export const ARCH = os.arch();
