import { ARCHIVE_MAX_METADATA_BYTES } from "./backup-archive-file.js";
import { collectModuleNonDbState, readModuleRecoveryEvidence } from "./backup-sources.js";
import { randomUUID } from "node:crypto";
import {
  createFirstSetupCoordinator,
  createFirstSetupResolutionStore,
  selectFirstSetupWorkspace,
} from "@waitron/provisioning";
import { mkdir, mkdtemp, realpath, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { runOnce } from "./backup-sweep.js";
import { LocalFsBackend } from "./local-fs-backend.js";
import { createSealedStateRefresher, readSealedStateRow } from "./sealed-state.js";
import { readdir } from "node:fs/promises";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ALL_MODULES } from "./modules.js";
import { collectStateParts, assembleArchiveEntries } from "./archive-entries.js";
import { collectSealedEntries, sealNodeState, unsealNodeState } from "./sealed-state.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { ArchiveReadBudget } from "./archive-read-budget.js";
import { packArchive, unpackArchive } from "./backup-archive.js";
import { encryptArtifact, decryptArtifact } from "./artifact-cipher.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(
    manifestSets().filter((set) => ["core", "fiscal-verifactu"].includes(set.name)),
    null,
  ),
});
const modules = ALL_MODULES.filter((m) => m.name === "fiscal-verifactu");
const manifest = {
  manifestVersion: 1,
  createdAt: "2026-10-16T12:40:00.000Z",
  environment: "preproduction",
  modules: {},
} as const;
const binding = {
  module: "fiscal-verifactu",
  action: "setup",
  eventId: "abandoned",
  sourceId: "first-setup/old",
  targetNodeId: "old-node",
};
const intent = {
  kind: "intent",
  binding,
  operatorId: "OWNER-PRIVATE",
  softwareId: "different-id",
  scope: { taxpayerNif: "89890001K", environment: "preproduction" },
  bases: [
    { code: "A", purpose: "standard" },
    { code: "FF", purpose: "full" },
    { code: "R", purpose: "rectificative" },
  ],
  contextKey: "PRIVATE-CONTEXT",
  answer: "no",
  identity: "06RC",
  issuedAt: "2026-10-16T12:01:00.000Z",
  references: [],
  secret: "RAW-KEY-MUST-NOT-TRAVEL",
  pdf: "%PDF-PRIVATE",
};
const expected = {
  reference: "prepared-hours",
  complete: true,
  records: [
    {
      taxpayerNif: "89890001K",
      environment: "preproduction",
      reference: "intent/fiscal-verifactu/abandoned",
      kind: "intent",
      softwareId: "different-id",
      nodeId: "old-node",
      identity: "06RC",
      recordedAtMs: 1792152060000,
    },
  ],
};
const entryName = "secrets/module-evidence/fiscal-verifactu/hour-history.json";
let root: string;
let stateDir: string;
let venueDir: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "hour-backup-state-")));
  stateDir = join(root, "state");
  venueDir = join(root, "venue");
  await mkdir(venueDir);
  for (const name of RECOVERY_FILES) {
    await mkdir(dirname(join(stateDir, name)), { recursive: true });
    await writeFile(join(stateDir, name), "existing-state");
  }
});
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
async function journal(
  revisions: unknown[] = [{ binding, value: { version: 1, entries: [intent] } }],
) {
  await writeFile(
    join(stateDir, "module-preparation-state.json"),
    JSON.stringify({ version: 1, revisions }),
  );
}
const deps = () => ({ modules, stateDir, venueDir, resolvers: {} });
const evidence = (entries: { name: string; bytes: Uint8Array }[]) => {
  const found = entries.find((e) => e.name === entryName);
  expect(found, "declared public hour evidence must travel with this backup").toBeDefined();
  return JSON.parse(Buffer.from(found!.bytes).toString("utf8")) as unknown;
};
it("captures abandoned module preparation in encrypted archives and bucket-sealed state", async () => {
  await journal();
  await writeFile(join(stateDir, "not-a-backup.pdf"), "%PDF-PRIVATE");
  const parts = await collectStateParts(deps(), new ArchiveReadBudget());
  const archive = unpackArchive(
    decryptArtifact(
      encryptArtifact(
        packArchive(assembleArchiveEntries(manifest, Buffer.from("database"), parts)),
        "separate-backup-password",
      ),
      "separate-backup-password",
    ),
  );
  const sealed = unsealNodeState(
    await sealNodeState(
      await collectSealedEntries({ ...deps(), manifest }),
      "separate-backup-password",
    ),
    "separate-backup-password",
  );
  for (const entries of [archive, sealed]) {
    expect(evidence(entries)).toEqual(expected);
    expect(entries.some((e) => /module-preparation-state|\.pdf$/.test(e.name))).toBe(false);
    expect(entries.map((e) => Buffer.from(e.bytes).toString("utf8")).join("\n")).not.toMatch(
      /RAW-KEY-MUST-NOT-TRAVEL|PDF-PRIVATE|OWNER-PRIVATE|PRIVATE-CONTEXT/,
    );
  }
  expect(await readFile(join(stateDir, "module-preparation-state.json"), "utf8")).toContain(
    "OWNER-PRIVATE",
  );
});
it("retains a restored higher floor when the current preparation journal is absent", async () => {
  const path = join(stateDir, entryName.slice("secrets/".length));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(expected));
  expect(evidence(assembleArchiveEntries(manifest, null, await collectStateParts(deps())))).toEqual(
    expected,
  );
});
it("combines the restored floor with new lower intents instead of overwriting it", async () => {
  const path = join(stateDir, entryName.slice("secrets/".length));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(expected));
  const low = {
    ...intent,
    binding: { ...binding, eventId: "lower" },
    identity: "06RB",
    issuedAt: "2026-10-16T11:40:00.000Z",
  };
  await journal([{ binding: low.binding, value: { version: 1, entries: [low] } }]);
  expect(evidence(await collectSealedEntries({ ...deps(), manifest }))).toMatchObject({
    records: [
      expected.records[0],
      { reference: "intent/fiscal-verifactu/lower", identity: "06RB" },
    ],
  });
});
it("does not interpret another module's opaque private preparation", async () => {
  await journal([
    { binding: { ...binding, module: "other" }, value: { secret: "FOREIGN-SECRET" } },
  ]);
  const entries = await collectSealedEntries({ ...deps(), manifest });
  expect(entries.some((e) => e.name === entryName)).toBe(false);
});
it.each([
  [{ version: 2, revisions: [] }, "setup.attempt_invalid"],
  [
    { version: 1, revisions: [{ binding, value: { version: 2, entries: [] } }] },
    "sif.allocation_invalid",
  ],
  [
    { version: 1, revisions: [{ binding: { ...binding, sourceId: "" }, value: null }] },
    "setup.attempt_invalid",
  ],
])(
  "refuses corrupt retained history before a short backup can be produced %#",
  async (value, code) => {
    await writeFile(join(stateDir, "module-preparation-state.json"), JSON.stringify(value));
    await expect(collectStateParts(deps())).rejects.toMatchObject({ code });
  },
);
it("refuses malformed restored evidence rather than discarding its floor", async () => {
  const path = join(stateDir, entryName.slice("secrets/".length));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({ ...expected, records: [{ ...expected.records[0], identity: "bad!" }] }),
  );
  await expect(collectStateParts(deps())).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "history_invalid" },
  });
});

