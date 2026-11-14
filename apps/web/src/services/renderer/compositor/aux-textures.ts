import { getLutStrip } from "@/effects/luts/looks";
import type { EffectPass } from "@/effects/types";
import type { FrameItemDescriptor, TextureUploadDescriptor } from "./types";

/**
 * Adds the auxiliary textures (LUT strips) referenced by effect passes to the
 * frame's texture list. They are "rendered" textures keyed by id, so the
 * upload happens once and is then a cache hit every frame.
 */
export function collectAuxTextures({
	items,
	textures,
}: {
	items: FrameItemDescriptor[];
	textures: Map<string, TextureUploadDescriptor>;
}): void {
	const visit = (groups: EffectPass[][]) => {
		for (const group of groups) {
			for (const pass of group) {
				for (const id of pass.textures ?? []) {
					if (textures.has(id)) continue;
					const strip = getLutStrip(id);
					if (!strip) continue;
					textures.set(id, {
						kind: "rendered",
						id,
						contentHash: id,
						width: strip.width,
						height: strip.height,
						draw: (ctx) => {
							ctx.putImageData(new ImageData(strip.pixels as Uint8ClampedArray<ArrayBuffer>, strip.width, strip.height), 0, 0);
						},
					});
				}
			}
		}
	};
	const walk = (list: FrameItemDescriptor[]) => {
		for (const item of list) {
			visit(item.effectPassGroups);
			if (item.type === "layer" && item.afterMaskPassGroups) visit(item.afterMaskPassGroups);
			if (item.type === "transition") {
				if (item.from) visit(item.from.effectPassGroups);
				if (item.to) visit(item.to.effectPassGroups);
			}
			if (item.type === "sceneTransition") {
				walk(item.from);
				walk(item.to);
			}
		}
	};
	walk(items);
}
