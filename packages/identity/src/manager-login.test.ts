import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { generateSecret, generateSync } from "otplib";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { codeOf, seedManager, seedPerson, seedPersonWithPassword } from "../test/fixtures.js";
import { authorizeManager, loginManager, loginManagerById } from "./manager-login.js";
import { verifyPassword } from "./verify-password.js";
import { encryptTotpSecret } from "./mfa.js";
import { managementSessions } from "./schema/management-sessions.js";
import { hashSessionToken } from "./session-token.js";

// Spy on verifyPassword while delegating to the real KDF, so the timing-equalization KDF runs are
// observable.
vi.mock("./verify-password.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./verify-password.js")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});
// `Promise<T> | T`: `tx.execute` is synchronous on this engine and a `Promise<T>`-only parameter
// refuses it.
const run = <T>(fn: (tx: Transaction) => Promise<T> | T): Promise<T> =>
  withTransaction(suite.db, fn);

describe("loginManager", () => {
  it("logs in with a correct email + password (no TOTP enrolled)", async () => {
    const personId = await seedManager(suite.db, { email: "owner-basic@x.com" });
    const session = await run((tx) =>
      loginManager(tx, { email: "owner-basic@x.com", password: "correct horse" }),
    );
    expect(session.personId).toBe(personId);
  });
  it("logs in case-insensitively (email normalised before lookup)", async () => {
    const personId = await seedManager(suite.db, { email: "owner-ci@x.com" });
    const session = await run((tx) =>
      loginManager(tx, { email: "  OWNER-CI@X.com  ", password: "correct horse" }),
    );
    expect(session.personId).toBe(personId);
  });
  it("throws password.invalid for an unknown email (no enumeration)", async () => {
    await seedManager(suite.db, { email: "owner-known@x.com" });
    const code = await run((tx) =>
      codeOf(() => loginManager(tx, { email: "ghost@x.com", password: "correct horse" })),
    );
    expect(code).toBe("password.invalid");
  });
  it("runs the password KDF on an unknown email (timing equalization, no oracle)", async () => {
    const spy = vi.mocked(verifyPassword);
    spy.mockClear();
    await seedManager(suite.db, { email: "owner-timing@x.com" });
    const code = await run((tx) =>
      codeOf(() => loginManager(tx, { email: "nobody-timing@x.com", password: "some password" })),
    );
    expect(code).toBe("password.invalid");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("some password", expect.any(String));
  });
  it("rejects a wrong password with password.invalid", async () => {
    await seedManager(suite.db, { email: "owner-wrongpw@x.com" });
    const code = await run((tx) =>
      codeOf(() => loginManager(tx, { email: "owner-wrongpw@x.com", password: "wrong" })),
    );
    expect(code).toBe("password.invalid");
  });
  it("rejects password.invalid when no password is set, and still runs one KDF", async () => {
    // A till-only person with an email but a null password_hash.
    const personId = await seedPerson(suite.db, "manager");
    await run((tx) =>
      tx.execute(sql`update persons set email = 'owner-nopw@x.com' where id = ${personId}`),
    );
    const spy = vi.mocked(verifyPassword);
    spy.mockClear();
    const code = await run((tx) =>
      codeOf(() => loginManager(tx, { email: "owner-nopw@x.com", password: "anything" })),
    );
    expect(code).toBe("password.invalid");
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("makes a pending account pay for one KDF and return the generic password failure", async () => {
    const personId = await seedPerson(suite.db, "manager");
    await run((tx) =>
      tx.execute(
        sql`update persons set email = 'owner-pending@x.com', status = 'pending' where id = ${personId}`,
      ),
    );
    const spy = vi.mocked(verifyPassword);
    spy.mockClear();
    const code = await run((tx) =>
      codeOf(() =>
        loginManager(tx, {
          email: "owner-pending@x.com",
          password: "anything",
        }),
      ),
    );
    expect(code).toBe("password.invalid");
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("requires a valid TOTP when one is enrolled", async () => {
    const personId = await seedManager(suite.db, { email: "owner-totp@x.com" });
    const secret = generateSecret();
    const totpKeyRing = { current: { version: 1, key: Buffer.alloc(32, 8) } };
    await run((tx) =>
      tx.execute(
        sql`update persons set totp_secret = ${encryptTotpSecret(secret, totpKeyRing.current)} where id = ${personId}`,
      ),
    );
    const missing = await run((tx) =>
      codeOf(() =>
        loginManager(tx, {
          email: "owner-totp@x.com",
          password: "correct horse",
          totpKeyRing,
        }),
      ),
    );
    expect(missing).toBe("totp.required");
    const session = await run((tx) =>
      loginManager(tx, {
        email: "owner-totp@x.com",
        password: "correct horse",
        totp: generateSync({ secret }),
        totpKeyRing,
      }),
    );
    expect(session.personId).toBe(personId);
  });
  it("makes a suspended email login indistinguishable from a wrong password", async () => {
    await seedManager(suite.db, { email: "owner-suspended@x.com", status: "suspended" });
    const spy = vi.mocked(verifyPassword);
    spy.mockClear();
    const code = await run((tx) =>
      codeOf(() => loginManager(tx, { email: "owner-suspended@x.com", password: "correct horse" })),
    );
    expect(code).toBe("password.invalid");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// A trusted server-to-server path: it keeps the suspension error that the public email path folds
// away.
describe("loginManagerById", () => {
  it("logs in a low-level fixture by id + password without depending on email", async () => {
    const personId = await seedPersonWithPassword(suite.db, "admin");
    const session = await run((tx) =>
      loginManagerById(tx, { personId, password: "correct horse" }),
    );
    expect(session.personId).toBe(personId);
  });
  it("rejects an unknown id with person.not_found", async () => {
    const code = await run((tx) =>
      codeOf(() =>
        loginManagerById(tx, {
          personId: "00000000-0000-0000-0000-000000000000",
          password: "correct horse",
        }),
      ),
    );
    expect(code).toBe("person.not_found");
  });
  it("rejects a wrong password with password.invalid", async () => {
    const personId = await seedPersonWithPassword(suite.db, "admin");
    const code = await run((tx) =>
      codeOf(() => loginManagerById(tx, { personId, password: "wrong" })),
    );
    expect(code).toBe("password.invalid");
  });
  it("rejects a suspended person with person.suspended", async () => {
    const personId = await seedPersonWithPassword(suite.db, "admin");
    await run((tx) =>
      tx.execute(sql`update persons set status = 'suspended' where id = ${personId}`),
    );
    const code = await run((tx) =>
      codeOf(() => loginManagerById(tx, { personId, password: "correct horse" })),
    );
    expect(code).toBe("person.suspended");
  });
});

describe("authorizeManager", () => {
  it("permits a manager for person.manage", async () => {
    const personId = await seedManager(suite.db, {
      email: "manager@x.com",
      role: "manager",
    });
    const session = await run((tx) =>
      loginManager(tx, { email: "manager@x.com", password: "correct horse" }),
    );
    const auth = await run((tx) =>
      authorizeManager(tx, { managementSessionId: session.token, permission: "person.manage" }),
    );
    expect(auth.authorizedBy).toBe(personId);
  });
  it("refuses a staff role for person.manage", async () => {
    await seedManager(suite.db, { email: "staff@x.com", role: "staff" });
    const session = await run((tx) =>
      loginManager(tx, { email: "staff@x.com", password: "correct horse" }),
    );
    const code = await run((tx) =>
      codeOf(() =>
        authorizeManager(tx, { managementSessionId: session.token, permission: "person.manage" }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
  });
  it("leaves last-seen unchanged with touch: false, and still moves it by default", async () => {
    await seedManager(suite.db, { email: "untouched@x.com", role: "manager" });
    const session = await run((tx) =>
      loginManager(tx, { email: "untouched@x.com", password: "correct horse" }),
    );
    const aged = new Date(Date.now() - 10 * 60_000).toISOString();
    await run((tx) =>
      tx.execute(
        sql`update management_sessions set last_seen_at = ${aged} where token_hash = ${hashSessionToken(session.token)}`,
      ),
    );
    const lastSeen = () =>
      run(async (tx) => {
        const [row] = await tx
          .select({ lastSeenAt: managementSessions.lastSeenAt })
          .from(managementSessions)
          .where(eq(managementSessions.tokenHash, hashSessionToken(session.token)));
        return row!.lastSeenAt;
      });
    await run((tx) =>
      authorizeManager(tx, {
        managementSessionId: session.token,
        permission: "person.manage",
        touch: false,
      }),
    );
    expect(await lastSeen()).toBe(aged);
    await run((tx) =>
      authorizeManager(tx, { managementSessionId: session.token, permission: "person.manage" }),
    );
    expect(await lastSeen()).not.toBe(aged);
  });
});
