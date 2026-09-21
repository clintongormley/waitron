import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import {
  enumCheck,
  enumType,
  id,
  label,
  money,
  newId,
  nodes,
  nowIso,
  sales,
  table,
  tsString,
  workingOrders,
} from "@waitron/db";
import { cardReaders } from "./card-readers.js";

/**
 * The lifecycle state of one electronic tender. 4a's online subset: `captured` (money taken),
 * `voided` (a captured payment reversed in full — a same-day void, distinct from a refund),
 * `refunded`/`partially_refunded`, and `failed` (the network refused). `attempting` is the
 * transient in-flight state a network-driving integrated adapter writes BEFORE its network call
 * and resolves after (T1/T2) — neutral across every such adapter, never adapter-specific
 * vocabulary. `accepted_offline`/`settled`/`declined` are Cycle A's offline values, added here with
 * this cycle's later tasks giving them real behavior. `initiated` is Mode 3 (async / hosted): the
 * minted-but-unpaid hosted payment. The two-phase `authorized` state is still a later plan; it
 * lands by adding the value to the list below, which re-derives `payments_state_ck`. Mirrors
 * `PaymentState` in ../provider.ts.
 */
export const paymentState = enumType([
  "attempting",
  "captured",
  "voided",
  "refunded",
  "partially_refunded",
  "failed",
  // Cycle A offline lifecycle — appended (list order is cosmetic; the lifecycle order is
  // documented in the design). accepted_offline -> (forward) -> settled | declined.
  "accepted_offline",
  "settled",
  "declined",
  // Mode 3 (async / hosted): the minted-but-unpaid hosted payment. Mirrors `PaymentState`.
  "initiated",
]);

/**
 * One row per electronic tender. The module's own MUTABLE lifecycle record — the deliberate
 * opposite of core's immutable `tenders` row, and the reason core carries no payment column at
 * all. `sale_id` is nullable and set post-capture, in the SAME transaction as the sale it belongs
 * to (see `associatePaymentWithSale`), so a committed sale always carries its association; a
 * captured payment with a null `sale_id` on a settled/abandoned order is the orphan `reconcile`
 * (a later plan) exists to find. The FK points module→core exactly as `registros_facturacion` does.
 */
export const payments = table(
  "payments",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    workingOrderId: id("working_order_id").notNull(),
    // Nullable: the payment row exists before the sale does (the money moves first). Set to the
    // committed sale in the associate-back step.
    saleId: id("sale_id"),
    // Nullable: no writer sets it yet (design §5). Its FK is declared in extraConfig below.
    nodeId: id("node_id"),
    // Nullable: cash, manual card, and the Stripe phone-as-reader path name no physical reader.
    readerId: id("reader_id"),
    provider: label("provider").notNull(),
    /** This provider's opaque reference and the idempotency anchor. */
    paymentRef: label("payment_ref").notNull(),
    /** Optional human acquirer reference — e.g. the operation number a merchant keys off a
     * standalone bank card terminal for an unintegrated (manual) tender. Nullable: only manual
     * mode, and some integrated adapters, populate it. A reconciliation hook, never validated. */
    externalRef: label("external_ref"),
    /** Card-present facts for the separate payment slip — written once at capture by the
     * provider that supplies them (SumUp), null for cash/manual/offline/failed. Plain text: only
     * `card_entry_mode` carries a vocabulary constraint, and the note on that column says why it
     * is hand-written rather than the enumText/enumCheck pair. */
    cardScheme: label("card_scheme"),
    cardLast4: label("card_last4"),
    // A plain text column beside its own check constraint below, NOT the enumText/enumCheck pair:
    // that constraint lists its values without the ", " spacing enumCheck emits, so substituting
    // would change the schema. See enumText in packages/db/src/schema/columns.ts.
    cardEntryMode: label("card_entry_mode"),
    cardAuthCode: label("card_auth_code"),
    amount: money("amount").notNull(),
    state: paymentState("state").notNull(),
    /** Set on `captured` and `accepted_offline` (the acceptance time), null otherwise. Feeds
     * `RecordSaleTender.settledAt`, so an offline-accepted tender chains its sale immediately. */
    settledAt: tsString("settled_at"),
    /** Set by the reconcile sweep when it ATTEMPTS to auto-reverse an orphan (a captured payment
     * with no sale on an abandoned working order), whether or not that reversal then succeeds.
     * Bounds the self-heal to one attempt so a permanently-unrefundable orphan cannot start a
     * retry storm on every sweep — exactly as `envios.reconciled_resubmit_at` bounds the fiscal
     * self-heal. Null means reconcile has not remediated this payment. */
    reconcileRemediatedAt: tsString("reconcile_remediated_at"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // Idempotency: a retried collect cannot double-insert the same provider reference.
    unique("payments_provider_ref_key").on(t.provider, t.paymentRef),
    foreignKey({
      columns: [t.workingOrderId],
      foreignColumns: [workingOrders.id],
      name: "payments_working_order_fk",
    }).onDelete("restrict"),
    // The nullable FKs (sale, node, reader) are satisfied while their column is null.
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
    index("payments_working_order_idx").on(t.workingOrderId),
    index("payments_sale_idx").on(t.saleId),
    // The reconcile sweep's own filter: one provider's rows over a settled_at window. Plain and
    // non-unique — it constrains nothing, so it cannot collide with any writer.
    index("payments_reconcile_idx").on(t.provider, t.settledAt),
    check("payments_amount_ck", sql`${t.amount} > 0`),
    check("payments_card_last4_ck", sql`${t.cardLast4} is null or length(${t.cardLast4}) = 4`),
    check(
      "payments_card_entry_mode_ck",
      sql`${t.cardEntryMode} is null or ${t.cardEntryMode} in ('contactless','chip','swipe','unknown')`,
    ),
    check("payments_state_ck", enumCheck(t.state)),
  ],
);
