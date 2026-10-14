import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  readBreakGlassVerifier,
  setBreakGlassVerifierTx,
  stampDeployment,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashSecret, IDENTITY_MIGRATIONS, managementSessions, persons } from "@waitron/identity";
import {
  readOperationAuthority,
  type OperationAuthority,
  type OperationBinding,
} from "@waitron/module";
import { mintBreakGlassSecret } from "./break-glass.js";
import * as operations from "./operation-authentication.js";
import { whileChangingOnLockRequest, writerBesideRequest } from "./testing/watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const binding = {
  module: "test-regime",
  action: "promote",
  eventId: "takeover-1",
  sourceId: "archive-1",
  targetNodeId: NODE,
};
let key: string;

beforeEach(async () => {
  await stampDeployment(suite.db, "preproduction");
  key = await mintBreakGlassSecret(suite.db, NODE);
});

function perform<T>(
  run: (authority: OperationAuthority) => Promise<T>,
  secret: unknown = key,
  scope: OperationBinding = binding,
) {
  return operations.withRecoveryKeyOperation(
    { db: suite.db, nodeId: NODE },
    scope,
    secret,
    (_tx, authority) => run(authority),
  );
}

describe("scoped recovery-key authority", () => {
  it.each(["promote", "restore", "re-register"])(
    "authorises %s with only the current node key, creates no session and revokes authority after use",
    async (action) => {
      const scope = { ...binding, action };
      let held: unknown;
      const verifier = await readBreakGlassVerifier(suite.db, NODE);
      const result = await perform(
        async (authority) => {
          held = authority;
          expect(readOperationAuthority(authority, scope)).toEqual({
            operatorId: { kind: "recovery-key", nodeId: NODE, eventId: "takeover-1" },
          });
          expect(await suite.db.select().from(persons)).toEqual([]);
          expect(await suite.db.select().from(managementSessions)).toEqual([]);
          return "committed";
        },
        key,
        scope,
      );
      expect(result).toBe("committed");
      expect(readOperationAuthority(held, scope)).toBeUndefined();
      expect(await readBreakGlassVerifier(suite.db, NODE)).toBe(verifier);
    },
  );

  it.each([undefined, null, 123, {}, "", "wrong"])(
    "refuses an invalid key %# without entering the operation",
    async (secret) => {
      let entered = false;
      await expect(
        operations.withRecoveryKeyOperation(
          { db: suite.db, nodeId: NODE },
          binding,
          secret,
          async () => {
            entered = true;
          },
        ),
      ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
      expect(entered).toBe(false);
    },
  );

  it.each([
    { ...binding, targetNodeId: "other-node" },
    { ...binding, action: "setup" },
    { ...binding, action: "mirror.create" },
  ])("refuses a key for another target or a non-recovery action %#", async (scope) => {
    let entered = false;
    await expect(
      perform(
        async () => {
          entered = true;
        },
        key,
        scope,
      ),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    expect(entered).toBe(false);
  });

  it("refuses a key replaced while authentication waits for the write lock", async () => {
    let entered = false;
    await expect(
      whileChangingOnLockRequest(
        suite.db,
        async (tx) => {
          await setBreakGlassVerifierTx(tx, NODE, hashSecret("replacement"));
        },
        () =>
          perform(async () => {
            entered = true;
          }),
      ),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    expect(entered).toBe(false);
  });

  it("derives outside the write lock and rolls back a refused operation", async () => {
    const original = await readBreakGlassVerifier(suite.db, NODE);
    let held: unknown;
    const observed = await writerBesideRequest(suite.db, () =>
      operations.withRecoveryKeyOperation(
        { db: suite.db, nodeId: NODE },
        binding,
        key,
        async (tx, authority) => {
          held = authority;
          expect(await readBreakGlassVerifier(tx, NODE)).toBe(original);
          return "committed";
        },
      ),
    );
    expect(observed.result).toBe("committed");
    expect(observed.outside).toBe(1);
    expect(observed.order).not.toContain("key derived in a transaction");
    expect(readOperationAuthority(held, binding)).toBeUndefined();
    await expect(
      operations.withRecoveryKeyOperation(
        { db: suite.db, nodeId: NODE },
        binding,
        key,
        async (tx, authority) => {
          held = authority;
          await tx.insert(persons).values({ displayName: "Uncommitted", role: "staff" });
          throw new Error("write refused");
        },
      ),
    ).rejects.toThrow("write refused");
    expect(await suite.db.select().from(persons)).toEqual([]);
    expect(readOperationAuthority(held, binding)).toBeUndefined();
  });

  it("keeps a snapshotted scope while a caller changes its input during authentication", async () => {
    const scope = { ...binding };
    await whileChangingOnLockRequest(
      suite.db,
      async () => {
        scope.eventId = "substituted";
        scope.targetNodeId = "other";
      },
      () =>
        perform(
          async (authority) => {
            expect(readOperationAuthority(authority, binding)).toEqual({
              operatorId: { kind: "recovery-key", nodeId: NODE, eventId: "takeover-1" },
            });
            expect(readOperationAuthority(authority, scope)).toBeUndefined();
          },
          key,
          scope,
        ),
    );
  });
});
