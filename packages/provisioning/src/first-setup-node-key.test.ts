import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, nodeRoles, stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { verifySecretAsync } from "@waitron/identity";
import { request, PASSWORD } from "../test/first-setup-request.js";
import { createFirstSetupOwner } from "./first-setup-owner.js";
import {
  createFirstSetupCoordinator,
  createFirstSetupStore,
  type FirstSetupFrozen,
} from "./first-setup-state.js";
import { createFirstSetupNodeKeys, readFirstSetupStagedKey } from "./first-setup-node-key.js";

const database = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(stage = true) {
  const root = await mkdtemp(join(tmpdir(), "first-key-boundary-"));
  roots.push(root);
  const coordinator = createFirstSetupCoordinator();
  const stateDir = join(root, "state"),
    venueDir = join(root, "venue");
  const store = createFirstSetupStore({ stateDir, venueDir, coordinator });
  const options = {
    stateDir,
    store,
    coordinator,
    bootId: "key-boundary-boot",
    freeze: async (
      venue: FirstSetupFrozen["request"],
      environment: FirstSetupFrozen["environment"],
      ids: Pick<FirstSetupFrozen, "attemptId" | "nodeId" | "administratorId">,
    ) => ({
      ...ids,
      sourceId: `first-setup:${ids.attemptId}`,
      request: venue,
      environment,
      modules: [],
    }),
  };
  const owner = createFirstSetupOwner(options);
  const nonce = randomBytes(32).toString("base64url");
  const claim = await owner.claimFirstSetup({ environment: "preproduction", request }, nonce);
  const access = { ...claim.state, capability: claim.capability };
  const keys = createFirstSetupNodeKeys({ ...options, owner });
  const grant = () => owner.reconfirm(access, PASSWORD, "block-use");
  const staged = stage ? await keys.stageInitialNodeKey(access, await grant()) : undefined;
  return {
    options,
    owner,
    access,
    keys,
    store,
    coordinator,
    grant,
    nonce,
    staged,
    path: join(stateDir, "first-setup-node-key.json"),
    async committed(result: unknown = { venue: { nodeId: access.nodeId } }) {
      let state = (await store.read())!;
      for (const change of [
        { kind: "consumption-intent" },
        { kind: "activation-started" },
        { kind: "committed", result },
      ] as const)
        state = await store.update(access.attemptId, state.revision, change);
      access.revision = state.revision;
      return state;
    },
  };
}

it("retains the same delivered key on a reconfirmed repeat without persisting its secret", async () => {
  const f = await fixture();
  const before = await readFile(f.path);
  const token = await f.grant();
  const repeated = await f.coordinator.run((hold) =>
    f.keys.stageInitialNodeKey(f.access, token, hold),
  );
  expect(repeated).toEqual(f.staged);
  expect(await readFile(f.path)).toEqual(before);
  expect(before.toString()).not.toContain(f.staged!.key.secret);
  expect(await verifySecretAsync(f.staged!.key.secret, repeated.stage.verifier)).toBe(true);
  expect(await verifySecretAsync("another secret", repeated.stage.verifier)).toBe(false);
  repeated.key.secret = "changed caller copy";
  expect(await f.keys.stageInitialNodeKey(f.access, await f.grant())).toEqual(f.staged);
});

