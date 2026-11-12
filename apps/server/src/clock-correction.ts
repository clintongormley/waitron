import type { Transaction } from "@waitron/db";
import type {
  ClockAdminConfirm,
  ClockStep,
  ClockStepRequest,
  ClockWitness,
  FiscalBackend,
  TrustedClock,
} from "@waitron/fiscal";
import { CLOCK_WITNESS_MARGIN_MS } from "@waitron/fiscal";
import type { ModuleClockSetAnswer } from "@waitron/module";
import { codeOf } from "@waitron/server-kit";
import type { LatestClockStep } from "./backup-sweep.js";
import type { BootReader } from "./boot-reader.js";
import type { BoxHostClient, ClockSetAnswer as HostSetAnswer } from "./box-host-client.js";
import type { EmailedIncident } from "./box-alert-email.js";
import type { ClockWitnessStore } from "./clock-witnesses.js";
import type { Logger } from "./logger.js";
import type { ChainHeads, StartClockState } from "./start-clock-check.js";

/** How far a set may land from its target, by the boot-time clock, and still be verified. */
const VERIFY_MS = 2_000;
/** How far the wall clock may move against the steady clock before a measured offset is stale. */
const STALE_MS = 1_000;
/** A step this small is treated as the clock not having moved. */
const MOVED_MS = 1_000;
export const EARLIEST_TARGET_MS = Date.UTC(2024, 9, 28);
export const LATEST_TARGET_MS = Date.UTC(2100, 0, 1);

/** Whether the wall clock moved more than a second against the steady clock between two readings
 * of both. */
export function wallMovedAgainstSteady(
  then: { wallMs: number; monoMs: number },
  now: { wallMs: number; monoMs: number },
): boolean {
  return !(Math.abs(now.wallMs - then.wallMs - (now.monoMs - then.monoMs)) <= STALE_MS);
}

/** Told after every set. A throw from `reanchor` keeps the step's row pending. */
export interface ClockAnchor {
  reanchor(): Promise<void>;
}

export type ClockSetRefusal =
  | "stale"
  | "target_invalid"
  | "not_stopped"
  | "not_start_up"
  | "not_admitted"
  | "host_unavailable"
  | "synchronised"
  | "agrees"
  | "pending_disproofs"
  | "refused"
  | "unverified";

export interface ClockSetInput {
  reason: "unusable" | "start";
  source: "admin" | "staff" | "setup";
  offsetMs: number;
  /** The box's wall and steady clocks when the witness's reading arrived. */
  measuredAt: { wallMs: number; monoMs: number };
  /** `steps()` when the caller measured. */
  stepsSeen: number;
  witnesses: readonly ClockWitness[];
  /** For `staff`, with `role: "staff"`, and for `setup` on first setup. */
  admin?: ClockAdminConfirm;
  /** How close, uncertainty included, a person's offset counts as agreeing; a minute when absent. */
  agreesWithinMs?: number;
  /** Asked in the write-lock turn that judges the stop, after it. */
  admit?: (tx: Transaction) => Promise<"not_admitted" | "not_start_up" | null>;
  /** Ids only: the host writes it to its journal. */
  requester: Record<string, string | null>;
}

export type ClockSetAnswer =
  | { set: true; confirmationId: string | null; stepMs: number; confirmedAt: string }
  | { set: false; reason: ClockSetRefusal };

/** A set's answer as a module's `setBoxClock` gives it, the setter's refusal passed through. */
export function moduleClockSetAnswer(answer: ClockSetAnswer): ModuleClockSetAnswer {
  return answer.set ? { status: "set" } : { status: "refused", reason: answer.reason };
}

/** Sets the box's clock while the start waits or the clock reads before 28-10-2024, one set at a
 * time: judges the stop again, asks the host, verifies the step on the boot-time clock and
 * records it. */
