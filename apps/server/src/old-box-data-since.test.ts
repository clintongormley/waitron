import { strFromU8, unzipSync } from "fflate";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendDrawerEntry,
  billPayments,
  liveBackupQuery,
  recordActivity,
  refunds,
  tenders,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  payments,
  recordFailedRefund,
  recordRefund,
  recordVoid,
  settleInitiated,
} from "@waitron/payments";
import { createPrinter } from "@waitron/printing";
import { seedPerson } from "@waitron/identity/test/fixtures.js";
import { decimal, jobOrigin } from "@waitron/shared";
import { appendToChain, type TimeEntryAppend } from "@waitron/workforce";
import {
  seedFiredOrder,
  seedKitchenStation,
  seedOpenOrder,
  seedSale,
  seedVenueWithSeries,
  type SeededVenue,
} from "@waitron/reporting/test/fixtures.js";
import { latestChangeAtMs, latestChangeAtMsFromMaxima } from "./handover-emergency-check.js";
import { ACCOUNTANT_EXPORT_WORDS } from "./i18n/accountant-export.js";
import { OLD_BOX_DATA_WORDS } from "./i18n/old-box-data.js";
import { sinceRule, type SinceRule } from "./old-box-data-since.js";
import { makeOldBoxWorkbook } from "./old-box-data-workbook.js";
import { completeRefundReservation } from "./tender-refund-completion.js";
import { row, sheetNamed } from "./testing/xlsx-rows.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const MADE_AT = new Date("2026-11-23T09:30:00.000Z");
const CUTOFF = Date.parse("2026-11-20T10:00:00.000Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

let venue: SeededVenue;
beforeEach(async () => {
  venue = await seedVenueWithSeries(suite.db);
});

function sheet(bytes: Uint8Array, name: string): string | undefined {
  return sheetNamed(unzipSync(bytes), name);
}

async function build(since: SinceRule, language: "en" | "es" = "en") {
  return (
    await makeOldBoxWorkbook({
      db: suite.db,
      modules: [],
      mainHoldings: null,
      madeAt: MADE_AT,
      language,
      since,
    })
  ).bytes;
}

async function namedPerson(name: string): Promise<string> {
  const personId = await seedPerson(suite.db, "manager");
  await suite.db.run(sql`update persons set display_name = ${name} where id = ${personId}`);
  return personId;
}

async function signedIn(personId: string | null, atMs: number): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    recordActivity(tx, {
      kind: "dashboard.signed_in",
      subjectId: personId ?? "00000000-0000-4000-8000-000000000001",
      personId,
      data: { method: "password" },
      at: new Date(atMs),
    }),
  );
}

describe("the old box's since rule", () => {
  it("takes the cutoff 10 minutes before the copy's latest change when the main box sent one", async () => {
    expect(await sinceRule(suite.db, { lastChangeAtMs: CUTOFF })).toEqual({
      kind: "copy",
      fromMs: CUTOFF - 10 * MINUTE,
    });
  });

  it("falls back to this box's own times when the copy time, or its cutoff, is not a date", async () => {
    for (const lastChangeAtMs of [Number.MAX_SAFE_INTEGER, -8.64e15])
      expect(await sinceRule(suite.db, { lastChangeAtMs })).toEqual({ kind: "all" });
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-11-20T10:00:00.000Z",
      total: "10.00",
      lines: [{ vatRate: "10.00", lineTotal: "10.00" }],
    });
    expect(await sinceRule(suite.db, { lastChangeAtMs: Number.MAX_SAFE_INTEGER })).toEqual({
      kind: "own",
      fromMs: Date.parse("2026-11-20T10:00:00.000Z") - 7 * DAY,
    });
  });

  it("lists everything when the main box said the copy held no sale or order", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-11-20T10:00:00.000Z",
      total: "10.00",
      lines: [{ vatRate: "10.00", lineTotal: "10.00" }],
    });
    expect(await sinceRule(suite.db, { lastChangeAtMs: null })).toEqual({ kind: "all" });
  });

  it("takes 7 days before this box's own latest sale or order when no copy time was heard, and everything when this box has none", async () => {
    expect(await sinceRule(suite.db, null)).toEqual({ kind: "all" });
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-11-20T10:00:00.000Z",
      total: "10.00",
      lines: [{ vatRate: "10.00", lineTotal: "10.00" }],
    });
    const stationId = await seedKitchenStation(suite.db, { name: "Kitchen" });
    const { orderId } = await seedFiredOrder(
      suite.db,
      { deviceId: venue.deviceId, nodeId: venue.nodeId, stationId },
      { orderNumber: 1, ageMinutes: 0 },
    );
    await suite.db.run(
      sql`update working_orders set opened_at = '2026-11-19T08:00:00.000Z' where id = ${orderId}`,
    );
    await suite.db.run(
      sql`update working_order_lines set sent_at = '2026-11-21T12:00:00.000Z' where working_order_id = ${orderId}`,
    );
    expect(await sinceRule(suite.db, null)).toEqual({
      kind: "own",
      fromMs: Date.parse("2026-11-21T12:00:00.000Z") - 7 * DAY,
    });
  });
});

