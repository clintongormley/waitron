import { archiveHost, key, node, clock } from "../test/hour-recovery-host.js";
import { createHash, randomBytes } from "node:crypto";
import { access, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as filesystem from "node:fs/promises";
import * as restore from "./restore.js";
import * as sourceProof from "./first-setup-backup-source.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openVenueDatabase, invoiceSeries } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import { createFirstSetupBackupWorkspace } from "@waitron/provisioning";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { createFirstSetupBackupRecovery } from "./first-setup-backup-recovery.js";
import { request as ownerRequest } from "../test/first-fiscal.js";
import { encryptArtifact, decryptArtifact } from "./artifact-cipher.js";
import { packArchive, unpackArchive } from "./backup-archive.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";
import { buildBackupVerificationTarget } from "./backup-verification-target.js";
import * as runtime from "./backup-verification-target.js";
import * as secrets from "./state-secrets.js";
import { createCloudRecoveryClient } from "./cloud-recovery.js";
import { readCloudRecoveryState } from "./cloud-recovery-v2.js";

vi.mock("./backup-verification-target.js", { spy: true });
vi.mock("./state-secrets.js", { spy: true });
vi.mock("node:fs/promises", { spy: true });
vi.mock("./restore.js", { spy: true });
vi.mock("./first-setup-backup-source.js", { spy: true });
beforeEach(async () => {
  const fs = await vi.importActual<typeof filesystem>("node:fs/promises");
  vi.mocked(filesystem.rename).mockImplementation(fs.rename);
  const placement = await vi.importActual<typeof restore>("./restore.js");
  vi.mocked(restore.restoreFromArtifact).mockImplementation(placement.restoreFromArtifact);
  const proof = await vi.importActual<typeof sourceProof>("./first-setup-backup-source.js");
  vi.mocked(sourceProof.authenticatedFirstSetupBackupPreview).mockImplementation(
    proof.authenticatedFirstSetupBackupPreview,
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
async function fixture(protocol: 1 | 2 = 2) {
  const f = await archiveHost();
  const entries = unpackArchive(decryptArtifact(f.restore.artifact, f.restore.recoveryKey));
  entries.push({
    name: "secrets/backup.env",
    bytes: Buffer.from("WAITRON_BACKUP_SECRET_ACCESS_KEY=old-source-credential\n"),
  });
  entries.push({
    name: "secrets/module-evidence/fiscal-verifactu/hour-history.json",
    bytes: Buffer.from(
      JSON.stringify({ reference: "prepared-hours", complete: true, records: [] }),
    ),
  });
  const artifact = encryptArtifact(packArchive(entries), f.restore.recoveryKey);
  const target = buildBackupVerificationTarget({
    modules: ALL_MODULES,
    migrationsRoot: null,
    runtime: { release: "2026.10.24", revision: "a".repeat(40), fingerprint: "b".repeat(64) },
  });
  vi.spyOn(runtime, "currentBackupVerificationTarget").mockReturnValue(target);
  const host = createFirstSetupModuleHost({
    ...f.roots,
    modules: ALL_MODULES,
    environment: { WAITRON_ENV: "preproduction" },
  });
  await host.owner.claimFirstSetup(
    {
      environment: "preproduction",
      request: {
        ...ownerRequest,
        legalName: "Retained setup company",
        location: {
          ...ownerRequest.location,
          operationDescription: "Restaurant",
          name: "Retained venue",
        },
      },
    },
    randomBytes(32).toString("base64url"),
  );
  const original = await readFile(join(f.roots.stateDir, "first-setup.json"));
  const workspace = createFirstSetupBackupWorkspace(f.roots);
  const pointId = "047bacd4-df70-4881-a835-c6dd75ae7ecf";
  const point = {
    id: pointId,
    venueId: node.locationId,
    capturedAt: new Date().toISOString(),
    modules: JSON.parse(
      Buffer.from(entries.find((entry) => entry.name === "manifest.json")!.bytes).toString(),
    ).modules,
    digest: createHash("sha256").update(artifact).digest("hex"),
    size: artifact.length,
    objectKey: `snapshots/${pointId}`,
    verification: "verified",
    kind: "snapshot",
    deleting: false,
    deletedAt: null,
  };
  const verification = {
    protocol: "backup-data-restore/v1",
    target,
    policyDigest: target.policyDigest,
    requestDigest: "c".repeat(64),
    archiveSha256: point.digest,
    archiveBytes: point.size,
    pointId,
  };
  const calls: string[] = [];
  const control = {
    beforeDownload: async () => {},
    expired: false,
    refuse: "",
    downloaded: 0,
    archive: artifact,
    rewrite: (_action: string, result: Record<string, unknown>): Record<string, unknown> => result,
  };
  const expiresAt = new Date(clock.wall() + 900_000).toISOString();
  const cloud = {
    origin: "https://cloud.example.test",
    environment: "preproduction" as const,
    ...(protocol === 2 ? { snapshotProtocol: 2 as const, target: () => target } : {}),
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      const action = new URL(String(url)).pathname.split("/").at(-1)!;
      calls.push(action);
      if (action === "status" && control.expired) return new Response(null, { status: 410 });
      if (control.refuse === action) return new Response(null, { status: 403 });
      const body = JSON.parse(String(init?.body)) as { payload: string };
      const requestId = JSON.parse(Buffer.from(body.payload, "base64url").toString())[2];
      const result =
        action === "start" || action === "status"
          ? {
              version: 2,
              requestId,
              state: action === "start" ? "awaiting_owner" : "approved",
              expiresAt,
              operationId: action === "start" ? null : requestId,
            }
          : action === "restored"
            ? { version: 2, status: "restored" }
            : {
                version: 2,
                point,
                verification,
                operationExpiresAt: new Date(clock.wall() + 3_600_000).toISOString(),
                ...(action === "read"
                  ? {
                      location: {
                        endpoint: "https://store.example.test",
                        bucket: "backup",
                        region: "local",
                      },
                      credentials: {
                        accessKeyId: "access",
                        secretAccessKey: "secret",
                        sessionToken: "session",
                      },
                      recoveryKey: f.restore.recoveryKey,
                      expiresAt,
                    }
                  : {}),
              };
      return Response.json(control.rewrite(action, result));
    },
    download: async () => {
      control.downloaded++;
      await control.beforeDownload();
      return control.archive;
    },
  };
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
    cloud,
    log: () => {},
  };
  const service = recovery(options);
  await service.cloudStart();
  const approved = await service.cloudStatus();
  expect(approved.state).toBe("approved");
  const inspected = await host.resolution.inspectFirstSetupResolution();
  const request = {
    observation: {
      inspectionId: inspected.inspectionId,
      revision: inspected.revision,
      ownerGeneration: inspected.ownerGeneration,
    },
    source: { kind: "cloud" as const, pointId },
    nodeRecoverySecret: key.secret,
    context: { oldBoxGone: true, soleRecovery: true },
  };
  return {
    ...f,
    artifact,
    original,
    target,
    pointId,
    options,
    workspace,
    service,
    request,
    control,
    calls,
    approved,
  };
}
async function selectedRepair(protocol: 1 | 2 = 2) {
  const f = await fixture(protocol);
  const session = await f.service.open(f.request, { onBox: false });
  const selected = (await recoverySelectPastWaits(
    clock,
    {
      prepare: (proposal, client) => f.service.prepare(session.sessionId, proposal, client),
    },
    { onBox: false },
  )) as { status: string; input: unknown };
  expect(selected.status).toBe("selected");
  return { ...f, session, selected, record: (await f.workspace.read()).at(-1)! };
}
it("keeps Cloud approval outside the retained setup and selects the checked target without source backup.env", async () => {
  const f = await selectedRepair();
  await f.service.commit(f.session.sessionId, f.selected.input, { onBox: false });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
  expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(f.original);
  await expect(access(join(f.roots.stateDir, "cloud-recovery.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const state = await readCloudRecoveryState(f.record.target.target.stateDir);
  expect(state).toMatchObject({
    version: 2,
    requestId: f.approved.requestId,
    pointId: f.pointId,
    phase: "reported",
    target: f.target,
  });
  await expect(access(join(f.record.target.target.stateDir, "backup.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(f.calls.filter((action) => action === "restored")).toHaveLength(1);
  expect(f.control.downloaded).toBe(2);
  const db = await openVenueDatabase(f.record.target.target.venueDir);
  try {
    expect(
      (await db.venue.select().from(invoiceSeries)).some(
        (row) => row.retiredAt === null && row.nextNumber === 1,
      ),
    ).toBe(true);
  } finally {
    await db.close();
  }
});

it.each(["secrets", "staged-save", "restored-record", "selection"] as const)(
  "resumes Cloud after %s interruption with new target proof and no second download",
  async (point) => {
    const f = await selectedRepair();
    if (point === "secrets")
      vi.spyOn(secrets, "unpackBundleToDir").mockRejectedValueOnce(
        new Error("interrupted secrets"),
      );
    else if (point === "staged-save") {
      const { rename } = await vi.importActual<typeof filesystem>("node:fs/promises");
      vi.spyOn(filesystem, "rename").mockImplementation(async (from, to) => {
        if (
          String(to).endsWith("/cloud-recovery.json") &&
          JSON.parse(await readFile(from, "utf8")).phase === "staged"
        )
          throw new Error("interrupted staged save");
        return rename(from, to);
      });
    } else if (point === "restored-record") {
      const append = f.workspace.append;
      vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
        if (record.phase === "restored") throw new Error("interrupted restored record");
        return append(record);
      });
    } else
      vi.spyOn(f.workspace, "select").mockRejectedValueOnce(new Error("interrupted selection"));
    await expect(
      f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
    ).rejects.toThrow("interrupted");
    vi.restoreAllMocks();
    vi.spyOn(runtime, "currentBackupVerificationTarget").mockReturnValue(f.target);
    await f.service.dispose();
    const before = f.control.downloaded;
    const db = await openVenueDatabase(f.record.target.target.venueDir);
    try {
      await db.venue.update(invoiceSeries).set({ nextNumber: 147 });
    } finally {
      await db.close();
    }
    const restarted = recovery(f.options);
    const resumed = await restarted.resume(
      {
        observation: f.request.observation,
        recoveryId: f.session.recoveryId,
        nodeRecoverySecret: key.secret,
        context: f.request.context,
      },
      { onBox: false },
    );
    expect(resumed.input).toEqual(f.selected.input);
    expect(resumed.binding).toEqual(f.session.binding);
    const advanced = await openVenueDatabase(f.record.target.target.venueDir);
    try {
      await advanced.venue.update(invoiceSeries).set({ nextNumber: 223 });
    } finally {
      await advanced.close();
    }
    await restarted.commit(resumed.sessionId, resumed.input, { onBox: false });
    expect(f.control.downloaded).toBe(before);
    expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
    expect(await readCloudRecoveryState(f.record.target.target.stateDir)).toMatchObject({
      requestId: f.approved.requestId,
      pointId: f.pointId,
      phase: "reported",
    });
    await expect(access(join(f.record.target.target.stateDir, "backup.env"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
    const after = await openVenueDatabase(f.record.target.target.venueDir);
    try {
      expect(
        (await after.venue.select().from(invoiceSeries)).every((row) => row.nextNumber === 223),
      ).toBe(true);
    } finally {
      await after.close();
    }
  },
);

it.each(["target", "verification", "point", "expired", "revoked", "archive"] as const)(
  "refuses changed Cloud %s before any target database write",
  async (change) => {
    const f = await selectedRepair();
    if (change === "target")
      vi.spyOn(runtime, "currentBackupVerificationTarget").mockReturnValue(
        buildBackupVerificationTarget({
          modules: ALL_MODULES,
          migrationsRoot: null,
          runtime: { ...f.target.runtime, revision: "d".repeat(40) },
        }),
      );
    else if (change === "revoked") f.control.refuse = "read";
    else if (change === "archive") f.control.archive = Buffer.from("changed archive");
    else
      f.control.rewrite = (action, result) => {
        if (action !== "info") return result;
        if (change === "verification")
          return {
            ...result,
            verification: { ...(result.verification as object), requestDigest: "d".repeat(64) },
          };
        if (change === "point")
          return {
            ...result,
            point: { ...(result.point as object), id: "374cac38-cc58-46d5-8d3b-8443fc4343a4" },
          };
        return { ...result, operationExpiresAt: new Date(clock.wall() - 1).toISOString() };
      };
    await expect(
      f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
    ).rejects.toThrow("Cloud recovery is unavailable");
    await expect(access(join(f.record.target.target.venueDir, "venue.db"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
    expect(f.calls).not.toContain("restored");
    expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(f.original);
  },
);

it("finishes local selection while a refused provider acknowledgement stays restored and pending", async () => {
  const f = await selectedRepair();
  f.control.refuse = "restored";
  await f.service.commit(f.session.sessionId, f.selected.input, { onBox: false });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
  expect(await readCloudRecoveryState(f.record.target.target.stateDir)).toMatchObject({
    requestId: f.approved.requestId,
    phase: "restored",
  });
  expect(
    await readCloudRecoveryState(join(dirname(dirname(f.record.target.target.stateDir)), "cloud")),
  ).toMatchObject({ phase: "restored" });
});

it("does not replace Cloud approval changed at the placement lock", async () => {
  const f = await selectedRepair();
  const { restoreFromArtifact: actual } = await vi.importActual<typeof restore>("./restore.js");
  let injected: Buffer | undefined;
  vi.spyOn(restore, "restoreFromArtifact").mockImplementation(async (deps) => {
    const state = await readCloudRecoveryState(deps.stateDir);
    injected = Buffer.from(JSON.stringify({ ...state, code: "12345678" }));
    await writeFile(join(deps.stateDir, "cloud-recovery.json"), injected);
    return actual(deps);
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readFile(join(f.record.target.target.stateDir, "cloud-recovery.json"))).toEqual(
    injected,
  );
  await expect(access(join(f.record.target.target.venueDir, "venue.db"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("reopens the same prepared Cloud source after restart with fresh node proof and clocks", async () => {
  const f = await selectedRepair();
  await f.service.dispose();
  const restarted = recovery(f.options);
  expect((await restarted.cloudStatus()).requestId).toBe(f.approved.requestId);
  const resumed = await restarted.open(
    { ...f.request, recoveryId: f.session.recoveryId },
    { onBox: false },
  );
  expect(resumed.binding).toEqual(f.session.binding);
  expect(resumed.recoveryId).toBe(f.session.recoveryId);
  const selected = (await recoverySelectPastWaits(
    clock,
    {
      prepare: (proposal, client) => restarted.prepare(resumed.sessionId, proposal, client),
    },
    { onBox: false },
  )) as { input: unknown };
  await restarted.commit(resumed.sessionId, selected.input, { onBox: false });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
  expect(await readCloudRecoveryState(f.record.target.target.stateDir)).toMatchObject({
    requestId: f.approved.requestId,
    phase: "reported",
  });
});

it("requires a pending approval and an available Cloud client before polling or restarting", async () => {
  const f = await fixture();
  const unopened = recovery(f.options);
  await expect(unopened.cloudStatus()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expect(unopened.cloudStartAgain()).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  await expect(recovery({ ...f.options, cloud: undefined }).cloudStart()).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  await expect(f.service.cloudStartAgain()).rejects.toThrow("Cloud recovery is unavailable");
});

it("does not change Cloud approval while a backup session or durable preparation owns it", async () => {
  const f = await fixture();
  const session = await f.service.open(f.request, { onBox: false });
  const calls = f.calls.length;
  for (const action of [
    () => f.service.cloudStart(),
    () => f.service.cloudStatus(),
    () => f.service.cloudStartAgain(),
  ])
    await expect(action()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(f.calls).toHaveLength(calls);
  await f.service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false });
  await f.service.close(session.sessionId);
  await expect(f.service.cloudStart()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("prepared");
});

it("disposes Cloud authority with the repair service", async () => {
  const f = await fixture();
  await f.service.dispose();
  for (const action of [
    () => f.service.cloudStart(),
    () => f.service.cloudStatus(),
    () => f.service.cloudStartAgain(),
  ])
    await expect(action()).rejects.toMatchObject({ code: "setup.owner_required" });
});

it.each([
  "control",
  "target",
  "sealed",
  "runtime",
  "origin",
  "request-binding",
  "archive-binding",
] as const)(
  "refuses %s Cloud identity changes after a committed-target interruption",
  async (change) => {
    const f = await selectedRepair();
    vi.spyOn(f.workspace, "select").mockRejectedValueOnce(new Error("interrupted selection"));
    await expect(
      f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
    ).rejects.toThrow("interrupted selection");
    await f.service.dispose();
    const directory = dirname(dirname(f.record.target.target.stateDir));
    let tamperedPath: string | undefined;
    let tampered: Buffer | undefined;
    if (change === "origin") f.options.cloud.origin = "https://other-cloud.example.test";
    else if (change === "runtime")
      vi.spyOn(runtime, "currentBackupVerificationTarget").mockReturnValue(
        buildBackupVerificationTarget({
          modules: ALL_MODULES,
          migrationsRoot: null,
          runtime: { ...f.target.runtime, revision: "d".repeat(40) },
        }),
      );
    else if (["sealed", "request-binding", "archive-binding"].includes(change)) {
      const path = join(directory, "publication.json");
      const saved = JSON.parse(await readFile(path, "utf8"));
      const entries = unpackArchive(
        decryptArtifact(Buffer.from(saved.ciphertext, "base64"), key.secret),
      );
      const meta = entries.find((entry) => entry.name === "repair-publication.json")!;
      const value = JSON.parse(Buffer.from(meta.bytes).toString());
      if (change === "request-binding")
        value.cloudState.requestId = "374cac38-cc58-46d5-8d3b-8443fc4343a4";
      else if (change === "archive-binding") {
        value.cloudState.snapshotVerification.archiveSha256 = "d".repeat(64);
        for (const stateDir of [join(directory, "cloud"), f.record.target.target.stateDir]) {
          const path = join(stateDir, "cloud-recovery.json");
          const state = JSON.parse(await readFile(path, "utf8"));
          state.snapshotVerification.archiveSha256 = "d".repeat(64);
          await writeFile(path, JSON.stringify(state));
        }
      } else value.cloudState.code = "12345678";
      meta.bytes = Buffer.from(JSON.stringify(value));
      saved.ciphertext = encryptArtifact(packArchive(entries), key.secret).toString("base64");
      await writeFile(path, JSON.stringify(saved));
    } else {
      tamperedPath = join(
        change === "control" ? join(directory, "cloud") : f.record.target.target.stateDir,
        "cloud-recovery.json",
      );
      const current = JSON.parse(await readFile(tamperedPath, "utf8"));
      tampered = Buffer.from(JSON.stringify({ ...current, code: "12345678" }));
      await writeFile(tamperedPath, tampered);
    }
    const before = await readFile(join(f.record.target.target.venueDir, "venue.db"));
    await expect(
      recovery(f.options).resume(
        {
          observation: f.request.observation,
          recoveryId: f.session.recoveryId,
          nodeRecoverySecret: key.secret,
          context: f.request.context,
        },
        { onBox: false },
      ),
    ).rejects.toMatchObject({
      code: ["runtime", "origin"].includes(change)
        ? "setup.attempt_uncertain"
        : "setup.attempt_conflict",
    });
    expect(await readFile(join(f.record.target.target.venueDir, "venue.db"))).toEqual(before);
    if (tamperedPath) expect(await readFile(tamperedPath)).toEqual(tampered);
    expect((await f.workspace.read()).at(-1)!.phase).toBe("restored");
  },
);

it("only replaces an expired approval and retains the original setup bytes", async () => {
  const f = await fixture();
  const previous = f.approved.requestId;
  f.control.expired = true;
  expect((await f.service.cloudStatus()).state).toBe("expired");
  const next = await f.service.cloudStartAgain();
  expect(next.requestId).not.toBe(previous);
  expect(next.state).toBe("awaiting_owner");
  expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(f.original);
  expect(await f.workspace.read()).toEqual([]);
});

it.each(["control", "target"] as const)(
  "refuses a %s approval replaced during a live backup session",
  async (change) => {
    const f = await selectedRepair();
    const path = join(
      change === "control"
        ? join(dirname(dirname(f.record.target.target.stateDir)), "cloud")
        : f.record.target.target.stateDir,
      "cloud-recovery.json",
    );
    const control = (await readCloudRecoveryState(
      join(dirname(dirname(f.record.target.target.stateDir)), "cloud"),
    ))!;
    const bytes = Buffer.from(JSON.stringify({ ...control, code: "12345678" }));
    await writeFile(path, bytes, { mode: 0o600 });
    await expect(
      f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(await readFile(path)).toEqual(bytes);
    await expect(access(join(f.record.target.target.venueDir, "venue.db"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("does not place changed sealed source secrets after prepared Cloud reauthentication", async () => {
  const f = await selectedRepair();
  const append = f.workspace.append;
  vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
    if (record.phase === "placement-started") throw new Error("interrupted placement journal");
    return append(record);
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toThrow("interrupted placement journal");
  vi.restoreAllMocks();
  vi.spyOn(runtime, "currentBackupVerificationTarget").mockReturnValue(f.target);
  await f.service.dispose();
  const path = join(dirname(dirname(f.record.target.target.stateDir)), "publication.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  const entries = unpackArchive(
    decryptArtifact(Buffer.from(saved.ciphertext, "base64"), key.secret),
  );
  entries.find((entry) => entry.name === "secrets/node-key.enc")!.bytes = Buffer.from(
    "different sealed node key",
  );
  saved.ciphertext = encryptArtifact(packArchive(entries), key.secret).toString("base64");
  await writeFile(path, JSON.stringify(saved));
  const restarted = recovery(f.options);
  const opened = await restarted.open(
    { ...f.request, recoveryId: f.session.recoveryId },
    { onBox: false },
  );
  const selected = (await recoverySelectPastWaits(
    clock,
    {
      prepare: (proposal, client) => restarted.prepare(opened.sessionId, proposal, client),
    },
    { onBox: false },
  )) as { input: unknown };
  await expect(
    restarted.commit(opened.sessionId, selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expect(access(join(f.record.target.target.venueDir, "venue.db"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("checks the client's target protocol before resumed secret publication", async () => {
  const f = await selectedRepair();
  vi.spyOn(f.workspace, "select").mockRejectedValueOnce(new Error("interrupted selection"));
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toThrow("interrupted selection");
  await f.service.dispose();
  const restarted = recovery({
    ...f.options,
    cloud: { ...f.options.cloud, snapshotProtocol: undefined, target: undefined },
  });
  const resumed = await restarted.resume(
    {
      observation: f.request.observation,
      recoveryId: f.session.recoveryId,
      nodeRecoverySecret: key.secret,
      context: f.request.context,
    },
    { onBox: false },
  );
  const path = join(f.record.target.target.stateDir, "node-key.enc");
  await writeFile(path, "later retained key");
  await expect(
    restarted.commit(resumed.sessionId, resumed.input, { onBox: false }),
  ).rejects.toThrow("Cloud recovery is unavailable");
  expect(await readFile(path, "utf8")).toBe("later retained key");
  expect((await f.workspace.read()).at(-1)!.phase).toBe("restored");
});

async function interruptedCloudTransfer() {
  const f = await fixture();
  const session = await f.service.open(f.request, { onBox: false });
  const { rename } = await vi.importActual<typeof filesystem>("node:fs/promises");
  vi.spyOn(filesystem, "rename").mockImplementation(async (from, to) => {
    if (String(to).endsWith("/cloud/cloud-recovery.json"))
      throw new Error("interrupted Cloud transfer");
    return rename(from, to);
  });
  await expect(
    f.service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  const record = (await f.workspace.read()).at(-1)!;
  expect(record.input).toBeNull();
  expect(record.phase).toBe("prepared");
  await f.service.dispose();
  vi.mocked(filesystem.rename).mockImplementation(rename);
  const restarted = recovery(f.options);
  expect((await restarted.cloudStart()).state).toBe("awaiting_owner");
  expect((await restarted.cloudStatus()).state).toBe("approved");
  return { ...f, session, record, restarted };
}

it("can obtain new approval for the same journal after interrupted initial Cloud-state transfer", async () => {
  const f = await interruptedCloudTransfer();
  const { restarted, session, record } = f;
  const opened = await restarted.open(
    { ...f.request, recoveryId: session.recoveryId },
    { onBox: false },
  );
  expect(opened.binding).toEqual(session.binding);
  const selected = (await recoverySelectPastWaits(
    clock,
    {
      prepare: (proposal, client) => restarted.prepare(opened.sessionId, proposal, client),
    },
    { onBox: false },
  )) as { input: unknown };
  await restarted.commit(opened.sessionId, selected.input, { onBox: false });
  const final = (await f.workspace.read()).at(-1)!;
  expect(final.phase).toBe("selected");
  expect(final.binding).toEqual(record.binding);
  expect(final.target).toEqual(record.target);
});

it("a newer Cloud approval fences an earlier proof still downloading", async () => {
  const f = await interruptedCloudTransfer();
  let start!: () => void, release!: () => void;
  const downloading = new Promise<void>((resolve) => {
    start = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.control.beforeDownload = async () => {
    start();
    await ready;
  };
  const pending = f.restarted.open(
    { ...f.request, recoveryId: f.session.recoveryId },
    { onBox: false },
  );
  const refused = expect(pending).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await downloading;
  expect((await f.restarted.cloudStart()).state).toBe("awaiting_owner");
  release();
  await refused;
  expect((await f.workspace.read()).at(-1)!.binding).toEqual(f.record.binding);
  expect((await f.workspace.read()).at(-1)!.input).toBeNull();
});

it("missing Cloud state cannot replace approval once an input has been selected", async () => {
  const f = await selectedRepair();
  await f.service.dispose();
  await unlink(
    join(dirname(dirname(f.record.target.target.stateDir)), "cloud", "cloud-recovery.json"),
  );
  await expect(recovery(f.options).cloudStart()).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect((await f.workspace.read()).at(-1)!.input).toEqual(f.selected.input);
});

it("retains an unexplained sealed publication instead of starting another Cloud approval", async () => {
  const f = await interruptedCloudTransfer();
  const path = join(dirname(dirname(f.record.target.target.stateDir)), "publication.json");
  const bytes = Buffer.from(
    JSON.stringify({ version: 1, ciphertext: "retained unknown material" }),
  );
  await writeFile(path, bytes, { mode: 0o600 });
  await expect(f.restarted.cloudStart()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readFile(path)).toEqual(bytes);
  expect((await f.workspace.read()).at(-1)!.input).toBeNull();
});

it("never uses a supplied Cloud client that can write the retained source state", async () => {
  const f = await fixture();
  const direct = createCloudRecoveryClient({ ...f.options.cloud, stateDir: f.roots.stateDir });
  await direct.start();
  const path = join(f.roots.stateDir, "cloud-recovery.json");
  const original = await readFile(path);
  const service = recovery({
    ...f.options,
    cloud: undefined,
    sources: { ...f.options.sources, cloudRecovery: direct },
  });
  await expect(service.open(f.request, { onBox: false })).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(await readFile(path)).toEqual(original);
  expect(await f.workspace.read()).toEqual([]);
});

it.each([false, true])(
  "keeps the existing preproduction protocol usable with interrupted=%s",
  async (interrupted) => {
    const f = await selectedRepair(1);
    if (interrupted) {
      vi.spyOn(secrets, "unpackBundleToDir").mockRejectedValueOnce(
        new Error("interrupted legacy publication"),
      );
      await expect(
        f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
      ).rejects.toThrow("interrupted legacy publication");
      await f.service.dispose();
      const restarted = recovery(f.options);
      const resumed = await restarted.resume(
        {
          observation: f.request.observation,
          recoveryId: f.session.recoveryId,
          nodeRecoverySecret: key.secret,
          context: f.request.context,
        },
        { onBox: false },
      );
      await restarted.commit(resumed.sessionId, resumed.input, { onBox: false });
    } else await f.service.commit(f.session.sessionId, f.selected.input, { onBox: false });
    expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
    expect(await readCloudRecoveryState(f.record.target.target.stateDir)).toMatchObject({
      version: 1,
      phase: "reported",
      requestId: f.approved.requestId,
    });
    await expect(access(join(f.record.target.target.stateDir, "backup.env"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
    expect(f.control.downloaded).toBe(2);
  },
);

it("cannot start an expired Cloud approval again after its publication is sealed", async () => {
  const f = await selectedRepair();
  const append = f.workspace.append;
  vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
    if (record.phase === "placement-started") throw new Error("interrupted sealed publication");
    return append(record);
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toThrow("interrupted sealed publication");

  const path = join(
    dirname(dirname(f.record.target.target.stateDir)),
    "cloud",
    "cloud-recovery.json",
  );
  const original = await readFile(path);
  await f.service.close(f.session.sessionId);
  f.control.expired = true;
  await expect(f.service.cloudStartAgain()).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await readFile(path)).toEqual(original);
  expect((await f.workspace.read()).at(-1)!.input).toEqual(f.selected.input);
});

it("can renew an expired prepared Cloud approval before publication without changing its selected input", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  f.control.expired = true;
  const next = await f.service.cloudStartAgain();
  expect(next.requestId).not.toBe(f.approved.requestId);
  expect(next.state).toBe("awaiting_owner");
  const record = (await f.workspace.read()).at(-1)!;
  expect(record.input).toEqual(f.selected.input);
  expect(record.binding).toEqual(f.record.binding);
  expect(record.target).toEqual(f.record.target);
});

it("a renewed Cloud approval fences earlier proof after its real key check", async () => {
  const f = await selectedRepair();
  await f.service.dispose();
  const restarted = recovery(f.options);
  await restarted.cloudStatus();
  let checked!: () => void, release!: () => void;
  const proofChecked = new Promise<void>((resolve) => {
    checked = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const actual = await vi.importActual<typeof sourceProof>("./first-setup-backup-source.js");
  vi.spyOn(sourceProof, "authenticatedFirstSetupBackupPreview").mockImplementation(
    async (...args) => {
      const preview = await actual.authenticatedFirstSetupBackupPreview(...args);
      checked();
      await ready;
      return preview;
    },
  );
  const pending = restarted.open(
    { ...f.request, recoveryId: f.session.recoveryId },
    { onBox: false },
  );
  const refused = expect(pending).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await proofChecked;
  f.control.expired = true;
  expect((await restarted.cloudStartAgain()).state).toBe("awaiting_owner");
  release();
  await refused;
  expect((await f.workspace.read()).at(-1)!.input).toEqual(f.selected.input);
});
