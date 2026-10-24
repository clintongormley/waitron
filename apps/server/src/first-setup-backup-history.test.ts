import {
  archiveHost,
  suite,
  root,
  binding,
  node,
  clock,
  key,
  scope,
} from "../test/hour-recovery-host.js";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  symlink,
  writeFile,
  access,
  unlink,
} from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as fileSystem from "node:fs/promises";
import { ALL_MODULES } from "@waitron/composition";
import { openVenueDatabase, invoiceSeries } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { createSelectedRecoveryPreparation } from "./recovery-preparation.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";
import {
  createFirstSetupBackupWorkspace,
  createFirstSetupResolutionStore,
  selectFirstSetupWorkspace,
} from "@waitron/provisioning";
import { request as setupRequest } from "../test/first-fiscal.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, mkdtemp: vi.fn(actual.mkdtemp) };
});
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { restoreFromArtifact } from "./restore.js";
import { readFirstSetupBackupHistory } from "./first-setup-backup-history.js";

const module = ALL_MODULES.find((entry) => entry.name === binding.module)!;
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const f = await archiveHost();
  const host = createFirstSetupModuleHost({
    ...f.roots,
    modules: ALL_MODULES,
    environment: {},
  });
  let checks = 0;
  const options = {
    ...f.roots,
    module,
    withVenueExclusion: host.resolution.withVenueExclusion,
    recheck: async () => {
      checks++;
    },
  };
  return { ...f, preparationOptions: f.options, host, options, checks: () => checks };
}

it("reads a later retained database through a private copy and keeps every original byte", async () => {
  const f = await fixture();
  await restoreFromArtifact({
    ...f.restore,
    modules: f.service.modules,
    withModuleOperations: f.service.runner(f.outcome.input),
  });
  const path = join(f.roots.venueDir, "venue.db");
  const before = await readFile(path);
  const names = await readdir(f.roots.venueDir);
  const result = await readFirstSetupBackupHistory(f.options);
  expect(result.databases).toContainEqual(
    expect.objectContaining({
      complete: true,
      records: expect.arrayContaining([
        expect.objectContaining({
          nodeId: node.nodeId,
          identity: "0CNQT",
          kind: "activation",
        }),
      ]),
    }),
  );
  expect(await readFile(path)).toEqual(before);
  expect(await readdir(f.roots.venueDir)).toEqual(names);
  expect(f.checks()).toBe(2);
  expect(JSON.stringify(result)).not.toContain(root);
});

it("keeps public abandoned preparation history even when there is no local database", async () => {
  const f = await fixture();
  const path = join(f.roots.stateDir, "module-preparation-state.json");
  const before = await readFile(path);
  const result = await readFirstSetupBackupHistory(f.options);
  expect(result.databases).toEqual([]);
  expect(result.documents).toMatchObject({
    "hour-history": {
      complete: true,
      records: expect.arrayContaining([
        expect.objectContaining({ identity: "0CNQT", kind: "intent" }),
      ]),
    },
  });
  expect(JSON.stringify(result)).not.toMatch(/operatorId|contextKey/);
  expect(await readFile(path)).toEqual(before);
});

it("reads writes present only in the retained WAL without opening the original database", async () => {
  const f = await fixture();
  await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
  const retained = await openVenueDatabase(f.roots.venueDir);
  try {
    await retained.venue.update(invoiceSeries).set({ nextNumber: 321 });
    const before = await Promise.all(
      ["venue.db", "venue.db-wal", "venue.db-shm"].map(
        async (name) => [name, await readFile(join(f.roots.venueDir, name))] as const,
      ),
    );
    const result = await readFirstSetupBackupHistory({
      ...f.options,
      module: {
        ...module,
        operations: {
          ...module.operations!,
          readRecoveryHistory: async (db) =>
            db.select({ nextNumber: invoiceSeries.nextNumber }).from(invoiceSeries).limit(1),
        },
      },
    });
    expect(result.databases).toEqual([{ nextNumber: 321 }]);
    for (const [name, bytes] of before)
      expect(await readFile(join(f.roots.venueDir, name))).toEqual(bytes);
  } finally {
    await retained.close();
  }
});