describe("the latest sale or order time, from each column's maximum", () => {
  it.each([
    "sales.issued_at",
    "working_orders.opened_at",
    "working_orders.settled_at",
    "working_orders.collected_at",
    "working_order_lines.sent_at",
    "working_order_lines.served_at",
  ])("takes %s when it is the latest, as the row-by-row read does", async (column) => {
    const query = liveBackupQuery(suite.db);
    expect(await latestChangeAtMsFromMaxima(query)).toBeNull();
    const early = CUTOFF - 60 * MINUTE;
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: iso(column === "sales.issued_at" ? CUTOFF : early),
      total: "10.00",
      lines: [{ vatRate: "10.00", lineTotal: "10.00" }],
    });
    const orderId = await order(1, {
      opened: column === "working_orders.opened_at" ? CUTOFF : early,
    });
    await line(orderId, 1, {
      sent: column === "working_order_lines.sent_at" ? CUTOFF : early,
      served: column === "working_order_lines.served_at" ? CUTOFF : early,
    });
    await close(orderId, {
      settled: column === "working_orders.settled_at" ? CUTOFF : early,
      collected: column === "working_orders.collected_at" ? CUTOFF : early,
    });
    expect(await latestChangeAtMsFromMaxima(query)).toBe(CUTOFF);
    expect(await latestChangeAtMs(query)).toBe(CUTOFF);
  });

  it("refuses a latest value it cannot read as a time, as the row-by-row read does", async () => {
    const orderId = await order(1, { opened: CUTOFF });
    await suite.db.run(
      sql`update working_orders set opened_at = 'not a time' where id = ${orderId}`,
    );
    await expect(latestChangeAtMsFromMaxima(liveBackupQuery(suite.db))).rejects.toMatchObject({
      code: "handover.copy_check_failed",
    });
  });
});

describe("the old box's Activity tab", () => {
  // Seeding the venue saves its settings, which the activity log records at the real time.
  beforeEach(async () => {
    await suite.db.run(sql`delete from activity_log`);
  });

  it.each(["en", "es"] as const)(
    "lists entries at the cutoff and after, not before, with the person's name and the kind's code, under the rule's first line, in %s",
    async (language) => {
      const words = OLD_BOX_DATA_WORDS[language];
      const marta = await namedPerson("Marta Ruiz");
      await signedIn(marta, CUTOFF - 1);
      await signedIn(marta, CUTOFF + 60 * MINUTE);
      await signedIn(null, CUTOFF);
      const xml = sheet(
        await build({ kind: "copy", fromMs: CUTOFF }, language),
        words.activitySheet,
      )!;
      expect(row(xml, 1)).toEqual([
        words.sinceCopyIntro.replace("{time}", "2026-11-20 10:00:00.000 UTC"),
      ]);
      expect(row(xml, 2)).toEqual([...words.activityColumns]);
      expect(row(xml, 3)).toEqual([
        "2026-11-20T10:00:00.000Z",
        "dashboard.signed_in",
        "",
        "person",
        "00000000-0000-4000-8000-000000000001",
      ]);
      expect(row(xml, 4)).toEqual([
        "2026-11-20T11:00:00.000Z",
        "dashboard.signed_in",
        "Marta Ruiz",
        "person",
        marta,
      ]);
      expect(row(xml, 5)).toEqual([]);
      const names = strFromU8(
        unzipSync(await build({ kind: "all" }, language))["xl/workbook.xml"]!,
      );
      expect(names).toContain(`<sheet name="${words.activitySheet}" sheetId="5"`);
    },
  );

  it("takes the 7-day rule's first line from its own words, and the Payments and cash tab's from its own", async () => {
    const bytes = await build({ kind: "own", fromMs: CUTOFF });
    const en = OLD_BOX_DATA_WORDS.en;
    expect(row(sheet(bytes, en.activitySheet)!, 1)).toEqual([
      en.sinceOwnIntro.replace("{time}", "2026-11-20 10:00:00.000 UTC"),
    ]);
    expect(row(sheet(bytes, en.paymentsSheet)!, 1)).toEqual([
      en.paymentsOwnIntro.replace("{time}", "2026-11-20 10:00:00.000 UTC"),
    ]);
  });

  it("states the cutoff to the millisecond, so a row at the boundary can be checked against it", async () => {
    const fromMs = CUTOFF + 42_123;
    await signedIn(null, fromMs - 1);
    await signedIn(null, fromMs);
    const bytes = await build({ kind: "copy", fromMs });
    const en = OLD_BOX_DATA_WORDS.en;
    for (const name of [en.ordersSheet, en.hoursSheet, en.activitySheet])
      expect(row(sheet(bytes, name)!, 1), name).toEqual([
        en.sinceCopyIntro.replace("{time}", "2026-11-20 10:00:42.123 UTC"),
      ]);
    expect(row(sheet(bytes, en.paymentsSheet)!, 1)).toEqual([
      en.paymentsCopyIntro.replace("{time}", "2026-11-20 10:00:42.123 UTC"),
    ]);
    const activity = sheet(bytes, en.activitySheet)!;
    expect(row(activity, 3)[0]).toBe("2026-11-20T10:00:42.123Z");
    expect(row(activity, 4)).toEqual([]);
  });

  it("an empty Activity tab still has its first line and headings, read without a write transaction", async () => {
    const lock = vi.spyOn(suite.db, "withWriteLock");
    const transaction = vi.spyOn(suite.db, "transaction");
    const xml = sheet(await build({ kind: "all" }), OLD_BOX_DATA_WORDS.en.activitySheet)!;
    expect(await sinceRule(suite.db, null)).toEqual({ kind: "all" });
    expect(lock).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(row(xml, 1)).toEqual([OLD_BOX_DATA_WORDS.en.sinceAllIntro]);
    expect(row(xml, 2)).toEqual([...OLD_BOX_DATA_WORDS.en.activityColumns]);
    expect(row(xml, 3)).toEqual([]);
  });

  it("lists every entry under the rule that lists everything", async () => {
    await signedIn(null, CUTOFF - 365 * DAY);
    const xml = sheet(await build({ kind: "all" }), OLD_BOX_DATA_WORDS.en.activitySheet)!;
    expect(row(xml, 3)[0]).toBe(new Date(CUTOFF - 365 * DAY).toISOString());
  });
});

