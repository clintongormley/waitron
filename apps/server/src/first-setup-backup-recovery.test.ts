import { archiveHost, root, key, node, clock } from "../test/hour-recovery-host.js";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nodes, tenants, openVenueDatabase, invoiceSeries, withTransaction } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import { createFirstSetupBackupWorkspace } from "@waitron/provisioning";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import {
  createFirstSetupBackupRecovery,
  type BackupRepairOpenRequest,
} from "./first-setup-backup-recovery.js";
import * as sources from "./first-setup-backup-source.js";
import { suite } from "../test/hour-recovery-host.js";
import { request as ownerRequest } from "../test/first-fiscal.js";
import { encryptArtifact, decryptArtifact } from "./artifact-cipher.js";
import { packArchive, unpackArchive } from "./backup-archive.js";

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

it("authenticates the selected backup despite an uncheckable old setup verifier, without changing retained files", async () => {
  const f = await fixture();
  const original = await readFile(join(f.roots.stateDir, "first-setup.json"));
  const oldPreparations = await readFile(join(f.roots.stateDir, "module-preparation-state.json"));
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  expect(session).toEqual({
    sessionId: expect.stringMatching(/^[a-f0-9]{64}$/),
    recoveryId: expect.stringMatching(/^[a-f0-9-]{36}$/),
    preview: expect.objectContaining({
      taxpayer: { legalName: "Waitron SL", taxId: "89890001K" },
      nodeId: node.nodeId,
      nodeRecoveryKeyName: key.name,
    }),
    binding: {
      module: "fiscal-verifactu",
      action: "restore",
      eventId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      sourceId: createHash("sha256").update(f.request.source.artifact).digest("hex"),
      targetNodeId: node.nodeId,
    },
  });
  expect(JSON.stringify(session)).not.toContain(key.secret);
  expect(JSON.stringify(session)).not.toContain(root);
  expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(original);
  expect(await readFile(join(f.roots.stateDir, "module-preparation-state.json"))).toEqual(
    oldPreparations,
  );
  expect(await f.workspace.read()).toEqual([]);
  await service.close(session.sessionId);
});

it("a readable retained attempt does not require its forgotten password in addition to the selected backup key", async () => {
  const f = await fixture(true);
  const before = await readFile(join(f.roots.stateDir, "first-setup.json"));
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  expect(session.preview.taxpayer).toEqual({ legalName: "Waitron SL", taxId: "89890001K" });
  expect(JSON.stringify(session)).not.toContain("Retained setup company");
  expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(before);
  await service.close(session.sessionId);
});

it.each(["", "wrong node key"])(
  "rejects selected-backup proof %j before returning a preview or creating a journal",
  async (secret) => {
    const f = await fixture();
    const service = recovery(f.options);
    await expect(
      service.open({ ...f.request, nodeRecoverySecret: secret }, { onBox: false }),
    ).rejects.toMatchObject({
      code: "promotion.break_glass_invalid",
      params: {},
    });
    expect(await f.workspace.read()).toEqual([]);
    expect(await readdir(f.roots.venueDir)).toEqual(["venue.lock"]);
  },
);

it.each(["inspectionId", "revision", "ownerGeneration"] as const)(
  "rejects stale %s before creating repair authority",
  async (field) => {
    const f = await fixture();
    const observation = {
      ...f.request.observation,
      [field]: field === "inspectionId" ? "a".repeat(64) : 7,
    };
    await expect(
      recovery(f.options).open({ ...f.request, observation }, { onBox: false }),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(await f.workspace.read()).toEqual([]);
  },
);

it("binds the environment to this host rather than an uploaded source choice", async () => {
  const f = await fixture();
  await expect(
    recovery({ ...f.options, environment: "production" }).open(f.request, {
      onBox: false,
    }),
  ).rejects.toMatchObject({ code: "restore.environment_mismatch" });
  expect(await f.workspace.read()).toEqual([]);
});

it.each(["oldBoxGone", "soleRecovery"] as const)(
  "requires independent %s confirmation",
  async (field) => {
    const f = await fixture();
    await expect(
      recovery(f.options).open(
        { ...f.request, context: { ...f.request.context, [field]: false } },
        { onBox: false },
      ),
    ).rejects.toMatchObject({ code: "module.operation_invalid" });
    expect(await f.workspace.read()).toEqual([]);
  },
);

it("keeps an unreadable retained local database opaque after selected-backup proof", async () => {
  const f = await fixture();
  await mkdir(join(root, "opaque"));
  const other = Buffer.from("an unreadable retained database containing another business");
  await writeFile(join(f.roots.venueDir, "venue.db"), other);
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  f.request.observation = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision,
    ownerGeneration: inspected.ownerGeneration,
  };
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  expect(session.preview.nodeId).toBe(node.nodeId);
  expect(session.preview.taxpayer.taxId).toBe("89890001K");
  expect(await readFile(join(f.roots.venueDir, "venue.db"))).toEqual(other);
  expect(JSON.stringify(session)).not.toContain("another business");
  expect(await f.workspace.read()).toEqual([]);
  await service.close(session.sessionId);
});

