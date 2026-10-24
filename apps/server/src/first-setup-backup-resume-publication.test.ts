import { key, node, clock, suite } from "../test/hour-recovery-host.js";

import { access, copyFile, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import { openVenueDatabase, invoiceSeries } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";

import { AppError } from "@waitron/shared";

import * as sources from "./first-setup-backup-source.js";
import * as stateSecrets from "./state-secrets.js";

import { encryptArtifact, decryptArtifact } from "./artifact-cipher.js";
import { packArchive, unpackArchive } from "./backup-archive.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";
import { generateNodeKeyPair } from "@waitron/membership";
import { encodeRecoveryKit, signPointer, writePointer } from "@waitron/stream";
import { createMemoryObjectStore } from "@waitron/stream/testing/memory-store.js";
import { sealNodeState, writeSealedStateRow } from "./sealed-state.js";

import {
  recovery,
  barrier,
  fixture,
  selectedRepair,
  interruptedRepair,
} from "../test/first-setup-backup-resume-fixture.js";

vi.mock("./state-secrets.js", { spy: true });
vi.mock("./first-setup-backup-source.js", { spy: true });

it.each([
  "malformed",
  "null",
  "missing-preview",
  "version",
  "kind",
  "source",
  "environment",
  "missing-metadata",
  "duplicate-metadata",
] as const)("resume refuses %s publication metadata without a target write", async (change) => {
  const f = await interruptedRepair();
  const path = join(dirname(dirname(f.record.target.target.stateDir)), "publication.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  let entries = unpackArchive(decryptArtifact(Buffer.from(saved.ciphertext, "base64"), key.secret));
  const entry = entries.find((entry) => entry.name === "repair-publication.json")!;
  const meta = JSON.parse(Buffer.from(entry.bytes).toString("utf8"));
  if (change === "malformed") entry.bytes = Buffer.from("{");
  else if (change === "null") entry.bytes = Buffer.from("null");
  else if (change === "missing-metadata") entries = entries.filter((value) => value !== entry);
  else if (change === "duplicate-metadata") entries.push({ ...entry });
  else {
    if (change === "missing-preview") delete meta.preview;
    else if (change === "version") meta.version = 2;
    else if (change === "kind") meta.kind = "cloud";
    else if (change === "source") meta.preview.sourceId = "another-source";
    else meta.preview.environment = "production";
    entry.bytes = Buffer.from(JSON.stringify(meta));
  }
  saved.ciphertext = encryptArtifact(packArchive(entries), key.secret).toString("base64");
  await writeFile(path, JSON.stringify(saved));
  await expect(recovery(f.options).resume(f.resumeRequest, { onBox: false })).rejects.toMatchObject(
    { code: "setup.attempt_conflict" },
  );
  expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
  await expect(access(join(f.record.target.target.stateDir, "trading.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("private publication seals the selected input even if the placement-started append is interrupted", async () => {
  const f = await selectedRepair();
  const append = f.workspace.append;
  vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
    if (record.phase === "placement-started") throw new AppError("setup.attempt_invalid", {});
    return append(record);
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  await expect(
    f.service.prepare(f.session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await f.workspace.read()).at(-1)!.input).toEqual(f.selected.input);
});

it.each([
  "module-check",
  "module-reader",
  "public-evidence",
  "different-preview",
  "stopped",
  "stopped-under-exclusion",
] as const)(
  "resume retains an interrupted target when %s is unavailable or changed",
  async (change) => {
    const f = await interruptedRepair();
    const service = recovery(f.options);
    let stopping: Promise<void> | undefined;
    if (change === "module-check")
      f.options.modules = ALL_MODULES.map((module) =>
        module.name === "fiscal-verifactu"
          ? { ...module, backup: { ...module.backup, assertRestoreCommitted: undefined } }
          : module,
      );
    else if (change === "module-reader")
      f.options.host = {
        ...f.host,
        modules: f.host.modules.filter((module) => module.name !== "fiscal-verifactu"),
      };
    else if (change === "public-evidence")
      await unlink(
        join(dirname(dirname(f.record.target.target.stateDir)), "retained-evidence.json"),
      );
    else if (change === "different-preview") {
      const path = join(dirname(dirname(f.record.target.target.stateDir)), "publication.json");
      const saved = JSON.parse(await readFile(path, "utf8"));
      const entries = unpackArchive(
        decryptArtifact(Buffer.from(saved.ciphertext, "base64"), key.secret),
      );
      const entry = entries.find((entry) => entry.name === "repair-publication.json")!;
      const meta = JSON.parse(Buffer.from(entry.bytes).toString("utf8"));
      meta.preview.taxpayer.taxId = "another-taxpayer";
      entry.bytes = Buffer.from(JSON.stringify(meta));
      saved.ciphertext = encryptArtifact(packArchive(entries), key.secret).toString("base64");
      await writeFile(path, JSON.stringify(saved));
    } else if (change === "stopped") await service.dispose();
    else {
      const original = f.host.resolution.withVenueExclusion;
      f.host.resolution.withVenueExclusion = (run) =>
        original(async () => {
          stopping = service.dispose();
          return run();
        });
    }
    await expect(service.resume(f.resumeRequest, { onBox: false })).rejects.toMatchObject({
      code: change.startsWith("module-")
        ? "module.operation_invalid"
        : change.startsWith("stopped")
          ? "setup.owner_required"
          : "setup.attempt_conflict",
    });
    await stopping;
    expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
    await expect(
      access(join(f.record.target.target.stateDir, "trading.env")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("a slower old resume cannot replace a more recent target proof", async () => {
  const f = await interruptedRepair();
  const reached = barrier(),
    release = barrier();
  const actual = (await vi.importActual<typeof sources>("./first-setup-backup-source.js"))
    .authenticatedFirstSetupBackupPreview;
  let calls = 0;
  vi.spyOn(sources, "authenticatedFirstSetupBackupPreview").mockImplementation(async (...args) => {
    const result = await actual(...args);
    if (++calls === 1) {
      reached.resolve();
      await release.promise;
    }
    return result;
  });
  const service = recovery(f.options);
  const old = service.resume(f.resumeRequest, { onBox: false }).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await reached.promise;
  let current;
  try {
    current = await service.resume(f.resumeRequest, { onBox: false });
  } finally {
    release.resolve();
  }
  expect(await old).toMatchObject({ error: { code: "setup.attempt_conflict" } });
  await service.commit(current!.sessionId, f.selected.input, { onBox: false });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
});

it("resume retains a partial target database and refuses it as uncertain without creating a replacement", async () => {
  const f = await interruptedRepair();
  const path = join(f.record.target.target.venueDir, "venue.db");
  const bytes = Buffer.from("interrupted SQLite file copy");
  await writeFile(path, bytes);
  await expect(recovery(f.options).resume(f.resumeRequest, { onBox: false })).rejects.toMatchObject(
    { code: "setup.attempt_uncertain" },
  );
  expect(await readFile(path)).toEqual(bytes);
  expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
});

it("resumes a committed signed bucket copy without fetching it again and retains its stream marker", async () => {
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
  let downloads = 0;
  const options = {
    ...f.options,
    sources: {
      ...f.options.sources,
      bucket: {
        ...f.options.sources.bucket,
        openStore: () => store,
        restoreGeneration: async ({ outPath }: { outPath: string }) => {
          if (++downloads > 1) throw new Error("source no longer available");
          await copyFile(f.database, outPath);
        },
      },
    },
  };
  const service = recovery(options);
  const session = await service.open(
    {
      ...f.request,
      source: { kind: "bucket", kit: encodeRecoveryKit(kit), environment: "preproduction" },
    },
    { onBox: false },
  );
  const selected = (await recoverySelectPastWaits(
    clock,
    { prepare: (proposal, client) => service.prepare(session.sessionId, proposal, client) },
    { onBox: false },
  )) as { input: unknown };
  vi.spyOn(stateSecrets, "unpackBundleToDir").mockRejectedValueOnce(
    new Error("interrupted secrets"),
  );
  await expect(service.commit(session.sessionId, selected.input, { onBox: false })).rejects.toThrow(
    "interrupted secrets",
  );
  await service.dispose();
  const restarted = recovery(options);
  const resumed = await restarted.resume(
    {
      observation: f.request.observation,
      recoveryId: session.recoveryId,
      nodeRecoverySecret: key.secret,
      context: { oldBoxGone: true, soleRecovery: true },
    },
    { onBox: false },
  );
  expect(resumed.binding).toEqual(session.binding);
  expect(resumed.preview.sourceId).toBe(`stream:${node.locationId}:${generation}`);
  expect(resumed.binding.sourceId).toMatch(/^stream-sha256:[a-f0-9]{64}$/);
  await restarted.commit(resumed.sessionId, selected.input, { onBox: false });
  const last = (await f.workspace.read()).at(-1)!;
  expect(last.phase).toBe("selected");
  expect(
    JSON.parse(
      await readFile(join(last.target.target.stateDir, "rebuild-first-start.json"), "utf8"),
    ),
  ).toEqual({ version: 1, source: "stream" });
  const target = await openVenueDatabase(last.target.target.venueDir);
  try {
    expect(
      (await target.venue.select().from(invoiceSeries))
        .filter((row) => row.retiredAt === null)
        .map((row) => row.nextNumber),
    ).toEqual([1, 1, 1]);
  } finally {
    await target.close();
  }
});