const iso = (ms: number) => new Date(ms).toISOString();

async function order(
  number: number,
  times: { opened: number; settled?: number; collected?: number; label?: string },
): Promise<string> {
  const { orderId } = await seedOpenOrder(suite.db, venue, number);
  await suite.db.run(
    sql`update working_orders set opened_at = ${iso(times.opened)}, label = ${times.label ?? null} where id = ${orderId}`,
  );
  return orderId;
}

async function close(
  orderId: string,
  times: { settled?: number; collected?: number },
): Promise<void> {
  if (times.settled !== undefined)
    await suite.db.run(
      sql`update working_orders set status = 'settled', settled_at = ${iso(times.settled)} where id = ${orderId}`,
    );
  if (times.collected !== undefined)
    await suite.db.run(
      sql`update working_orders set collected_at = ${iso(times.collected)} where id = ${orderId}`,
    );
}

async function line(
  orderId: string,
  lineNo: number,
  opts: {
    sent?: number;
    served?: number;
    name?: string;
    variantName?: string;
    quantity?: number;
    unitPrice?: number;
  } = {},
): Promise<void> {
  const quantity = opts.quantity ?? 1000;
  const unitPrice = opts.unitPrice ?? 250;
  await suite.db.insert(workingOrderLines).values({
    workingOrderId: orderId,
    lineNo,
    name: opts.name ?? `Dish ${lineNo}`,
    variantName: opts.variantName ?? null,
    kitchenName: "Kitchen dish name",
    variantKitchenName: opts.variantName === undefined ? null : "Kitchen variant name",
    descriptions: { "es-ES": "Customer dish name" },
    variantDescriptions:
      opts.variantName === undefined ? null : { "es-ES": "Customer variant name" },
    quantity,
    unitPriceGross: unitPrice,
    vatClass: "reduced",
    takeawayVatClass: "reduced",
    lineTotal: Math.round((unitPrice * quantity) / 1000),
    sentAt: opts.sent === undefined ? null : iso(opts.sent),
    servedAt: opts.served === undefined ? null : iso(opts.served),
  });
}

describe("the old box's Orders tab", () => {
  const orders = async (since: SinceRule, language: "en" | "es" = "en") =>
    sheet(await build(since, language), OLD_BOX_DATA_WORDS[language].ordersSheet)!;

  it("lists an order opened, settled or collected from the cutoff, with every line, and not one whose every time is earlier", async () => {
    const earlier = await order(1, { opened: CUTOFF - 60 * MINUTE });
    await line(earlier, 1, { sent: CUTOFF - 50 * MINUTE, served: CUTOFF - 40 * MINUTE });
    await close(earlier, { settled: CUTOFF - 1, collected: CUTOFF - 1 });
    const opened = await order(2, { opened: CUTOFF, label: "Table 4" });
    await line(opened, 2);
    await line(opened, 1, { sent: CUTOFF + MINUTE });
    const settled = await order(3, { opened: CUTOFF - 90 * MINUTE });
    await line(settled, 1, { sent: CUTOFF - 80 * MINUTE });
    await close(settled, { settled: CUTOFF + 5 * MINUTE });
    const collected = await order(4, { opened: CUTOFF - 90 * MINUTE });
    await close(collected, { collected: CUTOFF + 10 * MINUTE });

    const xml = await orders({ kind: "copy", fromMs: CUTOFF });
    expect(row(xml, 1)).toEqual([
      OLD_BOX_DATA_WORDS.en.sinceCopyIntro.replace("{time}", "2026-11-20 10:00:00.000 UTC"),
    ]);
    expect(row(xml, 2)).toEqual([...OLD_BOX_DATA_WORDS.en.orderColumns]);
    // prettier-ignore
    expect([3, 4, 5, 6, 7].map((n) => row(xml, n))).toEqual([
      ["2", "Table 4", "Open", iso(CUTOFF), "", "", "1", "Dish 1", "1.000", "2.50", "2.50", iso(CUTOFF + MINUTE), ""],
      ["2", "Table 4", "Open", iso(CUTOFF), "", "", "2", "Dish 2", "1.000", "2.50", "2.50", "", ""],
      ["3", "", "Settled", iso(CUTOFF - 90 * MINUTE), iso(CUTOFF + 5 * MINUTE), "", "1", "Dish 1", "1.000", "2.50", "2.50", iso(CUTOFF - 80 * MINUTE), ""],
      ["4", "", "Open", iso(CUTOFF - 90 * MINUTE), "", iso(CUTOFF + 10 * MINUTE), "", "", "", "", "", "", ""],
      [],
    ]);
    expect(row(await orders({ kind: "all" }), 3)[0]).toBe("1");
  });

  it("lists an order whose only later change is a line sent after the cutoff, with all its lines", async () => {
    const sentLater = await order(7, { opened: CUTOFF - 60 * MINUTE });
    await line(sentLater, 1, { sent: CUTOFF - 30 * MINUTE });
    await line(sentLater, 2, { sent: CUTOFF + 30 * MINUTE });
    const servedLater = await order(8, { opened: CUTOFF - 60 * MINUTE });
    await line(servedLater, 1, { sent: CUTOFF - 30 * MINUTE, served: CUTOFF + 20 * MINUTE });
    const untouched = await order(9, { opened: CUTOFF - 60 * MINUTE });
    await line(untouched, 1, { sent: CUTOFF - 30 * MINUTE, served: CUTOFF - 20 * MINUTE });

    const xml = await orders({ kind: "own", fromMs: CUTOFF });
    expect([3, 4, 5, 6].map((n) => row(xml, n).slice(0, 7))).toEqual([
      ["7", "", "Open", iso(CUTOFF - 60 * MINUTE), "", "", "1"],
      ["7", "", "Open", iso(CUTOFF - 60 * MINUTE), "", "", "2"],
      ["8", "", "Open", iso(CUTOFF - 60 * MINUTE), "", "", "1"],
      [],
    ]);
  });

  it("names a line by its staff name and variant, never its customer-facing or prep station name", async () => {
    const orderId = await order(1, { opened: CUTOFF });
    await line(orderId, 1, { name: "Fish cake", variantName: "Large" });
    const xml = await orders({ kind: "all" });
    expect(row(xml, 3)[7]).toBe("Fish cake (Large)");
    for (const other of ["Customer", "Kitchen"]) expect(xml).not.toContain(other);
  });

  it("writes quantities as three-place numbers and money as two-place numbers", async () => {
    const orderId = await order(1, { opened: CUTOFF });
    await line(orderId, 1, { quantity: 125, unitPrice: 1000 });
    const bytes = await build({ kind: "all" });
    const xml = sheet(bytes, OLD_BOX_DATA_WORDS.en.ordersSheet)!;
    expect(xml).toContain('<c r="I3" t="n" s="2"><v>0.125</v></c>');
    expect(xml).toContain('<c r="J3" t="n" s="1"><v>10.00</v></c>');
    expect(xml).toContain('<c r="K3" t="n" s="1"><v>1.25</v></c>');
    const styles = strFromU8(unzipSync(bytes)["xl/styles.xml"]!);
    expect(styles).toMatch(/<cellXfs count="3">(?:<xf [^>]*\/>){2}<xf numFmtId="164"/);
    expect(styles).toContain('<numFmt numFmtId="164" formatCode="0.000"/>');
  });
});