it("closing or replacing a selection invalidates its opaque session without changing old files", async () => {
  const f = await fixture();
  const service = recovery(f.options);
  const first = await service.open(f.request, { onBox: false });
  const second = await service.open(f.request, { onBox: false });
  expect(second.sessionId).not.toBe(first.sessionId);
  expect(second.recoveryId).not.toBe(first.recoveryId);
  await expect(service.close(first.sessionId)).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  await service.close(second.sessionId);
  await expect(service.close(second.sessionId)).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  expect(await f.workspace.read()).toEqual([]);
});

it("expires repair proof after fifteen minutes, and a new host never inherits an old session", async () => {
  const f = await fixture();
  const service = recovery(f.options);
  const first = await service.open(f.request, { onBox: false });
  await expect(recovery(f.options).close(first.sessionId)).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  clock.set(clock.wall() + 15 * 60_000 + 1);
  await expect(service.close(first.sessionId)).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  expect(await f.workspace.read()).toEqual([]);
});

it("a slower old open cannot replace a more recent authenticated choice", async () => {
  const f = await fixture();
  const opened = barrier(),
    release = barrier();
  const real = (await vi.importActual<typeof sources>("./first-setup-backup-source.js"))
    .openFirstSetupBackupSource;
  let calls = 0;
  vi.spyOn(sources, "openFirstSetupBackupSource").mockImplementation(async (...args) => {
    const copy = await real(...args);
    if (++calls === 1) {
      opened.resolve();
      await release.promise;
    }
    return copy;
  });
  const service = recovery(f.options);
  const first = service.open(f.request, { onBox: false }).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await opened.promise;
  let second: Awaited<ReturnType<typeof service.open>> | undefined;
  try {
    second = await service.open(f.request, { onBox: false });
  } finally {
    release.resolve();
  }
  const late = await first;
  if ("value" in late) await service.close(late.value.sessionId);
  else await service.close(second!.sessionId);
  expect(late).toMatchObject({ error: { code: "setup.attempt_conflict" } });
});

it("turning the wall clock back cannot extend an authenticated repair session", async () => {
  const f = await fixture();
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  const wall = Date.now();
  clock.advance(15 * 60_000 + 1);
  vi.setSystemTime(wall - 60_000);
  await expect(service.close(session.sessionId)).rejects.toMatchObject({
    code: "setup.owner_required",
  });
});

it("shutdown discards authenticated private copies and prevents a delayed open installing a session", async () => {
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
  const pending = service.open(f.request, { onBox: false }).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await opened.promise;
  const disposing = service.dispose();
  release.resolve();
  await disposing;
  const result = await pending;
  expect(result).toMatchObject({ error: { code: "setup.owner_required" } });
  await expect(readFile(selected!.copy.databasePath)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(service.open(f.request, { onBox: false })).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  expect(await f.workspace.read()).toEqual([]);
});

it("rechecks unlisted retained originals under exclusion after backup key derivation", async () => {
  const f = await fixture();
  const original = f.host.resolution.withVenueExclusion;
  let turns = 0;
  f.host.resolution.withVenueExclusion = (run) =>
    original(async () => {
      if (++turns === 2)
        await writeFile(join(f.roots.stateDir, "retained-history.txt"), "new recovery evidence");
      return run();
    });
  await expect(recovery(f.options).open(f.request, { onBox: false })).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await readFile(join(f.roots.stateDir, "retained-history.txt"), "utf8")).toBe(
    "new recovery evidence",
  );
  expect(await f.workspace.read()).toEqual([]);
});

