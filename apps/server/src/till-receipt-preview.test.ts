import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { randomUUID } from "node:crypto";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "./testing/full-invoice-fixture.js";
import { readReceiptPresentation } from "./receipt-presentation.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { tillReceiptPreview } from "./till-receipt-preview.js";
import * as venueAddressReads from "./venue-address.js";
import type { TillSaleResult } from "./till-sale.js";

describe("tillReceiptPreview", () => {
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });

  const ticket = async (domicile: string): Promise<TillSaleResult> => ({
    ...FULL_INVOICE_DOCUMENT_FIXTURE.result,
    issuer: { venueName: "Santet SL", nif: "B00000000", domicile },
    receiptTrim: {},
    venueAddress: ["Carrer de Mallorca 123", "08010 Barcelona"],
    venueAddressLine: (
      await withTransaction(suite.db, (tx) =>
        readReceiptPresentation(tx, randomUUID(), "es-ES", false),
      )
    ).venueAddressLine,
    receiptSettings: { printAddress: true },
    simulatedCardPayment: false,
  });

  const previewText = async (domicile: string): Promise<string[]> => {
    const sold = await ticket(domicile);
    const { receiptPreview } = await withTransaction(suite.db, (tx) =>
      tillReceiptPreview(tx, randomUUID(), sold, false),
    );
    return (receiptPreview ?? []).flatMap((e) => (e.kind === "text" ? [e.text] : []));
  };

  it("prints a registered address once when it is the venue's, province and all", async () => {
    await setupVenue(suite.db);
    await seedVenueSettings(suite.db, {
      addressLine1: "Carrer de Mallorca 123",
      postalCode: "08010",
      city: "Barcelona",
      province: "Barcelona",
    });
    const text = await previewText("Carrer de Mallorca 123, 08010 Barcelona, Barcelona");
    expect(text.filter((t) => /Mallorca/.test(t))).toEqual(["Carrer de Mallorca 123"]);
    expect(text.some((t) => t.startsWith("Domicilio fiscal:"))).toBe(false);
  });

  it("prints a different registered address labelled", async () => {
    await setupVenue(suite.db);
    await seedVenueSettings(suite.db, {
      addressLine1: "Carrer de Mallorca 123",
      postalCode: "08010",
      city: "Barcelona",
      province: "Barcelona",
    });
    expect(await previewText("Carrer de Mallorca 125, 08010 Barcelona, Barcelona")).toContain(
      "Domicilio fiscal: Carrer de Mallorca 125, 08010 Barcelona, Barcelona",
    );
  });

  it("prints the registered address labelled when the venue cannot be read, and says so", async () => {
    await setupVenue(suite.db);
    const read = vi
      .spyOn(venueAddressReads, "readVenueAddressAndLine")
      .mockRejectedValue(new Error("venue read refused"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => {
      read.mockRestore();
      warn.mockRestore();
    });
    expect(await previewText("Carrer de Mallorca 123, 08010 Barcelona, Barcelona")).toContain(
      "Domicilio fiscal: Carrer de Mallorca 123, 08010 Barcelona, Barcelona",
    );
    expect(warn.mock.calls).toEqual([
      [
        "receipt.optional_read_failed",
        { operation: "readVenueAddress", code: "receipt.read_failed" },
      ],
    ]);
  });
});
