import { root, key, node, clock } from "../test/hour-recovery-host.js";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import { openVenueDatabase, invoiceSeries, withTransaction } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";

import * as sources from "./first-setup-backup-source.js";
import { suite } from "../test/hour-recovery-host.js";

import { AppError } from "@waitron/shared";
import { readModuleRecoveryEvidence, collectModuleNonDbState } from "./backup-sources.js";
import { emptyAbandonedBackupRecovery, readModulePreparationHistory } from "@waitron/provisioning";
import { generateNodeKeyPair } from "@waitron/membership";
import { encodeRecoveryKit, writePointer, signPointer } from "@waitron/stream";
import { createMemoryObjectStore } from "@waitron/stream/testing/memory-store.js";
import { sealNodeState, writeSealedStateRow } from "./sealed-state.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";
import { copyFile } from "node:fs/promises";
import { encryptArtifact, decryptArtifact } from "./artifact-cipher.js";
import { packArchive, unpackArchive } from "./backup-archive.js";

import {
  recovery,
  barrier,
  fixture,
  selectedRepair,
} from "../test/first-setup-backup-recovery-fixture.js";

vi.mock("./first-setup-backup-source.js", { spy: true });

it("keeps the projected recovery evidence outside the target secrets that placement replaces", async () => {
  const f = await fixture(true);
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  await service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false });
  const record = (await f.workspace.read())[0]!;
  const durable = join(dirname(dirname(record.target.target.stateDir)), "retained-evidence.json");
  const documents = JSON.parse(await readFile(durable, "utf8")) as Record<string, unknown>;
  expect(documents["hour-history"]).toMatchObject({
    records: expect.arrayContaining([expect.objectContaining({ identity: "0CNQT" })]),
  });
  expect(createHash("sha256").update(JSON.stringify(documents)).digest("hex")).toBe(
    record.retainedEvidenceDigest,
  );
  expect(JSON.stringify(documents)).not.toContain(key.secret);
  const stat = await import("node:fs/promises").then((fs) => fs.stat(durable));
  expect(stat.mode & 0o777).toBe(0o600);
});

it.each(["replace", "remove"] as const)(
  "refuses %s of the operation-local evidence before another preparation action",
  async (change) => {
    const f = await fixture(true);
    const service = recovery(f.options);
    const session = await service.open(f.request, { onBox: false });
    await service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false });
    const record = (await f.workspace.read())[0]!;
    const path = join(dirname(dirname(record.target.target.stateDir)), "retained-evidence.json");
    if (change === "replace")
      await writeFile(path, JSON.stringify({ "hour-history": { complete: true, records: [] } }));
    else await import("node:fs/promises").then((fs) => fs.rm(path, { force: true }));
    await expect(
      service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(await f.workspace.read()).toEqual([record]);
  },
);

