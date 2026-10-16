import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, readdir, unlink, realpath } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { initialSetupFor, withOperationAuthority } from "@waitron/module";
import {
  createFirstSetupCoordinator,
  createFirstSetupResolutionStore,
  selectFirstSetupWorkspace,
} from "@waitron/provisioning";
import { declaredFirstFiscalFixture, publicDigest } from "../test/declared-first-fiscal.js";
import { request } from "../test/first-fiscal.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { ALL_MODULES } from "@waitron/composition";
const fiscalModules = ALL_MODULES;
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const fixtures: Awaited<ReturnType<typeof declaredFirstFiscalFixture>>[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.dispose()));
});
async function fixture(
  serial = 1,
  taxId = request.taxId,
  environment: "production" | "preproduction" = "production",
  freezeCandidates = true,
  retiredSerial?: number,
  retained?: {
    history?: unknown;
    legacy?: unknown;
    previousSerial?: number;
    document?: boolean;
    damage?: "missing-manifest" | "chunk" | "binding" | "digest";
    source?: "legacy" | "outside";
  },
) {
  const retainedHistory = retained?.history,
    retainedDocument = retained?.document === true,
    damageDocument = retained?.damage,
    historySource = retained?.source ?? "legacy";
  const f = await declaredFirstFiscalFixture(
    retainedDocument
      ? {
          extendHistory(history, context) {
            const allocation = (
              initialSetupFor(fiscalModules, "fiscal-verifactu")!.candidates(context, {
                serials: [42],
              }) as {
                candidates: import("@waitron/fiscal-verifactu/src/paper-protocol.js").PaperAllocation[];
              }
            ).candidates[0]!;
            return {
              ...history,
              revisions: [
                ...history.revisions,
                {
                  ...history.revisions[0]!,
                  revision: "2",
                  previousDigest: publicDigest(history.revisions[0]!),
                  sHighWater: 42,
                  events: [
                    {
                      kind: "reserve",
                      allocation,
                      binding: { ...context.binding, eventId: "another-reservation" },
                      recipientVenueId: "another-venue",
                      reservedAt: "2026-10-16T00:00:00.000Z",
                    },
                  ],
                },
              ],
            };
          },
        }
      : undefined,
  );
  fixtures.push(f);
  let old = (await f.store.read())!;
  const documentOriginals: { name: string; bytes: Buffer }[] = [];
  if (retainedDocument) {
    const { createFirstSetupNodeKeys } = await import("./first-setup-node-key.js");
    const { createFirstFiscalDelivery } = await import("./first-fiscal-delivery.js");
    const keys = createFirstSetupNodeKeys(f);
    const staged = await keys.stageInitialNodeKey(
      f.ownerAttempt,
      await f.owner.reconfirm(f.ownerAttempt, f.password, "block-use"),
    );
    const delivery = createFirstFiscalDelivery({ ...f, keys });
    await delivery.registerFirstFiscalDelivery(f.ownerAttempt, {
      module: f.module,
      stageId: staged.stage.stageId,
      inputDigest: publicDigest(f.input),
      historyDigest: f.statement.delivery.historyDigest,
      documentDigest: f.statement.delivery.documentDigest,
      statement: f.statement,
    });
    const directory = join(f.stateDir, "first-fiscal-documents");
    const manifestPath = join(directory, `${f.module}.json`);
    if (damageDocument === "missing-manifest") await unlink(manifestPath);
    if (damageDocument === "chunk") {
      const path = join(
        directory,
        (await readdir(directory)).find((name) => name.endsWith("-0.json"))!,
      );
      const chunk = JSON.parse(await readFile(path, "utf8"));
      chunk.data = Buffer.from("{} long enough corrupt public history").toString("base64");
      await writeFile(path, JSON.stringify(chunk));
    }
    if (damageDocument === "digest") {
      const path = join(
        directory,
        (await readdir(directory)).find((name) => name.endsWith("-0.json"))!,
      );
      const chunk = JSON.parse(await readFile(path, "utf8"));
      const before = Buffer.from(chunk.data, "base64").toString("utf8");
      const after = before.replace('"confirmedAt":"2026', '"confirmedAt":"2025');
      expect(after).not.toBe(before);
      expect(Buffer.byteLength(after)).toBe(Buffer.byteLength(before));
      chunk.data = Buffer.from(after).toString("base64");
      await writeFile(path, JSON.stringify(chunk));
    }
    if (damageDocument === "binding") {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.attemptId = randomUUID();
      await writeFile(manifestPath, JSON.stringify(manifest));
    }
    const names = (await readdir(directory)).sort();
    documentOriginals.push({
      name: "directory:state/first-fiscal-documents",
      bytes: Buffer.from(JSON.stringify(names)),
    });
    for (const name of names)
      documentOriginals.push({
        name: `state/first-fiscal-documents/${name}`,
        bytes: await readFile(join(directory, name)),
      });
  }
  if (retiredSerial !== undefined) {
    const oldHost = createFirstSetupModuleHost({
      stateDir: join(f.root, "old-state"),
      venueDir: join(f.root, "old-venue"),
      environment: {},
      modules: f.modules,
    });
    let claim = await oldHost.owner.claimFirstSetup(
      { environment: "production", request },
      randomBytes(32).toString("base64url"),
    );
    old = (await oldHost.store.read())!;
    const context = firstSetupModuleContext(old, f.module),
      seat = initialSetupFor(oldHost.modules, f.module)!;
    old = await oldHost.store.update(claim.state.attemptId, old.revision, {
      kind: "candidates",
      module: f.module,
      request: seat.request(
        context,
        seat.candidates(context, { serials: [retained?.previousSerial ?? retiredSerial] }),
      ),
    });
    if (retained?.previousSerial !== undefined) {
      await oldHost.store.update(claim.state.attemptId, old.revision, { kind: "abandoned" });
      claim = await oldHost.owner.claimFirstSetup(
        { environment: "production", request },
        randomBytes(32).toString("base64url"),
      );
      old = (await oldHost.store.read())!;
      const context = firstSetupModuleContext(old, f.module);
      old = await oldHost.store.update(claim.state.attemptId, old.revision, {
        kind: "candidates",
        module: f.module,
        request: seat.request(context, seat.candidates(context, { serials: [retiredSerial] })),
      });
    }
    old = await oldHost.store.update(claim.state.attemptId, old.revision, {
      kind: "consumption-intent",
    });
  }
  const publicPath =
    historySource === "outside"
      ? join(await realpath(f.root), "outside-history.json")
      : join(old.stateDir, "module-operation-public.json");
  const hasPublic = retainedHistory !== undefined || Object.hasOwn(retained ?? {}, "legacy");
  if (hasPublic)
    await writeFile(
      publicPath,
      JSON.stringify(
        Object.hasOwn(retained ?? {}, "legacy")
          ? retained!.legacy
          : historySource === "outside"
            ? retainedHistory
            : {
                version: 1,
                modules: {},
                history: [
                  {
                    attemptId: old.frozen.attemptId,
                    revision: old.revision,
                    ownerGeneration: old.ownerGeneration,
                    module: f.module,
                    current: { knownHistory: retainedHistory },
                  },
                ],
              },
      ),
    );
  const anchor = { stateDir: old.stateDir, venueDir: old.venueDir };
  const resolutionId = randomUUID(),
    workspaceId = randomUUID(),
    base = join(anchor.stateDir, "first-setup-workspaces", workspaceId);
  const binding = {
    workspaceId,
    resolutionId,
    anchorStateDir: anchor.stateDir,
    anchorVenueDir: anchor.venueDir,
    stateDir: join(base, "state"),
    venueDir: join(base, "venue"),
    selectionGeneration: 1,
  };
  const records = createFirstSetupResolutionStore({
    ...anchor,
    coordinator: createFirstSetupCoordinator(),
  });
  const prepared = await records.prepare(
    {
      resolutionId,
      attemptId: old.frozen.attemptId,
      observedRevision: old.revision,
      observedOwnerGeneration: old.ownerGeneration,
      database: "missing",
      authority: "original-password",
      register: {
        kind: "current-master",
        status: "Unknown",
        custodian: "Elena",
        reference: "c".repeat(64),
        consultedAt: "2026-10-16T03:00:00.000Z",
      },
      action: "retire",
      nextWorkspace: binding,
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
      { name: "venue/venue.db", bytes: null },
      ...documentOriginals,
      ...(!hasPublic
        ? []
        : [
            {
              name:
                historySource === "outside"
                  ? `outside-file:${publicPath}`
                  : "state/module-operation-public.json",
              bytes: await readFile(publicPath),
            },
          ]),
    ],
  );
  await selectFirstSetupWorkspace(anchor, await records.apply(prepared));
  const host = createFirstSetupModuleHost({ ...binding, environment: {}, modules: f.modules });
  const claim = await host.owner.claimFirstSetup(
    { environment, request: { ...request, taxId } },
    randomBytes(32).toString("base64url"),
  );
  let state = (await host.store.read())!;
  const context = firstSetupModuleContext(state, f.module),
    seat = initialSetupFor(host.modules, f.module)!;
  const candidates = seat.request(context, seat.candidates(context, { serials: [serial] }));
  if (freezeCandidates)
    state = await host.store.update(claim.state.attemptId, state.revision, {
      kind: "candidates",
      module: f.module,
      request: candidates,
    });
  return { ...f, host, state, old, claim, publicPath };
}
it("fresh bindings cannot reuse a retired installation with another allocation ID", async () => {
  const f = await fixture();
  expect(f.state.frozen.attemptId).not.toBe(f.old.frozen.attemptId);
  expect(f.state.frozen.modules.find((m) => m.module === f.module)?.eventId).not.toBe(
    f.old.frozen.modules.find((m) => m.module === f.module)?.eventId,
  );
  await expect(f.host.assertFreshAssignment(f.state, f.module)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
});
it.each(["fresh-installation", "other-taxpayer", "other-environment"])(
  "retirement still permits a %s",
  async (which) => {
    const f = await fixture(
      which === "fresh-installation" ? 2 : 1,
      which === "other-taxpayer" ? "89890001K" : request.taxId,
      which === "other-environment" ? "preproduction" : "production",
    );
    await f.host.assertFreshAssignment(f.state, f.module);
    expect(f.state.revision).toBe(2);
    expect(f.state.inputs).toEqual({});
  },
);

it.each([1, 2])(
  "the real setup candidate route checks retired names before freezing serial %s",
  async (serial) => {
    const f = await fixture(serial, request.taxId, "production", false);
    const { Hono } = await import("hono"),
      { mountSetup } = await import("./setup-api.js");
    const app = new Hono();
    mountSetup(app, { environment: "production", firstFiscal: f.host }, () => {});
    const owner = {
      attemptId: f.state.frozen.attemptId,
      revision: f.state.revision,
      ownerGeneration: f.state.ownerGeneration,
      capability: f.claim.capability,
    };
    const reconfirmation = await f.host.owner.reconfirm(owner, f.password, "block-use");
    const response = await app.request("/setup-api/first-setup/candidates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Waitron-Setup-Owner": owner.capability,
        "X-Waitron-Setup-Attempt": owner.attemptId,
        "X-Waitron-Setup-Revision": String(owner.revision),
        "X-Waitron-Setup-Generation": String(owner.ownerGeneration),
      },
      body: JSON.stringify({ module: f.module, proposal: { serials: [serial] }, reconfirmation }),
    });
    expect(response.status).toBe(serial === 1 ? 409 : 200);
    if (serial === 1) {
      expect(await response.json()).toEqual({
        error: { code: "setup.attempt_conflict", params: {} },
      });
      expect(await f.host.store.read()).toEqual(f.state);
    } else expect((await f.host.store.read())?.consumptionIntent).toBe(true);
  },
);
it("activation refuses a retired assignment even when a caller bypassed the candidate route", async () => {
  const f = await fixture();
  const state = await f.host.store.update(f.state.frozen.attemptId, f.state.revision, {
    kind: "consumption-intent",
  });
  const owner = {
    attemptId: state.frozen.attemptId,
    revision: state.revision,
    ownerGeneration: state.ownerGeneration,
    capability: f.claim.capability,
  };
  const { activateFirstFiscal } = await import("./first-fiscal-activation.js");
  await expect(
    f.host.coordinator.run((hold) =>
      activateFirstFiscal(f.host, { environment: "production" }, owner, {}, hold),
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await f.host.store.read()).toEqual(state);
});

it.each([1, 41, 42, 43])(
  "a retired high-water mark of 42 bounds fresh serial %s",
  async (serial) => {
    const f = await fixture(serial, request.taxId, "production", true, 42);
    if (serial <= 42)
      await expect(f.host.assertFreshAssignment(f.state, f.module)).rejects.toMatchObject({
        code: "setup.attempt_conflict",
      });
    else await f.host.assertFreshAssignment(f.state, f.module);
  },
);

it("an empty replacement workspace cannot erase inherited known or uncertain register history", async () => {
  const f = await fixture(2, request.taxId, "production", false);
  await suite.db.archiveTo(join(f.state.venueDir, "venue.db"));
  const inspection = await f.host.resolution.inspectFirstSetupResolution();
  expect(inspection.database).toBe("no-venue-rows");
  const { createFirstSetupResolutionActions } = await import("./first-setup-resolution.js");
  const actions = createFirstSetupResolutionActions({
    stateDir: f.state.stateDir,
    venueDir: f.state.venueDir,
    host: f.host,
  });
  await expect(
    actions.startAgainFirstSetup({
      inspectionId: inspection.inspectionId,
      revision: f.state.revision,
      ownerGeneration: f.state.ownerGeneration,
      register: { kind: "no-current-master", confirmed: true },
    }),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await f.host.store.read()).toEqual(f.state);
});

it("original-password recovery and a current-master answer can retire an unused replacement without clearing older history", async () => {
  const f = await fixture(2, request.taxId, "production", false);
  await suite.db.archiveTo(join(f.state.venueDir, "venue.db"));
  const initial = await f.host.resolution.inspectFirstSetupResolution();
  const recovered = await f.host.owner.recoverFirstSetupOwner({
    inspectionId: initial.inspectionId,
    revision: f.state.revision,
    ownerGeneration: f.state.ownerGeneration,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: f.password,
  });
  const inspection = await f.host.resolution.inspectFirstSetupResolution();
  const owner = {
    attemptId: recovered.state.attemptId,
    revision: recovered.state.revision,
    ownerGeneration: recovered.state.ownerGeneration,
    capability: recovered.capability,
  };
  const { createFirstSetupResolutionActions } = await import("./first-setup-resolution.js");
  const actions = createFirstSetupResolutionActions({
    stateDir: f.state.stateDir,
    venueDir: f.state.venueDir,
    host: f.host,
  });
  const binding = await actions.startAgainFirstSetup({
    inspectionId: inspection.inspectionId,
    revision: owner.revision,
    ownerGeneration: owner.ownerGeneration,
    owner,
    register: {
      kind: "current-master",
      status: "Unknown",
      custodian: "Elena",
      reference: "d".repeat(64),
      consultedAt: "2026-10-16T04:00:00.000Z",
    },
  });
  expect(binding.selectionGeneration).toBe(2);
  expect(binding.anchorStateDir).toBe(f.old.stateDir);
  const { readFirstSetupRetirements } = await import("@waitron/provisioning");
  expect((await readFirstSetupRetirements(binding)).map((entry) => entry.record.register)).toEqual([
    {
      kind: "current-master",
      status: "Unknown",
      custodian: "Elena",
      reference: "d".repeat(64),
      consultedAt: "2026-10-16T04:00:00.000Z",
    },
    {
      kind: "current-master",
      status: "Unknown",
      custodian: "Elena",
      reference: "c".repeat(64),
      consultedAt: "2026-10-16T03:00:00.000Z",
    },
  ]);
});

function retainedCheckpoint(prefix: "S" | "P", floor = 42) {
  const scope = { taxpayerNif: request.taxId, softwareId: "W1", environment: "production" };
  return {
    format: "waitron-paper-register",
    version: 2,
    integrity: "owner-declared",
    registerId: "retired-public-register",
    scope,
    mode: "checkpoint",
    originals: [],
    revisions: [],
    checkpoint: {
      version: 2,
      kind: "declared-burn-checkpoint",
      checkpointId: "retired-checkpoint",
      scope,
      sHighWater: prefix === "S" ? floor : 0,
      pHighWater: prefix === "P" ? floor : 0,
      current: {
        currentRegisterConfirmed: true,
        noParallelPaperAllocation: true,
        confirmedAt: "2026-10-16T03:00:00.000Z",
      },
      completeHistoryUnavailable: true,
      burnAllPrior: true,
      createdAt: "2026-10-16T03:00:00.000Z",
    },
  };
}
it.each([2, 41, 42, 43])(
  "retained public register42 bounds a fresh setup serial %s independently of its saved candidate1",
  async (serial) => {
    const f = await fixture(serial, request.taxId, "production", true, undefined, {
      history: retainedCheckpoint("S"),
    });
    if (serial <= 42)
      await expect(f.host.assertFreshAssignment(f.state, f.module)).rejects.toMatchObject({
        code: "setup.attempt_conflict",
      });
    else await f.host.assertFreshAssignment(f.state, f.module);
  },
);
it("a retained paper P floor does not consume the next independent S name", async () => {
  const f = await fixture(2, request.taxId, "production", true, undefined, {
    history: retainedCheckpoint("P"),
  });
  await f.host.assertFreshAssignment(f.state, f.module);
});
it.each(["other-taxpayer", "other-environment"])(
  "retained public register facts preserve the %s namespace",
  async (which) => {
    const f = await fixture(
      2,
      which === "other-taxpayer" ? "89890001K" : request.taxId,
      which === "other-environment" ? "preproduction" : "production",
      true,
      undefined,
      { history: retainedCheckpoint("S") },
    );
    await f.host.assertFreshAssignment(f.state, f.module);
  },
);

it.each([2, 42, 43])(
  "retirement reads the real delivered public history42 before admitting setup serial %s",
  async (serial) => {
    const f = await fixture(serial, request.taxId, "production", true, undefined, {
      document: true,
    });
    if (serial <= 42)
      await expect(f.host.assertFreshAssignment(f.state, f.module)).rejects.toMatchObject({
        code: "setup.attempt_conflict",
      });
    else await f.host.assertFreshAssignment(f.state, f.module);
  },
);

it.each(["missing-manifest", "chunk", "binding", "digest"] as const)(
  "damaged retired document %s never supplies absence of a register",
  async (damage) => {
    const f = await fixture(43, request.taxId, "production", true, undefined, {
      document: true,
      damage,
    });
    await expect(f.host.assertFreshAssignment(f.state, f.module)).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
  },
);

it.each([2, 43])(
  "independent public-history file42 retained at retirement bounds fresh serial %s",
  async (serial) => {
    const f = await fixture(serial, request.taxId, "production", true, undefined, {
      history: retainedCheckpoint("S"),
      source: "outside",
    });
    if (serial <= 42)
      await expect(f.host.assertFreshAssignment(f.state, f.module)).rejects.toMatchObject({
        code: "setup.attempt_conflict",
      });
    else await f.host.assertFreshAssignment(f.state, f.module);
  },
);

it.each([
  null,
  { version: 1, modules: {}, history: [null] },
  { version: 1, modules: {}, history: [], extra: true },
])("invalid retained public evidence fails with a domain refusal %#", async (legacy) => {
  const f = await fixture(43, request.taxId, "production", true, undefined, { legacy });
  await expect(f.host.assertFreshAssignment(f.state, f.module)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});

it.each(["old", "fresh"])(
  "ordinary module preparation retains %s assignment IDs from every earlier abandoned attempt",
  async (which) => {
    const f = await fixture(43, request.taxId, "production", true, 1, { previousSerial: 42 });
    const previous = f.old.previous[0]!;
    const allocationId = (
      previous.frozen.modules.find((entry) => entry.module === f.module)!.request as {
        candidates: { allocationId: string }[];
      }
    ).candidates[0]!.allocationId;
    const binding = {
      module: f.module,
      action: "restore",
      eventId: randomUUID(),
      sourceId: "archive",
      targetNodeId: f.state.frozen.nodeId,
    };
    const preparation = f.host.modules.find((entry) => entry.name === f.module)!.operations!;
    await expect(
      withOperationAuthority(binding, "manager", (authority) =>
        preparation.prepare(
          {
            binding,
            authority,
            input: {
              allocation: {
                allocationId: which === "old" ? allocationId : randomUUID(),
                taxpayerNif: request.taxId,
                softwareId: "W1",
                environment: "production",
                installationIdentity: "P000043",
              },
              approval: {},
            },
          },
          async () => "must still need outside confirmation",
        ),
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: which === "old" ? "reservation_mismatch" : "outside_confirmation_missing" },
    });
  },
);

it.each(["replace", "remove"])(
  "a live outside history may %s without releasing its archived42 burn floor",
  async (change) => {
    for (const serial of [2, 43]) {
      const f = await fixture(serial, request.taxId, "production", true, undefined, {
        history: retainedCheckpoint("S"),
        source: "outside",
      });
      if (change === "replace")
        await writeFile(f.publicPath, JSON.stringify(retainedCheckpoint("P")));
      else await unlink(f.publicPath);
      if (serial <= 42)
        await expect(f.host.assertFreshAssignment(f.state, f.module)).rejects.toMatchObject({
          code: "setup.attempt_conflict",
        });
      else await f.host.assertFreshAssignment(f.state, f.module);
      expect(await f.host.store.read()).toEqual(f.state);
    }
  },
);
