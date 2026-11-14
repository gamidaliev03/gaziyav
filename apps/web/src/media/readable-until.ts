import { EncodedPacketSink, type InputTrack } from "mediabunny";

/**
 * Where a track's data really ends. A download or copy cut off midway keeps its whole index (web MP4s carry it up
 * front), so it reports its full length, but packets past the cut can't be read: the preview froze there. Null when
 * the last packet reads.
 */
export async function readableUntil(track: InputTrack): Promise<number | null> {
	const sink = new EncodedPacketSink(track);
	const reads = async (time: number) => {
		try {
			return (await sink.getPacket(time)) !== null;
		} catch {
			return false;
		}
	};
	const last = await sink.getPacket(Number.POSITIVE_INFINITY, { metadataOnly: true });
	if (!last || (await reads(last.timestamp))) return null;
	const first = await sink.getFirstPacket({ metadataOnly: true });
	let low = first?.timestamp ?? 0;
	if (!(await reads(low))) return 0;
	let high = last.timestamp;
	while (high - low > 0.05) {
		const middle = (low + high) / 2;
		if (await reads(middle)) low = middle;
		else high = middle;
	}
	return low;
}
