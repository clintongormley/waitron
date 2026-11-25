import type { Hono } from "hono";
import type { Database } from "@waitron/db";
import { resolveManagementSession } from "@waitron/identity";
import { createErrorBoundary, requireManagementSession, type Logger } from "@waitron/server-kit";
import type { DiskFullState } from "./disk-full-state.js";
import "./errors.js";

export interface DiskStopApiDeps {
  db: Database;
  disk: Pick<DiskFullState, "since">;
}

const STATUS = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
} as const;

export function mountDiskStopApi(app: Hono, deps: DiskStopApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "disk-stop.failed");
  app.get("/management-api/disk-stop", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      // A full disk refuses the session stamp and change-log drain.
      const body = await deps.db.withWriteLock(async () => {
        await resolveManagementSession(deps.db, token, { touch: false });
        return { stopped: deps.disk.since() !== null };
      });
      return c.json(body, 200);
    }),
  );
}
