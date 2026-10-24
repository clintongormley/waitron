import { archiveHost, key, node, clock, suite } from "../test/hour-recovery-host.js";
import { randomBytes } from "node:crypto";
import { copyFile, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as filesystem from "node:fs/promises";
import * as preparation from "./recovery-preparation.js";
import * as restore from "./restore.js";
import { generateNodeKeyPair } from "@waitron/membership";
import { encodeRecoveryKit, signPointer, writePointer } from "@waitron/stream";
import { createMemoryObjectStore } from "@waitron/stream/testing/memory-store.js";
import { sealNodeState, writeSealedStateRow } from "./sealed-state.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openVenueDatabase, invoiceSeries } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import { createFirstSetupBackupWorkspace } from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import * as sources from "./first-setup-backup-source.js";
import { createFirstSetupBackupRecovery } from "./first-setup-backup-recovery.js";
import { request as ownerRequest } from "../test/first-fiscal.js";
import { encryptArtifact, decryptArtifact } from "./artifact-cipher.js";
import { packArchive, unpackArchive } from "./backup-archive.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";

vi.mock("./first-setup-backup-source.js", { spy: true });
vi.mock("node:fs/promises", { spy: true });
vi.mock("./recovery-preparation.js", { spy: true });
vi.mock("./restore.js", { spy: true });
beforeEach(async () => {
  const fs = await vi.importActual<typeof filesystem>("node:fs/promises");
  vi.mocked(filesystem.lstat).mockImplementation(fs.lstat);
  const placement = await vi.importActual<typeof restore>("./restore.js");
  vi.mocked(restore.writeValidated).mockImplementation(placement.writeValidated);
  const prep = await vi.importActual<typeof preparation>("./recovery-preparation.js");
  vi.mocked(preparation.createSelectedRecoveryPreparation).mockImplementation(
    prep.createSelectedRecoveryPreparation,
  );
  const actual = await vi.importActual<typeof sources>("./first-setup-backup-source.js");
  vi.mocked(sources.authenticatedFirstSetupBackupPreview).mockImplementation(
    actual.authenticatedFirstSetupBackupPreview,
  );
});

const services: ReturnType<typeof createFirstSetupBackupRecovery>[] = [];
function recovery(options: Parameters<typeof createFirstSetupBackupRecovery>[0]) {
  const service = createFirstSetupBackupRecovery(options);
  services.push(service);
  return service;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const service of services.splice(0)) await service.dispose();
});

async function fixture(readableAttempt = false) {
  const f = await archiveHost();
  const host = createFirstSetupModuleHost({
    ...f.roots,
    modules: ALL_MODULES,
    environment: { WAITRON_ENV: "preproduction" },
  });
  const workspace = createFirstSetupBackupWorkspace(f.roots);
  if (readableAttempt) {
    await host.owner.claimFirstSetup(
      {
        environment: "preproduction",
        request: {
          ...ownerRequest,
          legalName: "Retained setup company",
          location: {
            ...ownerRequest.location,
            operationDescription: "Restaurant",
            name: "Retained setup venue",
          },
        },
      },
      randomBytes(32).toString("base64url"),
    );
  } else {
    await writeFile(join(f.roots.stateDir, "first-setup.json"), "unreadable old attempt");
  }
  const options = {
    ...f.roots,
    environment: "preproduction" as const,
    modules: ALL_MODULES,
    host,
    workspace,
    sources: {
      ...f.restore,
      bucket: { litestreamBin: "/unused", now: () => new Date(), log: () => {} },
    },
    log: () => {},
  };
  await host.resolution.withVenueExclusion(async () => {});
  const inspected = await host.resolution.inspectFirstSetupResolution();
  const request = {
    observation: {
      inspectionId: inspected.inspectionId,
      revision: inspected.revision,
      ownerGeneration: inspected.ownerGeneration,
    },
    source: {
      kind: "archive" as const,
      artifact: Uint8Array.from(f.restore.artifact),
      recoveryKey: f.restore.recoveryKey,
      environment: "preproduction" as const,
    },
    nodeRecoverySecret: key.secret,
    context: { oldBoxGone: true, soleRecovery: true },
  };
  return { ...f, host, workspace, options, request };
}

