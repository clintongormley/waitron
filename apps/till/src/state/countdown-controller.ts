import type { ReactiveController, ReactiveControllerHost } from "lit";

/** Whole seconds left until a deadline, repainting its host as each one passes. It reads the
 * steady clock at every check, so a page too busy to run its timer on time never stretches the
 * wait. It stops when its host leaves the page. */
export class CountdownController implements ReactiveController {
  remaining = 0;
  readonly #host: ReactiveControllerHost;
  #deadline = 0;
  #timer?: ReturnType<typeof setTimeout>;

  constructor(host: ReactiveControllerHost) {
    this.#host = host;
    host.addController(this);
  }

  start(seconds: number): void {
    this.#clearTimer();
    this.#deadline = performance.now() + seconds * 1000;
    this.#check();
  }

  stop(): void {
    this.#clearTimer();
    if (this.remaining === 0) return;
    this.remaining = 0;
    this.#host.requestUpdate();
  }

  hostDisconnected(): void {
    this.stop();
  }

  #check(): void {
    this.#timer = undefined;
    const left = this.#deadline - performance.now();
    const remaining = Math.max(0, Math.ceil(left / 1000));
    if (remaining !== this.remaining) {
      this.remaining = remaining;
      this.#host.requestUpdate();
    }
    if (remaining > 0) this.#timer = setTimeout(() => this.#check(), left - (remaining - 1) * 1000);
  }

  #clearTimer(): void {
    if (this.#timer === undefined) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
