import type { ReactiveControllerHost } from "lit";
import { focusFirstInvalid } from "./interactive.js";

/** Joins message text; unlike formMessage, this does not render the message. */
export const bottomMessage = (...parts: (string | null)[]): string =>
  parts.filter((part): part is string => part !== null && part !== "").join(" ");

export class FormFeedback {
  attempted = false;
  #dismissed = new Set<string>();
  readonly #host: ReactiveControllerHost;

  constructor(host: ReactiveControllerHost) {
    this.#host = host;
  }

  reset(): void {
    this.attempted = false;
    this.newRefusal();
  }

  // The caller decides when a new refusal arrived, using its own property's change check.
  newRefusal(): void {
    this.#dismissed.clear();
    this.#host.requestUpdate();
  }

  dismiss(...keys: string[]): void {
    for (const key of keys) this.#dismissed.add(key);
    this.#host.requestUpdate();
  }

  press(...keys: string[]): void {
    this.attempted = true;
    this.dismiss(...keys);
  }

  remaining<T>(errors: Record<string, T>): Record<string, T> {
    return Object.fromEntries(Object.entries(errors).filter(([key]) => !this.#dismissed.has(key)));
  }

  message(
    errors: Record<string, string | undefined>,
    fieldKeys: ReadonlySet<string>,
    fixFields: string,
  ): string {
    return bottomMessage(
      ...Object.entries(errors)
        .filter(([key, message]) => message && !fieldKeys.has(key))
        .map(([, message]) => message!),
      fieldKeys.size > 0 ? fixFields : null,
    );
  }

  async focus(root: ParentNode): Promise<HTMLElement | null> {
    await this.#host.updateComplete;
    return focusFirstInvalid(root);
  }
}
