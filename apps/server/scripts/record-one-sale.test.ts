// Runs the converted script against REAL venue directories — the two SQLite files the product
// opens. The conversion replaced a connection string with a directory, and the two things a
// typecheck cannot see are exactly the two this suite pins: that the sale lands in the directory
// the environment names, and that the `entorno` stamped on the fiscal record comes from the
// `WAITRON_ENV` this call was given (CLAUDE.md §5 — that stamp cannot be corrected afterwards).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openVenueDatabase, sales } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { registrosFacturacion } from "@waitron/fiscal-verifactu";
import { recordOneSale } from "./record-one-sale.js";
import { provisionTestVenue, type TestVenue } from "./testing/venue.js";

/** One migrated, provisioned venue directory. */
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
    // TWO directories, because the sharpest claim this suite can make is about which one a sale
    // reaches. They are separate databases, so the same NIF in both is not a conflict.
    preproduction = await makeBox("venue", "50000000K");
    production = await makeBox("other-venue", "50000000K");
  }, 180_000);

  afterAll(async () => {
    if (workDir !== undefined) await rm(workDir, { recursive: true, force: true });
  });

  /** Every sale and every fiscal record in one directory, read through the product's own opener.
   * `sales.total` is a `money` column, which on this engine is a COUNT OF WHOLE CENTS with no read
   * mapping (`packages/db/src/schema/columns.ts`: `money` is `integer`) — so these assertions carry
   * the count, 11000, not the amount "110.00". The decimal only exists at the edges. */
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
    // The control. Without it every assertion below would also pass on a directory this script
    // never opened, because "no sale here" and "no sale anywhere" look alike.
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
    // base 100.00 + 10% VAT = 110.00, computed by the same `percentOf` recordSale uses; stored as
    // the cent count 11000.
    expect(here.sales).toEqual([{ id: result.saleId, total: 11_000 }]);
    expect(here.registros).toHaveLength(1);
    // A 64-character uppercase-hex huella: the chain link, not a placeholder.
    expect(here.registros[0]!.huella).toMatch(/^[0-9A-F]{64}$/);

    // The OTHER directory is untouched — this is the half a green "it did not throw" would miss.
    expect(await readBox(production)).toEqual({ sales: [], registros: [] });
  });

  it("stamps entorno from the WAITRON_ENV of THIS call, not from the host's process env", async () => {
    // The conversion moved every `deploymentEnvironment(process.env)` to `deploymentEnvironment(env)`.
    // If that move had been missed, this record would carry `preproduction` — the value
    // `deploymentEnvironment` defaults an unset variable to, and the value vitest's own process
    // does not set at all. `entorno` is never hashed, so it is safe to assert and impossible to fix
    // later (CLAUDE.md §5).
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
    // And the first box still carries the other stamp, so the two calls did not share a resolver.
    const here = await readBox(preproduction);
    expect(here.registros.map((r) => r.entorno)).toEqual(["preproduction"]);
    // base 10.00 + 21% VAT = 12.10 — the optional tip argument absent means "0.00", not a throw.
    expect(there.sales.map((s) => s.total)).toEqual([1_210]);
  });

  it("finds the venue from WAITRON_STATE_DIR when no venue directory is named", async () => {
    // `venue` under the state dir is the default, and `preproduction.dir` IS `<workDir>/venue` —
    // so a SECOND sale appearing there is what proves the default branch reached the real venue
    // rather than creating a virgin database somewhere else.
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
    // 110.00 and 2.20, as cent counts.
    expect(here.sales.map((s) => s.total).sort((a, b) => a - b)).toEqual([220, 11_000]);
    // Two links on one chain, both stamped for the same environment.
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
      // The domain code, not just "it threw": a driver error would also be an `Error`
      // (CLAUDE.md §4). Read off the thrown value rather than guessed — the code the write path
      // raises for a series the venue does not hold is `sale.series_not_found`.
    ).rejects.toMatchObject({ code: "sale.series_not_found" });
  });
});
