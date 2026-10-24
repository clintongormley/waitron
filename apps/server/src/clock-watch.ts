import type { Transaction } from "@waitron/db";
import {
  judgeClockWitnesses,
  type ClockProvedWrong,
  type ClockWitness,
  type FiscalBackend,
  type TrustedClock,
} from "@waitron/fiscal";
import { codeOf } from "@waitron/server-kit";
import { bootReader, type BootReader, type BootReading } from "./boot-reader.js";
import { readClockStopState } from "./box-health.js";
import type { ClockWitnessStore } from "./clock-witnesses.js";
import type { Logger } from "./logger.js";
import { unrefTimer, type Timer } from "./unref-timer.js";

export const CLOCK_WATCH_MS = 15_000;

/** The least steady-clock time between two asks of AEAT's time; `authorityDue` says when it does
 * not hold. */
const AUTHORITY_EVERY_MS = 60_000;

type Reading = ReturnType<TrustedClock["now"]>;

/** How much further the wall clock may move than the elapsed-time clock between two checks before
 * the wall clock is taken to have jumped. */
const JUMP_MS = 60_000;

/** The most unrecorded disproofs kept while every record fails: forward jumps, and AEAT's
 * disagreements from the watch's own asks and from AEAT's replies to filings
 * (`aeat-transport.ts`). Past it the earliest are kept. */
const PENDING_MAX = 1_440;

/** Checks every `intervalMs`, the first one `intervalMs` after start, each next one armed after the
 * last finished, on the primary only. While the box's reading is more than a minute behind the
 * latest record (a stop, or a stop a confirmation lifted), each check offers the seat a clock check
 * to open, confirms the clock when the witnesses are ready, and asks AEAT's time when an ask is
 * due; while a check waits after its stop ended by itself, each check does the same ask and offers
 * the seat the witnesses to close it. `stop` resolves once a check in flight has finished; nothing is read,
 * asked or written after it. */