it("captures the original anchor journal and restored floor after workspace retirement", async () => {
  await journal();
  const publicPath = join(stateDir, entryName.slice("secrets/".length));
  await mkdir(dirname(publicPath), { recursive: true });
  const higher = {
    ...expected.records[0],
    reference: "intent/fiscal-verifactu/retired-higher",
    nodeId: "retired-peer",
    identity: "06RD",
    recordedAtMs: 1792155720000,
  };
  await writeFile(publicPath, JSON.stringify({ ...expected, records: [higher] }));
  await writeFile(join(stateDir, "first-setup.json"), "original state");
  await writeFile(join(venueDir, "first-setup-claim.json"), "original claim");
  const resolutionId = randomUUID(),
    workspaceId = randomUUID();
  const base = join(stateDir, "first-setup-workspaces", workspaceId);
  const next = {
    resolutionId,
    workspaceId,
    anchorStateDir: stateDir,
    anchorVenueDir: venueDir,
    stateDir: join(base, "state"),
    venueDir: join(base, "venue"),
    selectionGeneration: 1,
  };
  const archive = createFirstSetupResolutionStore({
    stateDir,
    venueDir,
    coordinator: createFirstSetupCoordinator(),
  });
  const prepared = await archive.prepare(
    {
      resolutionId,
      attemptId: randomUUID(),
      observedRevision: 1,
      observedOwnerGeneration: 1,
      database: "missing",
      authority: "original-password",
      register: { kind: "no-current-master", confirmed: true },
      action: "retire",
      nextWorkspace: next,
    },
    [
      { name: "state/first-setup.json", bytes: Buffer.from("original state") },
      { name: "venue/first-setup-claim.json", bytes: Buffer.from("original claim") },
      { name: "venue/venue.db", bytes: null },
    ],
  );
  await selectFirstSetupWorkspace({ stateDir, venueDir }, await archive.apply(prepared));
  for (const name of RECOVERY_FILES) {
    await mkdir(dirname(join(next.stateDir, name)), { recursive: true });
    await writeFile(join(next.stateDir, name), "existing-state");
  }
  expect(evidence(await collectSealedEntries({ ...deps(), ...next, manifest }))).toEqual({
    ...expected,
    records: [higher, expected.records[0]],
  });
  const nodeId = "d0000000-0000-4000-8000-000000000001";
  const refresher = createSealedStateRefresher({
    ...deps(),
    ...next,
    db: suite.db,
    nodeId,
    environment: "preproduction",
    readRecoveryKey: async () => "separate-backup-password",
    now: () => new Date(manifest.createdAt),
    log: () => {},
    status: { failedSince: null },
  });
  expect(await refresher.refresh()).toBe("sealed");
  const stored = await readSealedStateRow(suite.db, nodeId);
  expect(stored).not.toBeNull();
  expect(evidence(unsealNodeState(stored!, "separate-backup-password"))).toEqual({
    ...expected,
    records: [higher, expected.records[0]],
  });
  const destination = join(root, "destination");
  const backend = new LocalFsBackend("one", destination);
  try {
    await runOnce({
      ...deps(),
      ...next,
      db: suite.db,
      backends: [backend],
      environment: "preproduction",
      stagingDir: join(root, "staging"),
      recoveryKey: "separate-backup-password",
      retain: 2,
      retainDays: 30,
      signal: new AbortController().signal,
      destinationTimeoutMs: 60000,
      now: () => new Date(manifest.createdAt),
      log: () => {},
      archive: (path) => suite.db.archiveTo(path),
    });
    const objects = await readdir(destination);
    expect(objects).toHaveLength(1);
    const entries = unpackArchive(
      decryptArtifact(await readFile(join(destination, objects[0])), "separate-backup-password"),
    );
    expect(evidence(entries)).toEqual({
      ...expected,
      records: [higher, expected.records[0]],
    });
  } finally {
    backend.close();
  }
});

