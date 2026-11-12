import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { captureError, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { FiscalBackend, SaleForFiscalRecord } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError, decimal, jobOrigin, saleId as brandSaleId } from "@waitron/shared";
import { startClockState } from "./start-clock-check.js";
import { gateSeatOnStartClock, startClockGateHolds } from "./start-clock-gate.js";
import { fiscalRecordCount, provisionBillVenue, type BillVenue } from "./testing/bill-venue.js";
import "./errors.js";

let venue: BillVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

let invoiceNumber = 9_000;

/** A sale row of its own and the record input for it: positive and simplified unless told. */
async function saleInput(
  options: { total?: string; counterparty?: SaleForFiscalRecord["counterparty"] } = {},
): Promise<SaleForFiscalRecord> {
  const id = brandSaleId(randomUUID());
  const number = invoiceNumber++;
  const issuedAt = venue.clock.now().instant;
  const negative = options.total?.startsWith("-") === true;
  await venue.db.insert(sales).values({
    id,
    ...jobOrigin("readiness_test"),
    nodeId: venue.cfg.nodeId,
    seriesId: venue.seriesId,
    invoiceNumber: number,
    issuedAt: issuedAt.toISOString(),
    issuedOffsetMinutes: 60,
    total: 0,
    vatBreakdown: [],
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    fiscalBackend: "verifactu",
    fiscalState: "recorded",
  });
  return {
    origin: jobOrigin("readiness_test"),
    nodeId: venue.cfg.nodeId,
    saleId: id,
    seriesId: venue.seriesId,
    seriesCode: "A",
    invoiceNumber: number,
    issuedAt,
    offsetMinutes: 60,
    descriptionOfOperation: "Restaurante",
    total: decimal(negative ? "-12.10" : "12.10"),
    vatBreakdown: [
      {
        rate: decimal("21.00"),
        base: decimal(negative ? "-10.00" : "10.00"),
        tax: decimal(negative ? "-2.10" : "2.10"),
      },
    ],
    counterparty: options.counterparty ?? null,
  };
}

/** A sale recorded through the ungated seat, for the writers that cite one. */
async function recordedOriginal(): Promise<SaleForFiscalRecord> {
  const original = await saleInput();
  await withTransaction(venue.db, (tx) => venue.backend.recordSale(tx, original));
  return original;
}

type Write = (seat: FiscalBackend) => Promise<unknown>;

const writers: Record<string, () => Promise<Write>> = {
  recordSale: async () => {
    const input = await saleInput();
    return (seat) => withTransaction(venue.db, (tx) => seat.recordSale(tx, input));
  },
  recordVoid: async () => {
    const original = await recordedOriginal();
    return (seat) =>
      withTransaction(venue.db, (tx) =>
        seat.recordVoid(tx, original.saleId, "Wrong charge", venue.cfg.nodeId),
      );
  },
  recordCorrection: async () => {
    const original = await recordedOriginal();
    const input = await saleInput({ total: "-12.10" });
    return (seat) =>
      withTransaction(venue.db, (tx) =>
        seat.recordCorrection(tx, input, { correctsSaleId: original.saleId }),
      );
  },
  recordSubstitution: async () => {
    const original = await recordedOriginal();
    const input = await saleInput({
      counterparty: { taxId: "B12345674", legalName: "Customer Ltd", countryCode: "ES" },
    });
    return (seat) =>
      withTransaction(venue.db, (tx) =>
        seat.recordSubstitution(tx, input, { substitutedSaleIds: [original.saleId] }),
      );
  },
};

describe.each(Object.keys(writers))("the seat's %s behind the start clock gate", (name) => {
  it("throws clock.unconfirmed while the start waits, writing no record, and writes one once confirmed", async () => {
    const write = await writers[name]!();
    const state = startClockState();
    const seat = gateSeatOnStartClock(
      venue.backend,
      startClockGateHolds(
        state,
        () => true,
        () => false,
      ),
    );
    const before = fiscalRecordCount(venue);

    const error = await captureError(() => write(seat));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "clock.unconfirmed", params: {} });
    // The table's triggers refuse every update and delete, so an unchanged count is unchanged rows.
    expect(fiscalRecordCount(venue)).toBe(before);

    state.confirm("by_person", {});
    await write(seat);

    expect(fiscalRecordCount(venue)).toBe(before + 1);
  });
});
