// Export → "Save a manifest": <name>.json beside the exported file, plus one row in the folder's exports.csv.
// Only beside a video/WAV that exists (the save dialog just wrote it), never anywhere else.
import fs from "node:fs/promises";
import path from "node:path";
import {
	type ExportManifest,
	MANIFEST_MEDIA,
	manifestCsvHeader,
	manifestCsvRow,
} from "@/components/editor/export/manifest";

export const runtime = "nodejs";

export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as { file?: unknown; manifest?: ExportManifest } | null;
	const file = typeof body?.file === "string" ? body.file : "";
	if (!body?.manifest || !path.isAbsolute(file) || !MANIFEST_MEDIA.test(file)) {
		return Response.json({ error: "Expected the exported file's path and its manifest." }, { status: 400 });
	}
	try {
		if (!(await fs.stat(file)).isFile()) throw new Error("not a file");
	} catch {
		return Response.json({ error: "The exported file isn't there any more." }, { status: 404 });
	}
	const folder = path.dirname(file);
	const json = path.join(folder, `${path.basename(file, path.extname(file))}.json`);
	const csv = path.join(folder, "exports.csv");
	try {
		await fs.writeFile(json, `${JSON.stringify(body.manifest, null, 2)}\n`);
		const isNew = await fs.access(csv).then(
			() => false,
			() => true,
		);
		await fs.appendFile(csv, `${isNew ? `${manifestCsvHeader()}\n` : ""}${manifestCsvRow(body.manifest)}\n`);
		return Response.json({ json, csv });
	} catch (error) {
		return Response.json({ error: error instanceof Error ? error.message : "Couldn't write the manifest." }, { status: 500 });
	}
}
