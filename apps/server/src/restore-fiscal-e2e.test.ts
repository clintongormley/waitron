// Every database here is a real venue DIRECTORY migrated by the product's own `applyMigrations`,
// which is what makes this an end-to-end proof rather than a fixture: the append-only triggers on
// `registros_facturacion`, and the schema every assertion reads, are the ones a box would carry.
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mediaImageData, mediaImages, readImageBytes } from "@waitron/media";
import {
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  readStandardSeriesId,
  sales,
  tenants,
  tills,
  withTransaction,
  type Database,
} from "@waitron/db";
import {
  FISCAL_RESTORE,
  cadenas,
  contadoresInstalacion,
  installationFloor,
  registroSif,
  registrosFacturacion,
} from "@waitron/fiscal-verifactu";
import {
  applyMigrations,
  expectedSchemaVersion,
  manifestSets,
  migrationOptionsFor,
} from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";
import { buildManifest, schemaVersionsByModule } from "./backup-manifest.js";
import { packArchive, type ArchiveEntry } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import {
  restoreFromArtifact,
  validateArtifact,
  writeValidated,
  type RestoreDeps,
} from "./restore.js";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import type { Logger } from "./logger.js";

const RECOVERY_KEY = "s3cr3t-recovery-key-for-fiscal-restore-e2e";
const BASELINE_MEDIA = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const HUELLA = "A".repeat(64);
const noopLog: Logger = () => {};
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

/**
 * Through the table definitions, not raw SQL: `id` and every `created_at` here is a `$defaultFn`
 * generator that only the insert builder runs, so a hand-written INSERT gets a NOT NULL refusal
 * (`packages/db/src/schema/columns.ts`).
 */
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
  await db
    .insert(invoiceSeries)
    .values({ id: F.seriesId, nodeId: F.nodeId, code: "FA", purpose: "standard", nextNumber: 5 });
  await db.insert(invoiceSeries).values({ nodeId: F.nodeId, code: "RE", purpose: "rectificative" });
  await db.insert(contadoresInstalacion).values({
    nif: "89890001K",
    idSistemaInformatico: "W1",
    proximoNumero: 2,
  });
  await db.insert(registroSif).values({
    id: F.sifId,
    nodeId: F.nodeId,
    nif: "89890001K",
    idSistemaInformatico: "W1",
    numeroInstalacion: 1,
  });
  await db.insert(sales).values({
    id: F.saleId,
    tillId: F.tillId,
    nodeId: F.nodeId,
    seriesId: F.seriesId,
    invoiceNumber: 4,
    issuedAt: "2026-07-20T19:20:30+01:00",
    issuedOffsetMinutes: 60,
    total: 0,
    vatBreakdown: [],
    locale: "es",
    invoiceLocales: ["es"],
    fiscalBackend: "verifactu",
    fiscalState: "recorded",
  });
  const [registro] = await db
    .insert(registrosFacturacion)
    .values({
      tillId: F.tillId,
      nodeId: F.nodeId,
      sifId: F.sifId,
      saleId: F.saleId,
      secuencia: 1,
      tipoRegistro: "alta",
      idEmisorFactura: "89890001K",
      numSerieFactura: "FA/4",
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
    })
    .returning({ id: registrosFacturacion.id });
  // The chain head: no row exists until an append or a registration creates one — insert it
  // explicitly, pointing at the record, at sequence 1 (both pointers set: `cadenas_puntero_ck`).
  await db.insert(cadenas).values({
    nodeId: F.nodeId,
    secuencia: 1,
    ultimoRegistroId: registro!.id,
    ultimaHuella: HUELLA,
  });
}

/**
 * The uploaded image, written through the table definitions so the fixture's bytes are exactly
 * `BASELINE_MEDIA`. What this suite asserts is that the RESTORE carries an image's metadata and
 * bytes across, and the read side still goes through the real `readImageBytes`. The filename has
 * the shape `media_images_filename_ck` requires, sha256 hex plus an extension; a `.jpg` row is one
 * configuration transfer can still bring in.
 */
