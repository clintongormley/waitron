import {
  external,
  suite,
  node,
  binding,
  root,
  key,
  archiveHost,
  bucketCommand,
  agreeInternet,
  interactiveHost,
} from "../test/hour-recovery-host.js";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { invoiceSeries, openVenueDatabase } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import { createFirstSetupCoordinator, readModulePreparationHistory } from "@waitron/provisioning";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { AppError } from "@waitron/shared";
import { runRestoreHooks, restoreFromArtifact } from "./restore.js";
import {
  createSelectedRecoveryPreparation,
  createSetupRecoveryPreparation,
} from "./recovery-preparation.js";
import { buildManifest } from "./backup-manifest.js";
import { decryptArtifact, encryptArtifact } from "./artifact-cipher.js";
import { writeStreamRestore } from "./restore-stream.js";
import { runStagedRestore, stageRestoreRequest } from "./restore-request.js";
import { Hono } from "hono";
import { mountSetup } from "./setup-api.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createCloudRecoveryClient } from "./cloud-recovery.js";
import { encodeRecoveryKit } from "@waitron/stream";

describe("selected-hour admission before archive placement", () => {
  it.each(["archive", "stream"] as const)(
    "the default staged %s restore refuses a wrong node key before replacing the destination",
    async (kind) => {
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
              nodeRecoverySecret: "wrong node key",
            }
          : {
              kind: "stream",
              databasePath: f.database,
              entries: f.entries,
              environment: "preproduction",
              recoveryOperation,
              nodeRecoverySecret: "wrong node key",
            },
      );
      await writeFile(join(f.roots.venueDir, "venue.db"), "original destination database");
      await writeFile(join(f.roots.stateDir, "trading.env"), "original destination identity");
      await expect(runStagedRestore(f.restore)).rejects.toMatchObject({
        code: "promotion.break_glass_invalid",
      });
      expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
        "original destination database",
      );
      expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
        "original destination identity",
      );
    },
  );

  it("clears an unstored-credential request after its injected admission refuses", async () => {
    const f = await archiveHost();
    await stageRestoreRequest(f.roots.stateDir, {
      artifact: f.restore.artifact,
      recoveryKey: "archive password",
      environment: "preproduction",
    });
    const wrong = createSelectedRecoveryPreparation({ ...f.options, secret: "wrong node key" });
    await expect(
      runStagedRestore({ ...f.restore, withModuleOperations: wrong.runner(f.outcome.input) }),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    await expect(readFile(join(f.roots.stateDir, "restore-request.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(f.roots.stateDir, "restore-request.key"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("checks fresh isolation before replacing the destination or its identity", async () => {
    const f = await archiveHost();
    await writeFile(join(f.roots.venueDir, "venue.db"), "original destination database");
    await writeFile(join(f.roots.stateDir, "trading.env"), "original destination identity");
    f.isolation.oldMachineOffline = false;
    await expect(
      restoreFromArtifact({
        ...f.restore,
        modules: f.service.modules,
        withModuleOperations: f.service.runner(f.outcome.input),
      }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "old_machine_active" },
    });
    expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
      "original destination database",
    );
    expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
      "original destination identity",
    );
  });

  it("refuses another encrypted archive with the same database and key before replacement", async () => {
    const f = await archiveHost();
    await writeFile(join(f.roots.venueDir, "venue.db"), "original destination database");
    const artifact = encryptArtifact(
      decryptArtifact(f.restore.artifact, "archive password"),
      "archive password",
    );
    await expect(
      restoreFromArtifact({
        ...f.restore,
        artifact,
        modules: f.service.modules,
        withModuleOperations: f.service.runner(f.outcome.input),
      }),
    ).rejects.toMatchObject({ code: "module.operation_invalid" });
    expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe(
      "original destination database",
    );
  });

  it.each(["missing", "refusing"] as const)(
    "refuses a %s module history reader without replacing the surviving database",
    async (kind) => {
      const f = await archiveHost();
      await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
      const before = await suite.db.select().from(invoiceSeries);
      const modules = f.options.modules.map((module) =>
        module.name !== binding.module
          ? module
          : {
              ...module,
              operations: {
                ...module.operations!,
                readRecoveryHistory:
                  kind === "missing"
                    ? undefined
                    : async () => {
                        throw new AppError("sif.allocation_invalid", { reason: "history_invalid" });
                      },
              },
            },
      );
      const service = createSelectedRecoveryPreparation({ ...f.options, modules });
      await expect(
        restoreFromArtifact({
          ...f.restore,
          modules: service.modules,
          withModuleOperations: service.runner(f.outcome.input),
        }),
      ).rejects.toMatchObject(
        kind === "missing"
          ? { code: "module.operation_invalid" }
          : {
              code: "sif.allocation_invalid",
              params: { reason: "history_invalid" },
            },
      );
      const retained = await openVenueDatabase(f.roots.venueDir);
      try {
        expect(await retained.venue.select().from(invoiceSeries)).toEqual(before);
      } finally {
        await retained.close();
      }
    },
  );

  it("places the selected bucket point and preserves every recovered counter", async () => {
    const f = await archiveHost("stream");
    const original = await suite.db.select().from(invoiceSeries);
    await writeStreamRestore({
      ...f.restore,
      databasePath: f.database,
      entries: f.entries,
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
        { code: "A-06RC", nextNumber: 1 },
        { code: "FF-06RC", nextNumber: 1 },
        { code: "R-06RC", nextNumber: 1 },
      ]);
      expect(await placed.venue.select().from(fiscalAllocations)).toHaveLength(2);
    } finally {
      await placed.close();
    }
  });

  it("a reconstructed committed recovery refreshes no clocks or hour intent", async () => {
    const f = await archiveHost();
    await restoreFromArtifact({
      ...f.restore,
      withModuleOperations: f.service.runner(f.outcome.input),
    });
    const restored = await openVenueDatabase(f.roots.venueDir);
    try {
      await restored.venue.update(invoiceSeries).set({ nextNumber: 917 });
      const rows = await restored.venue.select().from(invoiceSeries);
      const allocations = await restored.venue.select().from(fiscalAllocations);
      const journal = await readModulePreparationHistory(f.roots, binding.module);
      vi.setSystemTime(new Date("2026-10-17T14:40:00Z"));
      external.internet.mockClear();
      const reconstructed = createSelectedRecoveryPreparation(f.options);
      await runRestoreHooks({
        db: restored.venue,
        node,
        modules: ALL_MODULES,
        log: () => {},
        withModuleOperations: reconstructed.runner(f.outcome.input, { refresh: true }),
        resumeOperation: f.options.binding,
      });
      expect(external.internet).not.toHaveBeenCalled();
      expect(await restored.venue.select().from(invoiceSeries)).toEqual(rows);
      expect(await restored.venue.select().from(fiscalAllocations)).toEqual(allocations);
      expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(journal);
    } finally {
      await restored.close();
    }
  });

  it("refreshes again when the same reconstructed runner retries refused clock admission", async () => {
    const f = await archiveHost();
    const reconstructed = createSelectedRecoveryPreparation(f.options);
    const runner = reconstructed.runner(f.outcome.input, { refresh: true });
    await expect(
      restoreFromArtifact({ ...f.restore, withModuleOperations: runner }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "clock_unconfirmed" },
    });
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
    await restoreFromArtifact({ ...f.restore, withModuleOperations: runner });
    const restored = await openVenueDatabase(f.roots.venueDir);
    try {
      expect(
        (await restored.venue.select().from(invoiceSeries))
          .filter((row) => row.retiredAt === null)
          .map((row) => row.code),
      ).toEqual(["A-06RC", "FF-06RC", "R-06RC"]);
      expect(await restored.venue.select().from(fiscalAllocations)).toHaveLength(2);
    } finally {
      await restored.close();
    }
  });

  it("refreshes each new placement admission when a reconstructed runner is reused", async () => {
    const f = await archiveHost();
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
    const runner = reconstructed.runner(f.outcome.input, { refresh: true });
    const context = { db: suite.db, node, sourceId: f.options.binding.sourceId };
    await runner.checkBeforePlacement!(context);
    vi.advanceTimersByTime(31_000);
    await runner.checkBeforePlacement!(context);
    expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
    expect((await suite.db.select().from(invoiceSeries)).map((row) => row.nextNumber)).toEqual([
      123, 123, 123,
    ]);
  });

  it.each(["archive", "stream"] as const)(
    "reconstructs selected-hour preparation for staged %s recovery",
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
      const journal = await readModulePreparationHistory(f.roots, binding.module);
      expect(await runStagedRestore(f.restore)).toBe(true);
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
        expect(await restored.venue.select().from(fiscalAllocations)).toHaveLength(2);
      } finally {
        await restored.close();
      }
      expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(journal);
      expect(await runStagedRestore(f.restore)).toBe(false);
      expect(
        (await readdir(f.roots.stateDir)).filter((name) => name.startsWith("restore-request")),
      ).toEqual([]);
    },
  );

  it.each(["bad source", "coerced old-box flag", "coerced sole flag", "missing key"])(
    "refuses staged recovery context with %s before writing a request",
    async (reason) => {
      const f = await archiveHost();
      const context = {
        selectedSourceId: reason === "bad source" ? "" : f.options.selected.sourceId,
        oldBoxGone: reason === "coerced old-box flag" ? "true" : true,
        soleRecovery: reason === "coerced sole flag" ? "true" : true,
      };
      const before = await readdir(f.roots.stateDir);
      await expect(
        stageRestoreRequest(f.roots.stateDir, {
          artifact: f.restore.artifact,
          recoveryKey: "archive password",
          environment: "preproduction",
          recoveryOperation: { binding: f.options.binding, input: f.outcome.input },
          ...(reason === "missing key" ? {} : { nodeRecoverySecret: key.secret }),
          recoveryContext: context as never,
        }),
      ).rejects.toMatchObject({ code: "server.config_invalid" });
      expect(await readdir(f.roots.stateDir)).toEqual(before);
    },
  );

  it.each([
    ["archive", "offline"],
    ["stream", "offline"],
    ["archive", "old seller"],
    ["stream", "old seller"],
    ["archive", "parallel recovery"],
    ["stream", "parallel recovery"],
    ["archive", "wrong key"],
    ["stream", "wrong key"],
  ] as const)(
    "retains staged %s recovery after a reconstructed %s refusal",
    async (kind, reason) => {
      const f = await archiveHost(kind);
      const credentials = {
        environment: "preproduction" as const,
        recoveryOperation: { binding: f.options.binding, input: f.outcome.input },
        nodeRecoverySecret: reason === "wrong key" ? "wrong node key" : key.secret,
        recoveryContext: {
          selectedSourceId: f.options.selected.sourceId,
          oldBoxGone: reason !== "old seller",
          soleRecovery: reason !== "parallel recovery",
        },
      };
      await stageRestoreRequest(
        f.roots.stateDir,
        kind === "archive"
          ? { ...credentials, artifact: f.restore.artifact, recoveryKey: "archive password" }
          : { ...credentials, kind: "stream", databasePath: f.database, entries: f.entries },
      );
      await suite.db.update(invoiceSeries).set({ nextNumber: 456 });
      await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
      await writeFile(join(f.roots.stateDir, "trading.env"), "staged destination identity");
      const previous = await suite.db.select().from(invoiceSeries);
      const allocations = await suite.db.select().from(fiscalAllocations);
      const marker = await readFile(join(f.roots.stateDir, "restore-request.json"), "utf8");
      const journal = await readModulePreparationHistory(f.roots, binding.module);
      if (reason !== "offline")
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
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(runStagedRestore(f.restore)).rejects.toMatchObject({
          code: reason === "wrong key" ? "promotion.break_glass_invalid" : "sif.allocation_invalid",
        });
        const retained = await openVenueDatabase(f.roots.venueDir);
        try {
          expect(await retained.venue.select().from(invoiceSeries)).toEqual(previous);
          expect(await retained.venue.select().from(fiscalAllocations)).toEqual(allocations);
        } finally {
          await retained.close();
        }
        expect(await readFile(join(f.roots.stateDir, "trading.env"), "utf8")).toBe(
          "staged destination identity",
        );
        expect(await readFile(join(f.roots.stateDir, "restore-request.json"), "utf8")).toBe(marker);
        expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(journal);
        expect(
          (await readdir(f.roots.stateDir)).filter((name) => name.startsWith("restore-entry-")),
        ).toEqual([]);
      }
    },
  );

  it.each(["archive", "stream"] as const)(
    "replays staged %s recovery after process death following committed placement",
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
      const internetModule = `export async function observeInternetHourClock() {
        return { source: "internet", result: "usable", instantMs: Date.now(), uncertaintyMs: 0,
          wallStartedMs: Date.now(), wallFinishedMs: Date.now(),
          monotonicStartedMs: performance.now(), monotonicFinishedMs: performance.now() };
      }`;
      const releaseModule = `export function readHourRelease() { return { instantMs: Date.parse("2026-10-15T00:00:00Z") }; }`;
      const source = `
        import { registerHooks } from "node:module";
        const realDate = Date;
        globalThis.Date = class extends realDate {
          constructor(...args) { super(...(args.length ? args : ["2026-10-16T12:40:00Z"])); }
          static now() { return realDate.parse("2026-10-16T12:40:00Z"); }
        };
        registerHooks({ resolve(specifier, context, next) {
          if (specifier.endsWith("/hour-clock-internet.js")) return { shortCircuit: true, url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(internetModule)}`)} };
          if (specifier.endsWith("/hour-release.js")) return { shortCircuit: true, url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(releaseModule)}`)} };
          return next(specifier, context);
        }});
        const { runStagedRestore } = await import(${JSON.stringify(new URL("./restore-request.ts", import.meta.url).href)});
        const { restoreFromArtifactFile } = await import(${JSON.stringify(new URL("./restore.ts", import.meta.url).href)});
        const { writeStreamRestore } = await import(${JSON.stringify(new URL("./restore-stream.ts", import.meta.url).href)});
        await runStagedRestore({ ...JSON.parse(process.argv[1]), log() {} },
          async (args) => { await restoreFromArtifactFile(args); process.kill(process.pid, "SIGKILL"); },
          async (args) => { await writeStreamRestore(args); process.kill(process.pid, "SIGKILL"); });
      `;
      await expect(
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
      ).rejects.toMatchObject({ signal: "SIGKILL" });
      expect(
        JSON.parse(await readFile(join(f.roots.stateDir, "restore-request.json"), "utf8")),
      ).toMatchObject({ placementStarted: true });
      const restored = await openVenueDatabase(f.roots.venueDir);
      let rows;
      let allocations;
      try {
        expect(
          (await restored.venue.select().from(invoiceSeries))
            .filter((row) => row.retiredAt === null)
            .map((row) => row.code),
        ).toEqual(["A-06RC", "FF-06RC", "R-06RC"]);
        await restored.venue.update(invoiceSeries).set({ nextNumber: 917 });
        rows = await restored.venue.select().from(invoiceSeries);
        allocations = await restored.venue.select().from(fiscalAllocations);
      } finally {
        await restored.close();
      }
      const journal = await readModulePreparationHistory(f.roots, binding.module);
      vi.setSystemTime(new Date("2026-10-17T14:40:00Z"));
      external.internet.mockClear();
      expect(await runStagedRestore(f.restore)).toBe(true);
      expect(external.internet).not.toHaveBeenCalled();
      const replayed = await openVenueDatabase(f.roots.venueDir);
      try {
        expect(await replayed.venue.select().from(invoiceSeries)).toEqual(rows);
        expect(await replayed.venue.select().from(fiscalAllocations)).toEqual(allocations);
      } finally {
        await replayed.close();
      }
      expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(journal);
      expect(await runStagedRestore(f.restore)).toBe(false);
    },
    120_000,
  );

  it("interactive preparation keeps browser comparisons across freshly validated private copies and stages the selected hour", async () => {
    const f = await interactiveHost();
    const rows = await suite.db.select().from(invoiceSeries);
    await f.compare();
    expect(await f.invoke({ action: "preview" })).toMatchObject({
      status: "preview",
      identity: "06RD",
    });
    const selected = (await f.invoke({
      action: "select",
      answer: "no",
      installationCodes: ["06RB"],
    })) as { input: unknown };
    expect(selected).toMatchObject({
      status: "selected",
      identity: "06RD",
      input: {
        allocation: {
          installationIdentity: "06RD",
          series: [
            { code: "A-06RD", purpose: "standard" },
            { code: "FF-06RD", purpose: "full" },
            { code: "R-06RD", purpose: "rectificative" },
          ],
        },
      },
    });
    expect(await suite.db.select().from(invoiceSeries)).toEqual(rows);
    expect(
      JSON.stringify(await readModulePreparationHistory(f.roots, binding.module)),
    ).not.toContain(key.secret);
    await stageRestoreRequest(
      f.roots.stateDir,
      {
        ...f.restore,
        recoveryOperation: { binding: f.request.binding, input: selected.input },
        nodeRecoverySecret: key.secret,
        recoveryContext: f.request.context,
      },
      async () => {},
    );
    agreeInternet();
    expect(await runStagedRestore(f.restore)).toBe(true);
    const restored = await openVenueDatabase(f.roots.venueDir);
    try {
      const result = await restored.venue.select().from(invoiceSeries);
      expect(result.filter((row) => row.retiredAt === null).map((row) => row.code)).toEqual([
        "A-06RD",
        "FF-06RD",
        "R-06RD",
      ]);
      expect(result.filter((row) => row.retiredAt !== null).map((row) => row.nextNumber)).toEqual([
        123, 123, 123,
      ]);
    } finally {
      await restored.close();
    }
  });

  it.each(["source", "node", "module", "isolation", "parallel"])(
    "interactive preparation refuses changed %s before spending an hour",
    async (fault) => {
      const f = await interactiveHost();
      await f.compare();
      const changed = structuredClone(f.request);
      if (fault === "source") changed.context.selectedSourceId = "different-selected-copy";
      if (fault === "node") changed.binding.targetNodeId = "00000000-0000-4000-8000-000000000002";
      if (fault === "module") changed.binding.module = "fiscal-none";
      if (fault === "isolation") changed.context.oldBoxGone = false;
      if (fault === "parallel") changed.context.soleRecovery = false;
      const history = await readModulePreparationHistory(f.roots, binding.module);
      await expect(
        f.invoke({ action: "select", answer: "no", installationCodes: ["06RB"] }, changed),
      ).rejects.toMatchObject({
        code: "module.operation_invalid",
      });
      expect(await readModulePreparationHistory(f.roots, binding.module)).toEqual(history);
    },
  );

  it.each(["archive", "bucket", "cloud"])(
    "interactive HTTP %s preparation authenticates the actual selected copy and preserves comparisons",
    async (kind) => {
      const bucket = kind === "bucket" ? await bucketCommand() : undefined;
      const f = bucket?.f ?? (await archiveHost());
      vi.setSystemTime(
        new Date(kind === "bucket" ? "2026-10-16T14:40:00Z" : "2026-10-16T13:40:00Z"),
      );
      let cloud: ReturnType<typeof createCloudRecoveryClient> | undefined;
      const pointId = "047bacd4-df70-4881-a835-c6dd75ae7ecf";
      if (kind === "cloud") {
        const point = {
          id: pointId,
          venueId: node.locationId,
          capturedAt: new Date().toISOString(),
          modules: (
            await buildManifest({
              db: suite.db,
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
        const expiresAt = new Date(Date.now() + 900000).toISOString();
        cloud = createCloudRecoveryClient({
          stateDir: f.roots.stateDir,
          origin: "https://cloud.example.test",
          environment: "preproduction",
          download: async () => f.restore.artifact,
          fetch: async (url, init) => {
            const action = new URL(String(url)).pathname.split("/").at(-1);
            const body = JSON.parse(String(init?.body)) as { payload: string };
            const requestId = JSON.parse(Buffer.from(body.payload, "base64url").toString())[2];
            if (action === "start" || action === "status")
              return Response.json({
                requestId,
                state: action === "start" ? "awaiting_owner" : "approved",
                expiresAt,
                operationId: action === "start" ? null : requestId,
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
            throw new Error(`Unexpected Cloud action ${action}`);
          },
        });
        await cloud.start();
        await cloud.status();
      }
      const coordinator = createFirstSetupCoordinator();
      const prepareRecovery = createSetupRecoveryPreparation({
        ...f.roots,
        stagingDir: join(root, "interactive-validation"),
        modules: ALL_MODULES,
        migrationsRoot: null,
        coordinator,
        cloudRecovery: cloud,
        bucket: {
          litestreamBin: "/unused",
          now: () => new Date(),
          log: () => {},
          openStore: bucket?.deps.openStore,
          restoreGeneration: async ({ outPath }) => {
            await copyFile(f.database, outPath);
          },
        },
      });
      const app = new Hono();
      mountSetup(
        app,
        {
          environment: "preproduction",
          firstSetup: { coordinator, assertOtherAllowed: async () => {} },
          prepareRecovery,
        },
        () => {},
      );
      const source = bucket
        ? { kind: "bucket", kit: encodeRecoveryKit(bucket.kit), environment: "preproduction" }
        : kind === "cloud"
          ? { kind: "cloud", pointId }
          : { kind: "archive", recoveryKey: "archive password", environment: "preproduction" };
      const prior = bucket
        ? JSON.parse(await readFile(bucket.command.operationPath, "utf8")).binding
        : f.options.binding;
      const request = {
        binding: { ...prior, eventId: "browser-http" },
        context: {
          selectedSourceId: bucket
            ? `stream:${node.locationId}:gen-0-${node.nodeId}-20261016T124000Z`
            : f.options.selected.sourceId,
          oldBoxGone: true,
          soleRecovery: true,
        },
        nodeRecoverySecret: key.secret,
      };
      const send = async (proposal: unknown) => {
        const socket = new TLSSocket(new Socket());
        try {
          let init: RequestInit;
          if (kind === "archive") {
            const form = new FormData();
            form.set("request", JSON.stringify({ source, preparation: { ...request, proposal } }));
            form.set("artifact", new Blob([Uint8Array.from(f.restore.artifact)]), "selected.wbk");
            init = { method: "POST", body: form };
          } else
            init = {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ source, preparation: { ...request, proposal } }),
            };
          const response = await app.request(
            "https://box.test/setup-api/recovery/preparation",
            init,
            { incoming: { socket } },
          );
          const body = await response.json();
          expect(body).not.toHaveProperty("nodeRecoverySecret");
          expect(response.status, JSON.stringify(body)).toBe(200);
          expect(response.headers.get("cache-control")).toBe("no-store");
          return body;
        } finally {
          socket.destroy();
        }
      };
      const rows = await suite.db.select().from(invoiceSeries);
      const challenge = await send({ action: "clock-challenge" });
      await send({
        action: "compare-clocks",
        browser: { challengeId: challenge.id, instantMs: Date.now() },
      });
      const selected = await send({ action: "select", answer: "no", installationCodes: ["06RB"] });
      expect(selected).toMatchObject({
        status: "selected",
        identity: kind === "bucket" ? "06RE" : "06RD",
        binding: request.binding,
      });
      expect(await suite.db.select().from(invoiceSeries)).toEqual(rows);
      expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
      const journal = JSON.stringify(await readModulePreparationHistory(f.roots, binding.module));
      expect(journal).not.toContain(key.secret);
      expect(journal).not.toContain("archive password");
      expect(journal).not.toContain("synthetic-secret");
      expect(
        await readdir(join(root, "interactive-validation")).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return [];
            throw error;
          },
        ),
      ).toEqual([]);
      expect(
        (await readdir(f.roots.stateDir)).filter((name) => name.startsWith("stream-restore-")),
      ).toEqual([]);
    },
  );
});
