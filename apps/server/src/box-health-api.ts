import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
// The registry of `clock.confirm_refused` and `clock.check_expired`, which this file throws.
import "@waitron/fiscal";
import { authorizeManager } from "@waitron/identity";
import {
  createErrorBoundary,
  readRawJsonBody,
  requireManagementSession,
} from "@waitron/server-kit";
import { AppError, diskFullIn } from "@waitron/shared";
import type { ClockSetRefusal, clockCorrection } from "./clock-correction.js";
import { displayNameOf, type BoxHealth } from "./box-health.js";
import { clockChallenges } from "./clock-challenges.js";
import "./errors.js";
import type { FreedSpace } from "./free-space-now.js";
import type { Logger } from "./logger.js";
import { requestFromBox } from "./request-from-box.js";
import { outgoingOf, restartAfterResponse } from "./restart-after-response.js";

export interface BoxHealthApiDeps {
  db: Database;
  readHealth: () => Promise<BoxHealth>;
  freeSpace: (personId: string) => Promise<FreedSpace>;
  /** Stops this server process; Docker starts it again. */
  restart: () => void;
  /** With a correction and a seat that records a step, mounts `POST /api/box/clock-challenge` and
   * `POST /api/box/clock-set`. */
  clockConfirm: {
    backend: FiscalBackend;
    clock: TrustedClock;
    /** Times each challenge; never stepped by a change of the wall clock. */
    steady: () => number;
    requestFromBox?: (c: Context) => boolean;
    devMode: boolean;
    correction?: Pick<ReturnType<typeof clockCorrection>, "set" | "steps">;
  };
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "clock.check_expired": 400,
  "clock.set_refused": 409,
  "clock.set_failed": 502,
  "clock.unusable": 409,
  "management.request_invalid": 400,
  "alert.not_found": 404,
};

/** When a full disk refuses the transaction (its last-seen stamp or its change-log drain), the same
 * checks run again as reads only, so a full disk does not refuse a manager on the routes that call
 * this. */
export async function authorizeSystemManager(db: Database, c: Context): Promise<string> {
  return authorizeOnAnyDisk(db, c, "system.manage");
}

async function authorizeOnAnyDisk(
  db: Database,
  c: Context,
  permission: "system.manage" | "system.box_admin",
): Promise<string> {
  const sessionId = requireManagementSession(c);
  const check = (tx: Database | Transaction, touch: false | undefined) =>
    authorizeManager(tx, { managementSessionId: sessionId, permission, touch });
  try {
    return (await withTransaction(db, (tx) => check(tx, undefined))).authorizedBy;
  } catch (error) {
    if (!diskFullIn(error)) throw error;
    return (await check(db, false)).authorizedBy;
  }
}

/** Dates beyond this are not times `Date` can hold. */
const LATEST_DATE_MS = 8.64e15;

export function confirmBody(body: unknown): { challengeId: string; deviceAt: number } {
  const fields =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as { challengeId?: unknown; deviceAt?: unknown })
      : {};
  const { challengeId, deviceAt } = fields;
  if (typeof challengeId !== "string" || challengeId === "")
    throw new AppError("management.request_invalid", { field: "challengeId" });
  if (
    typeof deviceAt !== "number" ||
    !Number.isSafeInteger(deviceAt) ||
    Math.abs(deviceAt) > LATEST_DATE_MS
  )
    throw new AppError("management.request_invalid", { field: "deviceAt" });
  return { challengeId, deviceAt };
}

export async function requiredNameOf(tx: Transaction, personId: string): Promise<string> {
  const name = await displayNameOf(tx, personId);
  if (name === null) throw new Error(`no person ${personId}`);
  return name;
}

