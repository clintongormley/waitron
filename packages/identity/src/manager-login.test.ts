import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { generateSecret, generateSync } from "otplib";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { codeOf, seedManager, seedPerson, seedPersonWithPassword } from "../test/fixtures.js";
import { authorizeManager, loginManager, loginManagerById } from "./manager-login.js";
import { verifyPassword } from "./verify-password.js";

// Spy on verifyPassword while delegating to the real KDF, so the timing-equalization mitigation is
// observable: the person-not-found branch must run one verifyPassword (against the dummy hash) before
// throwing, or it becomes a fast/slow user-enumeration oracle. The real implementation is preserved
// (`vi.fn(actual.verifyPassword)`), so every other case's password check behaves exactly as before.
vi.mock("./verify-password.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./verify-password.js")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

// PGlite, not real Postgres: this suite tests the verifier LOGIC — the password/TOTP/suspended
// branches and the role gate. A PGlite connection is superuser, so RLS is a false pass here
// (CLAUDE.md §4); tenant-isolation is proven as the app role in the *.rls suites, not re-proven here.
let tenantId: string;
const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
  },
});
const run = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
  withTenant(suite.db, tenantId, fn);

describe("loginManager", () => {
  it("logs in with a correct email + password (no TOTP enrolled)", async () => {
    const personId = await seedManager(suite.db, tenantId, { email: "owner-basic@x.com" });
    const session = await run((tx) =>
      loginManager(tx, { tenantId, email: "owner-basic@x.com", password: "correct horse" }),
    );
    expect(session.personId).toBe(personId);
  });
  it("logs in case-insensitively (email normalised before lookup)", async () => {
    const personId = await seedManager(suite.db, tenantId, { email: "owner-ci@x.com" });
    const session = await run((tx) =>
      loginManager(tx, { tenantId, email: "  OWNER-CI@X.com  ", password: "correct horse" }),
    );
    expect(session.personId).toBe(personId);
  });
  it("throws password.invalid for an unknown email (no enumeration)", async () => {
    // Unknown email must be indistinguishable from a wrong password on the public login form — a
    // distinct code would leak which addresses have accounts.
    await seedManager(suite.db, tenantId, { email: "owner-known@x.com" });
    const code = await run((tx) =>
      codeOf(() => loginManager(tx, { tenantId, email: "ghost@x.com", password: "correct horse" })),
    );
    expect(code).toBe("password.invalid");
  });
  it("runs the password KDF on an unknown email (timing equalization, no oracle)", async () => {
    // Proof-by-deletion for the enumeration-timing mitigation: an unknown email must still pay for one
    // verifyPassword, exactly as a wrong-password attempt does, so the two are indistinguishable by
    // latency. Delete the dummy-verify call in loginManager's not-found branch and this goes red.
    const spy = vi.mocked(verifyPassword);
    spy.mockClear();
    await seedManager(suite.db, tenantId, { email: "owner-timing@x.com" });
    const code = await run((tx) =>
      codeOf(() =>
        loginManager(tx, { tenantId, email: "nobody-timing@x.com", password: "some password" }),
      ),
    );
    expect(code).toBe("password.invalid");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("some password", expect.any(String));
  });
  it("does not authenticate a person from another tenant (tenant filter)", async () => {
    // A person with a valid email + password, but in a DIFFERENT tenant. Even on PGlite (superuser,
    // RLS bypassed), loginManager scoped to `tenantId` must not find them — so a caller that forgets
    // withTenant cannot mint a session with a mismatched tenant_id. The hardened code is the same
    // `password.invalid` an unknown email yields.
    const otherTenant = await seedTenant(suite.db);
    await seedManager(suite.db, otherTenant, { email: "owner@x.com" });
    const code = await run((tx) =>
      codeOf(() => loginManager(tx, { tenantId, email: "owner@x.com", password: "correct horse" })),
    );
    expect(code).toBe("password.invalid");
  });
  it("rejects a wrong password with password.invalid", async () => {
    await seedManager(suite.db, tenantId, { email: "owner-wrongpw@x.com" });
    const code = await run((tx) =>
      codeOf(() => loginManager(tx, { tenantId, email: "owner-wrongpw@x.com", password: "wrong" })),
    );
    expect(code).toBe("password.invalid");
  });
  it("rejects password.invalid when no password is set, and still runs one KDF", async () => {
    // A till-only person with an email but a null password_hash: still cannot sign in on the
    // dashboard, and the code must not distinguish them from a wrong password.
    const personId = await seedPerson(suite.db, tenantId, "manager");
    await run((tx) =>
      tx.execute(sql`update persons set email = 'owner-nopw@x.com' where id = ${personId}`),
    );
    const spy = vi.mocked(verifyPassword);
    spy.mockClear();
    const code = await run((tx) =>
      codeOf(() => loginManager(tx, { tenantId, email: "owner-nopw@x.com", password: "anything" })),
    );
    expect(code).toBe("password.invalid");
    // Timing equalization: the null-password branch still pays for one KDF (against the dummy hash),
    // so a PIN-only account isn't distinguishable by latency from a wrong password. Proof-by-deletion:
    // remove the dummy verifyPassword in completeManagerLogin's null branch and this goes red.
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("requires a valid TOTP when one is enrolled", async () => {
    const personId = await seedManager(suite.db, tenantId, { email: "owner-totp@x.com" });
    const secret = generateSecret();
    await run((tx) =>
      tx.execute(sql`update persons set totp_secret = ${secret} where id = ${personId}`),
    );
    const missing = await run((tx) =>
      codeOf(() =>
        loginManager(tx, { tenantId, email: "owner-totp@x.com", password: "correct horse" }),
      ),
    );
    expect(missing).toBe("totp.invalid");
    const session = await run((tx) =>
      loginManager(tx, {
        tenantId,
        email: "owner-totp@x.com",
        password: "correct horse",
        totp: generateSync({ secret }),
      }),
    );
    expect(session.personId).toBe(personId);
  });
  it("rejects login for a suspended person", async () => {
    await seedManager(suite.db, tenantId, { email: "owner-suspended@x.com", status: "suspended" });
    const code = await run((tx) =>
      codeOf(() =>
        loginManager(tx, { tenantId, email: "owner-suspended@x.com", password: "correct horse" }),
      ),
    );
    expect(code).toBe("person.suspended");
  });
});

// The by-id entry point the C2b mirror-bundle route uses to authenticate the primary's admin — a
// server-to-server flow carrying an id, so it resolves by id regardless of whether the admin carries an
// email (the bare `venue` CLI seeds it emailless; onboarding may set one). Behaviour is `loginManager`'s,
// minus email lookup: an UNKNOWN id is `person.not_found` (no enumeration surface here), and every
// post-lookup check is the shared `completeManagerLogin`.
describe("loginManagerById", () => {
  it("logs in an emailless person by id + password (the provisioned-admin shape)", async () => {
    // `seedPersonWithPassword` sets a password but NO email — exactly the admin the mirror flow signs in.
    const personId = await seedPersonWithPassword(suite.db, tenantId, "admin");
    const session = await run((tx) =>
      loginManagerById(tx, { tenantId, personId, password: "correct horse" }),
    );
    expect(session.personId).toBe(personId);
  });
  it("rejects an unknown id with person.not_found", async () => {
    const code = await run((tx) =>
      codeOf(() =>
        loginManagerById(tx, {
          tenantId,
          personId: "00000000-0000-0000-0000-000000000000",
          password: "correct horse",
        }),
      ),
    );
    expect(code).toBe("person.not_found");
  });
  it("rejects a wrong password with password.invalid", async () => {
    const personId = await seedPersonWithPassword(suite.db, tenantId, "admin");
    const code = await run((tx) =>
      codeOf(() => loginManagerById(tx, { tenantId, personId, password: "wrong" })),
    );
    expect(code).toBe("password.invalid");
  });
  it("rejects a suspended person with person.suspended", async () => {
    // Seed an emailless person WITH a password, then suspend — the shared suspension gate fires before
    // the password check, the same as the email path.
    const personId = await seedPersonWithPassword(suite.db, tenantId, "admin");
    await run((tx) =>
      tx.execute(sql`update persons set status = 'suspended' where id = ${personId}`),
    );
    const code = await run((tx) =>
      codeOf(() => loginManagerById(tx, { tenantId, personId, password: "correct horse" })),
    );
    expect(code).toBe("person.suspended");
  });
});

describe("authorizeManager", () => {
  it("permits a manager for person.manage", async () => {
    const personId = await seedManager(suite.db, tenantId, {
      email: "manager@x.com",
      role: "manager",
    });
    const session = await run((tx) =>
      loginManager(tx, { tenantId, email: "manager@x.com", password: "correct horse" }),
    );
    const auth = await run((tx) =>
      authorizeManager(tx, { managementSessionId: session.id, permission: "person.manage" }),
    );
    expect(auth.authorizedBy).toBe(personId);
  });
  it("refuses a staff role for person.manage", async () => {
    await seedManager(suite.db, tenantId, { email: "staff@x.com", role: "staff" });
    const session = await run((tx) =>
      loginManager(tx, { tenantId, email: "staff@x.com", password: "correct horse" }),
    );
    const code = await run((tx) =>
      codeOf(() =>
        authorizeManager(tx, { managementSessionId: session.id, permission: "person.manage" }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
  });
});
