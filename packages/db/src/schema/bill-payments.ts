import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  flag,
  id,
  label,
  money,
  newId,
  nowIso,
  quantity,
  table,
  tsString,
} from "./columns.js";
import { devices } from "./devices.js";
import { persons } from "./identity/persons.js";
import { workingOrders } from "./orders.js";
import { originChecks, saleSourceColumn } from "./origin.js";

export const billPaymentKind = enumType(["items", "contribution", "share"]);
export const billPaymentMethod = enumType(["cash", "card"]);
export const billPaymentState = enumType(["pending", "received", "failed", "declined"]);

/**
 * One payment taken against a bill before its invoice exists (bill payments design §2.1). A card is
 * charged `applied + tip`; cash change is `tendered − applied − tip`, never stored.
 *
 * Its state moves only pending → received, pending → failed, and received → declined while no
 * tender names it. Only the pending-to-received card transition can revise applied money and tip;
 * received amounts stay fixed. `bill_payments_guard_update` and `bill_payments_no_delete` enforce
 * these rules (`triggers/core.sql`).
 */
export const billPayments = table(
  "bill_payments",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    workingOrderId: id("working_order_id").notNull(),
    submissionId: label("submission_id").notNull(),
    fingerprint: label("fingerprint").notNull(),
    kind: billPaymentKind("kind").notNull(),
    shareOf: count("share_of"),
    method: billPaymentMethod("method").notNull(),
    applied: money("applied").notNull(),
    tip: money("tip").notNull().default(0),
    tendered: money("tendered"),
    remainingAfter: money("remaining_after"),
    state: billPaymentState("state").notNull(),
    requestedBy: id("requested_by").notNull(),
    source: saleSourceColumn("source").notNull(),
    deviceId: id("device_id").references(() => devices.id, { onDelete: "restrict" }),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    receivedAt: tsString("received_at"),
    failedAt: tsString("failed_at"),
    /** A manager who recorded the outcome from the provider's confirmation, with their note: set
     * together, with a non-blank note, never on a pending row (`bill_payments_attestation_ck`), and
     * only with the move out of `pending` (the guard trigger). */
    attestedBy: id("attested_by"),
    attestationNote: label("attestation_note"),
    /** A reader payment whose payer asked for a slip that Waitron, not the reader, prints once its
     * outcome is known. False for cash and a typed card, whose slip prints as the row is made. Never
     * changes (the guard trigger). */
    slipWanted: flag("slip_wanted").notNull().default(false),
    /** The payer asked for their own receipt for this payment. */
    ownReceipt: flag("own_receipt").notNull().default(false),
  },
  (t) => [
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "bill_payments_working_order_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.requestedBy],
      foreignColumns: [persons.id],
      name: "bill_payments_requested_by_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.attestedBy],
      foreignColumns: [persons.id],
      name: "bill_payments_attested_by_fk",
    }).onDelete("restrict"),
    unique("bill_payments_submission_key").on(t.workingOrderId, t.submissionId),
    check("bill_payments_kind_ck", enumCheck(t.kind)),
    ...originChecks("bill_payments", t.source, t.deviceId),
    check("bill_payments_method_ck", enumCheck(t.method)),
    check("bill_payments_state_ck", enumCheck(t.state)),
    check(
      "bill_payments_share_of_ck",
      sql`(${t.kind} = 'share') = (${t.shareOf} is not null) and (${t.shareOf} is null or ${t.shareOf} >= 1)`,
    ),
    check(
      "bill_payments_amounts_ck",
      sql`${t.applied} >= 0 and ${t.tip} >= 0 and ${t.applied} + ${t.tip} > 0`,
    ),
    check(
      "bill_payments_tendered_ck",
      sql`(${t.method} = 'cash') = (${t.tendered} is not null) and (${t.tendered} is null or ${t.tendered} >= ${t.applied} + ${t.tip})`,
    ),
    check(
      "bill_payments_received_at_ck",
      sql`(${t.state} in ('received', 'declined')) = (${t.receivedAt} is not null)`,
    ),
    check("bill_payments_failed_at_ck", sql`(${t.state} = 'failed') = (${t.failedAt} is not null)`),
    check(
      "bill_payments_attestation_ck",
      sql`(${t.attestedBy} is null) = (${t.attestationNote} is null) and (${t.attestedBy} is null or (${t.state} <> 'pending' and coalesce(length(trim(${t.attestationNote})), 0) > 0))`,
    ),
  ],
);

/**
 * Which lines an item payment covers, and what those units cost when paid (design §2.2).
 * Append-only.
 *
 * `line_id` is a plain id with no key: a void deletes a working-order line, and a key from an
 * append-only row would turn that delete into a refusal. The application refuses to void, reduce
 * or move a paid quantity instead.
 */
export const billPaymentLines = table(
  "bill_payment_lines",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    billPaymentId: id("bill_payment_id").notNull(),
    lineId: id("line_id").notNull(),
    quantity: quantity("quantity").notNull(),
    amount: money("amount").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.billPaymentId],
      foreignColumns: [billPayments.id],
      name: "bill_payment_lines_payment_fk",
    }).onDelete("restrict"),
    index("bill_payment_lines_payment_idx").on(t.billPaymentId),
    check("bill_payment_lines_quantity_ck", sql`${t.quantity} > 0`),
    check("bill_payment_lines_amount_ck", sql`${t.amount} >= 0`),
  ],
);
