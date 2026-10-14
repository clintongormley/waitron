import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, IDENTITY_MIGRATIONS, managementSessions, persons } from "@waitron/identity";
import { readOperationAuthority, type OperationAuthority } from "@waitron/module";
import { generateSync } from "otplib";
import { withAuthenticatedOperation } from "./operation-authentication.js";
import { enrolAuthenticator, TOTP_KEY_RING, wrongTotpCode } from "./testing/authenticator.js";
import { whileChangingOnLockRequest, writerBesideRequest } from "./testing/watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
const ADMIN = "a0000000-0000-4000-8000-000000000001";
const OTHER = "a0000000-0000-4000-8000-000000000002";
const PASSWORD = "correct horse";
const HASH = hashPassword(PASSWORD);
const binding = {
  module: "test-regime",
  action: "promote",
  eventId: "takeover-1",
  sourceId: "archive-1",
  targetNodeId: "replacement-1",
};

async function perform<T>(
  run: (authority: OperationAuthority) => Promise<T>,
  credentials: unknown = { personId: ADMIN, password: PASSWORD },
  scope = binding,
  permission: "node.promote" | "mirror.create" = "node.promote",
) {
  return withAuthenticatedOperation(
    { db: suite.db, credentialKeyRing: TOTP_KEY_RING },
    { binding: scope, permission },
    credentials,
    run,
  );
}

beforeEach(async () => {
  await suite.db.insert(persons).values([
    { id: ADMIN, displayName: "Administrator", role: "admin", passwordHash: HASH },
    { id: OTHER, displayName: "Manager", role: "manager", passwordHash: HASH },
  ]);
});

describe("host-issued authority after fresh operator authentication", () => {
  it.each(["node.promote", "mirror.create"] as const)(
    "authenticates and authorises %s before handing out scoped authority",
    async (permission) => {
      let retained: unknown;
      const result = await perform(
        async (authority) => {
          retained = authority;
          expect(readOperationAuthority(authority, binding)).toEqual({ operatorId: ADMIN });
          expect(
            await suite.db
              .select()
              .from(managementSessions)
              .where(isNull(managementSessions.endedAt)),
          ).toEqual([]);
          return "operation committed";
        },
        undefined,
        binding,
        permission,
      );
      expect(result).toBe("operation committed");
      expect(readOperationAuthority(retained, binding)).toBeUndefined();
    },
  );

  it.each([
    null,
    [],
    {},
    { personId: ADMIN, password: 123 },
    { personId: ADMIN, password: null },
    { personId: ADMIN, password: PASSWORD, totp: 123 },
    { personId: ADMIN, password: PASSWORD, totp: null },
    { personId: "not-a-uuid", password: PASSWORD },
    { personId: ADMIN, password: "wrong" },
    { personId: "b0000000-0000-4000-8000-000000000001", password: PASSWORD },
    { personId: ADMIN, operatorId: ADMIN, authenticated: true },
  ])(
    "refuses malformed or unverified credentials %# without running the operation",
    async (credentials) => {
      let entered = false;
      await expect(
        perform(async () => {
          entered = true;
        }, credentials),
      ).rejects.toMatchObject({ code: "password.invalid" });
      expect(entered).toBe(false);
      expect(await suite.db.select().from(managementSessions)).toEqual([]);
    },
  );

  it.each(["manager", "supervisor", "staff"] as const)(
    "refuses a %s's correct password without granting authority",
    async (role) => {
      await suite.db.update(persons).set({ role }).where(eq(persons.id, OTHER));
      let entered = false;
      await expect(
        perform(
          async () => {
            entered = true;
          },
          { personId: OTHER, password: PASSWORD },
        ),
      ).rejects.toMatchObject({
        code: "authorization.not_permitted",
        params: { permission: "node.promote" },
      });
      expect(entered).toBe(false);
      expect(await suite.db.select().from(managementSessions)).toEqual([]);
    },
  );

  it.each(["pending", "suspended"] as const)("refuses a %s administrator", async (status) => {
    await suite.db.update(persons).set({ status }).where(eq(persons.id, ADMIN));
    let entered = false;
    await expect(
      perform(async () => {
        entered = true;
      }),
    ).rejects.toMatchObject({ code: "password.invalid" });
    expect(entered).toBe(false);
  });

  it("checks an enrolled authenticator instead of trusting a password alone", async () => {
    const secret = await enrolAuthenticator(suite.db, ADMIN, PASSWORD, TOTP_KEY_RING);
    for (const totp of [undefined, wrongTotpCode(secret)]) {
      let entered = false;
      await expect(
        perform(
          async () => {
            entered = true;
          },
          { personId: ADMIN, password: PASSWORD, totp },
        ),
      ).rejects.toMatchObject({ code: "password.invalid" });
      expect(entered).toBe(false);
    }
    await expect(
      perform(async (authority) => readOperationAuthority(authority, binding), {
        personId: ADMIN,
        password: PASSWORD,
        totp: generateSync({ secret }),
      }),
    ).resolves.toEqual({ operatorId: ADMIN });
  });

  it("derives the password outside the write lock and ends authentication before the operation", async () => {
    const observed = await writerBesideRequest(suite.db, () =>
      perform(async () => {
        await withTransaction(suite.db, (tx) =>
          tx.update(persons).set({ displayName: "Completed" }).where(eq(persons.id, ADMIN)),
        );
        return "committed";
      }),
    );
    expect(observed.result).toBe("committed");
    expect(observed.outside).toBe(1);
    expect(observed.order).not.toContain("key derived in a transaction");
    const [person] = await suite.db.select().from(persons).where(eq(persons.id, ADMIN));
    expect(person!.displayName).toBe("Completed");
  });

  it("rechecks an administrator suspended after the password check", async () => {
    let entered = false;
    await expect(
      whileChangingOnLockRequest(
        suite.db,
        async (tx) => {
          await tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, ADMIN));
        },
        () =>
          perform(async () => {
            entered = true;
          }),
      ),
    ).rejects.toMatchObject({ code: "password.invalid" });
    expect(entered).toBe(false);
  });

  it("rechecks permission after the password check", async () => {
    let entered = false;
    await expect(
      whileChangingOnLockRequest(
        suite.db,
        async (tx) => {
          await tx.update(persons).set({ role: "manager" }).where(eq(persons.id, ADMIN));
        },
        () =>
          perform(async () => {
            entered = true;
          }),
      ),
    ).rejects.toMatchObject({ code: "authorization.not_permitted" });
    expect(entered).toBe(false);
  });

  it("snapshots the scope and credentials before awaiting authentication", async () => {
    const input = { ...binding };
    const credentials = { personId: ADMIN, password: PASSWORD };
    await expect(
      whileChangingOnLockRequest(
        suite.db,
        async () => {
          input.targetNodeId = "caller-changed";
          credentials.personId = OTHER;
          credentials.password = "wrong";
        },
        () =>
          perform(
            async (authority) => {
              expect(readOperationAuthority(authority, input)).toBeUndefined();
              return readOperationAuthority(authority, binding);
            },
            credentials,
            input,
          ),
      ),
    ).resolves.toEqual({ operatorId: ADMIN });
  });

  it("revokes escaped authority even when the operation refuses", async () => {
    let retained: unknown;
    await expect(
      perform(async (authority) => {
        retained = authority;
        throw new Error("activation refused");
      }),
    ).rejects.toThrow("activation refused");
    expect(readOperationAuthority(retained, binding)).toBeUndefined();
    expect(
      await suite.db.select().from(managementSessions).where(isNull(managementSessions.endedAt)),
    ).toEqual([]);
  });
});