it.each(["venue.db-wal", "venue.db-journal", "venue.db-shm"])(
  "does not turn an orphan %s into absent database history",
  async (name) => {
    const f = await fixture();
    await writeFile(join(f.roots.venueDir, name), "retained sidecar");
    await expect(readFirstSetupBackupHistory(f.options)).rejects.toMatchObject({
      code: "module.operation_invalid",
      params: { module: binding.module },
    });
    expect(await readFile(join(f.roots.venueDir, name), "utf8")).toBe("retained sidecar");
  },
);

it.each(["corrupt", "directory", "symlink"])(
  "does not treat a %s database as empty history",
  async (kind) => {
    const f = await fixture();
    const path = join(f.roots.venueDir, "venue.db");
    if (kind === "directory") await mkdir(path);
    else if (kind === "symlink") {
      await copyFile(f.database, join(root, "foreign.db"));
      await symlink(join(root, "foreign.db"), path);
    } else await writeFile(path, "not a database");
    await expect(readFirstSetupBackupHistory(f.options)).rejects.toMatchObject({
      code: "module.operation_invalid",
      params: { module: binding.module },
    });
  },
);

it("requires the module's history reader for a retained database", async () => {
  const f = await fixture();
  await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
  await expect(
    readFirstSetupBackupHistory({
      ...f.options,
      module: { ...module, operations: { ...module.operations!, readRecoveryHistory: undefined } },
    }),
  ).rejects.toMatchObject({ code: "module.operation_invalid" });
});

it("preserves the module's refusal instead of treating unreadable history as no history", async () => {
  const f = await fixture();
  await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
  await expect(
    readFirstSetupBackupHistory({
      ...f.options,
      module: {
        ...module,
        operations: {
          ...module.operations!,
          readRecoveryHistory: async () => {
            throw new AppError("sif.allocation_invalid", { reason: "history_invalid" });
          },
        },
      },
    }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "history_invalid" },
  });
});

