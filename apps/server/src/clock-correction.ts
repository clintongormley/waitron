import type { Transaction } from "@waitron/db";
import type {
  ClockAdminConfirm,
  ClockStepRequest,
  ClockWitness,
  FiscalBackend,
  TrustedClock,
} from "@waitron/fiscal";
import { CLOCK_WITNESS_MARGIN_MS } from "@waitron/fiscal";
import { codeOf } from "@waitron/server-kit";
import type { BootReader } from "./boot-reader.js";
import type { BoxHostClient } from "./box-host-client.js";
import type { EmailedIncident } from "./box-alert-email.js";
import type { ClockWitnessStore } from "./clock-witnesses.js";
import type { Logger } from "./logger.js";

/** How far a set may land from its target, by the boot-time clock, and still be verified. */
const VERIFY_MS = 2_000;
/** How far the wall clock may move against the steady clock before a measured offset is stale. */
const STALE_MS = 1_000;
/** A step this small is treated as the clock not having moved. */
const MOVED_MS = 1_000;
const EARLIEST_TARGET_MS = Date.UTC(2024, 9, 28);
const LATEST_TARGET_MS = Date.UTC(2100, 0, 1);

/** Told before and after every set. A throw from `stepComing` refuses the set; a throw from
 * `reanchor` keeps the step's row pending. */
export interface ClockAnchor {
  stepComing(): Promise<void>;
  reanchor(): Promise<void>;
}

export type ClockSetRefusal =
  | "stale"
  | "target_invalid"
  | "not_stopped"
  | "not_start_up"
  | "authority_pending"
  | "not_admitted"
  | "host_unavailable"
  | "synchronised"
  | "witnessed"
  | "agrees"
  | "pending_disproofs"
  | "refused"
  | "unverified";

export interface ClockSetInput {
  reason: "behind_chain" | "unusable";
  source: "authority" | "admin" | "staff";
  offsetMs: number;
  /** The box's wall and steady clocks when the witness's reading arrived. */
  measuredAt: { wallMs: number; monoMs: number };
  /** `steps()` when the caller measured. */
  stepsSeen: number;
  witnesses: readonly ClockWitness[];
  /** For `admin` and `staff`; for `staff`, with `role: "staff"`. */
  admin?: ClockAdminConfirm;
  /** Asked in the write-lock turn that judges the stop, after it. */
  admit?: (
    tx: Transaction,
  ) => Promise<"not_admitted" | "not_start_up" | "authority_pending" | null>;
  /** Ids only: the host writes it to its journal. */
  requester: Record<string, string | null>;
}

export type ClockSetAnswer =
  | { set: true; confirmationId: string | null; stepMs: number; confirmedAt: string }
  | { set: false; reason: ClockSetRefusal };

/** Sets the box's clock during a stop, one set at a time: judges the stop again, asks the host,
 * verifies the step on the boot-time clock and records it. */
