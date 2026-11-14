// A project as one file on the visitor's disk («.gaziyav»), so work in the browser is never hostage to its storage:
// «Save project file…» writes the project and every media file it holds; «Open project file…» brings it back as a new
// project of this browser. The format: the line «GAZIYAV-PROJECT 1\n», a 4-byte length, a JSON header (the project
// as the editor stores it, and each media file's facts), then the media files' bytes one after another.
import { generateUUID } from "@/utils/id";
import { storageService } from "@/services/storage/service";
import type { SerializedProject } from "@/services/storage/types";
import type { MediaAsset } from "@/media/types";
import { decode, encode, type Header } from "./project-format";

export { decode, encode, EXTENSION, MAGIC } from "./project-format";



/** The file's bytes for a stored project (the open project is saved first by the caller). */
export async function projectFileBlob(projectId: string): Promise<Blob> {
	const loaded = await storageService.loadProject({ id: projectId });
	if (!loaded) throw new Error("The project isn't in this browser");
	const project = storageService.serializeProject({ project: loaded.project });
	const assets = await storageService.loadAllMediaAssets({ projectId });
	const header: Header = {
		project,
		media: assets.map(({ file, url: _url, ...meta }) => ({ meta, name: file.name, type: file.type, size: file.size })),
	};
	return encode(header, assets.map((a) => a.file));
}

/** Opens a project file as a new project of this browser; its id. */
export async function importProjectFile(file: Blob): Promise<string> {
	const { header, files } = await decode(file);
	const id = generateUUID();
	const serialized = { ...header.project, metadata: { ...header.project.metadata, id } } as SerializedProject;
	for (const [i, m] of header.media.entries()) {
		const asset = { ...m.meta, file: new File([files[i]], m.name, { type: m.type }) } as MediaAsset;
		await storageService.saveMediaAsset({ projectId: id, mediaAsset: asset });
	}
	await storageService.saveSerializedProject({ serialized });
	return id;
}
