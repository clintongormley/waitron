import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import type { BootReading, ClockWitness, FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { authorizeManager } from "@waitron/identity";
import {
  createErrorBoundary,
  readRawJsonBody,
  requireManagementSession,
} from "@waitron/server-kit";
import { AppError, diskFullIn } from "@waitron/shared";
import { displayNameOf, type BoxHealth } from "./box-health.js";
import { clockChallenges } from "./clock-challenges.js";
import type { FreedSpace } from "./free-space-now.js";
import type { Logger } from "./logger.js";
import { requestFromBox } from "./request-from-box.js";

export interface BoxHealthApiDeps {
  db: Database;
  readHealth: () => Promise<BoxHealth>;
  freeSpace: (personId: string) => Promise<FreedSpace>;
  /** A seat that cannot confirm a clock stop has no confirmation routes. */
  clockConfirm: {
    backend: FiscalBackend;
    witnesses: () => readonly ClockWitness[];
    clock: TrustedClock;
    nodeId: string;
    /** Times each challenge; never stepped by a change of the wall clock. */
    steady: () => number;
    readBoot: () => BootReading;
    requestFromBox?: (c: Context) => boolean;
    devMode: boolean;
  };
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "clock.confirm_refused": 409,
  "clock.unusable": 409,
  "management.request_invalid": 400,
};

/** When a full disk refuses the transaction (its last-seen stamp or its change-log drain), the same
 * checks run again as reads only: this page is how a manager frees the disk. */
async function authorizeSystemManager(db: Database, c: Context): Promise<string> {
  const sessionId = requireManagementSession(c);
  const check = (tx: Database | Transaction, touch: false | undefined) =>
    authorizeManager(tx, { managementSessionId: sessionId, permission: "system.manage", touch });
  try {
    return (await withTransaction(db, (tx) => check(tx, undefined))).authorizedBy;
  } catch (error) {
    if (!diskFullIn(error)) throw error;
    return (await check(db, false)).authorizedBy;
  }
}

/** Dates beyond this are not times `Date` can hold. */
const LATEST_DATE_MS = 8.64e15;

function confirmBody(body: unknown): { challengeId: string; deviceAt: number } {
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

async function requiredNameOf(tx: Transaction, personId: string): Promise<string> {
  const name = await displayNameOf(tx, personId);
  if (name === null) throw new Error(`no person ${personId}`);
  return name;
}

/** `GET /api/box/health` and `POST /api/box/free-space`, both `system.manage`; `POST
 * /api/box/clock-challenge` and `POST /api/box/clock-confirm`, both `person.admin` and refused on
 * the box itself. */
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
  const clockConfirm = deps.clockConfirm;
  const confirmClockStop = clockConfirm.backend.confirmClockStop?.bind(clockConfirm.backend);
  if (confirmClockStop === undefined) return;
  const challenges = clockChallenges({
    steady: clockConfirm.steady,
    wall: () => clockConfirm.clock.now().instant.getTime(),
  });
  // An administrator confirms the box's clock against a clock that is not the box's.
  const refuseOnTheBox = (c: Context) => {
    if (!clockConfirm.devMode && (clockConfirm.requestFromBox ?? requestFromBox)(c))
      throw new AppError("clock.confirm_refused", { reason: "same_machine" });
  };
  const authorizeAdmin = (tx: Transaction, sessionId: string) =>
    authorizeManager(tx, { managementSessionId: sessionId, permission: "person.admin" });
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
  const confirmRun = createErrorBoundary(STATUS, "box-clock-confirm.failed");
  app.post("/api/box/clock-confirm", (c) =>
    confirmRun(c, log, async () => {
      refuseOnTheBox(c);
      const sessionId = requireManagementSession(c);
      const { challengeId, deviceAt } = confirmBody(await readRawJsonBody<unknown>(c));
      const confirmation = await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeAdmin(tx, sessionId);
        const challenge = challenges.take(sessionId, challengeId);
        if (challenge === null)
          throw new AppError("clock.confirm_refused", { reason: "challenge" });
        const personName = await requiredNameOf(tx, authorizedBy);
        // Before the reading: a witness noted after it would be left out as taken after it.
        const witnesses = clockConfirm.witnesses();
        const { instant, offsetMinutes } = clockConfirm.clock.now();
        // The device read its clock somewhere in the round trip: the box's time is taken at its
        // midpoint, give or take half of it.
        const halfMs = challenge.elapsedMs / 2;
        const answer = await confirmClockStop(tx, {
          reading: { instant, offsetMinutes },
          boot: clockConfirm.readBoot(),
          witnesses,
          nodeId: clockConfirm.nodeId,
          admin: {
            personId: authorizedBy,
            personName,
            reading: {
              boxAt: new Date(Math.round(challenge.boxAt + halfMs)).toISOString(),
              witnessAt: new Date(deviceAt).toISOString(),
              uncertaintyMs: Math.ceil(halfMs),
            },
          },
        });
        if (answer.confirmation === null)
          throw new AppError("clock.confirm_refused", { reason: "not_stopped" });
        return answer.confirmation;
      });
      return c.json(
        {
          confirmationId: confirmation.id,
          source: confirmation.source,
          confirmedAt: confirmation.confirmedAt,
        },
        200,
      );
    }),
  );
}
