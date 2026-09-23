import { sql } from "drizzle-orm";
import { check, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, json, label, newId, table, tsString } from "./columns.js";
import { sales } from "./sales.js";
import { tills } from "./tenants.js";

export type IncidentSeverity = "warning" | "error";

/**
 * Incidents: problems recorded as they happen, shown as alerts on the management dashboard to anyone
 * holding the permission for their area, who can mark them handled there.
 *
 * An incident is a record of what happened, not a note anyone may rewrite: acknowledging one is the
 * sole permitted mutation. **Nothing in the database enforces that any more.** PostgreSQL held it
 * with a column-level GRANT that let the application role UPDATE `acknowledged_at` and
 * `acknowledged_by` and nothing else; this engine has no roles and no grants
 * (`../testing/roles.ts`), and the table carries no trigger — an update of `code` and a
 * `delete from incidents` both succeed, measured 2026-09-23 on Node v26.7.0 against the core
 * migration set. The rule is now the code's to keep.
 *
 * `code` and `params` come from a structured code+params pair rather than from a message
 * string, so the dashboard can word each alert in English or Spanish
 * (`apps/dashboard/src/i18n/alert-messages.ts`). A prose column here would reach a screen
 * untranslatable, which is the constraint spec §9 places on this layer specifically.
 */
// The bracketed thunks below are resolved by `drizzle-kit generate` in its own CLI process,
// never by `vitest run`, so v8 reports them as never-invoked functions. Same treatment, and
// the same reason, as ./sales.ts.
export const incidents = table(
  "incidents",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    tillId: id("till_id")
      .notNull()
      /* v8 ignore start */
      .references(() => tills.id),
    /* v8 ignore stop */
    /** Nullable: plan 3's drainer raises incidents with no sale attached. */
    /* v8 ignore start */
    saleId: id("sale_id").references(() => sales.id),
    /* v8 ignore stop */
    code: label("code").notNull(),
    params: json<Record<string, unknown>>("params").notNull().default({}),
    severity: label("severity").$type<IncidentSeverity>().notNull(),
    // tsString, matching sales.issuedAt/tenders.settledAt/sale_voids.voidedAt: a JS Date takes on
    // the host timezone as soon as something formats it in local time (`toString()` moves with
    // `TZ`; `toISOString()` does not), and nothing formatted is ever stored. Both columns here are
    // populated by the application (recordIncident's own detectedAt, and markIncidentHandled's
    // acknowledgedAt when a manager marks the alert handled on the dashboard), never by
    // defaultNow(), so the same discipline applies.
    detectedAt: tsString("detected_at").notNull(),
    acknowledgedAt: tsString("acknowledged_at"),
    acknowledgedBy: id("acknowledged_by"),
  },
  (t) => [
    // `openIncidents` (packages/core): what is open on one till, newest first. Only tests call it;
    // the till shows no incidents.
    index("incidents_till_open_idx").on(t.tillId, t.detectedAt),
    // The dashboard's Handled tab: incidents handled since a date, most recent first.
    index("incidents_handled_idx").on(t.acknowledgedAt),
    // At most one OPEN incident per (till, code, sale), so a repeat of the same problem collides
    // rather than stacking a second alert on the dashboard. Partial on `acknowledged_at is null`,
    // so handled rows accumulate freely.
    //
    // The third indexed value substitutes the empty string for a NULL `sale_id` rather than
    // indexing `sale_id` itself. SQLite has no `NULLS NOT DISTINCT`, and in a SQLite unique index
    // every NULL differs from every other NULL, so two open incidents carrying the same till and
    // code and no sale would both be accepted. Mapping NULL onto the empty string makes those two
    // collide instead. The stand-in is the empty string because `newId` — the `randomUUID()` that
    // supplies `sales.id` — never returns it. Written as a CASE rather than
    // `coalesce(sale_id, '')` because drizzle-kit splits an index expression on its commas and
    // emits each piece as a quoted identifier: the `coalesce` form generated
    // ``(`till_id`,`code`,`coalesce("sale_id"`,` '')`)``.
    uniqueIndex("incidents_open_dedup")
      .on(t.tillId, t.code, sql`case when ${t.saleId} is null then '' else ${t.saleId} end`)
      .where(sql`${t.acknowledgedAt} is null`),
    // A CHECK written here rather than a declared vocabulary, matching invoice_series.purpose's
    // own precedent: `severity`
    // is a small, closed vocabulary and a CHECK is a one-line migration to widen, where an enum
    // needs ALTER TYPE.
    check("incidents_severity_ck", sql`${t.severity} in ('warning', 'error')`),
    check("incidents_code_ck", sql`${t.code} <> ''`),
  ],
);
