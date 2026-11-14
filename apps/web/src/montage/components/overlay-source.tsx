"use client";
// Preview overlay source of the Remotion layer (lazy: Remotion loads only when a project has AI layers).
import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";
import type { PreviewOverlaySourceResult } from "@/preview/overlays";
import { useEditor } from "@/editor/use-editor";
import { hasCompositionsOrLayers } from "../compositions";

const MontageLayer = dynamic(() => import("./montage-layer"), { ssr: false });

/** Whatever an AI layer does, the preview (and the editor around it) keeps working; the next edit retries. */
class LayerGuard extends Component<{ children: ReactNode; stamp: unknown }, { failed: unknown }> {
	state = { failed: null as unknown };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch(error: unknown) {
		console.error("[montage-error] AI layer preview failed:", error);
	}
	componentDidUpdate(prev: { stamp: unknown }) {
		if (this.state.failed && prev.stamp !== this.props.stamp) this.setState({ failed: null });
	}
	render() {
		return this.state.failed ? null : this.props.children;
	}
}

function MontageLayerGate() {
	const has = useEditor((e) => {
		const t = e.scenes.getActiveSceneOrNull()?.tracks;
		return t ? hasCompositionsOrLayers(t) : false;
	}, ["scenes", "timeline"]);
	const stamp = useEditor((e) => e.scenes.getActiveSceneOrNull()?.tracks ?? null, ["scenes", "timeline"]);
	return has ? (
		<LayerGuard stamp={stamp}>
			<MontageLayer />
		</LayerGuard>
	) : null;
}

export const montagePreviewOverlaySource: PreviewOverlaySourceResult = {
	definitions: [],
	instances: [
		{
			id: "remotion-ai-layer",
			mount: { kind: "scene" },
			plane: "under-interaction",
			pointerEvents: "none",
			zIndex: 1,
			render: () => <MontageLayerGate />,
		},
	],
};
