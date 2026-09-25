// The fiscal receipt: a venue archived with the engine's own copy statement, put back by
// `restoreDatabase`, still refuses to let its fiscal ledger be rewritten.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  sales,
  tenants,
  tills,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { registroSif, registrosFacturacion } from "@waitron/fiscal-verifactu";
import { restoreDatabase } from "./restore.js";

/**
 * The trigger statements in `setup` are redundant: `useVenueDb` already installs each set's
 * declared append-only triggers. They are `create trigger if not exists`, so the duplicate is
 * silent, and copied rather than imported because `apps/server` does not depend on `@waitron/store`.
 */
const LEDGER_TABLE = "registros_facturacion";

/** `installAppendOnlyTriggers`'s own statements, for the one table this suite seeds. */
const APPEND_ONLY_TRIGGERS = (["update", "delete"] as const).map(
  (event) =>
    `create trigger if not exists "${LEDGER_TABLE}_append_only_${event}" ` +
    `before ${event} on "${LEDGER_TABLE}" for each row ` +
    `begin select raise(abort, '${LEDGER_TABLE} is append-only'); end`,
);

/** SQLite's `SQLITE_CONSTRAINT_TRIGGER`, which `node:sqlite` puts on the thrown error's `errcode`. */
const SQLITE_CONSTRAINT_TRIGGER = 1811;

const F = {
  locationId: "c0000000-0000-4000-8000-000000000002",
  tillId: "c0000000-0000-4000-8000-000000000003",
  seriesId: "c0000000-0000-4000-8000-000000000004",
  saleId: "c0000000-0000-4000-8000-000000000005",
  sifId: "c0000000-0000-4000-8000-000000000006",
  nodeId: "c0000000-0000-4000-8000-000000000008",
};

/** The 64 hex characters whose survival is the point: a huella is the chain, byte for byte. */
const HUELLA = "F".repeat(64);

/** Exactly the foreign-key closure `registros_facturacion` needs, plus the record itself. */
async function seedFiscalRegistro(db: Database): Promise<void> {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Waitron SL" });
  await db.insert(locations).values({
    id: F.locationId,
    name: "Local principal",
    invoiceLocales: ["es"],
    operationDescription: "Venta en establecimiento",
  });
  await db.insert(tills).values({ id: F.tillId, locationId: F.locationId, name: "Caja 1" });
  await db.insert(nodes).values({ id: F.nodeId, locationId: F.locationId, name: "Node 1" });
  await db.insert(invoiceSeries).values({ id: F.seriesId, nodeId: F.nodeId, code: "A" });
  await db.insert(sales).values({
    id: F.saleId,
    tillId: F.tillId,
    nodeId: F.nodeId,
    seriesId: F.seriesId,
    invoiceNumber: 1,
    issuedAt: "2026-07-20T19:20:30+01:00",
    issuedOffsetMinutes: 60,
    total: 0,
    vatBreakdown: [],
    locale: "es",
    invoiceLocales: ["es"],
    fiscalBackend: "verifactu",
    fiscalState: "recorded",
  });
  await db.insert(registroSif).values({
    id: F.sifId,
    nodeId: F.nodeId,
    nif: "89890001K",
    idSistemaInformatico: "WT",
    numeroInstalacion: 1,
  });
  await db.insert(registrosFacturacion).values({
    tillId: F.tillId,
    nodeId: F.nodeId,
    sifId: F.sifId,
    saleId: F.saleId,
    secuencia: 1,
    tipoRegistro: "alta",
    idEmisorFactura: "89890001K",
    numSerieFactura: "A/1",
    fechaExpedicionFactura: "2026-07-20",
    nombreRazonEmisor: "Waitron SL",
    tipoFactura: "F2",
    descripcionOperacion: "Venta en establecimiento",
    desglose: [],
    cuotaTotal: "12.35",
    importeTotal: "123.45",
    primerRegistro: true,
    sistemaInformatico: {},
    fechaHoraHusoGenRegistro: new Date("2026-07-20T19:20:30+01:00"),
    offsetMinutos: 60,
    tipoHuella: "01",
    huella: HUELLA,
  });
}

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    for (const statement of APPEND_ONLY_TRIGGERS) db.run(sql.raw(statement));
    await seedFiscalRegistro(db);
  },
  timeoutMs: 120_000,
});

function triggersOf(db: Database): { name: string; sql: string }[] {
  return db.all<{ name: string; sql: string }>(
    sql`select name, sql from sqlite_master where type = 'trigger' order by name`,
  );
}

describe("a restored venue keeps its fiscal ledger immutable", () => {
  it("copies the ledger, its row, its huella and its append-only triggers — and the triggers still FIRE", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "waitron-fiscal-receipt-"));
    const archivePath = join(scratch, "db.dump");
    const venueDir = join(scratch, "venue");
    try {
      // 1. The copy is not refused.
      await suite.db.archiveTo(archivePath);
      const sourceTriggers = triggersOf(suite.db);
      // A containment check: the migration files create other triggers too, and step 4 compares
      // the WHOLE set across the restore.
      expect(sourceTriggers.map((t) => t.name)).toEqual(
        expect.arrayContaining([
          `${LEDGER_TABLE}_append_only_delete`,
          `${LEDGER_TABLE}_append_only_update`,
        ]),
      );

      // 2. The archive is placed exactly as a cold restore places it.
      await restoreDatabase({
        dumpBytes: await readFile(archivePath),
        venueDir,
        log: () => {},
      });

      const restored = await openVenueDatabase(venueDir);
      try {
        // 3. The fiscal record landed, and it is the one that was seeded.
        const rows = restored.venue
          .all<{ huella: string }>(sql`select huella from registros_facturacion`)
          .map((row) => row.huella);
        expect(rows).toEqual([HUELLA]);

        // 4. The restored file carries the SAME triggers as the source — compared, not listed, so
        //    this says the same thing however the installer's text changes.
        expect(triggersOf(restored.venue)).toEqual(sourceTriggers);

        // 5. THE CONTROL, and the reason step 4 is not enough: trigger present ≠ trigger active.
        //    `run()` wraps the engine's error, so its `errcode` and text are on `.cause`.
        const refusal = (() => {
          try {
            restored.venue.run(
              sql`update registros_facturacion set huella = ${"E".repeat(64)} where sale_id = ${F.saleId}`,
            );
            return undefined;
          } catch (error) {
            return error as { cause?: { errcode?: number; message?: string } };
          }
        })();
        expect(
          refusal,
          "the restored ledger accepted an UPDATE — the append-only trigger is inert",
        ).toBeDefined();
        expect(refusal?.cause?.errcode).toBe(SQLITE_CONSTRAINT_TRIGGER);
        expect(refusal?.cause?.message).toMatch(/is append-only/);

        //    THE CONTROL IN THE OTHER DIRECTION, because a restored file that refused EVERY write
        //    would satisfy step 5 for the wrong reason: a table carrying no append-only trigger
        //    takes the same kind of UPDATE.
        restored.venue.run(sql`update tills set name = 'Caja renombrada'`);
        expect(
          restored.venue.all<{ name: string }>(sql`select name from tills`).map((row) => row.name),
        ).toEqual(["Caja renombrada"]);

        // The fiscal record is untouched by the refused attempt.
        expect(
          restored.venue
            .all<{ huella: string }>(sql`select huella from registros_facturacion`)
            .map((row) => row.huella),
        ).toEqual([HUELLA]);
      } finally {
        await restored.close();
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
