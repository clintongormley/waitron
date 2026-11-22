import { sql } from "drizzle-orm";
import { validateCapabilities } from "@waitron/layouts";
import jsQR from "jsqr";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  receiptRollColumns,
  isReceiptPrinter,
  deviceProfiles,
  invoiceSeries,
  printers,
  printJobs,
  sales,
  taxpayer,
  withTransaction,
} from "@waitron/db";
import { seriesId as brandSeriesId } from "@waitron/shared";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { recordSale } from "@waitron/core";
import { prepareIssueClock, type FiscalBackend, type TrustedClock } from "@waitron/fiscal";
import { provisionBillVenue, type BillVenue } from "./testing/bill-venue.js";
import { readReceiptIssuer } from "./receipt-issuer.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { enqueueReceiptCopy } from "./receipt-print.js";
import { printedCommands } from "./testing/decode-ticket.js";
import { previewPrintJob } from "./print-job-preview.js";
import { insertCorrective } from "./testing/replacement-fixture.js";
import { deliversAsFullInvoice, deliversAsFullInvoiceSql } from "./invoice-selection.js";
import { readInvoiceTyping } from "./invoice-typing.js";

const AT = "2026-10-14T23:30:00.000Z";
let v: BillVenue;
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
beforeEach(async () => {
  v = await provisionBillVenue(suite.db);
});

const CUSTOMER = { taxId: "01234567L", legalName: "Cliente SL", countryCode: "ES" };
const CUSTOMER_ADDRESS = "2 Main Street, 28013 Madrid, Madrid";

async function issue(
  prepared: boolean,
  full = false,
  { at = AT, operationDate }: { at?: string; operationDate?: string } = {},
) {
  if (full) await v.db.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, 28013 Madrid" });
  const fullSeries = full
    ? (
        await v.db
          .select({ id: invoiceSeries.id })
          .from(invoiceSeries)
          .where(and(eq(invoiceSeries.nodeId, v.cfg.nodeId), eq(invoiceSeries.purpose, "full")))
      )[0]!.id
    : undefined;
  const source: TrustedClock = {
    ...v.clock,
    now: () => ({ ...v.clock.now(), instant: new Date(at), offsetMinutes: 0 }),
  };
  return withTransaction(v.db, async (tx) =>
    recordSale(tx, v.backend, {
      origin: v.cfg.origin,
      nodeId: v.cfg.nodeId,
      seriesId: fullSeries === undefined ? v.seriesId : brandSeriesId(fullSeries),
      ...(full ? { counterparty: CUSTOMER, recipientAddress: CUSTOMER_ADDRESS } : {}),
      locale: "en-GB",
      invoiceLocales: ["en-GB"],
      operationDescription: "Restaurant service",
      total: "12.10",
      lines: [
        {
          lineNo: 1,
          name: "Staff dish",
          descriptions: { "en-GB": "Customer dish" },
          quantity: "1",
          unitPrice: "10.00",
          vatRate: "21.00",
          lineTotal: "10.00",
        },
      ],
      settlement: { kind: "deferred" },
      ...(operationDate === undefined ? {} : { operationDate }),
      clock: prepared ? await prepareIssueClock(tx, v.cfg, source) : source,
    }),
  );
}

