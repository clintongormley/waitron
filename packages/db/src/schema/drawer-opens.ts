import { check } from "drizzle-orm/sqlite-core";
import { enumCheck, enumText, flag, id, newId, now, table, ts } from "./columns.js";
import { sales } from "./sales.js";
import { tills } from "./tenants.js";

/**
 * The cash-drawer AUDIT log (counter-receipt/drawer slice §2). One append-only row per drawer kick,
 * for cash accountability: a `manual` open (a staff member opens the drawer with no sale — always
 * recorded, who/when) and, optionally, a `cash_sale` open (the drawer kicked automatically as a cash
 * sale settled at the till). The drawer is the till's receipt printer's kick (deli-hardware §6 — no
 * separate device), so this table records the ACT of opening, not a device.
 *
 * `till_id` references `tills(id)` and `sale_id` references `sales(id)`. `sale_id` is NULLABLE
 * (a manual open has no sale; a cash-sale open references it), and a foreign key does not check a
 * NULL. `person_id` is a plain uuid with NO
 * FK: the person/identity schema is a separate slice, so this audit row records the acting operator
 * as a raw id and stays independent of it — the `daily_closes.closed_by` / `order_amendments.actor_id`
 * / `sale_voids.voided_by` house seam pattern.
 *
 * `authorized_by` (nullable) and `via_override` (bool, default false) are the authorization AUDIT: who
 * authorized the open under a `gated` `drawer_open_policy` and whether a supervisor override was used.
 * `authorized_by` is a plain uuid with NO FK, the same `person_id` seam — it points at the identity
 * slice's persons without depending on it.
 */
export const drawerOpens = table(
  "drawer_opens",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    tillId: id("till_id")
      .notNull()
      /* v8 ignore start */
      .references(() => tills.id),
    /* v8 ignore stop */
    // The acting operator (identity person id). Plain uuid, no FK: the person schema is a separate
    // slice and this audit row must not depend on it (the daily_closes.closed_by / sale_voids.voided_by
    // shape).
    personId: id("person_id").notNull(),
    // Server-clock kick time — $defaultFn(now), the daily_closes.closedAt shape (a server-generated
    // timestamp, not an application-supplied one).
    openedAt: ts("opened_at").notNull().$defaultFn(now),
    // Why the drawer opened: 'cash_sale' (auto kick on a cash sale) or 'manual' (staff open). A text
    // column + CHECK, matching invoice_series.purpose / incidents.severity. `enumText` and
    // `enumCheck` (`packages/db/src/schema/columns.ts`) build the column and its constraint from the
    // single values array below.
    reason: enumText("reason", ["cash_sale", "manual"] as const).notNull(),
    // NULLABLE: a manual open has no sale; a cash-sale open references it. A foreign key does not
    // check a NULL.
    /* v8 ignore start */
    saleId: id("sale_id").references(() => sales.id),
    /* v8 ignore stop */
    // Who authorized this open under a 'gated' drawer_open_policy (cash-drawer-authorization slice §2).
    // Plain uuid, NULLABLE, NO FK — the same shape and reason as `person_id` above: the person/identity
    // schema is a separate slice, so this audit row records the authorizer as a raw id and stays
    // independent of it (the daily_closes.closed_by / sale_voids.voided_by house seam). NULLABLE because
    // the automatic `cash_sale` drawer kick (a cash settlement at the till — `receipt-print.ts`) records
    // no authorizer; a MANUAL open always sets it — a gated override to the authorizing supervisor, an
    // `open`-policy or self-authorized open to the operator (= person_id).
    authorizedBy: id("authorized_by"),
    // Whether a supervisor OVERRIDE authorized this open (cash-drawer-authorization slice §2): a person
    // holding cash.drawer authorized an open on behalf of an operator who does not. NOT NULL DEFAULT
    // false — the common case is no override, and the flag records the exception.
    viaOverride: flag("via_override").notNull().default(false),
  },
  // The constraint's values are read off the column itself (`enumCheck`), so the vocabulary is
  // declared once, in the `enumText` call above.
  (t) => [check("drawer_opens_reason_ck", enumCheck(t.reason))],
);

/** The `reason` vocabulary as a type, read off the column so the values are written down once. */
export type DrawerOpenReason = (typeof drawerOpens.reason.enumValues)[number];
