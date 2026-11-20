import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, expectTypeOf, it, onTestFinished, vi } from "vitest";
import {
  billPayments,
  devices,
  deviceProfiles,
  invoiceDeliveries,
  workingOrders,
  printAgents,
  printJobs,
  printers,
  saleSettlements,
  sales,
  tenders,
  withTransaction,
} from "@waitron/db";
import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { issueOrderInvoice, printOrderForTest } from "./testing/issue-order.js";
import { readBillEditState } from "./bill-editing.js";
import type { enqueueRequestedPaymentSlip } from "./payment-slip-print.js";
import { decimal } from "@waitron/shared";
import { receiptLabelsFor } from "@waitron/country-packs";
import { cardReaders, payments } from "@waitron/payments";
import { validateCapabilities } from "@waitron/layouts";
import {
  claimPrintJobs,
  createPrinter,
  MAX_DELIVERY_ATTEMPTS,
  reportPrintJob,
  resendPrintJob,
} from "@waitron/printing";
import {
  fiscalRecordCount,
  paymentRows,
  provisionBillVenue,
  seatedWith,
  send,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { refreshWaitingOriginals } from "./receipt-print.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts } from "./testing/zone-offers.js";
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

it("a bill payment's slip shows no amount owed", async () => {
  const billId = await tabWith(venue, "Red wine bottle");
  const before = (await venue.db.select().from(printJobs)).length;
  const paid = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    {
      submissionId: randomUUID(),
      ...readerContribution,
      printCardSlip: true,
    },
  );
  expect(paid.status).toBe(200);
  const jobs = (await venue.db.select().from(printJobs)).slice(before);
  expect(jobs).toHaveLength(1);
  const text = decodeTicket(jobs[0]!.payload);
  expect(text).toContain(receiptLabelsFor("es-ES").paymentHeading);
  expect(text).toContain("10,00");
  expect(text).not.toContain("Pendiente");
  expect(text).not.toContain("20,00");
});

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
  expect(decodeTicket(jobs.at(-1)!.payload)).not.toContain("20,00");
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
  "prints the %s card slip on capture and prints nothing on retry",
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
    if (kind === "short") {
      const collect = venue.card.collect.bind(venue.card);
      vi.spyOn(venue.card, "collect").mockImplementationOnce((params) =>
        collect({ ...params, amount: decimal("10.00") }),
      );
    }
    const path = `/api/working-orders/${id}/payments`;
    const body = {
      ...readerContribution,
      submissionId: randomUUID(),
      amount: "30.00",
      applied: "30.00",
      printCardSlip: true,
    };
    const paid = await send(venue.app, venue.cookie, "POST", path, body);
    expect(paid.status).toBe(200);
    expect(paid.json).toMatchObject({ outcome: "received" });
    const jobs = await venue.db.select().from(printJobs);
    const slips = jobs
      .slice(before)
      .filter((job) =>
        decodeTicket(job.payload).includes(receiptLabelsFor("es-ES").paymentHeading),
      );
    expect(slips).toHaveLength(1);
    expect(decodeTicket(slips[0]!.payload)).toContain(kind === "short" ? "10,00" : "30,00");
    expect(decodeTicket(slips[0]!.payload)).not.toContain(receiptLabelsFor("es-ES").owed);
    if (kind === "short") expect(decodeTicket(slips[0]!.payload)).not.toContain("20,00");
    expect(opensDrawer(slips[0]!.payload)).toBe(false);
    const replay = await send(venue.app, venue.cookie, "POST", path, body);
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
  expect(decodeTicket(jobs.at(-1)!.payload)).toContain(receiptLabelsFor("es-ES").paymentHeading);
  expect(decodeTicket(jobs.at(-1)!.payload)).not.toContain(
    receiptLabelsFor("en-GB").paymentHeading,
  );
});

const readerPayments = [
  [
    "a first reader Pay",
    (id: string) =>
      send(venue.app, venue.cookie, "POST", "/api/pay", {
        dining: "eat_in",
        id,
        lines: [],
        printCardSlip: true,
      }),
  ],
  [
    "a reader bill payment",
    (id: string) =>
      send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
        submissionId: randomUUID(),
        ...readerContribution,
        printCardSlip: true,
      }),
  ],
] as const;

/** The language of each payment slip printed since `before`, told by its heading. */
async function slipLanguagesSince(before: number): Promise<string[]> {
  const jobs = await venue.db
    .select()
    .from(printJobs)
    .orderBy(sql`${printJobs}.rowid`);
  return jobs.slice(before).flatMap((job) => {
    const text = decodeTicket(job.payload);
    return ["es-ES", "en-GB"].filter((locale) =>
      text.includes(receiptLabelsFor(locale).paymentHeading),
    );
  });
}

function restoreVenueLanguageAfterTest() {
  onTestFinished(() =>
    withTransaction(venue.db, (tx) => seedVenueSettings(tx, { invoiceLocales: ["es-ES"] })),
  );
}

describe.each(readerPayments)("%s with no sale yet", (_name, pay) => {
  it("prints the slip in the order's language when it has one", async () => {
    restoreVenueLanguageAfterTest();
    await withTransaction(venue.db, (tx) =>
      seedVenueSettings(tx, { invoiceLocales: ["es-ES", "en-GB"] }),
    );
    const id = await tabWith(venue, "Red wine bottle");
    await withTransaction(venue.db, (tx) =>
      tx.update(workingOrders).set({ receiptLocale: "en-GB" }).where(eq(workingOrders.id, id)),
    );
    const before = (await venue.db.select().from(printJobs)).length;

    const paid = await pay(id);

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(await slipLanguagesSince(before)).toEqual(["en-GB"]);
  });

  it("prints the slip in the venue's current language when the order has none", async () => {
    restoreVenueLanguageAfterTest();
    await withTransaction(venue.db, (tx) => seedVenueSettings(tx, { invoiceLocales: ["en-GB"] }));
    const id = await tabWith(venue, "Red wine bottle");
    const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(order!.receiptLocale).toBeNull();
    const before = (await venue.db.select().from(printJobs)).length;

    const paid = await pay(id);

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(await slipLanguagesSince(before)).toEqual(["en-GB"]);
  });
});

async function readerPaymentOn(
  billId: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const paid = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    { submissionId: randomUUID(), ...readerContribution, ...extra },
  );
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  return (paid.json as { payment: { id: string } }).payment.id;
}

