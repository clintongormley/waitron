import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { CORE_MIGRATIONS, readCurrentMasterKey, stampDeployment } from "@waitron/db";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { dashboardSessions, persons } from "@waitron/identity";
import {
  readOperationAuthority,
  type OperationAuthority,
  type OperationBinding,
} from "@waitron/module";
import { mintMasterKey, WRONG_MASTER_KEY } from "./testing/master-key.js";
import * as operations from "./operation-authentication.js";
import * as shared from "@waitron/shared";
import * as credentials from "@waitron/credentials";
import {
  venueAndNodeWritersBesideRequest,
  recordDerivation,
  whileChangingNodeOnLockRequest,
  whileChangingOnLockRequest,
} from "./testing/watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS],
});
const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const binding = {
  module: "test-regime",
  action: "restore",
  eventId: "restore-1",
  sourceId: "archive-1",
  targetNodeId: NODE,
};
let key: string;

beforeEach(async () => {
  await stampDeployment(suite.db, "preproduction");
  key = (await mintMasterKey(suite.db)).secret;
});

function perform<T>(
  run: (authority: OperationAuthority) => Promise<T>,
  secret: unknown = key,
  scope: OperationBinding = binding,
) {
  return operations.withRecoveryKeyOperation(
    { db: suite.db, node: suite.node, nodeId: NODE },
    scope,
    secret,
    (_tx, authority) => run(authority),
  );
}

describe("scoped recovery-key authority", () => {
  it("authorises restore with only the current master key and revokes authority after use", async () => {
    let held: unknown;
    const current = (await readCurrentMasterKey(suite.db))?.number;
    const result = await perform(async (authority) => {
      held = authority;
      expect(readOperationAuthority(authority, binding)).toEqual({
        operatorId: { kind: "recovery-key", nodeId: NODE, eventId: "restore-1" },
      });
      expect(await suite.db.select().from(persons)).toEqual([]);
      expect(await suite.db.select().from(dashboardSessions)).toEqual([]);
      return "committed";
    });
    expect(result).toBe("committed");
    expect(readOperationAuthority(held, binding)).toBeUndefined();
    expect((await readCurrentMasterKey(suite.db))?.number).toBe(current);
  });

  it.each([undefined, null, 123, {}, "", "wrong", WRONG_MASTER_KEY])(
    "refuses an invalid key %# without entering the operation",
    async (secret) => {
      let entered = false;
      await expect(
        operations.withRecoveryKeyOperation(
          { db: suite.db, node: suite.node, nodeId: NODE },
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
    { ...binding, action: "node.manage" },
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
      whileChangingNodeOnLockRequest(
        suite.node,
        async () => {
          await mintMasterKey(suite.db);
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
    await perform(async () => {});
    const decode = shared.decodeMasterKeyCode;
    const decodeSpy = vi.spyOn(shared, "decodeMasterKeyCode").mockImplementation((code) => {
      recordDerivation();
      return decode(code);
    });
    onTestFinished(() => decodeSpy.mockRestore());
    const derive = credentials.authorityKey;
    const deriveSpy = vi.spyOn(credentials, "authorityKey").mockImplementation((masterKey) => {
      recordDerivation();
      return derive(masterKey);
    });
    onTestFinished(() => deriveSpy.mockRestore());
    const original = (await readCurrentMasterKey(suite.db))?.number;
    let held: unknown;
    const observed = await venueAndNodeWritersBesideRequest(suite.db, suite.node, () =>
      operations.withRecoveryKeyOperation(
        { db: suite.db, node: suite.node, nodeId: NODE },
        binding,
        key,
        async (tx, authority) => {
          held = authority;
          expect((await readCurrentMasterKey(tx))?.number).toBe(original);
          return "committed";
        },
      ),
    );
    expect(observed.result).toBe("committed");
    expect(decodeSpy).toHaveBeenCalledTimes(1);
    expect(deriveSpy).toHaveBeenCalledTimes(1);
    expect(observed.outside).toBe(2);
    expect(observed.order).not.toContain("key derived in a transaction");
    expect(readOperationAuthority(held, binding)).toBeUndefined();
    await expect(
      operations.withRecoveryKeyOperation(
        { db: suite.db, node: suite.node, nodeId: NODE },
        binding,
        key,
        async (tx, authority) => {
          held = authority;
          await seedPersons(tx, { displayName: "Uncommitted", role: "staff" });
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
              operatorId: { kind: "recovery-key", nodeId: NODE, eventId: "restore-1" },
            });
            expect(readOperationAuthority(authority, scope)).toBeUndefined();
          },
          key,
          scope,
        ),
    );
  });
});
