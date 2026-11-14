import type { Transaction } from "@waitron/db";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { codeOf } from "@waitron/server-kit";
import type { ClockServiceStatus } from "./box-host-client.js";
import type { clockCorrection } from "./clock-correction.js";
import type { ClockStartUp } from "./clock-start-up.js";
import type { ClockWitnessStore } from "./clock-witnesses.js";
import type { Logger } from "./logger.js";
import type { JobDefinition } from "./job-runner.js";
import { lookAtClockService, type ChainHeads, type StartClockState } from "./start-clock-check.js";

export const CLOCK_WATCH_MS = 15_000;

export function createClockWatch(deps: {
  backend: Pick<FiscalBackend, "assertRecordableAt">;
  store: Pick<ClockWitnessStore, "witnesses">;
  clock: Pick<TrustedClock, "now">;
  read: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
  /** The correction's one-at-a-time turn, taken around the devices' confirmation; each look also
   * writes the rows of steps whose rows could not be written when they happened. */
  correction?: Pick<ReturnType<typeof clockCorrection>, "inTurn" | "writePending">;
  /** Closed by a look at a reading a record could carry. */
  startUp?: Pick<ClockStartUp, "noStop">;
  /** The start check: until the internet confirms it, each look reads the time service through
   * `clockStatus`, and while it waits, offers it the device readings. Never asks AEAT. */
  start?: {
    state: StartClockState;
    clockStatus: () => Promise<ClockServiceStatus>;
    heads: (tx: Transaction) => Promise<ChainHeads>;
  };
  log: Logger;
}): { check(): Promise<void>; halt(): void } {
  let stopped = false;
  const inTurn = deps.correction?.inTurn ?? (<T>(fn: () => Promise<T>) => fn());

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

  async function check(): Promise<void> {
    try {
      await lookForStart();
    } catch (error) {
      deps.log("warn", "clock_watch.check_failed", { errorCode: codeOf(error) });
    }
    if (stopped) return;
    if (recordable()) deps.startUp?.noStop();
    // Last, because it waits for the correction's turn, which a set in flight holds.
    try {
      await deps.correction?.writePending();
    } catch (error) {
      deps.log("warn", "clock_watch.check_failed", { errorCode: codeOf(error) });
    }
  }

  return {
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
