import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS, stampDeployment } from "@waitron/db";
import { withNodeTransaction } from "@waitron/db";
import { setRecoveryKeyTx, NODE_MIGRATIONS } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashSecret } from "@waitron/identity";
import { readOperationAuthority } from "@waitron/module";
import { withRecoveryKeyAuthority } from "./operation-authentication.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
const binding = {
  module: "test-regime",
  action: "conflict-switch",
  eventId: "event-1",
  sourceId: "conflict-1",
  targetNodeId: "node-1",
};
const secret = "current-paper-key";
const verifier = hashSecret(secret);
const deps = {
  get db() {
    return suite.db;
  },
  get node() {
    return suite.node;
  },
  nodeId: binding.targetNodeId,
};
beforeEach(async () => {
  await stampDeployment(suite.db, "preproduction");
  await withNodeTransaction(suite.node, (tx) =>
    setRecoveryKeyTx(tx, binding.targetNodeId, verifier, "paper-1"),
  );
});

it("permits only a host-declared live action with key attribution and no account", async () => {
  let escaped: unknown;
  const result = await withRecoveryKeyAuthority(
    deps,
    binding,
    secret,
    async (authority, commit) => {
      escaped = authority;
      return commit(async () => readOperationAuthority(authority, binding));
    },
    ["conflict-switch"],
  );
  expect(result).toEqual({
    operatorId: { kind: "recovery-key", nodeId: "node-1", eventId: "event-1" },
  });
  expect(readOperationAuthority(escaped, binding)).toBeUndefined();
});

it.each([undefined, [], ["other-action"]])(
  "does not expand the default action list from request data: %j",
  async (allowed) => {
    let entered = false;
    await expect(
      withRecoveryKeyAuthority(
        deps,
        binding,
        secret,
        async () => {
          entered = true;
        },
        allowed,
      ),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    expect(entered).toBe(false);
  },
);

it.each([null, undefined, "", "wrong-key", { personId: "administrator", password: "password" }])(
  "refuses absent or invalid key %j before operation entry",
  async (key) => {
    let entered = false;
    await expect(
      withRecoveryKeyAuthority(
        deps,
        binding,
        key,
        async () => {
          entered = true;
        },
        ["conflict-switch"],
      ),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    expect(entered).toBe(false);
  },
);

it("rechecks a key replaced while the authenticated operation waits before commit", async () => {
  let committed = false;
  await expect(
    withRecoveryKeyAuthority(
      deps,
      binding,
      secret,
      async (_authority, commit) => {
        await withNodeTransaction(suite.node, (tx) =>
          setRecoveryKeyTx(tx, binding.targetNodeId, hashSecret("replacement-key"), "paper-2"),
        );
        return commit(async () => {
          committed = true;
        });
      },
      ["conflict-switch"],
    ),
  ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  expect(committed).toBe(false);
});

it("refuses an allowed live action addressed to a different node", async () => {
  await expect(
    withRecoveryKeyAuthority(
      deps,
      { ...binding, targetNodeId: "other-node" },
      secret,
      async () => "unexpected",
      ["conflict-switch"],
    ),
  ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
});