it.each([
  ["non-object", null],
  ["array", []],
  ["version", { version: 2 }],
  ["extra field", { extra: true }],
  ["non-text stage", { stageId: 42 }],
  ["stage UUID version", { stageId: "12345678-1234-1234-a123-123456789abc" }],
  ["attempt", { attemptId: "another-attempt" }],
  ["node", { nodeId: "another-node" }],
  ["frozen digest", { frozenDigest: "0".repeat(64) }],
  ["non-text name", { name: 42 }],
  ["ambiguous name", { name: "2026-10-16 · OI10" }],
  ["name length", { name: "2026-10-16 · ABC" }],
  ["non-text verifier", { verifier: 42 }],
  ["verifier algorithm", { verifier: "plaintext" }],
  ["verifier salt", { verifier: `scrypt$${"a".repeat(30)}$${"b".repeat(64)}` }],
  ["verifier digest", { verifier: `scrypt$${"a".repeat(32)}$${"b".repeat(62)}` }],
] as const)(
  "refuses a staged key with %s without changing the retained key",
  async (_label, mutation) => {
    const f = await fixture();
    const state = (await f.store.read())!;
    const before = await readFile(f.path);
    const invalid =
      mutation === null || Array.isArray(mutation) ? mutation : { ...f.staged!.stage, ...mutation };
    expect(() => readFirstSetupStagedKey(invalid, state)).toThrowError(
      expect.objectContaining({ code: "setup.attempt_invalid" }),
    );
    expect(await readFile(f.path)).toEqual(before);
  },
);

it.each(["version", "stageId", "attemptId", "nodeId", "frozenDigest", "name", "verifier"] as const)(
  "refuses a staged key missing %s",
  async (field) => {
    const f = await fixture();
    const invalid: Record<string, unknown> = { ...f.staged!.stage };
    delete invalid[field];
    const state = (await f.store.read())!;
    expect(() => readFirstSetupStagedKey(invalid, state)).toThrowError(
      expect.objectContaining({ code: "setup.attempt_invalid" }),
    );
  },
);

it("refuses to read a key that has not been staged", async () => {
  const f = await fixture(false);
  await expect(f.keys.readStage(f.access)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
});

it("refuses to recreate a delivered secret after its process-local copy is lost", async () => {
  const f = await fixture();
  const before = await readFile(f.path);
  const restarted = createFirstSetupNodeKeys({ ...f.options, owner: f.owner });
  await expect(restarted.stageInitialNodeKey(f.access, await f.grant())).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await readFile(f.path)).toEqual(before);
});

it("refuses a replaced but well-formed stage instead of returning the old transient secret", async () => {
  const f = await fixture();
  const changed = { ...f.staged!.stage, stageId: randomUUID() };
  await writeFile(f.path, JSON.stringify(changed));
  await expect(f.keys.stageInitialNodeKey(f.access, await f.grant())).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await f.keys.readStage(f.access)).toEqual(changed);
});

it("a resumed owner cannot retrieve the preceding owner's transient secret", async () => {
  const f = await fixture();
  const resumed = await f.owner.resumeFirstSetup(f.nonce, { password: PASSWORD });
  const access = { ...resumed.state, capability: resumed.capability };
  const before = await readFile(f.path);
  await expect(
    f.keys.stageInitialNodeKey(access, await f.owner.reconfirm(access, PASSWORD, "block-use")),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readFile(f.path)).toEqual(before);
});

it("a completed activation cannot stage another key", async () => {
  const f = await fixture();
  await f.committed();
  const before = await readFile(f.path);
  await expect(f.keys.stageInitialNodeKey(f.access, await f.grant())).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await readFile(f.path)).toEqual(before);
});

