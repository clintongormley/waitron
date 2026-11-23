import { strFromU8, unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { billAdvances, invoiceSeries, liveBackupQuery, type Database } from "@waitron/db";
import { seedNode } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { CanonicalValue } from "@waitron/membership";
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
import {
  insertFiscalRecord,
  insertNumberedFiscalRecord,
  seedFiscalParents,
} from "./testing/fiscal-fixtures.js";
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

/** A module whose seat lists `saleIds` as one whole chain of issue records, numbered from 1. */
function listing(saleIds: readonly string[]): WaitronModule {
  const chain: UnreturnedChain = {
    ids: { nodeId: "node-a", sifId: "sif-3" },
    whole: true,
    records: saleIds.map((saleId, index) => ({
      saleId,
      number: index + 1,
      type: "issue",
      createdAt: "2026-11-20T10:00:01Z",
      filingState: null,
    })),
  };
  return { ...fiscal, handover: { ...VERIFACTU_HANDOVER, unreturned: async () => [chain] } };
}

/** One issue record of `saleId` on the venue's node, through the fiscal fixtures' defaults. */
async function recordOf(saleId: string): Promise<void> {
  const parents = await seedFiscalParents(suite.db, {
    ids: { nodeId: venue.nodeId, seriesId: venue.seriesId, saleId },
    reuseExistingParents: true,
    skipSale: true,
  });
  await insertFiscalRecord(suite.db, parents);
}

function sheet(bytes: Uint8Array, name = "xl/worksheets/sheet1.xml"): string {
  return strFromU8(unzipSync(bytes)[name]!);
}

function build(
  db: Database,
  modules: readonly WaitronModule[],
  language: "en" | "es" = "en",
  mainHoldings: Readonly<Record<string, CanonicalValue>> | null = { fiscal: [] },
) {
  return buildOldBoxWorkbook({
    db,
    modules,
    mainHoldings: mainHoldings === null ? null : { holdings: mainHoldings, heardAt: MADE_AT },
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
    const xml = sheet(await build(suite.db, [listing([twoRates, walkUp, advance, substitute])]));
    const words = OLD_BOX_DATA_WORDS.en;
    const accountant = ACCOUNTANT_EXPORT_WORDS.en;

    expect(row(xml, 1)).toEqual([
      "Invoice records the new main box did not have at 2026-11-23 09:30 UTC, when it last told this box what it holds. This box may still send some of these to it before it is wiped.",
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
      "Box: node-a; System record: sif-3",
      "1",
      words.recordTypes.issue,
      "2026-11-20T10:00:01Z",
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
    const chainCell = `${words.chainFields.nodeId}: node-a; ${words.chainFields.sifId}: sif-a`;

    expect(unreturned).toHaveBeenCalledWith(expect.anything(), []);
    expect(row(xml, 1)).toEqual([words.invoiceIntro.replace("{time}", "2026-11-23 09:30 UTC")]);
    expect(row(xml, 2).slice(0, 3)).toEqual(ACCOUNTANT_EXPORT_WORDS.es.invoiceColumns.slice(0, 3));
    expect(row(xml, 2).slice(-6)).toEqual(words.recordColumns);
    expect(row(xml, 3).slice(20)).toEqual([
      chainCell,
      "7",
      words.recordTypes.issue,
      "2026-11-20T10:00:01Z",
      words.filingStates.aceptado,
      "No",
    ]);
    expect(row(xml, 4).slice(0, 3)).toEqual([sale, venue.nodeId, "A/1"]);
    expect(row(xml, 4).slice(20)).toEqual([
      chainCell,
      "8",
      words.recordTypes.cancellation,
      "2026-11-20T10:05:00Z",
      words.filingStates.pendiente,
      "No",
    ]);
    expect(row(xml, 5)).toEqual([
      "sale-not-here",
      ...Array<string>(19).fill(""),
      chainCell,
      "9",
      words.recordTypes.issue,
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
  it("lists the fiscal module's chains whole under the no-comparison first line when there is no main-box summary, and nothing when the summary holds them", async () => {
    const sale = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-11-20T10:00:00.000Z",
      total: "12.10",
      lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
    });
    await recordOf(sale);

    for (const language of ["en", "es"] as const) {
      const xml = sheet(await build(suite.db, [fiscal], language, null));
      const words = OLD_BOX_DATA_WORDS[language];
      // The fiscal seat names a chain by box, system record, system and installation, in that order.
      const [box, record, system, installation] = Object.values(words.chainFields);
      expect(row(xml, 1)).toEqual([
        words.uncomparedIntro.replace("{time}", "2026-11-23 09:30 UTC"),
      ]);
      expect([row(xml, 3)[0], row(xml, 3)[2], row(xml, 3)[20], row(xml, 3).at(-1)]).toEqual([
        sale,
        "A/1",
        expect.stringMatching(
          new RegExp(
            `^${box}: ${venue.nodeId}; ${record}: [^;]+; ${system}: WAITRON01; ${installation}: \\d+$`,
          ),
        ),
        words.yes,
      ]);
      expect(row(xml, 4)).toEqual([]);
    }
    expect(OLD_BOX_DATA_WORDS.en.uncomparedIntro).toBe(
      "Every invoice record this box holds, {time}. No comparison with the new main box was made, so some of these may already be on it.",
    );

    const held = await VERIFACTU_HANDOVER.holdings!(liveBackupQuery(suite.db));
    const compared = sheet(await build(suite.db, [fiscal], "en", { fiscal: held }));
    expect(row(compared, 1)[0]).toMatch(/^Invoice records the new main box did not have/);
    expect(row(compared, 3)).toEqual([]);
  });

  it("asks a module the main box's summary does not name for every chain, and says no comparison was made", async () => {
    const named = vi.fn(async (): Promise<UnreturnedChain[]> => []);
    const unnamed = vi.fn(async (): Promise<UnreturnedChain[]> => []);
    const modules: WaitronModule[] = [
      { ...fiscal, name: "named", handover: { ...VERIFACTU_HANDOVER, unreturned: named } },
      { ...fiscal, name: "unnamed", handover: { ...VERIFACTU_HANDOVER, unreturned: unnamed } },
    ];

    const xml = sheet(await build(suite.db, modules, "en", { named: ["held"] }));

    expect(named).toHaveBeenCalledWith(expect.anything(), ["held"]);
    expect(unnamed).toHaveBeenCalledWith(expect.anything(), undefined);
    expect(row(xml, 1)[0]).toMatch(/^Every invoice record this box holds/);
    expect(
      row(sheet(await build(suite.db, modules, "en", { named: [], unnamed: [] })), 1)[0],
    ).toMatch(/^Invoice records the new main box did not have/);
  });
});

describe("the old box's Invoices tab with the main box's summary from its last answer", () => {
  async function twoSales(): Promise<{ first: string; second: string; held: CanonicalValue }> {
    const sales = [];
    for (const invoiceNumber of [1, 2])
      sales.push(
        await seedSale(suite.db, venue, {
          invoiceNumber,
          issuedAt: "2026-11-20T10:00:00.000Z",
          total: "12.10",
          lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
        }),
      );
    await recordOf(sales[0]!);
    const held = await VERIFACTU_HANDOVER.holdings!(liveBackupQuery(suite.db));
    // A second chain, from another box, that the summary does not name.
    const nodeId = await seedNode(suite.db);
    const seriesId = randomUUID();
    await suite.db.insert(invoiceSeries).values({ id: seriesId, nodeId, code: "B" });
    const parents = await seedFiscalParents(suite.db, {
      ids: { nodeId, seriesId, saleId: sales[1]! },
      reuseExistingParents: true,
      skipSale: true,
    });
    await insertNumberedFiscalRecord(suite.db, parents, "B/1");
    return { first: sales[0]!, second: sales[1]!, held };
  }

  it("lists only the records the summary does not cover, under a first line naming when the summary arrived", async () => {
    const { second, held } = await twoSales();
    for (const language of ["en", "es"] as const) {
      const xml = sheet(
        await buildOldBoxWorkbook({
          db: suite.db,
          modules: [fiscal],
          mainHoldings: {
            holdings: { fiscal: held },
            heardAt: new Date("2026-11-23T08:15:42.000Z"),
          },
          madeAt: MADE_AT,
          language,
        }),
      );
      expect(row(xml, 1)).toEqual([
        OLD_BOX_DATA_WORDS[language].invoiceIntro.replace("{time}", "2026-11-23 08:15 UTC"),
      ]);
      // The summary does not name the other box's chain, so all of it is listed.
      expect([row(xml, 3)[0], row(xml, 3).at(-1)]).toEqual([
        second,
        OLD_BOX_DATA_WORDS[language].yes,
      ]);
      expect(row(xml, 4)).toEqual([]);
    }
    expect(OLD_BOX_DATA_WORDS.en.invoiceIntro).toBe(
      "Invoice records the new main box did not have at {time}, when it last told this box what it holds. This box may still send some of these to it before it is wiped.",
    );
  });

  it("says no comparison was made when no summary was heard, even with no module to ask", async () => {
    const xml = sheet(await build(suite.db, [], "en", null));
    expect(row(xml, 1)).toEqual([
      OLD_BOX_DATA_WORDS.en.uncomparedIntro.replace("{time}", "2026-11-23 09:30 UTC"),
    ]);
  });

  it("lists every record under the no-comparison first line when the module cannot read the summary", async () => {
    const { first, second } = await twoSales();
    const xml = sheet(
      await buildOldBoxWorkbook({
        db: suite.db,
        modules: [fiscal],
        mainHoldings: { holdings: { fiscal: "not a summary" }, heardAt: MADE_AT },
        madeAt: MADE_AT,
        language: "en",
      }),
    );
    expect(row(xml, 1)).toEqual([
      OLD_BOX_DATA_WORDS.en.uncomparedIntro.replace("{time}", "2026-11-23 09:30 UTC"),
    ]);
    expect([row(xml, 3)[0], row(xml, 4)[0]].sort()).toEqual([first, second].sort());
    expect(row(xml, 5)).toEqual([]);
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

  it("reads a substitution that replaces two tickets once", async () => {
    const tickets = [];
    for (const invoiceNumber of [1, 2])
      tickets.push(
        await seedSale(suite.db, venue, {
          invoiceNumber,
          issuedAt: "2026-11-20T10:00:00.000Z",
          total: "12.10",
          lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
        }),
      );
    const full = await seedSale(suite.db, venue, {
      invoiceNumber: 3,
      issuedAt: "2026-11-20T11:00:00.000Z",
      total: "24.20",
      counterpartyTaxId: "B87654321",
      lines: [{ vatRate: "21.00", lineTotal: "20.00" }],
    });
    for (const ticket of tickets)
      await seedSubstitution(suite.db, { substitutionSaleId: full, substitutedSaleId: ticket });

    const invoices = await readAccountantInvoices(suite.db, { saleIds: [full] });

    expect(invoices.map(({ id, invoiceType }) => ({ id, invoiceType }))).toEqual([
      { id: full, invoiceType: "F3" },
    ]);
  });
});