export function clockCorrection(deps: {
  host: BoxHostClient;
  backend: Pick<FiscalBackend, "confirmClockStep" | "assertRecordableAt">;
  store: Pick<ClockWitnessStore, "clear">;
  clock: Pick<TrustedClock, "now">;
  wall?: () => number;
  monotonic?: () => number;
  boot: Pick<BootReader, "readBoot">;
  /** A write-lock turn with no drain. */
  read: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
  transaction: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
  /** The email duty's `remember`. */
  onCorrected?: (incident: EmailedIncident) => void;
  nodeId: string;
  log: Logger;
  /** The start's clock check, which admits a set at reason `start` until it is confirmed by the
   * internet, and the chain heads a person's set there marks it with. */
  start?: { state: StartClockState; heads(tx: Transaction): Promise<ChainHeads> };
}): {
  addAnchor(anchor: ClockAnchor): void;
  steps(): number;
  /** The one-at-a-time turn. Taken before any transaction, never inside one: a transaction holds
   * the write lock a set in the turn waits for. */
  inTurn<T>(fn: () => Promise<T>): Promise<T>;
  set(input: ClockSetInput): Promise<ClockSetAnswer>;
  /** Writes, in the turn and oldest first, the rows of steps that could not be written when they
   * happened. No set is made while one is pending, so they are always the latest steps. */
  writePending(): Promise<void>;
  /** `"setting"` from just before the host is asked until its answer is judged; then the step
   * made, until its row is written; otherwise null. */
  unwrittenStep(): ClockStep | "setting" | null;
} {
  const wall = deps.wall ?? (() => Date.now());
  const monotonic = deps.monotonic ?? (() => performance.now());
  const anchors: ClockAnchor[] = [];
  const pending: ClockStepRequest[] = [];
  let unwritten: ClockStep | "setting" | null = null;
  let steps = 0;
  let turn: Promise<unknown> = Promise.resolve();

  function inTurn<T>(fn: () => Promise<T>): Promise<T> {
    const result = turn.then(fn);
    turn = result.catch(() => {});
    return result;
  }

  function reading() {
    const now = deps.clock.now();
    return { instant: now.instant, offsetMinutes: now.offsetMinutes };
  }

  function unusable(at: ReturnType<typeof reading>): boolean {
    try {
      deps.backend.assertRecordableAt(at);
      return false;
    } catch (error) {
      if (codeOf(error) === "clock.unusable") return true;
      throw error;
    }
  }

  function agrees(input: ClockSetInput): boolean {
    const uncertaintyMs = input.admin?.reading.uncertaintyMs ?? 0;
    return (
      Math.abs(input.offsetMs) + uncertaintyMs <= (input.agreesWithinMs ?? CLOCK_WITNESS_MARGIN_MS)
    );
  }

  async function reanchorAll(): Promise<boolean> {
    let ok = true;
    for (const anchor of anchors) {
      try {
        await anchor.reanchor();
      } catch (error) {
        ok = false;
        deps.log("warn", "clock_correction.reanchor_failed", { errorCode: codeOf(error) });
      }
    }
    return ok;
  }

  /** Throws only when the row was not written. */
  async function write(request: ClockStepRequest): Promise<string | null> {
    if (deps.backend.confirmClockStep === undefined) return null;
    const { confirmation, corrected } = await deps.transaction((tx) =>
      deps.backend.confirmClockStep!(tx, request),
    );
    if (corrected !== null) {
      try {
        deps.onCorrected?.({ id: corrected.id, code: "clock.corrected", params: corrected.params });
      } catch (error) {
        deps.log("warn", "clock_correction.email_failed", { errorCode: codeOf(error) });
      }
    }
    return confirmation?.id ?? null;
  }

  function keep(request: ClockStepRequest, error: unknown): void {
    pending.push(request);
    deps.log("warn", "clock_correction.row_pending", {
      errorCode: error === undefined ? null : codeOf(error),
      stepMs: request.stepMs,
    });
  }

  function stale(input: ClockSetInput): boolean {
    return (
      input.stepsSeen !== steps ||
      wallMovedAgainstSteady(input.measuredAt, { wallMs: wall(), monoMs: monotonic() })
    );
  }

  /** The stop and the till's check, judged in one write-lock turn: at reason `start`, while the
   * start is not confirmed by the internet; at reason `unusable`, while the clock reads before
   * 28-10-2024. */
  async function admission(input: ClockSetInput): Promise<ClockSetRefusal | null> {
    const start = deps.start;
    if (input.reason === "start" && (start === undefined || start.state.status === "by_internet"))
      return "not_stopped";
    return deps.read(async (tx) => {
      if (input.reason === "unusable" && !unusable(reading())) return "not_stopped";
      return input.admit === undefined ? null : input.admit(tx);
    });
  }

  /** A step the host moved but did not verify leaves the clock where nothing confirmed it, so a
   * start confirmed by devices or a person waits again — before any further await, because sales
   * do not take this turn and could otherwise pass the gate on the unconfirmed clock. */
  function unverifiedStep(stepMs: number): void {
    const state = deps.start?.state;
    if (state?.status !== "by_devices" && state?.status !== "by_person") return;
    state.backToWaiting("start");
    deps.log("warn", "clock_start.step_unverified", { stepMs });
  }

  /** A verified set at the start confirms it by a person; a failed heads read leaves the start as
   * it was. */
  async function confirmByPerson(start: NonNullable<typeof deps.start>): Promise<void> {
    try {
      start.state.confirm("by_person", await deps.read((tx) => start.heads(tx)));
    } catch (error) {
      deps.log("warn", "clock_start.mark_failed", { errorCode: codeOf(error) });
    }
  }

  async function setInTurn(input: ClockSetInput): Promise<ClockSetAnswer> {
    // The latest step is read by the order rows were written, so a later step's row written
    // before an earlier one's would leave the earlier step read as the latest.
    if (pending.length > 0) return { set: false, reason: "pending_disproofs" };
    if (stale(input)) return { set: false, reason: "stale" };
    const planned = wall() + input.offsetMs;
    if (!(planned >= EARLIEST_TARGET_MS && planned < LATEST_TARGET_MS))
      return { set: false, reason: "target_invalid" };

    const refusal = await admission(input);
    if (refusal !== null) return { set: false, reason: refusal };

    const status = await deps.host.clockStatus();
    if (!status.available) return { set: false, reason: "host_unavailable" };
    if (status.synchronised) return { set: false, reason: "synchronised" };
    if (agrees(input)) return { set: false, reason: "agrees" };

    // The stop can end while the host's status is awaited.
    const late = await admission(input);
    if (late !== null) return { set: false, reason: late };
    // The wait leaves time for a step by the time service.
    if (stale(input)) return { set: false, reason: "stale" };

    const wallBefore = wall();
    const monoBefore = monotonic();
    const bootBefore = deps.boot.readBoot();
    const before = reading();
    const targetMs = wallBefore + input.offsetMs;
    steps++;
    const unwrittenBefore = unwritten;
    unwritten = "setting";
    try {
      let answer: HostSetAnswer;
      try {
        answer = await deps.host.setClock({ targetMs, requester: input.requester });
      } catch (error) {
        // The request may have reached the host, so the clock may have moved.
        deps.log("warn", "clock_correction.set_threw", { errorCode: codeOf(error) });
        answer = { available: false, reason: "lost" };
      }
      const wallAfter = wall();
      const monoAfter = monotonic();
      const bootAfter = deps.boot.readBoot();
      const after = reading();
      const bootDifference = bootAfter.ms - bootBefore.ms;
      const bootElapsed = Number.isFinite(bootDifference) ? bootDifference : monoAfter - monoBefore;
      const stepMs = wallAfter - wallBefore - bootElapsed;
      // A host that did not answer may still have moved the clock, but never confirmed it.
      const verified =
        answer.available && Math.abs(wallAfter - (targetMs + bootElapsed)) <= VERIFY_MS;
      const moved = Math.abs(stepMs) > MOVED_MS;
      if (!verified && moved) unverifiedStep(stepMs);

      unwritten = verified || moved ? { confirmedAt: after.instant.toISOString(), stepMs } : null;
      const anchored = await reanchorAll();
      if (!verified && !moved) {
        deps.log("warn", "clock_correction.set_refused", {
          reason: answer.available ? "unmoved" : answer.reason,
        });
        // No socket: the request never reached the host, so nothing was refused or tried.
        if (!answer.available && answer.reason === "missing")
          return { set: false, reason: "host_unavailable" };
        return { set: false, reason: "refused" };
      }
      deps.store.clear();
      const request: ClockStepRequest = {
        before,
        after,
        bootBefore,
        bootAfter,
        targetAt: new Date(targetMs).toISOString(),
        stepMs,
        verified,
        reason: input.reason,
        source: input.source,
        witnesses: input.witnesses,
        ...(input.admin === undefined ? {} : { admin: input.admin }),
        nodeId: deps.nodeId,
      };
      let confirmationId: string | null = null;
      if (!anchored) keep(request, undefined);
      else {
        try {
          confirmationId = await write(request);
          unwritten = null;
        } catch (error) {
          keep(request, error);
        }
      }
      deps.log("info", "clock_correction.stepped", { source: input.source, stepMs, verified });
      if (verified && input.reason === "start" && deps.start !== undefined)
        await confirmByPerson(deps.start);
      return verified
        ? { set: true, confirmationId, stepMs, confirmedAt: after.instant.toISOString() }
        : { set: false, reason: "unverified" };
    } finally {
      if (unwritten === "setting") unwritten = unwrittenBefore;
    }
  }

  return {
    addAnchor: (anchor) => void anchors.push(anchor),
    steps: () => steps,
    inTurn,
    set: (input) => inTurn(() => setInTurn(input)),
    writePending: () =>
      inTurn(async () => {
        while (pending.length > 0) {
          await write(pending[0]!);
          pending.shift();
        }
        unwritten = null;
      }),
    unwrittenStep: () => unwritten,
  };
}

/** The latest step for the backups' clock-step hold. The unwritten step is read first, so a row
 * committed between the two reads is found by the second. */
export function latestClockStepFor(
  correction: { unwrittenStep(): ClockStep | "setting" | null },
  recorded: () => Promise<ClockStep | null>,
): () => Promise<LatestClockStep> {
  return async () => correction.unwrittenStep() ?? (await recorded());
}