it.each(["cash", "manual"])("accepts a slip field on %s payments", async (method) => {
  const id = await tabWith(venue, "Red wine bottle");
  const pay = (printCardSlip: unknown) =>
    send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "10.00",
      method: method === "cash" ? "cash" : "card",
      ...(method === "cash" ? { tendered: "10.00" } : { entry: "manual" }),
      applied: "10.00",
      tip: "0.00",
      printCardSlip,
    });
  const heading = receiptLabelsFor("es-ES").paymentHeading;
  const slips = async () =>
    (await venue.db.select().from(printJobs)).filter((job) =>
      decodeTicket(job.payload).includes(heading),
    ).length;
  const before = await slips();
  expect((await pay(false)).status).toBe(200);
  expect(await slips()).toBe(before);
  const malformed = await pay("yes");
  expect(malformed.status).toBe(400);
  expect(malformed.json).toMatchObject({
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

it.each([true, false])(
  "a whole-bill Pay on a reader whose own-slip setting is %s prints a Waitron slip only when it is off",
  async (automatic) => {
    const [reader] = await venue.db
      .select()
      .from(cardReaders)
      .where(eq(cardReaders.heldByDeviceId, venue.deviceId));
    await withTransaction(venue.db, (tx) =>
      tx
        .update(cardReaders)
        .set({ printsOwnSlipAutomatically: automatic })
        .where(eq(cardReaders.id, reader!.id)),
    );
    const id = await tabWith(venue, "Red wine bottle");
    const before = (await venue.db.select().from(printJobs)).length;

    const paid = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      ...readerContribution,
      amount: "30.00",
      applied: "30.00",
      readerId: reader!.id,
      printCardSlip: true,
    });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json).toMatchObject({ outcome: "received" });
    expect(paid.json).not.toHaveProperty("slipPrintFailed");
    expect(venue.card.collectCalls.at(-1)).toHaveProperty("readerId", reader!.id);
    const slips = (await venue.db.select().from(printJobs))
      .slice(before)
      .filter((job) =>
        decodeTicket(job.payload).includes(receiptLabelsFor("es-ES").paymentHeading),
      );
    expect(slips).toHaveLength(automatic ? 0 : 1);
    expect(fiscalRecordCount(venue, id)).toBe(1);
  },
);