it.each(["uncommitted", "missing result", "different node"])(
  "refuses verifier installation for %s and leaves role storage empty",
  async (part) => {
    const f = await fixture();
    const state =
      part === "uncommitted"
        ? (await f.store.read())!
        : await f.committed(part === "missing result" ? null : { venue: { nodeId: randomUUID() } });
    await stampDeployment(database.db, "preproduction");
    await expect(
      f.keys.installStagedNodeKey(database.db, state, f.staged!.stage),
    ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
    expect(await database.db.select().from(nodeRoles)).toEqual([]);
  },
);

it.each(["verifier", "name", "both"])(
  "refuses to replace an existing different %s during publication",
  async (part) => {
    const f = await fixture();
    const state = await f.committed();
    const stage = f.staged!.stage;
    await stampDeployment(database.db, "preproduction");
    await withTransaction(database.db, async (tx) => {
      await tx.insert(nodeRoles).values({
        nodeId: stage.nodeId,
        breakGlassVerifier: part === "name" ? stage.verifier : "another-verifier",
        breakGlassKeyName: part === "verifier" ? stage.name : "another-name",
      });
    });
    const before = await database.db.select().from(nodeRoles);
    await expect(f.keys.installStagedNodeKey(database.db, state, stage)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    expect(await database.db.select().from(nodeRoles)).toEqual(before);
  },
);

it.each(["stale state", "supplied stage", "stored stage", "changed frozen request"])(
  "refuses installation from %s without writing a verifier",
  async (part) => {
    const f = await fixture();
    const state = await f.committed();
    const stage = { ...f.staged!.stage };
    if (part === "stale state") state.revision++;
    else if (part === "supplied stage")
      stage.name = stage.name.slice(0, -1) + (stage.name.endsWith("A") ? "C" : "A");
    else if (part === "stored stage")
      await writeFile(f.path, JSON.stringify({ ...stage, stageId: randomUUID() }));
    else state.frozen.request.legalName = "Another business";
    const retained = await readFile(f.path);
    await expect(f.keys.installStagedNodeKey(database.db, state, stage)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    expect(await database.db.select().from(nodeRoles)).toEqual([]);
    expect(await readFile(f.path)).toEqual(retained);
  },
);

it("installs the delivered verifier once and preserves it on exact publication retry", async () => {
  const f = await fixture();
  const state = await f.committed();
  await stampDeployment(database.db, "preproduction");
  await f.keys.installStagedNodeKey(database.db, state, f.staged!.stage);
  const before = await database.db.select().from(nodeRoles);
  expect(before).toMatchObject([
    {
      nodeId: state.frozen.nodeId,
      breakGlassVerifier: f.staged!.stage.verifier,
      breakGlassKeyName: f.staged!.stage.name,
    },
  ]);
  await f.coordinator.run((hold) =>
    f.keys.installStagedNodeKey(database.db, state, f.staged!.stage, hold),
  );
  expect(await database.db.select().from(nodeRoles)).toEqual(before);
});

it("reissues a lost unfinished key only after a separate password confirmation, keeping the attempt intact", async () => {
  const f = await fixture();
  const before = await f.store.read();
  const original = f.staged!;
  const restarted = createFirstSetupNodeKeys({ ...f.options, owner: f.owner });
  const proof = await f.owner.reconfirm(f.access, PASSWORD, "node-key-reissue");
  const replacement = await restarted.reissueInitialNodeKey(f.access, proof);
  expect(replacement.stage.stageId).not.toBe(original.stage.stageId);
  expect(replacement.key.secret).not.toBe(original.key.secret);
  expect(replacement.stage.name).not.toBe(original.stage.name);
  expect(replacement.stage.nodeId).toBe(original.stage.nodeId);
  expect(replacement.stage.frozenDigest).toBe(original.stage.frozenDigest);
  expect(await verifySecretAsync(replacement.key.secret, replacement.stage.verifier)).toBe(true);
  expect(await verifySecretAsync(original.key.secret, replacement.stage.verifier)).toBe(false);
  expect(await verifySecretAsync(replacement.key.secret, original.stage.verifier)).toBe(false);
  expect(await verifySecretAsync(original.key.secret, original.stage.verifier)).toBe(true);
  expect(await f.store.read()).toEqual(before);
  expect(JSON.parse(await readFile(f.path, "utf8"))).toEqual(replacement.stage);
  expect(await readFile(f.path, "utf8")).not.toContain(replacement.key.secret);
  expect(await restarted.stageInitialNodeKey(f.access, await f.grant())).toEqual(replacement);
});

it.each(["block-use", "activation"] as const)(
  "refuses a %s grant for reissue without replacing the staged key",
  async (purpose) => {
    const f = await fixture();
    const bytes = await readFile(f.path);
    await expect(
      f.keys.reissueInitialNodeKey(f.access, await f.owner.reconfirm(f.access, PASSWORD, purpose)),
    ).rejects.toMatchObject({ code: "setup.owner_required" });
    expect(await readFile(f.path)).toEqual(bytes);
  },
);

it("refuses to reuse reissue authority and retains the first replacement", async () => {
  const f = await fixture();
  const proof = await f.owner.reconfirm(f.access, PASSWORD, "node-key-reissue");
  await f.keys.reissueInitialNodeKey(f.access, proof);
  const bytes = await readFile(f.path);
  await expect(f.keys.reissueInitialNodeKey(f.access, proof)).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  expect(await readFile(f.path)).toEqual(bytes);
});

it("refuses unfinished-key reissue once activation may have started", async () => {
  const f = await fixture();
  let state = (await f.store.read())!;
  state = await f.store.update(f.access.attemptId, state.revision, { kind: "consumption-intent" });
  state = await f.store.update(f.access.attemptId, state.revision, { kind: "activation-started" });
  f.access.revision = state.revision;
  const before = await readFile(f.path);
  await expect(
    f.keys.reissueInitialNodeKey(
      f.access,
      await f.owner.reconfirm(f.access, PASSWORD, "node-key-reissue"),
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readFile(f.path)).toEqual(before);
  expect(await f.store.read()).toEqual(state);
});

it("requires an existing valid stage before reissue", async () => {
  const f = await fixture(false);
  await expect(
    f.keys.reissueInitialNodeKey(
      f.access,
      await f.owner.reconfirm(f.access, PASSWORD, "node-key-reissue"),
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("throttles repeated wrong reissue passwords without changing the retained key", async () => {
  const f = await fixture();
  const before = await readFile(f.path);
  for (let attempt = 0; attempt < 4; attempt++) {
    await expect(
      f.owner.reconfirm(f.access, "wrong password", "node-key-reissue"),
    ).rejects.toMatchObject({ code: "setup.owner_required" });
  }
  await expect(f.owner.reconfirm(f.access, PASSWORD, "node-key-reissue")).rejects.toMatchObject({
    code: "password.throttled",
  });
  expect(await readFile(f.path)).toEqual(before);
});

it("refuses expired reissue authority without replacing the stage", async () => {
  const f = await fixture();
  const before = await readFile(f.path);
  vi.useFakeTimers({ toFake: ["performance"] });
  try {
    const proof = await f.owner.reconfirm(f.access, PASSWORD, "node-key-reissue");
    vi.advanceTimersByTime(300001);
    await expect(f.keys.reissueInitialNodeKey(f.access, proof)).rejects.toMatchObject({
      code: "setup.owner_required",
    });
    expect(await readFile(f.path)).toEqual(before);
  } finally {
    vi.useRealTimers();
  }
});

it("a password-resumed owner can replace the lost key without retrieving the preceding raw key", async () => {
  const f = await fixture();
  const resumed = await f.owner.resumeFirstSetup(f.nonce, { password: PASSWORD });
  const access = { ...resumed.state, capability: resumed.capability };
  const before = await f.store.read();
  const replacement = await f.keys.reissueInitialNodeKey(
    access,
    await f.owner.reconfirm(access, PASSWORD, "node-key-reissue"),
  );
  expect(replacement.stage.stageId).not.toBe(f.staged!.stage.stageId);
  expect(await f.store.read()).toEqual(before);
  expect(
    await f.keys.stageInitialNodeKey(
      access,
      await f.owner.reconfirm(access, PASSWORD, "block-use"),
    ),
  ).toEqual(replacement);
  await expect(f.keys.readStage(f.access)).rejects.toMatchObject({ code: "setup.owner_required" });
});

it.each(["committed", "publication"] as const)(
  "refuses unfinished-key reissue for %s state",
  async (status) => {
    const f = await fixture();
    let state = await f.committed();
    if (status === "publication") {
      state = await f.store.update(f.access.attemptId, state.revision, { kind: "publication" });
      f.access.revision = state.revision;
    }
    const before = await readFile(f.path);
    await expect(
      f.keys.reissueInitialNodeKey(
        f.access,
        await f.owner.reconfirm(f.access, PASSWORD, "node-key-reissue"),
      ),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(await readFile(f.path)).toEqual(before);
    expect(await f.store.read()).toEqual(state);
  },
);
