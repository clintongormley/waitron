import "./errors.js";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { locations, withTransaction, type Database, type Transaction } from "@waitron/db";
import {
  authorizeManager,
  persons,
  resolveManagementSession,
  roleHasPermission,
} from "@waitron/identity";
import type { ModuleTimeRecordExport } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import { assertOwnAttendanceLocation } from "./attendance-own-scope.js";
import {
  parseAttendanceExportOptions,
  parseAttendanceExportQuery,
} from "./attendance-export-request.js";
import { renderAttendanceCsv } from "./attendance-export-csv.js";
import { renderAttendancePdf } from "./attendance-export-pdf.js";
import type { Logger } from "./logger.js";

interface ExportDeps {
  db: Database;
  cfg: { locationId: string };
  exporter?: ModuleTimeRecordExport;
}
const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "attendance.not_permitted": 403,
  },
  "workforce.failed",
);
async function requireLocation(tx: Transaction, locationId: string) {
  const [location] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.id, locationId));
  if (!location) throw new AppError("attendance.invalid", { reason: "record_scope_or_period" });
}
async function authorize(tx: Transaction, token: string, mode: "own" | "manager", touch: boolean) {
  return mode === "manager"
    ? (
        await authorizeManager(tx, {
          managementSessionId: token,
          permission: "report.export",
          touch,
        })
      ).authorizedBy
    : (await resolveManagementSession(tx, token, { touch })).personId;
}
export function mountAttendanceExportApi(app: Hono, deps: ExportDeps, log: Logger): void {
  app.get("/management-api/me/attendance/export-options", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      const result = await withTransaction(deps.db, async (tx) => {
        const viewer = await resolveManagementSession(tx, token, { touch: false });
        const locationId = parseAttendanceExportOptions(new URL(c.req.url).searchParams);
        await requireLocation(tx, locationId);
        const canExportAll = roleHasPermission(viewer.role, "report.export");
        if (!canExportAll)
          await assertOwnAttendanceLocation(tx, {
            personId: viewer.personId,
            locationId,
            currentLocationId: deps.cfg.locationId,
          });
        return { available: deps.exporter !== undefined, canExportAll };
      });
      c.header("Cache-Control", "no-store");
      return c.json(result);
    }),
  );
  for (const mode of ["own", "manager"] as const) {
    const path =
      mode === "own" ? "/management-api/me/attendance/export" : "/management-api/attendance/export";
    app.get(path, (c) =>
      run(c, log, async () => {
        const token = requireManagementSession(c);
        const captured = await withTransaction(deps.db, async (tx) => {
          const viewerId = await authorize(tx, token, mode, true);
          const { selection, personId } = parseAttendanceExportQuery(
            new URL(c.req.url).searchParams,
            mode,
          );
          await requireLocation(tx, selection.locationId);
          if (mode === "own")
            await assertOwnAttendanceLocation(tx, {
              personId: viewerId,
              locationId: selection.locationId,
              currentLocationId: deps.cfg.locationId,
            });
          if (personId !== undefined) {
            const [subject] = await tx
              .select({ id: persons.id })
              .from(persons)
              .where(eq(persons.id, personId));
            if (!subject)
              throw new AppError("attendance.invalid", { reason: "record_scope_or_period" });
          }
          if (!deps.exporter) return { selection, format: null };
          const format = await deps.exporter.prepare(tx, {
            locationId: selection.locationId,
            personId: mode === "own" ? viewerId : personId,
            period: { start: selection.from, end: selection.before },
            audience: selection.audience,
            locale: selection.locale,
          });
          return { selection, format };
        });
        if (!captured.format)
          return c.json(
            { error: { code: "attendance.invalid", params: { reason: "export_unavailable" } } },
            404,
          );
        // Formatting outlives the snapshot transaction; recheck authority before returning any bytes.
        const document = await captured.format();
        const bytes =
          captured.selection.format === "pdf"
            ? await renderAttendancePdf(document)
            : renderAttendanceCsv(document);
        await withTransaction(deps.db, async (tx) => {
          const viewerId = await authorize(tx, token, mode, false);
          if (mode === "own")
            await assertOwnAttendanceLocation(tx, {
              personId: viewerId,
              locationId: captured.selection.locationId,
              currentLocationId: deps.cfg.locationId,
            });
        });
        c.header(
          "Content-Type",
          captured.selection.format === "pdf" ? "application/pdf" : "text/csv; charset=utf-8",
        );
        c.header(
          "Content-Disposition",
          `attachment; filename="time-record-${captured.selection.from}-${captured.selection.before}-${captured.selection.audience}.${captured.selection.format}"`,
        );
        c.header("Cache-Control", "no-store");
        c.header("X-Content-Type-Options", "nosniff");
        return c.body(Uint8Array.from(bytes));
      }),
    );
  }
}
