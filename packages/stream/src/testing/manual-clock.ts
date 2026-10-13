import { vi } from "vitest";

/**
 * Time that moves only when a test says so. Every wait in the supervisor is one of these sleeps,
 * so `next()` wakes the earliest sleeper and moves the clock to its wake time.
 *
 * Three readings: `now()` is this box's time of day, which `step()` corrects without time passing;
 * `monotonic()` counts time passing and nothing else; `trueNow()` is the time of day the bucket
 * keeps, which a box's correction does not move.
 */
export class ManualClock {
  readonly #start: number;
  #t: number;
  /** Starts far from any time of day, so a reading used as one shows. */
  #m = 5_000;
  #sleeping: { at: number; ms: number; wake: () => void }[] = [];
  readonly slept: number[] = [];

  constructor(start: string) {
    this.#start = Date.parse(start);
    this.#t = this.#start;
  }

  readonly now = (): Date => new Date(this.#t);

  readonly monotonic = (): number => this.#m;

  readonly trueNow = (): Date => new Date(this.#start + this.#m - 5_000);

  readonly sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const entry = { at: this.#m + ms, ms, wake: () => resolve() };
      this.#sleeping.push(entry);
      signal.addEventListener(
        "abort",
        () => {
          this.#sleeping = this.#sleeping.filter((other) => other !== entry);
          resolve();
        },
        { once: true },
      );
    });

  advance(ms: number): void {
    this.#t += ms;
    this.#m += ms;
  }

  /** This box's time of day corrected by `ms`, as time sync does; no time passes. */
  step(ms: number): void {
    this.#t += ms;
  }

  /** Waits until something is asleep — the woken code has run as far as its next wait. */
  async asleep(timeout = 1_000): Promise<void> {
    await vi.waitFor(
      () => {
        if (this.#sleeping.length === 0) throw new Error("nothing is asleep yet");
      },
      { timeout },
    );
  }

  async next(): Promise<void> {
    while (!(await this.#wakeEarliest())) {
      // The sleeper `asleep()` saw was aborted before this resumed.
    }
  }

  /** Wakes sleepers one at a time until `done()` holds. */
  async until(done: () => boolean, limit = 100): Promise<void> {
    for (let i = 0; i <= limit; i += 1) {
      await this.asleep(300).catch(() => undefined);
      if (done()) return;
      if (i < limit) await this.#wakeEarliest();
    }
    throw new Error(`not reached after ${limit} wakes`);
  }

  /** False when the sleeper `asleep()` saw was aborted before this resumed. */
  async #wakeEarliest(): Promise<boolean> {
    await this.asleep();
    this.#sleeping.sort((a, b) => a.at - b.at);
    const entry = this.#sleeping.shift();
    if (entry === undefined) return false;
    const passed = Math.max(0, entry.at - this.#m);
    this.#m += passed;
    this.#t += passed;
    this.slept.push(entry.ms);
    entry.wake();
    return true;
  }
}
