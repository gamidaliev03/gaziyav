import type {
	TAction,
	TActionFunc,
	TActionWithArgs,
	TActionWithOptionalArgs,
	TActionArgsMap,
	TArgOfAction,
	TInvocationTrigger,
} from "./types";
import { recordAction } from "@/notes/diag-actions";

type ActionHandler = (arg: unknown, trigger?: TInvocationTrigger) => void;
const boundActions: Partial<Record<TAction, ActionHandler[]>> = {};

/** The one gate every action passes (./preconditions.ts): false = it can't run now, and the guard said why. */
let guard: ((action: TAction) => boolean) | null = null;
export function setActionGuard(next: ((action: TAction) => boolean) | null): void {
	guard = next;
}

// eslint-disable-next-line opencut/prefer-object-params -- action registries read best as (action, handler).
export function bindAction<A extends TAction>(
	action: A,
	handler: TActionFunc<A>,
) {
	const handlers = boundActions[action];
	const typedHandler = handler as ActionHandler;
	if (handlers) {
		handlers.push(typedHandler);
	} else {
		boundActions[action] = [typedHandler];
	}
}

// eslint-disable-next-line opencut/prefer-object-params -- action registries read best as (action, handler).
export function unbindAction<A extends TAction>(
	action: A,
	handler: TActionFunc<A>,
) {
	const handlers = boundActions[action];
	if (!handlers) return;

	const typedHandler = handler as ActionHandler;
	boundActions[action] = handlers.filter((h) => h !== typedHandler);

	if (boundActions[action]?.length === 0) {
		delete boundActions[action];
	}
}

type InvokeActionFunc = {
	(
		action: TActionWithOptionalArgs,
		args?: undefined,
		trigger?: TInvocationTrigger,
	): void;
	<A extends TActionWithArgs>(
		action: A,
		args: TActionArgsMap[A],
		trigger?: TInvocationTrigger,
	): void;
};

// eslint-disable-next-line opencut/prefer-object-params -- dispatchers conventionally separate action, payload, and trigger.
export const invokeAction: InvokeActionFunc = <A extends TAction>(
	action: A,
	args?: TArgOfAction<A>,
	trigger?: TInvocationTrigger,
) => {
	recordAction(action); // the flight recorder's ring of action names (src/notes/diag-actions.ts)
	const handlers = boundActions[action];
	if (!handlers?.length) return;
	if (guard && !guard(action)) return;
	handlers.forEach((handler) => {
		handler(args, trigger);
	});
};
