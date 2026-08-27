import type { DeepPartial, Screen } from "./setup-app.js";
import type { ProvisionBody } from "./api/client.js";

/**
 * Typed dispatchers for the four events the setup-wizard screens emit UP to the shell
 * ({@link SetupApp}). Every wizard screen goes through these rather than hand-rolling a
 * `new CustomEvent(...)`, which buys two things. The compiler checks each event's DETAIL shape and
 * the `screen` VALUE (against the {@link Screen} union), so an invalid `screen` or a malformed
 * detail is a type error at the call site. And the event-name STRINGS live in exactly one place
 * here — the names are still plain literals (TypeScript does not verify them), but centralising them
 * means a screen can no longer drift its own spelling of `"setup-goto"` out of sync with the
 * shell's listener; fixing the string once fixes every caller.
 *
 * All four are `composed: true, bubbles: true` — the emitting screen lives in its own shadow root,
 * so the events must cross that boundary to reach the shell, which is their only (and final)
 * consumer (it calls `stopPropagation`). These flags and the detail shapes must stay byte-for-byte
 * what the shell's listeners and the screen tests expect; this module is a typed wrapper, not a
 * behaviour change.
 */

/** Merge a screen's slice of the provision request into the shell's draft (`setup-patch`). */
export function dispatchSetupPatch(el: EventTarget, patch: DeepPartial<ProvisionBody>): void {
  el.dispatchEvent(
    new CustomEvent("setup-patch", { detail: { patch }, bubbles: true, composed: true }),
  );
}

/** Navigate the wizard to another step (`setup-goto`); the shell owns the visible screen. */
export function dispatchSetupGoto(el: EventTarget, screen: Screen): void {
  el.dispatchEvent(
    new CustomEvent("setup-goto", { detail: { screen }, bubbles: true, composed: true }),
  );
}

/**
 * Request a screen-agnostic advance (`setup-advance`); the shell decides the next step from the
 * merged draft. Carries no detail — only the venue screen emits it today.
 */
export function dispatchSetupAdvance(el: EventTarget): void {
  el.dispatchEvent(new CustomEvent("setup-advance", { bubbles: true, composed: true }));
}

/**
 * Fire the provision (`provision-requested`) — the review screen's `Provision` and the provisioning
 * screen's `Try again` both reach the shell through this. Carries no detail.
 */
export function dispatchProvisionRequested(el: EventTarget): void {
  el.dispatchEvent(new CustomEvent("provision-requested", { bubbles: true, composed: true }));
}
