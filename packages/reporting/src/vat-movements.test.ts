import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { SaleId } from "@waitron/shared";
import {
  at,
  seedSale,
  seedSubstitution,
  seedVenueWithSeries,
  seedVoid,
  TICKET,
  ticketSeller,
} from "../test/fixtures.js";
import type { SeededVenue, TicketSeller } from "../test/fixtures.js";
import { vatMovements } from "./vat-movements.js";
import type { VatMovement } from "./vat-movements.js";
import type { LiquidationPeriod } from "./period.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let venue: SeededVenue;
let sale: TicketSeller;

beforeEach(async () => {
  venue = await seedVenueWithSeries(suite.db);
  sale = ticketSeller(suite.db, venue);
});

const Q1: LiquidationPeriod = { kind: "quarter", quarter: 1 };
const Q2: LiquidationPeriod = { kind: "quarter", quarter: 2 };

function movements(period: LiquidationPeriod, year = 2026): Promise<VatMovement[]> {
  return withTransaction(suite.db, (tx) => vatMovements(tx, { year, period }));
}

const PLUS = { rate: "10.00", base: "11.00", tax: "1.10" };
const MINUS = { rate: "10.00", base: "-11.00", tax: "-1.10" };

async function refund(issuedDay: string, target: SaleId): Promise<SaleId> {
  return sale(issuedDay, {
    correctsSaleId: target,
    total: "-12.10",
    lines: [{ vatRate: "10.00", lineTotal: "-11.00", quantity: "-1.000" }],
  });
}

async function replacement(issuedDay: string, original: SaleId, supplyDay?: string) {
  return sale(issuedDay, {
    correctsSaleId: original,
    replacesOriginal: true,
    ...(supplyDay === undefined ? {} : { supplyDay }),
  });
}

