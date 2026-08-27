import type { ReactiveController, ReactiveControllerHost } from "lit";
import { subscribeLocale } from "../i18n/t.js";

/** Re-renders its host on a live locale switch — the i18n twin of
 * StoreChangeController. Add `new LocaleChangeController(this)` in a component
 * that renders translated text and must repaint when the language changes. */
export class LocaleChangeController implements ReactiveController {
  readonly #host: ReactiveControllerHost;
  readonly #handler: () => void;
  #dispose?: () => void;

  constructor(host: ReactiveControllerHost, handler?: () => void) {
    this.#host = host;
    this.#handler = handler ?? (() => this.#host.requestUpdate());
    host.addController(this);
  }

  hostConnected(): void {
    this.#dispose = subscribeLocale(this.#handler);
  }

  hostDisconnected(): void {
    this.#dispose?.();
    this.#dispose = undefined;
  }
}
