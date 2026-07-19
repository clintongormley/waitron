import { LitElement } from "lit";

/**
 * Boilerplate shared by the interactive primitives (wt-button, wt-input, wt-switch, wt-dialog).
 * Each piece below used to be hand-copied per component; factoring it out means a fix or a
 * mutation-testing-driven guard only has to live in one place.
 */

const idCounts = new Map<string, number>();

/**
 * Returns a fresh `${prefix}-N` id, unique among every previous call sharing the same `prefix` —
 * not globally unique, so a page with both a `wt-input-1` and a `wt-switch-1` is fine; the two
 * never need to be told apart from each other. Used by wt-dialog (`wt-dialog-heading-N`),
 * wt-input (`wt-input-N`), and wt-switch (`wt-switch-N`) to give each instance's
 * label/heading `for`/`id`/`aria-labelledby` pairing a collision-free id.
 */
export function uniqueId(prefix: string): string {
  const next = (idCounts.get(prefix) ?? 0) + 1;
  idCounts.set(prefix, next);
  return `${prefix}-${next}`;
}

/**
 * Shared `shadowRootOptions` for a primitive that delegates focus from the host to its own inner
 * control — see "Focus delegation" in docs/developers/design-system.md. Used by wt-button,
 * wt-input, and wt-switch. NOT wt-dialog: a dialog is not itself a focusable control in the same
 * sense, and it does not set `delegatesFocus` today — reusing this constant there would change
 * its behaviour.
 */
export const delegatesFocusShadowRootOptions = Object.freeze({
  ...LitElement.shadowRootOptions,
  delegatesFocus: true,
});

/**
 * Stops `event` from propagating — so the native event it wraps can't double-fire across the
 * shadow boundary once re-emitted, see "Event discipline" in docs/developers/design-system.md —
 * then dispatches a `wt-change` CustomEvent from `host` carrying `detail`.
 *
 * `bubbles`/`composed` are hardcoded `true` here, and only here: mutation testing found both
 * flags unguarded back when wt-input and wt-switch each spelled this dispatch out for themselves
 * (see their "bubbles and crosses shadow boundaries" tests). Do not make either flag
 * configurable — every current and, per the design system's event-discipline rule, future
 * `wt-change` emitter needs both `true`.
 */
export function dispatchWtChange<T>(host: HTMLElement, event: Event, detail: T): void {
  event.stopPropagation();
  host.dispatchEvent(new CustomEvent<T>("wt-change", { detail, bubbles: true, composed: true }));
}