describe("vatMovements", () => {
  it("gives an ordinary invoice one movement per rate line, made and belonging on its issue date", async () => {
    const id = await sale("2026-04-10", {
      total: "186.40",
      lines: [
        { vatRate: "21.00", lineTotal: "100.00" },
        { vatRate: "10.00", lineTotal: "50.00" },
        { vatRate: "4.00", lineTotal: "10.00" },
      ],
      vatBreakdown: [
        { rate: "21.00", base: "100.00", tax: "21.00" },
        { rate: "10.00", base: "50.00", tax: "5.00" },
        { rate: "4.00", base: "10.00", tax: "0.40" },
      ],
    });
    const common = {
      kind: "invoice",
      madeDay: "2026-04-10",
      belongsDay: "2026-04-10",
      saleId: id,
      correctedSaleId: null,
    };
    // Numerically: as text "10.00" and "21.00" would sort before "4.00".
    expect(await movements(Q2)).toEqual([
      { ...common, rate: "4.00", base: "10.00", tax: "0.40" },
      { ...common, rate: "10.00", base: "50.00", tax: "5.00" },
      { ...common, rate: "21.00", base: "100.00", tax: "21.00" },
    ]);
  });

  it("reads the issue date in the sale's own offset", async () => {
    // 30 June 23:30 UTC is 1 July in Madrid's summer offset.
    const id = await seedSale(suite.db, venue, {
      ...TICKET,
      invoiceNumber: 1,
      issuedAt: at("2026-06-30", "23:30:00"),
      issuedOffsetMinutes: 120,
    });
    expect(await movements(Q2)).toEqual([]);
    expect(await movements({ kind: "quarter", quarter: 3 })).toEqual([
      {
        ...PLUS,
        kind: "invoice",
        madeDay: "2026-07-01",
        belongsDay: "2026-07-01",
        saleId: id,
        correctedSaleId: null,
      },
    ]);
  });

  it("reads a stamp just after the period whose date, in its offset, is the period's last day", async () => {
    const id = await seedSale(suite.db, venue, {
      ...TICKET,
      invoiceNumber: 1,
      issuedAt: at("2026-07-01", "01:00:00"),
      issuedOffsetMinutes: -120,
    });
    expect((await movements(Q2)).map((m) => [m.saleId, m.madeDay])).toEqual([[id, "2026-06-30"]]);
  });

  it("returns a ticket issued long after the period for a supply day in it", async () => {
    const id = await sale("2026-08-10", { supplyDay: "2026-06-20" });
    expect((await movements(Q2)).map((m) => [m.saleId, m.kind, m.belongsDay])).toEqual([
      [id, "issued_late", "2026-06-20"],
    ]);
  });

  it("returns nothing made and belonging outside the period", async () => {
    const march = await sale("2026-03-10");
    await sale("2026-07-02");
    await refund("2026-07-05", march);
    expect(await movements(Q2)).toEqual([]);
  });

  describe("a ticket issued after its sale's day", () => {
    it("is issued late when the two days are in different periods, in both of them", async () => {
      const id = await sale("2026-04-01", { supplyDay: "2026-03-31" });
      const late = {
        ...PLUS,
        kind: "issued_late",
        madeDay: "2026-04-01",
        belongsDay: "2026-03-31",
        saleId: id,
        correctedSaleId: null,
      };
      expect(await movements(Q2)).toEqual([late]);
      expect(await movements(Q1)).toEqual([late]);
    });

    it("is an ordinary invoice when both days are in the period", async () => {
      const id = await sale("2026-05-02", { supplyDay: "2026-04-30" });
      const row = {
        ...PLUS,
        madeDay: "2026-05-02",
        belongsDay: "2026-04-30",
        saleId: id,
        correctedSaleId: null,
      };
      expect(await movements(Q2)).toEqual([{ ...row, kind: "invoice" }]);
      expect(await movements({ kind: "month", month: 5 })).toEqual([
        { ...row, kind: "issued_late" },
      ]);
    });
  });

  it("gives a corrective one signed movement made on its date, belonging to its target's day", async () => {
    const original = await sale("2026-03-10");
    const correction = await refund("2026-05-05", original);
    expect(await movements(Q2)).toEqual([
      {
        ...MINUS,
        kind: "correction",
        madeDay: "2026-05-05",
        belongsDay: "2026-03-10",
        saleId: correction,
        correctedSaleId: original,
      },
    ]);
  });

  it("puts a corrective of a corrective where the corrected corrective's VAT belongs", async () => {
    const original = await sale("2026-03-10");
    const first = await refund("2026-04-10", original);
    const second = await sale("2026-05-10", {
      correctsSaleId: first,
      total: "12.10",
      lines: [{ vatRate: "10.00", lineTotal: "11.00" }],
    });
    expect((await movements(Q2)).find((m) => m.saleId === second)).toMatchObject({
      kind: "correction",
      madeDay: "2026-05-10",
      belongsDay: "2026-03-10",
      correctedSaleId: first,
    });
  });

  describe("a replacement", () => {
    it("with a supply day moves the split out of the original's day and into its own", async () => {
      const original = await sale("2026-04-01");
      const repl = await replacement("2026-04-10", original, "2026-03-31");
      const made = { madeDay: "2026-04-10", saleId: repl, correctedSaleId: original };
      expect(await movements(Q2)).toEqual([
        {
          ...PLUS,
          kind: "invoice",
          madeDay: "2026-04-01",
          belongsDay: "2026-04-01",
          saleId: original,
          correctedSaleId: null,
        },
        { ...MINUS, ...made, kind: "date_moved_out", belongsDay: "2026-04-01" },
        { ...PLUS, ...made, kind: "date_moved_in", belongsDay: "2026-03-31" },
      ]);
    });

    it("without a supply day makes no movement", async () => {
      const original = await sale("2026-04-01");
      await replacement("2026-04-10", original);
      expect((await movements(Q2)).map((m) => m.saleId)).toEqual([original]);
    });

    it("of a late ticket moves it out of the ticket's own day, so it counts once", async () => {
      const ticket = await sale("2026-04-02", { supplyDay: "2026-03-31" });
      const repl = await replacement("2026-04-20", ticket, "2026-03-25");
      const made = { madeDay: "2026-04-20", saleId: repl, correctedSaleId: ticket };
      expect(await movements(Q2)).toEqual([
        {
          ...PLUS,
          kind: "issued_late",
          madeDay: "2026-04-02",
          belongsDay: "2026-03-31",
          saleId: ticket,
          correctedSaleId: null,
        },
        { ...MINUS, ...made, kind: "date_moved_out", belongsDay: "2026-03-31" },
        { ...PLUS, ...made, kind: "date_moved_in", belongsDay: "2026-03-25" },
      ]);
    });

    it("refunded later puts the refund on the replacement's supply day", async () => {
      const original = await sale("2026-04-01");
      const repl = await replacement("2026-04-10", original, "2026-03-31");
      const correction = await refund("2026-05-05", repl);
      expect((await movements(Q2)).filter((m) => m.kind === "correction")).toEqual([
        {
          ...MINUS,
          kind: "correction",
          madeDay: "2026-05-05",
          belongsDay: "2026-03-31",
          saleId: correction,
          correctedSaleId: repl,
        },
      ]);
    });

    it("without a supply day, refunded later, puts the refund on the original's own day", async () => {
      const original = await sale("2026-03-30", { supplyDay: "2026-03-28" });
      const repl = await replacement("2026-04-10", original);
      const correction = await refund("2026-05-05", repl);
      expect((await movements(Q2)).filter((m) => m.kind === "correction")).toEqual([
        {
          ...MINUS,
          kind: "correction",
          madeDay: "2026-05-05",
          belongsDay: "2026-03-28",
          saleId: correction,
          correctedSaleId: repl,
        },
      ]);
    });
  });

  describe("a void", () => {
    it("of an ordinary invoice negates it on the void's day, belonging to its own day", async () => {
      const id = await sale("2026-03-10");
      await seedVoid(suite.db, { saleId: id }, at("2026-04-05"));
      expect(await movements(Q2)).toEqual([
        {
          ...MINUS,
          kind: "void",
          madeDay: "2026-04-05",
          belongsDay: "2026-03-10",
          saleId: id,
          correctedSaleId: null,
        },
      ]);
    });

    it("reads the void's day in the voided sale's offset", async () => {
      const id = await seedSale(suite.db, venue, {
        ...TICKET,
        invoiceNumber: 1,
        issuedAt: at("2026-03-10"),
        issuedOffsetMinutes: 120,
      });
      await seedVoid(suite.db, { saleId: id }, at("2026-06-30", "23:30:00"));
      expect(await movements(Q2)).toEqual([]);
      expect((await movements({ kind: "quarter", quarter: 3 }))[0]).toMatchObject({
        kind: "void",
        madeDay: "2026-07-01",
        belongsDay: "2026-03-10",
      });
    });

    it("of a corrective negates the corrective where it belongs", async () => {
      const original = await sale("2026-03-10");
      const correction = await refund("2026-04-05", original);
      await seedVoid(suite.db, { saleId: correction }, at("2026-05-01"));
      expect((await movements(Q2)).filter((m) => m.kind === "void")).toEqual([
        {
          ...PLUS,
          kind: "void",
          madeDay: "2026-05-01",
          belongsDay: "2026-03-10",
          saleId: correction,
          correctedSaleId: original,
        },
      ]);
    });

    it("of an original replaced with an earlier day takes it off the replacement's day (V)", async () => {
      const original = await sale("2026-04-01");
      await replacement("2026-04-10", original, "2026-03-31");
      await seedVoid(suite.db, { saleId: original }, at("2026-05-10"));
      expect((await movements(Q2)).filter((m) => m.kind === "void")).toEqual([
        {
          ...MINUS,
          kind: "void",
          madeDay: "2026-05-10",
          belongsDay: "2026-03-31",
          saleId: original,
          correctedSaleId: null,
        },
      ]);
    });

    it("of the replacement makes no movement and changes none (R)", async () => {
      const original = await sale("2026-04-01");
      const repl = await replacement("2026-04-10", original, "2026-03-31");
      const before = await movements(Q2);
      expect(before).toHaveLength(3);
      await seedVoid(suite.db, { saleId: repl }, at("2026-05-10"));
      expect(await movements(Q2)).toEqual(before);
    });
  });

  it("gives an exchange invoice (F3) no movement; its tickets carry the VAT", async () => {
    const ticket = await sale("2026-04-01");
    const exchange = await sale("2026-04-02");
    await seedSubstitution(suite.db, { substitutionSaleId: exchange, substitutedSaleId: ticket });
    await seedVoid(suite.db, { saleId: exchange }, at("2026-04-03"));
    expect((await movements(Q2)).map((m) => [m.kind, m.saleId])).toEqual([["invoice", ticket]]);
  });

  it("puts a corrective of an exchange invoice on the exchange invoice's own day", async () => {
    const ticket = await sale("2026-03-30");
    const exchange = await sale("2026-04-02");
    await seedSubstitution(suite.db, { substitutionSaleId: exchange, substitutedSaleId: ticket });
    const correction = await refund("2026-04-05", exchange);
    expect((await movements(Q2)).find((m) => m.saleId === correction)).toMatchObject({
      kind: "correction",
      belongsDay: "2026-04-02",
    });
  });

  it("gives a payment on account and its table's invoice one ordinary movement each", async () => {
    const advance = await sale("2026-04-01", {
      total: "55.00",
      lines: [{ vatRate: "10.00", lineTotal: "50.00", advanceRole: "payment_on_account" }],
    });
    const invoice = await sale("2026-04-03", {
      total: "55.00",
      lines: [
        { vatRate: "10.00", lineTotal: "100.00" },
        {
          vatRate: "10.00",
          lineTotal: "-50.00",
          advanceRole: "deduction",
          deductsSaleId: advance,
        },
      ],
    });
    expect(
      (await movements(Q2)).map((m) => [m.kind, m.saleId, m.base, m.tax, m.belongsDay]),
    ).toEqual([
      ["invoice", advance, "50.00", "5.00", "2026-04-01"],
      ["invoice", invoice, "50.00", "5.00", "2026-04-03"],
    ]);
  });

  describe("stamped by a clock put back", () => {
    it("returns a correction stamped before its sale in both periods it touches", async () => {
      const original = await sale("2026-04-02");
      const correction = await refund("2026-03-26", original);
      const row = {
        ...MINUS,
        kind: "correction",
        madeDay: "2026-03-26",
        belongsDay: "2026-04-02",
        saleId: correction,
        correctedSaleId: original,
      };
      expect((await movements(Q2)).filter((m) => m.kind === "correction")).toEqual([row]);
      expect(await movements(Q1)).toEqual([row]);
    });

    it("returns a void stamped before its sale in both periods it touches", async () => {
      const id = await sale("2026-04-03");
      await seedVoid(suite.db, { saleId: id }, at("2026-03-27"));
      const row = {
        ...MINUS,
        kind: "void",
        madeDay: "2026-03-27",
        belongsDay: "2026-04-03",
        saleId: id,
        correctedSaleId: null,
      };
      expect((await movements(Q2)).filter((m) => m.kind === "void")).toEqual([row]);
      expect(await movements(Q1)).toEqual([row]);
    });
  });

  it("refuses a bad period", async () => {
    await expect(movements(Q2, 99)).rejects.toThrow(/year must be/);
  });
});