it("rechecks the exact selected-copy bytes after derivation, before returning its proof", async () => {
  const f = await fixture();
  const real = (await vi.importActual<typeof sources>("./first-setup-backup-source.js"))
    .openFirstSetupBackupSource;
  let copy: Awaited<ReturnType<typeof real>> | undefined;
  vi.spyOn(sources, "openFirstSetupBackupSource").mockImplementation(async (...args) => {
    copy = await real(...args);
    return copy;
  });
  const original = f.host.resolution.withVenueExclusion;
  let turns = 0;
  f.host.resolution.withVenueExclusion = (run) =>
    original(async () => {
      if (++turns === 2) {
        const bytes = await readFile(copy!.copy.databasePath);
        bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
        await writeFile(copy!.copy.databasePath, bytes);
      }
      return run();
    });
  await expect(recovery(f.options).open(f.request, { onBox: false })).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  await expect(readFile(copy!.copy.databasePath)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await f.workspace.read()).toEqual([]);
});

it("valid backup proof discloses only that backup while preserving a different local node and taxpayer", async () => {
  const f = await fixture();
  const localNode = "e0000000-0000-4000-8000-000000000001";
  await suite.db.update(tenants).set({ legalName: "Retained private company", taxId: "50000000R" });
  await suite.db
    .insert(nodes)
    .values({ id: localNode, locationId: node.locationId, name: "Retained private node" });
  await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
  await writeFile(
    join(f.roots.stateDir, "trading.env"),
    `WAITRON_TILL_NODE_ID=${localNode}\nWAITRON_TILL_LOCATION_ID=${node.locationId}\n`,
  );
  const before = await readFile(join(f.roots.venueDir, "venue.db"));
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  f.request.observation = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision,
    ownerGeneration: inspected.ownerGeneration,
  };
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  expect(session.preview.taxpayer).toEqual({ legalName: "Waitron SL", taxId: "89890001K" });
  expect(session.preview.nodeId).toBe(node.nodeId);
  expect(JSON.stringify(session)).not.toContain(localNode);
  expect(JSON.stringify(session)).not.toContain("Retained private company");
  expect(await readFile(join(f.roots.venueDir, "venue.db"))).toEqual(before);
  await service.close(session.sessionId);
});

it("a delayed expiry from a replaced session does not revoke the new authenticated choice", async () => {
  const f = await fixture();
  const timers = vi.spyOn(globalThis, "setTimeout");
  const service = recovery(f.options);
  await service.open(f.request, { onBox: false });
  const queued = [...timers.mock.calls]
    .reverse()
    .find((call) => call[1] === 15 * 60_000 + 1)![0] as () => Promise<void>;
  const second = await service.open(f.request, { onBox: false });
  await queued();
  await expect(service.close(second.sessionId)).resolves.toBeUndefined();
});

