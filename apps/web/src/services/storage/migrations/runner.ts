import {
	IndexedDBAdapter,
	deleteDatabase,
} from "@/services/storage/indexeddb-adapter";
import type { StorageMigration } from "./base";
import type { ProjectRecord } from "./transformers/types";
import { getProjectId, isRecord } from "./transformers/utils";

export interface StorageMigrationResult {
	migratedCount: number;
}

export interface MigrationProgress {
	isMigrating: boolean;
	fromVersion: number | null;
	toVersion: number | null;
	projectName: string | null;
}

let hasCleanedUpMetaDb = false;

const MIN_MIGRATION_DISPLAY_MS = 1000;

export async function runStorageMigrations({
	migrations,
	onProgress,
}: {
	migrations: StorageMigration[];
	onProgress?: (progress: MigrationProgress) => void;
}): Promise<StorageMigrationResult> {
	// One-time cleanup: delete the old global version database
	if (!hasCleanedUpMetaDb) {
		try {
			await deleteDatabase({ dbName: "video-editor-meta" });
		} catch {
			// Ignore errors - DB might not exist
		}
		hasCleanedUpMetaDb = true;
	}

	const projectsAdapter = new IndexedDBAdapter<ProjectRecord>({
		dbName: "video-editor-projects",
		storeName: "projects",
		version: 1,
	});

	const projects = await projectsAdapter.getAll();

	const orderedMigrations = [...migrations].sort((a, b) => a.from - b.from);
	let migratedCount = 0;
	let migrationStartTime: number | null = null;

	for (const project of projects) {
		if (typeof project !== "object" || project === null) {
			continue;
		}

		let projectRecord = project as ProjectRecord;
		const projectId = getProjectId({ project: projectRecord });
		if (!projectId) {
			continue;
		}

		// A damaged record (a `scenes` that is not a list, a scene without tracks) is not an old format to migrate: left
		// as it is, the project opens from its newest whole copy (storage service, loadProjectOrBackup). Migrating it read
		// as «v0, no scenes yet» and wrote back an empty project, which then opened as the user's work (03.11).
		if (isDamagedProjectRecord({ project: projectRecord })) {
			console.warn("[storage] a damaged project record is left for recovery", { projectId });
			continue;
		}

		let currentVersion = getProjectVersion({ project: projectRecord });
		const targetVersion = orderedMigrations.at(-1)?.to ?? currentVersion;

		if (currentVersion >= targetVersion) {
			continue;
		}

		// Track when we first showed the migration dialog
		if (migrationStartTime === null) {
			migrationStartTime = Date.now();
		}

		const projectName = getProjectName({ project: projectRecord });
		onProgress?.({
			isMigrating: true,
			fromVersion: currentVersion,
			toVersion: targetVersion,
			projectName,
		});

		for (const migration of orderedMigrations) {
			if (migration.from !== currentVersion) {
				continue;
			}

			const result = await migration.run({
				projectId,
				project: projectRecord,
			});

			if (result.skipped) {
				break;
			}

			await projectsAdapter.set({ key: projectId, value: result.project });
			migratedCount++;
			currentVersion = migration.to;
			projectRecord = result.project;
		}
	}

	// Ensure dialog is visible for minimum time so users can see it
	if (migrationStartTime !== null) {
		const elapsed = Date.now() - migrationStartTime;
		if (elapsed < MIN_MIGRATION_DISPLAY_MS) {
			await new Promise((resolve) =>
				setTimeout(resolve, MIN_MIGRATION_DISPLAY_MS - elapsed),
			);
		}
	}

	onProgress?.({
		isMigrating: false,
		fromVersion: null,
		toVersion: null,
		projectName: null,
	});

	return { migratedCount };
}

/** `scenes` present but not a list, or a scene that is not an object with tracks: a broken save, not an old format. */
export function isDamagedProjectRecord({ project }: { project: ProjectRecord }): boolean {
	const scenes = project.scenes;
	if (scenes === undefined || scenes === null) return false;
	if (!Array.isArray(scenes)) return true;
	return scenes.some((scene) => !isRecord(scene) || (scene.tracks !== undefined && !isRecord(scene.tracks)));
}

function getProjectVersion({ project }: { project: ProjectRecord }): number {
	const versionValue = project.version;

	// v2 and up - has explicit version field
	if (typeof versionValue === "number") {
		return versionValue;
	}

	// v1 - has scenes array
	const scenesValue = project.scenes;
	if (Array.isArray(scenesValue) && scenesValue.length > 0) {
		return 1;
	}

	// v0 - no scenes
	return 0;
}

function getProjectName({
	project,
}: {
	project: ProjectRecord;
}): string | null {
	const metadata = project.metadata;
	if (isRecord(metadata) && typeof metadata.name === "string") {
		return metadata.name;
	}

	// v0 had name directly on project
	if (typeof project.name === "string") {
		return project.name;
	}

	return null;
}
