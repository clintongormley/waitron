import { root, key, node, clock } from "../test/hour-recovery-host.js";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import { nodes, tenants } from "@waitron/db";

import * as sources from "./first-setup-backup-source.js";
import { suite } from "../test/hour-recovery-host.js";

import { encryptArtifact, decryptArtifact } from "./artifact-cipher.js";
import { packArchive, unpackArchive } from "./backup-archive.js";

import { recovery, barrier, fixture } from "../test/first-setup-backup-recovery-fixture.js";

vi.mock("./first-setup-backup-source.js", { spy: true });

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

it("a staged copy whose node copy changed after the preview is refused as a conflict", async () => {
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
        const path = join(dirname(copy!.copy.databasePath), "node.db");
        const bytes = await readFile(path);
        bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
        await writeFile(path, bytes);
      }
      return run();
    });
  await expect(recovery(f.options).open(f.request, { onBox: false })).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await f.workspace.read()).toEqual([]);
});

it("a copy whose in-memory node copy changed after the preview is refused as a conflict", async () => {
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
        const bytes = copy!.copy.nodeDump;
        bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
      }
      return run();
    });
  await expect(recovery(f.options).open(f.request, { onBox: false })).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
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
  await writeFile(join(f.roots.stateDir, "trading.env"), `WAITRON_NODE_ID=${localNode}\n`);
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
