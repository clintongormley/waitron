import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drawerOpens, invoiceCorrections, saleLines, sales, tenderRefunds } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { createProduct } from "@waitron/catalogue";
import { hashPin, loginWithPin, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { recordAttendanceFact } from "./attendance-capture.js";
import { readBillEditState } from "./bill-editing.js";
import { parkOrder } from "./working-order.js";
import { businessDayAt, saleId as brandSaleId } from "@waitron/shared";
import { acceptInvoiceCorrection, previewInvoiceCorrection } from "./invoice-corrections.js";
import { mountReportApi, resolveVenueClock } from "./report-api.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts } from "./testing/zone-offers.js";

let venue: BillVenue;
let offerOf: (name: string) => string;
let managerId: string;
let managerSessionId: string;
let reasonId: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      const [category] = db.all<{ id: string }>(
        sql`select id from categories where name = 'Platos'`,
      );
      const [catalogue] = db.all<{ id: string }>(sql`select id from catalogues limit 1`);
      const ids = new Map<string, string>();
      for (const [name, price] of [
        ["Rib steak", "12.10"],
        ["Set menu", "40.00"],
      ] as const) {
        const product = await createProduct(tx, {
          catalogueId: catalogue!.id,
          categoryId: category!.id,
          name,
          customerName: { [venue.cfg.locale]: `House ${name}` },
          kitchenName: name.toUpperCase(),
          pricingUnit: "each",
          unitPrice: price,
          vatClass: "general",
        });
        ids.set(name, product.id);
      }
      const offers = await offerProducts(tx, venue.cfg, { zone: { zoneId: venue.zoneId } });
      offerOf = (name) => offers.offerFor(ids.get(name)!);
      const [manager] = await tx
        .insert(persons)
        .values({ displayName: "Marta", pinHash: hashPin("8888"), role: "manager" })
        .returning({ id: persons.id });
      managerId = manager!.id;
      managerSessionId = (
        await loginWithPin(tx, { deviceId: venue.deviceId, personId: managerId, pin: "8888" })
      ).id;
      reasonId = (await listAdjustmentReasons(tx))[0]!.id;
    });
  },
});

/** A counter order of `dish`, paid in cash through the till in parts of `parts`; its invoice. */
async function soldForCash(dish: string, parts: readonly string[]) {
  const id = randomUUID();
  const deps = {
    db: venue.db,
    backend: venue.backend,
    clock: venue.clock,
    admission: testTradingAdmission(),
  };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: [{ menuItemId: offerOf(dish), quantity: "1" }],
    zoneId: venue.zoneId,
    operatorId: venue.operatorId,
  });
  for (const amount of parts) {
    const paid = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, id)),
    });
    expect(paid.status).toBe(200);
  }
  const [sale] = await venue.db.select().from(sales).where(eq(sales.workingOrderId, id));
  return brandSaleId(sale!.id);
}

const deps = () => ({
  backend: venue.backend,
  clock: venue.clock,
  attendance: recordAttendanceFact,
});
const actor = () => ({
  personId: managerId,
  authz: { sessionId: managerSessionId },
  authorization: { authorizedBy: managerId, viaOverride: false },
});

async function correct(
  saleId: ReturnType<typeof brandSaleId>,
  ask: { submissionId: string; gross: string; note?: string },
) {
  const preview = await inTx(venue, (tx) =>
    previewInvoiceCorrection(tx, venue.backend, venue.cfg, saleId, { gross: ask.gross }),
  );
  return inTx(venue, (tx) =>
    acceptInvoiceCorrection(
      tx,
      deps(),
      venue.cfg,
      saleId,
      {
        submissionId: ask.submissionId,
        gross: ask.gross,
        reasonId,
        note: ask.note ?? "Overcooked",
        expectedSplit: preview.vatBreakdown.map(({ rate, base, tax }) => ({ rate, base, tax })),
      },
      actor(),
    ),
  );
}

async function original(saleId: string) {
  const [sale] = await venue.db.select().from(sales).where(eq(sales.id, saleId));
  const lines = await venue.db.select().from(saleLines).where(eq(saleLines.saleId, saleId));
  const registros = venue.db.all(
    sql`select * from registros_facturacion where sale_id = ${saleId}`,
  );
  return { sale, lines, registros };
}

function counts() {
  const [row] = venue.db.all<{ invoices: number; refunds: number; drawers: number }>(sql`
    select (select count(*) from sales) as invoices,
           (select count(*) from tender_refunds) as refunds,
           (select count(*) from print_jobs where kind = 'drawer') as drawers`);
  return row!;
}