describe("receipt issue facts independent of recipient and current venue zone", () => {
  it.each([false, true])(
    "retains the saved F2 offset and QR date, prepared=%s",
    async (prepared) => {
      const sale = await issue(prepared);
      const [before] = await v.db.select().from(sales).where(eq(sales.id, sale.saleId));
      for (const timeZone of ["Europe/Madrid", "Europe/London", "Invalid/Zone"]) {
        await v.db.run(
          sql`update settings set doc = json_set(doc, '$.timeZone', ${timeZone}) where module = 'business_day'`,
        );
        await withTransaction(v.db, async (tx) => {
          const facts = await readReceiptIssuer(v.backend, tx, sale.saleId);
          expect(facts).toMatchObject({
            issuedOffsetMinutes: prepared ? 120 : 0,
            invoiceType: "F2",
          });
          expect(facts).not.toHaveProperty("recipient");
          expect(facts).not.toHaveProperty("operationDate");
          const filed = await v.backend.filedReceiptFor(tx, sale.saleId);
          expect(new URL(filed!.verificationUrl!).searchParams.get("fecha")).toBe(
            prepared ? "15-10-2026" : "14-10-2026",
          );
          const ticket = await readTransactionReceipt(v.backend, tx, v.cfg, sale.saleId);
          expect(ticket.issuedOffsetMinutes).toBe(prepared ? 120 : 0);
          expect(ticket.issuedAt).toBe(AT);
          const [printer] = await tx
            .select({ id: printers.id, ...receiptRollColumns })
            .from(printers)
            .where(isReceiptPrinter());
          const job = await enqueueReceiptCopy(tx, v.cfg, ticket, sale.saleId, printer!, "en-GB");
          expect(job).toBeDefined();
          const [savedJob] = await tx.select().from(printJobs).where(eq(printJobs.id, job!.jobId));
          const preview = previewPrintJob(savedJob!.payload!);
          expect(preview.truncated).toBe(false);
          expect(preview.unsupported).toBe(false);
          expect(preview.text).toContain(prepared ? "15 Oct 2026, 01:30" : "14 Oct 2026, 23:30");
          const qr = printedCommands(savedJob!.payload).find(
            (c) => c.name === "GS v 0" && c.heightDots! > 56,
          )!;
          const rgba = new Uint8ClampedArray(qr.widthDots! * qr.heightDots! * 4).fill(255);
          const bits = qr.bytes.subarray(8);
          for (let y = 0; y < qr.heightDots!; y++)
            for (let x = 0; x < qr.widthDots!; x++)
              if (bits[y * Math.ceil(qr.widthDots! / 8) + (x >> 3)]! & (0x80 >> (x & 7)))
                rgba.fill(0, (y * qr.widthDots! + x) * 4, (y * qr.widthDots! + x) * 4 + 3);
          const decoded = jsQR(rgba, qr.widthDots!, qr.heightDots!)?.data;
          expect(decoded).toBe(ticket.qr);
          expect(new URL(decoded!).searchParams.get("fecha")).toBe(
            prepared ? "15-10-2026" : "14-10-2026",
          );
        });
        expect((await v.db.select().from(sales).where(eq(sales.id, sale.saleId)))[0]).toEqual(
          before,
        );
      }
    },
  );

  it("returns the saved offset on a real sale, pay replay and reprint", async () => {
    const clock: TrustedClock = {
      ...v.clock,
      now: () => ({ ...v.clock.now(), instant: new Date(AT), offsetMinutes: 0 }),
    };
    for (const profile of await v.db.select().from(deviceProfiles)) {
      await v.db
        .update(deviceProfiles)
        .set({ capabilities: [...validateCapabilities(profile.capabilities), "print-receipt"] })
        .where(eq(deviceProfiles.id, profile.id));
    }
    const app = v.appAt(clock);
    const id = randomUUID();
    const body = {
      submissionId: randomUUID(),
      kind: "share",
      shareOf: 1,
      method: "cash",
      tendered: "35.00",
      dining: "eat_in",
      basket: {
        zoneId: v.zoneId,
        lines: [{ menuItemId: v.offerFor("Paella"), quantity: "1" }],
      },
    };
    const pay = () =>
      app.request(`/api/working-orders/${id}/payments`, {
        method: "POST",
        headers: { cookie: v.cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const first = await pay();
    expect(first.status).toBe(200);
    const { invoice: original } = await first.json();
    expect(original).toMatchObject({ issuedAt: AT, issuedOffsetMinutes: 120, invoiceType: "F2" });
    expect(new URL(original.qr).searchParams.get("fecha")).toBe("15-10-2026");
    const stored = await v.db.select().from(sales);
    for (const timeZone of ["Europe/London", "Invalid/Zone"]) {
      await v.db.run(
        sql`update settings set doc = json_set(doc, '$.timeZone', ${timeZone}) where module = 'business_day'`,
      );
      const replay = await pay();
      expect(replay.status).toBe(200);
      expect((await replay.json()).invoice).toEqual(original);
      const reprint = await app.request(`/api/sales/${id}/reprint`, {
        method: "POST",
        headers: { cookie: v.cookie },
      });
      expect(reprint.status).toBe(200);
      expect(await v.db.select().from(sales)).toEqual(stored);
    }
  });

  it("returns the saved offset even without a filed issuer", async () => {
    const sale = await issue(true);
    const backend = new Proxy(v.backend, {
      get(target, key, receiver) {
        if (key === "filedReceiptFor") return async () => undefined;
        return Reflect.get(target, key, receiver);
      },
    }) as FiscalBackend;
    expect(
      await withTransaction(v.db, (tx) => readReceiptIssuer(backend, tx, sale.saleId)),
    ).toEqual({ issuedOffsetMinutes: 120 });
  });
});

describe("the invoice a corrective names", () => {
  it.each([
    ["a replacement", { replaces: true } as const, { inFull: true }],
    ["a by-differences corrective", { total: "-2.00" }, {}],
  ])("reads %s's original, in full only for a replacement", async (_name, change, extra) => {
    const sale = await issue(false);
    const [original, ticket] = await withTransaction(v.db, async (tx) => [
      await readTransactionReceipt(v.backend, tx, v.cfg, sale.saleId),
      await readTransactionReceipt(
        v.backend,
        tx,
        v.cfg,
        await insertCorrective(tx, sale.saleId, change),
      ),
    ]);
    expect(ticket.invoiceType).toBe("R5");
    expect(ticket.corrects).toEqual({
      invoiceNumber: original.invoiceNumber,
      issuedAt: AT,
      issuedOffsetMinutes: 0,
      ...extra,
    });
  });

  it("types a replacement of a full invoice R4, made out to the original's customer", async () => {
    const sale = await issue(false, true);
    const [original, ticket] = await withTransaction(v.db, async (tx) => {
      const replacement = await insertCorrective(tx, sale.saleId, { replaces: true });
      return [
        await readTransactionReceipt(v.backend, tx, v.cfg, sale.saleId),
        await readTransactionReceipt(v.backend, tx, v.cfg, replacement),
      ];
    });
    expect(original.invoiceType).toBe("F1");
    expect(ticket.invoiceType).toBe("R4");
    expect(ticket.recipient).toEqual(original.recipient);
    expect(ticket.recipient).toMatchObject({ taxId: CUSTOMER.taxId, address: CUSTOMER_ADDRESS });
    expect(ticket.corrects).toEqual({
      invoiceNumber: original.invoiceNumber,
      issuedAt: AT,
      issuedOffsetMinutes: 0,
      inFull: true,
    });
  });

  it("carries a replacement's real day of sale only when it differs from its own issue day", async () => {
    const sale = await issue(false);
    const other = await issue(false);
    const [later, sameDay, plain] = await withTransaction(v.db, async (tx) => [
      await readTransactionReceipt(
        v.backend,
        tx,
        v.cfg,
        await insertCorrective(tx, sale.saleId, { replaces: true, supplyDay: "2026-10-10" }),
      ),
      await readTransactionReceipt(
        v.backend,
        tx,
        v.cfg,
        await insertCorrective(tx, other.saleId, { replaces: true, supplyDay: "2026-10-14" }),
      ),
      await readTransactionReceipt(v.backend, tx, v.cfg, sale.saleId),
    ]);
    expect(later.saleDay).toBe("2026-10-10");
    expect(sameDay).not.toHaveProperty("saleDay");
    expect(plain).not.toHaveProperty("saleDay");
  });

  it("compares the real day of sale with the issue day in the sale's saved offset, not UTC's", async () => {
    // Issued at 23:30 UTC on the 14th with the venue's +120: 01:30 on the 15th where it was sold.
    const local = await issue(true);
    const utc = await issue(true);
    const [sameLocalDay, sameUtcDay] = await withTransaction(v.db, async (tx) => [
      await readTransactionReceipt(
        v.backend,
        tx,
        v.cfg,
        await insertCorrective(tx, local.saleId, { replaces: true, supplyDay: "2026-10-15" }),
      ),
      await readTransactionReceipt(
        v.backend,
        tx,
        v.cfg,
        await insertCorrective(tx, utc.saleId, { replaces: true, supplyDay: "2026-10-14" }),
      ),
    ]);
    expect(sameLocalDay.issuedOffsetMinutes).toBe(120);
    expect(sameLocalDay).not.toHaveProperty("saleDay");
    expect(sameUtcDay.saleDay).toBe("2026-10-14");
  });
});

describe("the day of the sale on an invoice issued on a later day", () => {
  it("prints an F2's earlier sale day, not one equal to its issue day, nor on its credit note", async () => {
    const at = "2026-03-15T12:00:00.000Z";
    const later = await issue(false, false, { at, operationDate: "2026-03-14" });
    const sameDay = await issue(false, false, { at, operationDate: "2026-03-15" });
    const [stored, laterTicket, sameDayTicket, corrective] = await withTransaction(
      v.db,
      async (tx) => [
        (
          await tx
            .select({ supplyDay: sales.supplyDay })
            .from(sales)
            .where(eq(sales.id, later.saleId))
        )[0]!,
        await readTransactionReceipt(v.backend, tx, v.cfg, later.saleId),
        await readTransactionReceipt(v.backend, tx, v.cfg, sameDay.saleId),
        await readTransactionReceipt(
          v.backend,
          tx,
          v.cfg,
          await insertCorrective(tx, later.saleId, { total: "-2.00" }),
        ),
      ],
    );
    expect(stored.supplyDay).toBe("2026-03-14");
    expect(laterTicket.invoiceType).toBe("F2");
    expect(laterTicket.saleDay).toBe("2026-03-14");
    expect(sameDayTicket).not.toHaveProperty("saleDay");
    expect(corrective.invoiceType).toBe("R5");
    expect(corrective).not.toHaveProperty("saleDay");
  });
});

describe("a stored customer missing a part", () => {
  it.each(["counterpartyLegalName", "counterpartyCountryCode", "counterpartyAddress"] as const)(
    "refuses to type a sale whose tax number has no %s, rather than print it without its customer",
    async (missing) => {
      const sale = await issue(false, true);
      await withTransaction(v.db, async (tx) => {
        const [row] = await tx.select().from(sales).where(eq(sales.id, sale.saleId));
        await expect(readInvoiceTyping(tx, row!)).resolves.toMatchObject({ invoiceType: "F1" });
        await expect(readInvoiceTyping(tx, { ...row!, [missing]: null })).rejects.toThrow(
          "names a customer's tax number without their name, country or address",
        );
      });
    },
  );
});

describe("deliversAsFullInvoice", () => {
  it("answers as its SQL form does for every kind of stored sale", async () => {
    const simplified = await issue(false);
    const full = await issue(false, true);
    const other = await issue(false);
    await withTransaction(v.db, async (tx) => {
      await insertCorrective(tx, simplified.saleId, { replaces: true });
      await insertCorrective(tx, full.saleId, { replaces: true });
      await insertCorrective(tx, other.saleId, { total: "-2.00" });
    });
    const rows = await v.db
      .select({
        counterpartyTaxId: sales.counterpartyTaxId,
        correctsSaleId: sales.correctsSaleId,
        inSql: sql<number>`case when ${deliversAsFullInvoiceSql()} then 1 else 0 end`,
      })
      .from(sales);
    expect(rows).toHaveLength(6);
    expect(rows.filter((row) => row.inSql === 1)).toHaveLength(1);
    for (const row of rows) expect(deliversAsFullInvoice(row)).toBe(row.inSql === 1);
  });
});
