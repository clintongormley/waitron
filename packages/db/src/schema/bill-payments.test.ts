import { locationId as brandLocationId } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { checkFailed, refusalOn, triggerRaised } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { withTransaction } from "../tenancy.js";
import { captureError } from "../testing/errors.js";
import { seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import {
  BILL_PAYMENT_CHANGE_REFUSAL,
  BILL_PAYMENT_DELETE_REFUSAL,
  BILL_REFUND_CHANGE_REFUSAL,
  BILL_REFUND_DELETE_REFUSAL,
} from "../trigger-refusals.js";
import { billPaymentLines, billPaymentRefunds, billPayments } from "./bill-payments.js";
import { drawerOpens } from "./drawer-opens.js";
import { workingOrders } from "./orders.js";
import { sales, tenders } from "./sales.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants, tills } from "./tenants.js";

/**
 * What this file does NOT check: that the product's writers keep the bill invariant (design §4.4) —
 * no trigger does, because the bill's total is computed by the pricing code, not stored.
 */

const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL = "aaaaaaaa-1111-4000-8000-000000000001";
const TILL_2 = "aaaaaaaa-1111-4000-8000-000000000002";
const PERSON = "cccccccc-0000-4000-8000-000000000001";
const MANAGER = "cccccccc-0000-4000-8000-000000000002";
const AT = "2026-09-27T12:00:00.000Z";
const LATER = "2026-09-27T12:05:00.000Z";

let nodeId = "";
let seriesId = "";
let billId = "";
let otherBillId = "";
let nextSubmission = 0;
let nextInvoice = 0;

describe("bill payments: the three tables, their checks and their triggers", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  beforeAll(async () => {
    const db = suite.db;
    await db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant" }]);
    await db.insert(locations).values({
      id: LOCATION,
      name: "Loc",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await db.insert(tills).values([
      { id: TILL, locationId: LOCATION, name: "Till" },
      { id: TILL_2, locationId: LOCATION, name: "Till 2" },
    ]);
    nodeId = await seedNode(db, brandLocationId(LOCATION));
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "FA", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    seriesId = series!.id;
    const orders = await db
      .insert(workingOrders)
      .values([
        { tillId: TILL, nodeId, orderNumber: 1, status: "open", openedAt: AT },
        { tillId: TILL, nodeId, orderNumber: 2, status: "open", openedAt: AT },
      ])
      .returning({ id: workingOrders.id });
    billId = orders[0]!.id;
    otherBillId = orders[1]!.id;
  });

  type PaymentValues = typeof billPayments.$inferInsert;
  type RefundValues = typeof billPaymentRefunds.$inferInsert;

  function paymentValues(overrides: Partial<PaymentValues> = {}): PaymentValues {
    nextSubmission += 1;
    return {
      workingOrderId: billId,
      submissionId: `submission-${nextSubmission}`,
      fingerprint: "fingerprint",
      kind: "contribution",
      method: "card",
      applied: 1000,
      tip: 0,
      state: "pending",
      requestedBy: PERSON,
      tillId: TILL,
      ...overrides,
    };
  }

  async function insertPayment(overrides: Partial<PaymentValues> = {}): Promise<string> {
    const [row] = await inTx((tx) =>
      tx.insert(billPayments).values(paymentValues(overrides)).returning({ id: billPayments.id }),
    );
    return row!.id;
  }

  function refundValues(billPaymentId: string, overrides: Partial<RefundValues> = {}) {
    nextSubmission += 1;
    return {
      billPaymentId,
      submissionId: `refund-${nextSubmission}`,
      fingerprint: "fingerprint",
      appliedAmount: 500,
      tipAmount: 0,
      reason: "wrong item",
      authorizedBy: MANAGER,
      requestedBy: PERSON,
      tillId: TILL,
      state: "pending" as const,
      ...overrides,
    };
  }

  async function insertRefund(
    billPaymentId: string,
    overrides: Partial<RefundValues> = {},
  ): Promise<string> {
    const [row] = await inTx((tx) =>
      tx
        .insert(billPaymentRefunds)
        .values(refundValues(billPaymentId, overrides))
        .returning({ id: billPaymentRefunds.id }),
    );
    return row!.id;
  }

  function run(statement: ReturnType<typeof sql>): Promise<unknown> {
    return inTx(async (tx) => tx.run(statement));
  }

  function updatePayment(id: string, set: string): Promise<unknown> {
    return run(sql`update bill_payments set ${sql.raw(set)} where id = ${id}`);
  }

  function updateRefund(id: string, set: string): Promise<unknown> {
    return run(sql`update bill_payment_refunds set ${sql.raw(set)} where id = ${id}`);
  }

  async function paymentState(id: string): Promise<string> {
    const [row] = await inTx((tx) =>
      tx.select({ state: billPayments.state }).from(billPayments).where(eq(billPayments.id, id)),
    );
    return row!.state;
  }

  async function receivedPayment(overrides: Partial<PaymentValues> = {}): Promise<string> {
    return insertPayment({ state: "received", receivedAt: AT, ...overrides });
  }

  /** A sale on the bill with one tender naming `billPaymentId`. */
  async function tenderFor(billPaymentId: string | null, amount = 1000): Promise<void> {
    nextInvoice += 1;
    const invoiceNumber = nextInvoice;
    await inTx(async (tx) => {
      const [sale] = await tx
        .insert(sales)
        .values({
          tillId: TILL,
          nodeId,
          seriesId,
          invoiceNumber,
          issuedAt: AT,
          issuedOffsetMinutes: 120,
          total: amount,
          vatBreakdown: [],
          locale: "es",
          invoiceLocales: ["es"],
          fiscalBackend: "verifactu",
          fiscalState: "recorded",
        })
        .returning({ id: sales.id });
      await tx.insert(tenders).values({
        saleId: sale!.id,
        method: "card",
        amount,
        settledAt: AT,
        billPaymentId,
      });
    });
  }

  describe("bill_payments columns and checks", () => {
    it("writes and reads back a pending card contribution", async () => {
      const id = await insertPayment();
      const [row] = await inTx((tx) =>
        tx.select().from(billPayments).where(eq(billPayments.id, id)),
      );
      expect(row).toMatchObject({
        workingOrderId: billId,
        kind: "contribution",
        shareOf: null,
        method: "card",
        applied: 1000,
        tip: 0,
        tendered: null,
        state: "pending",
        requestedBy: PERSON,
        tillId: TILL,
        receivedAt: null,
        failedAt: null,
      });
      expect(typeof row!.createdAt).toBe("string");
    });

    it("keeps a submission id unique per bill, and lets another bill reuse it", async () => {
      await insertPayment({ submissionId: "same" });
      const error = await captureError(() => insertPayment({ submissionId: "same" }));
      expect(
        refusalOn(error, UNIQUE_VIOLATION, {
          table: "bill_payments",
          columns: ["working_order_id", "submission_id"],
        }),
      ).toBe(true);
      await insertPayment({ submissionId: "same", workingOrderId: otherBillId });
    });

    it("names an existing bill and an existing till", async () => {
      const missing = "dddddddd-0000-4000-8000-0000000000ff";
      expect(
        isRefusal(
          await captureError(() => insertPayment({ workingOrderId: missing })),
          FOREIGN_KEY_VIOLATION,
        ),
      ).toBe(true);
      expect(
        isRefusal(
          await captureError(() => insertPayment({ tillId: missing })),
          FOREIGN_KEY_VIOLATION,
        ),
      ).toBe(true);
    });

    it.each([
      ["an unknown kind", { kind: "gift" }, "bill_payments_kind_ck"],
      ["an unknown method", { method: "voucher" }, "bill_payments_method_ck"],
      ["an unknown state", { state: "lost" }, "bill_payments_state_ck"],
      ["a share with no count", { kind: "share", shareOf: null }, "bill_payments_share_of_ck"],
      ["a share among no one", { kind: "share", shareOf: 0 }, "bill_payments_share_of_ck"],
      [
        "a count on a contribution",
        { kind: "contribution", shareOf: 2 },
        "bill_payments_share_of_ck",
      ],
      [
        "cash with nothing handed over",
        { method: "cash", tendered: null },
        "bill_payments_tendered_ck",
      ],
      [
        "a card with cash handed over",
        { method: "card", tendered: 1000 },
        "bill_payments_tendered_ck",
      ],
      [
        "cash handed over below the applied amount plus the tip",
        { method: "cash", applied: 1000, tip: 100, tendered: 1099 },
        "bill_payments_tendered_ck",
      ],
      ["nothing paid at all", { applied: 0, tip: 0 }, "bill_payments_amounts_ck"],
      ["a negative tip", { applied: 1000, tip: -1 }, "bill_payments_amounts_ck"],
      ["a negative applied amount", { applied: -1, tip: 500 }, "bill_payments_amounts_ck"],
      [
        "a received payment with no time",
        { state: "received", receivedAt: null },
        "bill_payments_received_at_ck",
      ],
      [
        "a pending payment with a received time",
        { state: "pending", receivedAt: AT },
        "bill_payments_received_at_ck",
      ],
      [
        "a failed payment with no time",
        { state: "failed", failedAt: null },
        "bill_payments_failed_at_ck",
      ],
      [
        "a pending payment with a failed time",
        { state: "pending", failedAt: AT },
        "bill_payments_failed_at_ck",
      ],
    ] as const)("refuses %s", async (_name, overrides, check) => {
      const error = await captureError(() =>
        insertPayment(overrides as unknown as Partial<PaymentValues>),
      );
      expect(checkFailed(error, check)).toBe(true);
    });

    it.each([
      ["a share among two", { kind: "share", shareOf: 2 }],
      ["cash handed over exactly", { method: "cash", applied: 1000, tip: 100, tendered: 1100 }],
      ["a tip alone, applied nothing", { applied: 0, tip: 100 }],
      ["an item payment", { kind: "items" }],
      ["a received payment with its time", { state: "received", receivedAt: AT }],
      ["a declined payment keeps its received time", { state: "declined", receivedAt: AT }],
      ["a failed payment with its time", { state: "failed", failedAt: AT }],
    ] as const)("accepts %s (the control for the checks above)", async (_name, overrides) => {
      await insertPayment(overrides as unknown as Partial<PaymentValues>);
    });
  });

  describe("bill_payments_guard_update: the state moves one way, and the amounts never change", () => {
    it("allows pending to received, stamping the time", async () => {
      const id = await insertPayment();
      await updatePayment(id, `state = 'received', received_at = '${AT}'`);
      expect(await paymentState(id)).toBe("received");
    });

    it("allows pending to failed, stamping the time", async () => {
      const id = await insertPayment();
      await updatePayment(id, `state = 'failed', failed_at = '${AT}'`);
      expect(await paymentState(id)).toBe("failed");
    });

    it("allows received to declined while no tender names the payment", async () => {
      const id = await receivedPayment();
      await updatePayment(id, `state = 'declined'`);
      expect(await paymentState(id)).toBe("declined");
    });

    it("refuses received to declined once a tender names the payment", async () => {
      const id = await receivedPayment();
      await tenderFor(id);
      const error = await captureError(() => updatePayment(id, `state = 'declined'`));
      expect(triggerRaised(error, BILL_PAYMENT_CHANGE_REFUSAL)).toBe(true);
      expect(await paymentState(id)).toBe("received");
    });

    it("allows an update that changes nothing", async () => {
      const id = await receivedPayment();
      await updatePayment(id, `state = state`);
      expect(await paymentState(id)).toBe("received");
    });

    it.each([
      [
        "received back to pending",
        { state: "received", receivedAt: AT },
        `state = 'pending', received_at = null`,
      ],
      [
        "received to failed",
        { state: "received", receivedAt: AT },
        `state = 'failed', received_at = null, failed_at = '${AT}'`,
      ],
      [
        "failed to received",
        { state: "failed", failedAt: AT },
        `state = 'received', failed_at = null, received_at = '${AT}'`,
      ],
      [
        "failed back to pending",
        { state: "failed", failedAt: AT },
        `state = 'pending', failed_at = null`,
      ],
      ["declined back to received", { state: "declined", receivedAt: AT }, `state = 'received'`],
      ["pending straight to declined", {}, `state = 'declined', received_at = '${AT}'`],
      ["a received time moved", { state: "received", receivedAt: AT }, `received_at = '${LATER}'`],
      [
        "a received time moved while declining",
        { state: "received", receivedAt: AT },
        `state = 'declined', received_at = '${LATER}'`,
      ],
      ["a failed time moved", { state: "failed", failedAt: AT }, `failed_at = '${LATER}'`],
    ] as const)("refuses %s", async (_name, start, set) => {
      const id = await insertPayment(start as Partial<PaymentValues>);
      const error = await captureError(() => updatePayment(id, set));
      expect(triggerRaised(error, BILL_PAYMENT_CHANGE_REFUSAL)).toBe(true);
    });

    it.each([
      ["the applied amount", `applied = 999`],
      ["the tip", `tip = 1`],
      ["the cash handed over", `tendered = 5000`],
      ["the kind", `kind = 'items'`],
      ["the share count", `kind = 'share', share_of = 2`],
      ["the method", `method = 'cash', tendered = 2000`],
      ["the bill", `working_order_id = '${"__OTHER__"}'`],
      ["the submission id", `submission_id = 'moved'`],
      ["the fingerprint", `fingerprint = 'other'`],
      ["who took it", `requested_by = '${MANAGER}'`],
      ["the till", `till_id = '${TILL_2}'`],
      ["when it was made", `created_at = '${LATER}'`],
    ])("refuses a change to %s, even alongside a legal transition", async (_name, set) => {
      const id = await insertPayment();
      const statement = set.replace("__OTHER__", otherBillId);
      const error = await captureError(() =>
        updatePayment(id, `${statement}, state = 'received', received_at = '${AT}'`),
      );
      expect(triggerRaised(error, BILL_PAYMENT_CHANGE_REFUSAL)).toBe(true);
      expect(await paymentState(id)).toBe("pending");
    });

    it("refuses a delete", async () => {
      const id = await insertPayment();
      const error = await captureError(() => run(sql`delete from bill_payments where id = ${id}`));
      expect(triggerRaised(error, BILL_PAYMENT_DELETE_REFUSAL)).toBe(true);
    });
  });

  describe("bill_payment_lines", () => {
    it("records an item payment's line, quantity and amount", async () => {
      const paymentId = await insertPayment({ kind: "items" });
      const lineId = "eeeeeeee-0000-4000-8000-000000000001";
      await inTx((tx) =>
        tx
          .insert(billPaymentLines)
          .values({ billPaymentId: paymentId, lineId, quantity: 1000, amount: 2500 }),
      );
      const [row] = await inTx((tx) =>
        tx.select().from(billPaymentLines).where(eq(billPaymentLines.billPaymentId, paymentId)),
      );
      expect(row).toMatchObject({ lineId, quantity: 1000, amount: 2500 });
    });

    it("keys to its bill payment, and names a line by plain id with no key", async () => {
      const missing = "dddddddd-0000-4000-8000-0000000000fe";
      const error = await captureError(() =>
        inTx((tx) =>
          tx
            .insert(billPaymentLines)
            .values({ billPaymentId: missing, lineId: missing, quantity: 1000, amount: 100 }),
        ),
      );
      expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
      const paymentId = await insertPayment({ kind: "items" });
      await inTx((tx) =>
        tx
          .insert(billPaymentLines)
          .values({ billPaymentId: paymentId, lineId: missing, quantity: 1000, amount: 100 }),
      );
    });

    it.each([
      ["a quantity of zero", { quantity: 0, amount: 100 }, "bill_payment_lines_quantity_ck"],
      ["a negative amount", { quantity: 1000, amount: -1 }, "bill_payment_lines_amount_ck"],
    ])("refuses %s", async (_name, values, check) => {
      const paymentId = await insertPayment({ kind: "items" });
      const error = await captureError(() =>
        inTx((tx) =>
          tx
            .insert(billPaymentLines)
            .values({ billPaymentId: paymentId, lineId: "line", ...values }),
        ),
      );
      expect(checkFailed(error, check)).toBe(true);
    });

    it("is append-only: an update and a delete are both refused", async () => {
      const paymentId = await insertPayment({ kind: "items" });
      await inTx((tx) =>
        tx
          .insert(billPaymentLines)
          .values({ billPaymentId: paymentId, lineId: "line", quantity: 1000, amount: 100 }),
      );
      const update = await captureError(() =>
        run(
          sql`update bill_payment_lines set quantity = 2000 where bill_payment_id = ${paymentId}`,
        ),
      );
      expect(triggerRaised(update, "bill_payment_lines is append-only")).toBe(true);
      const remove = await captureError(() =>
        run(sql`delete from bill_payment_lines where bill_payment_id = ${paymentId}`),
      );
      expect(triggerRaised(remove, "bill_payment_lines is append-only")).toBe(true);
    });
  });

  describe("bill_payment_refunds columns and checks", () => {
    it("writes and reads back a pending card refund", async () => {
      const paymentId = await receivedPayment();
      const id = await insertRefund(paymentId);
      const [row] = await inTx((tx) =>
        tx.select().from(billPaymentRefunds).where(eq(billPaymentRefunds.id, id)),
      );
      expect(row).toMatchObject({
        billPaymentId: paymentId,
        appliedAmount: 500,
        tipAmount: 0,
        reason: "wrong item",
        authorizedBy: MANAGER,
        requestedBy: PERSON,
        tillId: TILL,
        state: "pending",
        sentAt: null,
        sendCount: 0,
        providerRefundRef: null,
        attestedBy: null,
        attestationNote: null,
        completedAt: null,
        failedAt: null,
      });
    });

    it("keeps a submission id unique per payment, and lets another payment reuse it", async () => {
      const paymentId = await receivedPayment();
      await insertRefund(paymentId, { submissionId: "again" });
      const error = await captureError(() => insertRefund(paymentId, { submissionId: "again" }));
      expect(
        refusalOn(error, UNIQUE_VIOLATION, {
          table: "bill_payment_refunds",
          columns: ["bill_payment_id", "submission_id"],
        }),
      ).toBe(true);
      await insertRefund(await receivedPayment(), { submissionId: "again" });
    });

    it.each([
      ["nothing given back", { appliedAmount: 0, tipAmount: 0 }, "bill_payment_refunds_amounts_ck"],
      ["a negative tip", { appliedAmount: 500, tipAmount: -1 }, "bill_payment_refunds_amounts_ck"],
      [
        "a negative applied amount",
        { appliedAmount: -1, tipAmount: 500 },
        "bill_payment_refunds_amounts_ck",
      ],
      ["an unknown state", { state: "lost" }, "bill_payment_refunds_state_ck"],
      [
        "a send counted with no send time",
        { sendCount: 1, sentAt: null },
        "bill_payment_refunds_sent_ck",
      ],
      [
        "a send time with no send counted",
        { sendCount: 0, sentAt: AT },
        "bill_payment_refunds_sent_ck",
      ],
      [
        "a completed refund with no time",
        { state: "completed", completedAt: null },
        "bill_payment_refunds_completed_at_ck",
      ],
      [
        "a pending refund with a completed time",
        { completedAt: AT },
        "bill_payment_refunds_completed_at_ck",
      ],
      [
        "a failed refund with no time",
        { state: "failed", failedAt: null },
        "bill_payment_refunds_failed_at_ck",
      ],
      [
        "a pending refund with a failed time",
        { failedAt: AT },
        "bill_payment_refunds_failed_at_ck",
      ],
      [
        "an attestation with no note",
        { state: "failed", failedAt: AT, attestedBy: MANAGER },
        "bill_payment_refunds_attestation_ck",
      ],
      [
        "a note with no attester",
        { state: "failed", failedAt: AT, attestationNote: "SumUp support" },
        "bill_payment_refunds_attestation_ck",
      ],
      [
        "an attestation on a pending refund",
        { attestedBy: MANAGER, attestationNote: "SumUp support" },
        "bill_payment_refunds_attestation_ck",
      ],
    ] as const)("refuses %s", async (_name, overrides, check) => {
      const paymentId = await receivedPayment();
      const error = await captureError(() =>
        insertRefund(paymentId, overrides as unknown as Partial<RefundValues>),
      );
      expect(checkFailed(error, check)).toBe(true);
    });

    it.each([
      ["a tip alone given back", { appliedAmount: 0, tipAmount: 100 }],
      ["a cash refund, completed at once", { state: "completed", completedAt: AT }],
      [
        "an attested failure",
        { state: "failed", failedAt: AT, attestedBy: MANAGER, attestationNote: "SumUp support" },
      ],
      ["a sent refund", { sendCount: 1, sentAt: AT }],
    ] as const)("accepts %s (the control for the checks above)", async (_name, overrides) => {
      await insertRefund(await receivedPayment(), overrides as unknown as Partial<RefundValues>);
    });
  });

  describe("bill_payment_refunds_guard_update: outcome once, sent once, counted up by one", () => {
    async function refundState(id: string) {
      const [row] = await inTx((tx) =>
        tx.select().from(billPaymentRefunds).where(eq(billPaymentRefunds.id, id)),
      );
      return row!;
    }

    it("allows the first send's stamp, a second send's count, then completion with the provider's id", async () => {
      const id = await insertRefund(await receivedPayment());
      await updateRefund(id, `sent_at = '${AT}', send_count = 1`);
      await updateRefund(id, `send_count = 2`);
      await updateRefund(
        id,
        `state = 'completed', completed_at = '${LATER}', provider_refund_ref = 're_123'`,
      );
      expect(await refundState(id)).toMatchObject({
        state: "completed",
        sentAt: AT,
        sendCount: 2,
        providerRefundRef: "re_123",
        completedAt: LATER,
      });
    });

    it("allows the provider's id to arrive while the refund is still pending", async () => {
      const id = await insertRefund(await receivedPayment());
      await updateRefund(id, `sent_at = '${AT}', send_count = 1, provider_refund_ref = 're_1'`);
      expect((await refundState(id)).providerRefundRef).toBe("re_1");
    });

    it("allows pending to failed with a manager's attestation", async () => {
      const id = await insertRefund(await receivedPayment());
      await updateRefund(id, `sent_at = '${AT}', send_count = 1`);
      await updateRefund(
        id,
        `state = 'failed', failed_at = '${LATER}', attested_by = '${MANAGER}', attestation_note = 'Refused in the SumUp dashboard'`,
      );
      expect(await refundState(id)).toMatchObject({ state: "failed", attestedBy: MANAGER });
    });

    it("allows an unsent refund to fail: it never left us", async () => {
      const id = await insertRefund(await receivedPayment());
      await updateRefund(id, `state = 'failed', failed_at = '${AT}'`);
      expect((await refundState(id)).state).toBe("failed");
    });

    it("allows an update that changes nothing, even on a completed refund", async () => {
      const id = await insertRefund(await receivedPayment(), {
        state: "completed",
        completedAt: AT,
      });
      await updateRefund(id, `state = state`);
      expect((await refundState(id)).state).toBe("completed");
    });

    it.each([
      [
        "a send time moved once set",
        { sendCount: 1, sentAt: AT },
        `sent_at = '${LATER}', send_count = 2`,
      ],
      ["a send counted twice at once", { sendCount: 1, sentAt: AT }, `send_count = 3`],
      ["a send count lowered", { sendCount: 2, sentAt: AT }, `send_count = 1`],
      [
        "a provider id replaced",
        { sendCount: 1, sentAt: AT, providerRefundRef: "re_1" },
        `provider_refund_ref = 're_2'`,
      ],
      [
        "completed to failed",
        { state: "completed", completedAt: AT },
        `state = 'failed', completed_at = null, failed_at = '${AT}'`,
      ],
      [
        "failed to completed",
        { state: "failed", failedAt: AT },
        `state = 'completed', failed_at = null, completed_at = '${AT}'`,
      ],
      [
        "completed back to pending",
        { state: "completed", completedAt: AT },
        `state = 'pending', completed_at = null`,
      ],
      [
        "a provider id added after completion",
        { state: "completed", completedAt: AT },
        `provider_refund_ref = 're_late'`,
      ],
      [
        "an attestation added after the outcome",
        { state: "failed", failedAt: AT },
        `attested_by = '${MANAGER}', attestation_note = 'late'`,
      ],
      [
        "a send counted after the outcome",
        { state: "failed", failedAt: AT },
        `sent_at = '${AT}', send_count = 1`,
      ],
    ] as const)("refuses %s", async (_name, start, set) => {
      const id = await insertRefund(await receivedPayment(), start as Partial<RefundValues>);
      const error = await captureError(() => updateRefund(id, set));
      expect(triggerRaised(error, BILL_REFUND_CHANGE_REFUSAL)).toBe(true);
    });

    it.each([
      ["the applied amount", `applied_amount = 400`],
      ["the tip given back", `tip_amount = 1`],
      ["the payment", `bill_payment_id = '__OTHER__'`],
      ["the till", `till_id = '${TILL_2}'`],
      ["the submission id", `submission_id = 'moved'`],
      ["the fingerprint", `fingerprint = 'other'`],
      ["the reason", `reason = 'other'`],
      ["who authorized it", `authorized_by = '${PERSON}'`],
      ["who asked for it", `requested_by = '${MANAGER}'`],
      ["when it was made", `created_at = '${LATER}'`],
    ])("refuses a change to %s, even alongside a legal send", async (_name, set) => {
      const id = await insertRefund(await receivedPayment());
      const other = await receivedPayment();
      const error = await captureError(() =>
        updateRefund(id, `${set.replace("__OTHER__", other)}, sent_at = '${AT}', send_count = 1`),
      );
      expect(triggerRaised(error, BILL_REFUND_CHANGE_REFUSAL)).toBe(true);
      expect((await refundState(id)).sendCount).toBe(0);
    });

    it("refuses a delete", async () => {
      const id = await insertRefund(await receivedPayment());
      const error = await captureError(() =>
        run(sql`delete from bill_payment_refunds where id = ${id}`),
      );
      expect(triggerRaised(error, BILL_REFUND_DELETE_REFUSAL)).toBe(true);
    });
  });

  describe("tenders.bill_payment_id: a bill payment becomes at most one tender", () => {
    it("refuses a second tender naming the same bill payment", async () => {
      const id = await receivedPayment();
      await tenderFor(id);
      const error = await captureError(() => tenderFor(id));
      expect(
        refusalOn(error, UNIQUE_VIOLATION, { table: "tenders", columns: ["bill_payment_id"] }),
      ).toBe(true);
    });

    it("lets any number of tenders name no bill payment", async () => {
      await tenderFor(null);
      await tenderFor(null);
    });

    it("names an existing bill payment", async () => {
      const error = await captureError(() => tenderFor("dddddddd-0000-4000-8000-0000000000fd"));
      expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    });
  });

  describe("drawer_opens: a cash payment or refund before the invoice names its bill payment", () => {
    function open(values: Partial<typeof drawerOpens.$inferInsert>): Promise<unknown> {
      return inTx((tx) =>
        tx
          .insert(drawerOpens)
          .values({ tillId: TILL, personId: PERSON, reason: "manual", ...values }),
      );
    }

    it.each(["bill_payment", "bill_refund"] as const)(
      "accepts a %s open naming the till and the bill payment",
      async (reason) => {
        const billPaymentId = await receivedPayment({ method: "cash", tendered: 1000 });
        await open({ reason, billPaymentId });
      },
    );

    it.each([
      ["a bill payment open with no bill payment", { reason: "bill_payment" }],
      [
        "a bill refund open with no till",
        { reason: "bill_refund", tillId: null, withPayment: true },
      ],
      ["a cash sale open naming a bill payment", { reason: "cash_sale", withPayment: true }],
      ["a manual open naming a bill payment", { reason: "manual", withPayment: true }],
    ] as const)("refuses %s", async (_name, shape) => {
      const { withPayment, ...values } = { withPayment: false, ...shape };
      const billPaymentId = withPayment ? await receivedPayment() : null;
      const error = await captureError(() =>
        open({ ...(values as Partial<typeof drawerOpens.$inferInsert>), billPaymentId }),
      );
      expect(checkFailed(error, "drawer_opens_target_ck")).toBe(true);
    });

    it("refuses a bill payment open that also names a sale", async () => {
      const billPaymentId = await receivedPayment();
      await tenderFor(null);
      const [sale] = await inTx((tx) => tx.select({ id: sales.id }).from(sales).limit(1));
      const error = await captureError(() =>
        open({ reason: "bill_payment", billPaymentId, saleId: sale!.id }),
      );
      expect(checkFailed(error, "drawer_opens_target_ck")).toBe(true);
    });

    it("still accepts a manual open with neither sale nor bill payment", async () => {
      await open({ reason: "manual" });
    });
  });
});
