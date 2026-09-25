import type { DeviceKind } from "./layout.js";

/** The slice of `navigator.wakeLock` this controller uses. */
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

function detectWakeLock(): WakeLockLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
}

/**
 * Holds a screen wake lock (always on a KDS station, which never logs in; otherwise only while an
 * operator is logged in) and fires `onIdle` after `timeoutSeconds` without interaction (never on a KDS).
 * The browser drops the wake lock when the tab hides, so the caller wires {@link reacquire} to
 * `visibilitychange`.
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
  /** Bumped by every acquire and release, so a `wakeLock.request` that resolves after being superseded
   * releases its sentinel rather than storing it and stranding the screen awake. */
  #wakeGeneration = 0;
  /** When the idle logout is due; a timer that fires before it re-arms for the remainder. */
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

  /** The idle timer is armed before the first await, so a caller that does not await is still guarded. */
  async start(): Promise<void> {
    this.#active = true;
    this.#armIdleTimer();
    await this.#applyWakeLock();
  }

  async stop(): Promise<void> {
    this.#active = false;
    this.#clearIdleTimer();
    await this.#release();
  }

  noteInteraction(): void {
    if (this.#active) this.#armIdleTimer();
  }

  /** Re-request the wake lock (wire to `visibilitychange`): the browser drops it when the tab hides. */
  reacquire(): void {
    if (this.#active) void this.#applyWakeLock();
  }

  #shouldHoldWakeLock(): boolean {
    if (!this.#active) return false;
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
    if (this.#wakeLock === undefined) return;
    if (this.#sentinel !== undefined && !this.#sentinel.released) return;
    const generation = ++this.#wakeGeneration;
    let sentinel: WakeLockSentinelLike;
    try {
      sentinel = await this.#wakeLock.request("screen");
    } catch {
      // Best-effort: the request rejects on a hidden tab or where policy forbids it.
      if (generation === this.#wakeGeneration) this.#sentinel = undefined;
      return;
    }
    if (generation !== this.#wakeGeneration || !this.#shouldHoldWakeLock()) {
      try {
        if (!sentinel.released) await sentinel.release();
      } catch {
        // Best-effort.
      }
      return;
    }
    this.#sentinel = sentinel;
  }

  async #release(): Promise<void> {
    this.#wakeGeneration++;
    const sentinel = this.#sentinel;
    this.#sentinel = undefined;
    if (sentinel !== undefined && !sentinel.released) {
      try {
        await sentinel.release();
      } catch {
        // Best-effort.
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
      this.#timer = this.#setTimer(this.#onTimer, remaining);
      return;
    }
    this.#timer = undefined;
    this.#config.onIdle();
  };
}
