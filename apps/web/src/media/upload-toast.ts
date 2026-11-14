import { toast } from "sonner";

export interface MediaUploadToastResult {
	uploadedCount: number;
	assetNames?: string[];
}

function getAssetLabel({ count }: { count: number }): string {
	return count === 1 ? "file" : "files";
}

function waitForNextPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => resolve());
		});
	});
}

export async function showMediaUploadToast<T extends MediaUploadToastResult>({
	filesCount,
	promise,
}: {
	filesCount: number;
	promise: Promise<T> | (() => Promise<T>);
}) {
	const run = typeof promise === "function" ? promise : () => promise;
	const toastPromise = toast.promise(async () => {
		await waitForNextPaint();
		return run();
	}, {
		// Nothing leaves this Mac: «uploaded» made people ask where their files went.
		loading: `Adding ${getAssetLabel({ count: filesCount })}…`,
		success: ({ uploadedCount, assetNames }) => {
			if (uploadedCount === 1) {
				const assetName = assetNames?.[0];
				return assetName
					? `Added ${assetName}`
					: "Added 1 file";
			}

			if (uploadedCount > 1) {
				return `Added ${uploadedCount} files`;
			}

			return "Nothing was added";
		},
		error: `Couldn't add ${getAssetLabel({ count: filesCount })}`,
	});

	return toastPromise.unwrap();
}
