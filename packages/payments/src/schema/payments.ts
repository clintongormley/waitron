import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  billPayments,
  devices,
  enumCheck,
  enumType,
  id,
  label,
  money,
  newId,
  nodes,
  nowIso,
  originChecks,
  saleSourceColumn,
  sales,
  table,
  tsString,
  workingOrders,
} from "@waitron/db";
import { cardReaders } from "./card-readers.js";

/**
 * Mirrors `PaymentState` in ../provider.ts. `attempting` is written before an integrated adapter's
 * network call and resolved after it; `accepted_offline` advances to `settled` or `declined` when
 * forwarded; `initiated` is a hosted payment minted but not yet paid.
 */
export const paymentState = enumType([
  "attempting",
  "captured",
  "voided",
  "refunded",
  "partially_refunded",
  "failed",
  "accepted_offline",
  "settled",
  "declined",
  "initiated",
]);

/**
 * One row per electronic tender, updated as it moves through its states — unlike core's immutable
 * `tenders` row, which is why core carries no payment column.
 */
export const payments = table(
  "payments",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    workingOrderId: id("working_order_id").notNull(),
    // The device that started the payment; a stuck payment's sale is filed under it.
    source: saleSourceColumn("source").notNull(),
    /* v8 ignore start */
    deviceId: id("device_id").references(() => devices.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    // Null until the sale is written: the money moves first (`associatePaymentWithSale`).
    saleId: id("sale_id"),
    // Nullable: no writer sets it yet (design §5).
    nodeId: id("node_id"),
    // Nullable: cash, manual card, and the Stripe phone-as-reader path name no physical reader.
    readerId: id("reader_id"),
    provider: label("provider").notNull(),
    /** This provider's opaque reference and the idempotency anchor. */
    paymentRef: label("payment_ref").notNull(),
    /** The processor's own reference, or for a manual tender the operation number keyed off a
     * standalone terminal. Its format is never validated. */
    externalRef: label("external_ref"),
    /** Card-present facts for the payment slip, written at capture by a provider that supplies
     * them; null otherwise. */
    cardScheme: label("card_scheme"),
    cardLast4: label("card_last4"),
    // A plain text column beside its own check constraint below, NOT the enumText/enumCheck pair:
    // that constraint lists its values without the ", " spacing enumCheck emits, so substituting
    // would change the schema. See enumText in packages/db/src/schema/columns.ts.
    cardEntryMode: label("card_entry_mode"),
    cardAuthCode: label("card_auth_code"),
    amount: money("amount").notNull(),
    state: paymentState("state").notNull(),
    /** Set when the payment is captured or accepted offline; feeds `RecordSaleTender.settledAt`. */
    settledAt: tsString("settled_at"),
    /** Stamped when the reconcile sweep ATTEMPTS to reverse an orphan, whether or not the
     * reversal succeeds, so one that cannot be refunded is not retried on every sweep. */
    reconcileRemediatedAt: tsString("reconcile_remediated_at"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
    /** The bill payment this attempt charges for (bill payments design §2.4); null for a payment
     * of a whole order. Unique where set. */
    billPaymentId: id("bill_payment_id"),
  },
  (t) => [
    unique("payments_provider_ref_key").on(t.provider, t.paymentRef),
    // `manual` is left out: a hand-keyed operation number is a human's transcription, so two
    // manual tenders may carry the same one.
    uniqueIndex("payments_provider_external_ref_key")
      .on(t.provider, t.externalRef)
      .where(sql`${t.externalRef} is not null and ${t.provider} <> 'manual'`),
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "payments_working_order_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.saleId],
      foreignColumns: [sales.id],
      name: "payments_sale_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.nodeId],
      foreignColumns: [nodes.id],
      name: "payments_node_fk",
    }),
    foreignKey({
      columns: [t.readerId],
      foreignColumns: [cardReaders.id],
      name: "payments_reader_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.billPaymentId],
      foreignColumns: [billPayments.id],
      name: "payments_bill_payment_fk",
    }),
    uniqueIndex("payments_bill_payment_key")
      .on(t.billPaymentId)
      .where(sql`${t.billPaymentId} is not null`),
    index("payments_working_order_idx").on(t.workingOrderId),
    index("payments_sale_idx").on(t.saleId),
    index("payments_reader_idx").on(t.readerId),
    // The reconcile sweep's filter: one provider's rows over a settled_at window.
    index("payments_reconcile_idx").on(t.provider, t.settledAt),
    check("payments_amount_ck", sql`${t.amount} > 0`),
    check("payments_card_last4_ck", sql`${t.cardLast4} is null or length(${t.cardLast4}) = 4`),
    check(
      "payments_card_entry_mode_ck",
      sql`${t.cardEntryMode} is null or ${t.cardEntryMode} in ('contactless','chip','swipe','unknown')`,
    ),
    check("payments_state_ck", enumCheck(t.state)),
    ...originChecks("payments", t.source, t.deviceId),
  ],
);
