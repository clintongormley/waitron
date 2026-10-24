import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import type { ClockWitness, FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { authorizeManager } from "@waitron/identity";
import {
  createErrorBoundary,
  readRawJsonBody,
  requireManagementSession,
} from "@waitron/server-kit";
import { AppError, diskFullIn } from "@waitron/shared";
import { displayNameOf, type BoxHealth } from "./box-health.js";
import type { FreedSpace } from "./free-space-now.js";
import type { Logger } from "./logger.js";

export interface BoxHealthApiDeps {
  db: Database;
  readHealth: () => Promise<BoxHealth>;
  freeSpace: (personId: string) => Promise<FreedSpace>;
  /** A seat with no restart has nothing to restart, and no route. */
  clockRestart: {
    backend: FiscalBackend;
    witnesses: () => readonly ClockWitness[];
    clock: TrustedClock;
    nodeId: string;
  };
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "clock.restart_refused": 409,
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

function requestedRecordId(body: unknown): string {
  const recordId =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as { recordId?: unknown }).recordId
      : undefined;
  if (typeof recordId !== "string" || recordId === "")
    throw new AppError("management.request_invalid", { field: "recordId" });
  return recordId;
}

async function requiredNameOf(tx: Transaction, personId: string): Promise<string> {
  const name = await displayNameOf(tx, personId);
  if (name === null) throw new Error(`no person ${personId}`);
  return name;
}

/** `GET /api/box/health`, `POST /api/box/free-space` and `POST /api/box/clock-restart`, all
 * `system.manage`. */
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
  const clockRestart = deps.clockRestart;
  const restartAfterClockStop = clockRestart.backend.restartAfterClockStop?.bind(
    clockRestart.backend,
  );
  if (restartAfterClockStop === undefined) return;
  const restartRun = createErrorBoundary(STATUS, "box-clock-restart.failed");
  app.post("/api/box/clock-restart", (c) =>
    restartRun(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const recordId = requestedRecordId(await readRawJsonBody<unknown>(c));
      const answer = await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "system.manage",
        });
        const personName = await requiredNameOf(tx, authorizedBy);
        // Before the reading: a witness noted after it would be left out as taken after it.
        const witnesses = clockRestart.witnesses();
        const { instant, offsetMinutes } = clockRestart.clock.now();
        const { restart, replayed } = await restartAfterClockStop(tx, {
          reading: { instant, offsetMinutes },
          witnesses,
          personId: authorizedBy,
          personName,
          nodeId: clockRestart.nodeId,
          recordId,
        });
        return {
          restart: {
            personName:
              restart.personId === authorizedBy
                ? personName
                : await requiredNameOf(tx, restart.personId),
            restartedAt: restart.restartedAt,
            clockAt: restart.clockAt,
            lastRecordAt: restart.lastRecordAt,
          },
          replayed,
        };
      });
      return c.json(answer, 200);
    }),
  );
}
