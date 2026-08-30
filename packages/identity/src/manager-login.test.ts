import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { generateSecret, generateSync } from "otplib";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { codeOf, seedManager, seedPerson } from "../test/fixtures.js";
import { authorizeManager, loginManager } from "./manager-login.js";

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
  it("rejects password.invalid when no password is set", async () => {
    // A till-only person with an email but a null password_hash: still cannot sign in on the
    // dashboard, and the code must not distinguish them from a wrong password.
    const personId = await seedPerson(suite.db, tenantId, "manager");
    await run((tx) =>
      tx.execute(sql`update persons set email = 'owner-nopw@x.com' where id = ${personId}`),
    );
    const code = await run((tx) =>
      codeOf(() => loginManager(tx, { tenantId, email: "owner-nopw@x.com", password: "anything" })),
    );
    expect(code).toBe("password.invalid");
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