export function clockCorrection(deps: {
  host: BoxHostClient;
  backend: Pick<FiscalBackend, "confirmClockStep" | "clockStopState" | "assertRecordableAt">;
  store: Pick<ClockWitnessStore, "clear" | "witnesses">;
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
} {
  const wall = deps.wall ?? (() => Date.now());
  const monotonic = deps.monotonic ?? (() => performance.now());
  const anchors: ClockAnchor[] = [];
  const pending: ClockStepRequest[] = [];
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

  /** Whether the stop still holds, and whether AEAT has a reading taken during it. */
  async function judge(
    tx: Transaction,
    reason: ClockSetInput["reason"],
  ): Promise<{ stopped: boolean; authoritySpoke: boolean }> {
    const at = reading();
    if (reason === "unusable") {
      // The store keeps AEAT's disagreements until a usable reading ends the stop, so one taken
      // before the clock read a date before 28-10-2024 was not taken during this stop.
      return {
        stopped: unusable(at),
        authoritySpoke: deps.store
          .witnesses()
          .some(
            (witness) =>
              witness.kind === "authority" && Date.parse(witness.boxAt) < EARLIEST_TARGET_MS,
          ),
      };
    }
    if (deps.backend.clockStopState === undefined) return { stopped: false, authoritySpoke: false };
    const state = await deps.backend.clockStopState(tx, at, deps.store.witnesses());
    if (state === null || state.proof === "confirmed")
      return { stopped: false, authoritySpoke: false };
    return {
      stopped: true,
      authoritySpoke: state.agreeing.authority !== null || state.contrary.authority !== null,
    };
  }

  function agrees(input: ClockSetInput): boolean {
    const uncertaintyMs = input.admin?.reading.uncertaintyMs ?? 0;
    return Math.abs(input.offsetMs) + uncertaintyMs <= CLOCK_WITNESS_MARGIN_MS;
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
    const sinceWall = wall() - input.measuredAt.wallMs;
    const sinceSteady = monotonic() - input.measuredAt.monoMs;
    return input.stepsSeen !== steps || !(Math.abs(sinceWall - sinceSteady) <= STALE_MS);
  }

  /** The stop and the till's check, judged in one write-lock turn. */
  async function admission(
    input: ClockSetInput,
  ): Promise<{ refusal: ClockSetRefusal | null; authoritySpoke: boolean }> {
    return deps.read(async (tx) => {
      const stop = await judge(tx, input.reason);
      if (!stop.stopped) return { refusal: "not_stopped" as const, authoritySpoke: false };
      const refusal = input.admit === undefined ? null : await input.admit(tx);
      return { refusal, authoritySpoke: stop.authoritySpoke };
    });
  }

  function personRefusal(input: ClockSetInput, authoritySpoke: boolean): ClockSetRefusal | null {
    if (input.source === "authority") return null;
    if (authoritySpoke) return "witnessed";
    if (agrees(input)) return "agrees";
    return null;
  }

  async function setInTurn(input: ClockSetInput): Promise<ClockSetAnswer> {
    // A later step's row written before an earlier one's would be judged against the wrong check.
    if (pending.length > 0) return { set: false, reason: "pending_disproofs" };
    if (stale(input)) return { set: false, reason: "stale" };
    const planned = wall() + input.offsetMs;
    if (!(planned >= EARLIEST_TARGET_MS && planned < LATEST_TARGET_MS))
      return { set: false, reason: "target_invalid" };

    const judged = await admission(input);
    if (judged.refusal !== null) return { set: false, reason: judged.refusal };

    const status = await deps.host.clockStatus();
    if (!status.available) return { set: false, reason: "host_unavailable" };
    if (status.synchronised) return { set: false, reason: "synchronised" };
    const person = personRefusal(input, judged.authoritySpoke);
    if (person !== null) return { set: false, reason: person };

    for (const anchor of anchors) {
      try {
        await anchor.stepComing();
      } catch (error) {
        deps.log("warn", "clock_correction.step_refused", { errorCode: codeOf(error) });
        await reanchorAll();
        return { set: false, reason: "pending_disproofs" };
      }
    }

    // AEAT can answer, or the stop end, while the host's status and the anchors are awaited.
    const rejudged = await admission(input);
    const late = rejudged.refusal ?? personRefusal(input, rejudged.authoritySpoke);
    if (late !== null) {
      await reanchorAll();
      return { set: false, reason: late };
    }
    // The waits leave time for a step by the time service.
    if (stale(input)) {
      await reanchorAll();
      return { set: false, reason: "stale" };
    }

    const wallBefore = wall();
    const monoBefore = monotonic();
    const bootBefore = deps.boot.readBoot();
    const before = reading();
    const targetMs = wallBefore + input.offsetMs;
    steps++;
    const answer = await deps.host.setClock({ targetMs, requester: input.requester });
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
      } catch (error) {
        keep(request, error);
      }
    }
    deps.log("info", "clock_correction.stepped", { source: input.source, stepMs, verified });
    return verified
      ? { set: true, confirmationId, stepMs, confirmedAt: after.instant.toISOString() }
      : { set: false, reason: "unverified" };
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
      }),
  };
}
