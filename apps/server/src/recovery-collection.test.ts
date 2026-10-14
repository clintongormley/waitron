import { beforeEach, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  nodeRoles,
  readBreakGlassVerifier,
  setBreakGlassVerifierTx,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashSecret, IDENTITY_MIGRATIONS, managementSessions, persons } from "@waitron/identity";
import { readOperationAuthority, type OperationAuthority } from "@waitron/module";
import { mintBreakGlassSecret } from "./break-glass.js";
import { withRecoveryKeyOperation } from "./operation-authentication.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const binding = {
  module: "test-regime",
  action: "restore",
  eventId: "recovery-collection",
  sourceId: "archive-collection",
  targetNodeId: NODE,
};
let secret: string;

beforeEach(async () => {
  await stampDeployment(suite.db, "preproduction");
  secret = await mintBreakGlassSecret(suite.db, NODE);
});

it("collects with scoped key authority before the local transaction and still creates no account", async () => {
  let collected = false;
  let authorityAfter: unknown;
  const result = await withRecoveryKeyOperation(
    { db: suite.db, nodeId: NODE },
    binding,
    secret,
    async (_tx, authority) => {
      expect(collected).toBe(true);
      expect(readOperationAuthority(authority, binding)?.operatorId).toEqual({
        kind: "recovery-key",
        nodeId: NODE,
        eventId: "recovery-collection",
      });
      return "committed";
    },
    async (authority, commit) => {
      collected = true;
      authorityAfter = authority;
      expect(readOperationAuthority(authority, binding)?.operatorId).toEqual({
        kind: "recovery-key",
        nodeId: NODE,
        eventId: "recovery-collection",
      });
      await withTransaction(suite.db, async (tx) => {
        await tx.update(nodeRoles).set({ breakGlassKeyName: "collection writer" });
      });
      return commit();
    },
  );
  expect(result).toBe("committed");
  expect(readOperationAuthority(authorityAfter, binding)).toBeUndefined();
  expect(await suite.db.select().from(persons)).toEqual([]);
  expect(await suite.db.select().from(managementSessions)).toEqual([]);
});

it("refuses a changed key after outside collection and before entering the local operation", async () => {
  let entered = false;
  let consumedOutside = false;
  await expect(
    withRecoveryKeyOperation(
      { db: suite.db, nodeId: NODE },
      binding,
      secret,
      async () => {
        entered = true;
      },
      async (_authority, commit) => {
        consumedOutside = true;
        await withTransaction(suite.db, (tx) =>
          setBreakGlassVerifierTx(tx, NODE, hashSecret("replacement")),
        );
        return commit();
      },
    ),
  ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  expect(consumedOutside).toBe(true);
  expect(entered).toBe(false);
});

it("outside collection failure enters no local operation and revokes its authority", async () => {
  let entered = false;
  let captured: OperationAuthority | undefined;
  const verifier = await readBreakGlassVerifier(suite.db, NODE);
  const failure = new Error("outside evidence unavailable");
  await expect(
    withRecoveryKeyOperation(
      { db: suite.db, nodeId: NODE },
      binding,
      secret,
      async () => {
        entered = true;
      },
      async (authority) => {
        captured = authority;
        throw failure;
      },
    ),
  ).rejects.toBe(failure);
  expect(entered).toBe(false);
  expect(readOperationAuthority(captured, binding)).toBeUndefined();
  expect(await readBreakGlassVerifier(suite.db, NODE)).toBe(verifier);
});

it("a captured commit cannot write after the collection callback returns", async () => {
  let captured!: () => Promise<string>;
  await withRecoveryKeyOperation(
    { db: suite.db, nodeId: NODE },
    binding,
    secret,
    async (tx) => {
      await tx.update(nodeRoles).set({ breakGlassKeyName: "late write" });
      return "committed";
    },
    async (_authority, commit) => {
      captured = commit;
      return "not committed";
    },
  );
  const before = await suite.db.select().from(nodeRoles);
  await expect(captured()).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  expect(await suite.db.select().from(nodeRoles)).toEqual(before);
});

it("a transaction queued by collection refuses after its key authority expires", async () => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signal!: () => void;
  const locked = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const blocker = withTransaction(suite.db, async () => {
    signal();
    await hold;
  });
  await locked;
  let pending!: Promise<string>;
  let entered = false;
  await withRecoveryKeyOperation(
    { db: suite.db, nodeId: NODE },
    binding,
    secret,
    async () => {
      entered = true;
      return "committed";
    },
    async (_authority, commit) => {
      pending = commit();
      return "not awaited";
    },
  );
  const rejected = expect(pending).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  release();
  await blocker;
  await rejected;
  expect(entered).toBe(false);
});

it("local failure keeps the outside consumed mark and rolls back local changes", async () => {
  const before = await suite.db.select().from(nodeRoles);
  const failure = new Error("local operation refused");
  let consumedOutside = false;
  let held: unknown;
  await expect(
    withRecoveryKeyOperation(
      { db: suite.db, nodeId: NODE },
      binding,
      secret,
      async (tx) => {
        await tx.update(nodeRoles).set({ breakGlassKeyName: "failed write" });
        throw failure;
      },
      async (authority, commit) => {
        held = authority;
        consumedOutside = true;
        return commit();
      },
    ),
  ).rejects.toBe(failure);
  expect(consumedOutside).toBe(true);
  expect(await suite.db.select().from(nodeRoles)).toEqual(before);
  expect(readOperationAuthority(held, binding)).toBeUndefined();
});

it("rolls back local writes if collection returns before its in-flight transaction finishes", async () => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signal!: () => void;
  const written = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const before = await suite.db.select().from(nodeRoles);
  let pending!: Promise<string>;
  await withRecoveryKeyOperation(
    { db: suite.db, nodeId: NODE },
    binding,
    secret,
    async (tx) => {
      await tx.update(nodeRoles).set({ breakGlassKeyName: "uncommitted" });
      signal();
      await hold;
      return "committed";
    },
    async (_authority, commit) => {
      pending = commit();
      await written;
      return "not awaited";
    },
  );
  const rejected = expect(pending).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  release();
  await rejected;
  expect(await suite.db.select().from(nodeRoles)).toEqual(before);
});

it.each(["wrong", ""])("invalid keys never start outside consumption %#", async (invalid) => {
  let collected = false;
  await expect(
    withRecoveryKeyOperation(
      { db: suite.db, nodeId: NODE },
      binding,
      invalid,
      async () => undefined,
      async (_authority, commit) => {
        collected = true;
        return commit();
      },
    ),
  ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  expect(collected).toBe(false);
});
