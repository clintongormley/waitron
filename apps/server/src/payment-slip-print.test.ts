import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import {
  billPayments,
  devices,
  deviceProfiles,
  workingOrders,
  printJobs,
  sales,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBillEditState } from "./bill-editing.js";
import { decimal } from "@waitron/shared";
import { receiptLabelsFor } from "@waitron/country-packs";
import { cardReaders, cardReaderHolders, payments } from "@waitron/payments";
import { validateCapabilities } from "@waitron/layouts";
import { provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
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
          .set({ capabilities: [...validateCapabilities(profile.capabilities), "print-receipt"] })
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
  const withoutBalance = randomUUID();
  await withTransaction(venue.db, async (tx) => {
    const [row] = await tx.select().from(billPayments).where(eq(billPayments.id, paymentId));
    const [capture] = await tx.select().from(payments).where(eq(payments.billPaymentId, paymentId));
    await tx
      .insert(billPayments)
      .values({ ...row!, id: withoutBalance, submissionId: randomUUID(), remainingAfter: null });
    await tx.insert(payments).values({
      ...capture!,
      id: randomUUID(),
      billPaymentId: withoutBalance,
      paymentRef: randomUUID(),
      externalRef: null,
    });
  });
  const missing = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments/${withoutBalance}/slip-copy`,
    {},
  );
  expect(missing.status).toBe(200);
  const legacyBalance = await send(
    venue.app,
    venue.cookie,
    "GET",
    `/api/working-orders/${billId}/payments`,
  );
  expect(
    (legacyBalance.json as { payments: { id: string }[] }).payments.find(
      (row) => row.id === withoutBalance,
    ),
  ).not.toHaveProperty("canCopySlip");
  expect(venue.db.all(sql`select id from print_jobs`)).toHaveLength(before);
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

const readerContribution = {
  kind: "contribution",
  amount: "10.00",
  method: "card",
  entry: "reader",
  applied: "10.00",
  tip: "0.00",
} as const;

it("prints a requested slip only for the fresh confirmed reader capture", async () => {
  await withTransaction(venue.db, (tx) =>
    tx.update(cardReaders).set({ printsOwnSlipAutomatically: false }),
  );
  const billId = await tabWith(venue, "Botella tinto");
  const body = {
    submissionId: randomUUID(),
    ...readerContribution,
    printCardSlip: true,
  };
  const before = await venue.db.select().from(printJobs);
  const paid = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    body,
  );
  expect(paid.status).toBe(200);
  const jobs = await venue.db.select().from(printJobs);
  expect(jobs).toHaveLength(before.length + 1);
  expect(decodeTicket(jobs.at(-1)!.payload)).toContain("20,00");
  expect(decodeTicket(jobs.at(-1)!.payload)).not.toContain(receiptLabelsFor("es-ES").duplicate);
  expect(opensDrawer(jobs.at(-1)!.payload)).toBe(false);
  const replay = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    { ...body, printCardSlip: false },
  );
  expect(replay.status).toBe(200);
  expect(await venue.db.select().from(printJobs)).toHaveLength(jobs.length);
});

it.each([null, "true", 1])(
  "refuses non-boolean slip choice %j before charging",
  async (printCardSlip) => {
    const billId = await tabWith(venue, "Botella tinto");
    const calls = venue.card.collectCalls.length;
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId: randomUUID(),
        ...readerContribution,
        printCardSlip,
      },
    );
    expect(paid.status).toBe(400);
    expect(paid.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "printCardSlip" },
    });
    expect(venue.card.collectCalls).toHaveLength(calls);
  },
);

it.each(["whole", "short", "presented"])(
  "prints the %s card slip once and rejects an invalid choice",
  async (kind) => {
    await withTransaction(venue.db, (tx) =>
      tx.update(cardReaders).set({ printsOwnSlipAutomatically: false }),
    );
    const id = await tabWith(venue, "Botella tinto");
    if (kind === "presented")
      expect(
        (
          await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/place`, {
            expectedEdit: await withTransaction(venue.db, (tx) => readBillEditState(tx, id)),
          })
        ).status,
      ).toBe(200);
    const before = (await venue.db.select().from(printJobs)).length;
    const invalid = await send(venue.app, venue.cookie, "POST", "/api/pay", {
      id,
      lines: [],
      printCardSlip: "true",
    });
    expect(invalid.status).toBe(400);
    expect(invalid.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "printCardSlip" },
    });
    if (kind === "short") {
      const collect = venue.card.collect.bind(venue.card);
      vi.spyOn(venue.card, "collect").mockImplementationOnce((params) =>
        collect({ ...params, amount: decimal("10.00") }),
      );
    }
    const paid = await send(venue.app, venue.cookie, "POST", "/api/pay", {
      id,
      lines: [],
      printCardSlip: true,
    });
    expect(paid.status).toBe(200);
    expect(paid.json).toMatchObject({ outcome: kind === "short" ? "partial" : "captured" });
    const jobs = await venue.db.select().from(printJobs);
    const slips = jobs
      .slice(before)
      .filter((job) =>
        decodeTicket(job.payload).includes(receiptLabelsFor("es-ES").paymentRemaining),
      );
    expect(slips).toHaveLength(1);
    expect(decodeTicket(slips[0]!.payload)).toContain(kind === "short" ? "20,00" : "0,00");
    expect(opensDrawer(slips[0]!.payload)).toBe(false);
    const replay = await send(venue.app, venue.cookie, "POST", "/api/pay", {
      id,
      lines: [],
      printCardSlip: true,
    });
    expect(replay.status).toBe(200);
    expect(await venue.db.select().from(printJobs)).toHaveLength(jobs.length);
  },
);

