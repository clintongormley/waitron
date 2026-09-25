// Pins that the sale lands in the directory the environment names, and that the `entorno` stamped on
// the fiscal record comes from the `WAITRON_ENV` this call was given (CLAUDE.md §5).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openVenueDatabase, sales } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { registrosFacturacion } from "@waitron/fiscal-verifactu";
import { recordOneSale } from "./record-one-sale.js";
import { provisionTestVenue, type TestVenue } from "./testing/venue.js";

interface Box {
  dir: string;
  venue: TestVenue;
}

describe("record-one-sale against a real venue directory", () => {
  let workDir: string;
  let preproduction: Box;
  let production: Box;

  async function makeBox(name: string, taxId: string): Promise<Box> {
    const dir = join(workDir, name);
    await applyMigrations(dir, migrationOptionsFor(manifestSets(), null));
    return { dir, venue: await provisionTestVenue(dir, taxId) };
  }

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "waitron-record-one-sale-"));
    // Two directories, so the suite can show which one a sale reaches. Separate databases, so the
    // same NIF in both is not a conflict.
    preproduction = await makeBox("venue", "50000000K");
    production = await makeBox("other-venue", "50000000K");
  }, 180_000);

  afterAll(async () => {
    if (workDir !== undefined) await rm(workDir, { recursive: true, force: true });
  });

  /** `sales.total` reads back as a count of whole cents: 11000, not "110.00". */
  async function readBox(box: Box): Promise<{
    sales: { id: string; total: number }[];
    registros: { entorno: string | null; huella: string }[];
  }> {
    const store = await openVenueDatabase(box.dir);
    try {
      const saleRows = await store.venue.select({ id: sales.id, total: sales.total }).from(sales);
      const registroRows = await store.venue
        .select({ entorno: registrosFacturacion.entorno, huella: registrosFacturacion.huella })
        .from(registrosFacturacion);
      return { sales: saleRows, registros: registroRows };
    } finally {
      await store.close();
    }
  }

  it("starts from two provisioned venues that hold no sale at all", async () => {
    // The control: without it the assertions below would also pass on a directory never opened.
    expect(await readBox(preproduction)).toEqual({ sales: [], registros: [] });
    expect(await readBox(production)).toEqual({ sales: [], registros: [] });
  });

  it("records the sale into the directory WAITRON_VENUE_DIR names, and nowhere else", async () => {
    const result = await recordOneSale(
      {
        tillId: preproduction.venue.tillId,
        nodeId: preproduction.venue.nodeId,
        seriesId: preproduction.venue.seriesId,
        description: "Café con leche",
        baseAmount: "100.00",
        vatRate: "10.00",
        tipAmount: "1.50",
      },
      { WAITRON_VENUE_DIR: preproduction.dir, WAITRON_ENV: "preproduction" },
    );

    expect(result.saleId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.fiscal.recordId).toMatch(/^[0-9a-f-]{36}$/);

    const here = await readBox(preproduction);
    expect(here.sales).toEqual([{ id: result.saleId, total: 11_000 }]);
    expect(here.registros).toHaveLength(1);
    expect(here.registros[0]!.huella).toMatch(/^[0-9A-F]{64}$/);

    expect(await readBox(production)).toEqual({ sales: [], registros: [] });
  });

  it("stamps entorno from the WAITRON_ENV of THIS call, not from the host's process env", async () => {
    // Read from the host's env instead, this record would carry `preproduction`, the default for an
    // unset variable.
    expect(process.env.WAITRON_ENV).toBeUndefined();
    await recordOneSale(
      {
        tillId: production.venue.tillId,
        nodeId: production.venue.nodeId,
        seriesId: production.venue.seriesId,
        description: "Menú del día",
        baseAmount: "10.00",
        vatRate: "21.00",
      },
      { WAITRON_VENUE_DIR: production.dir, WAITRON_ENV: "production" },
    );

    const there = await readBox(production);
    expect(there.registros.map((r) => r.entorno)).toEqual(["production"]);
    const here = await readBox(preproduction);
    expect(here.registros.map((r) => r.entorno)).toEqual(["preproduction"]);
    // An absent tip means "0.00", not a throw.
    expect(there.sales.map((s) => s.total)).toEqual([1_210]);
  });

  it("finds the venue from WAITRON_STATE_DIR when no venue directory is named", async () => {
    // `preproduction.dir` is `<workDir>/venue`, so a second sale there shows the default branch
    // reached the real venue.
    await recordOneSale(
      {
        tillId: preproduction.venue.tillId,
        nodeId: preproduction.venue.nodeId,
        seriesId: preproduction.venue.seriesId,
        description: "Tostada",
        baseAmount: "2.00",
        vatRate: "10.00",
      },
      { WAITRON_STATE_DIR: workDir, WAITRON_ENV: "preproduction" },
    );

    const here = await readBox(preproduction);
    expect(here.sales.map((s) => s.total).sort((a, b) => a - b)).toEqual([220, 11_000]);
    expect(here.registros.map((r) => r.entorno)).toEqual(["preproduction", "preproduction"]);
  });

  it("refuses a series the venue does not hold, by its domain code", async () => {
    await expect(
      recordOneSale(
        {
          tillId: preproduction.venue.tillId,
          nodeId: preproduction.venue.nodeId,
          seriesId: "00000000-0000-4000-8000-000000000000",
          description: "Nada",
          baseAmount: "1.00",
          vatRate: "10.00",
        },
        { WAITRON_VENUE_DIR: preproduction.dir, WAITRON_ENV: "preproduction" },
      ),
      // The domain code: a driver error would also be an `Error` (CLAUDE.md §4).
    ).rejects.toMatchObject({ code: "sale.series_not_found" });
  });
});
