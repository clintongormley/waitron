import type { ReactiveController, ReactiveControllerHost } from "lit";

/** Whether a media query matches, followed while its host is connected; the host re-renders when
 * the answer changes. */
export class MediaQueryController implements ReactiveController {
  matches = false;
  readonly #host: ReactiveControllerHost;
  readonly #query: string;
  #list?: MediaQueryList;
  readonly #onChange = (event: MediaQueryListEvent) => {
    this.matches = event.matches;
    this.#host.requestUpdate();
  };

  constructor(host: ReactiveControllerHost, query: string) {
    this.#host = host;
    this.#query = query;
    host.addController(this);
  }

  hostConnected(): void {
    this.#list = window.matchMedia(this.#query);
    const was = this.matches;
    this.matches = this.#list.matches;
    if (was !== this.matches) this.#host.requestUpdate();
    this.#list.addEventListener("change", this.#onChange);
  }

  hostDisconnected(): void {
    this.#list?.removeEventListener("change", this.#onChange);
    this.#list = undefined;
  }
}
