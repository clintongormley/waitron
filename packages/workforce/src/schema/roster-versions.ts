import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { locations, tenants } from "@waitron/db";
import { persons } from "./persons.js";

/**
 * A roster version's lifecycle. A `draft` is edited freely; publishing flips it to `published` and
 * stamps `published_at` (`publishRoster`, ../clocking.ts). `superseded` is a value RESERVED for a
 * future lifecycle step — a later publish marking an earlier published version stale — and is NOT
 * written by this slice: D2.1 delivers draft→published only, and `publishRoster` never supersedes a
 * prior version (a recorded follow-up). English tokens — `draft`/`published`/`superseded` — because
 * this is a GENERIC package the english-only guard scans; the Spanish `borrador`/`publicado`
 * rendering, if ever needed, belongs to packages/workforce-es.
 *
 * A pgEnum rather than a text CHECK, matching persons' `personStatus`/`workforceRole` precedent: the
 * three values are settled, and one declaration yields both the TypeScript union and the DB
 * constraint.
 */
export const rosterVersionStatus = pgEnum("roster_version_status", [
  "draft",
  "published",
  "superseded",
]);

/**
 * A published (or draft) snapshot of a location's schedule for a date period — PLANNING data, NOT the
 * legal record. Unlike `time_entries` (the immutable registro de jornada), a roster version is
 * ordinary mutable data: the app role holds SELECT, INSERT, UPDATE and DELETE
 * (drizzle/0008_scheduling_rls.sql) — a draft is edited or discarded, a published version can be
 * re-stamped or removed. No append-only trigger and no hash chain: no Spanish statute requires a
 * *schedule* to be tamper-evident — that obligation (art. 34.9) is on the record of hours WORKED,
 * which `time_entries` satisfies alone (design 2026-07-22 §2.1 / plan
 * 2026-08-02-workforce-d2-scheduling §2.1). Freezing
 * published snapshots for labour-dispute purposes would be an additive owner decision, not a legal
 * one, and is out of scope here.
 *
 * `published_at` is the publish stamp — null exactly while `status = 'draft'` (the
 * `roster_versions_publish_shape_ck` invariant). `published_by_person_id` records who published, when
 * a caller supplies it.
 */
export const rosterVersions = pgTable(
  "roster_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    /** The centro de trabajo this schedule covers. */
    locationId: uuid("location_id").notNull(),
    /** First day of the scheduled period, inclusive. */
    periodStart: date("period_start").notNull(),
    /** Last day of the scheduled period, inclusive. */
    periodEnd: date("period_end").notNull(),
    /** When the version was published; null while it is a draft. */
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
    /** Who published it — a manager acting — recorded at publish time only when the caller supplies
     * it, otherwise null. Unlike `published_at`, no check ties this column to `status`
     * (`roster_versions_publish_shape_ck` constrains `published_at` alone); `publishRoster` is its
     * only writer. */
    publishedByPersonId: uuid("published_by_person_id"),
    status: rosterVersionStatus("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`: the thunk makes v8 count a
    // never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate CLI
    // process, never during vitest run). restrict, not cascade: a schedule must not be silently
    // discarded by a tenant/location delete.
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "roster_versions_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "roster_versions_location_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.publishedByPersonId],
      foreignColumns: [persons.id],
      name: "roster_versions_published_by_person_fk",
    }).onDelete("restrict"),
    index("roster_versions_tenant_id_idx").on(t.tenantId),
    index("roster_versions_tenant_location_idx").on(t.tenantId, t.locationId),
    check("roster_versions_period_ck", sql`${t.periodEnd} >= ${t.periodStart}`),
    // draft ⟺ not yet published: `published_at` is set exactly when the version leaves draft, so
    // publishing that forgot to stamp, or a stamp on a still-draft row, is rejected. Mirrors the
    // `(a is null) = (b is null)` shape workforce_chains_pointer_ck uses. Safe to reference the
    // 'draft' literal here — roster_version_status is CREATE'd (not ALTER ... ADD VALUE'd) in the same
    // migration, so the 55P04 hazard that kept time_entries off its 'correction' literal never arises.
    check(
      "roster_versions_publish_shape_ck",
      sql`(${t.status} = 'draft') = (${t.publishedAt} is null)`,
    ),
  ],
).enableRLS();