it("does not return evidence after an original WAL appears during inspection", async () => {
  const f = await fixture();
  await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
  const workspace = createFirstSetupBackupWorkspace(f.roots);
  const id = "42ab5d13-711b-4e68-82aa-94c7d9747afd";
  await f.options.withVenueExclusion(async () => {});
  const digest = await workspace.inspect(id);
  await expect(
    readFirstSetupBackupHistory({
      ...f.options,
      recheck: async () => {
        if ((await workspace.inspect(id)) !== digest)
          throw new AppError("setup.attempt_conflict", {});
      },
      module: {
        ...module,
        operations: {
          ...module.operations!,
          readRecoveryHistory: async (db) => {
            const result = await module.operations!.readRecoveryHistory!(db);
            await writeFile(
              join(f.roots.venueDir, "venue.db-wal"),
              "appeared while reading private copy",
            );
            return result;
          },
        },
      },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
});

it("reads both retained and current databases after an ordinary workspace selection", async () => {
  const f = await fixture();
  await f.host.owner.claimFirstSetup(
    {
      request: {
        ...setupRequest,
        location: { ...setupRequest.location, operationDescription: "Restaurant" },
      },
      environment: "preproduction",
    },
    randomBytes(32).toString("base64url"),
  );
  const old = (await f.host.store.read())!;
  await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
  const resolutionId = randomUUID(),
    workspaceId = randomUUID();
  const anchor = {
    stateDir: await realpath(f.roots.stateDir),
    venueDir: await realpath(f.roots.venueDir),
  };
  const selected = {
    resolutionId,
    workspaceId,
    anchorStateDir: anchor.stateDir,
    anchorVenueDir: anchor.venueDir,
    stateDir: join(anchor.stateDir, "first-setup-workspaces", workspaceId, "state"),
    venueDir: join(anchor.stateDir, "first-setup-workspaces", workspaceId, "venue"),
    selectionGeneration: 1,
  };
  const records = createFirstSetupResolutionStore({ ...anchor, coordinator: f.host.coordinator });
  const prepared = await records.prepare(
    {
      resolutionId,
      attemptId: old.frozen.attemptId,
      observedRevision: old.revision,
      observedOwnerGeneration: old.ownerGeneration,
      database: "unknown-or-nonempty",
      authority: "original-password",
      register: { kind: "no-current-master", confirmed: true },
      action: "retire",
      nextWorkspace: selected,
    },
    [
      {
        name: "state/first-setup.json",
        bytes: await readFile(join(anchor.stateDir, "first-setup.json")),
      },
      {
        name: "venue/first-setup-claim.json",
        bytes: await readFile(join(anchor.venueDir, "first-setup-claim.json")),
      },
      { name: "venue/venue.db", bytes: await readFile(join(anchor.venueDir, "venue.db")) },
    ],
  );
  await selectFirstSetupWorkspace(anchor, await records.apply(prepared));
  await suite.db.update(invoiceSeries).set({ nextNumber: 456 });
  await suite.db.archiveTo(join(selected.venueDir, "venue.db"));
  const host = createFirstSetupModuleHost({ ...selected, modules: ALL_MODULES, environment: {} });
  const result = await readFirstSetupBackupHistory({
    ...f.options,
    ...selected,
    withVenueExclusion: host.resolution.withVenueExclusion,
    module: {
      ...module,
      operations: {
        ...module.operations!,
        readRecoveryHistory: async (db) =>
          db.select({ nextNumber: invoiceSeries.nextNumber }).from(invoiceSeries).limit(1),
      },
    },
  });
  expect(result.databases).toEqual([{ nextNumber: 123 }, { nextNumber: 456 }]);
});

it("closes and deletes its private copy even when a module refuses its history", async () => {
  const f = await fixture();
  await suite.db.archiveTo(join(f.roots.venueDir, "venue.db"));
  let privatePath: string | undefined;
  await expect(
    readFirstSetupBackupHistory({
      ...f.options,
      module: {
        ...module,
        operations: {
          ...module.operations!,
          readRecoveryHistory: async (db) => {
            const rows = (await db.execute("pragma database_list")).rows;
            privatePath = rows.find((row) => row.name === "main")!.file as string;
            throw new AppError("sif.allocation_invalid", { reason: "history_invalid" });
          },
        },
      },
    }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "history_invalid" },
  });
  expect(privatePath).toMatch(/waitron-backup-history-/);
  expect(privatePath).not.toBe(join(f.roots.venueDir, "venue.db"));
  await expect(access(privatePath!)).rejects.toMatchObject({ code: "ENOENT" });
});

it("hands later local names to real module selection and still permits a later minute", async () => {
  const f = await fixture();
  const record = {
    reference: "independent-later-node",
    kind: "retirement",
    taxpayerNif: scope.taxpayerNif,
    environment: scope.environment,
    softwareId: "OTHER",
    nodeId: "former-peer",
    identity: "0CNVA",
    recordedAtMs: Date.parse("2026-10-16T15:10:00Z"),
  };
  const directory = join(f.roots.stateDir, "module-evidence", binding.module);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "hour-history.json"),
    JSON.stringify({ reference: "prepared-hours", complete: true, records: [record] }),
  );
  const evidence = await readFirstSetupBackupHistory(f.options);
  const destination = { stateDir: join(root, "new-state"), venueDir: join(root, "new-venue") };
  await mkdir(destination.stateDir);
  await mkdir(destination.venueDir);
  const { readIsolation: omitted, ...preparationOptions } = f.preparationOptions;
  void omitted;
  const service = createSelectedRecoveryPreparation({
    ...preparationOptions,
    ...destination,
    coordinator: f.host.coordinator,
    binding: { ...f.preparationOptions.binding, eventId: "history-aware-repair" },
    secret: key.secret,
    readRecoveryFacts: async () => ({
      ...f.facts,
      history: [...f.facts.history, ...evidence.databases, ...Object.values(evidence.documents)],
    }),
  });
  await expect(recoverySelectPastWaits(clock, service, { onBox: false })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "minute_not_later" },
  });
  clock.set(Date.parse("2026-10-16T15:20:00Z"));
  expect(await recoverySelectPastWaits(clock, service, { onBox: false })).toMatchObject({
    status: "selected",
  });
});

