import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { billPayments, deviceProfiles, printJobs, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { receiptLabelsFor } from "@waitron/country-packs";
import { cardReaders } from "@waitron/payments";
import { provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { decodeTicket, opensDrawer } from "./testing/decode-ticket.js";

let venue: BillVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await withTransaction(db, async (tx) => {
      for (const profile of await tx.select().from(deviceProfiles))
        await tx
          .update(deviceProfiles)
          .set({ capabilities: [...profile.capabilities, "print-receipt"] })
          .where(eq(deviceProfiles.id, profile.id));
    });
  },
});

it("copies a reader payment before settlement and keeps its original balance after another payment", async () => {
  const billId = await tabWith(venue, "Botella tinto");
  const paid = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "10.00",
      method: "card",
      entry: "reader",
      applied: "10.00",
      tip: "0.00",
    },
  );
  expect(paid.status).toBe(200);
  const paymentId = (paid.json as { payment: { id: string } }).payment.id;
  expect(paid.json).toMatchObject({ payment: { canCopySlip: true } });
  for (let round = 0; round < 3; round++) {
    if (round === 2) {
      const refunded = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${billId}/payments/${paymentId}/refunds`,
        {
          submissionId: randomUUID(),
          reason: "Guest changed their mind",
          appliedAmount: "1.00",
          tipAmount: "0.00",
          override: { personId: venue.adminId, pin: "1234" },
        },
      );
      expect(refunded.status).toBe(200);
    }
    if (round === 1) {
      const next = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${billId}/payments`,
        {
          submissionId: randomUUID(),
          kind: "contribution",
          amount: "5.00",
          method: "cash",
          tendered: "5.00",
          applied: "5.00",
          tip: "0.00",
        },
      );
      expect(next.status).toBe(200);
    }
    const before = venue.db.all(sql`select id from print_jobs`).length;
    const copy = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments/${paymentId}/slip-copy`,
      {},
    );
    expect(copy.status).toBe(200);
    const jobs = await venue.db.select().from(printJobs);
    expect(jobs).toHaveLength(before + 1);
    const job = jobs.at(-1)!;
    const text = decodeTicket(job.payload);
    const labels = receiptLabelsFor("es-ES");
    expect(text).toContain(labels.duplicate);
    expect(text).toContain(labels.paymentRemaining);
    expect(text).toContain("20,00");
    expect(opensDrawer(job.payload)).toBe(false);
    expect(await venue.db.select().from(sales)).toHaveLength(0);
  }
  const settled = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "16.00",
      method: "cash",
      tendered: "16.00",
      applied: "16.00",
      tip: "0.00",
    },
  );
  expect(settled.status).toBe(200);
  const copy = await send(venue.app, venue.cookie, "POST", `/api/sales/${billId}/payment-slip`, {});
  expect(copy.status).toBe(200);
  const jobs = await venue.db
    .select()
    .from(printJobs)
    .orderBy(printJobs.createdAt, sql`${printJobs}.rowid`);
  expect(decodeTicket(jobs.at(-1)!.payload)).toContain("20,00");
});

it("rejects a payment on another bill and offers no copy for an own-slip reader", async () => {
  const billId = await tabWith(venue, "Botella tinto");
  const otherId = await tabWith(venue, "Tarta");
  const paid = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "10.00",
      method: "card",
      entry: "reader",
      applied: "10.00",
      tip: "0.00",
    },
  );
  expect(paid.status).toBe(200);
  const paymentId = (paid.json as { payment: { id: string } }).payment.id;
  const before = venue.db.all(sql`select id from print_jobs`).length;
  const wrong = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${otherId}/payments/${paymentId}/slip-copy`,
    {},
  );
  expect(wrong.status).toBe(404);
  expect(wrong.json).toMatchObject({ code: "bill.payment_not_found" });
  await withTransaction(venue.db, (tx) =>
    tx.update(cardReaders).set({ printsOwnSlipAutomatically: true }),
  );
  const own = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments/${paymentId}/slip-copy`,
    {},
  );
  expect(own.status).toBe(200);
  const balance = await send(
    venue.app,
    venue.cookie,
    "GET",
    `/api/working-orders/${billId}/payments`,
  );
  expect((balance.json as { payments: unknown[] }).payments[0]).not.toHaveProperty("canCopySlip");
  expect(venue.db.all(sql`select id from print_jobs`)).toHaveLength(before);
  expect(
    (await venue.db.select().from(billPayments).where(eq(billPayments.id, paymentId)))[0],
  ).toHaveProperty("remainingAfter", 2000);
});
