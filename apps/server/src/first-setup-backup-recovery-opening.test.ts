import { root, node, clock } from "../test/hour-recovery-host.js";

import { access, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";

import { ALL_MODULES } from "@waitron/composition";

import { type BackupRepairOpenRequest } from "./first-setup-backup-recovery.js";
import * as sources from "./first-setup-backup-source.js";
import { suite } from "../test/hour-recovery-host.js";

import { AppError } from "@waitron/shared";
import { readModuleRecoveryEvidence } from "./backup-sources.js";

import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";
import { copyFile, unlink } from "node:fs/promises";
import { restoreFromArtifact } from "./restore.js";
import { recovery, fixture } from "../test/first-setup-backup-recovery-fixture.js";

vi.mock("./first-setup-backup-source.js", { spy: true });

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