it.each(["module", "source"])("refuses an unsafe %s evidence path", async (field) => {
  const f = await fixture();
  await expect(
    readFirstSetupBackupHistory({
      ...f.options,
      module: {
        ...module,
        name: field === "module" ? "../outside" : module.name,
        backup: {
          ...module.backup!,
          nonDbState: [
            {
              kind: "preparation-history",
              source: field === "source" ? "../outside" : "history",
              project: () => null,
            },
          ],
        },
      },
    }),
  ).rejects.toMatchObject({ code: "module.operation_invalid" });
});

it("ignores content directories while projecting recovery history", async () => {
  const f = await fixture();
  const expected = await readFirstSetupBackupHistory(f.options);
  expect(
    await readFirstSetupBackupHistory({
      ...f.options,
      module: {
        ...module,
        backup: {
          ...module.backup!,
          nonDbState: [
            { kind: "content-addressed-dir", source: "images" },
            ...module.backup!.nonDbState!,
          ],
        },
      },
    }),
  ).toEqual(expected);
});

it("refuses an unavailable private workspace and leaves a subsequent read usable", async () => {
  const f = await fixture();
  const actual = (await vi.importActual<typeof fileSystem>("node:fs/promises")).mkdtemp;
  const failed = vi.mocked(fileSystem.mkdtemp).mockImplementation(async (prefix, ...args) => {
    if (String(prefix).includes("waitron-backup-history-"))
      throw Object.assign(new Error("private scratch unavailable"), { code: "ENOSPC" });
    return actual(prefix, ...args);
  });
  await expect(readFirstSetupBackupHistory(f.options)).rejects.toMatchObject({
    code: "module.operation_invalid",
  });
  failed.mockRestore();
  expect(await readFirstSetupBackupHistory(f.options)).toMatchObject({ databases: [] });
});

