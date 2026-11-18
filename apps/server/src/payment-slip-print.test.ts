import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  billPaymentRefunds,
  billPayments,
  devices,
  deviceProfiles,
  workingOrders,
  printJobs,
  sales,
  tenderRefunds,
  tenders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { readBillEditState } from "./bill-editing.js";
import { decimal } from "@waitron/shared";
import { receiptLabelsFor } from "@waitron/country-packs";
import { cardReaders, payments } from "@waitron/payments";
import { liftPaymentGuard } from "@waitron/payments/src/testing/lift-payment-guard.js";
import { validateCapabilities } from "@waitron/layouts";
import {
  fiscalRecordCount,
  provisionBillVenue,
  send,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { credit } from "./testing/order-venue.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { deferredCloseKit } from "./testing/deferred-close-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts } from "./testing/zone-offers.js";
import { decodeTicket, opensDrawer } from "./testing/decode-ticket.js";

/** The slip line that starts with `label`: the amounts on it, not a figure elsewhere on the slip. */
const slipRow = (text: string, label: string) =>
  text.split("\n").find((line) => line.startsWith(label));

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
  const billId = await tabWith(venue, "Red wine bottle");
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
  const [capture] = await venue.db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.billPaymentId, paymentId));
  const before = (await venue.db.select().from(printJobs)).length;
  const copy = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/sales/${billId}/payment-slip/${capture!.id}`,
    {},
  );
  expect(copy.status).toBe(200);
  const printed = (
    await venue.db
      .select()
      .from(printJobs)
      .orderBy(printJobs.createdAt, sql`${printJobs}.rowid`)
  ).slice(before);
  expect(printed).toHaveLength(1);
  const text = decodeTicket(printed[0]!.payload);
  const labels = receiptLabelsFor("es-ES");
  expect(text).toContain(labels.duplicate);
  expect(slipRow(text, labels.charged)).toContain("10,00");
  expect(text).toContain("20,00");
});

it("rejects a payment on another bill and offers no copy for an own-slip reader", async () => {
  const billId = await tabWith(venue, "Red wine bottle");
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

beforeEach(() =>
  withTransaction(venue.db, (tx) =>
    tx.update(cardReaders).set({ printsOwnSlipAutomatically: false }),
  ),
);

const readerContribution = {
  kind: "contribution",
  amount: "10.00",
  method: "card",
  entry: "reader",
  applied: "10.00",
  tip: "0.00",
} as const;

it("prints a requested slip only for the fresh confirmed reader capture", async () => {
  const billId = await tabWith(venue, "Red wine bottle");
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
    const billId = await tabWith(venue, "Red wine bottle");
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

it.each(["whole", "short", "presented", "issued"])(
  "prints the %s card slip once and rejects an invalid choice",
  async (kind) => {
    const id = await tabWith(venue, "Red wine bottle");
    if (kind === "issued")
      await issueOrderInvoice(
        { ...venue, admission: testTradingAdmission() },
        venue.cfg,
        id,
        venue.operatorId,
      );
    if (kind === "presented" || kind === "issued")
      expect(
        (
          await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/place`, {
            expectedEdit: await withTransaction(venue.db, (tx) => readBillEditState(tx, id)),
          })
        ).status,
      ).toBe(200);
    const before = (await venue.db.select().from(printJobs)).length;
    const invalid = await send(venue.app, venue.cookie, "POST", "/api/pay", {
      dining: "eat_in",
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
      dining: "eat_in",
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
      dining: "eat_in",
      id,
      lines: [],
      printCardSlip: true,
    });
    expect(replay.status).toBe(200);
    expect(await venue.db.select().from(printJobs)).toHaveLength(jobs.length);
  },
);

