import type { Transaction } from "@waitron/db";
import type { FiscalBackend, FutureDateRefusal, TrustedClock } from "@waitron/fiscal";
import { codeOf } from "@waitron/server-kit";
import { bootReader } from "./boot-reader.js";
import type { ClockServiceStatus } from "./box-host-client.js";
import type { ClockAnchor, clockCorrection } from "./clock-correction.js";
import type { ClockStartUp } from "./clock-start-up.js";
import type { ClockWitnessStore } from "./clock-witnesses.js";
import type { Logger } from "./logger.js";
import type { JobDefinition } from "./job-runner.js";
import {
  backToWaitingForRefusal,
  backToWaitingUnlessSynchronised,
  lookAtClockService,
  type ChainHeads,
  type StartClockState,
} from "./start-clock-check.js";

export const CLOCK_WATCH_MS = 15_000;
/** How far the wall clock may move against the steady clock between looks, with no set, before
 * the watch counts it as a jump. */
const JUMP_MS = 60_000;

export function createClockWatch(deps: {
  backend: Pick<FiscalBackend, "assertRecordableAt">;
  store: Pick<ClockWitnessStore, "witnesses">;
  clock: Pick<TrustedClock, "now">;
  read: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
  /** The correction's one-at-a-time turn, taken around the devices' confirmation and the jump
   * check; each look also writes the rows of steps whose rows could not be written when they
   * happened. The watch is to be added as its anchor, so a set re-takes the jump check's
   * baseline; its set count covers a set whose re-anchoring did not run. */
  correction?: Pick<ReturnType<typeof clockCorrection>, "inTurn" | "writePending" | "steps">;
  /** Closed by a look at a reading a record could carry. */
  startUp?: Pick<ClockStartUp, "noStop">;
  /** The start check: until the internet confirms it, each look reads the time service through
   * `clockStatus`; while it waits, afresh, offering it the device readings too. After a jump it
   * reads the time service afresh, whatever the status, and sends the box back to waiting unless
   * it is synchronised. Never asks AEAT. */
  start?: {
    state: StartClockState;
    clockStatus: () => Promise<ClockServiceStatus>;
    /** Forgets a cached `clockStatus` reading, so a look sees a service that has just
     * synchronised, or a jump the reading predates. */
    clearClockStatus?: () => void;
    heads: (tx: Transaction) => Promise<ChainHeads>;
    /** This box's chain and the latest sale on it above a position that AEAT refused as dated in
     * the future. At each look, whatever the status, such a refusal of a sale recorded since the
     * latest confirmation, and above any refusal an earlier look found while the time service was
     * synchronised, sends the box back to waiting unless the time service is synchronised. */
    futureDateRefusal?: {
      nodeId: string;
      latest: (tx: Transaction, abovePosition: number) => Promise<FutureDateRefusal | null>;
    };
  };
  /** Read at every look, whatever the start's state, outside the correction's turn: boot hands
   * the shared one-minute reading of a host wrapped by `keepTimeServiceOn`, so reading it is
   * what switches a switched-off time service back on without waiting for a request. */
  readTimeService?: () => Promise<unknown>;
  log: Logger;
  wall?: () => number;
  /** The steady clock; the boot reader's elapsed time when absent, which counts a suspend, so
   * waking from one is not a jump. NaN, from a failed read, is never a jump. */
  monotonic?: () => number;
}): ClockAnchor & { check(): Promise<void>; halt(): void } {
  let stopped = false;
  const inTurn = deps.correction?.inTurn ?? (<T>(fn: () => Promise<T>) => fn());
  const wall = deps.wall ?? Date.now;
  const monotonic = deps.monotonic ?? bootReader().elapsed;
  const steps = () => deps.correction?.steps() ?? 0;
  const reading = () => ({ wallMs: wall(), monoMs: monotonic(), steps: steps() });
  let baseline = reading();
  /** The highest refused position judged while the time service was synchronised: handled, so
   * a later look never sends the box back to waiting for it. */
  let judgedSynchronised = 0;

  function recordable(): boolean {
    try {
      deps.backend.assertRecordableAt(deps.clock.now());
      return true;
    } catch {
      return false;
    }
  }

  async function lookForStart(): Promise<void> {
    const start = deps.start;
    if (start === undefined) return;
    const byInternet = () => start.state.status === "by_internet";
    if (byInternet()) return;
    const heads = () => deps.read(start.heads);
    if (start.state.status === "waiting") start.clearClockStatus?.();
    await lookAtClockService({ state: start.state, clockStatus: start.clockStatus, heads });
    if (stopped) return;
    if (byInternet()) {
      deps.log("info", "clock_start.confirmed", {
        source: "internet",
        boxAt: deps.clock.now().instant.toISOString(),
        heads: start.state.mark,
      });
      return;
    }
    if (start.state.status !== "waiting") return;
    // In the correction's turn, so no set runs while devices confirm, and the readings are read
    // after any set, which clears them when it moves the clock. confirmDevices checks the status
    // again inside the turn, since a set may have changed it while this look waited.
    const agreeing = await inTurn(() => start.state.confirmDevices(deps.store.witnesses(), heads));
    if (agreeing.length === 0) return;
    deps.log("info", "clock_start.confirmed", {
      source: "devices",
      devices: agreeing.map((witness) => witness.id),
      boxAt: deps.clock.now().instant.toISOString(),
      heads: start.state.mark,
    });
  }

  async function lookForRefusal(): Promise<void> {
    const start = deps.start;
    const refusals = start?.futureDateRefusal;
    if (start === undefined || refusals === undefined) return;
    const { state } = start;
    if (state.mark === null) return;
    if (state.status === "waiting" && state.cause === "future_date_refused") return;
    const above = Math.max(state.mark[refusals.nodeId] ?? 0, judgedSynchronised);
    const refusal = await deps.read((tx) => refusals.latest(tx, above));
    if (refusal === null || stopped) return;
    const outcome = await backToWaitingForRefusal(start, refusals.nodeId, refusal);
    const fields = { position: refusal.position, issuedOn: refusal.issuedOn };
    if (outcome === "moved") deps.log("warn", "clock_start.future_date_refused", fields);
    if (outcome === "synchronised") {
      judgedSynchronised = refusal.position;
      deps.log("warn", "clock_start.future_date_refused_synchronised", fields);
    }
  }

  /** In the correction's turn, so no set moves the clock between the readings and its count. A
   * jump sends a box whose time service is not synchronised back to waiting. */
  async function lookForJump(): Promise<void> {
    await inTurn(async () => {
      const before = baseline;
      baseline = reading();
      if (baseline.steps !== before.steps) return;
      const steadyMs = baseline.monoMs - before.monoMs;
      if (!(Math.abs(baseline.wallMs - before.wallMs - steadyMs) > JUMP_MS)) return;
      const start = deps.start;
      start?.clearClockStatus?.();
      const backToWaiting =
        start === undefined ? null : await backToWaitingUnlessSynchronised(start, "clock_jumped");
      deps.log(backToWaiting === true ? "warn" : "info", "clock_watch.jumped", {
        wallBefore: new Date(before.wallMs).toISOString(),
        wallAfter: new Date(baseline.wallMs).toISOString(),
        steadyMs,
        backToWaiting,
      });
    });
  }

  async function check(): Promise<void> {
    try {
      await lookForStart();
    } catch (error) {
      deps.log("warn", "clock_watch.check_failed", { errorCode: codeOf(error) });
    }
    if (stopped) return;
    try {
      await lookForRefusal();
    } catch (error) {
      deps.log("warn", "clock_watch.check_failed", { errorCode: codeOf(error) });
    }
    if (stopped) return;
    if (recordable()) deps.startUp?.noStop();
    // Last, because both wait for the correction's turn, which a set in flight holds.
    try {
      await lookForJump();
    } catch (error) {
      deps.log("warn", "clock_watch.check_failed", { errorCode: codeOf(error) });
    }
    if (stopped) return;
    try {
      await deps.correction?.writePending();
    } catch (error) {
      deps.log("warn", "clock_watch.check_failed", { errorCode: codeOf(error) });
    }
    if (stopped) return;
    // Last, since it may wait for the host to switch the service on.
    try {
      await deps.readTimeService?.();
    } catch (error) {
      deps.log("warn", "clock_watch.check_failed", { errorCode: codeOf(error) });
    }
  }

  return {
    // Runs inside the set's turn, so never between a look's readings and its comparison.
    reanchor: async () => {
      baseline = reading();
    },
    check: async () => {
      try {
        await check();
      } catch (error) {
        deps.log("warn", "clock_watch.check_failed", { errorCode: codeOf(error) });
        throw error;
      }
    },
    halt: () => {
      stopped = true;
    },
  };
}

export type ClockWatch = ReturnType<typeof createClockWatch>;

export function clockWatchJob(watch: ClockWatch, intervalMs: number): JobDefinition {
  let listening = false;
  return {
    name: "clock.watch",
    applies: () => true,
    firstPassAfterMs: intervalMs,
    minSleepMs: intervalMs,
    maxSleepMs: intervalMs,
    backoff: { firstMs: intervalMs, maxMs: intervalMs },
    async pass({ signal }) {
      if (!listening) {
        signal.addEventListener("abort", () => watch.halt(), { once: true });
        listening = true;
      }
      await watch.check();
      return { nextDueAt: null };
    },
    async onStop() {
      if (!listening) watch.halt();
    },
  };
}
