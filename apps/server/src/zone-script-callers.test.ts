import { readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { sales } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decodeRegistroRow } from "@waitron/fiscal-verifactu/src/registro-row.js";
import { fromRegistroRow, type RegistroRow } from "@waitron/fiscal-verifactu";
import { seedSales } from "../scripts/demo-seed/seed-sales.js";
import { createDemoVenueProvisioner } from "../scripts/demo-seed/testing/provision-venue.js";
import { seedInstalledDemo } from "./demo-seed.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const provision = createDemoVenueProvisioner(() => suite.db, {
  nifBase: 82_000_000,
  nifFormat: "calculated",
  invoiceLocale: "en-GB",
});
let builtDir: string | undefined;
beforeAll(async () => {
  builtDir = await mkdtemp(join(tmpdir(), "zone-script-bundles-"));
  await symlink(resolve("node_modules"), join(builtDir, "node_modules"));
  await writeFile(
    join(builtDir, "matrix-zone.cjs"),
    `require('node:fs').writeFileSync(process.env.ZONE_PROCESS_MATRIX_OBSERVED, JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }));`,
  );
});
afterAll(async () => {
  if (builtDir !== undefined) await rm(builtDir, { recursive: true, force: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
function venueDir() {
  const row = suite.db
    .all<{ name: string; file: string }>(sql`pragma database_list`)
    .find((r) => r.name === "main")!;
  return dirname(row.file);
}
async function bundle(name: string, contents: string) {
  const outfile = join(builtDir!, `${name}.mjs`);
  await build({
    stdin: { contents, resolveDir: resolve("src"), sourcefile: "zone-script-probe.ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["sharp", join(builtDir!, "*")],
    outfile,
    banner: {
      js: "import { createRequire as makeRequire } from 'node:module'; const require = makeRequire(import.meta.url);",
    },
    logLevel: "silent",
  });
  return outfile;
}
function run(binary: string, args: string[] = [], env: Record<string, string> = {}) {
  const matrixZone = process.env.ZONE_PROCESS_MATRIX_TZ;
  const observed = join(builtDir!, "matrix-observed.json");
  const hostArgs = matrixZone ? ["--require", join(builtDir!, "matrix-zone.cjs")] : [];
  rmSync(observed, { force: true });
  const result = spawnSync(process.execPath, [...hostArgs, binary, ...args], {
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !key.startsWith("GIT_") && !key.startsWith("WAITRON_"),
        ),
      ),
      WAITRON_ENV: "preproduction",
      WAITRON_VENUE_DIR: venueDir(),
      TZ: process.env.ZONE_PROCESS_MATRIX_TZ || "UTC",
      ZONE_PROCESS_MATRIX_OBSERVED: observed,
      ...env,
    },
    encoding: "utf8",
    timeout: 90_000,
  });
  if (matrixZone) {
    expect(JSON.parse(readFileSync(observed, "utf8"))).toEqual({ timeZone: matrixZone });
  }
  return { status: result.status, output: result.stdout + result.stderr };
}
const products = [
  { id: "soup", name: "Soup", customerName: null, unitPrice: "2.40", vatClass: "reduced" as const },
];
describe("saved-zone script callers", () => {
  it.each(["2026-03-30T22:00:00Z", "2026-10-26T22:00:00Z"])(
    "backdates each historical sale across DST at %s",
    async (at) => {
      vi.stubEnv("TZ", process.env.ZONE_PROCESS_MATRIX_TZ || "UTC");
      if (process.env.ZONE_PROCESS_MATRIX_TZ) {
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
          process.env.ZONE_PROCESS_MATRIX_TZ,
        );
      }
      vi.useFakeTimers({ toFake: ["Date"], now: new Date(at) });
      const venue = await provision();
      const result = await seedSales(suite.db, {
        venue,
        invoiceLocale: "en-GB",
        days: 3,
        products,
      });
      const rows = await suite.db
        .select({ at: sales.issuedAt, offset: sales.issuedOffsetMinutes })
        .from(sales);
      expect(rows).toHaveLength(result.count);
      expect(rows.length).toBeGreaterThan(10);
      expect(new Set(rows.map((r) => r.offset))).toEqual(new Set([60, 120]));
      for (const row of rows) {
        const summer = at.startsWith("2026-03") ? row.at >= "2026-03-29" : row.at < "2026-10-25";
        expect(row.offset).toBe(summer ? 120 : 60);
      }
      const generation = suite.db
        .all<RegistroRow>(sql`select * from registros_facturacion`)
        .map((row) => fromRegistroRow(decodeRegistroRow(row)));
      expect(generation).toHaveLength(rows.length);
      for (const record of generation) {
        const instant = new Date(record.FechaHoraHusoGenRegistro).toISOString();
        const summer = at.startsWith("2026-03") ? instant >= "2026-03-29" : instant < "2026-10-25";
        expect(record.FechaHoraHusoGenRegistro.endsWith(summer ? "+02:00" : "+01:00")).toBe(true);
        expect(rows.some((row) => row.at === instant)).toBe(true);
      }
    },
  );
  it("refuses installed Demo's unusable saved zone before seeding catalogue or sales", async () => {
    const venue = await provision();
    await suite.db.run(
      sql`update settings set doc = json_set(doc, '$.timeZone', ${"Invalid/Zone"}) where module = 'business_day'`,
    );
    const before = suite.db.all(sql`select * from catalogues`);
    const refusal = await seedInstalledDemo(suite.db, venue, {
      country: "ES",
      admin: { locale: "en" },
    } as never).then(
      () => null,
      (error: unknown) => error,
    );
    expect(suite.db.all(sql`select * from catalogues`)).toEqual(before);
    expect(suite.db.all(sql`select * from sales`)).toEqual([]);
    expect(refusal).toMatchObject({ code: "venue.time_zone_invalid" });
  });
  it.each(["sale-fixture"])(
    "built %s dates its actual new fiscal records in Madrid under a UTC host",
    async (name) => {
      const venue = await provision();
      const preload = join(builtDir!, "fixed-date.cjs");
      await writeFile(
        preload,
        `const OriginalDate=Date;global.Date=class extends OriginalDate {constructor(...args){super(...(args.length?args:["2026-10-14T23:30:00Z"]))} static now(){return OriginalDate.parse("2026-10-14T23:30:00Z")}};`,
      );
      const binary = await bundle(
        name,
        `
        import { recordFixtureSale } from "../scripts/testing/sale.js";
        import { openVenueDatabase } from "@waitron/db";
        const [nodeId, seriesId, description, baseAmount, vatRate] = process.argv.slice(2);
        const store = await openVenueDatabase(process.env.WAITRON_VENUE_DIR, {exclusive:false});
        try { await recordFixtureSale(store.venue, {nodeId, seriesId, description, baseAmount, vatRate}); }
        finally { await store.close(); }
        `,
      );
      const args = [venue.nodeId, venue.seriesId, "Soup", "1.00", "10.00"];
      const result = run(binary, args, { NODE_OPTIONS: `--require=${preload}` });
      expect(result).toEqual({ status: 0, output: expect.any(String) });
      const rows = suite.db.all(
        sql`select issued_at, issued_offset_minutes from sales order by invoice_number`,
      );
      expect(rows).toHaveLength(1);
      for (const row of rows)
        expect(row).toMatchObject({
          issued_at: "2026-10-14T23:30:00.000Z",
          issued_offset_minutes: 120,
        });
      const records = suite.db
        .all<RegistroRow>(sql`select * from registros_facturacion`)
        .map((row) => fromRegistroRow(decodeRegistroRow(row)));
      expect(records).toHaveLength(rows.length);
      for (const row of records) {
        expect(row.IDFactura).toMatchObject({ FechaExpedicionFactura: "15-10-2026" });
        expect(row.FechaHoraHusoGenRegistro).toBe("2026-10-15T01:30:00+02:00");
      }
    },
  );
});
