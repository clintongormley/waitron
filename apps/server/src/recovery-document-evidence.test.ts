import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import {
  createFirstSetupCoordinator,
  createFirstSetupResolutionStore,
  selectFirstSetupWorkspace,
} from "@waitron/provisioning";
import { readRecoveryDocumentEvidence } from "./recovery-document-evidence.js";

let root: string;
let roots: { stateDir: string; venueDir: string };
const module = ALL_MODULES.find((m) => m.name === "fiscal-verifactu")!;
const binding = {
  module: module.name,
  action: "setup",
  eventId: "discarded",
  sourceId: "first-setup:earlier",
  targetNodeId: "retired-node",
};
const intent = {
  kind: "intent",
  binding,
  softwareId: "W2",
  operatorId: "PRIVATE-OPERATOR",
  contextKey: "PRIVATE-CONTEXT",
  scope: { taxpayerNif: "89890001K", environment: "preproduction" },
  bases: [
    { code: "A", purpose: "standard" },
    { code: "FF", purpose: "full" },
    { code: "R", purpose: "rectificative" },
  ],
  answer: "no",
  identity: "06RC",
  issuedAt: "2026-10-16T12:10:00.000Z",
  references: [],
};
const record = {
  reference: "retained/06RD",
  kind: "backup",
  taxpayerNif: "89890001K",
  environment: "preproduction",
  softwareId: "W2",
  nodeId: "former-node",
  identity: "06RD",
  recordedAtMs: null,
};
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "recovery-document-evidence-"));
  roots = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  await mkdir(roots.stateDir);
  await mkdir(roots.venueDir);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function retain(stateDir: string, identity = "06RD") {
  await mkdir(join(stateDir, "module-evidence", module.name), { recursive: true });
  await writeFile(
    join(stateDir, "module-evidence", module.name, "hour-history.json"),
    JSON.stringify({
      reference: "prepared-hours",
      complete: true,
      records: [{ ...record, reference: `retained/${identity}`, identity }],
    }),
  );
}
it("exports current journal and retained public hour evidence without private preparation fields", async () => {
  const path = join(roots.stateDir, "module-preparation-state.json");
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      revisions: [{ binding, value: { version: 1, entries: [intent] } }],
    }),
  );
  const before = await readFile(path);
  await retain(roots.stateDir);
  const result = await readRecoveryDocumentEvidence(roots, module);
  expect(result).toEqual({
    "hour-history": {
      reference: "prepared-hours",
      complete: true,
      records: [
        record,
        {
          reference: "intent/fiscal-verifactu/discarded",
          kind: "intent",
          taxpayerNif: "89890001K",
          environment: "preproduction",
          softwareId: "W2",
          nodeId: "retired-node",
          identity: "06RC",
          recordedAtMs: 1792152600000,
        },
      ],
    },
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE-");
  expect(await readFile(path)).toEqual(before);
});
it("retains the anchor's journal and both public floors after workspace selection", async () => {
  await writeFile(
    join(roots.stateDir, "module-preparation-state.json"),
    JSON.stringify({
      version: 1,
      revisions: [{ binding, value: { version: 1, entries: [intent] } }],
    }),
  );
  await retain(roots.stateDir);
  await writeFile(join(roots.stateDir, "first-setup.json"), "original state");
  await writeFile(join(roots.venueDir, "first-setup-claim.json"), "original claim");
  const workspaceId = randomUUID(),
    resolutionId = randomUUID();
  const selected = {
    workspaceId,
    resolutionId,
    anchorStateDir: await realpath(roots.stateDir),
    anchorVenueDir: await realpath(roots.venueDir),
    stateDir: join(await realpath(roots.stateDir), "first-setup-workspaces", workspaceId, "state"),
    venueDir: join(await realpath(roots.stateDir), "first-setup-workspaces", workspaceId, "venue"),
    selectionGeneration: 1,
  };
  const archive = createFirstSetupResolutionStore({
    ...roots,
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
      register: null,
      action: "retire",
      nextWorkspace: selected,
    },
    [
      { name: "state/first-setup.json", bytes: Buffer.from("original state") },
      { name: "venue/first-setup-claim.json", bytes: Buffer.from("original claim") },
      { name: "venue/venue.db", bytes: null },
    ],
  );
  await selectFirstSetupWorkspace(roots, await archive.apply(prepared));
  await retain(selected.stateDir, "06RE");
  const evidence = await readRecoveryDocumentEvidence(selected, module);
  expect(evidence).toMatchObject({
    "hour-history": { records: [{ identity: "06RD" }, { identity: "06RE" }, { identity: "06RC" }] },
  });
});
it("modules without preparation-history sources have no document evidence", async () => {
  expect(await readRecoveryDocumentEvidence(roots, fakeModule("no-backup"))).toEqual({});
  expect(
    await readRecoveryDocumentEvidence(roots, {
      ...fakeModule("content"),
      backup: { nonDbState: [{ kind: "content-addressed-dir", source: "images" }] },
    }),
  ).toEqual({});
});
it.each(["../outside", "BadName"])(
  "refuses unsafe evidence source %s before a file can be read",
  async (source) => {
    await expect(
      readRecoveryDocumentEvidence(roots, {
        ...module,
        backup: { nonDbState: [{ ...module.backup!.nonDbState![0]!, source }] },
      }),
    ).rejects.toMatchObject({
      code: "recovery.pack_invalid",
      params: { reason: "module_unsupported" },
    });
  },
);
it("refuses a corrupt journal instead of omitting spent hours", async () => {
  await writeFile(
    join(roots.stateDir, "module-preparation-state.json"),
    JSON.stringify({ version: 2, revisions: [] }),
  );
  await expect(readRecoveryDocumentEvidence(roots, module)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});

it("an ordinary box with no journal or restored history exports an empty public source", async () => {
  expect(await readRecoveryDocumentEvidence(roots, module)).toEqual({
    "hour-history": { reference: "prepared-hours", complete: true, records: [] },
  });
});