it("expired private copies are discarded even after the retained workspace stops admitting actions", async () => {
  const f = await fixture();
  const timers = vi.spyOn(globalThis, "setTimeout");
  const real = (await vi.importActual<typeof sources>("./first-setup-backup-source.js"))
    .openFirstSetupBackupSource;
  let selected: Awaited<ReturnType<typeof real>> | undefined;
  vi.spyOn(sources, "openFirstSetupBackupSource").mockImplementation(async (...args) => {
    selected = await real(...args);
    return selected;
  });
  const service = recovery(f.options);
  await service.open(f.request, { onBox: false });
  const queued = [...timers.mock.calls]
    .reverse()
    .find((call) => call[1] === 15 * 60_000 + 1)![0] as () => Promise<void>;
  await writeFile(join(f.roots.venueDir, "first-setup-retirement.json"), "{}");
  try {
    await queued();
    await expect(access(selected!.copy.databasePath)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await service.dispose();
  }
});

it("refuses an unknown backup module without turning key proof into arbitrary module authority", async () => {
  const f = await fixture();
  const entries = unpackArchive(
    decryptArtifact(f.request.source.artifact, f.request.source.recoveryKey),
  );
  f.request.source.artifact = Uint8Array.from(
    encryptArtifact(
      packArchive(entries.filter((entry) => entry.name !== "secrets/modules.json")),
      f.request.source.recoveryKey,
    ),
  );
  await expect(recovery(f.options).open(f.request, { onBox: false })).rejects.toMatchObject({
    code: "module.operation_invalid",
    params: { module: "core" },
  });
  expect(await f.workspace.read()).toEqual([]);
});

it("never accepts a caller's recovery identifier as a new allocation or resume authority", async () => {
  const f = await fixture();
  await expect(
    recovery(f.options).open(
      { ...f.request, recoveryId: "cb94ed24-d7dd-43e2-993d-2e126cf5c596" },
      { onBox: false },
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await f.workspace.read()).toEqual([]);
});

it("checks the validated copy's environment independently of a source adapter's configuration", async () => {
  const f = await fixture();
  const real = (await vi.importActual<typeof sources>("./first-setup-backup-source.js"))
    .openFirstSetupBackupSource;
  vi.spyOn(sources, "openFirstSetupBackupSource").mockImplementation((_source, deps, context) =>
    real(f.request.source, deps, context),
  );
  const request: BackupRepairOpenRequest = {
    ...f.request,
    source: { kind: "cloud", pointId: "cb94ed24-d7dd-43e2-993d-2e126cf5c596" },
  };
  await expect(
    recovery({ ...f.options, environment: "production" }).open(request, { onBox: false }),
  ).rejects.toMatchObject({
    code: "restore.environment_mismatch",
    params: { backup: "preproduction", target: "production" },
  });
  expect(await f.workspace.read()).toEqual([]);
});

it("does not create another event beside a durable recovery already in progress", async () => {
  const f = await fixture();
  const anchor = {
    stateDir: await realpath(f.roots.stateDir),
    venueDir: await realpath(f.roots.venueDir),
  };
  const recoveryId = "cb94ed24-d7dd-43e2-993d-2e126cf5c596";
  const base = join(anchor.stateDir, "first-setup-resolutions", "backup-recovery", recoveryId);
  const record = await f.host.resolution.withVenueExclusion(async () =>
    f.workspace.append({
      target: {
        recoveryId,
        anchor,
        source: anchor,
        target: {
          venueDir: join(base, "target", "venue"),
          stateDir: join(base, "target", "state"),
        },
        generation: 1,
      },
      observation: {
        ...f.request.observation,
        originalsDigest: await f.workspace.inspect(recoveryId),
      },
      sourceId: "a".repeat(64),
      activationSourceId: "b".repeat(64),
      binding: {
        module: "fiscal-verifactu",
        action: "restore",
        eventId: "cb94ed24-d7dd-43e2-993d-2e126cf5c596",
        sourceId: "b".repeat(64),
        targetNodeId: node.nodeId,
      },
      input: null,
      retainedEvidenceDigest: "c".repeat(64),
      phase: "prepared",
    }),
  );
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  f.request.observation = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision,
    ownerGeneration: inspected.ownerGeneration,
  };
  await expect(recovery(f.options).open(f.request, { onBox: false })).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await f.workspace.read()).toEqual([record]);
});

