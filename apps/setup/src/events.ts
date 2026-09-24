import type { DeepPartial, Screen } from "./setup-app.js";
import type { AdoptBody, ProvisionBody } from "./api/client.js";

/** Typed dispatchers for the events the wizard screens emit up to the shell. */

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

/** Request an advance (`setup-advance`); the shell decides the next step. */
export function dispatchSetupAdvance(el: EventTarget): void {
  el.dispatchEvent(new CustomEvent("setup-advance", { bubbles: true, composed: true }));
}

export function dispatchProvisionRequested(el: EventTarget): void {
  el.dispatchEvent(new CustomEvent("provision-requested", { bubbles: true, composed: true }));
}

/**
 * Carries the whole {@link AdoptBody}, unlike `provision-requested`: the primary's address and login
 * never enter the shell's draft, so the password is not kept.
 */
export function dispatchAdoptRequested(el: EventTarget, body: AdoptBody): void {
  el.dispatchEvent(
    new CustomEvent("adopt-requested", { detail: { body }, bubbles: true, composed: true }),
  );
}

export interface RestoreRequestDetail {
  artifact: File;
  recoveryKey: string;
  environment: "production" | "preproduction";
}

export function dispatchRestoreRequested(el: EventTarget, request: RestoreRequestDetail): void {
  el.dispatchEvent(
    new CustomEvent("restore-requested", {
      detail: { request },
      bubbles: true,
      composed: true,
    }),
  );
}

export interface ConfigurationRequestDetail {
  artifact: File;
  passphrase: string;
}

export function dispatchConfigurationRequested(
  el: EventTarget,
  request: ConfigurationRequestDetail,
): void {
  el.dispatchEvent(
    new CustomEvent("configuration-requested", {
      detail: { request },
      bubbles: true,
      composed: true,
    }),
  );
}

export function dispatchFiscalTestRequested(el: EventTarget): void {
  el.dispatchEvent(new CustomEvent("fiscal-test-requested", { bubbles: true, composed: true }));
}
