export function dimensionToAspectRatio({
	width,
	height,
}: {
	width: number;
	height: number;
}): string {
	// A broken media/canvas size (0, NaN, Infinity) used to recurse in gcd forever or print «NaN:NaN».
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return "1:1";
	}
	const gcd = ({
		a,
		b,
	}: {
		a: number;
		b: number;
	}): number => (b === 0 ? a : gcd({ a: b, b: a % b }));
	const divisor = gcd({ a: width, b: height });
	const aspectWidth = width / divisor;
	const aspectHeight = height / divisor;
	return `${aspectWidth}:${aspectHeight}`;
}