async function selectedRepair() {
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
  const session = await service.open(f.request, { onBox: false });
  const selected = (await recoverySelectPastWaits(
    clock,
    {
      prepare: (proposal, client) => service.prepare(session.sessionId, proposal, client),
    },
    { onBox: false },
  )) as { status: string; identity: string; input: unknown };
  expect(selected.status).toBe("selected");
  return { ...f, service, session, selected, record: (await f.workspace.read()).at(-1)! };
}

it("reauthenticates prepared work after restart and commits its original event and target", async () => {
  const f = await selectedRepair();
  const original = await readFile(join(f.roots.stateDir, "first-setup.json"));
  await f.service.dispose();
  const restarted = recovery(f.options);
  const reopened = await restarted.open(
    { ...f.request, recoveryId: f.session.recoveryId },
    { onBox: false },
  );
  expect(reopened.input).toEqual(f.selected.input);
  expect(reopened.binding).toEqual(f.session.binding);
  expect(reopened.recoveryId).toBe(f.session.recoveryId);
  expect(reopened.sessionId).not.toBe(f.session.sessionId);
  const selected = (await recoverySelectPastWaits(
    clock,
    {
      prepare: (proposal, client) => restarted.prepare(reopened.sessionId, proposal, client),
    },
    { onBox: false },
  )) as { status: string; input: unknown };
  expect(selected.status).toBe("selected");
  if (selected.status !== "selected") throw new Error("missing selection");
  await restarted.commit(reopened.sessionId, selected.input, { onBox: false });
  const records = await f.workspace.read();
  expect(records.at(-1)!.phase).toBe("selected");
  expect(records.every((record) => record.binding.eventId === f.session.binding.eventId)).toBe(
    true,
  );
  expect(
    records.every((record) => record.target.target.venueDir === f.record.target.target.venueDir),
  ).toBe(true);
  expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(original);
  const target = await openVenueDatabase(f.record.target.target.venueDir);
  try {
    const series = await target.venue.select().from(invoiceSeries);
    expect(series.filter((series) => series.nextNumber === 123)).toHaveLength(3);
    expect(series.filter((series) => series.nextNumber === 1)).toHaveLength(3);
  } finally {
    await target.close();
  }
});

it("reopens the original selected input after private publication but before placement starts", async () => {
  const f = await selectedRepair();
  const append = f.workspace.append;
  vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
    if (record.phase === "placement-started") throw new AppError("setup.attempt_invalid", {});
    return append(record);
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  vi.restoreAllMocks();
  await f.service.dispose();
  const restarted = recovery(f.options);
  const reopened = await restarted.open(
    { ...f.request, recoveryId: f.session.recoveryId },
    { onBox: false },
  );
  expect(reopened.input).toEqual(f.selected.input);
  expect(reopened.binding).toEqual(f.session.binding);
  const selected = (await recoverySelectPastWaits(
    clock,
    {
      prepare: (proposal, client) => restarted.prepare(reopened.sessionId, proposal, client),
    },
    { onBox: false },
  )) as { status: string; input: unknown };
  expect(selected.status).toBe("selected");
  if (selected.status !== "selected") throw new Error("missing selection");
  expect(selected.input).toEqual(f.selected.input);
  await restarted.commit(reopened.sessionId, selected.input, { onBox: false });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
});