it("a cleanup error after private bytes are removed does not restore the expired session", async () => {
  const f = await fixture();
  const timers = vi.spyOn(globalThis, "setTimeout");
  const real = (await vi.importActual<typeof sources>("./first-setup-backup-source.js"))
    .openFirstSetupBackupSource;
  let privateRoot: string | undefined;
  vi.spyOn(sources, "openFirstSetupBackupSource").mockImplementation(async (...args) => {
    const selected = await real(...args);
    privateRoot = dirname(selected.copy.databasePath);
    return {
      ...selected,
      copy: {
        ...selected.copy,
        discard: async () => {
          await selected.copy.discard();
          throw new Error("private cleanup failed after removal");
        },
      },
    };
  });
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  const queued = [...timers.mock.calls]
    .reverse()
    .find((call) => call[1] === 15 * 60_000 + 1)![0] as () => Promise<void>;
  await queued();
  await expect(access(privateRoot!)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(service.close(session.sessionId)).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  await service.dispose();
});

it("binds the request and returned session by value across key derivation", async () => {
  const f = await fixture();
  const service = recovery(f.options);
  const pending = service.open(f.request, { onBox: false });
  f.request.source.artifact.fill(0);
  f.request.nodeRecoverySecret = "a later unproved key";
  f.request.observation.inspectionId = "c".repeat(64);
  f.request.context.soleRecovery = false;
  await expect(pending).resolves.toMatchObject({ preview: { taxpayer: { taxId: "89890001K" } } });
  const session = await pending;
  const id = session.sessionId;
  session.sessionId = "changed on the client";
  session.binding = { ...session.binding, eventId: "changed on the client" };
  expect(session.preview.taxpayer.taxId).toBe("89890001K");
  await service.close(id);
  expect(await f.workspace.read()).toEqual([]);
});

it("prepares in a derived isolated target after a durable journal, retaining local evidence for another backup", async () => {
  const f = await fixture(true);
  const original = await readFile(join(f.roots.stateDir, "module-preparation-state.json"));
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  const prepare = (proposal: unknown, client: { onBox: boolean }) =>
    service.prepare(session.sessionId, proposal, client);
  await expect(prepare({ action: "clock-challenge" }, { onBox: false })).resolves.toMatchObject({
    id: expect.any(String),
  });
  const [prepared] = await f.workspace.read();
  expect(prepared).toMatchObject({
    phase: "prepared",
    input: null,
    binding: session.binding,
    sourceId: session.preview.sourceId,
    retainedEvidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(prepared!.target.target.stateDir).toContain(
    `/first-setup-resolutions/backup-recovery/${session.recoveryId}/target/state`,
  );
  const path = join(
    prepared!.target.target.stateDir,
    "module-evidence",
    session.binding.module,
    "hour-history.json",
  );
  const retained = JSON.parse(await readFile(path, "utf8")) as unknown;
  expect(retained).toMatchObject({
    records: expect.arrayContaining([
      expect.objectContaining({ identity: "0CNQT", kind: "intent" }),
    ]),
  });
  const later = readModuleRecoveryEvidence(ALL_MODULES, [
    {
      name: `secrets/module-evidence/${session.binding.module}/hour-history.json`,
      bytes: Buffer.from(JSON.stringify(retained)),
    },
  ]);
  expect(later[session.binding.module]?.["hour-history"]).toMatchObject({
    records: expect.arrayContaining([expect.objectContaining({ identity: "0CNQT" })]),
  });
  const selected = (await recoverySelectPastWaits(clock, { prepare }, { onBox: false })) as {
    status: string;
    input: unknown;
    identity: string;
  };
  expect(selected.status).toBe("selected");
  expect(selected.identity > "0CNQT").toBe(true);
  const records = await f.workspace.read();
  expect(records.at(-1)).toMatchObject({
    phase: "prepared",
    input: selected.input,
    binding: session.binding,
    retainedEvidenceDigest: prepared!.retainedEvidenceDigest,
  });
  expect(JSON.stringify(records)).not.toMatch(
    /SYNTHETIC-owner-password|ownerVerifier|nodeRecoverySecret|operatorId.*private/,
  );
  expect(await readFile(join(f.roots.stateDir, "module-preparation-state.json"))).toEqual(original);
  await expect(
    access(join(prepared!.target.target.stateDir, "module-preparation-state.json")),
  ).resolves.toBeUndefined();
});

it("does not write module preparation when the durable recovery journal is refused", async () => {
  const f = await fixture(true);
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  vi.spyOn(f.workspace, "append").mockRejectedValue(new AppError("setup.attempt_invalid", {}));
  await expect(
    service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  expect(await f.workspace.read()).toEqual([]);
});

it("valid backup preview remains available when unreadable retained history refuses preparation", async () => {
  const f = await fixture();
  const original = await readFile(join(f.roots.stateDir, "first-setup.json"));
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  expect(session.preview.taxpayer.taxId).toBe("89890001K");
  await expect(
    service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({
    code: "module.operation_invalid",
    params: { module: session.binding.module },
  });
  expect(await f.workspace.read()).toEqual([]);
  expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(original);
});

it("rechecks retained originals before preparation and refuses a changed observation without a journal", async () => {
  const f = await fixture(true);
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  await writeFile(join(f.roots.stateDir, "new-evidence.json"), "new original");
  await expect(
    service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await f.workspace.read()).toEqual([]);
});

it("checks repair session identity and idle expiry on preparation", async () => {
  const f = await fixture(true);
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  await expect(service.prepare("unknown-session", {}, { onBox: false })).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  clock.advance(15 * 60_000 + 1);
  await expect(service.prepare(session.sessionId, {}, { onBox: false })).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  expect(await f.workspace.read()).toEqual([]);
});

it("an authenticated preparation action renews its idle allowance", async () => {
  const f = await fixture(true);
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  clock.advance(14 * 60_000);
  await service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false });
  clock.advance(2 * 60_000);
  await expect(
    service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).resolves.toMatchObject({ id: expect.any(String) });
});

import { AppError } from "@waitron/shared";
import { readModuleRecoveryEvidence, collectModuleNonDbState } from "./backup-sources.js";
import { readModulePreparationHistory } from "@waitron/provisioning";
import { generateNodeKeyPair } from "@waitron/membership";
import { encodeRecoveryKit, writePointer, signPointer } from "@waitron/stream";
import { createMemoryObjectStore } from "@waitron/stream/testing/memory-store.js";
import { sealNodeState, writeSealedStateRow } from "./sealed-state.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";

it("retains a prepared event after a failed evidence write and completes that same target on retry", async () => {
  const f = await fixture(true);
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  const append = f.workspace.append;
  let once = true;
  vi.spyOn(f.workspace, "append").mockImplementation(async (...args) => {
    const record = await append(...args);
    if (once) {
      once = false;
      throw new AppError("setup.attempt_invalid", {});
    }
    return record;
  });
  await expect(
    service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  const records = await f.workspace.read();
  expect(records).toHaveLength(1);
  const target = records[0]!.target;
  await expect(
    access(join(target.target.stateDir, "module-preparation-state.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).resolves.toMatchObject({ id: expect.any(String) });
  expect(await f.workspace.read()).toEqual(records);
  expect((await f.workspace.read())[0]!.target).toEqual(target);
});

it("refuses changed durable public evidence without replacing it or accepting another module action", async () => {
  const f = await fixture(true);
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  await service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false });
  const record = (await f.workspace.read())[0]!;
  const path = join(
    record.target.target.stateDir,
    "module-evidence",
    session.binding.module,
    "hour-history.json",
  );
  await writeFile(
    path,
    JSON.stringify({ reference: "prepared-hours", complete: true, records: [] }),
  );
  const changed = await readFile(path);
  await expect(
    service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readFile(path)).toEqual(changed);
});

it("refuses selected bytes changed after the authenticated session before preparation writes", async () => {
  const f = await fixture(true);
  const real = (await vi.importActual<typeof sources>("./first-setup-backup-source.js"))
    .openFirstSetupBackupSource;
  let selected: Awaited<ReturnType<typeof real>> | undefined;
  vi.spyOn(sources, "openFirstSetupBackupSource").mockImplementation(async (...args) => {
    selected = await real(...args);
    return selected;
  });
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  const bytes = await readFile(selected!.copy.databasePath);
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
  await writeFile(selected!.copy.databasePath, bytes);
  await expect(
    service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await f.workspace.read()).toEqual([]);
});

it("local database history independently raises the prepared floor when its preparation journal is absent", async () => {
  const f = await fixture(true);
  const retainedRoots = {
    stateDir: join(root, "retained-state"),
    venueDir: join(root, "retained-venue"),
  };
  await restoreFromArtifact({
    ...f.restore,
    ...retainedRoots,
    modules: f.service.modules,
    withModuleOperations: f.service.runner(f.outcome.input),
  });
  await copyFile(join(retainedRoots.venueDir, "venue.db"), join(f.roots.venueDir, "venue.db"));
  await unlink(join(f.roots.stateDir, "module-preparation-state.json"));
  const before = await readFile(join(f.roots.venueDir, "venue.db"));
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  f.request.observation = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision,
    ownerGeneration: inspected.ownerGeneration,
  };
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  await service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false });
  const record = (await f.workspace.read())[0]!;
  const value = JSON.parse(
    await readFile(
      join(
        record.target.target.stateDir,
        "module-evidence",
        session.binding.module,
        "hour-history.json",
      ),
      "utf8",
    ),
  );
  expect(value).toMatchObject({
    records: expect.arrayContaining([
      expect.objectContaining({ kind: "activation", identity: "0CNQT" }),
    ]),
  });
  expect(await readFile(join(f.roots.venueDir, "venue.db"))).toEqual(before);
});

import { copyFile, unlink } from "node:fs/promises";
import { restoreFromArtifact } from "./restore.js";

it("rechecks the prepared journal before another action even when the retained originals are unchanged", async () => {
  const f = await fixture(true);
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  await service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false });
  const record = (await f.workspace.read())[0]!;
  const path = join(
    record.target.anchor.stateDir,
    "first-setup-resolutions",
    "backup-recovery",
    session.recoveryId,
    "000001.json",
  );
  await writeFile(path, JSON.stringify({ ...record, input: { changed: true } }));
  await expect(
    service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
});

it("refuses another prepared input appended by a competing action before using the cached preparation", async () => {
  const f = await fixture(true);
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  await service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false });
  const { version, sequence, previousRecordDigest, recordedAt, ...record } = (
    await f.workspace.read()
  )[0]!;
  void version;
  void sequence;
  void previousRecordDigest;
  void recordedAt;
  await f.workspace.append({ ...record, input: { competingSelection: true } });
  await expect(
    service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
});
it.each(["module", "reader"])(
  "refuses preparation when the selected %s is no longer available",
  async (missing) => {
    const f = await fixture(true);
    const options = {
      ...f.options,
      host: {
        ...f.host,
        modules: f.host.modules
          .filter((entry) => missing !== "module" || entry.name !== "fiscal-verifactu")
          .map((entry) =>
            entry.name === "fiscal-verifactu"
              ? { ...entry, operations: { ...entry.operations!, readRecoveryState: undefined } }
              : entry,
          ),
      },
    };
    const service = recovery(options);
    const session = await service.open(f.request, { onBox: false });
    await expect(
      service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
    ).rejects.toMatchObject({
      code: "module.operation_invalid",
      params: { module: session.binding.module },
    });
    expect(await f.workspace.read()).toEqual([]);
  },
);
it("does not include a content directory as public history while preserving the module's history seat", async () => {
  const f = await fixture(true);
  const service = recovery({
    ...f.options,
    host: {
      ...f.host,
      modules: f.host.modules.map((entry) =>
        entry.name !== "fiscal-verifactu"
          ? entry
          : {
              ...entry,
              backup: {
                ...entry.backup,
                nonDbState: [
                  { kind: "content-addressed-dir", source: "private-content" },
                  ...entry.backup!.nonDbState!,
                ],
              },
            },
      ),
    },
  });
  const session = await service.open(f.request, { onBox: false });
  await expect(
    service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).resolves.toMatchObject({ id: expect.any(String) });
  const record = (await f.workspace.read())[0]!;
  expect(
    await readdir(join(record.target.target.stateDir, "module-evidence", session.binding.module)),
  ).toEqual(["hour-history.json"]);
});
it("an interrupted preparation refuses a changed module projection rather than changing its prepared evidence", async () => {
  const f = await fixture(true);
  let changed = false;
  const service = recovery({
    ...f.options,
    host: {
      ...f.host,
      modules: f.host.modules.map((entry) =>
        entry.name !== "fiscal-verifactu"
          ? entry
          : {
              ...entry,
              backup: {
                ...entry.backup,
                nonDbState: entry.backup!.nonDbState!.map((source) =>
                  source.kind !== "preparation-history"
                    ? source
                    : {
                        ...source,
                        project: (input) => ({
                          ...(source.project(input) as object),
                          timeFloorMs: changed ? 1792154700000 : 1792154600000,
                        }),
                      },
                ),
              },
            },
      ),
    },
  });
  const session = await service.open(f.request, { onBox: false });
  const append = vi
    .spyOn(f.workspace, "append")
    .mockRejectedValueOnce(new AppError("setup.attempt_invalid", {}));
  await expect(
    service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  append.mockRestore();
  changed = true;
  await expect(
    service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await f.workspace.read()).toEqual([]);
});

it("refuses to drop retained database history when its module has no public evidence projector", async () => {
  const f = await fixture(true);
  await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  f.request.observation = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision,
    ownerGeneration: inspected.ownerGeneration,
  };
  const service = recovery({
    ...f.options,
    host: {
      ...f.host,
      modules: f.host.modules.map((entry) =>
        entry.name === "fiscal-verifactu" ? { ...entry, backup: undefined } : entry,
      ),
    },
  });
  const session = await service.open(f.request, { onBox: false });
  await expect(
    service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({
    code: "module.operation_invalid",
    params: { module: session.binding.module },
  });
  expect(await f.workspace.read()).toEqual([]);
});

it("refuses a recovery clock too far before a retained selection", async () => {
  const f = await fixture(true);
  vi.setSystemTime(Date.parse("2026-10-16T12:39:00.000Z"));
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  await expect(
    recoverySelectPastWaits(
      clock,
      {
        prepare: (proposal, client) => service.prepare(session.sessionId, proposal, client),
      },
      { onBox: false },
    ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "minute_not_later", allowedFromMs: Date.parse("2026-10-16T12:43:00.000Z") },
  });
});

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
