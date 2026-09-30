import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { generateSecret, generateSync } from "otplib";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import {
  codeOf,
  refusalOf,
  seedManager,
  seedPerson,
  seedPersonWithPassword,
  TOTP_KEY_RING,
} from "../test/fixtures.js";
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
      loginManager(tx, {
        email: "owner-basic@x.com",
        password: "correct horse",
        totpKeyRing: TOTP_KEY_RING,
      }),
    );
    expect(session.personId).toBe(personId);
  });
  it("logs in case-insensitively (email normalised before lookup)", async () => {
    const personId = await seedManager(suite.db, { email: "owner-ci@x.com" });
    const session = await run((tx) =>
      loginManager(tx, {
        email: "  OWNER-CI@X.com  ",
        password: "correct horse",
        totpKeyRing: TOTP_KEY_RING,
      }),
    );
    expect(session.personId).toBe(personId);
  });
  it("throws password.invalid for an unknown email (no enumeration)", async () => {
    await seedManager(suite.db, { email: "owner-known@x.com" });
    const code = await run((tx) =>
      codeOf(() =>
        loginManager(tx, {
          email: "ghost@x.com",
          password: "correct horse",
          totpKeyRing: TOTP_KEY_RING,
        }),
      ),
    );
    expect(code).toBe("password.invalid");
  });
  it("runs the password KDF on an unknown email (timing equalization, no oracle)", async () => {
    const spy = vi.mocked(verifyPassword);
    spy.mockClear();
    await seedManager(suite.db, { email: "owner-timing@x.com" });
    const code = await run((tx) =>
      codeOf(() =>
        loginManager(tx, {
          email: "nobody-timing@x.com",
          password: "some password",
          totpKeyRing: TOTP_KEY_RING,
        }),
      ),
    );
    expect(code).toBe("password.invalid");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("some password", expect.any(String));
  });
  it("rejects a wrong password with password.invalid", async () => {
    await seedManager(suite.db, { email: "owner-wrongpw@x.com" });
    const code = await run((tx) =>
      codeOf(() =>
        loginManager(tx, {
          email: "owner-wrongpw@x.com",
          password: "wrong",
          totpKeyRing: TOTP_KEY_RING,
        }),
      ),
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
      codeOf(() =>
        loginManager(tx, {
          email: "owner-nopw@x.com",
          password: "anything",
          totpKeyRing: TOTP_KEY_RING,
        }),
      ),
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
          totpKeyRing: TOTP_KEY_RING,
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
      codeOf(() =>
        loginManager(tx, {
          email: "owner-suspended@x.com",
          password: "correct horse",
          totpKeyRing: TOTP_KEY_RING,
        }),
      ),
    );
    expect(code).toBe("password.invalid");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("the manager logins' timing equalization", () => {
  // A refusal that settled before its KDF finished would be told apart from a wrong password by its
  // time, which is the oracle the dummy check exists to close.
  async function refusalWaitsForTheKdf(login: (tx: Transaction) => Promise<unknown>) {
    const spy = vi.mocked(verifyPassword);
    let finish: ((matched: boolean) => void) | undefined;
    spy.mockImplementationOnce(() => new Promise<boolean>((resolve) => (finish = resolve)));
    let settled = false;
    const refused = run((tx) => codeOf(() => login(tx))).finally(() => (settled = true));
    try {
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      await new Promise((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
    } finally {
      // Release the held check, or drop it unused, so no later login waits on it.
      if (finish === undefined) spy.mockReset();
      else finish(false);
    }
    expect(await refused).toBe("password.invalid");
  }
  const byEmail = (email: string) => (tx: Transaction) =>
    loginManager(tx, { email, password: "some password", totpKeyRing: TOTP_KEY_RING });
  const byId = (personId: string) => (tx: Transaction) =>
    loginManagerById(tx, { personId, password: "some password", totpKeyRing: TOTP_KEY_RING });
  it("waits for the KDF before refusing an unknown email", async () => {
    await refusalWaitsForTheKdf(byEmail("nobody-waits@x.com"));
  });
  it("waits for the KDF before refusing a suspended account", async () => {
    await seedManager(suite.db, { email: "owner-suspended-waits@x.com", status: "suspended" });
    await refusalWaitsForTheKdf(byEmail("owner-suspended-waits@x.com"));
  });
  it("waits for the KDF before refusing a pending account", async () => {
    const personId = await seedPerson(suite.db, "manager");
    await run((tx) =>
      tx.execute(
        sql`update persons set email = 'owner-pending-waits@x.com', status = 'pending' where id = ${personId}`,
      ),
    );
    await refusalWaitsForTheKdf(byEmail("owner-pending-waits@x.com"));
  });
  it("waits for the KDF before refusing an account with no password", async () => {
    const personId = await seedPerson(suite.db, "manager");
    await run((tx) =>
      tx.execute(sql`update persons set email = 'owner-nopw-waits@x.com' where id = ${personId}`),
    );
    await refusalWaitsForTheKdf(byEmail("owner-nopw-waits@x.com"));
  });
  it("waits for the KDF before refusing an unknown id", async () => {
    await refusalWaitsForTheKdf(byId(crypto.randomUUID()));
  });
  it("waits for the KDF before refusing a suspended account by id", async () => {
    await refusalWaitsForTheKdf(
      byId(await seedManager(suite.db, { email: "id-suspended-waits@x.com", status: "suspended" })),
    );
  });
});

interface LoginAttempt {
  personId: string;
  email: string;
  password: string;
  totp?: string;
  recoveryCode?: string;
}

async function withAuthenticator(personId: string): Promise<string> {
  const secret = generateSecret();
  await run((tx) =>
    tx.execute(
      sql`update persons set totp_secret = ${encryptTotpSecret(secret, TOTP_KEY_RING.current)} where id = ${personId}`,
    ),
  );
  return secret;
}

// A well-formed six-digit code that is not the one the authenticator shows now.
function wrongCodeFor(secret: string): string {
  return String((Number(generateSync({ secret })) + 500_000) % 1_000_000).padStart(6, "0");
}

// Each refusal cause, with the right password wherever the account has one, so only the cause
// differs.
async function refusalCauses(): Promise<Record<string, LoginAttempt>> {
  const account = async (status: "active" | "pending" | "suspended" = "active") => {
    const email = `refusal-${crypto.randomUUID()}@x.com`;
    const personId = await seedManager(suite.db, { email, status });
    return { personId, email, password: "correct horse" };
  };
  const noPassword = await account();
  await run((tx) =>
    tx.execute(sql`update persons set password_hash = null where id = ${noPassword.personId}`),
  );
  const wrongCode = await account();
  const wrongRecoveryCode = await account();
  await withAuthenticator(wrongRecoveryCode.personId);
  const unreadableSecret = await account();
  await run((tx) =>
    tx.execute(
      sql`update persons set totp_secret = 'v1.not-a-secret' where id = ${unreadableSecret.personId}`,
    ),
  );
  return {
    unknown: {
      personId: crypto.randomUUID(),
      email: `nobody-${crypto.randomUUID()}@x.com`,
      password: "correct horse",
    },
    suspended: await account("suspended"),
    pending: await account("pending"),
    noPassword,
    wrongPassword: { ...(await account()), password: "wrong" },
    wrongCode: { ...wrongCode, totp: wrongCodeFor(await withAuthenticator(wrongCode.personId)) },
    wrongRecoveryCode: { ...wrongRecoveryCode, recoveryCode: "AAAA-BBBB-CCCC-DDDD" },
    unreadableSecret: { ...unreadableSecret, totp: "123456" },
  };
}

const PASSWORD_INVALID = { code: "password.invalid", params: {} };

describe("the manager logins' refusals", () => {
  it("are one answer by email, whatever the cause", async () => {
    const refusals: Record<string, unknown> = {};
    for (const [cause, { email, password, totp, recoveryCode }] of Object.entries(
      await refusalCauses(),
    )) {
      refusals[cause] = await refusalOf(() =>
        run((tx) =>
          loginManager(tx, { email, password, totp, recoveryCode, totpKeyRing: TOTP_KEY_RING }),
        ),
      );
    }
    expect(refusals).toEqual({
      unknown: PASSWORD_INVALID,
      suspended: PASSWORD_INVALID,
      pending: PASSWORD_INVALID,
      noPassword: PASSWORD_INVALID,
      wrongPassword: PASSWORD_INVALID,
      wrongCode: PASSWORD_INVALID,
      wrongRecoveryCode: PASSWORD_INVALID,
      unreadableSecret: PASSWORD_INVALID,
    });
  });

  it("are one answer by id, whatever the cause, a missing authenticator code included", async () => {
    const missingCode = await seedPersonWithPassword(suite.db, "admin");
    await withAuthenticator(missingCode);
    const causes: Record<string, LoginAttempt> = {
      ...(await refusalCauses()),
      missingCode: { personId: missingCode, email: "", password: "correct horse" },
    };
    const refusals: Record<string, unknown> = {};
    for (const [cause, { personId, password, totp, recoveryCode }] of Object.entries(causes)) {
      refusals[cause] = await refusalOf(() =>
        run((tx) =>
          loginManagerById(tx, {
            personId,
            password,
            totp,
            recoveryCode,
            totpKeyRing: TOTP_KEY_RING,
          }),
        ),
      );
    }
    expect(refusals).toEqual({
      unknown: PASSWORD_INVALID,
      suspended: PASSWORD_INVALID,
      pending: PASSWORD_INVALID,
      noPassword: PASSWORD_INVALID,
      wrongPassword: PASSWORD_INVALID,
      wrongCode: PASSWORD_INVALID,
      wrongRecoveryCode: PASSWORD_INVALID,
      unreadableSecret: PASSWORD_INVALID,
      missingCode: PASSWORD_INVALID,
    });
  });
});

describe("loginManagerById", () => {
  it("logs in a low-level fixture by id + password without depending on email", async () => {
    const personId = await seedPersonWithPassword(suite.db, "admin");
    const session = await run((tx) =>
      loginManagerById(tx, { personId, password: "correct horse", totpKeyRing: TOTP_KEY_RING }),
    );
    expect(session.personId).toBe(personId);
  });
  it("rejects an unknown id with password.invalid, after one KDF", async () => {
    const spy = vi.mocked(verifyPassword);
    spy.mockClear();
    const code = await run((tx) =>
      codeOf(() =>
        loginManagerById(tx, {
          personId: "00000000-0000-0000-0000-000000000000",
          password: "correct horse",
          totpKeyRing: TOTP_KEY_RING,
        }),
      ),
    );
    expect(code).toBe("password.invalid");
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("rejects a wrong password with password.invalid", async () => {
    const personId = await seedPersonWithPassword(suite.db, "admin");
    const code = await run((tx) =>
      codeOf(() =>
        loginManagerById(tx, { personId, password: "wrong", totpKeyRing: TOTP_KEY_RING }),
      ),
    );
    expect(code).toBe("password.invalid");
  });
  it("rejects a suspended person with password.invalid, after one KDF, starting no session", async () => {
    const personId = await seedPersonWithPassword(suite.db, "admin");
    await run((tx) =>
      tx.execute(sql`update persons set status = 'suspended' where id = ${personId}`),
    );
    const spy = vi.mocked(verifyPassword);
    spy.mockClear();
    const code = await run((tx) =>
      codeOf(() =>
        loginManagerById(tx, { personId, password: "correct horse", totpKeyRing: TOTP_KEY_RING }),
      ),
    );
    expect(code).toBe("password.invalid");
    expect(spy).toHaveBeenCalledTimes(1);
    const sessions = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from management_sessions where person_id = ${personId}`,
    );
    expect(sessions.rows[0]!.n).toBe(0);
  });
  it("logs in with the right password and authenticator code", async () => {
    const personId = await seedPersonWithPassword(suite.db, "admin");
    const secret = await withAuthenticator(personId);
    const session = await run((tx) =>
      loginManagerById(tx, {
        personId,
        password: "correct horse",
        totp: generateSync({ secret }),
        totpKeyRing: TOTP_KEY_RING,
      }),
    );
    expect(session.personId).toBe(personId);
  });
});

describe("authorizeManager", () => {
  it("permits a manager for person.manage", async () => {
    const personId = await seedManager(suite.db, {
      email: "manager@x.com",
      role: "manager",
    });
    const session = await run((tx) =>
      loginManager(tx, {
        email: "manager@x.com",
        password: "correct horse",
        totpKeyRing: TOTP_KEY_RING,
      }),
    );
    const auth = await run((tx) =>
      authorizeManager(tx, { managementSessionId: session.token, permission: "person.manage" }),
    );
    expect(auth.authorizedBy).toBe(personId);
  });
  it("refuses a staff role for person.manage", async () => {
    await seedManager(suite.db, { email: "staff@x.com", role: "staff" });
    const session = await run((tx) =>
      loginManager(tx, {
        email: "staff@x.com",
        password: "correct horse",
        totpKeyRing: TOTP_KEY_RING,
      }),
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
      loginManager(tx, {
        email: "untouched@x.com",
        password: "correct horse",
        totpKeyRing: TOTP_KEY_RING,
      }),
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