it.each(["venue", "state"] as const)(
  "refuses a prepared %s target containing unexplained files, preserving them",
  async (root) => {
    const f = await selectedRepair();
    await f.service.dispose();
    const directory =
      root === "venue" ? f.record.target.target.venueDir : f.record.target.target.stateDir;
    const path = join(directory, root === "venue" ? "venue.db" : "unexplained.txt");
    await writeFile(path, "partial target is retained");
    const before = await f.workspace.read();
    await expect(
      recovery(f.options).open(
        { ...f.request, recoveryId: f.session.recoveryId },
        { onBox: false },
      ),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(await readFile(path, "utf8")).toBe("partial target is retained");
    expect(await f.workspace.read()).toEqual(before);
  },
);

it.each([
  "wrong-key",
  "changed-source",
  "different-id",
  "stale-observation",
  "original-change",
] as const)(
  "refuses prepared-source restart with %s without changing its journal",
  async (fault) => {
    const f = await selectedRepair();
    await f.service.dispose();
    const request = { ...f.request, recoveryId: f.session.recoveryId };
    if (fault === "wrong-key") request.nodeRecoverySecret = "incorrect-node-proof";
    if (fault === "changed-source")
      request.source = {
        ...f.request.source,
        artifact: Uint8Array.from(
          encryptArtifact(
            decryptArtifact(f.request.source.artifact, f.restore.recoveryKey),
            f.restore.recoveryKey,
          ),
        ),
      };
    if (fault === "different-id") request.recoveryId = "8a60ef35-3542-4a14-9909-5c3aaee7e7be";
    if (fault === "stale-observation")
      request.observation = { ...request.observation, inspectionId: "f".repeat(64) };
    const before = await f.workspace.read();
    if (fault === "original-change")
      await writeFile(join(f.roots.stateDir, "retained.txt"), "independent retained change");
    await expect(recovery(f.options).open(request, { onBox: false })).rejects.toMatchObject({
      code: fault === "wrong-key" ? "promotion.break_glass_invalid" : "setup.attempt_conflict",
    });
    if (fault === "original-change") {
      expect(await readFile(join(f.roots.stateDir, "retained.txt"), "utf8")).toBe(
        "independent retained change",
      );
      await unlink(join(f.roots.stateDir, "retained.txt"));
    }
    expect(await f.workspace.read()).toEqual(before);
  },
);

it("reconstructs the same public evidence if the first prepared append completed before evidence publication", async () => {
  const f = await fixture(true);
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  const append = f.workspace.append;
  vi.spyOn(f.workspace, "append").mockImplementationOnce(async (record) => {
    await append(record);
    throw new AppError("setup.attempt_invalid", {});
  });
  await expect(
    service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  vi.restoreAllMocks();
  await service.dispose();
  const before = (await f.workspace.read()).at(-1)!;
  const restarted = recovery(f.options);
  const reopened = await restarted.open(
    { ...f.request, recoveryId: session.recoveryId },
    { onBox: false },
  );
  expect(reopened.binding).toEqual(session.binding);
  const prepared = (await f.workspace.read()).at(-1)!;
  expect(prepared.binding).toEqual(before.binding);
  expect(prepared.retainedEvidenceDigest).toBe(before.retainedEvidenceDigest);
  expect(prepared.target).toEqual(before.target);
  expect(
    await restarted.prepare(reopened.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).toMatchObject({ id: expect.any(String) });
});

it("reauthenticates an empty placement-started target without overwriting a partial database", async () => {
  const f = await selectedRepair();
  const append = f.workspace.append;
  vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
    const saved = await append(record);
    if (record.phase === "placement-started") throw new AppError("setup.attempt_invalid", {});
    return saved;
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  vi.restoreAllMocks();
  await f.service.dispose();
  expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
  const restarted = recovery(f.options);
  const reopened = await restarted.open(
    { ...f.request, recoveryId: f.session.recoveryId },
    { onBox: false },
  );
  const selected = (await recoverySelectPastWaits(
    clock,
    { prepare: (proposal, client) => restarted.prepare(reopened.sessionId, proposal, client) },
    { onBox: false },
  )) as { status: string; input: unknown };
  expect(selected.status).toBe("selected");
  if (selected.status !== "selected") throw new Error("missing selection");
  expect(selected.input).toEqual(f.selected.input);
  await restarted.commit(reopened.sessionId, selected.input, { onBox: false });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
});

it.each([false, true])(
  "reauthenticates the same signed bucket generation after preparation, sealed=%s, without confusing its display source and activation digest",
  async (sealed) => {
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
            downloads++;
            await copyFile(f.database, outPath);
          },
        },
      },
    };
    const request = {
      ...f.request,
      source: {
        kind: "bucket" as const,
        kit: encodeRecoveryKit(kit),
        environment: "preproduction" as const,
      },
    };
    const service = recovery(options);
    const session = await service.open(request, { onBox: false });
    await recoverySelectPastWaits(
      clock,
      { prepare: (proposal, client) => service.prepare(session.sessionId, proposal, client) },
      { onBox: false },
    );
    if (sealed) {
      const selected = (await f.workspace.read()).at(-1)!.input;
      const append = f.workspace.append;
      vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
        if (record.phase === "placement-started") throw new AppError("setup.attempt_invalid", {});
        return append(record);
      });
      await expect(
        service.commit(session.sessionId, selected, { onBox: false }),
      ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
      vi.restoreAllMocks();
    }
    await service.dispose();
    const restarted = recovery(options);
    const reopened = await restarted.open(
      { ...request, recoveryId: session.recoveryId },
      { onBox: false },
    );
    expect(reopened.binding).toEqual(session.binding);
    expect(reopened.preview.sourceId).toBe(`stream:${node.locationId}:${generation}`);
    expect(reopened.binding.sourceId).toMatch(/^stream-sha256:[a-f0-9]{64}$/);
    expect(downloads).toBe(2);
    const selected = (await recoverySelectPastWaits(
      clock,
      { prepare: (proposal, client) => restarted.prepare(reopened.sessionId, proposal, client) },
      { onBox: false },
    )) as { status: string; input: unknown };
    expect(selected.status).toBe("selected");
    await restarted.commit(reopened.sessionId, selected.input, { onBox: false });
    const record = (await f.workspace.read()).at(-1)!;
    expect(record.phase).toBe("selected");
    expect(record.binding.eventId).toBe(session.binding.eventId);
    expect(
      JSON.parse(
        await readFile(join(record.target.target.stateDir, "rebuild-first-start.json"), "utf8"),
      ),
    ).toEqual({ version: 1, source: "stream" });
  },
);

