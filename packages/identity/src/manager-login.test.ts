import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { authenticator } from "otplib";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { codeOf, seedPerson } from "../test/fixtures.js";
import { hashPassword } from "./verify-password.js";
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

async function seedManagerWithPassword(role: "manager" | "staff" = "manager"): Promise<string> {
  const personId = await seedPerson(suite.db, tenantId, role);
  await run((tx) =>
    tx.execute(
      sql`update persons set password_hash = ${hashPassword("correct horse")} where id = ${personId}`,
    ),
  );
  return personId;
}

describe("loginManager", () => {
  it("logs in with a correct password (no TOTP enrolled)", async () => {
    const personId = await seedManagerWithPassword();
    const session = await run((tx) =>
      loginManager(tx, { tenantId, personId, password: "correct horse" }),
    );
    expect(session.personId).toBe(personId);
  });
  it("throws person.not_found for an unknown personId", async () => {
    const code = await run((tx) =>
      codeOf(() =>
        loginManager(tx, { tenantId, personId: crypto.randomUUID(), password: "correct horse" }),
      ),
    );
    expect(code).toBe("person.not_found");
  });
  it("rejects a wrong password with password.invalid", async () => {
    const personId = await seedManagerWithPassword();
    const code = await run((tx) =>
      codeOf(() => loginManager(tx, { tenantId, personId, password: "wrong" })),
    );
    expect(code).toBe("password.invalid");
  });
  it("rejects password.invalid when no password is set", async () => {
    const personId = await seedPerson(suite.db, tenantId, "manager");
    const code = await run((tx) =>
      codeOf(() => loginManager(tx, { tenantId, personId, password: "anything" })),
    );
    expect(code).toBe("password.invalid");
  });
  it("requires a valid TOTP when one is enrolled", async () => {
    const personId = await seedManagerWithPassword();
    const secret = authenticator.generateSecret();
    await run((tx) =>
      tx.execute(sql`update persons set totp_secret = ${secret} where id = ${personId}`),
    );
    const missing = await run((tx) =>
      codeOf(() => loginManager(tx, { tenantId, personId, password: "correct horse" })),
    );
    expect(missing).toBe("totp.invalid");
    const session = await run((tx) =>
      loginManager(tx, {
        tenantId,
        personId,
        password: "correct horse",
        totp: authenticator.generate(secret),
      }),
    );
    expect(session.personId).toBe(personId);
  });
  it("rejects login for a suspended person", async () => {
    const personId = await seedManagerWithPassword();
    await run((tx) =>
      tx.execute(sql`update persons set status = 'suspended' where id = ${personId}`),
    );
    const code = await run((tx) =>
      codeOf(() => loginManager(tx, { tenantId, personId, password: "correct horse" })),
    );
    expect(code).toBe("person.suspended");
  });
});

describe("authorizeManager", () => {
  it("permits a manager for person.manage", async () => {
    const personId = await seedManagerWithPassword("manager");
    const session = await run((tx) =>
      loginManager(tx, { tenantId, personId, password: "correct horse" }),
    );
    const auth = await run((tx) =>
      authorizeManager(tx, { managementSessionId: session.id, permission: "person.manage" }),
    );
    expect(auth.authorizedBy).toBe(personId);
  });
  it("refuses a staff role for person.manage", async () => {
    const personId = await seedManagerWithPassword("staff");
    const session = await run((tx) =>
      loginManager(tx, { tenantId, personId, password: "correct horse" }),
    );
    const code = await run((tx) =>
      codeOf(() =>
        authorizeManager(tx, { managementSessionId: session.id, permission: "person.manage" }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
  });
});
