import { sql } from "drizzle-orm";
import { check, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, json, label, newId, table, tsString } from "./columns.js";
import { devices } from "./devices.js";
import { originChecks, sourceColumn } from "./origin.js";
import { sales } from "./sales.js";

export type IncidentSeverity = "warning" | "error";

/**
 * Incidents: problems recorded as they happen, shown as alerts on the management dashboard to anyone
 * holding the permission for their area, who can mark them handled there.
 *
 * An incident is a record of what happened, not a note anyone may rewrite: acknowledging one is the
 * sole permitted mutation. **Nothing in the database enforces that.** This engine has no roles and
 * no grants, and the table carries no trigger, so the rule is the code's to keep.
 *
 * `code` and `params` come from a structured code+params pair rather than from a message
 * string, so the dashboard can word each alert in English or Spanish
 * (`apps/dashboard/src/i18n/alert-messages.ts`). A prose column here would reach a screen
 * untranslatable.
 */
export const incidents = table(
  "incidents",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    source: sourceColumn("source").notNull(),
    /* v8 ignore start */
    deviceId: id("device_id").references(() => devices.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    /* v8 ignore start */
    saleId: id("sale_id").references(() => sales.id),
    /* v8 ignore stop */
    code: label("code").notNull(),
    params: json<Record<string, unknown>>("params").notNull().default({}),
    severity: label("severity").$type<IncidentSeverity>().notNull(),
    // tsString: a JS Date takes on the host timezone as soon as something formats it in local time
    // (`toString()` moves with `TZ`; `toISOString()` does not), and nothing formatted is ever stored.
    detectedAt: tsString("detected_at").notNull(),
    acknowledgedAt: tsString("acknowledged_at"),
    acknowledgedBy: id("acknowledged_by"),
  },
  (t) => [
    // `openIncidents` (packages/core): what is open for one source and device, newest first.
    index("incidents_origin_open_idx").on(t.source, t.deviceId, t.detectedAt),
    // The dashboard's Handled tab: incidents handled since a date, most recent first.
    index("incidents_handled_idx").on(t.acknowledgedAt),
    // At most one OPEN incident per (source, device, code, sale), so a repeat of the same problem
    // collides rather than stacking a second alert on the dashboard. Partial on
    // `acknowledged_at is null`, so handled rows accumulate freely.
    //
    // A NULL `device_id` and a NULL `sale_id` are each indexed as the empty string. SQLite has no
    // `NULLS NOT DISTINCT`, and in a SQLite unique index every NULL differs from every other NULL,
    // so two open incidents from one job source with the same code and no sale would both be
    // accepted. The empty string is a safe stand-in because `newId` — the `randomUUID()` behind
    // `devices.id` and `sales.id` — never returns it. Written as a CASE rather than
    // `coalesce(x, '')` because drizzle-kit splits an index expression on its commas and emits each
    // piece as a quoted identifier.
    //
    // A drizzle-kit REBUILD of this table writes even the CASE form back as quoted column names,
    // which SQLite refuses with `no such column` (drizzle-kit 0.31.11's recreate path ignores which
    // index columns are expressions). A change that rebuilds `incidents` takes this index out of
    // the schema first and adds it back in a generation of its own, as core 0077 to 0079 do.
    uniqueIndex("incidents_open_dedup")
      .on(
        t.source,
        sql`case when ${t.deviceId} is null then '' else ${t.deviceId} end`,
        t.code,
        sql`case when ${t.saleId} is null then '' else ${t.saleId} end`,
      )
      .where(sql`${t.acknowledgedAt} is null`),
    check("incidents_severity_ck", sql`${t.severity} in ('warning', 'error')`),
    check("incidents_code_ck", sql`${t.code} <> ''`),
    ...originChecks("incidents", t.source, t.deviceId),
  ],
);
