// AI effect settings per family (kept between sessions) and the family picked in the inspector's AI tab.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ParamValues } from "@/params";
import { defaultParams, FAMILIES, type NeuralFamilyId } from "./catalog";

interface NeuralSettingsState {
	values: Partial<Record<NeuralFamilyId, ParamValues>>;
	picked: NeuralFamilyId;
	pick: (family: NeuralFamilyId) => void;
	setValue: (family: NeuralFamilyId, key: string, value: ParamValues[string]) => void;
	setValues: (family: NeuralFamilyId, values: ParamValues) => void;
	reset: (family: NeuralFamilyId) => void;
}

export const useNeuralSettings = create<NeuralSettingsState>()(
	persist(
		(set) => ({
			values: {},
			picked: "background" as NeuralFamilyId,
			pick: (picked) => set({ picked }),
			setValue: (family, key, value) =>
				set((s) => ({ values: { ...s.values, [family]: { ...valuesIn(family, s.values), [key]: value } } })),
			setValues: (family, values) => set((s) => ({ values: { ...s.values, [family]: { ...valuesIn(family, s.values), ...values } } })),
			reset: (family) => set((s) => ({ values: { ...s.values, [family]: {} } })),
		}),
		{ name: "ai-effects", version: 2, partialize: (s) => ({ values: s.values, picked: s.picked }) },
	),
);

function valuesIn(family: NeuralFamilyId, all: Partial<Record<NeuralFamilyId, ParamValues>>): ParamValues {
	return { ...defaultParams(FAMILIES[family]), ...(all[family] ?? {}) };
}

export function familyValues(family: NeuralFamilyId): ParamValues {
	return valuesIn(family, useNeuralSettings.getState().values);
}

export { valuesIn };