describe("acceptInvoiceCorrection", () => {
  it("files −5.00 base and −1.05 VAT off a €12.10 cash steak, gives €6.05 back and opens the drawer once", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const before = await original(saleId);
    const preview = await inTx(venue, (tx) =>
      previewInvoiceCorrection(tx, venue.backend, venue.cfg, saleId, { gross: "6.05" }),
    );
    expect(preview).toMatchObject({
      gross: "6.05",
      vatBreakdown: [{ rate: "21.00", base: "5.00", tax: "1.05" }],
      cashRefundable: "12.10",
    });
    const drawersBefore = counts().drawers;

    const result = await correct(saleId, { submissionId: randomUUID(), gross: "6.05" });

    const [corrective] = await venue.db
      .select()
      .from(sales)
      .where(eq(sales.id, result.correctiveSaleId));
    expect(corrective).toMatchObject({
      correctsSaleId: saleId,
      total: -605,
      vatBreakdown: [{ rate: "21.00", base: "-5.00", tax: "-1.05" }],
    });
    const lines = await venue.db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, result.correctiveSaleId));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.lineGross !== null)).toBe(true);
    expect(
      await venue.db.select().from(tenderRefunds).where(eq(tenderRefunds.saleId, saleId)),
    ).toMatchObject([{ method: "cash", state: "completed", appliedAmount: 605, tipAmount: 0 }]);
    expect(result.refunds).toMatchObject([{ state: "completed", appliedAmount: "6.05" }]);
    expect(
      await venue.db
        .select()
        .from(drawerOpens)
        .where(eq(drawerOpens.tenderRefundId, result.refunds[0]!.id)),
    ).toHaveLength(1);
    expect(counts().drawers).toBe(drawersBefore + 1);
    expect(
      await venue.db
        .select()
        .from(invoiceCorrections)
        .where(eq(invoiceCorrections.originalSaleId, saleId)),
    ).toMatchObject([
      { correctiveSaleId: result.correctiveSaleId, tenderRefundId: result.refunds[0]!.id },
    ]);
    expect(await original(saleId)).toEqual(before);
  });

  it("answers the same request again with the first corrective, filing, refunding and opening nothing", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const ask = { submissionId: randomUUID(), gross: "6.05" };
    const first = await correct(saleId, ask);
    const [number] = await venue.db
      .select({ invoiceNumber: sales.invoiceNumber })
      .from(sales)
      .where(eq(sales.id, first.correctiveSaleId));
    const after = counts();

    const again = await correct(saleId, ask);

    expect(counts()).toEqual(after);
    expect(again).toEqual({ ...first, replayed: true });
    const [numberAgain] = await venue.db
      .select({ invoiceNumber: sales.invoiceNumber })
      .from(sales)
      .where(eq(sales.id, again.correctiveSaleId));
    expect(numberAgain).toEqual(number);
  });

  it("refuses the same submission id with a different note", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const submissionId = randomUUID();
    await correct(saleId, { submissionId, gross: "6.05" });
    await expect(
      correct(saleId, { submissionId, gross: "6.05", note: "Too salty" }),
    ).rejects.toMatchObject({ code: "submission.id_reused" });
  });

  it("gives €25 back over two €20 cash payments, oldest first, as €20 and €5 with one drawer job", async () => {
    const saleId = await soldForCash("Set menu", ["20.00", "20.00"]);
    const before = await original(saleId);
    const drawersBefore = counts().drawers;

    const result = await correct(saleId, { submissionId: randomUUID(), gross: "25.00" });

    expect(result.refunds.map((refund) => refund.appliedAmount)).toEqual(["20.00", "5.00"]);
    expect(
      await venue.db
        .select()
        .from(tenderRefunds)
        .where(
          and(
            eq(tenderRefunds.saleId, saleId),
            inArray(
              tenderRefunds.id,
              result.refunds.map((refund) => refund.id),
            ),
          ),
        ),
    ).toHaveLength(2);
    expect(
      await venue.db
        .select()
        .from(drawerOpens)
        .where(
          inArray(
            drawerOpens.tenderRefundId,
            result.refunds.map((refund) => refund.id),
          ),
        ),
    ).toMatchObject([{ tenderRefundId: result.refunds[0]!.id }]);
    expect(counts().drawers).toBe(drawersBefore + 1);
    expect(
      await venue.db
        .select()
        .from(invoiceCorrections)
        .where(eq(invoiceCorrections.originalSaleId, saleId)),
    ).toHaveLength(2);
    expect(await original(saleId)).toEqual(before);
  });

  it("counts the −€6.05 once in the day's sales and once in its cash", async () => {
    const saleId = await soldForCash("Rib steak", ["12.10"]);
    const cookie = `${MANAGEMENT_COOKIE}=${
      (await inTx(venue, (tx) => startManagementSession(tx, { personId: managerId }))).token
    }`;
    const reports = new Hono();
    mountReportApi(
      reports,
      { db: venue.db, cfg: { nodeId: venue.cfg.nodeId }, venueLocale: "es-ES" },
      () => {},
    );
    const [sold] = await venue.db.select().from(sales).where(eq(sales.id, saleId));
    const day = businessDayAt(
      await inTx(venue, (tx) => resolveVenueClock(tx, venue.cfg.nodeId)),
      new Date(sold!.issuedAt),
    );
    const close = async () => {
      const response = await reports.request(
        `/management-api/reports/daily-close?businessDay=${day}`,
        { headers: { cookie } },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        vat: { grossTotal: string };
        cash: { tenderTotal: string };
      };
      const cents = (value: string) => Math.round(Number(value) * 100);
      return { gross: cents(body.vat.grossTotal), cash: cents(body.cash.tenderTotal) };
    };
    const before = await close();

    await correct(saleId, { submissionId: randomUUID(), gross: "6.05" });

    const after = await close();
    expect({ gross: after.gross - before.gross, cash: after.cash - before.cash }).toEqual({
      gross: -605,
      cash: -605,
    });
  });
});
