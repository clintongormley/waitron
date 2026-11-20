import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  billPayments,
  devices,
  enumCheck,
  enumType,
  flag,
  id,
  label,
  money,
  newId,
  nodes,
  nowIso,
  originChecks,
  persons,
  saleSourceColumn,
  sales,
  table,
  tsString,
  workingOrders,
} from "@waitron/db";
import { cardReaders } from "./card-readers.js";

/**
 * Mirrors `PaymentState` in ../provider.ts. `attempting` is written before an integrated adapter's
 * network call and resolved after it; `initiated` is a hosted payment minted but not yet paid.
 */
export const paymentState = enumType([
  "attempting",
  "captured",
  "voided",
  "refunded",
  "partially_refunded",
  "failed",
  "initiated",
]);

export const paymentResolutionOutcome = enumType(["captured", "failed"]);
export const paymentHoldOutcome = enumType(["refunded_at_provider", "kept"]);

const externalProviderType = enumType(["connected_account", "other"]);

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
    // The collection owner: the box that started the payment.
    nodeId: id("node_id"),
    // Nullable: cash, manual card, and the Stripe phone-as-reader path name no physical reader.
    readerId: id("reader_id"),
    provider: label("provider").notNull(),
    /** This provider's opaque reference and the idempotency anchor. */
    paymentRef: label("payment_ref").notNull(),
    /** The processor's own reference, or for a manual tender the operation number keyed off a
     * standalone terminal. Its format is never validated. */
    externalRef: label("external_ref"),
    externalProvider: externalProviderType("external_provider"),
    externalMachine: label("external_machine"),
    /** Card-present facts, written at capture by a provider that supplies them; null otherwise. */
    cardScheme: label("card_scheme"),
    cardLast4: label("card_last4"),
    // A plain text column beside its own check constraint below, NOT the enumText/enumCheck pair:
    // that constraint lists its values without the ", " spacing enumCheck emits, so substituting
    // would change the schema. See enumText in packages/db/src/schema/columns.ts.
    cardEntryMode: label("card_entry_mode"),
    cardAuthCode: label("card_auth_code"),
    amount: money("amount").notNull(),
    requestedAmount: money("requested_amount"),
    state: paymentState("state").notNull(),
    settledAt: tsString("settled_at"),
    /** SumUp's time for when the checkout began, when it lies between this row's `created_at` and
     * the check that found the card, else `created_at`; written once, only by that check, made
     * after the card's live answer was missed. */
    providerCheckoutStartedAt: tsString("provider_checkout_started_at"),
    /** Committed before reversing an orphan; the provider's reconciler owns recovery of this claim. */
    reconcileRemediatedAt: tsString("reconcile_remediated_at"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
    /** The bill payment this attempt charges for (bill payments design §2.4); null for a payment
     * of a whole order. Unique where set. */
    billPaymentId: id("bill_payment_id"),
    resolutionOutcome: paymentResolutionOutcome("resolution_outcome"),
    resolutionCancelledAtProvider: flag("resolution_cancelled_at_provider"),
    resolutionProviderStatus: label("resolution_provider_status"),
    resolvedBy: id("resolved_by"),
    resolvedAt: tsString("resolved_at"),
    holdProviderAmount: money("hold_provider_amount"),
    heldAt: tsString("held_at"),
    holdOutcome: paymentHoldOutcome("hold_outcome"),
    holdNote: label("hold_note"),
    holdDecidedBy: id("hold_decided_by"),
    holdDecidedAt: tsString("hold_decided_at"),
    requestedBy: id("requested_by"),
  },
  (t) => [
    foreignKey({
      columns: [t.requestedBy],
      foreignColumns: [persons.id],
      name: "payments_requested_by_fk",
    }).onDelete("restrict"),
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
    foreignKey({
      columns: [t.resolvedBy],
      foreignColumns: [persons.id],
      name: "payments_resolved_by_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.holdDecidedBy],
      foreignColumns: [persons.id],
      name: "payments_hold_decided_by_fk",
    }).onDelete("restrict"),
    index("payments_open_hold_idx")
      .on(t.heldAt)
      .where(sql`${t.heldAt} is not null and ${t.holdOutcome} is null`),
    index("payments_unfiled_resolution_idx")
      .on(t.workingOrderId)
      .where(
        sql`${t.resolutionOutcome} = 'captured' and ${t.resolvedBy} is null and ${t.saleId} is null`,
      ),
    check("payments_resolution_outcome_ck", enumCheck(t.resolutionOutcome)),
    check(
      "payments_resolution_cancelled_ck",
      sql`${t.resolutionCancelledAtProvider} is null or ${t.resolutionCancelledAtProvider} = 0 or ${t.resolutionOutcome} = 'failed'`,
    ),
    check(
      "payments_resolution_fields_ck",
      sql`(${t.resolutionOutcome} is null) = (${t.resolvedAt} is null) and (${t.resolutionOutcome} is null) = (${t.resolutionCancelledAtProvider} is null) and (${t.resolutionOutcome} is not null or (${t.resolutionProviderStatus} is null and ${t.resolvedBy} is null))`,
    ),
    check(
      "payments_hold_amount_ck",
      sql`${t.holdProviderAmount} is null or ${t.holdProviderAmount} > 0`,
    ),
    check(
      "payments_hold_fields_ck",
      sql`(${t.holdProviderAmount} is null) = (${t.heldAt} is null)`,
    ),
    check("payments_hold_outcome_ck", enumCheck(t.holdOutcome)),
    check("payments_hold_note_ck", sql`${t.holdNote} is null or length(trim(${t.holdNote})) > 0`),
    check(
      "payments_hold_outcome_fields_ck",
      sql`(${t.holdOutcome} is null) = (${t.holdDecidedBy} is null) and (${t.holdOutcome} is null) = (${t.holdDecidedAt} is null) and (${t.holdOutcome} is null or ${t.heldAt} is not null) and (${t.holdOutcome} is not null or ${t.holdNote} is null)`,
    ),
    check(
      "payments_hold_or_remediation_ck",
      sql`${t.heldAt} is null or ${t.reconcileRemediatedAt} is null`,
    ),
    check("payments_amount_ck", sql`${t.amount} > 0`),
    check("payments_card_last4_ck", sql`${t.cardLast4} is null or length(${t.cardLast4}) = 4`),
    check(
      "payments_card_entry_mode_ck",
      sql`${t.cardEntryMode} is null or ${t.cardEntryMode} in ('contactless','chip','swipe','unknown')`,
    ),
    check("payments_state_ck", enumCheck(t.state)),
    check("payments_external_provider_ck", enumCheck(t.externalProvider)),
    ...originChecks("payments", t.source, t.deviceId),
  ],
);
