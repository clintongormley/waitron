import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { markIncidentHandled } from "@waitron/core";
import { incidents, withTransaction, type Database, type Transaction } from "@waitron/db";
import type { ClockStepRequest, TrustedClock } from "@waitron/fiscal";
import type { ModuleClockSetAnswer, ModuleClockSetRequest } from "@waitron/module";
import { codeOf } from "@waitron/server-kit";
import { AppError, diskFullIn, jobOrigin, type ErrorParams } from "@waitron/shared";
import { SETUP_CLOCK_STEP_FILE } from "@waitron/store";
import { bootReader, type BootReader } from "./boot-reader.js";
import type { EmailedIncident } from "./box-alert-email.js";
import type { BoxHostClient } from "./box-host-client.js";
import { clockCorrection, moduleClockSetAnswer } from "./clock-correction.js";
import { errnoOf } from "./errno.js";
import { writeFileDurable } from "./fs-atomic.js";
import type { Logger } from "./logger.js";
import { startClockState } from "./start-clock-check.js";
import { systemClock } from "./till-backend.js";
import "./errors.js";

/** One step noted while the venue did not exist yet, raised as `clock.corrected` under `id`. */
export interface SetupClockStep {
  readonly id: string;
  readonly detectedAt: string;
  readonly params: ErrorParams["clock.corrected"];
}

/** The person a step is made for: the administrator reserved at first setup's claim, or nobody. */
export type SetupClockPerson = { readonly id: string; readonly name: string } | null;

const notePath = (stateDir: string) => join(stateDir, SETUP_CLOCK_STEP_FILE);

