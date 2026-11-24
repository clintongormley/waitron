import { beforeEach, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  insertMasterKey,
  masterKeys,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { makeMasterKey, masterKeyCheckValue, sealingPublicKey } from "@waitron/credentials";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import type { WaitronModule } from "@waitron/module";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import { encodeMasterKeyCode, nodeId } from "@waitron/shared";
import { mintMasterKey } from "./testing/master-key.js";
import { createRecoveryPack } from "./recovery-pack.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS],
});
const mint = async () => (await mintMasterKey(suite.db)).secret;
const keyRows = () => suite.db.select().from(masterKeys).orderBy(masterKeys.number);
const node = {
  nodeId: nodeId("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
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
    { db: suite.db, nodeDb: suite.node, node, modules, now },
    { nodeRecoveryKey: secret, modules: { "test-regime": input } },
  );
}

it("downloads the named node key and module's public snapshot without any bucket settings", async () => {
  const { secret, name: keyName } = await mintMasterKey(suite.db);
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

it("keeps the master keys unchanged when reprinting the pack", async () => {
  const secret = await mint();
  const before = await keyRows();
  expect(await create(secret)).toEqual(await create(secret));
  expect(await keyRows()).toEqual(before);
});

it("marks the download as secret-bearing and its register as a possibly stale snapshot", async () => {
  const secret = await mint();
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
    await mint();
    await expect(create(secret)).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  },
);

it("refuses a replaced node key without returning either secret", async () => {
  const old = await mint();
  await mint();
  await expect(create(old)).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
});

it("refuses a module without a public pack contribution", async () => {
  const secret = await mint();
  await expect(create(secret, [{ ...contribution, backup: {} }])).rejects.toMatchObject({
    code: "recovery.pack_invalid",
    params: { reason: "module_unsupported" },
  });
});

it("refuses a missing contribution input rather than silently printing an incomplete register", async () => {
  const secret = await mint();
  await expect(
    createRecoveryPack(
      {
        db: suite.db,
        nodeDb: suite.node,
        node,
        modules: [contribution],
        now,
      },
      { nodeRecoveryKey: secret, modules: {} },
    ),
  ).rejects.toMatchObject({
    code: "recovery.pack_invalid",
    params: { reason: "module_input_missing" },
  });
});

it("returns the module's refusal without rotating the key or exposing input", async () => {
  const secret = await mint();
  const before = await keyRows();
  const failing = {
    ...contribution,
    backup: {
      recoveryPack: async () => {
        throw new Error("snapshot refused");
      },
    },
  };
  await expect(create(secret, [failing])).rejects.toThrow("snapshot refused");
  expect(await keyRows()).toEqual(before);
});

it("refuses a key replaced while a module is preparing the pack and rolls the replacement back", async () => {
  const secret = await mint();
  const before = await keyRows();
  const replacement = makeMasterKey();
  const replacing: WaitronModule = {
    ...contribution,
    backup: {
      recoveryPack: async (tx) => {
        await insertMasterKey(tx, {
          name: "replacement-name",
          checkValue: masterKeyCheckValue(replacement),
          publicKey: sealingPublicKey(replacement),
          madeAt: now,
          madeBy: null,
        });
        return { register: "public-snapshot" };
      },
    },
  };
  await expect(create(secret, [replacing])).rejects.toMatchObject({
    code: "promotion.break_glass_invalid",
  });
  expect(await keyRows()).toEqual(before);
});

it("refuses an unnamed master key instead of naming a new key on reprint", async () => {
  const bytes = makeMasterKey();
  await withTransaction(suite.db, (tx) =>
    insertMasterKey(tx, {
      name: "",
      checkValue: masterKeyCheckValue(bytes),
      publicKey: sealingPublicKey(bytes),
      madeAt: now,
      madeBy: null,
    }),
  );
  const secret = encodeMasterKeyCode(bytes);
  await expect(create(secret)).rejects.toMatchObject({
    code: "recovery.pack_invalid",
    params: { reason: "key_name_missing" },
  });
});