async function seedImage(db: Database): Promise<void> {
  const filename = `${createHash("sha256").update(BASELINE_MEDIA).digest("hex")}.jpg`;
  const [row] = await db
    .insert(mediaImages)
    .values({
      filename,
      names: { es: "Pan" },
      altText: { es: "Una hogaza" },
      labels: ["Food"],
    })
    .returning({ id: mediaImages.id });
  await db.insert(mediaImageData).values({ imageId: row!.id, bytes: BASELINE_MEDIA });
}

let scratchRoot: string;
let migrationsRoot: string;
/** {@link migrationsRoot} plus one extra core migration — see the OLDER-artifact note in `beforeAll`. */
let olderMigrationsRoot: string;
let artifactPath: string;
let olderArtifactPath: string;

/** A brand-new empty venue directory: this engine's "create a fresh database". */
async function arrangeDirs(): Promise<{ stateDir: string; venueDir: string }> {
  return {
    stateDir: await mkdtemp(join(scratchRoot, "state-")),
    venueDir: await mkdtemp(join(scratchRoot, "venue-")),
  };
}

async function restoreDepsFor(
  dirs: { stateDir: string; venueDir: string },
  artifact = artifactPath,
): Promise<RestoreDeps> {
  return {
    artifact: await readFile(artifact),
    recoveryKey: RECOVERY_KEY,
    ...dirs,
    stagingDir: join(dirs.stateDir, "restore-staging"),
    // The OLDER artifact is one migration behind ITS root, not behind the shipped one.
    migrationsRoot: artifact === olderArtifactPath ? olderMigrationsRoot : migrationsRoot,
    modules: ALL_MODULES,
    environment: "preproduction",
    log: noopLog,
  };
}

async function drive(dirs: { stateDir: string; venueDir: string }, artifact = artifactPath) {
  return restoreFromArtifact(await restoreDepsFor(dirs, artifact));
}

/** The node's series as the assertions read them, oldest code first, booleans mapped in JavaScript. */
async function seriesOfNode(
  db: Database,
): Promise<{ code: string; retired: boolean; next: number }[]> {
  const rows = await db
    .select({
      code: invoiceSeries.code,
      retiredAt: invoiceSeries.retiredAt,
      next: invoiceSeries.nextNumber,
    })
    .from(invoiceSeries)
    .where(eq(invoiceSeries.nodeId, F.nodeId))
    .orderBy(invoiceSeries.code);
  return rows.map(({ code, retiredAt, next }) => ({ code, retired: retiredAt !== null, next }));
}

/** How many series are retired, whole table — counted in JavaScript, not by `count(*)` in SQL. */
async function retiredSeriesCount(db: Database): Promise<number> {
  const rows = await db.select({ retiredAt: invoiceSeries.retiredAt }).from(invoiceSeries);
  return rows.filter((row) => row.retiredAt !== null).length;
}

/**
 * Builds one encrypted backup artifact from a real migrated venue directory.
 *
 * `older: true` builds the SAME database and then drops `invoice_series.retired_at` from it, so the
 * artifact is genuinely one migration behind `olderMigrationsRoot` (which re-adds that column).
 */
