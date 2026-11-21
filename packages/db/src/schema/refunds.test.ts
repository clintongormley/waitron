import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { checkFailed, refusalOn, triggerRaised } from "../constraint-target.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { REFUND_CHANGE_REFUSAL, REFUND_DELETE_REFUSAL } from "../trigger-refusals.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { seedDevice, seedNode, seedPerson, seedVenue, seedWorkingOrder } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { isRefusal } from "../unique-violation.js";
import { billPayments } from "./bill-payments.js";
import { sales, tenders } from "./sales.js";
import { invoiceSeries } from "./series.js";

const PERSON = "cccccccc-0000-4000-8000-000000000001";
const AT = "2026-10-16T10:00:00.000Z";
const REFUND = "dddddddd-0000-4000-8000-000000000001";
const SUBMISSION = "eeeeeeee-0000-4000-8000-000000000001";

describe("settled-tender refund ledger", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: true });
  let nodeId: string;
  let saleId: string;
  let tenderId: string;
  let deviceId: string;

  beforeEach(async () => {
    const db = suite.db;
    await seedPerson(db, { id: PERSON, displayName: "Cashier" });
    await seedVenue(db, {
      name: "Venue",
      invoiceLocales: ["es"],
    });
    nodeId = await seedNode(db);
    ({ deviceId } = await seedDevice(db));
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "TR", purpose: "standard" })
      .returning();
    const [sale] = await db
      .insert(sales)
      .values({
        source: "device",
        deviceId,
        nodeId,
        seriesId: series!.id,
        invoiceNumber: 1,
        issuedAt: AT,
        issuedOffsetMinutes: 0,
        total: 1000,
        vatBreakdown: [],
        locale: "es",
        invoiceLocales: ["es"],
        fiscalBackend: "none",
        fiscalState: "not_applicable",
      })
      .returning();
    saleId = sale!.id;
    const [tender] = await db
      .insert(tenders)
      .values({ saleId, method: "card", amount: 1100, tipAmount: 100, settledAt: AT })
      .returning();
    tenderId = tender!.id;
  });

  it("persists the pending request and captured-payment identity without rewriting the sale or tender", async () => {
    const db = suite.db;
    const originalSales = await db.select().from(sales);
    const originalTenders = await db.select().from(tenders);
    expect(
      db
        .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
        .map((r) => r.name),
    ).toContain("refunds");
    await withTransaction(db, async (tx) => {
      await tx.run(sql`insert into refunds
        (id, sale_id, tender_id, submission_id, fingerprint, applied_amount, tip_amount, reason,
         authorized_by, requested_by, source, device_id, node_id, method, provider, provider_payment_ref,
         state, created_at)
        values (${REFUND}, ${saleId}, ${tenderId}, ${SUBMISSION}, 'normalized-request', 500, 0, 'Goodwill',
         ${PERSON}, ${PERSON}, 'device', ${deviceId}, ${nodeId}, 'card', 'stripe', 'pi_original', 'pending', ${AT})`);
    });
    expect(
      db.all(
        sql`select id, sale_id, tender_id, state, applied_amount, tip_amount, provider_payment_ref, send_count, sent_at from refunds`,
      ),
    ).toEqual([
      {
        id: REFUND,
        sale_id: saleId,
        tender_id: tenderId,
        state: "pending",
        applied_amount: 500,
        tip_amount: 0,
        provider_payment_ref: "pi_original",
        send_count: 0,
        sent_at: null,
      },
    ]);
    expect(await db.select().from(sales)).toEqual(originalSales);
    expect(await db.select().from(tenders)).toEqual(originalTenders);
  });

  function insert(overrides: Record<string, string | number | null> = {}) {
    const r = {
      id: randomUUID(),
      bill_payment_id: null,
      sale_id: saleId,
      tender_id: tenderId,
      submission_id: randomUUID(),
      fingerprint: "normalized-request",
      applied_amount: 500,
      tip_amount: 0,
      reason: "Goodwill",
      authorized_by: PERSON,
      requested_by: PERSON,
      source: "device",
      device_id: deviceId,
      node_id: nodeId,
      method: "card",
      manual: 0,
      provider: "stripe",
      provider_payment_ref: "pi_original",
      state: "pending",
      created_at: AT,
      completed_at: null,
      failed_at: null,
      sent_at: null,
      send_count: 0,
      refs_before_send: null,
      provider_refund_ref: null,
      provider_status: null,
      last_lookup_at: null,
      next_retry_at: null,
      attested_by: null,
      attestation_note: null,
      ...overrides,
    };
    return withTransaction(suite.db, async (tx) => {
      await tx.run(sql`insert into refunds
        (id, bill_payment_id, sale_id, tender_id, submission_id, fingerprint, applied_amount, tip_amount, reason,
         authorized_by, requested_by, source, device_id, node_id, method, manual,
         provider, provider_payment_ref, state, created_at, completed_at, failed_at, sent_at, send_count,
         refs_before_send, provider_refund_ref, provider_status, last_lookup_at, next_retry_at, attested_by, attestation_note)
        values (${r.id}, ${r.bill_payment_id}, ${r.sale_id}, ${r.tender_id}, ${r.submission_id}, ${r.fingerprint}, ${r.applied_amount},
         ${r.tip_amount}, ${r.reason}, ${r.authorized_by}, ${r.requested_by}, ${r.source}, ${r.device_id},
         ${r.node_id}, ${r.method}, ${r.manual}, ${r.provider}, ${r.provider_payment_ref},
         ${r.state}, ${r.created_at}, ${r.completed_at}, ${r.failed_at}, ${r.sent_at}, ${r.send_count},
         ${r.refs_before_send}, ${r.provider_refund_ref}, ${r.provider_status}, ${r.last_lookup_at},
         ${r.next_retry_at}, ${r.attested_by}, ${r.attestation_note})`);
      return r.id;
    });
  }

  function update(refundId: string, assignment: ReturnType<typeof sql>) {
    return withTransaction(suite.db, async (tx) => {
      await tx.run(sql`update refunds set ${assignment} where id = ${refundId}`);
    });
  }

  it("requires a bill payment or a sale and tender as the sole parent", async () => {
    const order = await seedWorkingOrder(suite.db);
    const [payment] = await suite.db
      .insert(billPayments)
      .values({
        workingOrderId: order.id,
        submissionId: randomUUID(),
        fingerprint: "bill card",
        kind: "contribution",
        method: "card",
        applied: 500,
        state: "received",
        source: "device",
        deviceId,
        requestedBy: PERSON,
        receivedAt: AT,
      })
      .returning({ id: billPayments.id });
    const bill = { bill_payment_id: payment!.id, provider_payment_ref: "pi_bill" };
    const invalidParents: Record<string, string | null>[] = [
      bill,
      { ...bill, tender_id: null },
      { tender_id: null },
      { ...bill, sale_id: null },
      { sale_id: null },
      { sale_id: null, tender_id: null },
    ];
    for (const parent of invalidParents) {
      const error = await captureError(() => insert(parent));
      expect(checkFailed(error, "refunds_parent_ck")).toBe(true);
    }
    await insert({ ...bill, sale_id: null, tender_id: null });
    await insert();
    expect(
      suite.db.all(sql`select bill_payment_id, sale_id, tender_id from refunds order by rowid`),
    ).toEqual([
      { bill_payment_id: bill.bill_payment_id, sale_id: null, tender_id: null },
      { bill_payment_id: null, sale_id: saleId, tender_id: tenderId },
    ]);
  });

  it("only records a refund against a stored authorizer", async () => {
    const missingPerson = "ffffffff-0000-4000-8000-000000000001";
    const error = await captureError(() => insert({ authorized_by: missingPerson }));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    await insert();
    expect(suite.db.all(sql`select authorized_by from refunds`)).toEqual([
      { authorized_by: PERSON },
    ]);
  });

  it("keeps one submission identity per sale, including after failure", async () => {
    await insert({ submission_id: SUBMISSION, state: "failed", failed_at: AT });
    const error = await captureError(() => insert({ submission_id: SUBMISSION }));
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "refunds",
        columns: ["sale_id", "submission_id"],
      }),
    ).toBe(true);
  });

  it("reserves a tender against another pending attempt, but releases a failed attempt", async () => {
    const cash = { method: "cash", provider: null, provider_payment_ref: null };
    const first = await insert(cash);
    const error = await captureError(() => insert(cash));
    expect(refusalOn(error, UNIQUE_VIOLATION, { table: "refunds", columns: ["tender_id"] })).toBe(
      true,
    );
    await update(first, sql`state = 'failed', failed_at = ${AT}`);
    const second = await insert(cash);
    expect(second).not.toBe(first);
    expect(suite.db.all(sql`select state from refunds order by rowid`)).toEqual([
      { state: "failed" },
      { state: "pending" },
    ]);
  });

  it("reserves one captured payment even if two tenders name it, allowing an independent capture", async () => {
    await insert();
    const [another] = await suite.db
      .insert(tenders)
      .values({ saleId, method: "card", amount: 100, tipAmount: 0, settledAt: AT })
      .returning();
    const error = await captureError(() => insert({ tender_id: another!.id }));
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "refunds",
        columns: ["provider", "provider_payment_ref"],
      }),
    ).toBe(true);
    await insert({ tender_id: another!.id, provider_payment_ref: "pi_independent" });
    expect(suite.db.all(sql`select count(*) as n from refunds`)).toEqual([{ n: 2 }]);
  });

  it.each([
    ["applied_amount", -1],
    ["tip_amount", -1],
    ["applied_amount", 0.5],
    ["tip_amount", 0.5],
    ["applied_amount", "garbage"],
    ["applied_amount", 100000000000000],
  ])("refuses invalid whole-cent storage %s=%s", async (column, value) => {
    const error = await captureError(() => insert({ [column]: value }));
    expect(checkFailed(error, "refunds_amounts_ck")).toBe(true);
  });

  it("refuses zero total but permits a positive tip-only intent", async () => {
    const error = await captureError(() => insert({ applied_amount: 0 }));
    expect(checkFailed(error, "refunds_amounts_ck")).toBe(true);
    await insert({ applied_amount: 0, tip_amount: 100 });
    expect(suite.db.all(sql`select applied_amount, tip_amount from refunds`)).toEqual([
      { applied_amount: 0, tip_amount: 100 },
    ]);
  });

  it.each([
    [{ state: "other" }, "state"],
    [{ state: "completed" }, "completed_at"],
    [{ state: "failed" }, "failed_at"],
    [{ completed_at: AT }, "completed_at"],
    [{ failed_at: AT }, "failed_at"],
    [{ send_count: 1 }, "sent"],
    [{ sent_at: AT }, "sent"],
    [{ send_count: -1, sent_at: AT }, "sent"],
    [{ send_count: 0.5, sent_at: AT }, "sent"],
    [{ method: "voucher" }, "method"],
    [{ reason: "  " }, "reason"],
    [{ provider_payment_ref: null }, "provider"],
    [{ manual: 1 }, "provider"],
    [{ method: "cash" }, "provider"],
    [{ provider_status: "invented" }, "provider_status"],
    [{ refs_before_send: "not json" }, "refs"],
    [{ refs_before_send: "{}" }, "refs"],
    [{ attested_by: PERSON }, "attestation"],
    [{ attested_by: PERSON, attestation_note: "checked" }, "attestation"],
    [
      { state: "completed", completed_at: AT, attested_by: PERSON, attestation_note: "  " },
      "attestation",
    ],
    [{ device_id: null }, "source_device"],
  ] as const)("refuses inconsistent metadata %j", async (overrides, constraint) => {
    const error = await captureError(() => insert(overrides));
    expect(checkFailed(error, `refunds_${constraint}_ck`)).toBe(true);
  });

  it.each([
    { method: "cash", manual: 0, provider: null, provider_payment_ref: null },
    { method: "card", manual: 1, provider: null, provider_payment_ref: null },
  ])("stores an explicitly completed local return %j", async (overrides) => {
    await insert({ ...overrides, state: "completed", completed_at: AT });
    expect(suite.db.all(sql`select state, send_count from refunds`)).toEqual([
      { state: "completed", send_count: 0 },
    ]);
  });

  it.each([
    ["id", "ffffffff-0000-4000-8000-000000000001"],
    ["sale_id", "ffffffff-0000-4000-8000-000000000002"],
    ["tender_id", "ffffffff-0000-4000-8000-000000000003"],
    ["submission_id", "ffffffff-0000-4000-8000-000000000004"],
    ["fingerprint", "different"],
    ["applied_amount", 501],
    ["tip_amount", 1],
    ["reason", "Changed"],
    ["authorized_by", "another-person"],
    ["requested_by", "another-person"],
    ["source", "operator_script"],
    ["device_id", null],
    ["node_id", "another-node"],
    ["method", "cash"],
    ["manual", 1],
    ["provider", "sumup"],
    ["provider_payment_ref", "pi_other"],
    ["created_at", "2026-10-17T00:00:00.000Z"],
  ])("refuses rewriting request field %s", async (column, value) => {
    const refundId = await insert();
    const error = await captureError(() =>
      update(refundId, sql`${sql.identifier(column)} = ${value}`),
    );
    expect(triggerRaised(error, REFUND_CHANGE_REFUSAL)).toBe(true);
  });

  it("records send intent, fixed pre-send references and a stable provider event before completing once", async () => {
    const refundId = await insert();
    await update(refundId, sql`sent_at = ${AT}, send_count = 1, refs_before_send = '["re_old"]'`);
    await update(
      refundId,
      sql`provider_refund_ref = 're_current', provider_status = 'pending', last_lookup_at = ${AT}, next_retry_at = ${AT}`,
    );
    await update(refundId, sql`send_count = 2`);
    await update(
      refundId,
      sql`state = 'completed', completed_at = ${AT}, provider_status = 'completed', next_retry_at = null`,
    );
    await update(refundId, sql`state = 'completed'`);
    expect(
      suite.db.all(
        sql`select state, send_count, sent_at, provider_refund_ref, refs_before_send, next_retry_at from refunds`,
      ),
    ).toEqual([
      {
        state: "completed",
        send_count: 2,
        sent_at: AT,
        provider_refund_ref: "re_current",
        refs_before_send: '["re_old"]',
        next_retry_at: null,
      },
    ]);
  });

  it.each([
    sql`send_count = 3`,
    sql`send_count = 0, sent_at = null`,
    sql`sent_at = '2026-10-17T00:00:00.000Z'`,
    sql`refs_before_send = '[]'`,
    sql`provider_refund_ref = 're_changed'`,
    sql`provider_refund_ref = null`,
  ])("refuses changing prior send evidence %#", async (assignment) => {
    const refundId = await insert({
      sent_at: AT,
      send_count: 1,
      refs_before_send: '["re_old"]',
      provider_refund_ref: "re_current",
    });
    const error = await captureError(() => update(refundId, assignment));
    expect(triggerRaised(error, REFUND_CHANGE_REFUSAL)).toBe(true);
  });

  it.each(["completed", "failed"])(
    "keeps every %s outcome and its evidence fixed",
    async (state) => {
      const refundId = await insert({
        state,
        [state === "completed" ? "completed_at" : "failed_at"]: AT,
      });
      for (const assignment of [
        sql`state = 'pending', completed_at = null, failed_at = null`,
        sql`sent_at = ${AT}, send_count = 1`,
        sql`provider_refund_ref = 're_late'`,
        sql`last_lookup_at = ${AT}`,
        sql`next_retry_at = ${AT}`,
        sql`attested_by = ${PERSON}, attestation_note = 'Late claim'`,
        sql`provider_status = 'completed'`,
        state === "completed"
          ? sql`completed_at = '2026-10-17T00:00:00.000Z'`
          : sql`failed_at = '2026-10-17T00:00:00.000Z'`,
      ]) {
        const error = await captureError(() => update(refundId, assignment));
        expect(triggerRaised(error, REFUND_CHANGE_REFUSAL)).toBe(true);
      }
      await update(refundId, sql`state = ${state}`);
      expect(suite.db.all(sql`select state from refunds`)).toEqual([{ state }]);
    },
  );

  it("stamps a completed cash refund once", async () => {
    const refundId = await insert({
      method: "cash",
      provider: null,
      provider_payment_ref: null,
      state: "completed",
      completed_at: AT,
    });
    await update(refundId, sql`drawer_opened_at = ${AT}`);
    for (const value of [null, "2026-10-17T00:00:00.000Z"]) {
      const error = await captureError(() => update(refundId, sql`drawer_opened_at = ${value}`));
      expect(triggerRaised(error, REFUND_CHANGE_REFUSAL)).toBe(true);
    }
    expect(suite.db.all(sql`select drawer_opened_at from refunds`)).toEqual([
      { drawer_opened_at: AT },
    ]);
  });

  it.each([
    ["pending cash", { method: "cash", provider: null, provider_payment_ref: null }],
    [
      "failed cash",
      {
        method: "cash",
        provider: null,
        provider_payment_ref: null,
        state: "failed",
        failed_at: AT,
      },
    ],
    ["completed card", { state: "completed", completed_at: AT }],
  ] as const)("refuses a drawer stamp on a %s refund", async (_kind, fields) => {
    const refundId = await insert(fields);
    const error = await captureError(() => update(refundId, sql`drawer_opened_at = ${AT}`));
    expect(triggerRaised(error, REFUND_CHANGE_REFUSAL)).toBe(true);
    expect(suite.db.all(sql`select drawer_opened_at from refunds`)).toEqual([
      { drawer_opened_at: null },
    ]);
  });

  it("does not delete an unresolved request", async () => {
    const refundId = await insert();
    const error = await captureError(() =>
      withTransaction(suite.db, async (tx) => {
        await tx.run(sql`delete from refunds where id = ${refundId}`);
      }),
    );
    expect(triggerRaised(error, REFUND_DELETE_REFUSAL)).toBe(true);
  });

  it("does not attribute one provider event to another completed or failed attempt", async () => {
    await insert({ state: "failed", failed_at: AT, provider_refund_ref: "re_attributed" });
    const error = await captureError(() =>
      insert({ state: "completed", completed_at: AT, provider_refund_ref: "re_attributed" }),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "refunds",
        columns: ["provider", "provider_payment_ref", "provider_refund_ref"],
      }),
    ).toBe(true);
    await insert({ state: "completed", completed_at: AT, provider_refund_ref: "re_distinct" });
    expect(suite.db.all(sql`select count(*) as n from refunds`)).toEqual([{ n: 2 }]);
  });
});