it("places the authenticated archive in its isolated target and keeps later public history for the next backup", async () => {
  const f = await selectedRepair();
  const original = await readFile(join(f.roots.stateDir, "first-setup.json"));
  const oldPreparation = await readFile(join(f.roots.stateDir, "module-preparation-state.json"));
  await f.service.commit(f.session.sessionId, f.selected.input, { onBox: false });
  const records = await f.workspace.read();
  expect(records.slice(-3).map((record) => record.phase)).toEqual([
    "placement-started",
    "restored",
    "selected",
  ]);
  expect(records.every((record) => record.binding.eventId === f.session.binding.eventId)).toBe(
    true,
  );
  expect(records.at(-1)!.input).toEqual(f.selected.input);
  expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(original);
  expect(await readFile(join(f.roots.stateDir, "module-preparation-state.json"))).toEqual(
    oldPreparation,
  );
  await expect(access(join(f.roots.venueDir, "venue.db"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const target = f.record.target.target;
  const placed = await openVenueDatabase(target.venueDir);
  try {
    const rows = await placed.venue.select().from(invoiceSeries);
    expect(
      rows
        .filter((row) => row.retiredAt !== null)
        .map(({ code, nextNumber }) => ({ code, nextNumber }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    ).toEqual([
      { code: "A-0CNNY", nextNumber: 123 },
      { code: "FF-0CNNY", nextNumber: 123 },
      { code: "R-0CNNY", nextNumber: 123 },
    ]);
    expect(
      rows
        .filter((row) => row.retiredAt === null)
        .map(({ code, nextNumber }) => ({ code, nextNumber }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    ).toEqual([
      { code: `A-${f.selected.identity}`, nextNumber: 1 },
      { code: `FF-${f.selected.identity}`, nextNumber: 1 },
      { code: `R-${f.selected.identity}`, nextNumber: 1 },
    ]);
  } finally {
    await placed.close();
  }
  const carried = JSON.parse(
    await readFile(
      join(target.stateDir, "module-evidence", "fiscal-verifactu", "hour-history.json"),
      "utf8",
    ),
  ) as unknown;
  expect(carried).toMatchObject({
    records: expect.arrayContaining([expect.objectContaining({ identity: "0CNQT" })]),
  });
  const captured = await collectModuleNonDbState(
    ALL_MODULES,
    { "product-images": join(root, "no-images") },
    undefined,
    {
      read: (module) => readModulePreparationHistory(target, module),
      readRetained: async (name) => [
        JSON.parse(await readFile(join(target.stateDir, name), "utf8")) as unknown,
      ],
    },
  );
  expect(
    readModuleRecoveryEvidence(ALL_MODULES, captured)["fiscal-verifactu"]?.["hour-history"],
  ).toMatchObject({
    records: expect.arrayContaining([expect.objectContaining({ identity: "0CNQT" })]),
  });
});

it.each([null, {}, { changed: true }])(
  "refuses a commit input other than the durably selected value: %j",
  async (input) => {
    const f = await selectedRepair();
    await expect(
      f.service.commit(f.session.sessionId, input, { onBox: false }),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect((await f.workspace.read()).at(-1)).toEqual(f.record);
    await expect(access(join(f.record.target.target.venueDir, "venue.db"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("refuses commit without a selected preparation input", async () => {
  const f = await fixture(true);
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  await expect(service.commit(session.sessionId, {}, { onBox: false })).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await f.workspace.read()).toEqual([]);
});

it("does not overwrite an unexplained database that appeared in the prepared target", async () => {
  const f = await selectedRepair();
  const path = join(f.record.target.target.venueDir, "venue.db");
  const original = Buffer.from("unexplained target database");
  await writeFile(path, original);
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readFile(path)).toEqual(original);
  expect((await f.workspace.read()).at(-1)).toEqual(f.record);
});

it("retains a started placement after a copy interruption and refuses further preparation on that event", async () => {
  const f = await selectedRepair();
  const serviceLog = vi.fn((...args: unknown[]) => {
    if (args[1] === "restore.migrated") throw new Error("interrupted placement");
  });
  f.options.log = serviceLog;
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toThrow("interrupted placement");
  const records = await f.workspace.read();
  expect(records.at(-1)!.phase).toBe("placement-started");
  expect(records.at(-1)!.binding).toEqual(f.session.binding);
  await expect(
    f.service.prepare(f.session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await f.workspace.read()).toEqual(records);
});

it("refuses a recovery module without exact-commit verification before placing its database", async () => {
  const f = await selectedRepair();
  f.options.modules = ALL_MODULES.map((module) => {
    if (module.name !== "fiscal-verifactu") return module;
    const { assertRestoreCommitted, ...backup } = module.backup!;
    void assertRestoreCommitted;
    return { ...module, backup };
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "module.operation_invalid" });
  expect((await f.workspace.read()).at(-1)).toEqual(f.record);
  await expect(access(join(f.record.target.target.venueDir, "venue.db"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each(["trading.env", "node-key.enc", "unlisted-private-evidence.json"])(
  "preserves unexpected target state %s rather than publishing over it",
  async (name) => {
    const f = await selectedRepair();
    const path = join(f.record.target.target.stateDir, name);
    const bytes = Buffer.from("unexplained target state");
    await writeFile(path, bytes);
    await expect(
      f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(await readFile(path)).toEqual(bytes);
    expect((await f.workspace.read()).at(-1)).toEqual(f.record);
    await expect(access(join(f.record.target.target.venueDir, "venue.db"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("places a signed bucket generation with its distinct activation binding and stream first-start marker", async () => {
  const f = await fixture(true);
  const signer = generateNodeKeyPair();
  const generation = `gen-0-${node.nodeId}-20261016T124000Z`;
  const kit = {
    version: 1 as const,
    venueId: node.locationId,
    bucket: {
      region: "local",
      bucket: "copy",
      prefix: "",
      accessKeyId: "synthetic",
      secretAccessKey: "synthetic",
    },
    recoveryKey: "separate bucket key",
    pointerSignerPublicKey: signer.publicKey,
  };
  const store = createMemoryObjectStore({ now: () => new Date() });
  await writePointer(
    store,
    kit.venueId,
    signPointer(
      {
        venueId: kit.venueId,
        nodeId: node.nodeId,
        generation,
        term: 0,
        writtenAt: new Date().toISOString(),
      },
      signer.privateKey,
    ),
    null,
  );
  await writeSealedStateRow(
    suite.db,
    node.nodeId,
    await sealNodeState(f.entries, kit.recoveryKey),
    new Date(),
  );
  await suite.db.archiveTo(f.database);
  const service = recovery({
    ...f.options,
    sources: {
      ...f.options.sources,
      bucket: {
        ...f.options.sources.bucket,
        openStore: () => store,
        restoreGeneration: async ({ outPath }) => {
          await copyFile(f.database, outPath);
        },
      },
    },
  });
  const session = await service.open(
    {
      ...f.request,
      source: { kind: "bucket", kit: encodeRecoveryKit(kit), environment: "preproduction" },
    },
    { onBox: false },
  );
  expect(session.preview.sourceId).toBe(`stream:${node.locationId}:${generation}`);
  expect(session.binding.sourceId).toMatch(/^stream-sha256:[a-f0-9]{64}$/);
  expect(session.preview.activationSourceId).toBe(session.binding.sourceId);
  const selected = (await recoverySelectPastWaits(
    clock,
    { prepare: (proposal, client) => service.prepare(session.sessionId, proposal, client) },
    { onBox: false },
  )) as { input: unknown };
  await service.commit(session.sessionId, selected.input, { onBox: false });
  const record = (await f.workspace.read()).at(-1)!;
  expect(record.phase).toBe("selected");
  expect(record.sourceId).toBe(session.preview.sourceId);
  expect(record.activationSourceId).toBe(session.binding.sourceId);
  expect(
    JSON.parse(
      await readFile(join(record.target.target.stateDir, "rebuild-first-start.json"), "utf8"),
    ),
  ).toEqual({ version: 1, source: "stream" });
  const placed = await openVenueDatabase(record.target.target.venueDir);
  try {
    expect(
      (await placed.venue.select().from(invoiceSeries)).filter((row) => row.retiredAt === null),
    ).toHaveLength(3);
  } finally {
    await placed.close();
  }
});

it("refuses a changed projection even when both public evidence files have been replaced to match it", async () => {
  const f = await fixture(true);
  let projected: Record<string, unknown> | undefined;
  const modules = ALL_MODULES.map((module) =>
    module.name !== "fiscal-verifactu"
      ? module
      : {
          ...module,
          backup: {
            ...module.backup,
            nonDbState: module.backup!.nonDbState!.map((source) =>
              source.kind !== "preparation-history"
                ? source
                : {
                    ...source,
                    project: (...args: Parameters<typeof source.project>) => {
                      const value = source.project(...args) as Record<string, unknown>;
                      projected = value;
                      return value;
                    },
                  },
            ),
          },
        },
  );
  const service = recovery({ ...f.options, modules, host: { ...f.host, modules } });
  const session = await service.open(f.request, { onBox: false });
  await service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false });
  const record = (await f.workspace.read()).at(-1)!;
  projected!.timeFloorMs = Date.parse("2026-10-16T15:00:00Z");
  const operationPath = join(
    dirname(dirname(record.target.target.stateDir)),
    "retained-evidence.json",
  );
  await writeFile(operationPath, JSON.stringify({ "hour-history": projected }));
  await writeFile(
    join(record.target.target.stateDir, "module-evidence", "fiscal-verifactu", "hour-history.json"),
    JSON.stringify(projected),
  );
  await expect(
    service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await f.workspace.read()).at(-1)).toEqual(record);
});

it.each(["restored-record", "selection"] as const)(
  "retains exact activation after interruption at %s and requires new proof after shutdown",
  async (point) => {
    const f = await selectedRepair();
    if (point === "restored-record") {
      const append = f.workspace.append;
      vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
        if (record.phase === "restored") throw new AppError("setup.attempt_invalid", {});
        return append(record);
      });
    } else
      vi.spyOn(f.workspace, "select").mockRejectedValue(new AppError("setup.attempt_invalid", {}));
    await expect(
      f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    const records = await f.workspace.read();
    expect(records.at(-1)!.phase).toBe(
      point === "restored-record" ? "placement-started" : "restored",
    );
    expect(records.at(-1)!.binding).toEqual(f.session.binding);
    expect(records.at(-1)!.input).toEqual(f.selected.input);
    const placed = await openVenueDatabase(f.record.target.target.venueDir);
    try {
      await withTransaction(placed.venue, (tx) =>
        ALL_MODULES.find((module) => module.name === "fiscal-verifactu")!.backup!
          .assertRestoreCommitted!(tx, node, f.session.binding),
      );
      const rows = await placed.venue.select().from(invoiceSeries);
      expect(rows.filter((row) => row.retiredAt === null).map((row) => row.nextNumber)).toEqual([
        1, 1, 1,
      ]);
      expect(rows.filter((row) => row.retiredAt !== null).map((row) => row.nextNumber)).toEqual([
        123, 123, 123,
      ]);
    } finally {
      await placed.close();
    }
    await f.service.dispose();
    const restarted = recovery(f.options);
    await expect(
      restarted.commit(f.session.sessionId, f.selected.input, { onBox: false }),
    ).rejects.toMatchObject({ code: "setup.owner_required" });
    await expect(restarted.open(f.request, { onBox: false })).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    expect(await f.workspace.read()).toEqual(records);
  },
);

it("never records restored or selects when the owning module refuses the committed event", async () => {
  const f = await selectedRepair();
  f.options.modules = ALL_MODULES.map((module) =>
    module.name !== "fiscal-verifactu"
      ? module
      : {
          ...module,
          backup: {
            ...module.backup,
            assertRestoreCommitted: async () => {
              throw new AppError("module.operation_invalid", { module: module.name });
            },
          },
        },
  );
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "module.operation_invalid" });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
  const placed = await openVenueDatabase(f.record.target.target.venueDir);
  try {
    await withTransaction(placed.venue, (tx) =>
      ALL_MODULES.find((module) => module.name === "fiscal-verifactu")!.backup!
        .assertRestoreCommitted!(tx, node, f.session.binding),
    );
  } finally {
    await placed.close();
  }
});

it("places into a new target while retaining a populated local database and its original counters byte for byte", async () => {
  const f = await fixture(true);
  const path = join(f.roots.venueDir, "venue.db");
  await suite.db.archiveTo(path);
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  f.request.observation = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision,
    ownerGeneration: inspected.ownerGeneration,
  };
  const original = await readFile(path);
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  const selected = (await recoverySelectPastWaits(
    clock,
    { prepare: (proposal, client) => service.prepare(session.sessionId, proposal, client) },
    { onBox: false },
  )) as { input: unknown };
  await service.commit(session.sessionId, selected.input, { onBox: false });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
  expect(await readFile(path)).toEqual(original);
  const local = await openVenueDatabase(f.roots.venueDir);
  try {
    expect((await local.venue.select().from(invoiceSeries)).map((row) => row.nextNumber)).toEqual([
      123, 123, 123,
    ]);
  } finally {
    await local.close();
  }
});

it("shutdown waits for a private source still opening before reporting cleanup complete", async () => {
  const f = await fixture();
  const opened = barrier(),
    release = barrier();
  const real = (await vi.importActual<typeof sources>("./first-setup-backup-source.js"))
    .openFirstSetupBackupSource;
  let selected: Awaited<ReturnType<typeof real>> | undefined;
  vi.spyOn(sources, "openFirstSetupBackupSource").mockImplementation(async (...args) => {
    selected = await real(...args);
    opened.resolve();
    await release.promise;
    return selected;
  });
  const service = recovery(f.options);
  const pending = service.open(f.request, { onBox: false }).catch((error: unknown) => error);
  await opened.promise;
  let closed = false;
  const closing = service.dispose().then(() => {
    closed = true;
  });
  try {
    await expect(service.status()).rejects.toMatchObject({ code: "setup.owner_required" });
    expect(closed, "private opening has not returned its disposer yet").toBe(false);
  } finally {
    release.resolve();
    await closing;
    await pending;
  }
  expect(await pending).toMatchObject({ code: "setup.owner_required" });
  await expect(readFile(selected!.copy.databasePath)).rejects.toMatchObject({ code: "ENOENT" });
  expect(closed).toBe(true);
  expect(await f.workspace.read()).toEqual([]);
});

it("shutdown drains an unfinished bucket restore before deleting its private destination", async () => {
  const f = await fixture();
  const signer = generateNodeKeyPair();
  const store = createMemoryObjectStore({ now: () => new Date() });
  const generation = `gen-0-${node.nodeId}-20261016T124000Z`;
  const kit = {
    version: 1 as const,
    venueId: node.locationId,
    bucket: {
      region: "local",
      bucket: "copy",
      prefix: "",
      accessKeyId: "synthetic",
      secretAccessKey: "synthetic",
    },
    recoveryKey: "bucket-secret",
    pointerSignerPublicKey: signer.publicKey,
  };
  await writePointer(
    store,
    node.locationId,
    signPointer(
      {
        venueId: node.locationId,
        nodeId: node.nodeId,
        generation,
        term: 0,
        writtenAt: new Date().toISOString(),
      },
      signer.privateKey,
    ),
    null,
  );
  await writeSealedStateRow(
    suite.db,
    node.nodeId,
    await sealNodeState(f.entries, kit.recoveryKey),
    new Date(),
  );
  await suite.db.archiveTo(f.database);
  const entered = barrier(),
    release = barrier();
  let destination: string | undefined;
  const service = recovery({
    ...f.options,
    sources: {
      ...f.options.sources,
      bucket: {
        ...f.options.sources.bucket,
        openStore: () => store,
        restoreGeneration: async ({ outPath }) => {
          destination = outPath;
          await copyFile(f.database, outPath);
          entered.resolve();
          await release.promise;
        },
      },
    },
  });
  const pending = service
    .open(
      {
        ...f.request,
        source: { kind: "bucket", kit: encodeRecoveryKit(kit), environment: "preproduction" },
      },
      { onBox: false },
    )
    .catch((error: unknown) => error);
  await entered.promise;
  expect((await readFile(destination!)).byteLength).toBeGreaterThan(0);
  let closed = false;
  const closing = service.dispose().then(() => {
    closed = true;
  });
  try {
    await expect(service.status()).rejects.toMatchObject({ code: "setup.owner_required" });
    expect(closed).toBe(false);
    expect((await readFile(destination!)).byteLength).toBeGreaterThan(0);
  } finally {
    release.resolve();
    await closing;
    await pending;
  }
  expect(await pending).toMatchObject({ code: "setup.owner_required" });
  await expect(access(destination!)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await f.workspace.read()).toEqual([]);
  expect((await readFile(f.database)).byteLength).toBeGreaterThan(0);
});

it("reads a discarded recovery as none, and runs a second archive recovery to selected beside it", async () => {
  const f = await fixture(true);
  const entries = unpackArchive(decryptArtifact(f.request.source.artifact, f.restore.recoveryKey));
  entries.push({
    name: "secrets/module-evidence/fiscal-verifactu/hour-history.json",
    bytes: Buffer.from(
      JSON.stringify({ reference: "prepared-hours", complete: true, records: [] }),
    ),
  });
  f.request.source.artifact = Uint8Array.from(
    encryptArtifact(packArchive(entries), f.restore.recoveryKey),
  );
  const service = recovery(f.options);
  const first = await service.open(f.request, { onBox: false });
  await service.prepare(first.sessionId, { action: "clock-challenge" }, { onBox: false });
  await service.close(first.sessionId);
  await f.workspace.abandon(first.recoveryId);
  expect(await service.status()).toEqual({ phase: "unstarted", proofRequired: true });
  await expect(service.open(f.request, { onBox: false })).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
  });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("abandoned");
  await emptyAbandonedBackupRecovery(f.roots, first.recoveryId);
  expect(await service.status()).toEqual({ phase: "unstarted", proofRequired: true });
  const second = await service.open(f.request, { onBox: false });
  expect(second.recoveryId).not.toBe(first.recoveryId);
  const selected = (await recoverySelectPastWaits(
    clock,
    { prepare: (proposal, client) => service.prepare(second.sessionId, proposal, client) },
    { onBox: false },
  )) as { status: string; input: unknown };
  expect(selected.status).toBe("selected");
  await service.commit(second.sessionId, selected.input, { onBox: false });
  const records = await f.workspace.read();
  expect(new Set(records.map((record) => record.target.recoveryId))).toEqual(
    new Set([second.recoveryId]),
  );
  expect(records.slice(-3).map((record) => record.phase)).toEqual([
    "placement-started",
    "restored",
    "selected",
  ]);
  expect(await service.status()).toEqual({
    phase: "selected",
    recoveryId: second.recoveryId,
    proofRequired: true,
  });
});