async function buildArtifact(older: boolean, artifact: string): Promise<void> {
  const baselineDir = await mkdtemp(join(scratchRoot, older ? "baseline-older-" : "baseline-"));
  await applyMigrations(baselineDir, migrationOptionsFor(manifestSets(), null));
  const store = await openVenueDatabase(baselineDir);
  try {
    await seedFiscalRegistro(store.venue);
    await seedImage(store.venue);
    const head = await store.venue
      .select({ secuencia: cadenas.secuencia, ultimaHuella: cadenas.ultimaHuella })
      .from(cadenas);
    expect(head).toEqual([{ secuencia: 1, ultimaHuella: HUELLA }]);
    // The journal table is left alone: this database is at the head of the SHIPPED chain and one
    // behind `olderMigrationsRoot`, which is what the artifact's manifest then records.
    if (older) {
      store.venue.run(sql.raw(`alter table invoice_series drop column retired_at`));
    }
    const manifest = await buildManifest({
      db: store.venue,
      modules: ALL_MODULES,
      environment: "preproduction",
      now: new Date(),
    });
    const core = ALL_MODULES.find((m) => m.name === "core")!;
    expect(manifest.modules.core).toBe(
      expectedSchemaVersion(core.migrations, older ? olderMigrationsRoot : migrationsRoot) -
        (older ? 1 : 0),
    );

    // The engine's own copy statement. This is the shape `restoreDatabase` expects the archive's
    // `db.dump` entry to be — a whole SQLite venue file, not a `pg_dump` archive (`restore.ts`).
    const dumpPath = join(scratchRoot, `baseline-${older}.dump`);
    await store.venue.archiveTo(dumpPath);
    const entries: ArchiveEntry[] = [
      { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: "db.dump", bytes: await readFile(dumpPath) },
      {
        name: "secrets/trading.env",
        bytes: Buffer.from(
          formatEnvFile({
            WAITRON_TILL_TILL_ID: F.tillId,
            WAITRON_TILL_NODE_ID: F.nodeId,
            WAITRON_TILL_SERIES_ID: F.seriesId,
            WAITRON_TILL_LOCATION_ID: F.locationId,
            WAITRON_ENV: "preproduction",
          }),
        ),
      },
      { name: "secrets/secrets.env", bytes: Buffer.from("WAITRON_CREDENTIALS_KEY=deadbeef\n") },
    ];
    await writeFile(artifact, encryptArtifact(packArchive(entries), RECOVERY_KEY));
  } finally {
    await store.close();
  }
}

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  scratchRoot = await mkdtemp(join(tmpdir(), "waitron-restore-fiscal-e2e-"));
  migrationsRoot = join(scratchRoot, "migrations");
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  // The OLDER artifact needs a database one core migration behind the code it is restored with.
  // Rewinding the journal table cannot express that: no shipped core migration adds
  // `invoice_series.retired_at` (the baseline creates it), so no shipped step could re-add the
  // one the dump lacks. Instead the older restore gets its OWN
  // root: the shipped sets plus one extra core step that re-adds the column its dump lacks. The
  // dump is then genuinely one migration behind that root, and only the extra step replays.
  olderMigrationsRoot = join(scratchRoot, "migrations-older");
  await cp(migrationsRoot, olderMigrationsRoot, { recursive: true });
  const coreSet = ALL_MODULES.find((m) => m.name === "core")!.migrations;
  const extraTag = "9999_readd_retired_at";
  const olderCoreDir = join(olderMigrationsRoot, coreSet.name);
  await writeFile(
    join(olderCoreDir, `${extraTag}.sql`),
    `ALTER TABLE "invoice_series" ADD COLUMN "retired_at" text;`,
  );
  const journalPath = join(olderCoreDir, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
  };
  journal.entries.push({
    idx: journal.entries.length,
    version: "6",
    // Drizzle replays an entry only when its `when` is later than the newest applied row's
    // created_at, and every shipped `when` was stamped at `db:generate` time — in the past. The
    // SQLite dialect does the same arithmetic the PostgreSQL one did
    // (`drizzle-orm@0.45.2/sqlite-core/dialect.js:660`).
    when: Date.now(),
    tag: extraTag,
    breakpoints: true,
  });
  await writeFile(journalPath, JSON.stringify(journal));

  artifactPath = join(scratchRoot, "baseline.backup.enc");
  olderArtifactPath = join(scratchRoot, "older.backup.enc");
  await buildArtifact(false, artifactPath);
  await buildArtifact(true, olderArtifactPath);
}, 300_000);

afterAll(async () => {
  if (scratchRoot !== undefined) await rm(scratchRoot, { recursive: true, force: true });
});

