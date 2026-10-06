import { check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { enumCheck, enumText, flag, id, newId, now, table, ts } from "./columns.js";
import { billPayments } from "./bill-payments.js";
import { devices } from "./devices.js";
import { sales } from "./sales.js";
import { printers } from "./printers.js";

/**
 * The cash-drawer audit log: one row per drawer open. The kick itself is a separate `drawer` print
 * job; printing a receipt never opens the drawer (CLAUDE.md §5). A `card_slip` open is a hand-keyed
 * card payment's, so the slip goes in the drawer; it names the sale, or, for a bill payment, the bill
 * payment, the one that issues the invoice included.
 *
 * No trigger refuses an update or a delete: the table is declared with `classify()`, not
 * `appendOnly()`, in `../classification.ts`.
 *
 * `person_id` and `authorized_by` are plain ids with no FK: `persons` is in @waitron/identity's
 * migration set, not the core one.
 */
export const drawerOpens = table(
  "drawer_opens",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    deviceId: id("device_id").references(() => devices.id),
    /* v8 ignore start */
    printerId: id("printer_id").references(() => printers.id),
    /* v8 ignore stop */
    personId: id("person_id").notNull(),
    openedAt: ts("opened_at").notNull().$defaultFn(now),
    reason: enumText("reason", [
      "cash_sale",
      "manual",
      "calibration",
      "bill_payment",
      "bill_refund",
      "card_slip",
    ] as const).notNull(),
    /* v8 ignore start */
    saleId: id("sale_id").references(() => sales.id),
    /* v8 ignore stop */
    // Set for every open a bill payment, or a cash refund from one, causes — the payment that issues
    // the invoice included, because the row is written before the invoice exists.
    /* v8 ignore start */
    billPaymentId: id("bill_payment_id").references(() => billPayments.id),
    /* v8 ignore stop */
    // Who authorized the manual open; NULL for a
    // `cash_sale`, `bill_payment` or `card_slip` open.
    authorizedBy: id("authorized_by"),
    // A person holding cash.drawer authorized the open on behalf of an operator who does not.
    viaOverride: flag("via_override").notNull().default(false),
  },
  (t) => [
    check("drawer_opens_reason_ck", enumCheck(t.reason)),
    check(
      "drawer_opens_target_ck",
      sql`(${t.reason} = 'calibration' and ${t.printerId} is not null and ${t.deviceId} is null and ${t.saleId} is null and ${t.billPaymentId} is null) or (${t.reason} in ('bill_payment', 'bill_refund') and ${t.deviceId} is not null and ${t.billPaymentId} is not null and ${t.saleId} is null) or (${t.reason} in ('cash_sale', 'manual') and ${t.deviceId} is not null and ${t.billPaymentId} is null) or (${t.reason} = 'card_slip' and ${t.deviceId} is not null and (${t.saleId} is null) <> (${t.billPaymentId} is null))`,
    ),
  ],
);

export type DrawerOpenReason = (typeof drawerOpens.reason.enumValues)[number];
