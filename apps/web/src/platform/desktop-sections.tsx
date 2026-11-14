"use client";

// The places a desktop build may put around the editor (a downloads shelf, sections beside it): this build has none.
// The editor mounts these where they would go; each renders nothing and changes nothing.
import type { NavItem } from "@/components/editor/panels/assets/materials-nav";

export function SectionHost() {
	return null;
}

export function SectionSwitch(_props: { className?: string }) {
	return null;
}

export function DownloadsView() {
	return null;
}

export function useWithDownloads(items: NavItem[]): NavItem[] {
	return items;
}

export function useShelfLeft(_ask: unknown): number {
	return 0;
}

export function ShelfDialog(_props: { open: boolean; onOpenChange: (open: boolean) => void }) {
	return null;
}

export function noteExport(_file: string): void {}

export function watchSavedExports(): void {}
