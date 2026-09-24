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
 * THE FISCAL RECEIPT, rebuilt for SQLite.
 *
 * This replaces the real-container case that lived in `pg-restore.test.ts`, which proved five
 * things about `pg_restore` reconstructing `registros_facturacion`:
 * the copy did not trip the append-only guard, the row landed, the `huella` survived byte for byte,
 * the triggers were present on the restored table, and — the control the case existed for, because
 * a trigger being PRESENT is not the same as it being ACTIVE — an UPDATE of the restored row was
 * refused. `docs/handoffs/2026-09-21-f1-step25-disposition.md` says this must be REBUILT rather
 * than retired, and all five are reachable on this engine.
 *
 * THE TRIGGER STATEMENTS IN `setup` BELOW ARE REDUNDANT, stated so nobody reads them as a claim
 * about the product. `useVenueDb` pairs each migration set with `installAppendOnlyTriggers` over the
 * tables that set declared (`packages/db/src/testing/venue-db.ts`), and
 * `migrationOptionsFor` carries the declared list through
 * (`packages/migrations/src/manifest.ts`), so this database already refuses what the box
 * refuses before a case runs. Measured 2026-09-23, with the control in the other direction: with the
 * `setup` loop below doing nothing the one case still passes, and with the declared list emptied as
 * well it fails (`expected [ …(22) ] to deeply equal ArrayContaining{…}`). The statements are
 * `create trigger if not exists`, which is why the duplicate is silent; their text is copied rather
 * than imported because `apps/server` does not depend on `@waitron/store`. The product's own
 * migrating paths install the same pair from the same list
 * (`migrateEverySet` in `packages/migrations/src/apply.ts`, which `applyMigrations` calls).
 * What the INSTALLER produces is pinned by `scripts/append-only-triggers.test.ts`; what is pinned
 * HERE is the restore — and the "present in the copy" assertion below compares the copy's whole
 * trigger set against the SOURCE's rather than against a hand-written list, so it says the same
 * thing whatever triggers the source carries.
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

/** Every trigger a venue file carries, name and statement, in name order. */
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
      // 1. The copy is not refused. `VACUUM INTO` copies pages; the append-only triggers are on
      //    UPDATE and DELETE, and a page copy is neither — but that is the claim, so it is run.
      await suite.db.archiveTo(archivePath);
      const sourceTriggers = triggersOf(suite.db);
      // The ledger's own pair is PRESENT — a containment check, not an exhaustive list of every
      // trigger in the database. The exhaustive form was only ever true because nothing else
      // created one; the triggers the migration files write — core's behavioural rules
      // (`packages/db/drizzle/0001_behavioural_triggers.sql`) among them — are legitimately here
      // too, and a list that grows with them says nothing about this ledger. What this case is for is
      // unchanged, and step 4 below still compares the WHOLE set across the restore.
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
        //    An UPDATE of the restored record must be REFUSED by the engine itself.
        //    Drizzle wraps a driver error in a `DrizzleQueryError` whose `errcode` and text live on
        //    `.cause` — the same indirection the PostgreSQL case had to describe for its SQLSTATE.
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
