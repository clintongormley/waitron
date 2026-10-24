import { archiveHost, key, node, clock, suite } from "../test/hour-recovery-host.js";
import { randomBytes } from "node:crypto";
import { access, copyFile, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openVenueDatabase, invoiceSeries } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import { createFirstSetupBackupWorkspace } from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { createFirstSetupBackupRecovery } from "./first-setup-backup-recovery.js";
import * as sources from "./first-setup-backup-source.js";
import * as stateSecrets from "./state-secrets.js";
import { request as ownerRequest } from "../test/first-fiscal.js";
import { encryptArtifact, decryptArtifact } from "./artifact-cipher.js";
import { packArchive, unpackArchive } from "./backup-archive.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";
import { generateNodeKeyPair } from "@waitron/membership";
import { encodeRecoveryKit, signPointer, writePointer } from "@waitron/stream";
import { createMemoryObjectStore } from "@waitron/stream/testing/memory-store.js";
import { sealNodeState, writeSealedStateRow } from "./sealed-state.js";

vi.mock("./state-secrets.js", { spy: true });
vi.mock("./first-setup-backup-source.js", { spy: true });
beforeEach(async () => {
  const actual = await vi.importActual<typeof sources>("./first-setup-backup-source.js");
  vi.mocked(sources.openFirstSetupBackupSource).mockImplementation(
    actual.openFirstSetupBackupSource,
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

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

it.each(["secrets", "restored-record", "selection"] as const)(
  "reauthenticates the committed target after %s interruption and finishes the same event without replacing counters",
  async (point) => {
    const f = await selectedRepair();
    if (point === "secrets") {
      vi.spyOn(stateSecrets, "unpackBundleToDir").mockRejectedValueOnce(
        new Error("interrupted before secret publication"),
      );
    } else if (point === "restored-record") {
      const append = f.workspace.append;
      vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
        if (record.phase === "restored") throw new AppError("setup.attempt_invalid", {});
        return append(record);
      });
    } else
      vi.spyOn(f.workspace, "select").mockRejectedValue(new AppError("setup.attempt_invalid", {}));
    await expect(
      f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
    ).rejects.toThrow();
    vi.restoreAllMocks();
    f.options.log = () => {};
    await f.service.dispose();
    const target = f.record.target.target;
    const database = await openVenueDatabase(target.venueDir);
    let before;
    try {
      await database.venue.update(invoiceSeries).set({ nextNumber: 147 });
      before = await database.venue.select().from(invoiceSeries);
    } finally {
      await database.close();
    }
    const restarted = recovery(f.options);
    const resumed = await restarted.resume(
      {
        observation: f.request.observation,
        recoveryId: f.session.recoveryId,
        nodeRecoverySecret: key.secret,
        context: { oldBoxGone: true, soleRecovery: true },
      },
      { onBox: false },
    );
    expect(resumed.input).toEqual(f.selected.input);
    expect(resumed.binding).toEqual(f.session.binding);
    expect(resumed.recoveryId).toBe(f.session.recoveryId);
    expect(resumed.sessionId).not.toBe(f.session.sessionId);
    const advanced = await openVenueDatabase(target.venueDir);
    try {
      await advanced.venue.update(invoiceSeries).set({ nextNumber: 223 });
      before = await advanced.venue.select().from(invoiceSeries);
    } finally {
      await advanced.close();
    }
    await restarted.commit(resumed.sessionId, resumed.input, { onBox: false });
    expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
    expect(
      (await f.workspace.read()).every(
        (record) => record.binding.eventId === f.session.binding.eventId,
      ),
    ).toBe(true);
    const after = await openVenueDatabase(target.venueDir);
    try {
      expect(await after.venue.select().from(invoiceSeries)).toEqual(before);
    } finally {
      await after.close();
    }
    expect(await readFile(join(target.stateDir, "trading.env"), "utf8")).toContain(node.nodeId);
    expect(
      JSON.parse(
        await readFile(
          join(target.stateDir, "module-evidence/fiscal-verifactu/hour-history.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      records: expect.arrayContaining([expect.objectContaining({ identity: "0CNQT" })]),
    });
  },
);

async function interruptedRepair() {
  const f = await selectedRepair();
  vi.spyOn(stateSecrets, "unpackBundleToDir").mockRejectedValueOnce(
    new Error("interrupted secrets"),
  );
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toThrow("interrupted secrets");
  await f.service.dispose();
  return {
    ...f,
    resumeRequest: {
      observation: f.request.observation,
      recoveryId: f.session.recoveryId,
      nodeRecoverySecret: key.secret,
      context: { oldBoxGone: true, soleRecovery: true },
    },
  };
}

it("retains encrypted publication material without saving the node proof, archive key or private plaintext", async () => {
  const f = await interruptedRepair();
  const path = join(dirname(dirname(f.record.target.target.stateDir)), "publication.json");
  const bytes = await readFile(path, "utf8");
  expect(bytes).not.toContain(key.secret);
  expect(bytes).not.toContain(f.restore.recoveryKey);
  expect(bytes).not.toContain("secrets.env");
  expect(bytes).not.toContain("trading.env");
  expect((await import("node:fs/promises").then((fs) => fs.stat(path))).mode & 0o777).toBe(0o600);
  await expect(access(join(f.record.target.target.stateDir, "trading.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each(["", "wrong node key"])(
  "resume refuses target proof %j without changing the journal or target",
  async (secret) => {
    const f = await interruptedRepair();
    const journal = await f.workspace.read();
    const target = join(f.record.target.target.venueDir, "venue.db");
    const before = await readFile(target);
    await expect(
      recovery(f.options).resume(
        { ...f.resumeRequest, nodeRecoverySecret: secret },
        { onBox: false },
      ),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    expect(await f.workspace.read()).toEqual(journal);
    expect(await readFile(target)).toEqual(before);
  },
);

it("a placement-started record cannot authenticate a copied target whose module event never committed", async () => {
  const f = await selectedRepair();
  f.options.log = (...args: unknown[]) => {
    if (args[1] === "restore.migrated") throw new Error("interrupted before module commit");
  };
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toThrow("interrupted before module commit");
  await f.service.dispose();
  const journal = await f.workspace.read();
  const target = join(f.record.target.target.venueDir, "venue.db");
  const before = await readFile(target);
  await expect(
    recovery(f.options).resume(
      {
        observation: f.request.observation,
        recoveryId: f.session.recoveryId,
        nodeRecoverySecret: key.secret,
        context: { oldBoxGone: true, soleRecovery: true },
      },
      { onBox: false },
    ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "prior_activation_requires_replay" },
  });
  expect(await f.workspace.read()).toEqual(journal);
  expect(await readFile(target)).toEqual(before);
  await expect(access(join(f.record.target.target.stateDir, "trading.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each(["remove", "replace", "symlink"] as const)(
  "resume refuses %s of its encrypted private material",
  async (change) => {
    const f = await interruptedRepair();
    const path = join(dirname(dirname(f.record.target.target.stateDir)), "publication.json");
    if (change === "replace")
      await writeFile(path, JSON.stringify({ version: 1, ciphertext: "AAAA" }));
    else {
      await unlink(path);
      if (change === "symlink")
        await import("node:fs/promises").then((fs) =>
          fs.symlink(join(f.roots.stateDir, "first-setup.json"), path),
        );
    }
    const journal = await f.workspace.read();
    await expect(
      recovery(f.options).resume(f.resumeRequest, { onBox: false }),
    ).rejects.toMatchObject({
      code:
        change === "replace"
          ? "promotion.break_glass_invalid"
          : change === "symlink"
            ? "setup.attempt_invalid"
            : "setup.attempt_conflict",
    });
    expect(await f.workspace.read()).toEqual(journal);
  },
);

it("resume refuses private publication from a different recovery event even when its key is valid", async () => {
  const f = await interruptedRepair();
  const path = join(dirname(dirname(f.record.target.target.stateDir)), "publication.json");
  const envelope = JSON.parse(await readFile(path, "utf8")) as {
    version: number;
    ciphertext: string;
  };
  const entries = unpackArchive(
    decryptArtifact(Buffer.from(envelope.ciphertext, "base64"), key.secret),
  );
  const entry = entries.find((entry) => entry.name === "repair-publication.json")!;
  const meta = JSON.parse(Buffer.from(entry.bytes).toString("utf8"));
  meta.binding.binding.eventId = "fe663c93-c1e6-4688-a294-8e11502d53ef";
  entry.bytes = Buffer.from(JSON.stringify(meta));
  envelope.ciphertext = encryptArtifact(packArchive(entries), key.secret).toString("base64");
  await writeFile(path, JSON.stringify(envelope));
  await expect(recovery(f.options).resume(f.resumeRequest, { onBox: false })).rejects.toMatchObject(
    { code: "setup.attempt_conflict" },
  );
  expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
});

it("a prepared target with no placement cannot be resumed as a committed target", async () => {
  const f = await selectedRepair();
  await f.service.dispose();
  await expect(
    recovery(f.options).resume(
      {
        observation: f.request.observation,
        recoveryId: f.session.recoveryId,
        nodeRecoverySecret: key.secret,
        context: { oldBoxGone: true, soleRecovery: true },
      },
      { onBox: false },
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await f.workspace.read()).at(-1)).toEqual(f.record);
});

it("reuses its immutable publication material when interrupted before recording placement-started", async () => {
  const f = await selectedRepair();
  const append = f.workspace.append;
  const fail = vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
    if (record.phase === "placement-started") throw new AppError("setup.attempt_invalid", {});
    return append(record);
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  const path = join(dirname(dirname(f.record.target.target.stateDir)), "publication.json");
  const retained = await readFile(path);
  fail.mockRestore();
  await f.service.commit(f.session.sessionId, f.selected.input, { onBox: false });
  expect(await readFile(path)).toEqual(retained);
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
});

it("resume does not recreate a target database removed while its key proof was running", async () => {
  const f = await interruptedRepair();
  const path = join(f.record.target.target.venueDir, "venue.db");
  const original = f.host.resolution.withVenueExclusion;
  let turns = 0;
  f.host.resolution.withVenueExclusion = (run) =>
    original(async () => {
      if (++turns === 2)
        await import("node:fs/promises").then((fs) => fs.rename(path, path + ".retained"));
      return run();
    });
  await expect(recovery(f.options).resume(f.resumeRequest, { onBox: false })).rejects.toMatchObject(
    { code: "setup.attempt_conflict" },
  );
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("a target changed after resume proof is refused before rewriting its evidence", async () => {
  const f = await interruptedRepair();
  const service = recovery(f.options);
  const session = await service.resume(f.resumeRequest, { onBox: false });
  const target = f.record.target.target;
  await copyFile(f.database, join(target.venueDir, "venue.db"));
  const path = join(target.stateDir, "module-evidence/fiscal-verifactu/hour-history.json");
  const before = Buffer.from(
    JSON.stringify({ reference: "unexplained target evidence", complete: true, records: [] }),
  );
  await writeFile(path, before);
  await expect(
    service.commit(session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "prior_activation_requires_replay" },
  });
  expect(await readFile(path)).toEqual(before);
  expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
});

it("can resume publication of a valid backup containing a 256 KiB private state entry", async () => {
  const f = await fixture(true);
  const entries = unpackArchive(decryptArtifact(f.request.source.artifact, f.restore.recoveryKey));
  const privateBytes = Buffer.alloc(256 * 1024, "x");
  entries.push({ name: "secrets/large-private.txt", bytes: privateBytes });
  f.request.source.artifact = Uint8Array.from(
    encryptArtifact(packArchive(entries), f.restore.recoveryKey),
  );
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
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
  const restarted = recovery(f.options);
  const resumed = await restarted.resume(
    {
      observation: f.request.observation,
      recoveryId: session.recoveryId,
      nodeRecoverySecret: key.secret,
      context: { oldBoxGone: true, soleRecovery: true },
    },
    { onBox: false },
  );
  await restarted.commit(resumed.sessionId, selected.input, { onBox: false });
  const target = (await f.workspace.read()).at(-1)!.target.target;
  expect(await readFile(join(target.stateDir, "large-private.txt"))).toEqual(privateBytes);
});

it.each([
  "inspectionId",
  "revision",
  "ownerGeneration",
  "recoveryId",
  "oldBoxGone",
  "soleRecovery",
] as const)("resume refuses stale or missing %s authority", async (field) => {
  const f = await interruptedRepair();
  const request = structuredClone(f.resumeRequest);
  if (field === "recoveryId") request.recoveryId = "fe663c93-c1e6-4688-a294-8e11502d53ef";
  else if (field === "oldBoxGone" || field === "soleRecovery") request.context[field] = false;
  else if (field === "inspectionId") request.observation.inspectionId = "a".repeat(64);
  else request.observation[field] = 42;
  const records = await f.workspace.read();
  await expect(recovery(f.options).resume(request, { onBox: false })).rejects.toMatchObject({
    code:
      field === "oldBoxGone" || field === "soleRecovery"
        ? "module.operation_invalid"
        : "setup.attempt_conflict",
  });
  expect(await f.workspace.read()).toEqual(records);
});

it.each(["private-material", "originals", "target-verifier", "dispose"] as const)(
  "resume rechecks %s after its outside-lock key derivation",
  async (change) => {
    const f = await interruptedRepair();
    const service = recovery(f.options);
    const original = f.host.resolution.withVenueExclusion;
    let turns = 0;
    let stopping: Promise<void> | undefined;
    f.host.resolution.withVenueExclusion = (run) =>
      original(async () => {
        if (++turns === 2) {
          if (change === "dispose") stopping = service.dispose();
          else if (change === "private-material")
            await unlink(
              join(dirname(dirname(f.record.target.target.stateDir)), "publication.json"),
            );
          else if (change === "originals")
            await writeFile(
              join(f.roots.stateDir, "another-attempt.txt"),
              "keep this original evidence",
            );
          else {
            const target = await openVenueDatabase(f.record.target.target.venueDir);
            try {
              await import("./break-glass.js").then((m) =>
                m.mintBreakGlassKey(target.venue, node.nodeId),
              );
            } finally {
              await target.close();
            }
          }
        }
        return run();
      });
    await expect(service.resume(f.resumeRequest, { onBox: false })).rejects.toMatchObject({
      code: change === "dispose" ? "setup.owner_required" : "setup.attempt_conflict",
    });
    await stopping;
    await expect(
      access(join(f.record.target.target.stateDir, "trading.env")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("a resumed selection expires and a later proof cannot reuse its old opaque session", async () => {
  const f = await interruptedRepair();
  const service = recovery(f.options);
  const first = await service.resume(f.resumeRequest, { onBox: false });
  const second = await service.resume(f.resumeRequest, { onBox: false });
  await expect(
    service.commit(first.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  clock.advance(15 * 60_000 + 1);
  await expect(
    service.commit(second.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
});

it("a resumed session refuses changed private publication before any replay write", async () => {
  const f = await interruptedRepair();
  const service = recovery(f.options);
  const session = await service.resume(f.resumeRequest, { onBox: false });
  const path = join(dirname(dirname(f.record.target.target.stateDir)), "publication.json");
  const material = JSON.parse(await readFile(path, "utf8"));
  material.ciphertext = material.ciphertext.slice(0, -4) + "AAAA";
  await writeFile(path, JSON.stringify(material));
  await expect(
    service.commit(session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
});

it.each(["missing", "symlink"] as const)(
  "resume refuses a %s target database before opening or selecting it",
  async (change) => {
    const f = await interruptedRepair();
    const path = join(f.record.target.target.venueDir, "venue.db");
    await import("node:fs/promises").then((fs) => fs.rename(path, path + ".retained"));
    if (change === "symlink")
      await import("node:fs/promises").then((fs) => fs.symlink(path + ".retained", path));
    const before = await readFile(path + ".retained");
    await expect(
      recovery(f.options).resume(f.resumeRequest, { onBox: false }),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(await readFile(path + ".retained")).toEqual(before);
    expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
    if (change === "missing") await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("a target key revoked after resume proof cannot rewrite evidence or publish secrets", async () => {
  const f = await interruptedRepair();
  const service = recovery(f.options);
  const session = await service.resume(f.resumeRequest, { onBox: false });
  const target = f.record.target.target;
  const db = await openVenueDatabase(target.venueDir);
  try {
    await import("./break-glass.js").then((m) => m.mintBreakGlassKey(db.venue, node.nodeId));
  } finally {
    await db.close();
  }
  const path = join(target.stateDir, "module-evidence/fiscal-verifactu/hour-history.json");
  const bytes = Buffer.from(
    JSON.stringify({ reference: "unpublished incoming evidence", complete: true, records: [] }),
  );
  await writeFile(path, bytes);
  const refusal = await service
    .commit(session.sessionId, f.selected.input, { onBox: false })
    .catch((error) => error);
  expect(await readFile(path)).toEqual(bytes);
  expect(refusal).toMatchObject({ code: "setup.attempt_conflict" });
  await expect(access(join(target.stateDir, "trading.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

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
