import type { ReactiveController, ReactiveControllerHost } from "lit";

/** Re-renders the host on a fixed interval, so time-based UI advances without a server push. */
export class TickingClock implements ReactiveController {
  now = Date.now();
  #host: ReactiveControllerHost;
  #intervalMs: number;
  #timer?: ReturnType<typeof setInterval>;

  constructor(host: ReactiveControllerHost, intervalMs = 20_000) {
    this.#host = host;
    this.#intervalMs = intervalMs;
    host.addController(this);
  }

  hostConnected(): void {
    // A reconnect can call this twice without a hostDisconnected between, which would leak the old
    // interval.
    this.hostDisconnected();
    this.#timer = setInterval(() => {
      this.now = Date.now();
      this.#host.requestUpdate();
    }, this.#intervalMs);
  }

  hostDisconnected(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
