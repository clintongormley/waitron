import { sql } from "drizzle-orm";
import { readSetupFlowRecord, updateSetupFlowSection } from "@waitron/provisioning";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CORE_MIGRATIONS, readCurrentMasterKey, stampDeployment } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import { firstFiscalFixture, PASSWORD } from "../test/first-fiscal.js";
import { createFirstSetupNodeKeys } from "./first-setup-node-key.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS],
});
const fixtures: Awaited<ReturnType<typeof firstFiscalFixture>>[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.dispose()));
});
beforeEach(async () => {
  await stampDeployment(suite.db, "preproduction");
});
async function fixture() {
  const f = await firstFiscalFixture();
  fixtures.push(f);
  const options = { ...f };
  const keys = createFirstSetupNodeKeys(options);
  const stage = async () =>
    keys.stageInitialNodeKey(
      f.ownerAttempt,
      await f.owner.reconfirm(f.ownerAttempt, PASSWORD, "block-use"),
    );
  return { ...f, keys, stage, options, path: join(f.stateDir, "flows/setup/record.json") };
}
async function committed(f: Awaited<ReturnType<typeof fixture>>) {
  let state = (await f.store.read())!;
  state = await f.store.update(state.frozen.attemptId, state.revision, {
    kind: "activation-started",
  });
  return f.store.update(state.frozen.attemptId, state.revision, {
    kind: "committed",
    result: { venue: { nodeId: state.frozen.nodeId }, modules: {} },
  });
}
it("stages the master key's public facts and no box key, without installing or persisting the master key", async () => {
  const f = await fixture();
  const result = await f.stage();
  expect(Object.keys(result).sort()).toEqual(["masterKey", "masterKeyName", "stage"]);
  expect(result.stage.nodeId).toBe(f.context.binding.targetNodeId);
  expect(result.stage.masterKeyName).toBe(result.masterKeyName);
  expect(result.stage).not.toHaveProperty("name");
  expect(result.stage).not.toHaveProperty("verifier");
  expect(await readCurrentMasterKey(suite.db)).toBeNull();
  const persisted = await readFile(f.path, "utf8");
  expect(persisted).not.toContain(result.masterKey);
  expect(persisted).not.toContain(f.ownerAttempt.capability);
  expect(persisted).not.toContain(PASSWORD);
  expect((await readSetupFlowRecord(f.stateDir))?.nodeKey).toEqual(result.stage);
});
it("same-visit delivery returns exactly the same key and stage", async () => {
  const f = await fixture();
  const first = await f.stage();
  expect(await f.stage()).toEqual(first);
  await expect(f.keys.stageInitialNodeKey(f.ownerAttempt, "x".repeat(43))).rejects.toMatchObject({
    code: "setup.owner_required",
  });
});
it("a restart keeps only the stage and refuses silent reminting", async () => {
  const f = await fixture();
  const first = await f.stage();
  const bytes = await readFile(f.path, "utf8");
  const restarted = createFirstSetupNodeKeys(f.options);
  expect(await restarted.readStage(f.ownerAttempt)).toEqual(first.stage);
  const nonce = await f.owner.reconfirm(f.ownerAttempt, PASSWORD, "block-use");
  await expect(restarted.stageInitialNodeKey(f.ownerAttempt, nonce)).rejects.toMatchObject({
    code: "setup.node_key_lost",
  });
  expect(await readFile(f.path, "utf8")).toBe(bytes);
});
it.each(["wrong owner", "wrong purpose", "reused grant"])(
  "refuses staging with %s",
  async (why) => {
    const f = await fixture();
    const nonce = await f.owner.reconfirm(
      f.ownerAttempt,
      PASSWORD,
      why === "wrong purpose" ? "activation" : "block-use",
    );
    if (why === "reused grant") await f.keys.stageInitialNodeKey(f.ownerAttempt, nonce);
    await expect(
      f.keys.stageInitialNodeKey(
        why === "wrong owner"
          ? { ...f.ownerAttempt, ownerGeneration: f.ownerAttempt.ownerGeneration + 1 }
          : f.ownerAttempt,
        nonce,
      ),
    ).rejects.toMatchObject({ code: "setup.owner_required" });
  },
);
it("installs the staged master key once after commit, nothing in node.db, and a publication retry writes nothing", async () => {
  const f = await fixture();
  const { stage } = await f.stage();
  const state = await committed(f);
  await f.keys.installStagedNodeKey(suite.db, state, stage);
  expect(suite.node.all(sql`select * from box`)).toEqual([]);
  const installed = await readCurrentMasterKey(suite.db);
  expect(installed).toMatchObject({ number: 1, name: stage.masterKeyName });
  await f.keys.installStagedNodeKey(suite.db, state, stage);
  expect(await readCurrentMasterKey(suite.db)).toEqual(installed);
});
it.each(["before commit", "wrong node result", "wrong frozen request", "wrong stage"])(
  "refuses installation with %s",
  async (why) => {
    const f = await fixture();
    const { stage } = await f.stage();
    let state = why === "before commit" ? (await f.store.read())! : await committed(f);
    let supplied = structuredClone(stage);
    if (why === "wrong node result")
      state = { ...state, result: { venue: { nodeId: "other" }, modules: {} } };
    if (why === "wrong frozen request")
      state = { ...state, frozen: { ...state.frozen, sourceId: "other" } };
    if (why === "wrong stage") supplied = { ...stage, stageId: "other" };
    const before = suite.node.all(sql`select * from box`);
    await expect(f.keys.installStagedNodeKey(suite.db, state, supplied)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    expect(suite.node.all(sql`select * from box`)).toEqual(before);
    expect(await readCurrentMasterKey(suite.db)).toBeNull();
  },
);
it.each(["extra secret", "a box-key verifier", "wrong binding", "bad stage"])(
  "refuses corrupt staged metadata: %s",
  async (why) => {
    const f = await fixture();
    await f.stage();
    const saved = structuredClone((await readSetupFlowRecord(f.stateDir))!.nodeKey) as Record<
      string,
      unknown
    >;
    if (why === "extra secret") saved.secret = "must-never-be-stored";
    if (why === "a box-key verifier") saved.verifier = `scrypt$${"a".repeat(32)}$${"b".repeat(64)}`;
    if (why === "wrong binding") saved.frozenDigest = "f".repeat(64);
    if (why === "bad stage") saved.stageId = "../other";
    await updateSetupFlowSection(f.stateDir, "nodeKey", () => saved);
    await expect(f.keys.readStage(f.ownerAttempt)).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
  },
);
it("a supplied committed marker cannot replace the exact retained checked state", async () => {
  const f = await fixture();
  const { stage } = await f.stage();
  const current = (await f.store.read())!;
  const forged = {
    ...current,
    status: "committed" as const,
    result: { venue: { nodeId: current.frozen.nodeId }, modules: {} },
  };
  await expect(f.keys.installStagedNodeKey(suite.db, forged, stage)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  expect(suite.node.all(sql`select * from box`)).toEqual([]);
});
