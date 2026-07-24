import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sales, workingOrders } from "@waitron/db";

/**
 * The lifecycle state of one electronic tender. 4a's online subset: `captured` (money taken),
 * `voided` (a captured payment reversed in full — a same-day void, distinct from a refund),
 * `refunded`/`partially_refunded`, and `failed` (the network refused). `attempting` is the
 * transient in-flight state a network-driving integrated adapter writes BEFORE its network call
 * and resolves after (T1/T2) — neutral across every such adapter, never adapter-specific
 * vocabulary. `accepted_offline`/`settled`/`declined` are Cycle A's offline values, added here with
 * this cycle's later tasks giving them real behavior. `initiated` is Mode 3 (async / hosted): the
 * minted-but-unpaid hosted payment. The two-phase `authorized` state is still a later plan, to be
 * added via ALTER TYPE when it lands. Mirrors `PaymentState` in ../provider.ts.
 */
export const paymentState = pgEnum("payment_state", [
  "attempting",
  "captured",
  "voided",
  "refunded",
  "partially_refunded",
  "failed",
  // Cycle A offline lifecycle — appended (DB value-order is cosmetic; the lifecycle order is
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
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    workingOrderId: uuid("working_order_id").notNull(),
    // Nullable: the payment row exists before the sale does (the money moves first). Set to the
    // committed sale in the associate-back step.
    saleId: uuid("sale_id"),
    provider: text("provider").notNull(),
    /** This provider's opaque reference and the idempotency anchor. */
    paymentRef: text("payment_ref").notNull(),
    /** Optional human acquirer reference — e.g. the operation number a merchant keys off a
     * standalone bank card terminal for an unintegrated (manual) tender. Nullable: only manual
     * mode, and some integrated adapters, populate it. A reconciliation hook, never validated. */
    externalRef: text("external_ref"),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    state: paymentState("state").notNull(),
    /** Set on `captured` and `accepted_offline` (the acceptance time), null otherwise. Feeds
     * `RecordSaleTender.settledAt`, so an offline-accepted tender chains its sale immediately. */
    settledAt: timestamp("settled_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite target so payment_refunds can point at a tenant-consistent payment.
    unique("payments_tenant_id_key").on(t.tenantId, t.id),
    // Idempotency: a retried collect cannot double-insert the same provider reference.
    unique("payments_provider_ref_key").on(t.tenantId, t.provider, t.paymentRef),
    // Tenant-consistent FK to the pre-sale entity (also anchors tenant_id).
    foreignKey({
      columns: [t.tenantId, t.workingOrderId],
      foreignColumns: [workingOrders.tenantId, workingOrders.id],
      name: "payments_working_order_fk",
    }).onDelete("restrict"),
    // Nullable composite FK to the committed sale. MATCH SIMPLE: satisfied while sale_id is null.
    foreignKey({
      columns: [t.tenantId, t.saleId],
      foreignColumns: [sales.tenantId, sales.id],
      name: "payments_sale_fk",
    }).onDelete("restrict"),
    index("payments_working_order_idx").on(t.workingOrderId),
    index("payments_sale_idx").on(t.saleId),
    check("payments_amount_ck", sql`${t.amount} > 0`),
  ],
).enableRLS();