export function startClockWatch(deps: {
  backend: Pick<
    FiscalBackend,
    | "assertRecordableAt"
    | "clockStopState"
    | "noteClockProvedWrong"
    | "readAuthorityTime"
    | "openClockCheck"
    | "confirmClockStop"
    | "waitingClockCheck"
    | "closeClockCheckByItself"
  >;
  store: Pick<
    ClockWitnessStore,
    "noteAuthority" | "witnesses" | "takeNewAuthority" | "endStop" | "clear"
  >;
  clock: Pick<TrustedClock, "now">;
  wall?: () => number;
  /** The steady clock; the boot reader's elapsed time when absent. */
  monotonic?: () => number;
  boot?: Pick<BootReader, "readBoot" | "elapsed">;
  nodeId: string;
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
  const boot = deps.boot ?? bootReader();
  const monotonic = deps.monotonic ?? boot.elapsed;
  let stopped = false;
  let lastAuthorityMs: number | null = null;
  let lastCheckId: string | null = null;
  let running: Promise<void> | null = null;
  let previous = { wallMs: wall(), monoMs: monotonic() };

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

  function recordable(reading: Reading): boolean {
    try {
      deps.backend.assertRecordableAt(reading);
      return true;
    } catch {
      return false;
    }
  }

  /** A steady clock that cannot be read, or that went backwards, does not hold AEAT back. */
  function authorityDue(): boolean {
    if (lastAuthorityMs === null) return true;
    const since = monotonic() - lastAuthorityMs;
    return !(since >= 0 && since < AUTHORITY_EVERY_MS);
  }

  async function openCheck(
    reading: Pick<Reading, "instant" | "offsetMinutes">,
    bootAt: BootReading,
  ): Promise<void> {
    if (deps.backend.openClockCheck === undefined) return;
    const check = await deps.transaction((tx) =>
      deps.backend.openClockCheck!(tx, { reading, boot: bootAt, nodeId: deps.nodeId }),
    );
    // A watch started during a stop logs the check it finds open once, as if it had opened it.
    if (check !== null && check.id !== lastCheckId) {
      deps.log("info", "clock_watch.stop_opened", { checkId: check.id });
    }
    lastCheckId = check?.id ?? lastCheckId;
  }

  async function confirm(
    reading: Pick<Reading, "instant" | "offsetMinutes">,
    bootAt: BootReading,
    witnesses: readonly ClockWitness[],
  ): Promise<void> {
    if (deps.backend.confirmClockStop === undefined) return;
    const { confirmation } = await deps.transaction((tx) =>
      deps.backend.confirmClockStop!(tx, {
        reading,
        boot: bootAt,
        witnesses,
        nodeId: deps.nodeId,
      }),
    );
    if (confirmation === null) return;
    deps.store.clear();
    deps.log("info", "clock_watch.confirmed", {
      confirmationId: confirmation.id,
      source: confirmation.source,
    });
  }

  async function askAuthority(): Promise<void> {
    if (!deps.filesRecords() || deps.backend.readAuthorityTime === undefined || !authorityDue())
      return;
    lastAuthorityMs = monotonic();
    const sample = await deps.backend.readAuthorityTime();
    if (stopped) return;
    if (sample !== null) deps.store.noteAuthority(sample);
  }

  /** AEAT is asked before the closing, so an answer it gives on this check can close the check. */
  async function closeWaiting(
    reading: Pick<Reading, "instant" | "offsetMinutes">,
    bootAt: BootReading,
  ): Promise<void> {
    const { waitingClockCheck, closeClockCheckByItself } = deps.backend;
    if (waitingClockCheck === undefined || closeClockCheckByItself === undefined) return;
    const waiting = await deps.read((tx) => deps.backend.waitingClockCheck!(tx, reading));
    if (waiting === null || stopped) return;
    await askAuthority();
    if (stopped) return;
    const { confirmation } = await deps.transaction((tx) =>
      deps.backend.closeClockCheckByItself!(tx, {
        reading,
        boot: bootAt,
        witnesses: deps.store.witnesses(),
        nodeId: deps.nodeId,
      }),
    );
    if (confirmation === null) return;
    deps.store.clear();
    deps.log("info", "clock_watch.check_closed", {
      confirmationId: confirmation.id,
      source: confirmation.source,
    });
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
    let reading: Reading | undefined;
    let bootAt: BootReading | undefined;
    let judged: readonly ClockWitness[] = [];
    if (deps.backend.clockStopState !== undefined) {
      stop = await deps.read((tx) =>
        readClockStopState(tx, {
          backend: deps.backend,
          witnesses: () => (judged = deps.store.witnesses()),
          clock: {
            now: () => {
              reading = deps.clock.now();
              bootAt = boot.readBoot();
              return reading;
            },
          },
        }),
      );
    }
    if (stopped) return;
    if (stop === null) {
      // The seat answers no stop both at a reading no record could carry (before 28-10-2024) and
      // at one not behind the latest record; only the second ends the stop, and with it AEAT's
      // disagreements (plan decision 4).
      if (reading === undefined || recordable(reading)) deps.store.endStop();
      if (reading !== undefined) {
        try {
          await closeWaiting(
            { instant: reading.instant, offsetMinutes: reading.offsetMinutes },
            bootAt!,
          );
        } catch (error) {
          deps.log("warn", "clock_watch.check_failed", { errorCode: codeOf(error) });
        }
        if (stopped) return;
      }
    } else {
      const at = { instant: reading!.instant, offsetMinutes: reading!.offsetMinutes };
      // A write that keeps failing must not keep the confirmation, AEAT's time and the disproofs
      // from running. The opening and the confirmation are separate transactions so that the
      // opening survives a failing confirmation.
      try {
        await openCheck(at, bootAt!);
      } catch (error) {
        deps.log("warn", "clock_watch.check_failed", { errorCode: codeOf(error) });
      }
      if (stopped) return;
      if (stop.proof === "ready") {
        try {
          await confirm(at, bootAt!, judged);
        } catch (error) {
          deps.log("warn", "clock_watch.check_failed", { errorCode: codeOf(error) });
        }
      }
      if (stopped) return;
      await askAuthority();
      if (stopped) return;
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
