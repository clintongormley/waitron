import { strFromU8, unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { billAdvances, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { UnreturnedChain, WaitronModule } from "@waitron/module";
import { VERIFACTU_HANDOVER } from "@waitron/fiscal-verifactu";
import { SQL_VARIABLE_LIMIT } from "@waitron/store";
import {
  seedBillPayment,
  seedOpenOrder,
  seedSale,
  seedSubstitution,
  seedVenueWithSeries,
  type SeededVenue,
} from "@waitron/reporting/test/fixtures.js";
import { readAccountantInvoices } from "./accountant-export.js";
import { ACCOUNTANT_EXPORT_WORDS } from "./i18n/accountant-export.js";
import { OLD_BOX_DATA_WORDS } from "./i18n/old-box-data.js";
import { buildOldBoxWorkbook } from "./old-box-data-workbook.js";
import { insertFiscalRecord, seedFiscalParents } from "./testing/fiscal-fixtures.js";
import { row } from "./testing/xlsx-rows.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const MADE_AT = new Date("2026-11-23T09:30:00.000Z");
const fiscal: WaitronModule = {
  name: "fiscal",
  version: "1.0.0",
  tier: "mandatory",
  handover: VERIFACTU_HANDOVER,
};

let venue: SeededVenue;
beforeEach(async () => {
  venue = await seedVenueWithSeries(suite.db);
});

/** Records `saleIds` as one chain of issue records, in order, on the venue's node. */
async function chainOf(saleIds: readonly string[]): Promise<void> {
  const parents = await seedFiscalParents(suite.db, {
    ids: { nodeId: venue.nodeId, seriesId: venue.seriesId },
    reuseExistingParents: true,
    skipSale: true,
  });
  for (const [index, saleId] of saleIds.entries()) {
    await insertFiscalRecord(
      suite.db,
      { ...parents, saleId },
      {
        secuencia: index + 1,
        numSerie: `A/${index + 1}`,
      },
    );
  }
}

function sheet(bytes: Uint8Array, name = "xl/worksheets/sheet1.xml"): string {
  return strFromU8(unzipSync(bytes)[name]!);
}

function build(db: Database, modules: readonly WaitronModule[], language: "en" | "es" = "en") {
  return buildOldBoxWorkbook({
    db,
    modules,
    mainHoldings: { fiscal: [] },
    madeAt: MADE_AT,
    language,
  });
}

/** A part payment: its own ticket, paid in cash on an open bill. */
async function partPayment(invoiceNumber: number): Promise<string> {
  const { orderId } = await seedOpenOrder(suite.db, venue, 90 + invoiceNumber);
  const billPaymentId = await seedBillPayment(
    suite.db,
    { workingOrderId: orderId, deviceId: venue.deviceId },
    { method: "cash", applied: "30.00", state: "received", at: "2026-11-20T11:00:00.000Z" },
  );
  const saleId = await seedSale(suite.db, venue, {
    invoiceNumber,
    issuedAt: "2026-11-20T11:00:00.000Z",
    total: "30.00",
    lines: [{ vatRate: "10.00", lineTotal: "27.27", advanceRole: "payment_on_account" }],
  });
  await suite.db.insert(billAdvances).values({
    workingOrderId: orderId,
    advanceSaleId: saleId,
    billPaymentId,
  });
  return saleId;
}

describe("the old box's Invoices tab", () => {
  it("lists each record the main box lacks with the accountant's invoice columns, one line per VAT rate", async () => {
    const twoRates = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-11-20T10:00:00.000Z",
      total: "23.10",
      counterpartyLegalName: '=HYPERLINK("x")',
      counterpartyTaxId: "B12345678",
      lines: [
        { vatRate: "10.00", lineTotal: "10.00" },
        { vatRate: "21.00", lineTotal: "10.00" },
      ],
    });
    const walkUp = await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: "2026-11-20T10:30:00.000Z",
      total: "12.10",
      lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
    });
    const advance = await partPayment(3);
    const substitute = await seedSale(suite.db, venue, {
      invoiceNumber: 4,
      issuedAt: "2026-11-20T12:00:00.000Z",
      total: "12.10",
      counterpartyLegalName: "Harbour Foods",
      counterpartyTaxId: "B87654321",
      lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
    });
    await seedSubstitution(suite.db, { substitutionSaleId: substitute, substitutedSaleId: walkUp });
    await chainOf([twoRates, walkUp, advance, substitute]);

    const xml = sheet(await build(suite.db, [fiscal]));
    const words = OLD_BOX_DATA_WORDS.en;
    const accountant = ACCOUNTANT_EXPORT_WORDS.en;

    expect(row(xml, 1)).toEqual([
      "Invoice records the new main box did not have when this file was made, 2026-11-23 09:30 UTC. The old main box may still send some of these to it before it is wiped.",
    ]);
    expect(row(xml, 2)).toEqual([
      ...accountant.invoiceColumns.slice(0, -1),
      accountant.saleDateColumn,
      accountant.paymentOnAccountColumn,
      "Chain",
      "Record number",
      "Record type",
      "Record created at (UTC)",
      "Filing state with AEAT",
      "Whole chain listed",
    ]);
    const first = row(xml, 3);
    expect(first.slice(0, 15)).toEqual([
      twoRates,
      venue.nodeId,
      "A/1",
      "F1",
      "2026-11-20",
      "=HYPERLINK(&quot;x&quot;)",
      "B12345678",
      "",
      "",
      "",
      "",
      "10.00",
      "10.00",
      "1.00",
      "23.10",
    ]);
    expect(first.slice(20)).toEqual([
      expect.stringContaining(venue.nodeId),
      "1",
      words.recordTypes.issue,
      expect.any(String),
      words.notFiled,
      words.yes,
    ]);
    const second = row(xml, 4);
    expect(second.slice(0, 3)).toEqual([twoRates, venue.nodeId, "A/1"]);
    expect(second.slice(11, 15)).toEqual(["21.00", "10.00", "2.10", ""]);
    expect(second[21]).toBe("1");

    const noCustomer = row(xml, 5);
    expect(noCustomer.slice(2, 7)).toEqual(["A/2", "F2", "2026-11-20", "", ""]);
    expect(noCustomer[21]).toBe("2");

    const onAccount = row(xml, 6);
    expect(onAccount[2]).toBe("A/3");
    expect(onAccount[19]).toBe(accountant.paymentMethods.cash);

    const f3 = row(xml, 7);
    expect(f3.slice(2, 6)).toEqual(["A/4", "F3", "2026-11-20", "Harbour Foods"]);
    expect(f3[21]).toBe("4");
    expect(row(xml, 8)).toEqual([]);

    expect(xml).toMatch(/<c r="F3" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK/);
    expect(xml).not.toContain("<f>");
  });

  it("writes a cancellation record against the invoice it cancels, a part listing, and a record whose invoice this box lacks", async () => {
    const sale = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-11-20T10:00:00.000Z",
      total: "12.10",
      lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
    });
    const chain: UnreturnedChain = {
      ids: { nodeId: "node-a", sifId: "sif-a" },
      whole: false,
      records: [
        {
          saleId: sale,
          number: 7,
          type: "issue",
          createdAt: "2026-11-20T10:00:01Z",
          filingState: "aceptado",
        },
        {
          saleId: sale,
          number: 8,
          type: "cancellation",
          createdAt: "2026-11-20T10:05:00Z",
          filingState: "pendiente",
        },
        {
          saleId: "sale-not-here",
          number: 9,
          type: "issue",
          createdAt: "2026-11-20T10:06:00Z",
          filingState: "a_later_state",
        },
      ],
    };
    const unreturned = vi.fn(async () => [chain]);
    const seat: WaitronModule = { ...fiscal, handover: { ...VERIFACTU_HANDOVER, unreturned } };

    const xml = sheet(await build(suite.db, [seat], "es"));
    const words = OLD_BOX_DATA_WORDS.es;

    expect(unreturned).toHaveBeenCalledWith(expect.anything(), []);
    expect(row(xml, 1)).toEqual([words.invoiceIntro.replace("{time}", "2026-11-23 09:30 UTC")]);
    expect(row(xml, 2).slice(0, 3)).toEqual(ACCOUNTANT_EXPORT_WORDS.es.invoiceColumns.slice(0, 3));
    expect(row(xml, 2).slice(-6)).toEqual([
      "Cadena",
      "Número de registro",
      "Tipo de registro",
      "Registro creado el (UTC)",
      "Estado del envío a la AEAT",
      "Cadena completa listada",
    ]);
    expect(row(xml, 3).slice(20)).toEqual([
      "nodeId: node-a; sifId: sif-a",
      "7",
      "Alta",
      "2026-11-20T10:00:01Z",
      "Aceptado",
      "No",
    ]);
    expect(row(xml, 4).slice(0, 3)).toEqual([sale, venue.nodeId, "A/1"]);
    expect(row(xml, 4).slice(20)).toEqual([
      "nodeId: node-a; sifId: sif-a",
      "8",
      "Anulación",
      "2026-11-20T10:05:00Z",
      "Pendiente",
      "No",
    ]);
    expect(row(xml, 5)).toEqual([
      "sale-not-here",
      ...Array<string>(19).fill(""),
      "nodeId: node-a; sifId: sif-a",
      "9",
      "Alta",
      "2026-11-20T10:06:00Z",
      "a_later_state",
      "No",
    ]);
  });

  it("names the English and Spanish sheet, and reads without a write transaction", async () => {
    const lock = vi.spyOn(suite.db, "withWriteLock");
    const transaction = vi.spyOn(suite.db, "transaction");
    for (const language of ["en", "es"] as const) {
      const workbook = strFromU8(
        unzipSync(await build(suite.db, [fiscal], language))["xl/workbook.xml"]!,
      );
      expect(workbook).toContain(`<sheet name="${OLD_BOX_DATA_WORDS[language].invoiceSheet}"`);
      expect(workbook.match(/<sheet /g)).toHaveLength(1);
    }
    expect(lock).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("reading invoices by sale id", () => {
  it("reads more ids than one statement may bind, in chunks, and keeps a substitution", async () => {
    const firstId = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-11-20T10:00:00.000Z",
      total: "12.10",
      lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
    });
    const lastId = await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: "2026-11-20T11:00:00.000Z",
      total: "12.10",
      counterpartyTaxId: "B87654321",
      lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
    });
    await seedSubstitution(suite.db, { substitutionSaleId: lastId, substitutedSaleId: firstId });
    const ids = [
      firstId,
      ...Array.from({ length: SQL_VARIABLE_LIMIT }, (_, i) => `missing-${i}`),
      lastId,
    ];

    const invoices = await readAccountantInvoices(suite.db, { saleIds: ids });

    expect(
      invoices.map(({ id, invoiceNumber, invoiceType }) => ({ id, invoiceNumber, invoiceType })),
    ).toEqual(
      expect.arrayContaining([
        { id: firstId, invoiceNumber: "A/1", invoiceType: "F2" },
        { id: lastId, invoiceNumber: "A/2", invoiceType: "F3" },
      ]),
    );
    expect(invoices).toHaveLength(2);
  });
});
