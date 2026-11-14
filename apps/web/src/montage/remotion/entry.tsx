// Bundle entry for the export renderer (@remotion/renderer): built by scripts/montage-bundle.mjs into public/montage-bundle.
import { Composition, registerRoot } from "remotion";
import type React from "react";
import type { MontageInput } from "../types";
import { MontageComposition } from "./composition";

const defaults: MontageInput = { items: [], words: [], origin: "", width: 1080, height: 1920, fps: 30, durationInFrames: 30 };

const Root = () => (
	<Composition
		id="Montage"
		component={MontageComposition as unknown as React.FC<Record<string, unknown>>}
		defaultProps={defaults as unknown as Record<string, unknown>}
		width={1080}
		height={1920}
		fps={30}
		durationInFrames={30}
		calculateMetadata={({ props }) => {
			const p = props as unknown as MontageInput;
			return { width: p.width, height: p.height, fps: p.fps, durationInFrames: Math.max(1, p.durationInFrames) };
		}}
	/>
);

registerRoot(Root);
