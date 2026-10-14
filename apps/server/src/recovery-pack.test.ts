import { beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  readBreakGlassKeyName,
  setBreakGlassVerifierTx,
  stampDeployment,
} from "@waitron/db";
import { hashSecret } from "@waitron/identity";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import type { WaitronModule } from "@waitron/module";
import { nodeId, locationId } from "@waitron/shared";
import { mintBreakGlassSecret } from "./break-glass.js";
import { createRecoveryPack } from "./recovery-pack.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const node = {
  nodeId: nodeId("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
  locationId: locationId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
};
const now = new Date("2026-10-14T10:00:00.000Z");
const contribution = {
  ...fakeModule("test-regime"),
  backup: {
    recoveryPack: async () => ({ register: "signed-public-snapshot", blockId: "block-42" }),
  },
};
beforeEach(() => stampDeployment(suite.db, "preproduction"));

async function create(
  secret: unknown,
  modules: WaitronModule[] = [contribution],
  input: unknown = { block: "input" },
) {
  return createRecoveryPack(
    { db: suite.db, node, venueId: "venue-one", modules, now },
    { nodeRecoveryKey: secret, modules: { "test-regime": input } },
  );
}

it("downloads the named node key and module's public snapshot without any bucket settings", async () => {
  const secret = await mintBreakGlassSecret(suite.db, node.nodeId);
  const keyName = await readBreakGlassKeyName(suite.db, node.nodeId);
  expect(await create(secret)).toEqual({
    version: 1,
    kind: "node-recovery-pack",
    createdAt: "2026-10-14T10:00:00.000Z",
    nodeRecovery: { nodeId: node.nodeId, name: keyName, secret },
    modules: { "test-regime": { register: "signed-public-snapshot", blockId: "block-42" } },
    warnings: [
      "contains-node-recovery-key",
      "register-snapshot-may-be-stale",
      "retain-older-node-keys-for-older-backups",
    ],
  });
});

it("keeps the verifier and name unchanged when reprinting the pack", async () => {
  const secret = await mintBreakGlassSecret(suite.db, node.nodeId);
  const before = await suite.db.execute(sql`select * from node_roles`);
  expect(await create(secret)).toEqual(await create(secret));
  expect(await suite.db.execute(sql`select * from node_roles`)).toEqual(before);
});

it("marks the download as secret-bearing and its register as a possibly stale snapshot", async () => {
  const secret = await mintBreakGlassSecret(suite.db, node.nodeId);
  expect(await create(secret)).toMatchObject({
    warnings: [
      "contains-node-recovery-key",
      "register-snapshot-may-be-stale",
      "retain-older-node-keys-for-older-backups",
    ],
  });
});

it.each([undefined, null, "", "wrong-key"])(
  "refuses an unusable node credential %j",
  async (secret) => {
    await mintBreakGlassSecret(suite.db, node.nodeId);
    await expect(create(secret)).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  },
);

it("refuses a replaced node key without returning either secret", async () => {
  const old = await mintBreakGlassSecret(suite.db, node.nodeId);
  await mintBreakGlassSecret(suite.db, node.nodeId);
  await expect(create(old)).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
});

it("refuses a module without a public pack contribution", async () => {
  const secret = await mintBreakGlassSecret(suite.db, node.nodeId);
  await expect(create(secret, [{ ...contribution, backup: {} }])).rejects.toMatchObject({
    code: "recovery.pack_invalid",
    params: { reason: "module_unsupported" },
  });
});

it("refuses a missing contribution input rather than silently printing an incomplete register", async () => {
  const secret = await mintBreakGlassSecret(suite.db, node.nodeId);
  await expect(
    createRecoveryPack(
      { db: suite.db, node, venueId: "venue-one", modules: [contribution], now },
      { nodeRecoveryKey: secret, modules: {} },
    ),
  ).rejects.toMatchObject({
    code: "recovery.pack_invalid",
    params: { reason: "module_input_missing" },
  });
});

it("returns the module's refusal without rotating the key or exposing input", async () => {
  const secret = await mintBreakGlassSecret(suite.db, node.nodeId);
  const before = await suite.db.execute(sql`select * from node_roles`);
  const failing = {
    ...contribution,
    backup: {
      recoveryPack: async () => {
        throw new Error("snapshot refused");
      },
    },
  };
  await expect(create(secret, [failing])).rejects.toThrow("snapshot refused");
  expect(await suite.db.execute(sql`select * from node_roles`)).toEqual(before);
});

it("refuses a key replaced while a module is preparing the pack and rolls the replacement back", async () => {
  const secret = await mintBreakGlassSecret(suite.db, node.nodeId);
  const before = await suite.db.execute(sql`select * from node_roles`);
  const replacing: WaitronModule = {
    ...contribution,
    backup: {
      recoveryPack: async (tx) => {
        await setBreakGlassVerifierTx(
          tx,
          node.nodeId,
          hashSecret("replacement-secret"),
          "replacement-name",
        );
        return { register: "public-snapshot" };
      },
    },
  };
  await expect(create(secret, [replacing])).rejects.toMatchObject({
    code: "promotion.break_glass_invalid",
  });
  expect(await suite.db.execute(sql`select * from node_roles`)).toEqual(before);
});

it("refuses an unnamed historical verifier instead of naming a new key on reprint", async () => {
  const secret = await mintBreakGlassSecret(suite.db, node.nodeId);
  await suite.db.execute(
    sql`update node_roles set break_glass_key_name = null where node_id = ${node.nodeId}`,
  );
  await expect(create(secret)).rejects.toMatchObject({
    code: "recovery.pack_invalid",
    params: { reason: "key_name_missing" },
  });
});