it("rolls back the card payment when preparing its optional slip fails", async () => {
  const id = await tabWith(venue, "Red wine bottle");
  const calls = venue.card.collectCalls.length;
  venue.db.run(sql`create temp table printers (broken text)`);
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
    expect(answer.status).toBe(500);
    expect(venue.card.collectCalls).toHaveLength(calls);
    expect(await paymentRows(venue, id)).toEqual([]);
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

describe("a payment after the ticket was issued", () => {
  const labels = receiptLabelsFor("es-ES");

  it("makes every caller say the operation number and machine, null when none was typed", () => {
    type Payment = Parameters<typeof enqueueRequestedPaymentSlip>[4];
    expectTypeOf<Payment["reference"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Payment["machine"]>().toEqualTypeOf<string | null>();
  });

  /** A bill whose ticket was issued and its original printed through Print the bill. */
  async function billPrintedByPrintTheBill(): Promise<{
    id: string;
    saleId: string;
    invoiceNumber: string;
  }> {
    const party = await seatedWith(venue, "Red wine bottle");
    const edit = await withTransaction(venue.db, (tx) => readBillEditState(tx, party.tabId));
    const printed = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/end-meal`,
      {
        billId: party.tabId,
        expectedPartyRevision: party.revision,
        expectedEdits: [
          {
            billId: party.tabId,
            editorVersion: edit.editorVersion,
            draftId: edit.draftId,
            draftRevision: edit.draftRevision,
          },
        ],
        submissionId: randomUUID(),
        printAnyway: true,
      },
    );
    expect(printed.status, JSON.stringify(printed.json)).toBe(200);
    const [original] = await venue.db
      .select()
      .from(printJobs)
      .where(
        and(eq(printJobs.saleId, printed.json.saleId as string), eq(printJobs.receiptCopy, false)),
      );
    expect(original).toBeDefined();
    return {
      id: party.tabId,
      saleId: printed.json.saleId as string,
      invoiceNumber: printed.json.invoiceNumber as string,
    };
  }

  /** A bill whose ticket was issued, as an unpaid departure issues it, with no receipt printed. */
  async function billIssuedNeverPrinted(): Promise<{ id: string; saleId: string }> {
    const id = await tabWith(venue, "Red wine bottle");
    await printOrderForTest(
      { ...venue, admission: testTradingAdmission() },
      venue.cfg,
      id,
      venue.operatorId,
    );
    const [sale] = await venue.db.select().from(sales).where(eq(sales.workingOrderId, id));
    return { id, saleId: sale!.id };
  }

  const issuedBill = async () => {
    const id = await tabWith(venue, "Red wine bottle");
    await issueOrderInvoice(
      { ...venue, admission: testTradingAdmission() },
      venue.cfg,
      id,
      venue.operatorId,
    );
    const [sale] = await venue.db.select().from(sales).where(eq(sales.workingOrderId, id));
    expect(sale!.locale).toBe("es-ES");
    const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(order!.receiptLocale).toBeNull();
    return id;
  };

  async function slipsSince(before: number) {
    return (
      await venue.db
        .select()
        .from(printJobs)
        .orderBy(sql`${printJobs}.rowid`)
    )
      .slice(before)
      .filter((job) => decodeTicket(job.payload).includes(labels.paymentHeading));
  }

  const jobCount = async () => (await venue.db.select().from(printJobs)).length;

  function billPayment(id: string, body: Record<string, unknown>) {
    return send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      tip: "0.00",
      ...body,
    });
  }

  const cash = (amount: string) => ({ amount, method: "cash", tendered: amount, applied: amount });
  const typedCard = (amount: string) => ({
    amount,
    method: "card",
    entry: "manual",
    applied: amount,
  });

  function expectPaymentSlip(
    job: { payload: Uint8Array | null },
    amount: string,
    invoiceNumber: string,
  ) {
    const text = decodeTicket(job.payload);
    expect(text).toContain(amount);
    expect(text).not.toContain(invoiceNumber);
    expect(text).not.toContain(labels.owed);
    expect(opensDrawer(job.payload)).toBe(false);
  }

  /** The slip's line naming how it was paid: the line that is the method's label and nothing else. */
  const methodLine = (job: { payload: Uint8Array | null }, label: string) =>
    decodeTicket(job.payload)
      .split("\n")
      .some((line) => line.trim() === label);

  /** A walk-up counter sale of one Red wine bottle (30.00). */
  async function counterSale(body: Record<string, unknown>) {
    const { zoneId } = await withTransaction(venue.db, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
    );
    return send(venue.app, venue.cookie, "POST", "/api/sales", {
      dining: "eat_in",
      workingOrderId: randomUUID(),
      zoneId,
      lines: [{ menuItemId: venue.offerFor("Red wine bottle"), quantity: "1" }],
      tender: { method: "cash", amount: "30.00" },
      ...body,
    });
  }

  /** Refuses every slip insert: a slip is the one document job queued with no sale. */
  function refuseSlips(): void {
    venue.db.run(
      sql`create temp trigger refuse_slip before insert on print_jobs when new.kind = 'document' and new.sale_id is null begin select raise(abort, 'printer refused'); end`,
    );
    onTestFinished(() => {
      venue.db.run(sql`drop trigger if exists refuse_slip`);
    });
  }

  /** The cash drawer opened, and the sale's receipt prints: the slip's refusal undid nothing else. */
  async function expectDrawerAndReceipt(before: number, orderId: string) {
    const since = (
      await venue.db
        .select()
        .from(printJobs)
        .orderBy(sql`${printJobs}.rowid`)
    ).slice(before);
    expect(since.map((job) => job.kind)).toEqual(["drawer"]);
    const printed = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/sales/${orderId}/receipt`,
      {},
    );
    expect(printed.status, JSON.stringify(printed.json)).toBe(200);
    const [sale] = await venue.db.select().from(sales).where(eq(sales.workingOrderId, orderId));
    const receipts = await venue.db
      .select()
      .from(printJobs)
      .where(and(eq(printJobs.saleId, sale!.id), eq(printJobs.kind, "document")));
    expect(receipts).toHaveLength(1);
  }

  it.each([
    ["cash", "Efectivo"],
    ["hand-keyed card", "Tarjeta"],
  ] as const)(
    "a %s bill payment prints a slip only when asked, before and after the ticket",
    async (method, line) => {
      const pay = (amount: string) => (method === "cash" ? cash(amount) : typedCard(amount));
      const open = await tabWith(venue, "Red wine bottle");
      const before = await jobCount();

      const asked = await billPayment(open, { ...pay("5.00"), printCardSlip: true });

      expect(asked.status, JSON.stringify(asked.json)).toBe(200);
      expect(asked.json).not.toHaveProperty("slipPrintFailed");
      const beforeTicket = await slipsSince(before);
      expect(beforeTicket).toHaveLength(1);
      expectPaymentSlip(beforeTicket[0]!, "5,00", "A/");
      expect(methodLine(beforeTicket[0]!, line)).toBe(true);
      expect((await billPayment(open, pay("5.00"))).status).toBe(200);
      expect(await slipsSince(before)).toHaveLength(1);

      const bill = await billPrintedByPrintTheBill();
      const afterPrint = await jobCount();

      const later = await billPayment(bill.id, { ...pay("5.00"), printCardSlip: true });

      expect(later.status, JSON.stringify(later.json)).toBe(200);
      const afterTicket = await slipsSince(afterPrint);
      expect(afterTicket).toHaveLength(1);
      expectPaymentSlip(afterTicket[0]!, "5,00", bill.invoiceNumber);
      expect(methodLine(afterTicket[0]!, line)).toBe(true);
      expect((await billPayment(bill.id, pay("5.00"))).status).toBe(200);
      expect(await slipsSince(afterPrint)).toHaveLength(1);
    },
  );

  it("a counter cash sale prints a slip only when asked", async () => {
    const before = await jobCount();

    const asked = await counterSale({ printCardSlip: true });

    expect(asked.status, JSON.stringify(asked.json)).toBe(200);
    expect(asked.json).not.toHaveProperty("slipPrintFailed");
    const slips = await slipsSince(before);
    expect(slips).toHaveLength(1);
    expectPaymentSlip(slips[0]!, "30,00", asked.json.invoiceNumber as string);
    expect(methodLine(slips[0]!, labels.cash)).toBe(true);
    expect((await counterSale({})).status).toBe(200);
    expect(await slipsSince(before)).toHaveLength(1);
    const malformed = await counterSale({ printCardSlip: "yes" });
    expect(malformed.status).toBe(400);
    expect(malformed.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "printCardSlip" },
    });
  });

  it("a hand-keyed card counter sale prints one slip naming the card when asked", async () => {
    const before = await jobCount();

    const asked = await counterSale({
      tender: { method: "card", amount: "30.00" },
      printCardSlip: true,
    });

    expect(asked.status, JSON.stringify(asked.json)).toBe(200);
    expect(asked.json).not.toHaveProperty("slipPrintFailed");
    const slips = await slipsSince(before);
    expect(slips).toHaveLength(1);
    expectPaymentSlip(slips[0]!, "30,00", asked.json.invoiceNumber as string);
    expect(methodLine(slips[0]!, labels.card)).toBe(true);
    expect(methodLine(slips[0]!, labels.cash)).toBe(false);
  });

  it("another card machine's counter sale slip names the machine and the operation number typed", async () => {
    const before = await jobCount();

    const asked = await counterSale({
      tender: {
        method: "card",
        amount: "30.00",
        externalProvider: "other",
        externalRef: "OP-77",
        externalMachine: "SumUp Solo",
      },
      printCardSlip: true,
    });

    expect(asked.status, JSON.stringify(asked.json)).toBe(200);
    const slips = await slipsSince(before);
    expect(slips).toHaveLength(1);
    expect(methodLine(slips[0]!, `${labels.card} · SumUp Solo`)).toBe(true);
    expect(methodLine(slips[0]!, `${labels.reference} OP-77`)).toBe(true);
  });

  it("a payment after Print the bill prints no slip unless asked", async () => {
    const bill = await billPrintedByPrintTheBill();
    const before = await jobCount();

    expect((await billPayment(bill.id, cash("5.00"))).status).toBe(200);
    expect((await billPayment(bill.id, typedCard("5.00"))).status).toBe(200);

    expect(await slipsSince(before)).toHaveLength(0);
  });

  it("a payment that settles the bill keeps its sale when its asked-for slip cannot be queued", async () => {
    const id = await tabWith(venue, "Red wine bottle");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    refuseSlips();
    const before = await jobCount();

    const paid = await billPayment(id, { ...cash("30.00"), printCardSlip: true });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json).toMatchObject({ outcome: "received", slipPrintFailed: true });
    expect(fiscalRecordCount(venue, id)).toBe(1);
    const [sale] = await venue.db.select().from(sales).where(eq(sales.workingOrderId, id));
    expect(sale).toBeDefined();
    await expectDrawerAndReceipt(before, id);
    expect(await slipsSince(before)).toHaveLength(0);
  });

  it("a counter cash sale keeps its sale when its asked-for slip cannot be queued", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    refuseSlips();
    const before = await jobCount();
    const workingOrderId = randomUUID();

    const sold = await counterSale({ workingOrderId, printCardSlip: true });

    expect(sold.status, JSON.stringify(sold.json)).toBe(200);
    expect(sold.json).toMatchObject({ slipPrintFailed: true });
    expect(fiscalRecordCount(venue, workingOrderId)).toBe(1);
    const [sale] = await venue.db
      .select()
      .from(sales)
      .where(eq(sales.workingOrderId, workingOrderId));
    expect(sale).toBeDefined();
    await expectDrawerAndReceipt(before, workingOrderId);
    expect(await slipsSince(before)).toHaveLength(0);
  });

  it("a replayed payment or counter sale prints no second slip", async () => {
    const id = await tabWith(venue, "Red wine bottle");
    const before = await jobCount();
    const body = { submissionId: randomUUID(), ...cash("5.00"), printCardSlip: true };

    const first = await billPayment(id, body);
    const again = await billPayment(id, body);

    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(await slipsSince(before)).toHaveLength(1);

    const workingOrderId = randomUUID();
    const sold = await counterSale({ workingOrderId, printCardSlip: true });
    const resold = await counterSale({ workingOrderId, printCardSlip: true });

    expect(sold.status, JSON.stringify(sold.json)).toBe(200);
    expect(resold.status, JSON.stringify(resold.json)).toBe(200);
    expect(resold.json.invoiceNumber).toBe(sold.json.invoiceNumber);
    expect(await slipsSince(before)).toHaveLength(2);
  });

  it("a cash payment of an issued ticket prints a payment slip when asked", async () => {
    const bill = await billPrintedByPrintTheBill();
    const before = await jobCount();

    const part = await billPayment(bill.id, { ...cash("5.00"), printCardSlip: true });

    expect(part.status, JSON.stringify(part.json)).toBe(200);
    const afterPart = await slipsSince(before);
    expect(afterPart).toHaveLength(1);
    expectPaymentSlip(afterPart[0]!, "5,00", bill.invoiceNumber);

    const last = await billPayment(bill.id, { ...cash("25.00"), printCardSlip: true });

    expect(last.status, JSON.stringify(last.json)).toBe(200);
    const slips = await slipsSince(before);
    expect(slips).toHaveLength(2);
    expectPaymentSlip(slips[1]!, "25,00", bill.invoiceNumber);
    expect(decodeTicket(slips[1]!.payload)).not.toMatch(/\s5,00/u);
  });

  /**
   * Claims jobs on the original's printer, as a network print agent does, until it takes the
   * original. The venue's printer polls the cloud, which an agent's claim does not serve, so it is
   * a network printer for the claim.
   */
  async function claimOriginal(saleId: string) {
    const [original] = await venue.db
      .select()
      .from(printJobs)
      .where(and(eq(printJobs.saleId, saleId), eq(printJobs.receiptCopy, false)));
    const [printer] = await venue.db
      .select()
      .from(printers)
      .where(eq(printers.id, original!.printerId));
    const [agent] = await withTransaction(venue.db, async (tx) => {
      await tx
        .update(printers)
        .set({ transport: "network_tcp", host: `${randomUUID()}.printer.test`, pollId: null })
        .where(eq(printers.id, printer!.id));
      return tx
        .insert(printAgents)
        .values({ name: `Agent ${randomUUID()}`, tokenHash: "scrypt$fixture" })
        .returning({ id: printAgents.id });
    });
    try {
      for (;;) {
        const [claimed] = await withTransaction(venue.db, (tx) =>
          claimPrintJobs(tx, agent!.id, { visibleKeys: [], printerId: printer!.id }),
        );
        expect(claimed).toBeDefined();
        if (claimed!.id === original!.id) return { ...claimed!, agentId: agent!.id };
      }
    } finally {
      await withTransaction(venue.db, (tx) =>
        tx
          .update(printers)
          .set({ transport: printer!.transport, host: printer!.host, pollId: printer!.pollId })
          .where(eq(printers.id, printer!.id)),
      );
    }
  }

  const originalOf = async (saleId: string) =>
    (
      await venue.db
        .select()
        .from(printJobs)
        .where(and(eq(printJobs.saleId, saleId), eq(printJobs.receiptCopy, false)))
    )[0]!;

  const owedLine = (amount: string) => new RegExp(`${labels.owed}\\s+${amount}`, "u");

  it("an original laid out again with nothing changed keeps the bytes it was queued with", async () => {
    const bill = await billPrintedByPrintTheBill();
    const queued = await originalOf(bill.saleId);

    await withTransaction(venue.db, (tx) =>
      refreshWaitingOriginals(venue.backend, tx, venue.cfg, bill.id),
    );

    const after = await originalOf(bill.saleId);
    expect(Buffer.from(after.payload!).equals(Buffer.from(queued.payload!))).toBe(true);
  });

  it("an original still waiting to print lists a payment taken before its printer takes it", async () => {
    const bill = await billPrintedByPrintTheBill();
    const queued = await originalOf(bill.saleId);
    expect(decodeTicket(queued.payload)).toMatch(owedLine("30,00"));

    expect((await billPayment(bill.id, cash("5.00"))).status).toBe(200);
    const claimed = await claimOriginal(bill.saleId);

    expect(claimed.id).toBe(queued.id);
    const text = decodeTicket(claimed.payload);
    expect(text).toMatch(/Efectivo\s+5,00/u);
    expect(text).toMatch(owedLine("25,00"));
    expect(text).not.toMatch(owedLine("30,00"));
    expect(text).not.toContain(labels.duplicate);
  });

  /** Claims every job the sale's original printer has waiting, as its print agent would. */
  async function claimEverythingOn(printerId: string) {
    const [printer] = await venue.db.select().from(printers).where(eq(printers.id, printerId));
    const [agent] = await withTransaction(venue.db, async (tx) => {
      await tx
        .update(printers)
        .set({ transport: "network_tcp", host: `${randomUUID()}.printer.test`, pollId: null })
        .where(eq(printers.id, printerId));
      return tx
        .insert(printAgents)
        .values({ name: `Agent ${randomUUID()}`, tokenHash: "scrypt$fixture" })
        .returning({ id: printAgents.id });
    });
    const claimed: Uint8Array[] = [];
    try {
      for (;;) {
        const [job] = await withTransaction(venue.db, (tx) =>
          claimPrintJobs(tx, agent!.id, { visibleKeys: [], printerId }),
        );
        if (job === undefined) return claimed;
        claimed.push(job.payload);
        await withTransaction(venue.db, (tx) =>
          reportPrintJob(tx, { agentId: agent!.id, jobId: job.id, outcome: { status: "done" } }),
        );
      }
    } finally {
      await withTransaction(venue.db, (tx) =>
        tx
          .update(printers)
          .set({ transport: printer!.transport, host: printer!.host, pollId: printer!.pollId })
          .where(eq(printers.id, printerId)),
      );
    }
  }

  async function expectNextOriginalListsTheCash(bill: { id: string; saleId: string }) {
    const asked = await send(venue.app, venue.cookie, "POST", `/api/sales/${bill.id}/receipt`, {});
    expect(asked.status, JSON.stringify(asked.json)).toBe(200);
    const text = decodeTicket((await claimOriginal(bill.saleId)).payload);
    expect(text).toMatch(/Efectivo\s+5,00/u);
    expect(text).toMatch(owedLine("25,00"));
    expect(text).not.toContain(labels.duplicate);
  }

  it("an original that cannot be laid out again never prints without a payment taken before it", async () => {
    const bill = await billPrintedByPrintTheBill();
    const stale = await originalOf(bill.saleId);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    const filed = vi.spyOn(venue.backend, "filedReceiptFor").mockImplementation(() => {
      throw new Error("layout failed");
    });
    let paid: Awaited<ReturnType<typeof billPayment>>;
    try {
      paid = await billPayment(bill.id, cash("5.00"));
    } finally {
      filed.mockRestore();
    }

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(warn).toHaveBeenCalledWith(
      "receipt.optional_document_failed",
      expect.objectContaining({ operation: "refreshWaitingOriginal", saleId: bill.saleId }),
    );
    const received = await venue.db
      .select()
      .from(billPayments)
      .where(eq(billPayments.workingOrderId, bill.id));
    expect(received.map((row) => row.state)).toEqual(["received"]);
    const handedOut = await claimEverythingOn(stale.printerId);
    expect(handedOut.some((payload) => Buffer.from(payload).equals(stale.payload!))).toBe(false);
    await expectNextOriginalListsTheCash(bill);
  });

  it("an invoice print that cannot be laid out again goes with its waiting delivery", async () => {
    const bill = await billPrintedByPrintTheBill();
    const stale = await originalOf(bill.saleId);
    await withTransaction(venue.db, (tx) =>
      tx.insert(invoiceDeliveries).values({
        saleId: bill.saleId,
        printJobId: stale.id,
        requestKey: randomUUID(),
        medium: "receipt",
        designation: "original",
        status: "queued",
        generation: 1,
        personId: venue.operatorId,
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    const filed = vi.spyOn(venue.backend, "filedReceiptFor").mockImplementation(() => {
      throw new Error("layout failed");
    });
    let paid: Awaited<ReturnType<typeof billPayment>>;
    try {
      paid = await billPayment(bill.id, cash("5.00"));
    } finally {
      filed.mockRestore();
    }

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(
      await venue.db
        .select()
        .from(invoiceDeliveries)
        .where(eq(invoiceDeliveries.saleId, bill.saleId)),
    ).toEqual([]);
    const handedOut = await claimEverythingOn(stale.printerId);
    expect(handedOut.some((payload) => Buffer.from(payload).equals(stale.payload!))).toBe(false);
  });

  it("an original whose new layout the database refuses for space never prints without the payment", async () => {
    const bill = await billPrintedByPrintTheBill();
    const stale = await originalOf(bill.saleId);
    venue.db.run(sql`create table refresh_pad (bytes blob)`);
    venue.db.run(sql`create temp trigger refresh_fill before update of payload on print_jobs
      begin insert into refresh_pad values (zeroblob(8388608)); end`);
    const [{ page_count: pages }] = venue.db.all<{ page_count: number }>(sql`pragma page_count`);
    venue.db.run(sql.raw(`pragma max_page_count = ${pages + 32}`));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    let paid: Awaited<ReturnType<typeof billPayment>>;
    try {
      paid = await billPayment(bill.id, cash("5.00"));
    } finally {
      venue.db.run(sql`pragma max_page_count = 4294967294`);
      venue.db.run(sql`drop trigger refresh_fill`);
      venue.db.run(sql`drop table refresh_pad`);
    }

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(warn).toHaveBeenCalledWith(
      "receipt.optional_document_failed",
      expect.objectContaining({ operation: "refreshWaitingOriginal", code: "storage.disk_full" }),
    );
    const received = await venue.db
      .select()
      .from(billPayments)
      .where(eq(billPayments.workingOrderId, bill.id));
    expect(received.map((row) => row.state)).toEqual(["received"]);
    const handedOut = await claimEverythingOn(stale.printerId);
    expect(handedOut.some((payload) => Buffer.from(payload).equals(stale.payload!))).toBe(false);
    await expectNextOriginalListsTheCash(bill);
  });

  it.each(["taken by its printer", "tried and failed", "resent from the print queue"] as const)(
    "an original already %s keeps its bytes when a payment follows",
    async (state) => {
      const bill = await billPrintedByPrintTheBill();
      const claimed = await claimOriginal(bill.saleId);
      if (state === "resent from the print queue") {
        const resent = await withTransaction(venue.db, async (tx) => {
          await tx
            .update(printJobs)
            .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS })
            .where(eq(printJobs.id, claimed.id));
          return resendPrintJob(tx, claimed.id);
        });
        onTestFinished(async () => {
          await withTransaction(venue.db, (tx) =>
            tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, resent.jobId)),
          );
        });

        expect((await billPayment(bill.id, cash("5.00"))).status).toBe(200);

        const [copy] = await venue.db
          .select()
          .from(printJobs)
          .where(eq(printJobs.id, resent.jobId));
        expect(copy!.status).toBe("queued");
        expect(Buffer.from(copy!.payload!).equals(Buffer.from(claimed.payload))).toBe(true);
        return;
      }
      if (state === "tried and failed") {
        const reported = await withTransaction(venue.db, (tx) =>
          reportPrintJob(tx, {
            agentId: claimed.agentId,
            jobId: claimed.id,
            outcome: { status: "failed", error: "printer.offline" },
          }),
        );
        expect(reported.updated).toBe(true);
      }
      onTestFinished(async () => {
        await withTransaction(venue.db, (tx) =>
          tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, claimed.id)),
        );
      });

      expect((await billPayment(bill.id, cash("5.00"))).status).toBe(200);

      const original = await originalOf(bill.saleId);
      expect(original.status).toBe(state === "tried and failed" ? "failed" : "printing");
      expect(Buffer.from(original.payload!).equals(Buffer.from(claimed.payload))).toBe(true);
      expect(decodeTicket(original.payload)).toMatch(owedLine("30,00"));
    },
  );

  it.each([
    ["a reader part payment", /Tarjeta\s+10,00/u, "20,00"],
    ["a reader payment the recovery loop records", /Tarjeta\s+10,00/u, "20,00"],
    ["a cash collection", /Efectivo\s+30,00/u, null],
    ["a reader Pay of the whole bill", /^Tarjeta$/mu, null],
  ] as const)("an original still waiting to print lists %s", async (path, listed, owed) => {
    const bill = await billPrintedByPrintTheBill();

    if (path === "a reader part payment") {
      await readerPaymentOn(bill.id);
    } else if (path === "a reader payment the recovery loop records") {
      venue.card.crashNextCollect("captured");
      const paid = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${bill.id}/payments`,
        { submissionId: randomUUID(), ...readerContribution },
      );
      expect(paid.status).toBe(500);
      await settlePendingBillPayments({
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: venue.cfg,
      });
    } else {
      const paid =
        path === "a cash collection"
          ? await send(venue.app, venue.cookie, "POST", `/api/working-orders/${bill.id}/collect`, {
              tender: { method: "cash", amount: "30.00" },
            })
          : await send(venue.app, venue.cookie, "POST", "/api/pay", {
              dining: "eat_in",
              id: bill.id,
              lines: [],
            });
      expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    }
    const claimed = await claimOriginal(bill.saleId);

    const text = decodeTicket(claimed.payload);
    expect(text).toMatch(listed);
    if (owed === null) expect(text).not.toContain(labels.owed);
    else expect(text).toMatch(owedLine(owed));
  });

  it("a copy of the receipt lists a cash payment taken after the original, and what is owed", async () => {
    const bill = await billPrintedByPrintTheBill();
    await claimOriginal(bill.saleId);
    expect((await billPayment(bill.id, cash("5.00"))).status).toBe(200);

    const copied = await send(venue.app, venue.cookie, "POST", `/api/sales/${bill.id}/reprint`, {});

    expect(copied.status, JSON.stringify(copied.json)).toBe(200);
    const jobs = await venue.db.select().from(printJobs).where(eq(printJobs.saleId, bill.saleId));
    const original = decodeTicket(jobs.find((job) => !job.receiptCopy)!.payload);
    expect(original).not.toMatch(/Efectivo\s+5,00/u);
    const copies = jobs.filter((job) => job.receiptCopy);
    expect(copies).toHaveLength(1);
    const copy = decodeTicket(copies[0]!.payload);
    expect(copy).toContain(labels.duplicate);
    expect(copy).toMatch(/Efectivo\s+5,00/u);
    expect(copy).toMatch(new RegExp(`${labels.owed}\\s+25,00`, "u"));
  });

  it("a card typed into another machine on an issued ticket prints a payment slip when asked", async () => {
    const bill = await billPrintedByPrintTheBill();
    const before = await jobCount();

    const paid = await billPayment(bill.id, { ...typedCard("30.00"), printCardSlip: true });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const slips = await slipsSince(before);
    expect(slips).toHaveLength(1);
    expectPaymentSlip(slips[0]!, "30,00", bill.invoiceNumber);
  });

  it("another card machine's bill payment slip names the machine and the operation number typed", async () => {
    const bill = await billPrintedByPrintTheBill();
    const before = await jobCount();

    const paid = await billPayment(bill.id, {
      ...typedCard("30.00"),
      externalProvider: "other",
      externalRef: "OP-77",
      externalMachine: "SumUp Solo",
      printCardSlip: true,
    });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const slips = await slipsSince(before);
    expect(slips).toHaveLength(1);
    expect(methodLine(slips[0]!, `${labels.card} · SumUp Solo`)).toBe(true);
    expect(methodLine(slips[0]!, `${labels.reference} OP-77`)).toBe(true);
  });

  // The bodies the till sends: Find a bill's Pay pays the printed bill whole as one share; a
  // table's Pay window takes a contribution on the open bill.
  it.each(["Find a bill's Pay", "a table part payment"] as const)(
    "another card machine's slip asked for through %s queues one slip",
    async (path) => {
      const outside = {
        method: "card",
        entry: "manual",
        externalProvider: "other",
        externalMachine: "SumUp Solo",
        printCardSlip: true,
      };
      const id =
        path === "Find a bill's Pay"
          ? (await billPrintedByPrintTheBill()).id
          : await tabWith(venue, "Red wine bottle");
      const before = await jobCount();

      const paid =
        path === "Find a bill's Pay"
          ? await billPayment(id, {
              ...outside,
              kind: "share",
              shareOf: 1,
              applied: "30.00",
              expectedEdit: await withTransaction(venue.db, (tx) => readBillEditState(tx, id)),
            })
          : await billPayment(id, { ...outside, amount: "10.00", applied: "10.00" });

      expect(paid.status, JSON.stringify(paid.json)).toBe(200);
      expect(paid.json).not.toHaveProperty("slipPrintFailed");
      const slips = await slipsSince(before);
      expect(slips).toHaveLength(1);
      expect(methodLine(slips[0]!, `${labels.card} · SumUp Solo`)).toBe(true);
    },
  );

  it.each(["cash", "card"] as const)(
    "collecting an issued ticket by %s prints no payment slip",
    async (method) => {
      const bill = await billPrintedByPrintTheBill();
      const before = await jobCount();

      const collected = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${bill.id}/collect`,
        { tender: method === "cash" ? { method, amount: "30.00" } : { method } },
      );

      expect(collected.status, JSON.stringify(collected.json)).toBe(200);
      expect(await slipsSince(before)).toHaveLength(0);
    },
  );

  /** Pays an issued ticket by reader, crashing after the capture so the next Pay files it. */
  async function readerCaptureLeftUnfiled(
    bill: { id: string },
    kind: "whole" | "short",
  ): Promise<() => ReturnType<typeof send>> {
    if (kind === "short") {
      const collect = venue.card.collect.bind(venue.card);
      vi.spyOn(venue.card, "collect").mockImplementationOnce((params) =>
        collect({ ...params, amount: decimal("10.00") }),
      );
    }
    venue.card.crashNextCollect("captured");
    const pay = () =>
      send(venue.app, venue.cookie, "POST", "/api/pay", {
        dining: "eat_in",
        id: bill.id,
        lines: [],
        printCardSlip: true,
      });
    expect((await pay()).status).toBe(500);
    return pay;
  }

  async function capturedPayment(id: string) {
    const [payment] = await venue.db
      .select()
      .from(payments)
      .where(and(eq(payments.workingOrderId, id), eq(payments.state, "captured")));
    return payment!;
  }

  it.each(["whole", "short"] as const)(
    "a %s reader payment of an issued ticket, filed when the till pays again, prints no slip",
    async (kind) => {
      const bill = await billPrintedByPrintTheBill();
      const before = await jobCount();
      const pay = await readerCaptureLeftUnfiled(bill, kind);
      const charges = venue.card.collectCalls.length;

      const recovered = await pay();

      expect(recovered.status, JSON.stringify(recovered.json)).toBe(200);
      expect(recovered.json).toMatchObject({ outcome: kind === "short" ? "partial" : "captured" });
      expect(recovered.json).not.toHaveProperty("slipPrintFailed");
      expect(await slipsSince(before)).toHaveLength(0);
      expect((await pay()).status).toBe(200);
      expect(await slipsSince(before)).toHaveLength(0);
      expect(venue.card.collectCalls).toHaveLength(charges);

      const payment = await capturedPayment(bill.id);
      if (kind === "whole") {
        expect(payment.saleId).toBe(bill.saleId);
        const [order] = await venue.db
          .select({ status: workingOrders.status })
          .from(workingOrders)
          .where(eq(workingOrders.id, bill.id));
        expect(order!.status).toBe("settled");
        expect(
          await venue.db
            .select({ method: tenders.method, amount: tenders.amount, tip: tenders.tipAmount })
            .from(tenders)
            .where(eq(tenders.saleId, bill.saleId)),
        ).toEqual([{ method: "card", amount: 3000, tip: 0 }]);
        expect(
          await venue.db
            .select({ saleId: saleSettlements.saleId })
            .from(saleSettlements)
            .where(eq(saleSettlements.saleId, bill.saleId)),
        ).toHaveLength(1);
        const { ticket } = recovered.json as { ticket: Record<string, unknown> };
        expect(ticket).toMatchObject({ tender: { method: "card" } });
        expect(ticket).not.toHaveProperty("payments");
      } else {
        expect(payment.saleId).toBeNull();
        const bills = await send(
          venue.app,
          venue.cookie,
          "GET",
          `/api/working-orders/${bill.id}/payments`,
        );
        const { received, payments: listed } = bills.json as {
          received: string;
          payments: { id: string }[];
        };
        expect(received).toBe("10.00");
        expect(listed).toEqual([expect.objectContaining({ id: payment.billPaymentId })]);
      }
    },
  );

  it("prints its requested slip in the sale's language after the venue's changes", async () => {
    const id = await issuedBill();
    restoreVenueLanguageAfterTest();
    await withTransaction(venue.db, (tx) => seedVenueSettings(tx, { invoiceLocales: ["en-GB"] }));
    const before = (await venue.db.select().from(printJobs)).length;

    await readerPaymentOn(id, { printCardSlip: true });

    expect(await slipLanguagesSince(before)).toEqual(["es-ES"]);
  });

  it.each(readerPayments)(
    "%s on an issued ticket prints its slip in the sale's language after the venue's changes",
    async (_name, pay) => {
      const bill = await billPrintedByPrintTheBill();
      const [sale] = await venue.db.select().from(sales).where(eq(sales.id, bill.saleId));
      expect(sale!.locale).toBe("es-ES");
      restoreVenueLanguageAfterTest();
      await withTransaction(venue.db, (tx) => seedVenueSettings(tx, { invoiceLocales: ["en-GB"] }));
      const before = await jobCount();

      const paid = await pay(bill.id);

      expect(paid.status, JSON.stringify(paid.json)).toBe(200);
      expect(await slipLanguagesSince(before)).toEqual(["es-ES"]);
    },
  );

  it("two simultaneous retries of a short reader capture file it once and print no slip", async () => {
    const bill = await billPrintedByPrintTheBill();
    const before = await jobCount();
    const pay = await readerCaptureLeftUnfiled(bill, "short");

    const answers = await Promise.all([pay(), pay()]);

    for (const answer of answers) {
      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
      expect(answer.json).toMatchObject({ outcome: "partial" });
    }
    const retained = await venue.db
      .select()
      .from(billPayments)
      .where(
        and(
          eq(billPayments.workingOrderId, bill.id),
          sql`${billPayments.submissionId} like 'capture:%'`,
        ),
      );
    expect(retained).toHaveLength(1);
    expect(await slipsSince(before)).toHaveLength(0);
  });

  it("a retry that files a short capture before its own attempt does prints one slip", async () => {
    const bill = await billPrintedByPrintTheBill();
    const before = await jobCount();
    const pay = () =>
      send(venue.app, venue.cookie, "POST", "/api/pay", {
        dining: "eat_in",
        id: bill.id,
        lines: [],
        printCardSlip: true,
      });
    let retry: Awaited<ReturnType<typeof send>> | undefined;
    const collect = venue.card.collect.bind(venue.card);
    vi.spyOn(venue.card, "collect").mockImplementationOnce(async (params) => {
      const result = await collect({ ...params, amount: decimal("10.00") });
      retry = await pay();
      return result;
    });

    const attempt = await pay();

    for (const answer of [retry!, attempt]) {
      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
      expect(answer.json).toMatchObject({ outcome: "partial" });
    }
    const slips = await slipsSince(before);
    expect(slips).toHaveLength(1);
    expectPaymentSlip(slips[0]!, "10,00", bill.invoiceNumber);
  });

  describe("a second Pay while the first is still at the reader", () => {
    /** The reader takes the money, then the second Pay runs before the first hears back from it. */
    async function payWithRetryAtReader(
      id: string,
      capture: "whole" | "short",
      asked: { first: boolean; retry: boolean },
    ) {
      const pay = (printCardSlip: boolean) =>
        send(venue.app, venue.cookie, "POST", "/api/pay", {
          dining: "eat_in",
          id,
          lines: [],
          ...(printCardSlip ? { printCardSlip: true } : {}),
        });
      let retry: Awaited<ReturnType<typeof send>> | undefined;
      const collect = venue.card.collect.bind(venue.card);
      vi.spyOn(venue.card, "collect").mockImplementationOnce(async (params) => {
        const result = await collect(
          capture === "short" ? { ...params, amount: decimal("10.00") } : params,
        );
        retry = await pay(asked.retry);
        return result;
      });

      const attempt = await pay(asked.first);

      const outcome = capture === "short" ? "partial" : "captured";
      for (const answer of [retry!, attempt]) {
        expect(answer.status, JSON.stringify(answer.json)).toBe(200);
        expect(answer.json).toMatchObject({ outcome });
      }
      return { attempt: attempt.json, retry: retry!.json };
    }

    it("a whole capture of an issued ticket that both asked a slip for prints one", async () => {
      const bill = await billPrintedByPrintTheBill();
      const before = await jobCount();

      const { attempt, retry } = await payWithRetryAtReader(bill.id, "whole", {
        first: true,
        retry: true,
      });

      const slips = await slipsSince(before);
      expect(slips).toHaveLength(1);
      expectPaymentSlip(slips[0]!, "30,00", bill.invoiceNumber);
      expect(retry).not.toHaveProperty("slipPrintFailed");
      expect(attempt).not.toHaveProperty("slipPrintFailed");
    });

    it.each([true, false])(
      "a short capture with no ticket issued prints the first attempt's slip (retry asked: %s)",
      async (retryAsked) => {
        const id = await tabWith(venue, "Red wine bottle");
        const before = await jobCount();

        const { attempt, retry } = await payWithRetryAtReader(id, "short", {
          first: true,
          retry: retryAsked,
        });

        const slips = await slipsSince(before);
        expect(slips).toHaveLength(1);
        expect(decodeTicket(slips[0]!.payload)).toContain("10,00");
        expect(attempt).not.toHaveProperty("slipPrintFailed");
        expect(retry).not.toHaveProperty("slipPrintFailed");
      },
    );

    it.each(["whole", "short"] as const)(
      "a %s capture of an issued ticket filed by a retry that asked no slip prints the first attempt's slip",
      async (capture) => {
        const bill = await billPrintedByPrintTheBill();
        const before = await jobCount();

        const { attempt, retry } = await payWithRetryAtReader(bill.id, capture, {
          first: true,
          retry: false,
        });

        expect(await slipsSince(before)).toHaveLength(1);
        expect(attempt).not.toHaveProperty("slipPrintFailed");
        expect(retry).not.toHaveProperty("slipPrintFailed");
      },
    );

    it("a short capture of an issued ticket that both asked a slip for prints one", async () => {
      const bill = await billPrintedByPrintTheBill();
      const before = await jobCount();

      const { attempt, retry } = await payWithRetryAtReader(bill.id, "short", {
        first: true,
        retry: true,
      });

      expect(await slipsSince(before)).toHaveLength(1);
      expect(attempt).not.toHaveProperty("slipPrintFailed");
      expect(retry).not.toHaveProperty("slipPrintFailed");
    });

    it.each([
      ["whole", true],
      ["whole", false],
      ["short", true],
      ["short", false],
    ] as const)(
      "a first attempt that asked no slip prints none and is not warned: %s capture, retry asked: %s",
      async (capture, retryAsked) => {
        const bill = await billPrintedByPrintTheBill();
        const before = await jobCount();

        const { attempt } = await payWithRetryAtReader(bill.id, capture, {
          first: false,
          retry: retryAsked,
        });

        expect(await slipsSince(before)).toHaveLength(0);
        expect(attempt).not.toHaveProperty("slipPrintFailed");
      },
    );

    it("a first attempt on a reader that prints its own slip is not warned", async () => {
      const bill = await billPrintedByPrintTheBill();
      await withTransaction(venue.db, (tx) =>
        tx.update(cardReaders).set({ printsOwnSlipAutomatically: true }),
      );
      const before = await jobCount();

      const { attempt } = await payWithRetryAtReader(bill.id, "whole", {
        first: true,
        retry: true,
      });

      expect(await slipsSince(before)).toHaveLength(0);
      expect(attempt).not.toHaveProperty("slipPrintFailed");
    });
  });

  it.each(["counter sale", "bill payment"] as const)(
    "a cash %s queues its drawer ahead of its slip on a shared printer",
    async (path) => {
      const bill = await billPrintedByPrintTheBill();
      const [device] = await venue.db.select().from(devices).where(eq(devices.id, venue.deviceId));
      onTestFinished(async () => {
        await withTransaction(venue.db, (tx) =>
          tx
            .update(devices)
            .set({
              paymentSlipPrinterId: device!.paymentSlipPrinterId,
              cashDrawerPrinterId: device!.cashDrawerPrinterId,
            })
            .where(eq(devices.id, venue.deviceId)),
        );
      });
      const { printerId, agentId } = await withTransaction(venue.db, async (tx) => {
        const printer = await createPrinter(tx, {
          name: "Counter printer",
          transport: "network_tcp",
          host: `${randomUUID()}.printer.test`,
          hasCashDrawer: true,
        });
        await tx
          .update(devices)
          .set({ paymentSlipPrinterId: printer.id, cashDrawerPrinterId: printer.id })
          .where(eq(devices.id, venue.deviceId));
        const [agent] = await tx
          .insert(printAgents)
          .values({ name: "Counter agent", tokenHash: "scrypt$fixture" })
          .returning({ id: printAgents.id });
        return { printerId: printer.id, agentId: agent!.id };
      });

      const paid =
        path === "counter sale"
          ? await counterSale({ printCardSlip: true })
          : await billPayment(bill.id, { ...cash("5.00"), printCardSlip: true });

      expect(paid.status, JSON.stringify(paid.json)).toBe(200);
      const queued = await venue.db
        .select()
        .from(printJobs)
        .where(eq(printJobs.printerId, printerId));
      expect(queued.map((job) => job.kind).sort()).toEqual(["document", "drawer"]);
      const [first] = await withTransaction(venue.db, (tx) =>
        claimPrintJobs(tx, agentId, { visibleKeys: [], printerId }),
      );
      expect(queued.find((job) => job.id === first!.id)!.kind).toBe("drawer");
    },
  );

  it("a reader part payment of an issued ticket prints exactly one slip", async () => {
    const bill = await billPrintedByPrintTheBill();
    const before = await jobCount();

    const paid = await billPayment(bill.id, {
      ...readerContribution,
      printCardSlip: true,
    });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const slips = await slipsSince(before);
    expect(slips).toHaveLength(1);
    expectPaymentSlip(slips[0]!, "10,00", bill.invoiceNumber);
  });

  it.each(["cash bill payment", "typed card bill payment", "cash collection"] as const)(
    "a payment on an issued ticket whose receipt never printed is listed on the original printed next: %s",
    async (path) => {
      const bill = await billIssuedNeverPrinted();
      const before = await jobCount();

      const paid =
        path === "cash collection"
          ? await send(venue.app, venue.cookie, "POST", `/api/working-orders/${bill.id}/collect`, {
              tender: { method: "cash", amount: "30.00" },
            })
          : await billPayment(
              bill.id,
              path === "cash bill payment" ? cash("30.00") : typedCard("30.00"),
            );

      expect(paid.status, JSON.stringify(paid.json)).toBe(200);
      expect(await slipsSince(before)).toHaveLength(0);
      // The receipt printed now is the original, and it carries the payment.
      const printed = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/sales/${bill.id}/receipt`,
        {},
      );
      expect(printed.status).toBe(200);
      const originals = await venue.db
        .select()
        .from(printJobs)
        .where(and(eq(printJobs.saleId, bill.saleId), eq(printJobs.receiptCopy, false)));
      expect(originals).toHaveLength(1);
      const text = decodeTicket(originals[0]!.payload);
      expect(text).toContain(path === "typed card bill payment" ? "Tarjeta" : "Efectivo");
      expect(text).toContain("30,00");
      expect(text).not.toContain(labels.duplicate);
      expect(await slipsSince(before)).toHaveLength(0);
    },
  );

  it("a slip asked for after a failed emailed original prints, and the next original lists the payment", async () => {
    const bill = await billIssuedNeverPrinted();
    await withTransaction(venue.db, (tx) =>
      tx.insert(invoiceDeliveries).values({
        saleId: bill.saleId,
        requestKey: randomUUID(),
        medium: "email",
        designation: "original",
        status: "failed",
        generation: 1,
        recipient: "guest@example.test",
        personId: venue.operatorId,
      }),
    );
    const before = await jobCount();

    const paid = await billPayment(bill.id, { ...cash("5.00"), printCardSlip: true });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const slips = await slipsSince(before);
    expect(slips).toHaveLength(1);
    expect(decodeTicket(slips[0]!.payload)).toContain("5,00");
    const printed = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/sales/${bill.id}/receipt`,
      {},
    );
    expect(printed.status, JSON.stringify(printed.json)).toBe(200);
    const [original] = await venue.db
      .select()
      .from(printJobs)
      .where(and(eq(printJobs.saleId, bill.saleId), eq(printJobs.receiptCopy, false)));
    expect(decodeTicket(original!.payload)).toMatch(/\s5,00/u);
  });

  it("a device without a payment slip printer prints no slip for a payment", async () => {
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
    const bill = await billPrintedByPrintTheBill();
    const before = await jobCount();

    const paid = await billPayment(bill.id, { ...cash("5.00"), printCardSlip: true });

    expect(paid.status).toBe(200);
    expect(paid.json).toMatchObject({ slipPrintFailed: true });
    expect(await slipsSince(before)).toHaveLength(0);
  });

  it("a profile without print-receipt prints no slip for a payment", async () => {
    const bill = await billPrintedByPrintTheBill();
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
    const before = await jobCount();

    const paid = await billPayment(bill.id, { ...cash("5.00"), printCardSlip: true });

    expect(paid.status).toBe(200);
    expect(paid.json).not.toHaveProperty("slipPrintFailed");
    expect(await slipsSince(before)).toHaveLength(0);
  });

  it("a payment filed when the till pays again on a reader that prints its own slip gets no slip", async () => {
    const bill = await billPrintedByPrintTheBill();
    await withTransaction(venue.db, (tx) =>
      tx.update(cardReaders).set({ printsOwnSlipAutomatically: true }),
    );
    const before = await jobCount();
    const pay = await readerCaptureLeftUnfiled(bill, "whole");

    const recovered = await pay();

    expect(recovered.json).toMatchObject({ outcome: "captured" });
    expect(await jobCount()).toBe(before);
  });

  it("keeps a cash payment when enqueueing its slip fails", async () => {
    const { id } = await billPrintedByPrintTheBill();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    venue.db.run(
      sql`create temp trigger refuse_slip before insert on print_jobs when new.kind = 'document' begin select raise(abort, 'printer refused'); end`,
    );
    try {
      const paid = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${id}/payments`,
        {
          submissionId: randomUUID(),
          kind: "contribution",
          amount: "5.00",
          method: "cash",
          tendered: "5.00",
          applied: "5.00",
          tip: "0.00",
          printCardSlip: true,
        },
      );
      expect(paid.status, JSON.stringify(paid.json)).toBe(200);
      expect(paid.json).toMatchObject({ balance: { received: "5.00" }, slipPrintFailed: true });
      expect(warn).toHaveBeenCalledWith(
        "receipt.optional_document_failed",
        expect.objectContaining({ operation: "enqueueRequestedPaymentSlip", workingOrderId: id }),
      );
    } finally {
      venue.db.run(sql`drop trigger refuse_slip`);
    }
  });
});
