import type { Transaction } from "@waitron/db";
import {
  judgeClockWitnesses,
  type ClockProvedWrong,
  type FiscalBackend,
  type TrustedClock,
} from "@waitron/fiscal";
import { codeOf } from "@waitron/server-kit";
import { readClockStopState } from "./box-health.js";
import type { BoxClockReading, ClockWitnessStore } from "./clock-witnesses.js";
import type { Logger } from "./logger.js";
import { unrefTimer, type Timer } from "./unref-timer.js";

export const CLOCK_WATCH_MS = 60_000;

/** How much further the wall clock may move than the steady clock between two checks before the
 * wall clock is taken to have jumped. */
const JUMP_MS = 60_000;

/** A day of minutely checks while every record fails; past it the earliest entries are kept. */
const PENDING_MAX = 1_440;

/** Checks every `intervalMs`, the first one `intervalMs` after start, each next one armed after the
 * last finished, on the primary only. `stop` resolves once a check in flight has finished; nothing
 * is read, asked or written after it. */
export function startClockWatch(deps: {
  backend: Pick<FiscalBackend, "clockStopState" | "noteClockProvedWrong" | "readAuthorityTime">;
  store: Pick<ClockWitnessStore, "noteAuthority" | "witnesses" | "takeNewAuthority" | "endStop">;
  clock: Pick<TrustedClock, "now">;
  wall?: () => number;
  monotonic?: () => number;
  read: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
  transaction: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
  filesRecords: () => boolean;
  isPrimary: () => boolean;
  intervalMs: number;
  log: Logger;
  timer?: (ms: number, fn: () => void) => Timer;
}): { stop: () => Promise<void> } {
  const timer = deps.timer ?? unrefTimer;
  const wall = deps.wall ?? (() => Date.now());
  const monotonic = deps.monotonic ?? (() => performance.now());
  let stopped = false;
  let running: Promise<void> | null = null;
  let previous: BoxClockReading = { wallMs: wall(), monoMs: monotonic() };

  /** Disproofs not yet recorded, oldest first; each leaves only once its transaction commits. */
  const pending: ClockProvedWrong[] = [];

  function keep(input: ClockProvedWrong): void {
    const same = pending.some(
      (kept) =>
        kept.reason === input.reason &&
        kept.trustedUntil.getTime() === input.trustedUntil.getTime(),
    );
    if (same) return;
    if (pending.length >= PENDING_MAX) {
      deps.log("warn", "clock_watch.disproof_dropped", {
        reason: input.reason,
        trustedUntil: input.trustedUntil.toISOString(),
      });
      return;
    }
    pending.push(input);
  }

  async function recordPending(): Promise<void> {
    const note = deps.backend.noteClockProvedWrong;
    if (note === undefined) {
      pending.length = 0;
      return;
    }
    while (pending.length > 0) {
      if (stopped) return;
      const input = pending[0]!;
      const { unused, held } = await deps.transaction((tx) => note(tx, input));
      pending.shift();
      for (const restartId of unused) {
        deps.log("info", "clock_watch.disproved_unused", { restartId, reason: input.reason });
      }
      for (const restartId of held) {
        deps.log("warn", "clock_watch.disproved_held", { restartId, reason: input.reason });
      }
    }
  }

  async function check(): Promise<void> {
    const current = { wallMs: wall(), monoMs: monotonic() };
    const earlier = previous;
    previous = current;
    if (!deps.isPrimary()) {
      deps.store.takeNewAuthority();
      return;
    }
    const steadyElapsed = current.monoMs - earlier.monoMs;
    if (current.wallMs - earlier.wallMs - steadyElapsed > JUMP_MS) {
      keep({
        trustedUntil: new Date(earlier.wallMs + steadyElapsed),
        observedAt: new Date(current.wallMs),
        reason: "jump",
      });
    }
    let recorded = true;
    try {
      await recordPending();
    } catch (error) {
      // A record that keeps failing must not keep the stop read and AEAT's time from running.
      recorded = false;
      deps.log("warn", "clock_watch.check_failed", { errorCode: codeOf(error) });
    }
    if (stopped) return;
    let stop = null;
    if (deps.backend.clockStopState !== undefined) {
      stop = await deps.read((tx) =>
        readClockStopState(tx, {
          backend: deps.backend,
          witnesses: () => deps.store.witnesses(),
          clock: deps.clock,
        }),
      );
    }
    if (stopped) return;
    if (stop === null) {
      deps.store.endStop();
    } else if (deps.filesRecords() && deps.backend.readAuthorityTime !== undefined) {
      const sample = await deps.backend.readAuthorityTime();
      if (stopped) return;
      if (sample !== null) deps.store.noteAuthority(sample);
    }
    const disagreeing = judgeClockWitnesses(deps.store.takeNewAuthority()).authorityDisagrees;
    for (const witness of [...disagreeing].reverse()) {
      keep({
        trustedUntil: new Date(witness.boxAt),
        observedAt: new Date(witness.witnessAt),
        reason: "authority",
      });
    }
    // Each entry is tried at most once a check; `endStop` and the drain above have already run.
    if (recorded) await recordPending();
  }

  function scheduled(): void {
    if (stopped) return;
    running = check()
      .catch((error: unknown) => {
        deps.log("warn", "clock_watch.check_failed", { errorCode: codeOf(error) });
      })
      .finally(() => {
        running = null;
        if (!stopped) armed = timer(deps.intervalMs, scheduled);
      });
  }

  let armed = timer(deps.intervalMs, scheduled);

  return {
    stop: async () => {
      stopped = true;
      armed.cancel();
      await running;
    },
  };
}