it("keeps money received and warns when the selected slip printer disappears during collect", async () => {
  await withTransaction(venue.db, (tx) =>
    tx.update(cardReaders).set({ printsOwnSlipAutomatically: false }),
  );
  const billId = await tabWith(venue, "Botella tinto");
  const before = (await venue.db.select().from(printJobs)).length;
  const calls = venue.card.collectCalls.length;
  const release = venue.card.holdNextCollect();
  const paid = send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    ...readerContribution,
    printCardSlip: true,
  });
  try {
    await vi.waitFor(() => expect(venue.card.collectCalls).toHaveLength(calls + 1));
    await withTransaction(venue.db, (tx) =>
      tx.update(devices).set({ paymentSlipPrinterId: null }).where(eq(devices.id, venue.deviceId)),
    );
  } finally {
    release();
  }
  const answer = await paid;
  expect(answer.status).toBe(200);
  expect(answer.json).toMatchObject({
    outcome: "received",
    slipPrintFailed: true,
    balance: { received: "10.00" },
  });
  expect(await venue.db.select().from(printJobs)).toHaveLength(before);
  const [other] = await venue.db.select().from(devices).where(eq(devices.id, venue.device2Id));
  await withTransaction(venue.db, (tx) =>
    tx
      .update(devices)
      .set({ paymentSlipPrinterId: other!.paymentSlipPrinterId })
      .where(eq(devices.id, venue.deviceId)),
  );
});

it("keeps the order language chosen before the reader answers", async () => {
  const billId = await tabWith(venue, "Botella tinto");
  const before = (await venue.db.select().from(printJobs)).length;
  const calls = venue.card.collectCalls.length;
  const release = venue.card.holdNextCollect();
  const paid = send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    ...readerContribution,
    printCardSlip: true,
  });
  try {
    await vi.waitFor(() => expect(venue.card.collectCalls).toHaveLength(calls + 1));
    await withTransaction(venue.db, (tx) =>
      tx.update(workingOrders).set({ receiptLocale: "en-GB" }).where(eq(workingOrders.id, billId)),
    );
  } finally {
    release();
  }
  expect((await paid).status).toBe(200);
  const jobs = await venue.db.select().from(printJobs);
  expect(jobs).toHaveLength(before + 1);
  expect(decodeTicket(jobs.at(-1)!.payload)).toContain(receiptLabelsFor("es-ES").paymentRemaining);
  expect(decodeTicket(jobs.at(-1)!.payload)).not.toContain(
    receiptLabelsFor("en-GB").paymentRemaining,
  );
});

