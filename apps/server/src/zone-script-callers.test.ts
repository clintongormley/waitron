import { DatabaseSync } from "node:sqlite";
import { readFileSync, rmSync } from "node:fs";
import { settleInvoiceFirst } from "../scripts/settle-invoice-first.js";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { locations, sales } from "@waitron/db";
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
async function bundle(name: string, contents: string, direct = false, outputDir = builtDir!) {
  const outfile = join(outputDir, `${name}.mjs`);
  await build({
    ...(direct
      ? { entryPoints: [resolve(`scripts/${name}.ts`)] }
      : { stdin: { contents, resolveDir: resolve("src"), sourcefile: "zone-script-probe.ts" } }),
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
    await suite.db.update(locations).set({ timeZone: "Invalid/Zone" });
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
  it.each(["allergens-demo", "daily-close-demo", "daily-close-z-demo", "modelo-303-demo"])(
    "%s validates and explicitly saves its intended zone",
    async (name) => {
      const module = await bundle(name, "", true);
      const binary = await bundle(
        name + "-seed",
        `
      import { seedVenue } from ${JSON.stringify(module)};
      import {openVenueDatabase} from "@waitron/db";
      const store = await openVenueDatabase(process.env.WAITRON_VENUE_DIR, {exclusive:false});
      try { await seedVenue(store.venue, process.env.PROBE_ZONE); console.log("SEEDED"); }
      catch(e) { console.log(JSON.stringify({code:e.code, params:e.params})); process.exitCode=2; }
      finally {await store.close();}
    `,
      );
      const refused = run(binary, [], { PROBE_ZONE: "Invalid/Zone" });
      expect(suite.db.all(sql`select time_zone from locations`)).toEqual([]);
      expect(refused.output).toContain('"code":"venue.time_zone_invalid"');
      expect(refused.status).toBe(2);
      expect(suite.db.all(sql`select * from tenants`)).toEqual([]);
      const valid = run(binary, [], { PROBE_ZONE: "Atlantic/Canary" });
      expect(valid).toEqual({ status: 0, output: expect.stringContaining("SEEDED") });
      expect(suite.db.all(sql`select time_zone from locations`)).toEqual([
        { time_zone: "Atlantic/Canary" },
      ]);
    },
  );
  it.each(["record-one-sale", "settle-invoice-first"])(
    "built %s dates its actual new fiscal records in Madrid under a UTC host",
    async (name) => {
      const venue = await provision();
      const preload = join(builtDir!, "fixed-date.cjs");
      await writeFile(
        preload,
        `const OriginalDate=Date;global.Date=class extends OriginalDate {constructor(...args){super(...(args.length?args:["2026-10-14T23:30:00Z"]))} static now(){return OriginalDate.parse("2026-10-14T23:30:00Z")}};`,
      );
      const binary = await bundle(name, "", true);
      const args =
        name === "record-one-sale"
          ? [venue.nodeId, venue.seriesId, "Soup", "1.00", "10.00"]
          : [venue.nodeId, venue.seriesId, venue.seriesIds[2]!];
      const result = run(binary, args, { NODE_OPTIONS: `--require=${preload}` });
      expect(result).toEqual({ status: 0, output: expect.any(String) });
      const rows = suite.db.all(
        sql`select issued_at, issued_offset_minutes from sales order by invoice_number`,
      );
      expect(rows).toHaveLength(name === "record-one-sale" ? 1 : 2);
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

it("prepares a later correction independently across the autumn offset change", async () => {
  const venue = await provision();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-25T00:30:00Z") });
  await settleInvoiceFirst(
    {
      nodeId: venue.nodeId,
      standardSeriesId: venue.seriesId,
      rectificativeSeriesId: venue.seriesIds[2]!,
    },
    { WAITRON_ENV: "preproduction", WAITRON_VENUE_DIR: venueDir() },
    (line) => {
      if (line.startsWith("1.")) vi.setSystemTime(new Date("2026-10-25T01:30:00Z"));
    },
  );
  const rows = suite.db.all(
    sql`select issued_at, issued_offset_minutes from sales order by issued_at`,
  );
  expect(rows).toEqual([
    { issued_at: "2026-10-25T00:30:00.000Z", issued_offset_minutes: 120 },
    { issued_at: "2026-10-25T01:30:00.000Z", issued_offset_minutes: 60 },
  ]);
});

it.each(["daily-close-demo", "daily-close-z-demo", "modelo-303-demo"])(
  "built %s retains its August Madrid readings and scenario",
  async (name) => {
    const root = join(builtDir!, name + "-standalone");
    const outputDir = join(root, "migrations", "src");
    await mkdir(outputDir, { recursive: true });
    for (const set of manifestSets()) {
      const target = resolve(root, "migrations", set.from);
      await mkdir(dirname(target), { recursive: true });
      await symlink(resolve("../../packages/migrations", set.from), target);
    }
    const scratch = join(root, "tmp");
    await mkdir(scratch);
    const capture = join(root, "captured.db");
    const preload = join(root, "capture.cjs");
    await writeFile(
      preload,
      `const fs=require('node:fs/promises');const path=require('node:path');const remove=fs.rm;
fs.rm=async function(folder,options){if(folder.startsWith(process.env.TMPDIR))await fs.copyFile(path.join(folder,'venue.db'),process.env.PROBE_CAPTURE);return remove(folder,options)};require('node:module').syncBuiltinESMExports();`,
    );
    const binary = await bundle(name, "", true, outputDir);
    const result = run(binary, [], {
      TMPDIR: scratch,
      PROBE_CAPTURE: capture,
      NODE_OPTIONS: `--require=${preload}`,
    });
    expect(result).toEqual({ status: 0, output: expect.any(String) });
    const db = new DatabaseSync(capture, { readOnly: true });
    try {
      expect(db.prepare("select time_zone from locations").all()).toEqual([
        { time_zone: "Europe/Madrid" },
      ]);
      const rows = db.prepare("select issued_at, issued_offset_minutes from sales").all();
      expect(rows.length).toBeGreaterThan(2);
      expect(new Set(rows.map((row) => row.issued_offset_minutes))).toEqual(new Set([120]));
      expect(rows.every((row) => String(row.issued_at).startsWith("2026-08-"))).toBe(true);
      if (name === "daily-close-demo") expect(result.output).toContain('"grossTotal": "169.95"');
      if (name === "daily-close-z-demo") expect(result.output).toContain("close.already_closed");
      if (name === "modelo-303-demo") expect(result.output).toContain("303");
    } finally {
      db.close();
    }
  },
);