async function partPayment(
  orderId: string,
  personId: string,
  at: number,
  opts: { method?: "cash" | "card"; applied?: number; tip?: number } = {},
): Promise<string> {
  const [saved] = await suite.db
    .insert(billPayments)
    .values({
      workingOrderId: orderId,
      submissionId: crypto.randomUUID(),
      fingerprint: "fixture",
      kind: "contribution",
      method: opts.method ?? "cash",
      applied: opts.applied ?? 500,
      tip: opts.tip ?? 0,
      tendered: (opts.method ?? "cash") === "cash" ? (opts.applied ?? 500) + (opts.tip ?? 0) : null,
      state: "received",
      requestedBy: personId,
      source: "device",
      deviceId: venue.deviceId,
      createdAt: iso(at),
      receivedAt: iso(at),
    })
    .returning({ id: billPayments.id });
  return saved!.id;
}

async function cardPayment(
  orderId: string,
  at: number,
  ref: string,
  billPaymentId: string | null,
): Promise<string> {
  const [saved] = await suite.db
    .insert(payments)
    .values({
      workingOrderId: orderId,
      source: "device",
      deviceId: venue.deviceId,
      provider: "simulator",
      paymentRef: ref,
      amount: 700,
      state: "captured",
      createdAt: iso(at),
      updatedAt: iso(at),
      billPaymentId,
    })
    .returning({ id: payments.id });
  return saved!.id;
}

async function drawerEntry(
  personId: string,
  at: number,
  entry: { kind: "cash_payment"; billPaymentId: string } | { kind: "cash_in" },
): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const printer = await createPrinter(tx, {
      name: `Drawer ${at}`,
      transport: "network_tcp",
      host: `drawer-${at}.test`,
      hasCashDrawer: true,
    });
    const saved = await appendDrawerEntry(tx, {
      printerId: printer.id,
      nodeId: venue.nodeId,
      recordedAt: iso(at),
      personId,
      amount: 500,
      ...entry,
    });
    return saved.id;
  });
}

