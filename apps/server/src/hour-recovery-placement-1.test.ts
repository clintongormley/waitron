import {
  external,
  suite,
  node,
  binding,
  root,
  key,
  archiveHost,
  archiveCommand,
  bucketCommand,
  agreeInternet,
  restoreApp,
  archiveForm,
  recordedRecoveryRows,
  recoveryInvoices,
  managedHttp,
  interactiveHost,
} from "../test/hour-recovery-host.js";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("@waitron/verifactu", async (actual) => {
  const real = await actual<typeof import("@waitron/verifactu")>();
  return { ...real, createClient: vi.fn(real.createClient) };
});
import { invoiceSeries, openVenueDatabase, withTransaction, type Database } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import { readModulePreparationHistory } from "@waitron/provisioning";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { AppError, seriesId } from "@waitron/shared";
import type { WaitronModule } from "@waitron/module";
import { fakeSetlessModule } from "@waitron/module/src/testing/fake-module.js";
import { restoreFromArtifact, restoreFromArtifactFile } from "./restore.js";
import {
  createSelectedRecoveryPreparation,
  createInteractiveRecoveryPreparation,
} from "./recovery-preparation.js";
import { buildManifest } from "./backup-manifest.js";
import { writeStreamRestore } from "./restore-stream.js";
import { runRestore } from "./restore-command.js";
import { runStagedRestore, stageRestoreRequest } from "./restore-request.js";
import { deferFirstStart } from "./rebuild-first-start.js";
import { eq, sql } from "drizzle-orm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { recordSale } from "@waitron/core";
import { assertValid, computeHuella, createClient } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { VerifactuBackend } from "@waitron/fiscal-verifactu/src/backend.js";
import { drain } from "@waitron/fiscal-verifactu/src/drain.js";
import { decodeRegistroRow, fromRegistroRow } from "@waitron/fiscal-verifactu/src/registro-row.js";
import { saleInput, steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { createCloudRecoveryClient } from "./cloud-recovery.js";
import { encodeRecoveryKit } from "@waitron/stream";
import { expectChildKilled } from "./testing/child-process-death.js";

describe("selected-hour admission before archive placement", () => {
  it("the default restore command refuses a wrong node key before replacing the destination", async () => {
    const f = await archiveHost();
    const artifactPath = join(root, "command.backup.enc");
    const operationPath = join(root, "command-operation.json");
    await writeFile(artifactPath, f.restore.artifact);
    await writeFile(
      operationPath,
      JSON.stringify({ binding: f.options.binding, input: f.outcome.input }),
    );
    await writeFile(join(f.roots.venueDir, "venue.db"), "original destination database");
    await writeFile(join(f.roots.stateDir, "trading.env"), "original destination identity");
    const output: string[] = [];
    expect(
      await runRestore({
        argv: ["restore", artifactPath, "--confirm-old-box-gone"],
        env: {
          WAITRON_ENV: "dev",
          WAITRON_STATE_DIR: f.roots.stateDir,
          WAITRON_VENUE_DIR: f.roots.venueDir,
          WAITRON_BACKUP_RECOVERY_KEY: "archive password",
          WAITRON_RECOVERY_OPERATION_FILE: operationPath,
          WAITRON_NODE_RECOVERY_KEY: "wrong node key",
        },
        out: (line) => output.push(line),
        restore: (request) => restoreFromArtifactFile({ ...request, migrationsRoot: null }),
      }),
    ).toBe(1);
    expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
      "original destination database",
    );
    expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
      "original destination identity",
    );
    expect(output.join("\n")).toContain(
      "restore failed: promotion.break_glass_invalid — use the selected backup's node recovery key",
    );
  });

  it.each(["archive", "stream"] as const)(
    "allows a lower surviving %s history while retaining the recovered counters",
    async (kind) => {
      const f = await archiveHost(kind);
      await suite.db.update(invoiceSeries).set({ nextNumber: 456 });
      await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
      if (kind === "archive")
        await restoreFromArtifact({
          ...f.restore,
          modules: f.service.modules,
          withModuleOperations: f.service.runner(f.outcome.input),
        });
      else
        await writeStreamRestore({
          ...f.restore,
          databasePath: f.database,
          entries: f.entries,
          modules: f.service.modules,
          withModuleOperations: f.service.runner(f.outcome.input),
        });
      const result = await openVenueDatabase(f.roots.venueDir);
      try {
        const rows = await result.venue.select().from(invoiceSeries);
        expect(
          rows
            .filter((row) => row.retiredAt !== null)
            .map(({ code, nextNumber }) => ({ code, nextNumber })),
        ).toEqual([
          { code: "A-0CNNY", nextNumber: 123 },
          { code: "FF-0CNNY", nextNumber: 123 },
          { code: "R-0CNNY", nextNumber: 123 },
        ]);
        expect(
          rows
            .filter((row) => row.retiredAt === null)
            .map(({ code, nextNumber }) => ({ code, nextNumber })),
        ).toEqual([
          { code: "A-0CNQT", nextNumber: 1 },
          { code: "FF-0CNQT", nextNumber: 1 },
          { code: "R-0CNQT", nextNumber: 1 },
        ]);
        expect(await result.venue.select().from(fiscalAllocations)).toHaveLength(2);
      } finally {
        await result.close();
      }
    },
  );

  it("places an admitted archive and retires recovered series without changing their counters", async () => {
    const f = await archiveHost();
    const original = await suite.db.select().from(invoiceSeries);
    await restoreFromArtifact({
      ...f.restore,
      modules: f.service.modules,
      withModuleOperations: f.service.runner(f.outcome.input),
    });
    const placed = await openVenueDatabase(f.roots.venueDir);
    try {
      const after = await placed.venue.select().from(invoiceSeries);
      for (const row of original)
        expect(after.find((entry) => entry.id === row.id)).toEqual({
          ...row,
          retiredAt: expect.any(Date),
        });
      expect(
        after
          .filter((row) => row.retiredAt === null)
          .map(({ code, nextNumber }) => ({ code, nextNumber })),
      ).toEqual([
        { code: "A-0CNQT", nextNumber: 1 },
        { code: "FF-0CNQT", nextNumber: 1 },
        { code: "R-0CNQT", nextNumber: 1 },
      ]);
      expect(await placed.venue.select().from(fiscalAllocations)).toHaveLength(2);
    } finally {
      await placed.close();
    }
  });

  it.each(["archive", "file", "stream", "managed"] as const)(
    "%s recovery retains issued invoices and filing receipts before selling on the fresh hour",
    async (source) => {
      const clock = {
        ...steadyClock,
        now: () => ({ ...steadyClock.now(), instant: new Date(), offsetMinutes: 120 }),
      };
      const aeat = createFakeAeat({ serverNow: new Date() });
      const aeatClients = vi.fn(() => aeat.client());
      const backend = (db: Database) =>
        new VerifactuBackend({
          db,
          clock,
          deploymentEnvironment: "preproduction",
          environment: "preproduction",
          resolveClient: async () => aeatClients(),
        });
      const sell = (db: Database, id: string) =>
        withTransaction(db, (tx) =>
          recordSale(
            tx,
            backend(db),
            saleInput({
              nodeId: node.nodeId,
              seriesId: seriesId(id),
              clock,
              settlement: {
                kind: "immediate",
                tenders: [
                  { method: "card", amount: "16.31", tipAmount: "1.90", settledAt: new Date() },
                ],
              },
            }),
          ),
        );
      const [standard] = await suite.db
        .select()
        .from(invoiceSeries)
        .where(eq(invoiceSeries.code, "A-0CNNY"));
      const first = await sell(suite.db, standard!.id);
      const submitted = await drain(
        {
          db: suite.db,
          resolveClient: async () => aeatClients(),
          environment: "preproduction",
          skipRetryMs: 300_000,
        },
        new Date(),
      );
      expect(submitted.recordsAccepted).toBe(1);
      const second = await sell(suite.db, standard!.id);
      const snapshot = async (db: Database) => ({
        sales: (await db.execute(sql`select * from sales order by id`)).rows,
        lines: (await db.execute(sql`select * from sale_lines order by sale_id, line_no`)).rows,
        tenders: (await db.execute(sql`select * from tenders order by id`)).rows,
        settlements: (await db.execute(sql`select * from sale_settlements order by id`)).rows,
        records: (await db.execute(sql`select * from registros_facturacion order by secuencia`))
          .rows,
        submissions: (await db.execute(sql`select * from envios order by registro_id`)).rows,
      });
      const before = await snapshot(suite.db);
      expect(before.records.map((row) => row.num_serie_factura)).toEqual([
        "A-0CNNY/123",
        "A-0CNNY/124",
      ]);
      expect(before.records[1]?.anterior_huella).toBe(before.records[0]?.huella);
      expect(
        before.submissions.find((row) => row.registro_id === before.records[0]?.id),
      ).toMatchObject({
        estado: "aceptado",
        intentos: 1,
        csv: expect.any(String),
        confirmado_en: expect.any(String),
      });
      expect(
        before.submissions.find((row) => row.registro_id === before.records[1]?.id),
      ).toMatchObject({
        estado: "pendiente",
        intentos: 0,
        csv: null,
        confirmado_en: null,
      });
      for (const row of before.records) {
        const record = fromRegistroRow(decodeRegistroRow(row));
        assertValid(record);
        expect(computeHuella(record)).toBe(row.huella);
      }
      const originalSeries = await suite.db.select().from(invoiceSeries);
      const aeatBefore = {
        clients: aeatClients.mock.calls.length,
        built: vi.mocked(createClient).mock.calls.length,
      };
      const fetched = vi.spyOn(globalThis, "fetch");
      const f = await archiveHost(source === "stream" ? "stream" : "archive");
      const common = {
        ...f.restore,
        modules: f.service.modules,
        withModuleOperations: f.service.runner(f.outcome.input),
      };
      if (source === "stream") {
        await writeStreamRestore({ ...common, databasePath: f.database, entries: f.entries });
      } else if (source === "file") {
        const artifactPath = join(root, "historical.backup.enc");
        await writeFile(artifactPath, f.restore.artifact);
        await restoreFromArtifactFile({ ...common, artifactPath });
      } else if (source === "managed") {
        const pointId = "047bacd4-df70-4881-a835-c6dd75ae7ecf";
        const point = {
          id: pointId,
          venueId: node.locationId,
          capturedAt: new Date().toISOString(),
          modules: (
            await buildManifest({
              db: suite.db,
              node: suite.node,
              modules: ALL_MODULES,
              environment: "preproduction",
              now: new Date(),
            })
          ).modules,
          digest: createHash("sha256").update(f.restore.artifact).digest("hex"),
          size: f.restore.artifact.length,
          objectKey: `snapshots/${pointId}`,
          verification: "verified",
          kind: "snapshot",
          deleting: false,
          deletedAt: null,
        };
        const expiresAt = new Date(Date.now() + 900_000).toISOString();
        const client = createCloudRecoveryClient({
          stateDir: f.roots.stateDir,
          origin: "https://cloud.example.test",
          environment: "preproduction",
          fetch: async (url, init) => {
            const action = new URL(String(url)).pathname.split("/").at(-1);
            const body = JSON.parse(String(init?.body)) as { payload: string };
            if (action === "start" || action === "status")
              return Response.json({
                requestId: JSON.parse(Buffer.from(body.payload, "base64url").toString())[2],
                state: action === "start" ? "awaiting_owner" : "approved",
                expiresAt,
                operationId:
                  action === "start"
                    ? null
                    : JSON.parse(Buffer.from(body.payload, "base64url").toString())[2],
              });
            if (action === "info") return Response.json({ point, operationExpiresAt: expiresAt });
            if (action === "read")
              return Response.json({
                point,
                location: {
                  endpoint: "https://store.example.test",
                  bucket: "copy",
                  region: "local",
                },
                credentials: {
                  accessKeyId: "unused",
                  secretAccessKey: "unused",
                  sessionToken: "unused",
                },
                recoveryKey: "archive password",
                expiresAt,
                operationExpiresAt: expiresAt,
              });
            throw new Error(`unexpected Cloud recovery action ${action}`);
          },
          download: async () => f.restore.artifact,
        });
        await client.start();
        await client.restore(async (request) => {
          await restoreFromArtifact({ ...common, ...request });
        }, pointId);
      } else {
        await restoreFromArtifact(common);
      }
      expect({
        clients: aeatClients.mock.calls.length,
        built: vi.mocked(createClient).mock.calls.length,
      }).toEqual(aeatBefore);
      expect(fetched.mock.calls).toEqual([]);
      fetched.mockRestore();
      const placed = await openVenueDatabase(f.roots.venueDir);
      try {
        expect(await snapshot(placed.venue)).toEqual(before);
        const series = await placed.venue.select().from(invoiceSeries);
        for (const row of originalSeries)
          expect(series.find((entry) => entry.id === row.id)).toEqual({
            ...row,
            retiredAt: expect.any(Date),
          });
        expect(
          series
            .filter((row) => row.retiredAt === null)
            .map(({ code, nextNumber }) => ({ code, nextNumber })),
        ).toEqual([
          { code: "A-0CNQT", nextNumber: 1 },
          { code: "FF-0CNQT", nextNumber: 1 },
          { code: "R-0CNQT", nextNumber: 1 },
        ]);
        await expect(sell(placed.venue, standard!.id)).rejects.toMatchObject({
          code: "sale.series_retired",
        });
        const fresh = series.find((row) => row.code === "A-0CNQT")!;
        const resumed = await sell(placed.venue, fresh.id);
        const afterSale = await snapshot(placed.venue);
        expect(afterSale.sales.filter((row) => row.id !== resumed.saleId)).toEqual(before.sales);
        expect(afterSale.lines.filter((row) => row.sale_id !== resumed.saleId)).toEqual(
          before.lines,
        );
        expect(afterSale.tenders.filter((row) => row.sale_id !== resumed.saleId)).toEqual(
          before.tenders,
        );
        expect(afterSale.settlements.filter((row) => row.sale_id !== resumed.saleId)).toEqual(
          before.settlements,
        );
        expect(afterSale.records.filter((row) => row.sale_id !== resumed.saleId)).toEqual(
          before.records,
        );
        expect(
          afterSale.submissions.filter(
            (row) =>
              !afterSale.records.some(
                (record) => record.sale_id === resumed.saleId && record.id === row.registro_id,
              ),
          ),
        ).toEqual(before.submissions);
        expect(afterSale.records.find((row) => row.sale_id === resumed.saleId)).toMatchObject({
          num_serie_factura: "A-0CNQT/1",
          primer_registro: 1,
          anterior_huella: null,
        });
        expect(afterSale.sales.map((row) => row.id).sort()).toEqual(
          [first.saleId, second.saleId, resumed.saleId].sort(),
        );
        expect(await placed.venue.select().from(fiscalAllocations)).toHaveLength(2);
      } finally {
        await placed.close();
      }
    },
  );

  it("refreshes reconstructed recovery clocks before archive admission without changing its hour", async () => {
    const f = await archiveHost();
    const before = await readModulePreparationHistory(f.roots, binding.module);
    external.internet.mockImplementation(async () => ({
      source: "internet",
      result: "usable",
      instantMs: Date.now(),
      uncertaintyMs: 0,
      wallStartedMs: Date.now(),
      wallFinishedMs: Date.now(),
      monotonicStartedMs: performance.now(),
      monotonicFinishedMs: performance.now(),
    }));
    const reconstructed = createSelectedRecoveryPreparation(f.options);
    await restoreFromArtifact({
      ...f.restore,
      withModuleOperations: reconstructed.runner(f.outcome.input, { refresh: true }),
    });
    const restored = await openVenueDatabase(f.roots.venueDir);
    try {
      expect(
        (await restored.venue.select().from(invoiceSeries))
          .filter((row) => row.retiredAt === null)
          .map(({ code, nextNumber }) => ({ code, nextNumber })),
      ).toEqual([
        { code: "A-0CNQT", nextNumber: 1 },
        { code: "FF-0CNQT", nextNumber: 1 },
        { code: "R-0CNQT", nextNumber: 1 },
      ]);
    } finally {
      await restored.close();
    }
    expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(before);
  });

  it("the default archive command reconstructs selected-hour preparation with explicit isolation", async () => {
    const f = await archiveHost();
    const command = await archiveCommand(f);
    const journal = await readModulePreparationHistory(f.roots, binding.module);
    external.internet.mockImplementation(async () => ({
      source: "internet",
      result: "usable",
      instantMs: Date.now(),
      uncertaintyMs: 0,
      wallStartedMs: Date.now(),
      wallFinishedMs: Date.now(),
      monotonicStartedMs: performance.now(),
      monotonicFinishedMs: performance.now(),
    }));
    const output: string[] = [];
    const result = await runRestore({
      ...command,
      out: (line) => output.push(line),
    });
    expect(output.join("\n")).toContain(`restored ${command.artifactPath}`);
    expect(result).toBe(0);
    const restored = await openVenueDatabase(f.roots.venueDir);
    try {
      const rows = await restored.venue.select().from(invoiceSeries);
      expect(rows.filter((row) => row.retiredAt === null).map((row) => row.code)).toEqual([
        "A-0CNQT",
        "FF-0CNQT",
        "R-0CNQT",
      ]);
      expect(rows.filter((row) => row.retiredAt !== null).map((row) => row.nextNumber)).toEqual([
        123, 123, 123,
      ]);
      expect(await restored.venue.select().from(fiscalAllocations)).toHaveLength(2);
    } finally {
      await restored.close();
    }
    expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(journal);
    expect(output.join("\n")).not.toContain(key.secret);
    expect(output.join("\n")).not.toContain("archive password");
  });

  it("an archive command whose restore hooks fail after placement leaves no identity beside the database, and finishes when run again", async () => {
    const f = await archiveHost();
    const command = await archiveCommand(f);
    agreeInternet();
    await suite.db.update(invoiceSeries).set({ nextNumber: 456 });
    await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
    await suite.node.archiveTo(join(f.roots.venueDir, "node.db"));
    const oldIdentity = `# the box being replaced\nWAITRON_NODE_ID=${node.nodeId}\n`;
    await writeFile(join(f.roots.stateDir, "trading.env"), oldIdentity, { mode: 0o600 });
    const refusing: WaitronModule = {
      ...fakeSetlessModule("refusing-hook", "core"),
      backup: {
        restore: async () => {
          throw new AppError("module.operation_invalid", { module: "refusing-hook" });
        },
      },
    };
    const output: string[] = [];
    expect(
      await runRestore({
        ...command,
        out: (line) => output.push(line),
        restore: (request) =>
          restoreFromArtifactFile({ ...request, modules: [...request.modules, refusing] }),
      }),
    ).toBe(1);
    expect(output.at(-1)).toBe(
      "restore failed: restore.hook_failed (module refusing-hook: module.operation_invalid)",
    );
    await expect(readFile(join(f.roots.stateDir, "trading.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(join(f.roots.stateDir, "trading.env.replaced"), "utf8")).toBe(
      oldIdentity,
    );
    await expect(
      readFile(join(f.roots.stateDir, "flows/restore/record.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const placed = await openVenueDatabase(f.roots.venueDir);
    try {
      expect(
        (await placed.venue.select().from(invoiceSeries)).map(({ nextNumber, retiredAt }) => ({
          nextNumber,
          retired: retiredAt !== null,
        })),
      ).toEqual([
        { nextNumber: 123, retired: false },
        { nextNumber: 123, retired: false },
        { nextNumber: 123, retired: false },
      ]);
      expect(await placed.venue.select().from(fiscalAllocations)).toHaveLength(1);
    } finally {
      await placed.close();
    }

    const again: string[] = [];
    expect(await runRestore({ ...command, out: (line) => again.push(line) })).toBe(0);
    expect(again.at(-1)).toBe(`restored ${command.artifactPath}`);
    expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
      `WAITRON_NODE_ID=${node.nodeId}\n`,
    );
    expect(await readFile(join(f.roots.stateDir, "trading.env.replaced"), "utf8")).toBe(
      oldIdentity,
    );
    const restored = await openVenueDatabase(f.roots.venueDir);
    try {
      expect(
        (await restored.venue.select().from(invoiceSeries))
          .filter((row) => row.retiredAt === null)
          .map((row) => row.code),
      ).toEqual(["A-0CNQT", "FF-0CNQT", "R-0CNQT"]);
    } finally {
      await restored.close();
    }
  });

  it("the bucket command reconstructs selected-hour admission from the downloaded exact point", async () => {
    const { f, deps, kitPath } = await bucketCommand();
    const journal = await readModulePreparationHistory(f.roots, binding.module);
    const output: string[] = [];
    const downloader = join(root, "synthetic-litestream.cjs");
    await writeFile(
      downloader,
      `#!${process.execPath}\nrequire("node:fs").copyFileSync(${JSON.stringify(f.database)}, process.argv[process.argv.indexOf("-o") + 1]);\n`,
      { mode: 0o700 },
    );
    const result = await runRestore({
      ...deps,
      env: { ...deps.env, WAITRON_LITESTREAM_BIN: downloader },
      restoreStream: undefined,
      out: (line) => output.push(line),
    });
    expect(output.at(-1)).toBe(`restored from the bucket named in ${kitPath}`);
    expect(result).toBe(0);
    const restored = await openVenueDatabase(f.roots.venueDir);
    try {
      const rows = await restored.venue.select().from(invoiceSeries);
      expect(rows.filter((row) => row.retiredAt === null).map((row) => row.code)).toEqual([
        "A-0CNSP",
        "FF-0CNSP",
        "R-0CNSP",
      ]);
      expect(rows.filter((row) => row.retiredAt !== null).map((row) => row.nextNumber)).toEqual([
        123, 123, 123,
      ]);
      expect(await restored.venue.select().from(fiscalAllocations)).toHaveLength(2);
    } finally {
      await restored.close();
    }
    expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(journal);
    expect(output.join("\n")).not.toContain(key.secret);
    expect(output.join("\n")).not.toContain("separate bucket password");
    expect(
      (await readdir(join(f.roots.stateDir, "scratch"))).filter((name) =>
        name.startsWith("stream-restore-"),
      ),
    ).toEqual([]);
  });

  it.each([
    ["offline", "sif.allocation_invalid"],
    ["disagreement", "sif.allocation_invalid"],
    ["old seller", "sif.allocation_invalid"],
    ["missing sole confirmation", "sif.allocation_invalid"],
    ["wrong node key", "promotion.break_glass_invalid"],
    ["wrong bucket password", "recovery.passphrase_invalid"],
    ["changed point", "module.operation_invalid"],
    ["unconfirmed venue", "restore.stream_venue_unconfirmed"],
  ])("the bucket command retains the destination after %s", async (reason, code) => {
    const { f, command, kitPath, kit, deps, failures } = await bucketCommand();
    if (reason === "offline")
      external.internet.mockResolvedValue({
        source: "internet",
        result: "unavailable",
        reason: "offline",
      });
    if (reason === "disagreement")
      external.internet.mockImplementation(async () => ({
        source: "internet",
        result: "usable",
        instantMs: Date.now() + 180_000,
        uncertaintyMs: 0,
        wallStartedMs: Date.now(),
        wallFinishedMs: Date.now(),
        monotonicStartedMs: performance.now(),
        monotonicFinishedMs: performance.now(),
      }));
    if (reason === "old seller")
      deps.argv = deps.argv.filter((arg) => arg !== "--confirm-old-box-gone");
    if (reason === "missing sole confirmation")
      deps.argv = deps.argv.filter((arg) => arg !== "--confirm-sole-recovery");
    if (reason === "wrong node key") command.env.WAITRON_NODE_RECOVERY_KEY = "wrong node key";
    if (reason === "wrong bucket password")
      await writeFile(kitPath, encodeRecoveryKit({ ...kit, recoveryKey: "wrong bucket password" }));
    if (reason === "unconfirmed venue")
      deps.argv[deps.argv.indexOf("--confirm-venue") + 1] = "another taxpayer";
    if (reason === "changed point") {
      await suite.db.update(invoiceSeries).set({ nextNumber: 789 });
      await suite.db.archiveTo(f.database);
    }
    await suite.db.update(invoiceSeries).set({ nextNumber: 456 });
    await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
    const previous = await suite.db.select().from(invoiceSeries);
    const allocations = await suite.db.select().from(fiscalAllocations);
    await writeFile(join(f.roots.stateDir, "trading.env"), "untouched bucket destination");
    const journal = await readModulePreparationHistory(f.roots, binding.module);
    const output: string[] = [];
    expect(await runRestore({ ...deps, out: (line) => output.push(line) })).toBe(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ code });
    const retained = await openVenueDatabase(f.roots.venueDir);
    try {
      expect(await retained.venue.select().from(invoiceSeries)).toEqual(previous);
      expect(await retained.venue.select().from(fiscalAllocations)).toEqual(allocations);
    } finally {
      await retained.close();
    }
    expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
      "untouched bucket destination",
    );
    expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(journal);
    expect(output.join("\n")).not.toContain(key.secret);
    expect(output.join("\n")).not.toContain(kit.recoveryKey);
    expect(
      (await readdir(join(f.roots.stateDir, "scratch"))).filter((name) =>
        name.startsWith("stream-restore-"),
      ),
    ).toEqual([]);
  });

  it("carries explicit HTTP archive isolation through staging and reconstructed activation", async () => {
    const history = await recoveryInvoices();
    const f = await archiveHost();
    const app = restoreApp({
      stageRestore: (request) => stageRestoreRequest(f.roots.stateDir, request),
    });
    const context = {
      selectedSourceId: f.options.selected.sourceId,
      oldBoxGone: true,
      soleRecovery: true,
    };
    const response = await app.request("https://box.test/setup-api/restore", {
      method: "POST",
      body: archiveForm(f, context),
    });
    expect(response.status).toBe(202);
    const marker = JSON.parse(
      await readFile(join(f.roots.stateDir, "flows/restore/record.json"), "utf8"),
    );
    expect(marker.request).toHaveProperty("recoveryContext", context);
    expect(JSON.stringify(marker)).not.toContain(key.secret);
    agreeInternet();
    expect(await runStagedRestore(f.restore)).toBe(true);
    const placed = await openVenueDatabase(f.roots.venueDir);
    try {
      expect(await recordedRecoveryRows(placed.venue)).toEqual(history);
      const rows = await placed.venue.select().from(invoiceSeries);
      expect(rows.filter((row) => row.retiredAt === null).map((row) => row.code)).toEqual([
        "A-0CNQT",
        "FF-0CNQT",
        "R-0CNQT",
      ]);
      expect(rows.filter((row) => row.retiredAt !== null).map((row) => row.nextNumber)).toEqual([
        125, 123, 123,
      ]);
    } finally {
      await placed.close();
    }
  });

  it.each([
    null,
    {},
    { selectedSourceId: "", oldBoxGone: true, soleRecovery: true },
    { selectedSourceId: "selected", oldBoxGone: "true", soleRecovery: true },
    { selectedSourceId: "selected", oldBoxGone: true, soleRecovery: 1 },
    { selectedSourceId: "selected", oldBoxGone: true, soleRecovery: true, extra: true },
  ])("refuses malformed HTTP archive recovery context %j before staging", async (context) => {
    const f = await archiveHost();
    const app = restoreApp({
      stageRestore: (request) => stageRestoreRequest(f.roots.stateDir, request),
    });
    const response = await app.request("https://box.test/setup-api/restore", {
      method: "POST",
      body: archiveForm(f, context),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "setup.request_invalid", params: { field: "recoveryContext" } },
    });
    await expect(
      readFile(join(f.roots.stateDir, "flows/restore/record.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
  });

  it.each(["before", "after"] as const)(
    "retries the whole managed restore after completion is lost %s local acknowledgement",
    async (when) => {
      const f = await archiveHost();
      const managed = await managedHttp(f);
      agreeInternet();
      await expect(
        runStagedRestore({
          ...f.restore,
          onManagedCloudRestored: async (binding) => {
            if (when === "after") await managed.client().markRestored(binding);
            throw new Error("lost local acknowledgement");
          },
        }),
      ).rejects.toThrow("lost local acknowledgement");
      expect(
        JSON.parse(await readFile(join(f.roots.stateDir, "flows/restore/record.json"), "utf8")),
      ).toHaveProperty("request");
      expect(
        JSON.parse(await readFile(join(f.roots.stateDir, "flows/restore/record.json"), "utf8")),
      ).toMatchObject({
        phase: "placing",
        request: { managedCloud: { pointId: managed.pointId } },
      });
      expect(await deferFirstStart(f.roots.stateDir, vi.fn())).toEqual({
        mayStream: false,
        failedSince: null,
      });
      const placed = await openVenueDatabase(f.roots.venueDir);
      let rows;
      let allocations;
      try {
        await placed.venue
          .update(invoiceSeries)
          .set({ nextNumber: 917 })
          .where(eq(invoiceSeries.code, "A-0CNQT"));
        rows = (await placed.venue.select().from(invoiceSeries)).map(
          ({ code, nextNumber, retiredAt }) => ({
            code,
            nextNumber: retiredAt === null ? 1 : nextNumber,
            retired: retiredAt !== null,
          }),
        );
        allocations = (await placed.venue.select().from(fiscalAllocations)).map(
          ({ eventKey, installationIdentity }) => ({ eventKey, installationIdentity }),
        );
      } finally {
        await placed.close();
      }
      external.internet.mockClear();
      expect(
        await runStagedRestore({
          ...f.restore,
          onManagedCloudRestored: (binding) => managed.client().markRestored(binding),
        }),
      ).toBe(true);
      expect(
        JSON.parse(await readFile(join(f.roots.stateDir, "flows/restore/record.json"), "utf8")),
      ).not.toHaveProperty("request");
      expect(await managed.client().replacementIdentity()).toMatchObject({
        phase: "restored",
        pointId: managed.pointId,
      });
      await managed.client().reportRestored();
      expect(await managed.client().replacementIdentity()).toMatchObject({ phase: "reported" });
      const completed = await managed.client().binding();
      await expect(
        managed.client().markRestored({
          requestId: completed.requestId,
          pointId: "715955bb-2dbd-4481-9746-f6d3e95a8651",
        }),
      ).rejects.toThrow("Cloud recovery is unavailable");
      await managed
        .client()
        .markRestored({ requestId: completed.requestId, pointId: managed.pointId });
      expect(await managed.client().replacementIdentity()).toMatchObject({ phase: "reported" });
      const replay = await openVenueDatabase(f.roots.venueDir);
      try {
        expect(
          (await replay.venue.select().from(invoiceSeries)).map(
            ({ code, nextNumber, retiredAt }) => ({
              code,
              nextNumber,
              retired: retiredAt !== null,
            }),
          ),
        ).toEqual(rows);
        expect(
          (await replay.venue.select().from(fiscalAllocations)).map(
            ({ eventKey, installationIdentity }) => ({ eventKey, installationIdentity }),
          ),
        ).toEqual(allocations);
      } finally {
        await replay.close();
      }
      expect(external.internet).toHaveBeenCalled();
    },
  );

  it.each(["archive", "stream"] as const)(
    "restarts publication after %s process death inside the uncommitted activation",
    async (kind) => {
      const f = await archiveHost(kind);
      const credentials = {
        environment: "preproduction" as const,
        recoveryOperation: { binding: f.options.binding, input: f.outcome.input },
        nodeRecoverySecret: key.secret,
        recoveryContext: {
          selectedSourceId: f.options.selected.sourceId,
          oldBoxGone: true,
          soleRecovery: true,
        },
      };
      await stageRestoreRequest(
        f.roots.stateDir,
        kind === "archive"
          ? { ...credentials, artifact: f.restore.artifact, recoveryKey: "archive password" }
          : { ...credentials, kind: "stream", databasePath: f.database, entries: f.entries },
      );
      const original = new URL(
        "../../../packages/fiscal-verifactu/src/allocation-preparation.ts",
        import.meta.url,
      ).href;
      const wrapper = `import * as actual from ${JSON.stringify(original)};
      export * from ${JSON.stringify(original)};
      export async function activatePreparedModuleAllocation(tx, node, operation) {
        const outcome = await actual.activatePreparedModuleAllocation(tx, node, operation);
        if (operation.binding.action === "restore") {
          process.stdout.write("activation-writes-before-commit\\n");
          process.kill(process.pid, "SIGKILL");
        }
        return outcome;
      }`;
      const internet = `export async function authenticatedHourHead() { throw new Error("this test makes no network request"); } export async function observeInternetHourClock() { return { source: "internet", result: "usable", instantMs: Date.now(), uncertaintyMs: 0, wallStartedMs: Date.now(), wallFinishedMs: Date.now(), monotonicStartedMs: performance.now(), monotonicFinishedMs: performance.now() }; }`;
      // Holds the child for over a second of real time, once, between its clock reading and the
      // re-check, so a child whose wall and elapsed-time clocks disagree is refused on every run.
      const release = `let held = false; export function readHourRelease() { if (!held) { held = true; const end = process.hrtime.bigint() + 1_100_000_000n; while (process.hrtime.bigint() < end); } return { instantMs: Date.parse("2026-10-15T00:00:00Z") }; }`;
      const source = `import { registerHooks } from "node:module";
      const RealDate = Date;
      globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ["2026-10-16T12:42:01Z"])); } static now() { return RealDate.parse("2026-10-16T12:42:01Z"); } };
      Object.defineProperty(performance, "now", { value: () => 0 });
      registerHooks({ resolve(specifier, context, next) {
        const replacement = specifier.endsWith("/allocation-preparation.js") ? ${JSON.stringify(wrapper)} : specifier.endsWith("/hour-clock-internet.js") ? ${JSON.stringify(internet)} : specifier.endsWith("/hour-release.js") ? ${JSON.stringify(release)} : undefined;
        return replacement === undefined ? next(specifier, context) : { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(replacement) };
      }});
      const { runStagedRestore } = await import(${JSON.stringify(new URL("./restore-request.ts", import.meta.url).href)});
      await runStagedRestore({ ...JSON.parse(process.argv[1]), log() {} });`;
      await expectChildKilled(
        promisify(execFile)(
          process.execPath,
          [
            "--import",
            import.meta.resolve("tsx"),
            "--input-type=module",
            "-e",
            source,
            JSON.stringify({ ...f.roots, migrationsRoot: null }),
          ],
          { timeout: 45_000 },
        ),
        { signal: "SIGKILL", stdout: "activation-writes-before-commit\n" },
      );
      const marker = await readFile(join(f.roots.stateDir, "flows/restore/record.json"), "utf8");
      expect(JSON.parse(marker)).toMatchObject({ phase: "placing" });
      expect(await readdir(f.roots.stateDir)).not.toContain("trading.env");
      const destination = await openVenueDatabase(f.roots.venueDir);
      let rows;
      let allocations;
      try {
        rows = await destination.venue.select().from(invoiceSeries);
        allocations = await destination.venue.select().from(fiscalAllocations);
        expect(
          rows
            .filter((row) => row.retiredAt === null)
            .map((row) => ({ code: row.code, nextNumber: row.nextNumber })),
        ).toEqual([
          { code: "A-0CNNY", nextNumber: 123 },
          { code: "FF-0CNNY", nextNumber: 123 },
          { code: "R-0CNNY", nextNumber: 123 },
        ]);
        expect(allocations).toHaveLength(1);
      } finally {
        await destination.close();
      }
      const journal = await readModulePreparationHistory(f.roots, binding.module);
      agreeInternet();
      await expect(runStagedRestore(f.restore)).resolves.toBe(true);
      expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(journal);
      expect(
        JSON.parse(await readFile(join(f.roots.stateDir, "flows/restore/record.json"), "utf8")),
      ).not.toHaveProperty("request");
      await expect(
        readFile(join(f.roots.stateDir, "flows/restore/node-key")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toContain(node.nodeId);
      const retained = await openVenueDatabase(f.roots.venueDir);
      try {
        const series = await retained.venue.select().from(invoiceSeries);
        expect(
          series
            .filter((row) => row.retiredAt !== null)
            .map((row) => ({ ...row, retiredAt: null })),
        ).toEqual(rows);
        expect(
          series
            .filter((row) => row.retiredAt === null)
            .map((row) => ({ code: row.code, nextNumber: row.nextNumber })),
        ).toEqual([
          { code: "A-0CNQT", nextNumber: 1 },
          { code: "FF-0CNQT", nextNumber: 1 },
          { code: "R-0CNQT", nextNumber: 1 },
        ]);
        const active = await retained.venue.select().from(fiscalAllocations);
        expect(active.slice(0, 1)).toEqual(allocations);
        expect(active).toHaveLength(2);
        expect(active[1]!.eventKey).toBe(f.options.binding.eventId);
      } finally {
        await retained.close();
      }
    },
    120_000,
  );

  it("interactive preparation authenticates every fresh copy and does not erase a good comparison after a wrong key", async () => {
    const f = await interactiveHost();
    await f.compare();
    const history = await readModulePreparationHistory(f.roots, binding.module);
    await expect(f.select({ nodeRecoverySecret: "wrong" })).rejects.toMatchObject({
      code: "promotion.break_glass_invalid",
    });
    expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(history);
    expect(await f.selectPastWaits()).toMatchObject({
      status: "selected",
      identity: "0CNSP",
    });
  });

  it("interactive preparation loses transient clock grants across restart while retaining the spent hour", async () => {
    const f = await interactiveHost();
    const selected = await f.selectPastWaits();
    const restarted = createInteractiveRecoveryPreparation(f.options);
    await expect(f.select({}, restarted)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "clock_stale" },
    });
    const challenge = (await f.invoke({ action: "clock-challenge" }, {}, restarted)) as {
      id: string;
    };
    const compared = (await f.invoke(
      { action: "compare-clocks", browser: { challengeId: challenge.id, instantMs: Date.now() } },
      {},
      restarted,
    )) as { id: string };
    expect(await f.invoke({ action: "select", comparisonId: compared.id }, {}, restarted)).toEqual(
      selected,
    );
  });
});