it("names malformed JSON in retained backup evidence", () => {
  expect(() =>
    readModuleRecoveryEvidence(modules, [{ name: entryName, bytes: Buffer.from("{") }]),
  ).toThrowError(
    expect.objectContaining({
      code: "backup.archive_invalid",
      params: { reason: "module_evidence_invalid" },
    }),
  );
});

it("refuses a declared preparation source without its journal reader", async () => {
  await expect(collectModuleNonDbState(modules, {})).rejects.toMatchObject({
    code: "backup.source_unresolved",
    params: { source: "hour-history" },
  });
});
it("refuses a module source name that could address another state file", async () => {
  const source = modules[0].backup!.nonDbState![0];
  const selected = [
    { ...modules[0], backup: { nonDbState: [{ ...source, source: "../../keys" }] } },
  ];
  await expect(
    collectModuleNonDbState(selected, {}, undefined, {
      read: async () => [],
      readRetained: async () => [],
    }),
  ).rejects.toMatchObject({ code: "backup.source_unresolved", params: { source: "../../keys" } });
});
it("counts projected evidence against the archive's shared metadata budget", async () => {
  const budget = new ArchiveReadBudget();
  budget.addBytes(ARCHIVE_MAX_METADATA_BYTES - 1);
  await expect(
    collectModuleNonDbState(modules, {}, budget, {
      read: async () => [{ version: 1, entries: [intent] }],
      readRetained: async () => [],
    }),
  ).rejects.toMatchObject({
    code: "backup.archive_invalid",
    params: { reason: "metadata_too_large" },
  });
});