export function mountBoxHealthApi(app: Hono, deps: BoxHealthApiDeps, log: Logger): void {
  const readRun = createErrorBoundary(STATUS, "box-health.failed");
  const freeRun = createErrorBoundary(STATUS, "box-free-space.failed");
  app.get("/api/box/health", (c) =>
    readRun(c, log, async () => {
      await authorizeSystemManager(deps.db, c);
      return c.json(await deps.readHealth(), 200);
    }),
  );
  app.post("/api/box/free-space", (c) =>
    freeRun(c, log, async () => {
      const personId = await authorizeSystemManager(deps.db, c);
      return c.json(await deps.freeSpace(personId), 200);
    }),
  );
  const restartRun = createErrorBoundary(STATUS, "box-restart.failed");
  app.post("/api/box/restart", (c) =>
    restartRun(c, log, async () => {
      const outgoing = outgoingOf(c);
      if (outgoing === undefined) throw new Error("Missing response lifecycle");
      const personId = await authorizeOnAnyDisk(deps.db, c, "system.manage");
      log("info", "box.restart_requested", { personId });
      restartAfterResponse(outgoing, deps.restart, log);
      return c.json({}, 202);
    }),
  );
  const clockConfirm = deps.clockConfirm;
  const correction = clockConfirm.correction;
  const backend = clockConfirm.backend;
  if (correction === undefined || backend.confirmClockStep === undefined) return;
  const challenges = clockChallenges({
    steady: clockConfirm.steady,
    wall: () => clockConfirm.clock.now().instant.getTime(),
  });
  // An administrator confirms or sets the box's clock against a clock that is not the box's.
  const refuseOnTheBox = (c: Context) => {
    if (!clockConfirm.devMode && (clockConfirm.requestFromBox ?? requestFromBox)(c))
      throw new AppError("clock.set_refused", { reason: "same_machine" });
  };
  const authorizeAdmin = (tx: Transaction, sessionId: string) =>
    authorizeManager(tx, { managementSessionId: sessionId, permission: "system.box_admin" });
  const challengeRun = createErrorBoundary(STATUS, "box-clock-challenge.failed");
  app.post("/api/box/clock-challenge", (c) =>
    challengeRun(c, log, async () => {
      refuseOnTheBox(c);
      const sessionId = requireManagementSession(c);
      await withTransaction(deps.db, (tx) => authorizeAdmin(tx, sessionId));
      const { challengeId, boxAt } = challenges.issue(sessionId);
      return c.json({ challengeId, boxAt: new Date(boxAt).toISOString() }, 200);
    }),
  );
  const setRun = createErrorBoundary(STATUS, "box-clock-set.failed");
  app.post("/api/box/clock-set", (c) =>
    setRun(c, log, async () => {
      refuseOnTheBox(c);
      const sessionId = requireManagementSession(c);
      const { authorizedBy, personName } = await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeAdmin(tx, sessionId);
        return { authorizedBy, personName: await requiredNameOf(tx, authorizedBy) };
      });
      const { challengeId, deviceAt } = confirmBody(await readRawJsonBody<unknown>(c));
      const stepsSeen = correction.steps();
      const reading = clockConfirm.clock.now();
      const steadyMs = clockConfirm.steady();
      const challenge = challenges.take(sessionId, challengeId);
      if (challenge === null) throw new AppError("clock.check_expired", {});
      // The device read its clock at the round trip's midpoint, give or take half of it.
      const halfMs = challenge.elapsedMs / 2;
      const boxAtMs = reading.instant.getTime() - halfMs;
      const answer = await correction.set({
        reason: "unusable",
        source: "admin",
        offsetMs: Math.round(deviceAt - boxAtMs),
        measuredAt: { wallMs: boxAtMs, monoMs: steadyMs - halfMs },
        stepsSeen,
        // What set the clock is the administrator's device alone, which travels as `admin`.
        witnesses: [],
        admin: {
          personId: authorizedBy,
          personName,
          reading: {
            boxAt: new Date(Math.round(boxAtMs)).toISOString(),
            witnessAt: new Date(deviceAt).toISOString(),
            uncertaintyMs: Math.ceil(halfMs),
          },
        },
        requester: { source: "admin", person: authorizedBy },
      });
      if (!answer.set) throw setRefusal(answer.reason);
      return c.json(
        {
          confirmationId: answer.confirmationId,
          stepMs: answer.stepMs,
          confirmedAt: answer.confirmedAt,
        },
        200,
      );
    }),
  );
}

function setRefusal(reason: ClockSetRefusal): Error {
  if (reason === "refused" || reason === "unverified")
    return new AppError("clock.set_failed", { reason });
  // Only a till's admission check answers these, and an administrator's set passes none.
  if (reason === "not_admitted" || reason === "not_start_up")
    return new Error(`an administrator's set was refused ${reason}`);
  return new AppError("clock.set_refused", { reason });
}
