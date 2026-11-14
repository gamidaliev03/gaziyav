/** Where a click lands on a row's wave strip, as a share of the track (0..1). */
export function waveFraction(clientX: number, left: number, width: number): number {
	if (!(width > 0)) return 0;
	return Math.max(0, Math.min(1, (clientX - left) / width));
}
