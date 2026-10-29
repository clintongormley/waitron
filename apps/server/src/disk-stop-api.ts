import type { Hono } from "hono";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { incidents, type Database } from "@waitron/db";
import { permissionsForRole, resolveManagementSession } from "@waitron/identity";
import { createErrorBoundary, requireManagementSession, type Logger } from "@waitron/server-kit";
import { claimFor, type AlertRegistry } from "./alerts.js";
import type { DiskFullState } from "./disk-full-state.js";
import "./errors.js";

export interface DiskStopApiDeps {
  db: Database;
  disk: Pick<DiskFullState, "since">;
  registry: AlertRegistry;
  now: () => Date;
}

export interface DeletedBackups {
  count: number;
  date: string;
  lastDate: string;
  severalDays: boolean;
}

const STATUS = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
} as const;

const DELETION_CODE = "backup.archives_deleted";
const RECENT_MS = 24 * 60 * 60 * 1000;

/** `GET /management-api/disk-stop`, for any signed-in dashboard session. */
export function mountDiskStopApi(app: Hono, deps: DiskStopApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "disk-stop.failed");
  app.get("/management-api/disk-stop", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      // One write-lock turn with no stamp and no change-log drain, both writes a full disk
      // refuses: this read matters only while the disk is full.
      const body = await deps.db.withWriteLock(async () => {
        const session = await resolveManagementSession(deps.db, token, { touch: false });
        const stopped = deps.disk.since() !== null;
        const { permission } = claimFor(deps.registry, DELETION_CODE);
        const deleted =
          stopped && permissionsForRole(session.role).includes(permission)
            ? await recentDeletion(deps.db, deps.now())
            : null;
        return { stopped, deleted };
      });
      return c.json(body, 200);
    }),
  );
}

async function recentDeletion(db: Database, now: Date): Promise<DeletedBackups | null> {
  const [row] = await db
    .select({ params: incidents.params })
    .from(incidents)
    .where(
      and(
        eq(incidents.code, DELETION_CODE),
        isNull(incidents.acknowledgedAt),
        gte(incidents.detectedAt, new Date(now.getTime() - RECENT_MS).toISOString()),
      ),
    )
    .orderBy(desc(incidents.detectedAt))
    .limit(1);
  if (row === undefined) return null;
  const { count, date, lastDate, severalDays } = row.params as unknown as DeletedBackups;
  return { count, date, lastDate, severalDays };
}