it("a delayed earlier prepared-source proof cannot replace a newer reauthenticated session", async () => {
  const f = await selectedRepair();
  await f.service.dispose();
  let reached!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const actual = (await vi.importActual<typeof sources>("./first-setup-backup-source.js"))
    .authenticatedFirstSetupBackupPreview;
  let calls = 0;
  vi.spyOn(sources, "authenticatedFirstSetupBackupPreview").mockImplementation(async (...args) => {
    const preview = await actual(...args);
    if (++calls === 1) {
      reached();
      await released;
    }
    return preview;
  });
  const service = recovery(f.options);
  const request = { ...f.request, recoveryId: f.session.recoveryId };
  const old = service.open(request, { onBox: false }).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await entered;
  let current;
  try {
    current = await service.open(request, { onBox: false });
  } finally {
    release();
  }
  expect(await old).toMatchObject({ error: { code: "setup.attempt_conflict" } });
  const selected = (await recoverySelectPastWaits(
    clock,
    { prepare: (proposal, client) => service.prepare(current!.sessionId, proposal, client) },
    { onBox: false },
  )) as { status: string; input: unknown };
  expect(selected.status).toBe("selected");
  await service.commit(current!.sessionId, selected.input, { onBox: false });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
});

it("refuses a selected backup whose authenticated module no longer matches the saved operation", async () => {
  const f = await selectedRepair();
  await f.service.dispose();
  const actual = (await vi.importActual<typeof sources>("./first-setup-backup-source.js"))
    .authenticatedFirstSetupBackupPreview;
  vi.spyOn(sources, "authenticatedFirstSetupBackupPreview").mockImplementation(async (...args) => {
    const preview = await actual(...args);
    return {
      ...preview,
      fiscalSelection: { ...preview.fiscalSelection!, module: "another-module" },
    };
  });
  const before = await f.workspace.read();
  await expect(
    recovery(f.options).open({ ...f.request, recoveryId: f.session.recoveryId }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await f.workspace.read()).toEqual(before);
});

it("reports unreadable private-publication metadata as uncertain and retains the original prepared event", async () => {
  const f = await selectedRepair();
  await f.service.dispose();
  const path = join(dirname(dirname(f.record.target.target.stateDir)), "publication.json");
  const actual = await vi.importActual<typeof filesystem>("node:fs/promises");
  vi.spyOn(filesystem, "lstat").mockImplementation(
    (...args: Parameters<typeof filesystem.lstat>) => {
      if (String(args[0]) === path)
        return Promise.reject(
          Object.assign(new Error("private metadata cannot be inspected"), { code: "EACCES" }),
        );
      return actual.lstat(...args);
    },
  );
  const before = await f.workspace.read();
  await expect(
    recovery(f.options).open({ ...f.request, recoveryId: f.session.recoveryId }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect(await f.workspace.read()).toEqual(before);
});

it("fresh clock preparation cannot replace a selection already sealed for publication", async () => {
  const f = await selectedRepair();
  const append = f.workspace.append;
  vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
    if (record.phase === "placement-started") throw new AppError("setup.attempt_invalid", {});
    return append(record);
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  vi.restoreAllMocks();
  await f.service.dispose();
  const actual = (await vi.importActual<typeof preparation>("./recovery-preparation.js"))
    .createSelectedRecoveryPreparation;
  vi.spyOn(preparation, "createSelectedRecoveryPreparation").mockImplementation((options) => {
    const real = actual(options);
    return {
      ...real,
      prepare: async (proposal, client) => {
        const result = await real.prepare(proposal, client);
        return typeof result === "object" &&
          result !== null &&
          "status" in result &&
          result.status === "selected"
          ? { ...result, input: { changed: true } }
          : result;
      },
    };
  });
  const restarted = recovery(f.options);
  const reopened = await restarted.open(
    { ...f.request, recoveryId: f.session.recoveryId },
    { onBox: false },
  );
  await expect(
    recoverySelectPastWaits(
      clock,
      { prepare: (proposal, client) => restarted.prepare(reopened.sessionId, proposal, client) },
      { onBox: false },
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await f.workspace.read()).at(-1)!.input).toEqual(f.selected.input);
  expect((await f.workspace.read()).at(-1)!.phase).toBe("prepared");
});

it("a completed selection cannot be reopened through source preparation", async () => {
  const f = await selectedRepair();
  await f.service.commit(f.session.sessionId, f.selected.input, { onBox: false });
  await f.service.dispose();
  const before = await f.workspace.read();
  await expect(
    recovery(f.options).open({ ...f.request, recoveryId: f.session.recoveryId }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await f.workspace.read()).toEqual(before);
});

it("a database appearing after source proof refuses another clock action without changing its bytes", async () => {
  const f = await selectedRepair();
  await f.service.dispose();
  const service = recovery(f.options);
  const session = await service.open(
    { ...f.request, recoveryId: f.session.recoveryId },
    { onBox: false },
  );
  const path = join(f.record.target.target.venueDir, "venue.db");
  await copyFile(f.database, path);
  const before = await readFile(path);
  await expect(
    service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readFile(path)).toEqual(before);
  expect((await f.workspace.read()).at(-1)!.phase).toBe("prepared");
});

it("rechecks an empty target under the core placement lock before replacing any database", async () => {
  const f = await selectedRepair();
  const path = join(f.record.target.target.venueDir, "venue.db");
  const actual = (await vi.importActual<typeof restore>("./restore.js")).writeValidated;
  let inserted!: Buffer;
  vi.spyOn(restore, "writeValidated").mockImplementation(async (copy, deps) => {
    await copyFile(f.database, path);
    inserted = await readFile(path);
    return actual(copy, deps);
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readFile(path)).toEqual(inserted);
  const target = await openVenueDatabase(f.record.target.target.venueDir);
  try {
    expect(
      (await target.venue.select().from(invoiceSeries)).map((series) => series.nextNumber),
    ).toEqual([123, 123, 123]);
  } finally {
    await target.close();
  }
  expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
});
