import {
  external,
  suite,
  node,
  binding,
  scope,
  root,
  key,
  archiveHost,
  archiveCommand,
  bucketCommand,
  agreeInternet,
  restoreApp,
  recordedRecoveryRows,
  recoveryInvoices,
  managedHttp,
  interactiveHost,
} from "../test/hour-recovery-host.js";
import { Agent } from "undici";
import { loadKeyRing } from "@waitron/credentials";
import { establishNodeIdentity } from "./node-identity.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { REBUILD_MARKER } from "./rebuild-first-start.js";
import { startServer, type StartedServer } from "./boot.js";
import { freePorts } from "./testing/free-ports.js";
import { copyFile, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { invoiceSeries, nodes, locations, openVenueDatabase } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readModulePreparationHistory } from "@waitron/provisioning";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { TENANT_B } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { createRecoveryRestoreRunner } from "./recovery-module-operation.js";
import {
  runRestoreHooks,
  restoreFromArtifact,
  restoreFromArtifactFile,
  validateArtifact,
} from "./restore.js";
import { createSelectedRecoveryPreparation } from "./recovery-preparation.js";
import { packArchive, unpackArchive } from "./backup-archive.js";
import { decryptArtifact, encryptArtifact } from "./artifact-cipher.js";
import { writeStreamRestore } from "./restore-stream.js";
import { runRestore } from "./restore-command.js";
import { encodeArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { runStagedRestore, stageRestoreRequest, stageStreamRestore } from "./restore-request.js";
import { eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { encodeRecoveryKit } from "@waitron/stream";

describe("selected-hour admission before archive placement", () => {
  it.each(["archive", "file"])(
    "preserves the original database and identity when the %s key admission fails",
    async (kind) => {
      const f = await archiveHost();
      await writeFile(join(f.roots.venueDir, "venue.db"), "original destination database");
      await writeFile(join(f.roots.stateDir, "trading.env"), "original destination identity");
      const wrong = createSelectedRecoveryPreparation({ ...f.options, secret: "wrong node key" });
      const withModuleOperations = wrong.runner(f.outcome.input);
      const attempt =
        kind === "archive"
          ? restoreFromArtifact({ ...f.restore, modules: wrong.modules, withModuleOperations })
          : (async () => {
              const artifactPath = join(root, "incoming.wbk");
              await writeFile(artifactPath, f.restore.artifact);
              return restoreFromArtifactFile({
                ...f.restore,
                artifactPath,
                modules: wrong.modules,
                withModuleOperations,
              });
            })();
      await expect(attempt).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
      expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
        "original destination database",
      );
      expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
        "original destination identity",
      );
    },
  );

  it("a valid node key without module preparation refuses before replacing the destination", async () => {
    const f = await archiveHost();
    await writeFile(join(f.roots.venueDir, "venue.db"), "original destination database");
    await writeFile(join(f.roots.stateDir, "trading.env"), "original destination identity");
    await expect(
      restoreFromArtifact({
        ...f.restore,
        withModuleOperations: createRecoveryRestoreRunner(
          ALL_MODULES,
          { binding: f.options.binding, input: f.outcome.input },
          key.secret,
        ),
      }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
    expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
      "original destination database",
    );
    expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
      "original destination identity",
    );
  });

  it.each([
    ["archive", "key"],
    ["stream", "key"],
    ["archive", "preparation"],
    ["stream", "preparation"],
  ] as const)(
    "retries a staged %s %s refusal against the selected copy after reconstruction",
    async (kind, refusal) => {
      const f = await archiveHost(kind);
      const recoveryOperation = { binding: f.options.binding, input: f.outcome.input };
      await stageRestoreRequest(
        f.roots.stateDir,
        kind === "archive"
          ? {
              artifact: f.restore.artifact,
              recoveryKey: "archive password",
              environment: "preproduction",
              recoveryOperation,
              nodeRecoverySecret: refusal === "key" ? "wrong node key" : key.secret,
            }
          : {
              kind: "stream",
              databasePath: f.database,
              entries: f.entries,
              environment: "preproduction",
              recoveryOperation,
              nodeRecoverySecret: refusal === "key" ? "wrong node key" : key.secret,
            },
      );
      await writeFile(join(f.roots.venueDir, "venue.db"), "original destination database");
      await writeFile(join(f.roots.stateDir, "trading.env"), "original destination identity");
      const marker = await readFile(join(f.roots.stateDir, "restore-request.json"), "utf8");
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(runStagedRestore({ ...f.restore })).rejects.toMatchObject({
          code: refusal === "key" ? "promotion.break_glass_invalid" : "sif.allocation_invalid",
          ...(refusal === "preparation"
            ? { params: { reason: "outside_confirmation_missing" } }
            : {}),
        });
        expect(await readFile(join(f.roots.stateDir, "restore-request.json"), "utf8")).toBe(marker);
        expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
          "original destination database",
        );
        expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
          "original destination identity",
        );
      }
    },
  );

  it.each(["archive", "stream"] as const)(
    "retains fresh staged %s admission across two separate processes",
    async (kind) => {
      const f = await archiveHost(kind);
      const credentials = {
        environment: "preproduction" as const,
        recoveryOperation: { binding: f.options.binding, input: f.outcome.input },
        nodeRecoverySecret: "wrong node key",
      };
      await stageRestoreRequest(
        f.roots.stateDir,
        kind === "archive"
          ? { ...credentials, artifact: f.restore.artifact, recoveryKey: "archive password" }
          : { ...credentials, kind: "stream", databasePath: f.database, entries: f.entries },
      );
      await writeFile(join(f.roots.venueDir, "venue.db"), "original destination database");
      await writeFile(join(f.roots.stateDir, "trading.env"), "original destination identity");
      const marker = await readFile(join(f.roots.stateDir, "restore-request.json"), "utf8");
      const source = `
        import { runStagedRestore } from ${JSON.stringify(new URL("./restore-request.ts", import.meta.url).href)};
        try {
          await runStagedRestore({ ...JSON.parse(process.argv[1]), log() {} });
          process.stdout.write(JSON.stringify({ outcome: "restored" }));
        } catch (error) {
          process.stdout.write(JSON.stringify({ code: error.code }));
        }
      `;
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await promisify(execFile)(
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
        );
        expect(JSON.parse(result.stdout)).toEqual({ code: "promotion.break_glass_invalid" });
        expect(await readFile(join(f.roots.stateDir, "restore-request.json"), "utf8")).toBe(marker);
        expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
          "original destination database",
        );
        expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
          "original destination identity",
        );
      }
    },
    120_000,
  );

  it.each(["archive", "stream"] as const)(
    "refuses an older selected hour before replacing a newer surviving %s destination",
    async (kind) => {
      const f = await archiveHost(kind);
      vi.setSystemTime(new Date("2026-10-16T13:40:00Z"));
      const newerState = join(root, "newer-state");
      await mkdir(newerState);
      const newer = createSelectedRecoveryPreparation({
        ...f.options,
        stateDir: newerState,
        binding: { ...f.options.binding, eventId: "newer-surviving-target" },
      });
      const challenge = (await newer.prepare({ action: "clock-challenge" })) as { id: string };
      await newer.prepare({
        action: "compare-clocks",
        browser: { challengeId: challenge.id, instantMs: Date.now() },
      });
      const selected = (await newer.prepare({
        action: "select",
        answer: "no",
        installationCodes: ["06RB"],
      })) as {
        identity: string;
        input: unknown;
      };
      expect(selected.identity).toBe("06RD");
      await runRestoreHooks({
        db: suite.db,
        node,
        modules: newer.modules,
        log: () => {},
        withModuleOperations: newer.runner(selected.input),
      });
      const before = await suite.db.select().from(invoiceSeries);
      const fresh = (await f.service.prepare({ action: "clock-challenge" })) as { id: string };
      await f.service.prepare({
        action: "compare-clocks",
        browser: { challengeId: fresh.id, instantMs: Date.now() },
      });
      await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
      await writeFile(join(f.roots.stateDir, "trading.env"), "surviving destination identity");
      await expect(
        kind === "archive"
          ? restoreFromArtifact({
              ...f.restore,
              modules: f.service.modules,
              withModuleOperations: f.service.runner(f.outcome.input),
            })
          : writeStreamRestore({
              ...f.restore,
              databasePath: f.database,
              entries: f.entries,
              modules: f.service.modules,
              withModuleOperations: f.service.runner(f.outcome.input),
            }),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "hour_not_later" },
      });
      const retained = await openVenueDatabase(f.roots.venueDir);
      try {
        expect(await retained.venue.select().from(invoiceSeries)).toEqual(before);
        expect(await retained.venue.select().from(fiscalAllocations)).toHaveLength(2);
      } finally {
        await retained.close();
      }
      expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
        "surviving destination identity",
      );
    },
  );

  it("refuses unreadable surviving history before changing the destination or its identity", async () => {
    const f = await archiveHost();
    await writeFile(join(f.roots.venueDir, "venue.db"), "damaged surviving database");
    await writeFile(join(f.roots.stateDir, "trading.env"), "surviving destination identity");
    await expect(
      restoreFromArtifact({
        ...f.restore,
        modules: f.service.modules,
        withModuleOperations: f.service.runner(f.outcome.input),
      }),
    ).rejects.toMatchObject({ code: "module.operation_invalid" });
    expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
      "damaged surviving database",
    );
    expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
      "surviving destination identity",
    );
  });

  it("refuses a destination whose database path is a directory", async () => {
    const f = await archiveHost();
    await mkdir(join(f.roots.venueDir, "venue.db"));
    await writeFile(join(f.roots.stateDir, "trading.env"), "surviving destination identity");
    await expect(
      restoreFromArtifact({
        ...f.restore,
        modules: f.service.modules,
        withModuleOperations: f.service.runner(f.outcome.input),
      }),
    ).rejects.toMatchObject({ code: "module.operation_invalid" });
    expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
      "surviving destination identity",
    );
  });

  it.each(["key", "source", "seller"])(
    "retains the original destination on a bucket point's %s refusal",
    async (refusal) => {
      const f = await archiveHost("stream");
      const original = Buffer.from("original destination database");
      await writeFile(join(f.roots.venueDir, "venue.db"), original);
      const service =
        refusal === "key"
          ? createSelectedRecoveryPreparation({ ...f.options, secret: "wrong key" })
          : f.service;
      if (refusal === "seller") f.isolation.oldMachineOffline = false;
      const entries =
        refusal === "source"
          ? [...f.entries, { name: "secrets/extra.txt", bytes: Buffer.from("different-point") }]
          : f.entries;
      const expected =
        refusal === "key"
          ? { code: "promotion.break_glass_invalid" }
          : refusal === "source"
            ? { code: "module.operation_invalid" }
            : { code: "sif.allocation_invalid", params: { reason: "old_machine_active" } };
      await expect(
        writeStreamRestore({
          ...f.restore,
          databasePath: f.database,
          entries,
          modules: service.modules,
          withModuleOperations: service.runner(f.outcome.input),
        }),
      ).rejects.toMatchObject(expected);
      expect((await readFile(join(f.roots.venueDir, "venue.db"))).equals(original)).toBe(true);
    },
  );

  it.each(["archive", "stream"] as const)(
    "%s recovery boots for trading twice without changing its selected hour or recovered counters",
    async (source) => {
      await suite.db.delete(nodes).where(eq(nodes.locationId, TENANT_B.locationId));
      await suite.db.delete(locations).where(eq(locations.id, TENANT_B.locationId));
      const history = await recoveryInvoices();
      const credentialKey = Buffer.alloc(32, 7).toString("base64");
      await establishNodeIdentity(
        {
          ownerDb: suite.db,
          ring: loadKeyRing({
            WAITRON_CREDENTIALS_KEY: credentialKey,
            WAITRON_CREDENTIALS_KEY_VERSION: "1",
          }),
        },
        node.nodeId,
      );
      const f = await archiveHost(source);
      const restore = {
        ...f.restore,
        modules: f.service.modules,
        withModuleOperations: f.service.runner(f.outcome.input),
      };
      if (source === "stream")
        await writeStreamRestore({ ...restore, databasePath: f.database, entries: f.entries });
      else await restoreFromArtifact(restore);
      expect(await readdir(f.roots.stateDir)).toContain(REBUILD_MARKER);
      const snapshot = async () => {
        const placed = await openVenueDatabase(f.roots.venueDir);
        try {
          return {
            series: await placed.venue.select().from(invoiceSeries).orderBy(invoiceSeries.code),
            allocations: await placed.venue.select().from(fiscalAllocations),
            recorded: await recordedRecoveryRows(placed.venue),
          };
        } finally {
          await placed.close();
        }
      };
      const before = await snapshot();
      expect(before.allocations).toHaveLength(2);
      expect(before.recorded).toEqual(history);
      expect(
        before.series
          .filter((row) => row.retiredAt === null)
          .map(({ code, nextNumber }) => ({ code, nextNumber })),
      ).toEqual([
        { code: "A-06RC", nextNumber: 1 },
        { code: "FF-06RC", nextNumber: 1 },
        { code: "R-06RC", nextNumber: 1 },
      ]);
      expect(
        before.series.filter((row) => row.retiredAt !== null).map((row) => row.nextNumber),
      ).toEqual([125, 123, 123]);
      const journal = await readFile(
        join(f.roots.stateDir, "module-preparation-state.json"),
        "utf8",
      );
      for (const [index, set] of manifestSets().entries())
        await cp(
          TEST_MIGRATIONS[index]!.migrationsFolder,
          join(root, "boot-migrations", set.name),
          { recursive: true },
        );
      await ensureBoxSecrets({
        stateDir: f.roots.stateDir,
        hostnames: ["localhost"],
        now: () => new Date(),
      });
      const [port] = await freePorts(1);
      const env = {
        WAITRON_ENV: "dev",
        WAITRON_STATE_DIR: f.roots.stateDir,
        WAITRON_VENUE_DIR: f.roots.venueDir,
        WAITRON_MIGRATIONS_DIR: join(root, "boot-migrations"),
        WAITRON_TILL_NODE_ID: node.nodeId,
        WAITRON_TILL_LOCATION_ID: node.locationId,
        WAITRON_CREDENTIALS_KEY: credentialKey,
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
        WAITRON_HTTP_HOST: "127.0.0.1",
        WAITRON_HTTP_PORT: String(port),
        WAITRON_HTTP_LANDING_PORT: "0",
        WAITRON_MANAGEMENT_RP_ID: "localhost",
        WAITRON_MANAGEMENT_ORIGIN: `https://localhost:${port}`,
      };
      for (const instant of ["2026-10-16T13:40:00Z", "2026-10-17T14:40:00Z"]) {
        vi.setSystemTime(new Date(instant));
        let server: StartedServer | undefined;
        let agent: Agent | undefined;
        try {
          server = await startServer(env);
          agent = new Agent({
            connect: { ca: await readFile(join(f.roots.stateDir, "tls/ca.crt")) },
          });
          const response = await fetch(`https://127.0.0.1:${port}/api/node`, {
            dispatcher: agent,
          } as RequestInit);
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({
            nodeId: node.nodeId,
            acceptingSales: true,
            environment: "preproduction",
          });
        } finally {
          await agent?.close();
          await server?.close();
        }
        expect(await readdir(f.roots.stateDir)).not.toContain(REBUILD_MARKER);
        expect(await snapshot()).toEqual(before);
        expect(
          await readFile(join(f.roots.stateDir, "module-preparation-state.json"), "utf8"),
        ).toBe(journal);
      }
    },
  );

  it.each([
    "offline",
    "disagreement",
    "old seller",
    "wrong node key",
    "wrong archive password",
    "wrong source",
    "missing sole confirmation",
  ])("the default archive command refuses %s before replacing the destination", async (reason) => {
    const f = await archiveHost();
    const command = await archiveCommand(f);
    external.internet.mockImplementation(async () =>
      reason === "offline"
        ? { source: "internet", result: "unavailable", reason: "offline" }
        : {
            source: "internet",
            result: "usable",
            instantMs: Date.now() + (reason === "disagreement" ? 180_000 : 0),
            uncertaintyMs: 0,
            wallStartedMs: Date.now(),
            wallFinishedMs: Date.now(),
            monotonicStartedMs: performance.now(),
            monotonicFinishedMs: performance.now(),
          },
    );
    if (reason === "old seller")
      command.argv = command.argv.filter((arg) => arg !== "--confirm-old-box-gone");
    if (reason === "missing sole confirmation")
      command.argv = command.argv.filter((arg) => arg !== "--confirm-sole-recovery");
    if (reason === "wrong node key") command.env.WAITRON_NODE_RECOVERY_KEY = "wrong node key";
    if (reason === "wrong archive password")
      command.env.WAITRON_BACKUP_RECOVERY_KEY = "wrong archive password";
    if (reason === "wrong source")
      await writeFile(
        command.operationPath,
        JSON.stringify({
          binding: { ...f.options.binding, sourceId: "another artifact" },
          input: f.outcome.input,
        }),
      );
    await suite.db.update(invoiceSeries).set({ nextNumber: 456 });
    await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
    const previous = await suite.db.select().from(invoiceSeries);
    const previousAllocations = await suite.db.select().from(fiscalAllocations);
    external.internet.mockClear();
    await writeFile(join(f.roots.stateDir, "trading.env"), "untouched identity");
    const journal = await readModulePreparationHistory(f.roots, binding.module);
    const output: string[] = [];
    expect(await runRestore({ ...command, out: (line) => output.push(line) })).toBe(1);
    const retained = await openVenueDatabase(f.roots.venueDir);
    try {
      expect(await retained.venue.select().from(invoiceSeries)).toEqual(previous);
      expect(await retained.venue.select().from(fiscalAllocations)).toEqual(previousAllocations);
    } finally {
      await retained.close();
    }
    expect(external.internet).toHaveBeenCalledTimes(
      ["offline", "disagreement", "old seller"].includes(reason) ? 1 : 0,
    );
    expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
      "untouched identity",
    );
    expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(journal);
    expect(output.join("\n")).not.toContain(key.secret);
    expect(output.join("\n")).not.toContain(command.env.WAITRON_BACKUP_RECOVERY_KEY);
  });

  it("the archive-pack command uses the downloaded exact archive and the pack password", async () => {
    const f = await archiveHost();
    const command = await archiveCommand(f);
    const packPath = join(root, "archive-pack.txt");
    const archiveKey = "waitron-20261016T114000Z-00000000-0000-4000-8000-000000000001.backup.enc";
    await writeFile(
      packPath,
      encodeArchiveRecoveryPack({
        version: 1,
        format: "WBK1",
        venueId: "olivo",
        bucket: {
          region: "eu-west-1",
          bucket: "synthetic-bucket",
          prefix: "",
          accessKeyId: "synthetic-access",
          secretAccessKey: "synthetic-secret",
        },
        archivePrefix: "archives/olivo/",
        recoveryKey: "archive password",
      }),
    );
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
    command.env.WAITRON_BACKUP_RECOVERY_KEY = "unused environment password";
    const output: string[] = [];
    const unexpected = async (): Promise<never> => {
      throw new Error("unexpected archive transport call");
    };
    const result = await runRestore({
      env: command.env,
      argv: [
        "restore",
        "--from-archive",
        packPath,
        "--archive-key",
        archiveKey,
        "--confirm-old-box-gone",
        "--confirm-sole-recovery",
      ],
      out: (line) => output.push(line),
      openArchiveFiles: (bucket) => {
        expect(bucket.prefix).toBe("archives/olivo/");
        return {
          putFile: unexpected,
          putBytes: unexpected,
          readStream: unexpected,
          deleteMany: unexpected,
          list: async (prefix) => {
            expect(prefix).toBe(archiveKey);
            return [{ key: archiveKey, size: f.restore.artifact.length, lastModified: new Date() }];
          },
          getFile: async (name, path) => {
            expect(name).toBe(archiveKey);
            await writeFile(path, f.restore.artifact);
          },
          close() {},
        };
      },
    });
    expect(result).toBe(0);
    expect(output.at(-1)).toBe(
      `restored archive ${archiveKey} from the bucket named in ${packPath}`,
    );
    const restored = await openVenueDatabase(f.roots.venueDir);
    try {
      const rows = await restored.venue.select().from(invoiceSeries);
      expect(rows.filter((row) => row.retiredAt === null).map((row) => row.code)).toEqual([
        "A-06RC",
        "FF-06RC",
        "R-06RC",
      ]);
      expect(rows.filter((row) => row.retiredAt !== null).map((row) => row.nextNumber)).toEqual([
        123, 123, 123,
      ]);
    } finally {
      await restored.close();
    }
    expect(await readdir(join(f.roots.stateDir, "restore-staging"))).toEqual([]);
  });

  it("carries the bucket HTTP selection and isolation through the real staging adapter", async () => {
    const history = await recoveryInvoices();
    const { f, command, deps, kit } = await bucketCommand();
    const operation = JSON.parse(await readFile(command.operationPath, "utf8"));
    const context = {
      selectedSourceId: `stream:${node.locationId}:gen-0-${node.nodeId}-20261016T124000Z`,
      oldBoxGone: true,
      soleRecovery: true,
    };
    const app = restoreApp({
      stageBucketRestore: (input) =>
        stageStreamRestore({
          ...f.restore,
          ...input,
          kit,
          litestreamBin: "/unused",
          now: () => new Date(),
          openStore: deps.openStore,
          restoreGeneration: async ({ outPath }) => {
            await copyFile(f.database, outPath);
          },
        }),
    });
    const response = await app.request("https://box.test/setup-api/restore-bucket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kit: encodeRecoveryKit(kit),
        environment: "preproduction",
        oldBoxGone: true,
        venueConfirmed: scope.taxpayerNif,
        recoveryOperation: operation,
        nodeRecoverySecret: key.secret,
        recoveryContext: context,
      }),
    });
    expect(response.status).toBe(202);
    expect(
      JSON.parse(await readFile(join(f.roots.stateDir, "restore-request.json"), "utf8")),
    ).toHaveProperty("recoveryContext", context);
    agreeInternet();
    expect(await runStagedRestore(f.restore)).toBe(true);
    const placed = await openVenueDatabase(f.roots.venueDir);
    try {
      expect(await recordedRecoveryRows(placed.venue)).toEqual(history);
      const rows = await placed.venue.select().from(invoiceSeries);
      expect(rows.filter((row) => row.retiredAt === null).map((row) => row.code)).toEqual([
        "A-06RD",
        "FF-06RD",
        "R-06RD",
      ]);
      expect(rows.filter((row) => row.retiredAt !== null).map((row) => row.nextNumber)).toEqual([
        125, 123, 123,
      ]);
    } finally {
      await placed.close();
    }
  });

  it("completes managed HTTP recovery after reconstruction without a second fiscal activation", async () => {
    const history = await recoveryInvoices();
    const f = await archiveHost();
    const managed = await managedHttp(f);
    expect(
      JSON.parse(await readFile(join(f.roots.stateDir, "restore-request.json"), "utf8")),
    ).toHaveProperty("recoveryContext", managed.context);
    agreeInternet();
    expect(
      await runStagedRestore({
        ...f.restore,
        onManagedCloudRestored: (binding) => managed.client().markRestored(binding),
      }),
    ).toBe(true);
    expect(await readdir(f.roots.stateDir)).not.toContain("restore-request.json");
    expect(await managed.client().replacementIdentity()).toMatchObject({
      phase: "restored",
      pointId: managed.pointId,
    });
    const placed = await openVenueDatabase(f.roots.venueDir);
    let rows;
    let allocations;
    try {
      expect(await recordedRecoveryRows(placed.venue)).toEqual(history);
      const restored = await placed.venue.select().from(invoiceSeries);
      expect(restored.filter((row) => row.retiredAt === null).map((row) => row.code)).toEqual([
        "A-06RC",
        "FF-06RC",
        "R-06RC",
      ]);
      expect(restored.filter((row) => row.retiredAt !== null).map((row) => row.nextNumber)).toEqual(
        [125, 123, 123],
      );
      await placed.venue.update(invoiceSeries).set({ nextNumber: 917 });
      rows = await placed.venue.select().from(invoiceSeries);
      allocations = await placed.venue.select().from(fiscalAllocations);
    } finally {
      await placed.close();
    }
    external.internet.mockClear();
    expect(await runStagedRestore(f.restore)).toBe(false);
    await managed.client().reportRestored();
    expect(await managed.client().replacementIdentity()).toMatchObject({
      phase: "reported",
      pointId: managed.pointId,
    });
    const replay = await openVenueDatabase(f.roots.venueDir);
    try {
      expect(await replay.venue.select().from(invoiceSeries)).toEqual(rows);
      expect(await replay.venue.select().from(fiscalAllocations)).toEqual(allocations);
    } finally {
      await replay.close();
    }
    expect(external.internet).not.toHaveBeenCalled();
  });

  it("interactive recovery is wired through the real setup boot and a certificate-verified HTTPS connection", async () => {
    const f = await archiveHost();
    vi.setSystemTime(new Date("2026-10-16T13:40:00Z"));
    const migrations = join(root, "boot-migrations");
    const sets = manifestSets();
    const migrationOptions = migrationOptionsFor(sets, null);
    for (const [index, set] of sets.entries()) {
      await cp(migrationOptions[index]!.migrationsFolder, join(migrations, set.name), {
        recursive: true,
      });
    }
    const [port] = await freePorts(1);
    let server: StartedServer | undefined;
    let agent: Agent | undefined;
    const preparation = {
      binding: { ...f.options.binding, eventId: "real-https-browser" },
      context: {
        selectedSourceId: f.options.selected.sourceId,
        oldBoxGone: true,
        soleRecovery: true,
      },
      nodeRecoverySecret: key.secret,
    };
    try {
      server = await startServer({
        WAITRON_ENV: "dev",
        WAITRON_STATE_DIR: f.roots.stateDir,
        WAITRON_VENUE_DIR: f.roots.venueDir,
        WAITRON_MIGRATIONS_DIR: migrations,
        WAITRON_HTTP_HOST: "127.0.0.1",
        WAITRON_HTTP_PORT: String(port),
        WAITRON_HTTP_LANDING_PORT: "0",
        WAITRON_MANAGEMENT_RP_ID: "localhost",
        WAITRON_MANAGEMENT_ORIGIN: "https://localhost",
      });
      agent = new Agent({ connect: { ca: await readFile(join(f.roots.stateDir, "tls/ca.crt")) } });
      const post = async (proposal: unknown) => {
        const form = new FormData();
        form.set(
          "request",
          JSON.stringify({
            source: {
              kind: "archive",
              recoveryKey: "archive password",
              environment: "preproduction",
            },
            preparation: { ...preparation, proposal },
          }),
        );
        form.set("artifact", new Blob([Uint8Array.from(f.restore.artifact)]), "selected.wbk");
        const response = await fetch(`https://127.0.0.1:${port}/setup-api/recovery/preparation`, {
          method: "POST",
          body: form,
          dispatcher: agent,
          headers: { Origin: `https://127.0.0.1:${port}`, "Sec-Fetch-Site": "same-origin" },
        } as RequestInit);
        const body = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        return body;
      };
      const challenge = await post({ action: "clock-challenge" });
      await post({
        action: "compare-clocks",
        browser: { challengeId: challenge.id, instantMs: Date.now() },
      });
      expect(
        await post({ action: "select", answer: "no", installationCodes: ["06RB"] }),
      ).toMatchObject({
        status: "selected",
        identity: "06RD",
        binding: preparation.binding,
      });
      expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
    } finally {
      await agent?.close();
      await server?.close();
    }
  });

  it("interactive preparation invalidates a comparison after an authenticated source changes and returns", async () => {
    const f = await interactiveHost();
    await f.compare();
    const entries = unpackArchive(decryptArtifact(f.restore.artifact, "archive password"));
    const manifest = entries.find((entry) => entry.name === "manifest.json")!;
    const metadata = JSON.parse(Buffer.from(manifest.bytes).toString("utf8"));
    metadata.createdAt = "2026-10-16T12:41:00.000Z";
    manifest.bytes = Buffer.from(JSON.stringify(metadata));
    const copy = await validateArtifact({
      ...f.restore,
      artifact: encryptArtifact(packArchive(entries), "archive password"),
    });
    try {
      await expect(
        f.options.coordinator.run((hold) =>
          f.session.prepare(
            copy,
            copy.sourceId!,
            {
              ...f.request,
              binding: { ...f.request.binding, sourceId: copy.sourceId! },
              context: { ...f.request.context, selectedSourceId: copy.sourceId! },
              proposal: { action: "preview" },
            },
            hold,
          ),
        ),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "clock_stale" },
      });
    } finally {
      await copy.discard();
    }
    await expect(
      f.invoke({ action: "select", answer: "no", installationCodes: ["06RB"] }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "clock_stale" },
    });
  });
});