describe("the old box's Payments and cash tab", () => {
  it("lists a part payment, a card payment with no part payment, a card payment that names its part payment, and a drawer entry from the cutoff, and none from before", async () => {
    const marta = await namedPerson("Marta Ruiz");
    const orderId = await order(12, { opened: CUTOFF - 60 * MINUTE });
    const before = await partPayment(orderId, marta, CUTOFF - 1);
    await cardPayment(orderId, CUTOFF - 1, "ref-before", null);
    await drawerEntry(marta, CUTOFF - 1, { kind: "cash_payment", billPaymentId: before });
    await drawerEntry(marta, CUTOFF - 2, { kind: "cash_in" });
    const part = await partPayment(orderId, marta, CUTOFF, { tip: 50 });
    const alone = await cardPayment(orderId, CUTOFF + MINUTE, "ref-alone", null);
    const cardPart = await partPayment(orderId, marta, CUTOFF + 2 * MINUTE, { method: "card" });
    const named = await cardPayment(orderId, CUTOFF + 3 * MINUTE, "ref-named", cardPart);
    const drawer = await drawerEntry(marta, CUTOFF + 4 * MINUTE, {
      kind: "cash_payment",
      billPaymentId: part,
    });

    const xml = sheet(
      await build({ kind: "copy", fromMs: CUTOFF }),
      OLD_BOX_DATA_WORDS.en.paymentsSheet,
    )!;
    expect(row(xml, 1)).toEqual([
      OLD_BOX_DATA_WORDS.en.paymentsCopyIntro.replace("{time}", "2026-11-20 10:00:00.000 UTC"),
    ]);
    // `row` returns cell text as written, so the apostrophe is still escaped.
    expect(row(xml, 2)).toEqual(
      OLD_BOX_DATA_WORDS.en.paymentColumns.map((heading) => heading.replace("'", "&apos;")),
    );
    // prettier-ignore
    expect([3, 4, 5, 6, 7, 8].map((n) => row(xml, n))).toEqual([
      ["Payment", iso(CUTOFF), iso(CUTOFF), "5.00", "0.50", "Cash", "Received", "12", "", "", "", "", "", "Marta Ruiz", part],
      ["Card payment", iso(CUTOFF + MINUTE), iso(CUTOFF + MINUTE), "7.00", "", "", "Captured", "12", "simulator", "ref-alone", "", "", "", "", alone],
      ["Payment", iso(CUTOFF + 2 * MINUTE), iso(CUTOFF + 2 * MINUTE), "5.00", "0.00", "Card", "Received", "12", "", "", "", "", "", "Marta Ruiz", cardPart],
      ["Card payment", iso(CUTOFF + 3 * MINUTE), iso(CUTOFF + 3 * MINUTE), "7.00", "", "", "Captured", "12", "simulator", "ref-named", "", cardPart, "", "", named],
      ["Cash drawer", iso(CUTOFF + 4 * MINUTE), "", "5.00", "", "", "Cash payment", "12", "", "", "", part, "", "Marta Ruiz", drawer],
      [],
    ]);
  });

  describe("an earlier payment whose money moved from the cutoff", () => {
    const LATER = CUTOFF + 20 * MINUTE;
    beforeEach(() => {
      // The payments module stamps its own changes with the current time.
      vi.useFakeTimers({ now: LATER, toFake: ["Date"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const paymentsTab = async (since: SinceRule = { kind: "copy", fromMs: CUTOFF }) =>
      sheet(await build(since), OLD_BOX_DATA_WORDS.en.paymentsSheet)!;

    it("lists a card payment started before the cutoff and captured after it, at the time it was listed for", async () => {
      const orderId = await order(12, { opened: CUTOFF - 60 * MINUTE });
      const [started] = await suite.db
        .insert(payments)
        .values({
          workingOrderId: orderId,
          source: "device",
          deviceId: venue.deviceId,
          provider: "simulator",
          paymentRef: "late-capture",
          externalRef: "processor-late-capture",
          amount: 700,
          state: "initiated",
          createdAt: iso(CUTOFF - MINUTE),
          updatedAt: iso(CUTOFF - MINUTE),
        })
        .returning({ id: payments.id });
      const before = await cardPayment(orderId, CUTOFF - 2 * MINUTE, "ref-before", null);
      const settled = await withTransaction(suite.db, (tx) =>
        settleInitiated(tx, {
          provider: "simulator",
          externalRef: "processor-late-capture",
          settledAt: new Date(CUTOFF + 11 * MINUTE),
        }),
      );
      const after = await cardPayment(orderId, CUTOFF + 5 * MINUTE, "ref-after", null);

      const xml = await paymentsTab();
      // prettier-ignore
      expect([3, 4, 5].map((n) => row(xml, n))).toEqual([
        ["Card payment", iso(CUTOFF + 5 * MINUTE), iso(CUTOFF + 5 * MINUTE), "7.00", "", "", "Captured", "12", "simulator", "ref-after", "", "", "", "", after],
        ["Card payment", iso(CUTOFF - MINUTE), iso(LATER), "7.00", "", "", "Captured", "12", "simulator", "late-capture", "", "", "", "", started!.id],
        [],
      ]);
      expect(settled?.paymentRef).toBe("late-capture");
      expect(xml).not.toContain(before);
    });

    it("lists a card refund recorded after the cutoff against an earlier capture, as its own line naming the capture", async () => {
      const marta = await namedPerson("Marta Ruiz");
      const orderId = await order(12, { opened: CUTOFF - 60 * MINUTE });
      const captured = await cardPayment(orderId, CUTOFF - 30 * MINUTE, "ref-refunded", null);
      const key = { provider: "simulator", paymentRef: "ref-refunded" };
      await withTransaction(suite.db, async (tx) => {
        await recordRefund(tx, {
          ...key,
          amount: decimal("3.00"),
          authorizedBy: marta,
          providerRefundRef: "re-1",
          at: new Date(CUTOFF + 10 * MINUTE),
        });
        await recordFailedRefund(tx, { ...key, amount: decimal("4.00") });
      });

      const xml = await paymentsTab();
      const refunds = await suite.db.all<{ id: string; state: string }>(
        sql`select id, state from payment_refunds order by created_at`,
      );
      expect(refunds.map((r) => r.state)).toEqual(["succeeded", "failed"]);
      // prettier-ignore
      expect([3, 4, 5, 6].map((n) => row(xml, n))).toEqual([
        ["Card refund", iso(CUTOFF + 10 * MINUTE), "", "-3.00", "", "", "Completed", "12", "simulator", "ref-refunded", "re-1", "", "", "Marta Ruiz", refunds[0]!.id],
        ["Card payment", iso(CUTOFF - 30 * MINUTE), iso(LATER), "7.00", "", "", "Partially refunded", "12", "simulator", "ref-refunded", "", "", "", "", captured],
        ["Card refund", iso(LATER), "", "-4.00", "", "", "Failed", "12", "simulator", "ref-refunded", "", "", "", "", refunds[1]!.id],
        [],
      ]);
      // Under the rule that lists everything, the capture comes first, at the time it was recorded.
      expect(row(await paymentsTab({ kind: "all" }), 3).at(-1)).toBe(captured);
    });

    it("lists each refund recorded, sent, completed or failed from the cutoff as its own line, with the drawer line and card refund that also show its money naming it or its references", async () => {
      const marta = await namedPerson("Marta Ruiz");
      const ana = await namedPerson("Ana Gil");
      const orderId = await order(12, { opened: CUTOFF - 60 * MINUTE });
      const paid = await partPayment(orderId, marta, CUTOFF - 30 * MINUTE, { applied: 900 });
      // As `reserveTenderRefund` and `bill-refunds.ts` store a refund before taking it forward.
      const reserve = async (fields: Partial<typeof refunds.$inferInsert>, at: number) => {
        const [saved] = await suite.db
          .insert(refunds)
          .values({
            submissionId: crypto.randomUUID(),
            fingerprint: "fixture",
            appliedAmount: 200,
            tipAmount: 0,
            reason: "Cold soup",
            requestedBy: marta,
            authorizedBy: ana,
            source: "device",
            deviceId: venue.deviceId,
            nodeId: venue.nodeId,
            method: "cash",
            manual: false,
            state: "pending",
            createdAt: iso(at),
            ...fields,
          })
          .returning();
        return saved!;
      };
      const reading = (at: number) => ({
        instant: new Date(at),
        offsetMinutes: 0,
        confident: true,
        confidence: "anchored" as const,
        anchorAgeSeconds: 0,
      });
      const cashRefund = (at: number, fields: Partial<typeof refunds.$inferInsert> = {}) =>
        withTransaction(suite.db, async (tx) =>
          completeRefundReservation(
            tx,
            {},
            reading(at),
            await reserve({ billPaymentId: paid, ...fields }, at),
          ),
        );
      const settledBefore = await cashRefund(CUTOFF - 20 * MINUTE);
      const cash = await cashRefund(CUTOFF + 2 * MINUTE, { tipAmount: 50 });
      // As `recordCashDrawerRefund` writes it when the device has a drawer.
      const drawer = await withTransaction(suite.db, async (tx) => {
        const printer = await createPrinter(tx, {
          name: "Refund drawer",
          transport: "network_tcp",
          host: "refund-drawer.test",
          hasCashDrawer: true,
        });
        return appendDrawerEntry(tx, {
          nodeId: venue.nodeId,
          printerId: printer.id,
          deviceId: venue.deviceId,
          personId: marta,
          recordedAt: cash.completedAt!,
          kind: "cash_refund",
          amount: -250,
          refundId: cash.id,
        });
      });

      const saleId = await seedSale(suite.db, venue, {
        invoiceNumber: 1,
        issuedAt: iso(CUTOFF - 40 * MINUTE),
        total: "7.00",
        lines: [{ vatRate: "10.00", lineTotal: "7.00" }],
        workingOrderId: orderId,
      });
      const [tender] = await suite.db
        .insert(tenders)
        .values({ saleId, method: "card", amount: 700, settledAt: iso(CUTOFF - 40 * MINUTE) })
        .returning({ id: tenders.id });
      const captured = await cardPayment(orderId, CUTOFF - 40 * MINUTE, "ref-card", null);
      const card = {
        saleId,
        tenderId: tender!.id,
        method: "card" as const,
        provider: "simulator",
        providerPaymentRef: "ref-card",
      };
      const late = await reserve({ ...card, appliedAmount: 300 }, CUTOFF - 5 * MINUTE);
      // As `tender-refund-sends.ts` stores a send, then the provider's answer.
      await suite.db.run(
        sql`update refunds set sent_at = ${iso(CUTOFF - 4 * MINUTE)}, send_count = 1 where id = ${late.id}`,
      );
      await withTransaction(suite.db, async (tx) => {
        await tx.run(
          sql`update refunds set state = 'completed', completed_at = ${iso(CUTOFF + 6 * MINUTE)}, provider_refund_ref = 're-9', provider_status = 'completed', next_retry_at = null where id = ${late.id}`,
        );
        await recordRefund(tx, {
          provider: "simulator",
          paymentRef: "ref-card",
          amount: decimal("3.00"),
          authorizedBy: ana,
          providerRefundRef: "re-9",
        });
      });
      const failed = await reserve({ ...card, appliedAmount: 100 }, CUTOFF + 8 * MINUTE);
      await suite.db.run(
        sql`update refunds set sent_at = ${iso(CUTOFF + 8 * MINUTE)}, send_count = 1, state = 'failed', failed_at = ${iso(CUTOFF + 9 * MINUTE)} where id = ${failed.id}`,
      );
      const [cardRefund] = await suite.db.all<{ id: string }>(sql`select id from payment_refunds`);

      const xml = await paymentsTab();
      // prettier-ignore
      expect([3, 4, 5, 6, 7, 8, 9].map((n) => row(xml, n))).toEqual([
        ["Refund", iso(CUTOFF + 2 * MINUTE), iso(CUTOFF + 2 * MINUTE), "-2.00", "-0.50", "Cash", "Completed", "12", "", "", "", paid, "", "Marta Ruiz", cash.id],
        ["Cash drawer", iso(CUTOFF + 2 * MINUTE), "", "-2.50", "", "", "Cash refund", "", "", "", "", "", cash.id, "Marta Ruiz", drawer.id],
        ["Refund", iso(CUTOFF - 5 * MINUTE), iso(CUTOFF + 6 * MINUTE), "-3.00", "0.00", "Card", "Completed", "12", "simulator", "ref-card", "re-9", "", "", "Marta Ruiz", late.id],
        ["Refund", iso(CUTOFF + 8 * MINUTE), iso(CUTOFF + 9 * MINUTE), "-1.00", "0.00", "Card", "Failed", "12", "simulator", "ref-card", "", "", "", "Marta Ruiz", failed.id],
        ["Card payment", iso(CUTOFF - 40 * MINUTE), iso(LATER), "7.00", "", "", "Partially refunded", "12", "simulator", "ref-card", "", "", "", "", captured],
        ["Card refund", iso(LATER), "", "-3.00", "", "", "Completed", "12", "simulator", "ref-card", "re-9", "", "", "Ana Gil", cardRefund!.id],
        [],
      ]);
      expect(xml).not.toContain(settledBefore.id);
      expect(settledBefore.state).toBe("completed");
    });

    it("lists a card payment voided, or a hold on it decided, after the cutoff", async () => {
      const orderId = await order(12, { opened: CUTOFF - 60 * MINUTE });
      const voided = await cardPayment(orderId, CUTOFF - 30 * MINUTE, "ref-voided", null);
      await withTransaction(suite.db, (tx) =>
        recordVoid(tx, { provider: "simulator", paymentRef: "ref-voided" }),
      );
      const held = await cardPayment(orderId, CUTOFF - 40 * MINUTE, "ref-held", null);
      const marta = await namedPerson("Marta Ruiz");
      await suite.db.run(
        sql`update payments set hold_provider_amount = 900, held_at = ${iso(CUTOFF - 35 * MINUTE)}, hold_outcome = 'refunded_at_provider', hold_note = 'Refunded', hold_decided_by = ${marta}, hold_decided_at = ${iso(CUTOFF + 3 * MINUTE)} where id = ${held}`,
      );

      const xml = await paymentsTab();
      expect([3, 4, 5].map((n) => [row(xml, n)[2], row(xml, n)[6], row(xml, n).at(-1)])).toEqual([
        [iso(CUTOFF + 3 * MINUTE), "Captured", held],
        [iso(LATER), "Voided", voided],
        [undefined, undefined, undefined],
      ]);
    });

    it("lists a part payment made before the cutoff and received or failed after it, and not one settled before it", async () => {
      const marta = await namedPerson("Marta Ruiz");
      const orderId = await order(12, { opened: CUTOFF - 60 * MINUTE });
      const outcome = async (
        state: "received" | "failed",
        outcomeAt: number,
        tendered: number | null = null,
      ) => {
        const [saved] = await suite.db
          .insert(billPayments)
          .values({
            workingOrderId: orderId,
            submissionId: crypto.randomUUID(),
            fingerprint: "fixture",
            kind: "contribution",
            method: tendered === null ? "card" : "cash",
            applied: 500,
            tendered,
            state,
            requestedBy: marta,
            source: "device",
            deviceId: venue.deviceId,
            createdAt: iso(CUTOFF - 5 * MINUTE),
            receivedAt: state === "received" ? iso(outcomeAt) : null,
            failedAt: state === "failed" ? iso(outcomeAt) : null,
          })
          .returning({ id: billPayments.id });
        return saved!.id;
      };
      const settledBefore = await outcome("received", CUTOFF - 4 * MINUTE, 500);
      const received = await outcome("received", CUTOFF + 2 * MINUTE);
      const failed = await outcome("failed", CUTOFF + MINUTE);

      const xml = await paymentsTab();
      // prettier-ignore
      expect([3, 4, 5].map((n) => row(xml, n))).toEqual([
        ["Payment", iso(CUTOFF - 5 * MINUTE), iso(CUTOFF + MINUTE), "5.00", "0.00", "Card", "Failed", "12", "", "", "", "", "", "Marta Ruiz", failed],
        ["Payment", iso(CUTOFF - 5 * MINUTE), iso(CUTOFF + 2 * MINUTE), "5.00", "0.00", "Card", "Received", "12", "", "", "", "", "", "Marta Ruiz", received],
        [],
      ]);
      expect(xml).not.toContain(settledBefore);
    });
  });
});

describe("the old box's Orders and Payments and cash tabs in Spanish", () => {
  it("in Spanish, the sheet names, headings and state words", async () => {
    const es = OLD_BOX_DATA_WORDS.es;
    const marta = await namedPerson("Marta Ruiz");
    const orderId = await order(5, { opened: CUTOFF });
    await line(orderId, 1);
    await close(orderId, { settled: CUTOFF + MINUTE });
    const part = await partPayment(orderId, marta, CUTOFF);
    await cardPayment(orderId, CUTOFF + MINUTE, "ref-es", null);
    await drawerEntry(marta, CUTOFF + 2 * MINUTE, { kind: "cash_payment", billPaymentId: part });
    const bytes = await build({ kind: "all" }, "es");
    const names = strFromU8(unzipSync(bytes)["xl/workbook.xml"]!);
    expect([...names.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual([
      es.invoiceSheet,
      es.ordersSheet,
      es.paymentsSheet,
      es.hoursSheet,
      es.activitySheet,
    ]);
    const orders = sheet(bytes, es.ordersSheet)!;
    expect(row(orders, 1)).toEqual([es.sinceAllIntro]);
    expect(row(orders, 2)).toEqual([...es.orderColumns]);
    expect(row(orders, 3)[2]).toBe(es.orderStatuses.settled);
    const cash = sheet(bytes, es.paymentsSheet)!;
    expect(row(cash, 2)).toEqual([...es.paymentColumns]);
    // prettier-ignore
    expect([3, 4, 5].map((n) => row(cash, n).slice(0, 7))).toEqual([
      [es.paymentKinds.part, iso(CUTOFF), iso(CUTOFF), "5.00", "0.00", ACCOUNTANT_EXPORT_WORDS.es.paymentMethods.cash, es.partPaymentStates.received],
      [es.paymentKinds.card, iso(CUTOFF + MINUTE), iso(CUTOFF + MINUTE), "7.00", "", "", ACCOUNTANT_EXPORT_WORDS.es.paymentStates.captured],
      [es.paymentKinds.drawer, iso(CUTOFF + 2 * MINUTE), "", "5.00", "", "", es.drawerKinds.cash_payment],
    ]);
    // The Spanish words differ from the English ones, so the tab cannot have fallen back to them.
    expect(es.ordersSheet).not.toBe(OLD_BOX_DATA_WORDS.en.ordersSheet);
    expect(es.paymentKinds.part).not.toBe(OLD_BOX_DATA_WORDS.en.paymentKinds.part);
  });
});

describe("the old box's Working hours tab", () => {
  async function clocked(
    personId: string,
    recordedAtMs: number,
    entry: Partial<TimeEntryAppend> = {},
  ): Promise<string> {
    const { id } = await withTransaction(suite.db, (tx) =>
      appendToChain(
        tx,
        { nodeId: venue.nodeId },
        {
          personId,
          entryKind: "in",
          eventAt: new Date(recordedAtMs - MINUTE).toISOString(),
          eventOffsetMinutes: 60,
          recordedByPersonId: personId,
          origin: jobOrigin("dashboard"),
          ...entry,
        },
        () => new Date(recordedAtMs),
      ),
    );
    return id;
  }

  function correction(
    target: string,
    status: "approved" | "disputed",
    reason: string,
    actor: string,
  ): Partial<TimeEntryAppend> {
    return {
      entryKind: "correction",
      correctsEntryId: target,
      correctionStatus: status,
      correctionReason: reason,
      correctionActorId: actor,
      recordedByPersonId: actor,
      extension: {
        authorKind: "manager",
        direction: "manager_proposal",
        missingEntryKind: null,
        respondsToEntryId: null,
        payPeriodClosureId: null,
      },
    };
  }

  it("lists time entries recorded from the cutoff with the person's name, and not earlier ones", async () => {
    const en = OLD_BOX_DATA_WORDS.en;
    const marta = await namedPerson("Marta Ruiz");
    const early = await clocked(marta, CUTOFF - 1000);
    const atCutoff = await clocked(marta, CUTOFF, { entryKind: "out" });
    const later = await clocked(marta, CUTOFF + 60 * MINUTE, { entryKind: "break_start" });
    const xml = sheet(await build({ kind: "copy", fromMs: CUTOFF }), en.hoursSheet)!;
    expect(row(xml, 1)).toEqual([
      en.sinceCopyIntro.replace("{time}", "2026-11-20 10:00:00.000 UTC"),
    ]);
    expect(row(xml, 2)).toEqual([...en.hoursColumns]);
    expect(row(xml, 3)).toEqual([
      "Marta Ruiz",
      en.entryKinds.out,
      iso(CUTOFF - MINUTE),
      iso(CUTOFF),
      "",
      "",
      "",
      atCutoff,
    ]);
    expect(row(xml, 4)).toEqual([
      "Marta Ruiz",
      en.entryKinds.break_start,
      iso(CUTOFF + 59 * MINUTE),
      iso(CUTOFF + 60 * MINUTE),
      "",
      "",
      "",
      later,
    ]);
    expect(row(xml, 5)).toEqual([]);
    expect(xml).not.toContain(early);
    const all = sheet(await build({ kind: "all" }), en.hoursSheet)!;
    expect(row(all, 3)[7]).toBe(early);
    const names = strFromU8(unzipSync(await build({ kind: "all" }))["xl/workbook.xml"]!);
    expect([...names.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual([
      en.invoiceSheet,
      en.ordersSheet,
      en.paymentsSheet,
      en.hoursSheet,
      en.activitySheet,
    ]);
  });

  it("a correction names the entry it corrects, its status and reason", async () => {
    const en = OLD_BOX_DATA_WORDS.en;
    const marta = await namedPerson("Marta Ruiz");
    const luis = await namedPerson("Luis Gil");
    const first = await clocked(marta, CUTOFF);
    const approved = await clocked(
      marta,
      CUTOFF + MINUTE,
      correction(first, "approved", "Forgot to clock in", luis),
    );
    const disputed = await clocked(
      marta,
      CUTOFF + 2 * MINUTE,
      correction(first, "disputed", "Started later", luis),
    );
    const xml = sheet(await build({ kind: "copy", fromMs: CUTOFF }), en.hoursSheet)!;
    expect(row(xml, 4)).toEqual([
      "Marta Ruiz",
      en.entryKinds.correction,
      iso(CUTOFF),
      iso(CUTOFF + MINUTE),
      first,
      en.correctionStatuses.approved,
      "Forgot to clock in",
      approved,
    ]);
    expect(row(xml, 5)).toEqual([
      "Marta Ruiz",
      en.entryKinds.correction,
      iso(CUTOFF + MINUTE),
      iso(CUTOFF + 2 * MINUTE),
      first,
      en.correctionStatuses.disputed,
      "Started later",
      disputed,
    ]);
  });

  it("in Spanish", async () => {
    const es = OLD_BOX_DATA_WORDS.es;
    const marta = await namedPerson("Marta Ruiz");
    const luis = await namedPerson("Luis Gil");
    const first = await clocked(marta, CUTOFF);
    await clocked(marta, CUTOFF + MINUTE, correction(first, "disputed", "Started later", luis));
    const xml = sheet(await build({ kind: "all" }, "es"), es.hoursSheet)!;
    expect(row(xml, 1)).toEqual([es.sinceAllIntro]);
    expect(row(xml, 2)).toEqual([...es.hoursColumns]);
    expect(row(xml, 3)[1]).toBe(es.entryKinds.in);
    expect(row(xml, 4)[1]).toBe(es.entryKinds.correction);
    expect(row(xml, 4)[5]).toBe(es.correctionStatuses.disputed);
    // The Spanish words differ from the English ones, so the tab cannot have fallen back to them.
    expect(es.hoursSheet).not.toBe(OLD_BOX_DATA_WORDS.en.hoursSheet);
    expect(es.correctionStatuses.disputed).not.toBe(
      OLD_BOX_DATA_WORDS.en.correctionStatuses.disputed,
    );
  });
});

describe("the Payments and cash tab's headings", () => {
  it("names the bill payment a row belongs to as a bill payment, not a part payment", () => {
    expect(OLD_BOX_DATA_WORDS.en.paymentColumns[11]).toBe("Bill payment");
  });
});
