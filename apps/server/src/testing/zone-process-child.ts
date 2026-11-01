import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { locations, openVenueDatabase, withTransaction } from "@waitron/db";
import { computeHuella } from "@waitron/verifactu";
import { decodeRegistroRow, fromRegistroRow } from "@waitron/fiscal-verifactu/src/registro-row.js";
import { recordTillSale } from "../till-sale.js";
import { zonePaymentVenue } from "./zone-payment-venue.js";
import { offerProducts } from "./zone-offers.js";

const scenarios = [
  ["madrid-midnight", "Europe/Madrid", "2026-10-14T22:30:00.000Z"],
  ["madrid-night", "Europe/Madrid", "2026-10-14T23:30:00.000Z"],
  ["madrid-noon", "Europe/Madrid", "2026-10-14T12:00:00.000Z"],
  ["canary-evening", "Atlantic/Canary", "2026-10-14T22:30:00.000Z"],
  ["canary-midnight", "Atlantic/Canary", "2026-10-14T23:30:00.000Z"],
  ["canary-winter", "Atlantic/Canary", "2026-01-15T23:30:00.000Z"],
  ["spring-before", "Europe/Madrid", "2026-03-29T00:59:59.000Z"],
  ["spring-after", "Europe/Madrid", "2026-03-29T01:00:00.000Z"],
  ["autumn-first", "Europe/Madrid", "2026-10-25T00:30:00.000Z"],
  ["autumn-second", "Europe/Madrid", "2026-10-25T01:30:00.000Z"],
] as const;

async function calendar(directory: string) {
  const store = await openVenueDatabase(directory, { exclusive: false });
  try {
    const v = await zonePaymentVenue(store.venue);
    const product = store.venue.all<{ id: string }>(
      sql`select id from products where name = 'Worker dish'`,
    )[0]!;
    const offers = await withTransaction(store.venue, (tx) =>
      offerProducts(tx, v.cfg, { productIds: [product.id] }),
    );
    const results = [];
    for (const [key, timeZone, at] of [...scenarios].sort(
      (a, b) => Date.parse(a[2]) - Date.parse(b[2]),
    )) {
      await store.venue
        .update(locations)
        .set({ timeZone })
        .where(eq(locations.id, v.cfg.locationId));
      const before = store.venue.all(sql`select * from registros_facturacion order by secuencia`);
      const instant = new Date(at);
      const clock = {
        ...v.clock,
        now: () => ({ ...v.clock.now(), instant, offsetMinutes: -instant.getTimezoneOffset() }),
      };
      const id = randomUUID();
      await recordTillSale(
        { ...v.deps, clock, log: () => {} },
        v.cfg,
        {
          workingOrderId: id,
          expectedEdit: null,
          zoneId: offers.zoneId,
          lines: [{ menuItemId: offers.offerFor(product.id), quantity: "1" }],
          tender: { method: "cash", amount: "12.10" },
        },
        v.operator,
      );
      const [row] = store.venue.all<{ issued_at: string; issued_offset_minutes: number }>(
        sql`select issued_at, issued_offset_minutes from sales where working_order_id = ${id}`,
      );
      const raw = store.venue
        .all<Record<string, unknown>>(sql`select * from registros_facturacion order by secuencia`)
        .at(-1)!;
      const record = fromRegistroRow(decodeRegistroRow(raw));
      const after = store.venue.all(sql`select * from registros_facturacion order by secuencia`);
      results.push({
        key,
        instant: row!.issued_at,
        day: raw.fecha_expedicion_factura,
        offset: row!.issued_offset_minutes,
        generation: record.FechaHoraHusoGenRegistro,
        hashVerified: computeHuella(record) === raw.huella,
        historyPreserved: JSON.stringify(after.slice(0, before.length)) === JSON.stringify(before),
      });
    }
    return { casesRun: results.length, results };
  } finally {
    await store.close();
  }
}

const familiesByKey: Record<string, { file: string; pattern: string; root?: string }> = {
  "whole-order": {
    file: "src/till-sale-integrated.test.ts",
    pattern:
      "whole-order saved-zone issuance|accepted-offline capture keeps|closed admission retains a completed capture|recovery checks admission inside its final transaction|collects a placed but unissued order",
  },
  "bill-payment": { file: "src/zone-bill-payment-boundaries.test.ts", pattern: "." },
  "auto-issue": {
    file: "src/zone-economic-boundaries.test.ts",
    pattern: "dates one new fiscal record in the venue zone at night",
  },
  "core-only": { file: "src/zone-core-capabilities.test.ts", pattern: "." },
  readiness: {
    file: "src/fiscal-readiness-runner.verifactu.test.ts",
    pattern: "uses one supplied isolated issue reading",
  },
  scripts: { file: "src/zone-script-callers.test.ts", pattern: "." },
  "core-only-emergency": {
    file: "src/void-issue-clock.test.ts",
    pattern: ".",
    root: "../../packages/fiscal-verifactu",
  },
};
async function families(directory: string, family: string) {
  const selected = familiesByKey[family];
  if (selected === undefined) throw new Error("Unknown issuance family");
  const report = join(directory, "family-results.json");
  await promisify(execFile)(
    process.execPath,
    [
      resolve("node_modules/vitest/vitest.mjs"),
      "run",
      selected.file,
      "--testNamePattern",
      selected.pattern,
      "--reporter=default",
      "--reporter=json",
      `--outputFile=${report}`,
      "--maxWorkers=1",
      "--coverage.enabled=false",
    ],
    {
      cwd: resolve(selected.root ?? "."),
      timeout: 75_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, ZONE_PROCESS_MATRIX_TZ: process.env.TZ },
    },
  ).catch((error: unknown) => {
    const output = error as { stdout?: string; stderr?: string };
    process.stderr.write((output.stdout ?? "") + (output.stderr ?? ""));
    throw error;
  });
  const result = JSON.parse(await readFile(report, "utf8")) as {
    success: boolean;
    numPassedTests: number;
    testResults: { name: string; assertionResults: { fullName: string; status: string }[] }[];
  };
  return {
    success: result.success,
    casesRun: result.numPassedTests,
    results: result.testResults.map((test) => ({
      key: family,
      source: test.name.split("/").at(-1),
      tests: test.assertionResults.filter(
        (test) => test.status !== "pending" && test.status !== "skipped",
      ),
    })),
  };
}

const [mode, directory, family = ""] = process.argv.slice(2);
if (directory === undefined || (mode !== "calendar" && mode !== "families"))
  throw new Error("Expected matrix mode and venue directory");
const result = mode === "calendar" ? await calendar(directory) : await families(directory, family);
console.log(
  JSON.stringify({ processZone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...result }),
);