async function readSetupClockSteps(stateDir: string): Promise<SetupClockStep[] | null> {
  try {
    return JSON.parse(await readFile(notePath(stateDir), "utf8")) as SetupClockStep[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function noteEntry(request: ClockStepRequest, id: string): SetupClockStep {
  const person = request.admin?.personName ?? null;
  return {
    id,
    detectedAt: request.after.instant.toISOString(),
    params: {
      confirmationId: null,
      source: "setup",
      person,
      deviceId: null,
      device: null,
      before: request.before.instant.toISOString(),
      beforeOffsetMinutes: request.before.offsetMinutes,
      after: request.after.instant.toISOString(),
      afterOffsetMinutes: request.after.offsetMinutes,
      stepMs: request.stepMs,
      direction: request.stepMs < 0 ? "back" : "forward",
      verified: request.verified,
      unverified: !request.verified,
      byAdmin: false,
      byStaff: false,
      ...(person === null ? { bySetup: true as const } : { bySetupAdmin: true as const }),
    },
  };
}

/** No step here reads or writes the venue database: there is no stop to judge and the step goes to
 * the setup note, so the setter takes neither the write lock nor the venue folder's lock. */
const withoutDatabase = <T>(fn: (tx: Transaction) => Promise<T>) =>
  fn(undefined as unknown as Transaction);

export type SetupClockSetter = (
  request: ModuleClockSetRequest,
  person: () => Promise<SetupClockPerson>,
) => Promise<ModuleClockSetAnswer>;

export interface SetupClockSet extends SetupClockSetter {
  /** Notes the steps whose note could not be written when they were made; throws
   * `storage.disk_full` while one cannot be for want of space, otherwise
   * `setup.clock_step_unsaved`, each with the failed write as its cause. Setup and restore call it
   * before they finish, since the step lives only in this process until it is noted. */
  writePending(): Promise<void>;
}

/** Sets the box's clock from the setup or restore page, before the venue exists: the setter the
 * full start uses, with no stop, no witnesses and a start nothing confirms by the internet, whose
 * every step that moved the clock or was verified is appended to the setup note. `set` reads the
 * steps made so far before its first await, then asks `person`. */
export function createSetupClockSet(deps: {
  stateDir: string;
  host: BoxHostClient;
  clock?: Pick<TrustedClock, "now">;
  boot?: Pick<BootReader, "readBoot">;
  /** The steady clock must be the one the module measured `measuredAt.monoMs` on. */
  wall?: () => number;
  monotonic?: () => number;
  log: Logger;
}): SetupClockSet {
  // One id per step across retries: a write that throws after replacing the note has landed.
  const ids = new WeakMap<ClockStepRequest, string>();
  const correction = clockCorrection({
    host: deps.host,
    backend: {
      assertRecordableAt: () => {},
      confirmClockStep: async (_tx, request) => {
        const id = ids.get(request) ?? randomUUID();
        ids.set(request, id);
        const entry = noteEntry(request, id);
        const noted = (await readSetupClockSteps(deps.stateDir)) ?? [];
        if (!noted.some((step) => step.id === id))
          await writeFileDurable(notePath(deps.stateDir), JSON.stringify([...noted, entry]), 0o600);
        return { confirmation: null, corrected: { id: entry.id, params: entry.params } };
      },
    },
    store: { clear: () => {}, witnesses: () => [] },
    clock: deps.clock ?? systemClock(),
    wall: deps.wall,
    monotonic: deps.monotonic,
    boot: deps.boot ?? bootReader(),
    read: withoutDatabase,
    transaction: withoutDatabase,
    nodeId: "",
    log: deps.log,
    start: { state: startClockState(), heads: async () => ({}) },
  });
  const set: SetupClockSetter = async (request, person) => {
    const stepsSeen = correction.steps();
    try {
      await correction.writePending();
    } catch (error) {
      // The step stays pending, and this press is refused for it.
      deps.log("warn", "setup_clock_step.note_failed", { errorCode: codeOf(error) });
    }
    const who = await person();
    return moduleClockSetAnswer(
      await correction.set({
        reason: "start",
        source: "setup",
        offsetMs: request.offsetMs,
        measuredAt: { ...request.measuredAt },
        stepsSeen,
        witnesses: [],
        // With nobody to carry the reading, its uncertainty narrows the window instead.
        agreesWithinMs:
          who === null
            ? request.agreesWithinMs - request.reading.uncertaintyMs
            : request.agreesWithinMs,
        ...(who === null
          ? {}
          : { admin: { personId: who.id, personName: who.name, reading: { ...request.reading } } }),
        requester: { source: "setup", person: who?.id ?? null },
      }),
    );
  };
  const writePending = async () => {
    try {
      await correction.writePending();
    } catch (cause) {
      const full = diskFullIn(cause) || errnoOf(cause) === "ENOSPC";
      throw Object.assign(
        full ? new AppError("storage.disk_full", {}) : new AppError("setup.clock_step_unsaved", {}),
        { cause },
      );
    }
  };
  return Object.assign(set, { writePending });
}

/** At the venue's first full start: one `clock.corrected` per noted step under the step's id, each
 * marking the open one before it handled as a running box's steps do, all handed to the email duty;
 * then the note is deleted. An id already present is not inserted again; a failure leaves the note
 * for the next start. */
export async function raiseSetupClockSteps(deps: {
  db: Database;
  stateDir: string;
  remember: (incident: EmailedIncident) => void;
  log: Logger;
}): Promise<void> {
  try {
    await raise(deps);
  } catch (error) {
    // The note stays for the next start; the box still starts.
    deps.log("warn", "setup_clock_step.raise_failed", { errorCode: codeOf(error) });
  }
}

async function raise(deps: Parameters<typeof raiseSetupClockSteps>[0]): Promise<void> {
  const steps = await readSetupClockSteps(deps.stateDir);
  if (steps === null) return;
  const origin = jobOrigin("dashboard");
  await withTransaction(deps.db, async (tx) => {
    for (const step of steps) {
      const [present] = await tx
        .select({ id: incidents.id })
        .from(incidents)
        .where(eq(incidents.id, step.id));
      if (present !== undefined) continue;
      // A copy of the regime's `recordCorrected` (fiscal-verifactu clock-stop-incidents.ts), which
      // server code may not import (scripts/module-seams.test.ts) and which takes no id.
      const open = await tx
        .select({ id: incidents.id, detectedAt: incidents.detectedAt })
        .from(incidents)
        .where(
          and(
            eq(incidents.source, origin.source),
            isNull(incidents.deviceId),
            eq(incidents.code, "clock.corrected"),
            isNull(incidents.acknowledgedAt),
          ),
        );
      for (const { id, detectedAt } of open)
        await markIncidentHandled(tx, {
          id,
          personId: null,
          handledAt: new Date(Math.max(Date.parse(detectedAt), Date.parse(step.detectedAt))),
        });
      await tx.insert(incidents).values({
        id: step.id,
        source: origin.source,
        deviceId: null,
        code: "clock.corrected",
        params: { ...step.params },
        severity: "warning",
        detectedAt: step.detectedAt,
      });
    }
  });
  for (const step of steps)
    deps.remember({ id: step.id, code: "clock.corrected", params: step.params });
  await rm(notePath(deps.stateDir), { force: true });
  deps.log("info", "setup_clock_step.raised", { count: steps.length });
}
