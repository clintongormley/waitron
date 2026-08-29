import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export type DrawerOpenReason = "cash_sale" | "manual";

/**
 * The cash-drawer AUDIT log (counter-receipt/drawer slice §2). One append-only row per drawer kick,
 * for cash accountability: a `manual` open (a staff member opens the drawer with no sale — always
 * recorded, who/when) and, optionally, a `cash_sale` open (the drawer kicked automatically as a cash
 * sale's receipt printed). The drawer is the till's receipt printer's kick (deli-hardware §6 — no
 * separate device), so this table records the ACT of opening, not a device.
 *
 * Append-only-ish: `app_user` holds SELECT/INSERT and NO UPDATE/DELETE — a drawer open is a fact
 * about what happened, never edited or removed. Unlike `sale_voids`/`daily_closes` it carries no
 * hash chain, so the design (spec §2) scopes it to the withheld-grant guard alone, not the full
 * four-part immutability recipe (no reject_mutation/TRUNCATE triggers). `.enableRLS()` emits only
 * ENABLE ROW LEVEL SECURITY; the FORCE ROW LEVEL SECURITY, the `drawer_opens_tenant_isolation`
 * policy and the SELECT/INSERT grant are hand-written in the paired --custom migration. The
 * `inmutabilidad` guard in packages/fiscal-verifactu scans every tenant_id-bearing table for
 * ENABLE + FORCE, so a missing FORCE here fails that suite, not this package's.
 *
 * `till_id` and `sale_id` are BARE uuids: their tenant-consistent composite FKs —
 * (tenant_id, till_id) → tills(tenant_id, id) and (tenant_id, sale_id) → sales(tenant_id, id) — are
 * hand-written in the --custom migration (a bare column carries no FK), exactly as `sale_voids`'s
 * composite `sale_id` FK is. `sale_id` is NULLABLE (a manual open has no sale; a cash-sale open
 * references it) — MATCH SIMPLE skips the FK check on a NULL. `person_id` is a plain uuid with NO
 * FK: the person/identity schema is a separate slice, so this audit row records the acting operator
 * as a raw id and stays independent of it — the `daily_closes.closed_by` / `order_amendments.actor_id`
 * / `sale_voids.voided_by` house seam pattern.
 *
 * `authorized_by` (nullable) and `via_override` (bool, default false) are the authorization AUDIT: who
 * authorized the open under a `gated` `drawer_open_policy` and whether a supervisor override was used.
 * `authorized_by` is a plain uuid with NO FK, the same `person_id` seam — it points at the identity
 * slice's persons without depending on it. Both are drizzle-native (a nullable uuid and a bool with a
 * default), so they land in the generated migration, not the --custom one.
 */
export const drawerOpens = pgTable(
  "drawer_opens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      // Two-arg `.references()` so v8 tracks this thunk as its own never-invoked function (drizzle-kit
      // resolves it in a separate CLI process), the reason the sibling schema files use this form.
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // Bare column: the tenant-consistent (tenant_id, till_id) → tills(tenant_id, id) composite FK is
    // hand-written in the --custom migration.
    tillId: uuid("till_id").notNull(),
    // The acting operator (identity person id). Plain uuid, no FK: the person schema is a separate
    // slice and this audit row must not depend on it (the daily_closes.closed_by / sale_voids.voided_by
    // shape).
    personId: uuid("person_id").notNull(),
    // Server-clock kick time — mode: "date" + defaultNow(), the daily_closes.closedAt shape (a
    // server-generated timestamp, not an application-supplied one).
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    // Why the drawer opened: 'cash_sale' (auto kick on a cash sale) or 'manual' (staff open). A text
    // column + CHECK, matching invoice_series.purpose / incidents.severity — a small closed vocabulary
    // an audit table widens with a one-line migration, where a pgEnum needs ALTER TYPE. (receipt_print_mode
    // on locations is a pgEnum instead, matching order_flow — a per-venue CONFIG mode, a different family.)
    reason: text("reason").$type<DrawerOpenReason>().notNull(),
    // NULLABLE bare column: a manual open has no sale; a cash-sale open references it. The
    // tenant-consistent (tenant_id, sale_id) → sales(tenant_id, id) composite FK is hand-written in the
    // --custom migration; MATCH SIMPLE skips it on a NULL sale_id.
    saleId: uuid("sale_id"),
    // Who authorized this open under a 'gated' drawer_open_policy (cash-drawer-authorization slice §2).
    // Plain uuid, NULLABLE, NO FK — the same shape and reason as `person_id` above: the person/identity
    // schema is a separate slice, so this audit row records the authorizer as a raw id and stays
    // independent of it (the daily_closes.closed_by / sale_voids.voided_by house seam). NULLABLE because
    // an 'open'-policy open needs no authorizer, and a self-authorized open records the same person as
    // person_id. Written by the drawer route (a later task); no write logic here.
    authorizedBy: uuid("authorized_by"),
    // Whether a supervisor OVERRIDE authorized this open (cash-drawer-authorization slice §2): a person
    // holding cash.drawer authorized an open on behalf of an operator who does not. NOT NULL DEFAULT
    // false — the common case is no override, and the flag records the exception. Written by the drawer
    // route (a later task); no write logic here.
    viaOverride: boolean("via_override").notNull().default(false),
  },
  (t) => [check("drawer_opens_reason_ck", sql`${t.reason} in ('cash_sale', 'manual')`)],
).enableRLS();