it("carries a current selected setup independently of a missing preparation journal and marker", async () => {
  const f = await fixture();
  await f.host.owner.claimFirstSetup(
    {
      environment: "preproduction",
      request: {
        ...setupRequest,
        location: { ...setupRequest.location, operationDescription: "Restaurant" },
      },
    },
    randomBytes(32).toString("base64url"),
  );
  let state = (await f.host.store.read())!;
  const context = firstSetupModuleContext(state, binding.module);
  const input = hourSetupInput(
    {
      binding: context.binding,
      scope: { taxpayerNif: context.taxId, environment: context.environment },
      bases: [...context.bases].sort((a, b) => a.code.localeCompare(b.code)),
      identity: "0CNPH",
      issuedAt: "2026-10-16T12:01:00.000Z",
    },
    context.administratorId,
  );
  state = await f.host.store.update(state.frozen.attemptId, state.revision, {
    kind: "candidates",
    module: binding.module,
    request: { kind: "waitron-hour-setup", status: "selected", identity: "0CNPH", input },
  });
  await f.host.store.update(state.frozen.attemptId, state.revision, {
    kind: "input",
    module: binding.module,
    input,
  });
  await unlink(join(f.roots.stateDir, "module-preparation-state.json"));
  await unlink(join(f.roots.venueDir, "first-setup-claim.json"));
  const before = await readFile(join(f.roots.stateDir, "first-setup.json"));
  const value = await readFirstSetupBackupHistory(f.options);
  expect(value.documents).toMatchObject({
    "hour-history": {
      records: expect.arrayContaining([
        expect.objectContaining({ identity: "0CNPH", kind: "workspace", taxpayerNif: "50000000R" }),
      ]),
    },
  });
  expect(JSON.stringify(value)).not.toMatch(/ownerVerifier|capabilityHash|operatorId/);
  expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(before);
  await expect(access(join(f.roots.venueDir, "first-setup-claim.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("refuses unreadable attempt history during fiscal admission without losing its bytes", async () => {
  const f = await fixture();
  const path = join(f.roots.stateDir, "first-setup.json");
  await writeFile(path, "unreadable retained selection");
  await expect(readFirstSetupBackupHistory(f.options)).rejects.toMatchObject({
    code: "module.operation_invalid",
    params: { module: binding.module },
  });
  expect(await readFile(path, "utf8")).toBe("unreadable retained selection");
});

import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { hourSetupInput } from "@waitron/fiscal-verifactu/src/hour-preparation.js";

async function selectedSetup(f: Awaited<ReturnType<typeof fixture>>) {
  const claim = await f.host.owner.claimFirstSetup(
    {
      environment: "preproduction",
      request: {
        ...setupRequest,
        location: { ...setupRequest.location, operationDescription: "Restaurant" },
      },
    },
    randomBytes(32).toString("base64url"),
  );
  let state = (await f.host.store.read())!;
  const context = firstSetupModuleContext(state, binding.module);
  const input = hourSetupInput(
    {
      binding: context.binding,
      scope: { taxpayerNif: context.taxId, environment: context.environment },
      bases: [...context.bases].sort((a, b) => a.code.localeCompare(b.code)),
      identity: "0CNPH",
      issuedAt: "2026-10-16T12:01:00.000Z",
    },
    context.administratorId,
  );
  state = await f.host.store.update(state.frozen.attemptId, state.revision, {
    kind: "candidates",
    module: binding.module,
    request: { kind: "waitron-hour-setup", status: "selected", identity: "0CNPH", input },
  });
  state = await f.host.store.update(state.frozen.attemptId, state.revision, {
    kind: "input",
    module: binding.module,
    input,
  });
  return {
    state,
    owner: {
      attemptId: state.frozen.attemptId,
      revision: state.revision,
      ownerGeneration: state.ownerGeneration,
      capability: claim.capability,
    },
  };
}
it("preserves a previous attempt's selected name when the current attempt is still unselected", async () => {
  const f = await fixture();
  const held = await selectedSetup(f);
  await f.host.store.update(held.state.frozen.attemptId, held.state.revision, {
    kind: "abandoned",
  });
  await f.host.owner.claimFirstSetup(
    {
      environment: "preproduction",
      request: {
        ...setupRequest,
        location: { ...setupRequest.location, operationDescription: "Restaurant" },
      },
    },
    randomBytes(32).toString("base64url"),
  );
  await unlink(join(f.roots.stateDir, "module-preparation-state.json"));
  const value = await readFirstSetupBackupHistory(f.options);
  expect(value.documents).toMatchObject({
    "hour-history": {
      records: [
        expect.objectContaining({
          kind: "workspace",
          identity: "0CNPH",
          nodeId: held.state.frozen.nodeId,
        }),
      ],
    },
  });
});

it("reads the real current recovery-document manifest through its existing parser and projects only a public floor", async () => {
  const f = await fixture();
  const held = await selectedSetup(f);
  const consuming = await f.host.store.update(held.state.frozen.attemptId, held.state.revision, {
    kind: "consumption-intent",
  });
  const document = await keepHourRecoveryDocument(
    f.host,
    { ...held.owner, revision: consuming.revision },
    setupRequest.admin.password,
  );
  const before = await readFile(
    join(f.roots.stateDir, "first-fiscal-documents", `${binding.module}.recovery.json`),
  );
  const value = await readFirstSetupBackupHistory({
    ...f.options,
    module: f.host.modules.find((entry) => entry.name === binding.module)!,
  });
  expect(value.documents["hour-history"]).toMatchObject({
    timeFloorMs: Date.parse(document.statement.createdAt),
    records: expect.arrayContaining([
      expect.objectContaining({ kind: "workspace", identity: "0CNPH" }),
    ]),
  });
  expect(JSON.stringify(value)).not.toMatch(
    /Private business|secret|ownerVerifier|capabilityHash|taxpayerName/,
  );
  expect(
    await readFile(
      join(f.roots.stateDir, "first-fiscal-documents", `${binding.module}.recovery.json`),
    ),
  ).toEqual(before);
});

it("preserves standalone declared public history without exposing its private wrapper", async () => {
  const f = await fixture();
  await writeFile(
    join(f.roots.stateDir, "module-operation-public.json"),
    JSON.stringify({
      version: 1,
      modules: {},
      history: [
        {
          attemptId: "old",
          revision: 1,
          ownerGeneration: 1,
          module: binding.module,
          current: {
            format: "waitron-hour-history",
            scope,
            sources: [
              {
                reference: "public-old",
                complete: true,
                records: [
                  {
                    reference: "public-old/name",
                    kind: "intent",
                    ...scope,
                    softwareId: "W1",
                    nodeId: "different-node",
                    identity: "0CNPH",
                    recordedAtMs: 1792152060000,
                  },
                ],
              },
            ],
            private: "private-wrapper",
          },
        },
      ],
    }),
  );
  const value = await readFirstSetupBackupHistory(f.options);
  expect(value.documents["hour-history"]).toMatchObject({
    records: expect.arrayContaining([
      expect.objectContaining({ reference: "public-old/name", identity: "0CNPH" }),
    ]),
  });
  expect(JSON.stringify(value)).not.toContain("private-wrapper");
});

it.each(["setup-operation.json", "restore-request.json", "reset-request.json"])(
  "does not assume an unprojected legacy %s carries no selected name",
  async (name) => {
    const f = await fixture();
    const path = join(f.roots.stateDir, name);
    await writeFile(path, JSON.stringify({ unknownSelection: "retained-only" }));
    await expect(readFirstSetupBackupHistory(f.options)).rejects.toMatchObject({
      code: "module.operation_invalid",
      params: { module: binding.module },
    });
    expect(await readFile(path, "utf8")).toContain("retained-only");
  },
);

import { keepHourRecoveryDocument } from "../test/hour-recovery-delivery.js";

it("reads retained outside evidence privately from archived snapshots, and refuses unreadable JSON", async () => {
  const f = await fixture();
  const held = await selectedSetup(f);
  const proof = {
    format: "waitron-hour-history",
    scope,
    sources: [{ reference: "old", complete: true, records: [] }],
  };
  const original = {
    name: "outside-file:/private/retained.json",
    bytes: Buffer.from(JSON.stringify(proof)),
  };
  const value = await readFirstSetupBackupSetups(
    [],
    [{ state: held.state, originals: [original, { name: "outside-file:/absent", bytes: null }] }],
    module,
  );
  expect(value.publicEvidence).toEqual([proof]);
  expect(value.setups).toEqual([
    expect.objectContaining({ input: held.state.inputs[binding.module] }),
  ]);
  await expect(
    readFirstSetupBackupSetups(
      [],
      [{ state: held.state, originals: [{ ...original, bytes: Buffer.from("not JSON") }] }],
      module,
    ),
  ).rejects.toMatchObject({ code: "module.operation_invalid" });
});
it("does not invent an empty attempt for orphan public document chunks or an unreadable documents directory", async () => {
  const f = await fixture();
  const directory = join(f.roots.stateDir, "first-fiscal-documents");
  await mkdir(directory);
  await writeFile(join(directory, "orphan.json"), "{}");
  await expect(readFirstSetupBackupHistory(f.options)).rejects.toMatchObject({
    code: "module.operation_invalid",
  });
  await unlink(join(directory, "orphan.json"));
  await rm(directory, { recursive: true });
  await writeFile(directory, "not a directory");
  await expect(readFirstSetupBackupHistory(f.options)).rejects.toMatchObject({
    code: "module.operation_invalid",
  });
});
it("does not pass another module's retained setup context to the requested module", async () => {
  const f = await fixture();
  const held = await selectedSetup(f);
  expect(
    await readFirstSetupBackupSetups([], [{ state: held.state, originals: [] }], {
      ...module,
      name: "another-module",
    }),
  ).toEqual({ setups: [], publicEvidence: [] });
});
import { readFirstSetupBackupSetups } from "./first-setup-backup-setups.js";
import { rm } from "node:fs/promises";
