import "./errors.js";
import type { Context, Hono } from "hono";
import { eq } from "drizzle-orm";
import { locations, nodes, type Database, type Transaction } from "@waitron/db";
import { resolveManagementSession } from "@waitron/identity";
import {
  personalDataParts,
  preparePersonalData,
  type PersonalDataPart,
  type WaitronModule,
} from "@waitron/module";
import { AppError } from "@waitron/shared";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import { archiveFileName, knownZone, zipArchive } from "./download-archive.js";
import type { Logger } from "./logger.js";

export interface PersonalDataExportDeps {
  db: Database;
  nodeId: string;
  modules: readonly WaitronModule[];
  /** Parts the server adds itself. */
  serverParts?: readonly PersonalDataPart[];
  now?: () => Date;
}
export type PersonalDataAuthorize = (
  tx: Transaction,
) => Promise<{ personId: string; label: string }>;

export const withPersonalDataErrors = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "module.config_invalid": 500,
  },
  "personal_data.failed",
);

async function venuePlace(tx: Transaction, nodeId: string) {
  const [row] = await tx
    .select({ locationId: nodes.locationId, timeZone: locations.timeZone })
    .from(nodes)
    .innerJoin(locations, eq(locations.id, nodes.locationId))
    .where(eq(nodes.id, nodeId));
  if (row === undefined) return { locationId: null, timeZone: "UTC" };
  return { locationId: row.locationId, timeZone: knownZone(row.timeZone) };
}

/** Does not catch: wrap the call in `withPersonalDataErrors`. */
export async function sendPersonalData(
  c: Context,
  deps: PersonalDataExportDeps,
  authorize: PersonalDataAuthorize,
): Promise<Response> {
  const at = (deps.now ?? (() => new Date()))();
  const parts = [...personalDataParts(deps.modules), ...(deps.serverParts ?? [])];
  // Write-lock turns, not `withTransaction`: its closing change-log drain is a write a full disk
  // refuses even though this route changes nothing. A stated exception to one `withTransaction` per
  // route.
  const tx = deps.db;
  const snapshot = await deps.db.withWriteLock(async () => {
    const who = await authorize(tx);
    const place = await venuePlace(tx, deps.nodeId);
    const build = await preparePersonalData(tx, parts, { personId: who.personId, at, ...place });
    return { who, place, build };
  });
  // Building outlives the snapshot turn, so authority is checked again before any bytes go.
  const files = await snapshot.build();
  await deps.db.withWriteLock(async () => {
    const again = await authorize(tx);
    if (again.personId !== snapshot.who.personId)
      throw new Error("personal-data authorisation named a different person after building");
  });
  const body = zipArchive(files, at);
  c.header("Content-Type", "application/zip");
  c.header(
    "Content-Disposition",
    `attachment; filename="${archiveFileName(snapshot.who.label, at, snapshot.place.timeZone)}"`,
  );
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  return c.body(body);
}

export function mountPersonalDataExportApi(
  app: Hono,
  deps: PersonalDataExportDeps,
  log: Logger,
): void {
  app.get("/management-api/me/personal-data/export", (c) =>
    withPersonalDataErrors(c, log, () => {
      if (new URL(c.req.url).search)
        throw new AppError("management.request_invalid", { field: "query" });
      const token = requireManagementSession(c);
      return sendPersonalData(c, deps, async (tx) => {
        const viewer = await resolveManagementSession(tx, token, { touch: false });
        return { personId: viewer.personId, label: viewer.displayName };
      });
    }),
  );
}
