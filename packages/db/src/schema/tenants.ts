import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { catalogues } from "./catalogue.js";

/**
 * The obligado tributario. Fiscal identity is country + tax_id, regime-agnostic: for a Spanish
 * tenant `tax_id` IS the NIF, and the Veri*Factu backend reads `tax_id` where it once read `nif`
 * (a NIF cannot be asked for before the country is known — spec D2). Unique on (country, tax_id).
 */
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    country: text("country").notNull(),
    taxId: text("tax_id").notNull(),
    legalName: text("legal_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tenants_country_tax_id_key").on(t.country, t.taxId)],
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
 *
 * The fiscal/address/time columns carry `DEFAULT`s (or are nullable) so the
 * reshape does not ripple to the ~28 existing location inserts, which never
 * read these columns. The `venue` command sets all of them explicitly, and no
 * runtime path reads a location's `fiscal_territory` to choose a regime — the
 * node's `filing_module` carries that (Task A3) — so a defaulted value on a
 * fixture is inert. `day_cutover`/`time_zone` are the inputs `computeDailyClose`
 * consumes (spec D9): `@waitron/reporting`'s `computeDailyClose` already takes
 * them as `DailyCloseInput` fields (`packages/reporting/src/daily-close.ts:14`,
 * landed #56). These columns are the source a caller will read them from — the
 * columns land now, that wiring is future.
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
    fiscalTerritory: text("fiscal_territory").notNull().default("ES-common"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    postalCode: text("postal_code"),
    city: text("city"),
    province: text("province"),
    timeZone: text("time_zone").notNull().default("Europe/Madrid"),
    dayCutover: time("day_cutover").notNull().default("06:00:00"),
    // Which catalogue (menu) this venue sells from — nullable (a venue may exist before a menu is
    // assigned). This FK and `catalogue.ts`'s own `tenants` FK make the two schema modules import
    // each other; the cycle is harmless because every cross-module reference is a lazy
    // `.references(() => …)` thunk, evaluated only after both modules have finished loading, never
    // at import time. The receipt is CI, not an assertion: `pnpm --filter @waitron/db db:generate`
    // emits this FK (see drizzle/0028_dapper_tiger_shark.sql) and `pnpm --filter @waitron/db
    // typecheck` compiles the mutually-importing pair — both run green in CI, so a dependency bump
    // that broke thunk resolution would fail those same commands rather than slip through here.
    // (Cross-tenant integrity — that the catalogue belongs to THIS tenant — remains RLS's job, not
    // this FK's; a composite `(tenant_id, id)` FK is the deferred hardening, see backlog.)
    catalogueId: uuid("catalogue_id").references(() => catalogues.id),
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
 * live in the module-owned `registro_sif` table, keyed by node (the SIF is
 * the node — #33, node-id rekey), built in Task 13. A node has exactly one
 * live SIF identity per regime, so that join is 1:1; a till reaches its SIF
 * through the node that serves it.
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
