import type { DeviceKind } from "./layout.js";

/**
 * The slice of the platform Wake Lock API this controller uses — the injectable seam so a test can
 * pass a fake. Mirrors `navigator.wakeLock`: a `request("screen")` that resolves a sentinel whose
 * `release()` gives the lock back and whose `released` flag the browser flips when it drops the lock
 * on its own (which it does whenever the tab hides).
 */
export interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

export interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
}

/** Injectable dependencies; every one defaults to its real platform counterpart. */
export interface SessionActivityDeps {
  /** Defaults to `navigator.wakeLock`, feature-detected — absent (jsdom, older engines, an insecure
   * context) leaves this `undefined` and the controller a clean no-op for the wake lock. */
  wakeLock?: WakeLockLike;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (handle: number) => void;
}

interface SessionActivityConfig {
  loggedIn: boolean;
  kind: DeviceKind;
  /** Seconds of no interaction before {@link SessionActivityConfig.onIdle}; `null` disables idle logout. */
  timeoutSeconds: number | null;
  onIdle: () => void;
}

/** The Wake Lock API lives only on a supporting browser in a secure context; feature-detect it so the
 * controller no-ops where it is missing. */
function detectWakeLock(): WakeLockLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
}

/**
 * The till's client-side session-activity controller (installable-till Task 9), framework-free so it is
 * unit-testable without the DOM. It owns two device-kind-dependent behaviours:
 *
 *  - a SCREEN WAKE LOCK, held while the device is meant to stay awake — a KDS station holds it whenever
 *    the controller is active (a kitchen display never logs in and must never sleep); a session device
 *    (counter till / handheld) holds it only while an operator is logged in;
 *  - an IDLE LOGOUT for session devices — after `timeoutSeconds` with no interaction it fires `onIdle`
 *    (the app's drop-and-lock). A KDS is exempt, and a `null` timeout disables it.
 *
 * The Wake Lock API drops the sentinel when the tab hides, so the caller wires {@link reacquire} to
 * `visibilitychange` to re-request it. All timing and the wake lock itself are injected so a test drives
 * a fake clock and a fake lock.
 */
export class SessionActivity {
  readonly #wakeLock: WakeLockLike | undefined;
  readonly #now: () => number;
  readonly #setTimer: (fn: () => void, ms: number) => number;
  readonly #clearTimer: (handle: number) => void;

