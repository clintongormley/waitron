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
import type { ClockAnchor, clockCorrection } from "./clock-correction.js";
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

/** How long the watch asks for no automatic set in a stop after the host refused one, timed out
 * or did not verify it; doubled after each further failure, up to `SET_BACKOFF_MAX_MS`. */
const SET_BACKOFF_MS = 10 * 60_000;
const SET_BACKOFF_MAX_MS = 4 * 60 * 60_000;

/** Checks every `intervalMs`, the first one `intervalMs` after start, each next one armed after the
 * last finished, on the primary only. While the seat answers a clock stop state, each check offers
 * the seat a clock check to open, confirms the clock when the witnesses are ready, and asks AEAT's
 * time when an ask is due; while the seat answers a waiting check, each check does the same ask and
 * offers the seat the witnesses to close it. `stop` resolves once a check in flight has finished,
 * and no check runs after it; a disproof write that `stepComing` or `reanchor` began before it can
 * still finish later. As a set's anchor, it takes no jump from the wall clock between
 * `stepComing` and `reanchor`, and each of them first records the disproof of every disagreeing
 * AEAT reading not yet taken, or throws. */
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
    "noteAuthority" | "witnesses" | "forSetting" | "takeNewAuthority" | "endStop" | "clear"
  >;
  clock: Pick<TrustedClock, "now">;
  wall?: () => number;
  /** The steady clock; the boot reader's elapsed time when absent. */
  monotonic?: () => number;
  boot?: Pick<BootReader, "readBoot" | "elapsed">;
  nodeId: string;
  read: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
  transaction: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
  /** Sets the clock from AEAT; its one-at-a-time turn is taken around each confirmation's whole
   * transaction. */
  correction?: Pick<
    ReturnType<typeof clockCorrection>,
    "inTurn" | "set" | "steps" | "writePending"
  >;
  filesRecords: () => boolean;
  isPrimary: () => boolean;
  intervalMs: number;
  log: Logger;
  timer?: (ms: number, fn: () => void) => Timer;
}): ClockAnchor & { stop: () => Promise<void> } {
  const timer = deps.timer ?? unrefTimer;
  const wall = deps.wall ?? (() => Date.now());
  const boot = deps.boot ?? bootReader();
  const monotonic = deps.monotonic ?? boot.elapsed;
  let stopped = false;
  let lastAuthorityMs: number | null = null;
  let lastCheckId: string | null = null;
  let running: Promise<void> | null = null;
  let previous = { wallMs: wall(), monoMs: monotonic() };
  /** A set is coming or under way: no look compares the wall clock with `previous`. */
  let held = false;
  let recording: Promise<void> = Promise.resolve();
  const inTurn = deps.correction?.inTurn ?? (<T>(fn: () => Promise<T>) => fn());
  /** By the open check's id: a new stop starts with no backoff. */
  let backoff: { checkId: string | null; failures: number; atMs: number; waitMs: number } | null =
    null;
  let lastRefusal: string | null = null;

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

  /** Each call waits for the one before it to settle, so two never write the same head. */
  function recordPending(): Promise<void> {
    const call = recording.then(recordPendingNow, recordPendingNow);
    recording = call.then(
      () => {},
      () => {},
    );
    return call;
  }

  async function recordPendingNow(): Promise<void> {
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
      for (const confirmationId of unused) {
        deps.log("info", "clock_watch.disproved_unused", { confirmationId, reason: input.reason });
      }
      for (const confirmationId of held) {
        deps.log("warn", "clock_watch.disproved_held", { confirmationId, reason: input.reason });
      }
    }
  }

  function keepDisagreeing(): void {
    const disagreeing = judgeClockWitnesses(deps.store.takeNewAuthority()).authorityDisagrees;
    for (const witness of [...disagreeing].reverse()) {
      keep({
        trustedUntil: new Date(witness.boxAt),
        observedAt: new Date(witness.witnessAt),
        reason: "authority",
      });
    }
  }

  /** Throws when a disproof is left unrecorded because the watch has stopped: the set it guards
   * must not go ahead without it. */
  async function recordUntaken(): Promise<void> {
    keepDisagreeing();
    await recordPending();
    if (stopped && pending.length > 0) throw new Error("clock_watch.stopped");
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
    const { confirmation } = await inTurn(() =>
      deps.transaction((tx) =>
        deps.backend.confirmClockStop!(tx, {
          reading,
          boot: bootAt,
          witnesses,
          nodeId: deps.nodeId,
        }),
      ),
    );
    if (confirmation === null) return;
    deps.store.clear();
    deps.log("info", "clock_watch.confirmed", {
      confirmationId: confirmation.id,
      source: confirmation.source,
    });
  }

  /** A steady clock that cannot be read, or that went backwards, does not hold a set back. */
  function backedOff(): boolean {
    if (backoff === null || backoff.checkId !== lastCheckId) return false;
    const since = monotonic() - backoff.atMs;
    return since >= 0 && since < backoff.waitMs;
  }

  /** Sets the clock to AEAT's disagreeing reading, measured where the store says it arrived. */
  async function setFromAuthority(witness: ClockWitness, stepsSeen: number): Promise<void> {
    const correction = deps.correction;
    if (correction === undefined || backedOff()) return;
    const settable = deps.store
      .forSetting()
      .find(
        (kept) =>
          kept.witness.boxAt === witness.boxAt && kept.witness.witnessAt === witness.witnessAt,
      );
    if (settable === undefined) return;
    const checkId = lastCheckId;
    const answer = await correction.set({
      reason: "behind_chain",
      source: "authority",
      offsetMs: Date.parse(witness.witnessAt) - Date.parse(witness.boxAt),
      measuredAt: { wallMs: settable.at.wallMs, monoMs: settable.at.monoMs },
      stepsSeen,
      witnesses: [settable.witness],
      requester: { source: "authority", check: checkId },
    });
    if (answer.set) {
      backoff = null;
      lastRefusal = null;
      return;
    }
    if (answer.reason !== lastRefusal) {
      deps.log("info", "clock_watch.cannot_set", { reason: answer.reason });
      lastRefusal = answer.reason;
    }
    // Only these asked the host to move the clock; the other refusals toggle nothing.
    if (answer.reason === "refused" || answer.reason === "unverified") {
      const failures = backoff?.checkId === checkId ? backoff.failures + 1 : 1;
      backoff = {
        checkId,
        failures,
        atMs: monotonic(),
        waitMs: Math.min(SET_BACKOFF_MS * 2 ** (failures - 1), SET_BACKOFF_MAX_MS),
      };
    }
  }

  async function askAuthority(): Promise<void> {
    if (!deps.filesRecords() || deps.backend.readAuthorityTime === undefined || !authorityDue())
      return;
    lastAuthorityMs = monotonic();
    const sample = await deps.backend.readAuthorityTime();
    if (stopped) return;
    if (sample !== null) deps.store.noteAuthority(sample);
  }

  /** AEAT is asked before the closing, so an answer it gives on this check can close the check;
   * the closing takes the witnesses, the clock reading and the boot reading together, inside its
   * transaction, so a clock put right while AEAT was asked is not stored as the closing's time;
   * the seat judges the waiting check again at that reading. */
  async function closeWaiting(reading: Pick<Reading, "instant" | "offsetMinutes">): Promise<void> {
    const { waitingClockCheck, closeClockCheckByItself } = deps.backend;
    if (waitingClockCheck === undefined || closeClockCheckByItself === undefined) return;
    const waiting = await deps.read((tx) => deps.backend.waitingClockCheck!(tx, reading));
    if (waiting === null || stopped) return;
    await askAuthority();
    if (stopped) return;
    const { confirmation } = await inTurn(() =>
      deps.transaction(async (tx) => {
        const witnesses = deps.store.witnesses();
        const now = deps.clock.now();
        return deps.backend.closeClockCheckByItself!(tx, {
          reading: { instant: now.instant, offsetMinutes: now.offsetMinutes },
          boot: boot.readBoot(),
          witnesses,
          nodeId: deps.nodeId,
        });
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
    if (!held && current.wallMs - earlier.wallMs - steadyElapsed > JUMP_MS) {
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
    // A step's row is written only after the disproofs measured on the old clock (plan decision 8).
    if (recorded && deps.correction !== undefined) {
      try {
        await deps.correction.writePending();
      } catch (error) {
        deps.log("warn", "clock_watch.check_failed", { errorCode: codeOf(error) });
      }
      if (stopped) return;
    }
    let stop = null;
    let stepsSeen = 0;
    let reading: Reading | undefined;
    let bootAt: BootReading | undefined;
    let judged: readonly ClockWitness[] = [];
    if (deps.backend.clockStopState !== undefined) {
      stop = await deps.read((tx) =>
        readClockStopState(tx, {
          backend: deps.backend,
          witnesses: () => {
            stepsSeen = deps.correction?.steps() ?? 0;
            return (judged = deps.store.witnesses());
          },
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
          await closeWaiting({ instant: reading.instant, offsetMinutes: reading.offsetMinutes });
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
      // Revision 4: only AEAT sets the clock by itself; devices that disagree set nothing.
      if (stop.proof === "contrary" && stop.contrary.authority !== null) {
        try {
          await setFromAuthority(stop.contrary.authority, stepsSeen);
        } catch (error) {
          deps.log("warn", "clock_watch.check_failed", { errorCode: codeOf(error) });
        }
        if (stopped) return;
      }
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
    keepDisagreeing();
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
    stepComing: async () => {
      held = true;
      await recordUntaken();
    },
    reanchor: async () => {
      try {
        await recordUntaken();
      } finally {
        previous = { wallMs: wall(), monoMs: monotonic() };
        held = false;
      }
    },
    stop: async () => {
      stopped = true;
      armed.cancel();
      await running;
    },
  };
}
