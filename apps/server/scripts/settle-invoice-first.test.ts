// Runs the converted script against a REAL venue directory. The six narration lines ARE this
// script's output, so they are what the assertions read: a suite that only checked "it did not
// throw" would pass against a script that recorded nothing (CLAUDE.md §4).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openVenueDatabase, sales } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { registrosFacturacion } from "@waitron/fiscal-verifactu";
import { settleInvoiceFirst } from "./settle-invoice-first.js";
import { provisionTestVenue, type TestVenue } from "./testing/venue.js";

describe("settle-invoice-first against a real venue directory", () => {
  let workDir: string;
  let venueDir: string;
  let venue: TestVenue;
  let lines: string[];

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "waitron-settle-invoice-first-"));
    venueDir = join(workDir, "venue");
    await applyMigrations(venueDir, migrationOptionsFor(manifestSets(), null));
    venue = await provisionTestVenue(venueDir, "50000000K");

    lines = [];
    await settleInvoiceFirst(
      {
        tillId: venue.tillId,
        nodeId: venue.nodeId,
        standardSeriesId: venue.seriesId,
        rectificativeSeriesId: venue.rectificativeSeriesId,
      },
      { WAITRON_VENUE_DIR: venueDir, WAITRON_ENV: "preproduction" },
      (line) => lines.push(line),
    );
  }, 180_000);

  afterAll(async () => {
    if (workDir !== undefined) await rm(workDir, { recursive: true, force: true });
  });

  it("narrates all six steps, in order, with the amounts the loop is meant to produce", () => {
    expect(lines).toHaveLength(6);
    expect(lines[0]).toMatch(/^1\. issued invoice-first sale [0-9a-f-]{36} \(total 110\.00\)/);
    // Outstanding is the FULL total before the correction…
    expect(lines[1]).toMatch(/^2\. outstanding: [0-9a-f-]{36}=110\.00$/);
    expect(lines[2]).toMatch(/^3\. issued rectificativa [0-9a-f-]{36} \(total -11\.00\)/);
    // …the NET after it…
    expect(lines[3]).toMatch(/^4\. outstanding: [0-9a-f-]{36}=99\.00$/);
    expect(lines[4]).toMatch(/^5\. settled [0-9a-f-]{36} at 99\.00$/);
    // …and nothing once settled at the net.
    expect(lines[5]).toBe("6. outstanding: (none)");
  });

  it("names the SAME sale at every step, not a fresh one each time", () => {
    // The regression this catches is a loop that issued, corrected and settled three different
    // sales and still printed a plausible narration.
    const ids = [lines[1], lines[3], lines[4]].map((l) => /[0-9a-f-]{36}/.exec(l!)![0]);
    expect(new Set(ids).size).toBe(1);
    expect(lines[0]).toContain(ids[0]!);
  });

  it("wrote both sales and both fiscal records into the directory the env named", async () => {
    const store = await openVenueDatabase(venueDir);
    try {
      const saleRows = await store.venue.select({ total: sales.total }).from(sales);
      // The deferred sale and its rectificativa — the correction carries a NEGATIVE total. A
      // `money` column is a COUNT OF WHOLE CENTS on this engine, so 110.00 is 11000
      // (`packages/db/src/schema/columns.ts`: `money` is `integer`, no read mapping).
      expect(saleRows.map((r) => r.total).sort((a, b) => a - b)).toEqual([-1_100, 11_000]);
      const registroRows = await store.venue
        .select({ entorno: registrosFacturacion.entorno, huella: registrosFacturacion.huella })
        .from(registrosFacturacion);
      expect(registroRows).toHaveLength(2);
      // Two real chain links, both stamped with the WAITRON_ENV this call was given.
      for (const row of registroRows) {
        expect(row.huella).toMatch(/^[0-9A-F]{64}$/);
        expect(row.entorno).toBe("preproduction");
      }
    } finally {
      await store.close();
    }
  });
});
