import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Drives a host's re-render on a fixed interval so time-based UI (KDS order-age bands) advances
 * live between action-refreshes WITHOUT any server push — the pull-only order-timing mechanism
 * (see the order-timing-alerts spec §5.2). The widget binds an age/clock property to `now`.
 */
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
    // Idempotent: a reconnect / DOM adoption can call this twice without an intervening
    // hostDisconnected. Without clearing first, the old interval leaks and updates double-fire.
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
