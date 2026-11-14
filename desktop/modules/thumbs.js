// Thumbnails of files in the space (Downloads, Telegram's files) without Quick Look: macOS keeps every thumbnail
// Quick Look makes in its own cache (com.apple.QuickLook.thumbnailcache, outside the volume, with the file's path) —
// comes from the app's ffmpeg over a pipe (no file anywhere); anything else has no thumbnail.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PICTURE = /\.(png|jpe?g|gif|webp|heic|heif|avif|bmp|tiff?)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i;

function videoFrame(file, width) {
	const ffmpeg = path.join(process.resourcesPath || "", "bin", "ffmpeg");
	if (!fs.existsSync(ffmpeg)) return Promise.resolve(null);
	return new Promise((resolve) => {
		const out = [];
		let size = 0;
		const child = spawn(ffmpeg, ["-v", "error", "-ss", "0.5", "-i", file, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "5", "-"], { stdio: ["ignore", "pipe", "ignore"] });
		const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
		child.stdout.on("data", (d) => {
			size += d.length;
			if (size < 4e6) out.push(d);
		});
		child.on("error", () => resolve(null));
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve(code === 0 && size > 0 ? `data:image/jpeg;base64,${Buffer.concat(out).toString("base64")}` : null);
		});
	});
}

/** A data: URL (JPEG) `width` wide, or null. */
async function thumbOf(file, width = 320) {
	const { nativeImage } = require("electron");
	try {
		if (PICTURE.test(file) && fs.statSync(file).size < 40e6) {
			const img = nativeImage.createFromPath(file);
			if (!img.isEmpty()) return `data:image/jpeg;base64,${img.resize({ width }).toJPEG(72).toString("base64")}`;
		}
		if (VIDEO.test(file)) return await videoFrame(file, width);
	} catch {}
	return null;
}

module.exports = { thumbOf };
