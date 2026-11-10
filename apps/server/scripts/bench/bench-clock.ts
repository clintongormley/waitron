export interface BenchClock {
  now(): Date;
  /** Moves the clock to `at`, or leaves it where it is if `at` is earlier: it never runs back. */
  set(at: Date): void;
  /** Puts the real `Date` back. */
  uninstall(): void;
}

/**
 * Replaces the global `Date`, so every row is dated by the bench's day: many reads of the time go
 * to `Date` rather than a clock passed in. Between `set` calls the clock runs at real speed, so
 * code that waits on `Date.now()` still sees time pass. `performance.now` and `process.hrtime`
 * stay real: the venue watchdog and the timings read them.
 */
export function installBenchClock(start: Date): BenchClock {
  if (installed !== undefined) throw new Error("bench: a bench clock is already installed");
  const RealDate = globalThis.Date;
  let base = start.getTime();
  let realAtBase = RealDate.now();
  const nowMs = () => base + (RealDate.now() - realAtBase);

  class BenchDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(nowMs());
      else super(...(args as [string | number | Date]));
    }
    static override now(): number {
      return nowMs();
    }
    // A Date made before the swap, or by native code, is still a Date.
    static override [Symbol.hasInstance](value: unknown): boolean {
      return value instanceof RealDate;
    }
  }
  globalThis.Date = BenchDate as DateConstructor;

  const clock: BenchClock = {
    now: () => new RealDate(nowMs()),
    set(at) {
      const target = at.getTime();
      if (target <= nowMs()) return;
      base = target;
      realAtBase = RealDate.now();
    },
    uninstall() {
      globalThis.Date = RealDate;
      installed = undefined;
    },
  };
  installed = clock;
  return clock;
}

let installed: BenchClock | undefined;

/** The installed bench clock; the trading day moves it. */
export function currentBenchClock(): BenchClock {
  if (installed === undefined) throw new Error("bench: no bench clock is installed");
  return installed;
}
