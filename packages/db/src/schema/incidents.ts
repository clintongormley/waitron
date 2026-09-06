import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sales } from "./sales.js";
import { tenants, tills } from "./tenants.js";

export type IncidentSeverity = "warning" | "error";

/**
 * Fiscal incidents, surfaced to staff and to support.
 *
 * The only table in this plan that the application role may UPDATE, and only two of its
 * columns — see the migration below, which uses a column-level GRANT. An incident is a record
 * of what happened, not a note anyone may rewrite; acknowledging one is the sole permitted
 * mutation.
 *
 * `code` and `params` come from a structured code+params pair rather than from a message
 * string, so the till can render this bilingually. A prose column here would reach a screen
 * untranslatable, which is the constraint spec §9 places on this layer specifically.
 */
export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    tillId: uuid("till_id")
      .notNull()
      .references(() => tills.id),
    /** Nullable: plan 3's drainer raises incidents with no sale attached. */
    saleId: uuid("sale_id").references(() => sales.id),
    code: text("code").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    severity: text("severity").$type<IncidentSeverity>().notNull(),
    // mode: "string", matching sales.issuedAt/tenders.settledAt/sale_voids.voidedAt: a JS Date
    // normalises through the host timezone the moment anything formats it, and nothing formatted
    // is ever stored. Both columns here are populated by the application (recordIncident's own
    // detectedAt, and a till acknowledging), never by defaultNow(), so the same discipline
    // applies.
    detectedAt: timestamp("detected_at", { withTimezone: true, mode: "string" }).notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true, mode: "string" }),
    acknowledgedBy: uuid("acknowledged_by"),
  },
  (t) => [
    // The till UI's query is "what is open on this till, newest first".
    index("incidents_till_open_idx").on(t.tillId, t.detectedAt),
    // A CHECK rather than a pgEnum, matching invoice_series.purpose's own precedent: `severity`
    // is a small, closed vocabulary and a CHECK is a one-line migration to widen, where an enum
    // needs ALTER TYPE.
    check("incidents_severity_ck", sql`${t.severity} in ('warning', 'error')`),
    check("incidents_code_ck", sql`${t.code} <> ''`),
  ],
);
