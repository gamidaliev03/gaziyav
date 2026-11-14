import type { EffectDefinition } from "@/effects/types";
import { colorEffect } from "./color";
import { studioEffects } from "./effects";
import { kadrEffects } from "./kadr-effects";
import { proEffects } from "./pro-effects";

export const studioEffectDefinitions: EffectDefinition[] = [...studioEffects, ...kadrEffects, ...proEffects, colorEffect];
