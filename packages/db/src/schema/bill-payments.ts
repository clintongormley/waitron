import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  id,
  label,
  money,
  newId,
  nowIso,
  quantity,
  table,
  tsString,
} from "./columns.js";
import { workingOrders } from "./orders.js";
import { tills } from "./tenants.js";

export const billPaymentKind = enumType(["items", "contribution", "share"]);
export const billPaymentMethod = enumType(["cash", "card"]);
export const billPaymentState = enumType(["pending", "received", "failed", "declined"]);
export const billPaymentRefundState = enumType(["pending", "completed", "failed"]);

/**
 * One payment taken against a bill before its invoice exists (bill payments design §2.1). A card is
 * charged `applied + tip`; cash change is `tendered − applied − tip`, never stored.
 *
 * Its state moves only pending → received, pending → failed, and received → declined while no
 * tender names it; nothing else about the row ever changes, and it is never deleted. Those rules are
 * the `bill_payments_guard_update` and `bill_payments_no_delete` triggers
 * (`drizzle/0023_bill_payment_triggers.sql`, the guard replaced by
 * `drizzle/0025_bill_payment_attestation_guard.sql`).
 *
 * `requested_by` and `attested_by` are plain person ids with no key: `persons` is in
 * @waitron/identity's migration set.
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
    state: billPaymentState("state").notNull(),
    requestedBy: id("requested_by").notNull(),
    tillId: id("till_id").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    receivedAt: tsString("received_at"),
    failedAt: tsString("failed_at"),
    /** A manager who recorded the outcome from the provider's confirmation, with their note; set
     * only together, and only with the move out of `pending` (the guard trigger). */
    attestedBy: id("attested_by"),
    attestationNote: label("attestation_note"),
  },
  (t) => [
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "bill_payments_working_order_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tillId],
      foreignColumns: [tills.id],
      name: "bill_payments_till_fk",
    }),
    unique("bill_payments_submission_key").on(t.workingOrderId, t.submissionId),
    index("bill_payments_working_order_idx").on(t.workingOrderId),
    check("bill_payments_kind_ck", enumCheck(t.kind)),
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

/**
 * Money given back from one bill payment before the invoice (design §2.3, §6b). A cash refund is
 * written `completed`; only a card refund is ever `pending`.
 *
 * While pending, only the first send's `sent_at`, a `send_count` raised by one, the provider's
 * refund id once, and the outcome — with an attestation when a manager records it — may be
 * written; after the outcome nothing changes, and a refund is never deleted. Those rules are the
 * `bill_payment_refunds_guard_update` and `bill_payment_refunds_no_delete` triggers
 * (`drizzle/0023_bill_payment_triggers.sql`).
 *
 * `authorized_by`, `requested_by` and `attested_by` are plain person ids, as `requested_by` is on
 * `bill_payments`.
 */
export const billPaymentRefunds = table(
  "bill_payment_refunds",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    billPaymentId: id("bill_payment_id").notNull(),
    submissionId: label("submission_id").notNull(),
    fingerprint: label("fingerprint").notNull(),
    appliedAmount: money("applied_amount").notNull(),
    tipAmount: money("tip_amount").notNull().default(0),
    reason: label("reason").notNull(),
    authorizedBy: id("authorized_by").notNull(),
    requestedBy: id("requested_by").notNull(),
    tillId: id("till_id").notNull(),
    state: billPaymentRefundState("state").notNull(),
    sentAt: tsString("sent_at"),
    sendCount: count("send_count").notNull().default(0),
    providerRefundRef: label("provider_refund_ref"),
    attestedBy: id("attested_by"),
    attestationNote: label("attestation_note"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    completedAt: tsString("completed_at"),
    failedAt: tsString("failed_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.billPaymentId],
      foreignColumns: [billPayments.id],
      name: "bill_payment_refunds_payment_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tillId],
      foreignColumns: [tills.id],
      name: "bill_payment_refunds_till_fk",
    }),
    unique("bill_payment_refunds_submission_key").on(t.billPaymentId, t.submissionId),
    index("bill_payment_refunds_payment_idx").on(t.billPaymentId),
    check("bill_payment_refunds_state_ck", enumCheck(t.state)),
    check(
      "bill_payment_refunds_amounts_ck",
      sql`${t.appliedAmount} >= 0 and ${t.tipAmount} >= 0 and ${t.appliedAmount} + ${t.tipAmount} > 0`,
    ),
    check(
      "bill_payment_refunds_sent_ck",
      sql`(${t.sendCount} = 0) = (${t.sentAt} is null) and ${t.sendCount} >= 0`,
    ),
    check(
      "bill_payment_refunds_completed_at_ck",
      sql`(${t.state} = 'completed') = (${t.completedAt} is not null)`,
    ),
    check(
      "bill_payment_refunds_failed_at_ck",
      sql`(${t.state} = 'failed') = (${t.failedAt} is not null)`,
    ),
    check(
      "bill_payment_refunds_attestation_ck",
      sql`(${t.attestedBy} is null) = (${t.attestationNote} is null) and (${t.attestedBy} is null or ${t.state} <> 'pending')`,
    ),
  ],
);