describe("fiscal restore, end to end", () => {
  it("re-registers the SIF, retires and replaces the series, rewrites trading.env, keeps the ledger immutable", async () => {
    const dirs = await arrangeDirs();
    await drive(dirs);

    const store = await openVenueDatabase(dirs.venueDir);
    const db = store.venue;
    try {
      const sifs = await db
        .select({
          numeroInstalacion: registroSif.numeroInstalacion,
          revocadoEn: registroSif.revocadoEn,
        })
        .from(registroSif)
        .where(eq(registroSif.nodeId, F.nodeId))
        .orderBy(registroSif.numeroInstalacion);
      expect(sifs).toHaveLength(2);
      expect(sifs[0]).toMatchObject({ numeroInstalacion: 1 });
      expect(sifs[0]?.revocadoEn).not.toBeNull();
      expect(sifs[1]?.revocadoEn).toBeNull();
      expect(sifs[1]!.numeroInstalacion).toBeGreaterThanOrEqual(
        installationFloor(new Date(Date.now() - 60_000)),
      );
      const n = sifs[1]!.numeroInstalacion;
      const head = await db
        .select({ ultimaHuella: cadenas.ultimaHuella, secuencia: cadenas.secuencia })
        .from(cadenas)
        .where(eq(cadenas.nodeId, F.nodeId));
      expect(head[0]).toEqual({ ultimaHuella: null, secuencia: 1 });
      expect(await seriesOfNode(db)).toEqual([
        { code: "FA", retired: true, next: 5 },
        { code: `FA-${n}`, retired: false, next: 1 },
        { code: "RE", retired: true, next: 1 },
        { code: `RE-${n}`, retired: false, next: 1 },
      ]);
      const env = parseEnvFile(await readFile(join(dirs.stateDir, "trading.env"), "utf8"));
      expect(env.WAITRON_TILL_SERIES_ID).toBe(await readStandardSeriesId(db, F.nodeId));
      expect(env.WAITRON_TILL_NODE_ID).toBe(F.nodeId);
      // A key the rewrite does not touch survives it. `DATABASE_URL` used to stand here; it is
      // retired on this engine (`config.ts` reads no such value), and asserting a key the product
      // no longer has would be asserting nothing.
      expect(env.WAITRON_ENV).toBe("preproduction");
      expect(env.WAITRON_TILL_TILL_ID).toBe(F.tillId);
      expect(await readFile(join(dirs.stateDir, "secrets.env"), "utf8")).toBe(
        "WAITRON_CREDENTIALS_KEY=deadbeef\n",
      );
      await withTransaction(db, async (tx) => {
        // Through the table definitions: `names` and `labels` are JSON columns, and a raw
        // `select` hands them back as the TEXT they are stored as, so the assertion below would
        // be comparing a string with an object.
        const images = await tx
          .select({
            filename: mediaImages.filename,
            names: mediaImages.names,
            labels: mediaImages.labels,
          })
          .from(mediaImages);
        expect(images).toHaveLength(1);
        expect(images[0]).toMatchObject({ names: { es: "Pan" }, labels: ["Food"] });
        const restored = await readImageBytes(tx, images[0]!.filename);
        expect(restored?.bytes).toEqual(new Uint8Array(BASELINE_MEDIA));
      });
      const ledger = await db
        .select({ huella: registrosFacturacion.huella })
        .from(registrosFacturacion);
      expect(ledger).toHaveLength(1);
      // The restored ledger still REFUSES a rewrite. On PostgreSQL that refusal arrived as
      // SQLSTATE `WT001`; here it is the engine's own `SQLITE_CONSTRAINT_TRIGGER` carrying the
      // installer's message.
      //
      // WHERE to read it from depends on which call you make, which is why this is pinned rather
      // than described. The same UPDATE was sent both ways against this restored database on
      // 2026-09-22, Node v26.7.0: through `execute()` it comes back a plain `Error` with
      // `errcode: 1811`, `code: "ERR_SQLITE_ERROR"` and NO `cause`; through `run()` it comes back
      // a `DrizzleError` whose `cause.errcode` is 1811. `execute()` is this adapter's own method
      // (`packages/store/src/node-sqlite-adapter.ts`); `run()` is drizzle's, and drizzle wraps.
      // `restore-fiscal-receipt.test.ts` reads `.cause` because it calls `run()`.
      const blocked = ((): { errcode?: number; message?: string } | undefined => {
        try {
          db.execute(sql`update registros_facturacion set huella = ${"E".repeat(64)}`);
          return undefined;
        } catch (error) {
          return error as { errcode?: number; message?: string };
        }
      })();
      expect(
        blocked,
        "the restored ledger accepted an UPDATE — the append-only trigger is inert",
      ).toBeDefined();
      expect(blocked?.errcode).toBe(SQLITE_CONSTRAINT_TRIGGER);
      expect(blocked?.message).toMatch(/registros_facturacion is append-only/);
      expect(await schemaVersionsByModule(db, ALL_MODULES)).toEqual(
        Object.fromEntries(
          ALL_MODULES.map((m) => [m.name, expectedSchemaVersion(m.migrations, migrationsRoot)]),
        ),
      );
    } finally {
      await store.close();
    }
    await expect(stat(join(dirs.stateDir, "restore-staging", "db.dump"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 120_000);

  it("an OLDER artifact (one core migration behind) is migrated before the hook runs — and is NOT without the migrate step", async () => {
    const dirs = await arrangeDirs();
    await drive(dirs, olderArtifactPath);
    const store = await openVenueDatabase(dirs.venueDir);
    try {
      expect(await schemaVersionsByModule(store.venue, ALL_MODULES)).toEqual(
        Object.fromEntries(
          ALL_MODULES.map((m) => [
            m.name,
            expectedSchemaVersion(m.migrations, olderMigrationsRoot),
          ]),
        ),
      );
      expect(await retiredSeriesCount(store.venue)).toBe(2);
    } finally {
      await store.close();
    }
    // Control: with the migrate step stubbed out the hook reads a column the older dump lacks.
    const controlDirs = await arrangeDirs();
    // The refusal arrives with `errcode` and `message` on the error itself and no `.cause` — the
    // same place `execute()`'s refusals land in the case above. `errcode: 1` is SQLite's catch-all
    // `SQL logic error`, shared with a syntax error and a missing table (measured in #489), so the
    // column NAME in the message is what discriminates.
    await expect(
      restoreFromArtifact({
        ...(await restoreDepsFor(controlDirs, olderArtifactPath)),
        migrate: async () => {},
      }),
    ).rejects.toMatchObject({
      errcode: 1,
      message: expect.stringContaining("retired_at"),
    });
    await expect(stat(join(controlDirs.stateDir, "trading.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 120_000);

  it("NEGATIVE CONTROL — skipSecrets:true (the rejoin shape) leaves SIF, series and stateDir untouched", async () => {
    const dirs = await arrangeDirs();
    await restoreFromArtifact({ ...(await restoreDepsFor(dirs)), skipSecrets: true });
    const store = await openVenueDatabase(dirs.venueDir);
    try {
      const live = await store.venue
        .select({ numeroInstalacion: registroSif.numeroInstalacion })
        .from(registroSif)
        .where(isNull(registroSif.revocadoEn));
      expect(live).toEqual([{ numeroInstalacion: 1 }]);
      expect(await retiredSeriesCount(store.venue)).toBe(0);
    } finally {
      await store.close();
    }
    await expect(stat(join(dirs.stateDir, "trading.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 120_000);

  it("a failure AFTER the fiscal hook minted and the series were retired rolls everything back and writes no identity", async () => {
    // The real fiscal hook runs, then its outcome is replaced by a code the node already holds — the
    // orchestrator's insert collides after the retire, and the whole transaction (SIF included) must roll back.
    const sabotaged: WaitronModule[] = ALL_MODULES.map((m) =>
      m.name === "fiscal-verifactu"
        ? {
            ...m,
            backup: {
              ...m.backup,
              restore: async (tx, node) => ({
                ...(await FISCAL_RESTORE(tx, node)),
                series: [{ code: "FA", purpose: "standard" }],
              }),
            },
          }
        : m,
    );
    const dirs = await arrangeDirs();
    const rd = await restoreDepsFor(dirs);
    const validated = await validateArtifact(rd);
    await expect(writeValidated(validated, { ...rd, modules: sabotaged })).rejects.toMatchObject({
      code: "restore.hook_failed",
      params: { module: "fiscal-verifactu", code: "series.code_collision" },
    });
    const store = await openVenueDatabase(dirs.venueDir);
    try {
      const sifs = await store.venue
        .select({ numeroInstalacion: registroSif.numeroInstalacion })
        .from(registroSif);
      expect(sifs).toHaveLength(1); // the hook's new row rolled back
      const counter = await store.venue
        .select({ proximoNumero: contadoresInstalacion.proximoNumero })
        .from(contadoresInstalacion);
      expect(counter[0]?.proximoNumero).toBe(2); // the floor rolled back with it
      expect(await retiredSeriesCount(store.venue)).toBe(0);
    } finally {
      await store.close();
    }
    await expect(stat(join(dirs.stateDir, "trading.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(join(dirs.stateDir, "secrets.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 120_000);
});
