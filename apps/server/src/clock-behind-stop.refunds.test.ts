import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sales, refunds, tenders } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { inTx, provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { systemClock } from "./till-backend.js";
import { refundableCancel } from "./testing/cancel-line.js";
import "./errors.js";

let venue: BillVenue;

// Every case reads NOW, the latest record's time, and builds each clock from it. Only the setup
// and the whole payments of a Seafood rice bill record sales; every refund is 5.00 of one.
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    const billId = await tabWith(venue, "Seafood rice");
    const settled = await pay(venue.app, billId, cashPart("35.00"));
    if (settled.status !== 200) throw new Error(`setup sale answered ${settled.status}`);
  },
});

const MINUTE = 60_000;
const OVERRIDE = () => ({ personId: venue.adminId, pin: "1234" });

function latest(): { at: Date; offsetMinutes: number } {
  const [row] = venue.db.all<{ at: string; offsetMinutes: number }>(sql`
    select fecha_hora_huso_gen_registro as at, offset_minutos as offsetMinutes
    from verifactu_records
    order by fecha_hora_huso_gen_registro desc, id desc
    limit 1
  `);
  return { at: new Date(row!.at), offsetMinutes: row!.offsetMinutes };
}

const nowMs = () => latest().at.getTime();

function clockAt(ms: number): TrustedClock {
  const base = systemClock();
  const reading = { ...base.now(), instant: new Date(ms), offsetMinutes: 60 };
  return { ...base, now: () => reading };
}

const at = (ms: number) => venue.appAt(clockAt(ms));

function cashPart(amount = "35.00") {
  return {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method: "cash",
    tendered: amount,
    applied: amount,
    tip: "0.00",
  };
}

const readerPart = (amount = "35.00") => ({
  submissionId: randomUUID(),
  kind: "contribution",
  amount,
  method: "card",
  entry: "reader",
  applied: amount,
  tip: "0.00",
});

function pay(app: Hono, billId: string, body: Record<string, unknown>) {
  return send(app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, body);
}

/** A Seafood rice bill paid whole at `ms`, which files its invoice, then its line cancelled for a
 * refund; answers the sale, its one tender and the cancel. */
async function soldAt(ms: number, method: "cash" | "card") {
  const billId = await tabWith(venue, "Seafood rice");
  const paid = await pay(at(ms), billId, method === "cash" ? cashPart() : readerPart());
  expect(paid.status).toBe(200);
  const [tender] = await inTx(venue, (tx) =>
    tx
      .select({ saleId: tenders.saleId, tenderId: tenders.id })
      .from(tenders)
      .innerJoin(sales, eq(sales.id, tenders.saleId))
      .where(eq(sales.workingOrderId, billId)),
  );
  return { ...tender!, cancellationId: await refundableCancel(venue.db, venue.cfg, billId, 1) };
}

const refundBody = (
  { tenderId, cancellationId }: { tenderId: string; cancellationId: string },
  submissionId: string = randomUUID(),
) => ({
  submissionId,
  tenderId,
  cancellationIds: [cancellationId],
  appliedAmount: "5.00",
  tipAmount: "0.00",
  reason: "Overcharged",
  override: OVERRIDE(),
});

function tenderRefund(app: Hono, saleId: string, body: Record<string, unknown>) {
  return send(app, venue.cookie, "POST", `/api/transactions/${saleId}/refunds`, body);
}

function retry(app: Hono, refundId: string) {
  return send(app, venue.cookie, "POST", `/api/tender-refunds/${refundId}/retry`, {
    override: OVERRIDE(),
  });
}

function tenderRefundRows(saleId: string) {
  return inTx(venue, (tx) => tx.select().from(refunds).where(eq(refunds.saleId, saleId)));
}

const refundSends = () => venue.card.refundCalls.length;

function drawerJobs(): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from print_jobs where kind = 'drawer'`,
  );
  return row!.n;
}

it("answers a finished refund's retry with its row", async () => {
  const now = nowMs();
  const sold = await soldAt(now, "card");
  const { saleId } = sold;
  const done = await tenderRefund(at(now), saleId, refundBody(sold));
  expect(done.json).toMatchObject({ state: "completed" });
  const [row] = await tenderRefundRows(saleId);
  const sends = refundSends();

  const answer = await retry(at(now - 10 * MINUTE), row!.id);

  expect(answer.status).toBe(200);
  expect(answer.json).toEqual(done.json);
  expect(refundSends()).toBe(sends);
  expect(await tenderRefundRows(saleId)).toEqual([row]);
});

it("answers a finished refund's replay", async () => {
  const now = nowMs();
  const sold = await soldAt(now, "cash");
  const { saleId } = sold;
  const body = refundBody(sold);
  const done = await tenderRefund(at(now), saleId, body);
  expect(done.status).toBe(200);
  expect(done.json).toMatchObject({ state: "completed" });
  const drawers = drawerJobs();

  const replay = await tenderRefund(at(now - 10 * MINUTE), saleId, body);

  expect(replay.status).toBe(200);
  expect(replay.json).toEqual(done.json);
  expect(await tenderRefundRows(saleId)).toHaveLength(1);
  expect(drawerJobs()).toBe(drawers);
});
