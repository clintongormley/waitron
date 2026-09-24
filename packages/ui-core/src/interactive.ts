import { LitElement } from "lit";

const idCounts = new Map<string, number>();

/**
 * Returns a fresh `${prefix}-N` id, unique among every previous call sharing the same `prefix` —
 * not globally unique, so a page with both a `wt-input-1` and a `wt-switch-1` is fine; the two
 * never need to be told apart from each other.
 */
export function uniqueId(prefix: string): string {
  const next = (idCounts.get(prefix) ?? 0) + 1;
  idCounts.set(prefix, next);
  return `${prefix}-${next}`;
}

/**
 * Shared `shadowRootOptions` for a primitive that delegates focus from the host to its own inner
 * control — see "Focus delegation" in docs/developers/design-system.md. NOT wt-dialog: a dialog is
 * not itself a focusable control in the same sense, and it does not set `delegatesFocus` today —
 * reusing this constant there would change its behaviour.
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
 * `bubbles`/`composed` are hardcoded `true` here, and only here. Do not make either flag
 * configurable — per the design system's event-discipline rule, every `wt-change` emitter needs
 * both `true`.
 */
export function dispatchWtChange<T>(host: HTMLElement, event: Event, detail: T): void {
  event.stopPropagation();
  host.dispatchEvent(new CustomEvent<T>("wt-change", { detail, bubbles: true, composed: true }));
}
