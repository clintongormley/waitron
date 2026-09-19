import { sql } from "drizzle-orm";
import { check, index } from "drizzle-orm/pg-core";
import { id, json, label, table, tsString } from "./columns.js";
import { sales } from "./sales.js";
import { tills } from "./tenants.js";

export type IncidentSeverity = "warning" | "error";

/**
 * Incidents: problems recorded as they happen, shown as alerts on the management dashboard to anyone
 * holding the permission for their area, who can mark them handled there.
 *
 * The only table in this plan that the application role may UPDATE, and only two of its
 * columns — see the migration below, which uses a column-level GRANT. An incident is a record
 * of what happened, not a note anyone may rewrite; acknowledging one is the sole permitted
 * mutation.
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
    id: id("id").primaryKey().defaultRandom(),
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
    // A CHECK rather than a pgEnum, matching invoice_series.purpose's own precedent: `severity`
    // is a small, closed vocabulary and a CHECK is a one-line migration to widen, where an enum
    // needs ALTER TYPE.
    check("incidents_severity_ck", sql`${t.severity} in ('warning', 'error')`),
    check("incidents_code_ck", sql`${t.code} <> ''`),
  ],
);
