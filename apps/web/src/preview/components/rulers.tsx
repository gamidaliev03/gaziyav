import { RULERS_OVERLAY_ID } from "@/actions/capcut-commands";
import type { PreviewOverlayDefinition, PreviewOverlayRenderContext, PreviewOverlaySourceResult } from "@/preview/overlays";

/** CapCut's player rulers (⌥⌘R): canvas pixels along the top and left edges of the frame. */
export const rulersPreviewOverlay: PreviewOverlayDefinition = {
	id: RULERS_OVERLAY_ID,
	label: "Rulers",
	defaultVisible: false,
};

/** A tick every `step / 2` canvas px, labelled every `step` (100 px on 1080 × 1920). */
function rulerStep(size: number): number {
	const raw = size / 10;
	const magnitude = 10 ** Math.floor(Math.log10(raw));
	return [1, 2, 5, 10].map((n) => n * magnitude).find((n) => n >= raw) ?? raw;
}

function PlayerRulers({ sceneWidth, sceneHeight }: PreviewOverlayRenderContext) {
	const band = Math.round(Math.max(sceneWidth, sceneHeight) * 0.016);
	const step = rulerStep(Math.min(sceneWidth, sceneHeight));
	const font = band * 0.62;
	const ticks = (length: number) => Array.from({ length: Math.floor(length / (step / 2)) + 1 }, (_, i) => i * (step / 2));
	return (
		<svg
			viewBox={`0 0 ${sceneWidth} ${sceneHeight}`}
			width="100%"
			height="100%"
			preserveAspectRatio="none"
			className="pointer-events-none absolute inset-0"
			data-player-rulers
			aria-hidden="true"
		>
			<rect x={0} y={0} width={sceneWidth} height={band} fill="rgba(16,16,18,0.72)" />
			<rect x={0} y={0} width={band} height={sceneHeight} fill="rgba(16,16,18,0.72)" />
			{ticks(sceneWidth).map((x) => {
				const major = x % step === 0;
				return (
					<g key={`x${x}`}>
						<line x1={x} y1={band} x2={x} y2={band * (major ? 0.35 : 0.65)} stroke="rgba(255,255,255,0.7)" strokeWidth={band * 0.06} />
						{major && x > 0 ? (
							<text x={x + band * 0.15} y={band * 0.62} fontSize={font} fill="rgba(255,255,255,0.8)">
								{x}
							</text>
						) : null}
					</g>
				);
			})}
			{ticks(sceneHeight).map((y) => {
				const major = y % step === 0;
				return (
					<g key={`y${y}`}>
						<line x1={band} y1={y} x2={band * (major ? 0.35 : 0.65)} y2={y} stroke="rgba(255,255,255,0.7)" strokeWidth={band * 0.06} />
						{major && y > 0 ? (
							<text x={band * 0.12} y={y - band * 0.2} fontSize={font * 0.85} fill="rgba(255,255,255,0.8)">
								{y}
							</text>
						) : null}
					</g>
				);
			})}
		</svg>
	);
}

/** Registered in the editor page's overlay sources; drawn only while the rulers are on. */
export function getRulersPreviewOverlaySource({ isVisible }: { isVisible: boolean }): PreviewOverlaySourceResult {
	return {
		definitions: [rulersPreviewOverlay],
		instances: isVisible
			? [
					{
						id: RULERS_OVERLAY_ID,
						mount: { kind: "scene" },
						plane: "over-interaction",
						pointerEvents: "none",
						render: (context) => <PlayerRulers {...context} />,
					},
				]
			: [],
	};
}