it.each(["cash", "manual"])("rejects a slip field on %s payments", async (method) => {
  const id = await tabWith(venue, "Botella tinto");
  const answer = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    amount: "10.00",
    method: method === "cash" ? "cash" : "card",
    ...(method === "cash" ? { tendered: "10.00" } : { entry: "manual" }),
    applied: "10.00",
    tip: "0.00",
    printCardSlip: false,
  });
  expect(answer.status).toBe(400);
  expect(answer.json).toMatchObject({
    code: "management.request_invalid",
    params: { field: "printCardSlip" },
  });
});

it("does not print an unrequested, declined or unanswered attempt", async () => {
  for (const outcome of ["off", "decline", "timeout"] as const) {
    const id = await tabWith(venue, "Botella tinto");
    if (outcome === "decline") venue.card.failNextCollect();
    if (outcome === "timeout") venue.card.stallNextCollect();
    const before = (await venue.db.select().from(printJobs)).length;
    const paid = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      ...readerContribution,
      ...(outcome === "off" ? {} : { printCardSlip: true }),
    });
    expect(paid.status).toBe(200);
    expect(paid.json).toMatchObject({
      outcome: outcome === "off" ? "received" : outcome === "decline" ? "declined" : "timeout",
    });
    expect(await venue.db.select().from(printJobs)).toHaveLength(before);
  }
});

it("recovers received money after an unclear answer without recovering the slip request", async () => {
  const id = await tabWith(venue, "Botella tinto");
  const before = (await venue.db.select().from(printJobs)).length;
  venue.card.crashNextCollect("captured");
  const paid = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
    submissionId: randomUUID(),
    ...readerContribution,
    printCardSlip: true,
  });
  expect(paid.status).toBe(500);
  for (let pass = 0; pass < 2; pass++) {
    await settlePendingBillPayments({
      admission: testTradingAdmission(),
      db: venue.db,
      backend: venue.backend,
      clock: venue.clock,
      cfg: venue.cfg,
    });
    expect(await venue.db.select().from(printJobs)).toHaveLength(before);
  }
  const balance = await send(venue.app, venue.cookie, "GET", `/api/working-orders/${id}/payments`);
  expect(balance.json).toMatchObject({ received: "10.00" });
});

it("keeps a received payment when enqueueing its requested slip fails", async () => {
  const id = await tabWith(venue, "Botella tinto");
  const before = (await venue.db.select().from(printJobs)).length;
  venue.db.run(
    sql`create temp trigger refuse_slip before insert on print_jobs begin select raise(abort, 'printer refused'); end`,
  );
  try {
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${id}/payments`,
      {
        submissionId: randomUUID(),
        ...readerContribution,
        printCardSlip: true,
      },
    );
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      outcome: "received",
      slipPrintFailed: true,
      balance: { received: "10.00" },
    });
    expect(await venue.db.select().from(printJobs)).toHaveLength(before);
  } finally {
    venue.db.run(sql`drop trigger refuse_slip`);
  }
});

it("uses the explicitly selected reader's own-slip setting", async () => {
  const readers = await venue.db.select().from(cardReaders);
  await withTransaction(venue.db, async (tx) => {
    await tx
      .update(cardReaderHolders)
      .set({ deviceId: venue.deviceId })
      .where(eq(cardReaderHolders.readerId, readers[1]!.id));
    await tx.update(cardReaders).set({ printsOwnSlipAutomatically: true });
    await tx
      .update(cardReaders)
      .set({ printsOwnSlipAutomatically: false })
      .where(eq(cardReaders.id, readers[1]!.id));
  });
  const id = await tabWith(venue, "Botella tinto");
  const before = (await venue.db.select().from(printJobs)).length;
  const paid = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
    submissionId: randomUUID(),
    ...readerContribution,
    readerId: readers[1]!.id,
    printCardSlip: true,
  });
  expect(paid.status).toBe(200);
  expect(venue.card.collectCalls.at(-1)).toHaveProperty("readerId", readers[1]!.id);
  expect(await venue.db.select().from(printJobs)).toHaveLength(before + 1);
  const other = await tabWith(venue, "Botella tinto");
  expect(
    (
      await send(venue.app, venue.cookie, "POST", `/api/working-orders/${other}/payments`, {
        submissionId: randomUUID(),
        ...readerContribution,
        readerId: readers[0]!.id,
        printCardSlip: true,
      })
    ).status,
  ).toBe(200);
  expect(await venue.db.select().from(printJobs)).toHaveLength(before + 1);
});
