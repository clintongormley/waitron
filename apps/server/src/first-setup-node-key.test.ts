import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CORE_MIGRATIONS,
  readBreakGlassKeyName,
  readBreakGlassVerifier,
  setBreakGlassVerifierTx,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { verifySecretAsync } from "@waitron/identity";
import { firstFiscalFixture, PASSWORD } from "../test/first-fiscal.js";
import { createFirstSetupNodeKeys } from "./first-setup-node-key.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
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
  return { ...f, keys, stage, options, path: join(f.stateDir, "first-setup-node-key.json") };
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
it("stages 192 random bits without installing or persisting the raw node key", async () => {
  const f = await fixture();
  const result = await f.stage();
  expect(result.key.nodeId).toBe(f.context.binding.targetNodeId);
  expect(Buffer.from(result.key.secret, "base64url")).toHaveLength(24);
  expect(result.key.name).toMatch(/^\d{4}-\d\d-\d\d · [34679ACDEFHJKMNPQRTUVWXY]{4}$/);
  expect(await readBreakGlassVerifier(suite.db, result.key.nodeId)).toBeNull();
  const persisted = await readFile(f.path, "utf8");
  expect(persisted).not.toContain(result.key.secret);
  expect(persisted).not.toContain(f.ownerAttempt.capability);
  expect(persisted).not.toContain(PASSWORD);
  const metadata = await f.keys.readStage(f.ownerAttempt);
  expect(await verifySecretAsync(result.key.secret, metadata.verifier)).toBe(true);
  expect(await readdir(f.stateDir)).toContain("first-setup-node-key.json");
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
    code: "setup.attempt_conflict",
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
it("installs the exact retained verifier once after commit and checks it on publication retry", async () => {
  const f = await fixture();
  const { key, stage } = await f.stage();
  const state = await committed(f);
  await f.keys.installStagedNodeKey(suite.db, state, stage);
  expect(await readBreakGlassKeyName(suite.db, key.nodeId)).toBe(key.name);
  expect(await readBreakGlassVerifier(suite.db, key.nodeId)).toBe(stage.verifier);
  expect(
    await verifySecretAsync(key.secret, (await readBreakGlassVerifier(suite.db, key.nodeId))!),
  ).toBe(true);
  await f.keys.installStagedNodeKey(suite.db, state, stage);
  expect(await readBreakGlassVerifier(suite.db, key.nodeId)).toBe(stage.verifier);
});
it.each([
  "before commit",
  "wrong node result",
  "wrong frozen request",
  "wrong stage",
  "existing verifier",
  "existing name",
])("refuses installation with %s", async (why) => {
  const f = await fixture();
  const { stage } = await f.stage();
  let state = why === "before commit" ? (await f.store.read())! : await committed(f);
  let supplied = structuredClone(stage);
  if (why === "wrong node result")
    state = { ...state, result: { venue: { nodeId: "other" }, modules: {} } };
  if (why === "wrong frozen request")
    state = { ...state, frozen: { ...state.frozen, sourceId: "other" } };
  if (why === "wrong stage") supplied = { ...stage, stageId: "other" };
  if (why.startsWith("existing"))
    await withTransaction(suite.db, (tx) =>
      setBreakGlassVerifierTx(
        tx,
        state.frozen.nodeId,
        why === "existing verifier" ? "other" : stage.verifier,
        why === "existing name" ? "other" : stage.name,
      ),
    );
  const before = await readBreakGlassVerifier(suite.db, state.frozen.nodeId);
  await expect(f.keys.installStagedNodeKey(suite.db, state, supplied)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  expect(await readBreakGlassVerifier(suite.db, state.frozen.nodeId)).toBe(before);
});
it.each(["extra secret", "wrong verifier", "wrong binding", "bad stage"])(
  "refuses corrupt staged metadata: %s",
  async (why) => {
    const f = await fixture();
    await f.stage();
    const saved = JSON.parse(await readFile(f.path, "utf8"));
    if (why === "extra secret") saved.secret = "must-never-be-stored";
    if (why === "wrong verifier") saved.verifier = "not-a-verifier";
    if (why === "wrong binding") saved.frozenDigest = "f".repeat(64);
    if (why === "bad stage") saved.stageId = "../other";
    await writeFile(f.path, JSON.stringify(saved));
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
  expect(await readBreakGlassVerifier(suite.db, current.frozen.nodeId)).toBeNull();
});
it("refuses an existing name without its verifier rather than overwriting half a pair", async () => {
  const { nodeRoles } = await import("@waitron/db");
  const f = await fixture(),
    { stage } = await f.stage(),
    state = await committed(f);
  await suite.db
    .insert(nodeRoles)
    .values({ nodeId: stage.nodeId, breakGlassKeyName: "older key", breakGlassVerifier: null });
  await expect(f.keys.installStagedNodeKey(suite.db, state, stage)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  expect(await readBreakGlassVerifier(suite.db, stage.nodeId)).toBeNull();
});
