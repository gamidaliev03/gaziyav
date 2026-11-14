"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EditorCore } from "@/core";
import { t } from "@/i18n";

interface PanelErrorBoundaryProps {
	/** Panel name shown to the user, e.g. "Timeline". */
	name: string;
	children: ReactNode;
	className?: string;
}

interface PanelErrorBoundaryState {
	error: Error | null;
	generation: number;
	injected: boolean;
}

/**
 * Fault injection for tests and support: dispatching
 * `new CustomEvent("studio:crash-panel", { detail: "Timeline" })` on window
 * makes that panel throw during render, exercising the real boundary.
 */
export const CRASH_PANEL_EVENT = "studio:crash-panel";

function InjectedCrash({ name }: { name: string }): never {
	throw new Error(`Injected test failure in the ${name} panel`);
}

/**
 * Keeps one broken panel from white-screening the editor: the panel shows a
 * short message with "Reload panel", everything else keeps working.
 * Project data lives in EditorCore, not in React, so remounting loses nothing.
 */
export class PanelErrorBoundary extends Component<
	PanelErrorBoundaryProps,
	PanelErrorBoundaryState
> {
	state: PanelErrorBoundaryState = {
		error: null,
		generation: 0,
		injected: false,
	};

	componentDidMount(): void {
		window.addEventListener(CRASH_PANEL_EVENT, this.handleInjectedCrash);
	}

	componentWillUnmount(): void {
		window.removeEventListener(CRASH_PANEL_EVENT, this.handleInjectedCrash);
	}

	private handleInjectedCrash = (event: Event) => {
		const target = (event as CustomEvent<string>).detail;
		if (target === this.props.name) this.setState({ injected: true });
	};

	static getDerivedStateFromError(error: unknown): Partial<PanelErrorBoundaryState> {
		return {
			error: error instanceof Error ? error : new Error(String(error)),
		};
	}

	componentDidCatch(error: unknown, info: ErrorInfo): void {
		console.error(
			`[panel:${this.props.name}] crashed`,
			error,
			info.componentStack,
		);
		// Belt and braces: get the latest edits to disk while the user reads the message.
		const editor = EditorCore.peekInstance();
		if (editor) {
			void editor.save.flush().catch(() => {});
		}
	}

	private reload = () => {
		this.setState((state) => ({
			error: null,
			injected: false,
			generation: state.generation + 1,
		}));
	};

	render() {
		const { error, generation, injected } = this.state;
		if (error) {
			return (
				<div
					role="alert"
					data-panel-error={this.props.name}
					className={
						this.props.className ??
						"bg-panel flex size-full flex-col items-center justify-center gap-3 rounded-sm p-4 text-center"
					}
				>
					<p className="text-sm font-medium">
						{t("The {name} panel ran into a problem", { name: this.props.name })}
					</p>
					<p className="text-muted-foreground max-w-64 text-xs">
						Your project is saved and the rest of the editor still works.
					</p>
					<Button size="sm" variant="outline" onClick={this.reload}>
						Reload panel
					</Button>
					<details className="text-muted-foreground max-w-full text-left text-[11px]">
						<summary className="cursor-pointer">Details</summary>
						<p className="mt-1 break-words select-text">{error.message}</p>
					</details>
				</div>
			);
		}
		return (
			<PanelGeneration key={generation}>
				{injected ? <InjectedCrash name={this.props.name} /> : this.props.children}
			</PanelGeneration>
		);
	}
}

function PanelGeneration({ children }: { children: ReactNode }) {
	return <>{children}</>;
}