it.each(["before", "during"])(
  "keeps money received and warns when the selected slip printer disappears %s collect",
  async (when) => {
    const [device] = await venue.db.select().from(devices).where(eq(devices.id, venue.deviceId));
    onTestFinished(async () => {
      await withTransaction(venue.db, (tx) =>
        tx
          .update(devices)
          .set({ paymentSlipPrinterId: device!.paymentSlipPrinterId })
          .where(eq(devices.id, venue.deviceId)),
      );
    });
    if (when === "before")
      await withTransaction(venue.db, (tx) =>
        tx
          .update(devices)
          .set({ paymentSlipPrinterId: null })
          .where(eq(devices.id, venue.deviceId)),
      );
    const billId = await tabWith(venue, "Red wine bottle");
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
        tx
          .update(devices)
          .set({ paymentSlipPrinterId: null })
          .where(eq(devices.id, venue.deviceId)),
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
  },
);

it("keeps the order language chosen before the reader answers", async () => {
  const billId = await tabWith(venue, "Red wine bottle");
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
  const id = await tabWith(venue, "Red wine bottle");
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
    const id = await tabWith(venue, "Red wine bottle");
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
  const id = await tabWith(venue, "Red wine bottle");
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
  const log = vi.fn();
  const id = await tabWith(venue, "Red wine bottle");
  const before = (await venue.db.select().from(printJobs)).length;
  venue.db.run(
    sql`create temp trigger refuse_slip before insert on print_jobs begin select raise(abort, 'printer refused'); end`,
  );
  try {
    const answer = await send(
      venue.appWith({ log }),
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
    expect(log).toHaveBeenCalledWith("warn", "payment.slip_print_failed", {
      workingOrderId: id,
      reason: "enqueue_failed",
    });
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
  const [holder] = await venue.db
    .select()
    .from(cardReaders)
    .where(eq(cardReaders.id, readers[1]!.id));
  onTestFinished(async () => {
    await withTransaction(venue.db, (tx) =>
      tx
        .update(cardReaders)
        .set({ heldByDeviceId: holder!.heldByDeviceId })
        .where(eq(cardReaders.id, readers[1]!.id)),
    );
  });
  await withTransaction(venue.db, async (tx) => {
    await tx
      .update(cardReaders)
      .set({ heldByDeviceId: venue.deviceId })
      .where(eq(cardReaders.id, readers[1]!.id));
    await tx.update(cardReaders).set({ printsOwnSlipAutomatically: true });
    await tx
      .update(cardReaders)
      .set({ printsOwnSlipAutomatically: false })
      .where(eq(cardReaders.id, readers[1]!.id));
  });
  const id = await tabWith(venue, "Red wine bottle");
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
  const other = await tabWith(venue, "Red wine bottle");
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

it("rolls back the whole-card attempt when preparing its optional slip fails", async () => {
  const id = await tabWith(venue, "Red wine bottle");
  const calls = venue.card.collectCalls.length;
  venue.db.run(sql`create temp table printers (broken text)`);
  try {
    const answer = await send(venue.app, venue.cookie, "POST", "/api/pay", {
      dining: "eat_in",
      id,
      lines: [],
      printCardSlip: true,
    });
    expect(answer.status).toBe(500);
    expect(venue.card.collectCalls).toHaveLength(calls);
    const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(order!.paymentAttemptAt).toBeNull();
  } finally {
    venue.db.run(sql`drop table temp.printers`);
  }
});

it("ignores a forged slip request without the print capability", async () => {
  const profiles = await venue.db.select().from(deviceProfiles);
  onTestFinished(() =>
    withTransaction(venue.db, async (tx) => {
      for (const profile of profiles)
        await tx
          .update(deviceProfiles)
          .set({ capabilities: profile.capabilities })
          .where(eq(deviceProfiles.id, profile.id));
    }),
  );
  await withTransaction(venue.db, async (tx) => {
    for (const profile of profiles)
      await tx
        .update(deviceProfiles)
        .set({
          capabilities: validateCapabilities(profile.capabilities).filter(
            (capability) => capability !== "print-receipt",
          ),
        })
        .where(eq(deviceProfiles.id, profile.id));
  });
  const id = await tabWith(venue, "Red wine bottle");
  const before = (await venue.db.select().from(printJobs)).length;
  const paid = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
    submissionId: randomUUID(),
    ...readerContribution,
    printCardSlip: true,
  });
  expect(paid.status).toBe(200);
  expect(paid.json).toMatchObject({ outcome: "received" });
  expect(await venue.db.select().from(printJobs)).toHaveLength(before);
});

describe("the Payment slip button on a paid sale", () => {
  const labels = receiptLabelsFor("es-ES");
  const duplicate = labels.duplicate;

  const take = async (
    billId: string,
    amount: string,
    entry: "reader" | "manual" = "reader",
    extra: Record<string, string> = {},
  ) => {
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount,
        method: "card",
        entry,
        applied: amount,
        tip: "0.00",
        ...extra,
      },
    );
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  };

  /** A sale paid by two reader cards, €10.00 on ****1111 and then €20.00 on ****2222. */
  const twoCardSale = async () => {
    const billId = await tabWith(venue, "Red wine bottle");
    await take(billId, "10.00");
    await take(billId, "20.00");
    const rows = await venue.db
      .select()
      .from(payments)
      .where(eq(payments.workingOrderId, billId))
      .orderBy(sql`rowid`);
    const [first, second] = rows as [(typeof rows)[0], (typeof rows)[0]];
    await liftPaymentGuard(venue.db, async () => {
      await venue.db
        .update(payments)
        .set({ cardScheme: "VISA", cardLast4: "1111" })
        .where(eq(payments.id, first.id));
      await venue.db
        .update(payments)
        .set({ cardScheme: "MASTERCARD", cardLast4: "2222" })
        .where(eq(payments.id, second.id));
    });
    return { billId, first, second };
  };

  const offered = async (billId: string) => {
    const ticket = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/sales/${billId}?receiptPreview=1`,
    );
    expect(ticket.status).toBe(200);
    return (ticket.json as { paymentSlips: { id: string }[] }).paymentSlips;
  };

  const printedBy = async (path: string) => {
    const before = (await venue.db.select().from(printJobs)).length;
    const answer = await send(venue.app, venue.cookie, "POST", path, {});
    const jobs = await venue.db
      .select()
      .from(printJobs)
      .orderBy(printJobs.createdAt, sql`${printJobs}.rowid`);
    return { answer, printed: jobs.slice(before) };
  };

  const press = (billId: string, paymentId: string) =>
    printedBy(`/api/sales/${billId}/payment-slip/${paymentId}`);

  /** The Pay dialog's Print a copy, which this button has to match. */
  const printACopy = (billId: string, billPaymentId: string) =>
    printedBy(`/api/working-orders/${billId}/payments/${billPaymentId}/slip-copy`);

  it("prints only the chosen card, marked as a copy, on a sale split across two cards", async () => {
    const { billId, first, second } = await twoCardSale();
    expect(await offered(billId)).toEqual([
      { id: first.id, amount: "10.00", last4: "1111" },
      { id: second.id, amount: "20.00", last4: "2222" },
    ]);
    const records = fiscalRecordCount(venue);
    for (const [payment, own, other, remaining] of [
      [first, "Visa ****1111", "2222", "20,00"],
      [second, "Mastercard ****2222", "1111", "0,00"],
    ] as const) {
      const { answer, printed } = await press(billId, payment.id);
      expect(answer.status).toBe(200);
      expect(printed).toHaveLength(1);
      const text = decodeTicket(printed[0]!.payload);
      expect(text).toContain(duplicate);
      expect(text).toContain(own);
      expect(text).not.toContain(other);
      expect(
        text
          .split("\n")
          .find((line) => line.startsWith(receiptLabelsFor("es-ES").paymentRemaining)),
      ).toContain(remaining);
      expect(opensDrawer(printed[0]!.payload)).toBe(false);
    }
    expect(fiscalRecordCount(venue)).toBe(records);
  });

  it("prints one marked copy of a sale paid by a single card", async () => {
    const id = await tabWith(venue, "Red wine bottle");
    const paid = await send(venue.app, venue.cookie, "POST", "/api/pay", {
      dining: "eat_in",
      id,
      lines: [],
    });
    expect(paid.status).toBe(200);
    const [only] = await offered(id);
    const { answer, printed } = await press(id, only!.id);
    expect(answer.status).toBe(200);
    expect(printed).toHaveLength(1);
    expect(decodeTicket(printed[0]!.payload)).toContain(duplicate);
  });

  it("leaves the plain ticket read without the list of slips", async () => {
    const { billId } = await twoCardSale();
    const ticket = await send(venue.app, venue.cookie, "GET", `/api/sales/${billId}`);
    expect(ticket.status).toBe(200);
    expect(ticket.json).not.toHaveProperty("paymentSlips");
  });

  it("refuses a press naming no payment, or a payment of another sale, and prints nothing", async () => {
    const { billId, first } = await twoCardSale();
    const other = await twoCardSale();
    const before = (await venue.db.select().from(printJobs)).length;
    const unnamed = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/sales/${billId}/payment-slip`,
      {},
    );
    expect(unnamed.status).toBe(404);
    for (const paymentId of [other.first.id, randomUUID(), "not-an-id"]) {
      const { answer, printed } = await press(billId, paymentId);
      expect(answer.status).toBe(404);
      expect(answer.json).toMatchObject({ code: "bill.payment_not_found" });
      expect(printed).toEqual([]);
    }
    expect((await press(other.billId, first.id)).answer.status).toBe(404);
    expect(await venue.db.select().from(printJobs)).toHaveLength(before);
  });

  const billRefund = (billPaymentId: string, state: "pending" | "failed"): Promise<void> =>
    withTransaction(venue.db, async (tx) => {
      await tx.insert(billPaymentRefunds).values({
        billPaymentId,
        submissionId: randomUUID(),
        fingerprint: randomUUID(),
        appliedAmount: 100,
        reason: "Guest changed their mind",
        authorizedBy: venue.adminId,
        requestedBy: venue.operatorId,
        source: "device",
        deviceId: venue.deviceId,
        state,
        ...(state === "failed" ? { failedAt: new Date().toISOString() } : {}),
      });
    });

  const tenderRefund = (
    billId: string,
    billPaymentId: string,
    state: "pending" | "failed",
  ): Promise<void> =>
    withTransaction(venue.db, async (tx) => {
      const [sale] = await tx.select().from(sales).where(eq(sales.workingOrderId, billId));
      const [tender] = await tx
        .select()
        .from(tenders)
        .where(eq(tenders.billPaymentId, billPaymentId));
      const id = randomUUID();
      await tx.insert(tenderRefunds).values({
        id,
        saleId: sale!.id,
        tenderId: tender!.id,
        submissionId: randomUUID(),
        fingerprint: id,
        appliedAmount: 100,
        reason: "Guest changed their mind",
        authorizedBy: venue.adminId,
        requestedBy: venue.operatorId,
        source: "device",
        deviceId: venue.deviceId,
        nodeId: venue.cfg.nodeId,
        method: "card",
        provider: "fake",
        providerPaymentRef: id,
        state,
        ...(state === "failed" ? { failedAt: new Date().toISOString() } : {}),
      });
    });

  it.each([
    ["a refund of the bill payment", (_: string, p: string) => billRefund(p, "pending")],
    ["a refund of its tender", (b: string, p: string) => tenderRefund(b, p, "pending")],
  ])("still gives a copy of a card after %s, beside the other card", async (_, refund) => {
    const { billId, first, second } = await twoCardSale();
    await refund(billId, first.billPaymentId!);
    expect(await offered(billId)).toEqual([
      { id: first.id, amount: "10.00", last4: "1111" },
      { id: second.id, amount: "20.00", last4: "2222" },
    ]);
    const { answer, printed } = await press(billId, first.id);
    expect(answer.status).toBe(200);
    expect(printed).toHaveLength(1);
    const text = decodeTicket(printed[0]!.payload);
    expect(text).toContain(duplicate);
    expect(text).toContain("Visa ****1111");
    expect(slipRow(text, labels.charged)).toContain("10,00");
    expect((await press(billId, second.id)).printed).toHaveLength(1);
  });

  it("still offers a card whose refund failed", async () => {
    const { billId, first, second } = await twoCardSale();
    await billRefund(first.billPaymentId!, "failed");
    await tenderRefund(billId, first.billPaymentId!, "failed");
    expect((await offered(billId)).map((slip) => slip.id)).toEqual([first.id, second.id]);
    expect((await press(billId, first.id)).printed).toHaveLength(1);
  });

  it.each(["partially_refunded", "refunded"] as const)(
    "still gives a copy of a card whose payment is %s",
    async (state) => {
      const { billId, first, second } = await twoCardSale();
      await liftPaymentGuard(venue.db, () =>
        venue.db.update(payments).set({ state }).where(eq(payments.id, first.id)),
      );
      expect((await offered(billId)).map((slip) => slip.id)).toEqual([first.id, second.id]);
      const { printed } = await press(billId, first.id);
      expect(printed).toHaveLength(1);
      expect(decodeTicket(printed[0]!.payload)).toContain(duplicate);
    },
  );

  it("gives no copy of a card whose capture was voided", async () => {
    const { billId, first, second } = await twoCardSale();
    await liftPaymentGuard(venue.db, () =>
      venue.db.update(payments).set({ state: "voided" }).where(eq(payments.id, first.id)),
    );
    expect((await offered(billId)).map((slip) => slip.id)).toEqual([second.id]);
    expect((await press(billId, first.id)).printed).toEqual([]);
  });

  it("gives the same copies as Print a copy once the sale is corrected", async () => {
    const { billId, first, second } = await twoCardSale();
    await credit(venue, billId, "5.00", "-6.05");
    expect(await offered(billId)).toEqual([
      { id: first.id, amount: "10.00", last4: "1111" },
      { id: second.id, amount: "20.00", last4: "2222" },
    ]);
    for (const [payment, card, charged] of [
      [first, "Visa ****1111", "10,00"],
      [second, "Mastercard ****2222", "20,00"],
    ] as const) {
      const { answer, printed } = await press(billId, payment.id);
      expect(answer.status).toBe(200);
      expect(printed).toHaveLength(1);
      const text = decodeTicket(printed[0]!.payload);
      expect(text).toContain(duplicate);
      expect(text).toContain(card);
      expect(slipRow(text, labels.charged)).toContain(charged);
      const copy = await printACopy(billId, payment.billPaymentId!);
      expect(text).toBe(decodeTicket(copy.printed[0]!.payload));
    }
  });

  describe("after a real refund of a card with a tip", () => {
    /** €10.00 and a €1.00 tip by card towards a €30.00 bill. */
    const tippedCard = async () => {
      const billId = await tabWith(venue, "Red wine bottle");
      await take(billId, "10.00", "reader", { addedTip: "1.00", tip: "1.00" });
      const [card] = await venue.db
        .select()
        .from(payments)
        .where(eq(payments.workingOrderId, billId));
      return { billId, card: card! };
    };

    const finishInCash = async (billId: string, amount: string) => {
      const paid = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${billId}/payments`,
        {
          submissionId: randomUUID(),
          kind: "contribution",
          amount,
          method: "cash",
          tendered: amount,
          applied: amount,
          tip: "0.00",
        },
      );
      expect(paid.status, JSON.stringify(paid.json)).toBe(200);
      expect(
        (await venue.db.select().from(sales).where(eq(sales.workingOrderId, billId))).length,
      ).toBe(1);
    };

    const override = () => ({ override: { personId: venue.adminId, pin: "1234" } });

    const refundBeforeSale = async (
      billId: string,
      billPaymentId: string,
      appliedAmount: string,
      tipAmount: string,
    ) => {
      const refunded = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${billId}/payments/${billPaymentId}/refunds`,
        {
          submissionId: randomUUID(),
          reason: "Guest changed their mind",
          appliedAmount,
          tipAmount,
          ...override(),
        },
      );
      expect(refunded.status, JSON.stringify(refunded.json)).toBe(200);
    };

    const refundAfterSale = async (
      billId: string,
      billPaymentId: string | null,
      appliedAmount: string,
      tipAmount: string,
    ) => {
      const [sale] = await venue.db.select().from(sales).where(eq(sales.workingOrderId, billId));
      const tender = (
        await venue.db.select().from(tenders).where(eq(tenders.saleId, sale!.id))
      ).find((row) => row.billPaymentId === billPaymentId);
      return send(venue.app, venue.cookie, "POST", `/api/transactions/${sale!.id}/refunds`, {
        submissionId: randomUUID(),
        tenderId: tender!.id,
        appliedAmount,
        tipAmount,
        reason: "Guest changed their mind",
        ...override(),
      });
    };

    const expectOriginalCopy = async (
      billId: string,
      card: { id: string; billPaymentId: string | null },
    ) => {
      expect(await offered(billId)).toEqual([{ id: card.id, amount: "11.00", last4: null }]);
      const records = fiscalRecordCount(venue);
      const { answer, printed } = await press(billId, card.id);
      expect(answer.status).toBe(200);
      expect(printed).toHaveLength(1);
      const text = decodeTicket(printed[0]!.payload);
      expect(text).toContain(duplicate);
      expect(slipRow(text, labels.paymentAmount)).toContain("10,00");
      expect(slipRow(text, labels.tip)).toContain("1,00");
      expect(slipRow(text, labels.charged)).toContain("11,00");
      expect(opensDrawer(printed[0]!.payload)).toBe(false);
      const copy = await printACopy(billId, card.billPaymentId!);
      expect(copy.answer.status).toBe(200);
      expect(text).toBe(decodeTicket(copy.printed[0]!.payload));
      expect(fiscalRecordCount(venue)).toBe(records);
    };

    it("prints the original slip when part was refunded before the sale", async () => {
      const { billId, card } = await tippedCard();
      await refundBeforeSale(billId, card.billPaymentId!, "1.00", "0.00");
      await finishInCash(billId, "21.00");
      await expectOriginalCopy(billId, card);
    });

    it("prints the original slip when all of it was refunded before the sale", async () => {
      const { billId, card } = await tippedCard();
      await refundBeforeSale(billId, card.billPaymentId!, "10.00", "1.00");
      await finishInCash(billId, "30.00");
      expect(
        await venue.db.select().from(tenders).where(eq(tenders.billPaymentId, card.billPaymentId!)),
      ).toEqual([]);
      await expectOriginalCopy(billId, card);
    });

    it.each([
      ["part", "1.00", "0.00"],
      ["all", "10.00", "1.00"],
    ])("prints the original slip when %s of it was refunded after the sale", async (_, a, t) => {
      const { billId, card } = await tippedCard();
      await finishInCash(billId, "20.00");
      const refunded = await refundAfterSale(billId, card.billPaymentId, a, t);
      expect(refunded.status, JSON.stringify(refunded.json)).toBe(200);
      await expectOriginalCopy(billId, card);
    });

    it("prints the original slip while a full refund is still being sent", async () => {
      const { billId, card } = await tippedCard();
      await finishInCash(billId, "20.00");
      const release = venue.card.holdNextRefund();
      const refunding = refundAfterSale(billId, card.billPaymentId, "10.00", "1.00");
      try {
        await vi.waitFor(async () =>
          expect(
            (await venue.db.select().from(tenderRefunds)).filter(
              (row) => row.state === "pending" && row.providerPaymentRef === card.paymentRef,
            ),
          ).toHaveLength(1),
        );
        await expectOriginalCopy(billId, card);
      } finally {
        release();
      }
      expect((await refunding).status).toBe(200);
    });

    const issueInvoice = (billId: string) =>
      issueOrderInvoice(
        { ...venue, admission: testTradingAdmission() },
        venue.cfg,
        billId,
        venue.operatorId,
      );

    const expectLinkedWithNoCopy = async (billId: string, cardId: string) => {
      const [linked] = await venue.db.select().from(payments).where(eq(payments.id, cardId));
      expect(linked!.saleId).not.toBeNull();
      expect(await offered(billId)).toEqual([]);
      const { answer, printed } = await press(billId, cardId);
      expect(answer.status).toBe(200);
      expect(printed).toEqual([]);
    };

    it("gives no copy of a card on an issued invoice until the bill is paid", async () => {
      const { billId, card } = await tippedCard();
      await issueInvoice(billId);
      await expectLinkedWithNoCopy(billId, card.id);
      await finishInCash(billId, "20.00");
      await expectOriginalCopy(billId, card);
    });

    it("gives no copy of a card refunded in full on an issued invoice until the bill is paid", async () => {
      const { billId, card } = await tippedCard();
      await refundBeforeSale(billId, card.billPaymentId!, "10.00", "1.00");
      await issueInvoice(billId);
      await expectLinkedWithNoCopy(billId, card.id);
      await finishInCash(billId, "30.00");
      await expectOriginalCopy(billId, card);
    });

    it("gives no copy of a card refunded in full on a bill closed as deferred", async () => {
      const { zoneId } = await withTransaction(venue.db, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
      );
      const kit = deferredCloseKit(venue, zoneId);
      const billId = await kit.counterOrder("open");
      await take(billId, "5.00");
      const [card] = await venue.db
        .select()
        .from(payments)
        .where(eq(payments.workingOrderId, billId));
      await refundBeforeSale(billId, card!.billPaymentId!, "5.00", "0.00");
      await issueInvoice(billId);
      await kit.close(await kit.requestFor(billId, "18.00", null));
      await expectLinkedWithNoCopy(billId, card!.id);
    });

    it("keeps the copy of a card that paid the whole bill, through part and then all of a refund", async () => {
      const id = await tabWith(venue, "Red wine bottle");
      const paid = await send(venue.app, venue.cookie, "POST", "/api/pay", {
        dining: "eat_in",
        id,
        lines: [],
      });
      expect(paid.status).toBe(200);
      const [card] = await venue.db.select().from(payments).where(eq(payments.workingOrderId, id));
      expect(card!.billPaymentId).toBeNull();
      for (const [applied, state] of [
        ["5.00", "partially_refunded"],
        ["25.00", "refunded"],
      ] as const) {
        const refunded = await refundAfterSale(id, null, applied, "0.00");
        expect(refunded.status, JSON.stringify(refunded.json)).toBe(200);
        const [now] = await venue.db.select().from(payments).where(eq(payments.id, card!.id));
        expect(now!.state).toBe(state);
        expect(await offered(id)).toEqual([{ id: card!.id, amount: "30.00", last4: null }]);
        const { printed } = await press(id, card!.id);
        expect(printed).toHaveLength(1);
        const text = decodeTicket(printed[0]!.payload);
        expect(text).toContain(duplicate);
        expect(slipRow(text, labels.charged)).toContain("30,00");
      }
    });
  });

  /** A captured card row tied to the sale, which no payment path writes for these sales. */
  const strayCapture = async (workingOrderId: string, billPaymentId: string | null = null) => {
    const id = randomUUID();
    const [sale] = await venue.db
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.workingOrderId, workingOrderId));
    await withTransaction(venue.db, (tx) =>
      tx.insert(payments).values({
        id,
        workingOrderId,
        saleId: sale!.id,
        billPaymentId,
        source: venue.cfg.origin.source,
        deviceId: venue.cfg.origin.deviceId,
        provider: "fake",
        paymentRef: randomUUID(),
        amount: 1000,
        state: "captured",
        settledAt: new Date().toISOString(),
      }),
    );
    return id;
  };

  it("offers and prints nothing for a sale paid in cash", async () => {
    const billId = await tabWith(venue, "Red wine bottle");
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "30.00",
        method: "cash",
        tendered: "30.00",
        applied: "30.00",
        tip: "0.00",
      },
    );
    expect(paid.status).toBe(200);
    expect(await offered(billId)).toEqual([]);

    const stray = await strayCapture(billId, (paid.json as { payment: { id: string } }).payment.id);
    expect(await offered(billId)).toEqual([]);
    const { answer, printed } = await press(billId, stray);
    expect(answer.status).toBe(200);
    expect(printed).toEqual([]);
  });

  it.each<[string, Record<string, string>]>([
    ["with no reference", {}],
    ["with an operation number", { externalRef: "OP-400" }],
    ["on an outside machine", { externalProvider: "other", externalMachine: "Bank counter" }],
  ])("offers nothing and prints nothing for a hand-keyed card %s", async (_, extra) => {
    const billId = await tabWith(venue, "Red wine bottle");
    await take(billId, "30.00", "manual", extra);
    const [keyed] = await venue.db
      .select()
      .from(payments)
      .where(eq(payments.workingOrderId, billId));
    expect(await offered(billId)).toEqual([]);
    const { answer, printed } = await press(billId, keyed!.id);
    expect(answer.status).toBe(200);
    expect(printed).toEqual([]);
  });

  it("offers only the reader card of a sale also paid by cash and a hand-keyed card", async () => {
    const billId = await tabWith(venue, "Red wine bottle");
    const cash = await send(
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
    expect(cash.status).toBe(200);
    await take(billId, "5.00", "manual", { externalRef: "OP-400" });
    await take(billId, "20.00");
    const rows = await venue.db.select().from(payments).where(eq(payments.workingOrderId, billId));
    const reader = rows.find((row) => row.provider !== "manual")!;
    expect(await offered(billId)).toEqual([{ id: reader.id, amount: "20.00", last4: null }]);
  });

  describe("on a sale with no card money", () => {
    const issuedUnpaid = async () => {
      const id = await tabWith(venue, "Red wine bottle");
      await issueOrderInvoice(
        { ...venue, admission: testTradingAdmission() },
        venue.cfg,
        id,
        venue.operatorId,
      );
      return id;
    };

    const closedDeferred = async () => {
      const { zoneId } = await withTransaction(venue.db, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
      );
      const kit = deferredCloseKit(venue, zoneId);
      const id = await kit.counterOrder("open");
      await kit.close(await kit.requestFor(id, "18.00", null));
      return id;
    };

    it.each([
      ["unpaid", issuedUnpaid],
      ["deferred", closedDeferred],
    ] as const)("offers and prints nothing on a %s sale", async (method, sale) => {
      const id = await sale();
      const ticket = await send(
        venue.app,
        venue.cookie,
        "GET",
        `/api/sales/${id}?receiptPreview=1`,
      );
      expect(ticket.json).toMatchObject({ tender: { method }, paymentSlips: [] });
      const unknown = await press(id, randomUUID());
      expect(unknown.answer.status).toBe(404);
      expect(unknown.answer.json).toMatchObject({ code: "bill.payment_not_found" });
      expect(unknown.printed).toEqual([]);

      const stray = await strayCapture(id);
      expect(await offered(id)).toEqual([]);
      const { answer, printed } = await press(id, stray);
      expect(answer.status).toBe(200);
      expect(printed).toEqual([]);
    });

    it("refuses a card taken towards an issued invoice that is not paid off yet", async () => {
      const id = await issuedUnpaid();
      await take(id, "10.00");
      const [card] = await venue.db.select().from(payments).where(eq(payments.workingOrderId, id));
      expect(card!.saleId).toBeNull();
      expect(await offered(id)).toEqual([]);
      const { answer, printed } = await press(id, card!.id);
      expect(answer.status).toBe(404);
      expect(answer.json).toMatchObject({ code: "bill.payment_not_found" });
      expect(printed).toEqual([]);
    });
  });

  it("offers nothing and prints nothing for a reader that prints its own slip", async () => {
    const { billId, first } = await twoCardSale();
    await withTransaction(venue.db, (tx) =>
      tx.update(cardReaders).set({ printsOwnSlipAutomatically: true }),
    );
    expect(await offered(billId)).toEqual([]);
    const { answer, printed } = await press(billId, first.id);
    expect(answer.status).toBe(200);
    expect(printed).toEqual([]);
  });

  it("offers nothing and prints nothing on a device with no slip printer", async () => {
    const { billId, first } = await twoCardSale();
    const [device] = await venue.db.select().from(devices).where(eq(devices.id, venue.deviceId));
    onTestFinished(async () => {
      await withTransaction(venue.db, (tx) =>
        tx
          .update(devices)
          .set({ paymentSlipPrinterId: device!.paymentSlipPrinterId })
          .where(eq(devices.id, venue.deviceId)),
      );
    });
    await withTransaction(venue.db, (tx) =>
      tx.update(devices).set({ paymentSlipPrinterId: null }).where(eq(devices.id, venue.deviceId)),
    );
    expect(await offered(billId)).toEqual([]);
    const { answer, printed } = await press(billId, first.id);
    expect(answer.status).toBe(200);
    expect(printed).toEqual([]);
  });
});
