import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * The obligado tributario. One row per NIF — the NIF is the identity AEAT
 * knows, so it is unique globally rather than per anything.
 */
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nif: text("nif").notNull(),
    legalName: text("legal_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tenants_nif_key").on(t.nif)],
).enableRLS();

/**
 * A venue. `invoiceLocales` is an ORDERED list of one or two locales: one means
 * monolingual, two means both languages on the same invoice in that order
 * (spec §9 — a Barcelona venue may want Spanish, Catalan, or both).
 *
 * The order is fiscal, not presentational. Spec §9 requires a reprint or a
 * rectificativa issued a year later to reproduce the document the customer
 * took, which is why `sales.invoice_locales` snapshots this list at issuance.
 * Which language leads is part of what the document said; a rectificativa
 * references an original that must be reproducible. Reordering a venue's
 * configuration must therefore never change how an already-issued receipt
 * reprints — hence a snapshot of an ordered value, not a lookup of a set.
 *
 * Rejected alternatives: a `jsonb` object cannot carry order at all, because
 * Postgres normalises and sorts `jsonb` keys on storage; a
 * `primary_locale`/`secondary_locale` pair encodes order but cannot grow past
 * two, and the cap belongs in a constraint that can be relaxed, not in the
 * column layout.
 */
export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    invoiceLocales: text("invoice_locales").array().notNull(),
    operationDescription: text("operation_description").notNull(),
  },
  (t) => [
    // cardinality(), NOT array_length(). array_length('{}', 1) is NULL, a CHECK
    // whose expression is NULL is satisfied, and an empty locale list would
    // therefore be accepted — verified on PostgreSQL 18.4. cardinality('{}')
    // is 0 and the constraint bites.
    check("locations_invoice_locales_len", sql`cardinality(${t.invoiceLocales}) between 1 and 2`),
    index("locations_tenant_id_idx").on(t.tenantId),
  ],
).enableRLS();

/**
 * A point of sale. Deliberately REGIME-NEUTRAL: `NúmeroInstalación` and
 * `IdSistemaInformatico` do NOT live here.
 *
 * They are Veri*Factu concepts — a Spanish SIF identity, minted per (NIF,
 * IdSIF) and never reusable (spec §3) — and `packages/db` is English and
 * regime-neutral by Global Constraint. Putting them here would mean every
 * future regime either widens this table or leaves columns null, and it would
 * put Spanish column names in a package the Task 3 guard forbids them in. They
 * live in the module-owned `registro_sif` table, keyed by till, built in
 * Task 13. A till has exactly one SIF identity per regime, so the join is 1:1
 * and costs nothing.
 */
export const tills = pgTable(
  "tills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("tills_tenant_id_idx").on(t.tenantId)],
).enableRLS();