  #config: SessionActivityConfig = {
    loggedIn: false,
    kind: "till",
    timeoutSeconds: null,
    onIdle: () => {},
  };
  #active = false;
  #sentinel: WakeLockSentinelLike | undefined;
  #timer: number | undefined;
  /** Monotonic token that invalidates an in-flight `wakeLock.request(...)` (C3). A request can resolve
   * AFTER a `stop()`/logout or after a newer acquisition superseded it; storing that late sentinel would
   * strand the screen awake (no reference is ever released). Bumped whenever a new acquire starts or a
   * release happens, so an acquire whose captured token no longer matches releases its sentinel instead
   * of storing it. Serializes overlapping acquisitions to exactly one retained sentinel. */
  #wakeGeneration = 0;
  /** The clock time by which, absent an interaction, the idle logout must fire. Read by {@link #onTimer}
   * so a timer that fires early (or after an interaction pushed the deadline out) re-arms for the
   * remainder rather than logging out too soon. */
  #deadline = 0;

  constructor(deps: SessionActivityDeps = {}) {
    this.#wakeLock = deps.wakeLock ?? detectWakeLock();
    this.#now = deps.now ?? (() => Date.now());
    this.#setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
    this.#clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  /** Update who/what the device is; re-applies the wake lock and idle timer immediately when active. */
  configure(config: SessionActivityConfig): void {
    this.#config = config;
    if (this.#active) {
      void this.#applyWakeLock();
      this.#armIdleTimer();
    }
  }

  /** Begin managing the wake lock and idle timer for the current config. The idle timer is armed
   * synchronously (before the first await) so a caller that does not await start() is still guarded. */
  async start(): Promise<void> {
    this.#active = true;
    this.#armIdleTimer();
    await this.#applyWakeLock();
  }

  /** Stop managing anything: release the wake lock and cancel the idle timer. */
  async stop(): Promise<void> {
    this.#active = false;
    this.#clearIdleTimer();
    await this.#release();
  }

  /** Note operator activity — resets the idle countdown. A no-op when no idle timer applies. */
  noteInteraction(): void {
    if (this.#active) this.#armIdleTimer();
  }

  /** Re-request the wake lock (wire to `visibilitychange`): the browser drops it when the tab hides. */
  reacquire(): void {
    if (this.#active) void this.#applyWakeLock();
  }

  #shouldHoldWakeLock(): boolean {
    if (!this.#active) return false;
    // A KDS display never logs in yet must stay awake; a session device stays awake only while logged in.
    return this.#config.kind === "kds_station" || this.#config.loggedIn;
  }

  #shouldRunIdleTimer(): boolean {
    return (
      this.#active &&
      this.#config.loggedIn &&
      this.#config.kind !== "kds_station" &&
      this.#config.timeoutSeconds != null
    );
  }

  async #applyWakeLock(): Promise<void> {
    if (this.#shouldHoldWakeLock()) {
      await this.#acquire();
    } else {
      await this.#release();
    }
  }

  async #acquire(): Promise<void> {
    if (this.#wakeLock === undefined) return; // feature absent — clean no-op
    // Already holding a live lock (the browser releases it on hide, flipping `released`).
    if (this.#sentinel !== undefined && !this.#sentinel.released) return;
    // Capture a fresh token AFTER the early return above, so this acquisition supersedes any older one
    // still in flight (that one will see the mismatch and release its now-orphan sentinel).
    const generation = ++this.#wakeGeneration;
    let sentinel: WakeLockSentinelLike;
    try {
      sentinel = await this.#wakeLock.request("screen");
    } catch {
      // A screen wake lock is best-effort: the request rejects on a hidden tab or where the policy
      // forbids it. Never fatal — the sale path does not depend on the screen staying awake. Only clear
      // our reference when no newer acquisition has run since (else we'd clobber its live sentinel).
      if (generation === this.#wakeGeneration) this.#sentinel = undefined;
      return;
    }
    // The request may have resolved AFTER a stop()/logout (lock no longer wanted) or after a newer
    // acquire superseded this one (token bumped). Either way, release this sentinel now rather than
    // store it — storing it would leave the screen awake with no reference to give it back (C3).
    if (generation !== this.#wakeGeneration || !this.#shouldHoldWakeLock()) {
      try {
        if (!sentinel.released) await sentinel.release();
      } catch {
        // Best-effort — a release that throws still strands no reference we track.
      }
      return;
    }
    this.#sentinel = sentinel;
  }

  async #release(): Promise<void> {
    // Bump the token so any acquire in flight becomes an orphan it must release itself (C3): otherwise
    // a request that resolves after this release would store its sentinel and re-strand the screen.
    this.#wakeGeneration++;
    const sentinel = this.#sentinel;
    this.#sentinel = undefined;
    if (sentinel !== undefined && !sentinel.released) {
      try {
        await sentinel.release();
      } catch {
        // Best-effort — a release that throws still leaves us holding no reference.
      }
    }
  }

  #armIdleTimer(): void {
    this.#clearIdleTimer();
    if (!this.#shouldRunIdleTimer()) return;
    const ms = this.#config.timeoutSeconds! * 1000;
    this.#deadline = this.#now() + ms;
    this.#timer = this.#setTimer(this.#onTimer, ms);
  }

  #clearIdleTimer(): void {
    if (this.#timer !== undefined) {
      this.#clearTimer(this.#timer);
      this.#timer = undefined;
    }
  }

  readonly #onTimer = (): void => {
    if (!this.#shouldRunIdleTimer()) return;
    const remaining = this.#deadline - this.#now();
    if (remaining > 0) {
      // Fired early, or an interaction pushed the deadline out — wait the remainder.
      this.#timer = this.#setTimer(this.#onTimer, remaining);
      return;
    }
    this.#timer = undefined;
    this.#config.onIdle();
  };
}
