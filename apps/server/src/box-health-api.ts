import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import { diskFullIn } from "@waitron/shared";
import type { BoxHealth } from "./box-health.js";
import type { FreedSpace } from "./free-space-now.js";
import type { Logger } from "./logger.js";

export interface BoxHealthApiDeps {
  db: Database;
  readHealth: () => Promise<BoxHealth>;
  freeSpace: (personId: string) => Promise<FreedSpace>;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
};

/** On a full disk the transaction's last-seen stamp or change-log drain is refused, so the same
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

/** `GET /api/box/health` and `POST /api/box/free-space`, both `system.manage`. */
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
}
