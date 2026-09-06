import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { authorize } from "./authorize.js";
import { loginWithPin } from "./login.js";
import { loginManager } from "./manager-login.js";
import {
  MIN_PIN_LENGTH,
  asEmailTaken,
  createPerson,
  listActiveStaff,
  listPersons,
  reactivatePerson,
  resetPin,
  setEmail,
  setPassword,
  setRole,
  suspendPerson,
} from "./staff.js";
import {
  codeOf,
  openManagementSession,
  openSession,
  seedPerson,
  seedTill,
} from "../test/fixtures.js";

// PGlite, not real Postgres: the staff-admin API is LOGIC gated on authorizeManager() — the
// person.manage check, the PIN-length assertion, and the role/status writes. Nothing here depends on
// the privilege set (a PGlite connection is superuser holding every grant, so a grant assertion
// would be a false pass, CLAUDE.md §4).
let tenantId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
  },
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.db, tenantId, fn);
}

async function personCount(): Promise<number> {
  const rows = await suite.db.execute<{ n: number }>(sql`select count(*)::int as n from persons`);
  return rows.rows[0]!.n;
}

// The mutable columns the staff-admin API writes, read as the superuser owner. A gate that rejects BEFORE its write leaves every one of these unchanged.
async function personRow(
  id: string,
): Promise<{ role: string; status: string; pin_hash: string; password_hash: string | null }> {
  const rows = await suite.db.execute<{
    role: string;
    status: string;
    pin_hash: string;
    password_hash: string | null;
  }>(sql`select role, status, pin_hash, password_hash from persons where id = ${id}`);
  return rows.rows[0]!;
}

// The stored login email, read as the superuser owner.
async function emailOf(id: string): Promise<string | null> {
  const rows = await suite.db.execute<{ email: string | null }>(
    sql`select email from persons where id = ${id}`,
  );
  return rows.rows[0]!.email;
}

describe("createPerson", () => {
  it("creates an active person of the given role whose PIN opens a session (manager actor)", async () => {
    const tillId = await seedTill(suite.db, tenantId);
    const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");

    const { id } = await run((tx) =>
      createPerson(tx, {
        tenantId,
        managementSessionId: sessionId,
        displayName: "Bea",
        role: "supervisor",
        pin: "5678",
      }),
    );

    // The row landed active, with the requested role and name.
    const rows = await suite.db.execute<{ role: string; status: string; display_name: string }>(
      sql`select role, status, display_name from persons where id = ${id}`,
    );
    expect(rows.rows).toEqual([{ role: "supervisor", status: "active", display_name: "Bea" }]);

    // The stored hash verifies the given PIN end to end: loginWithPin (which checks the hash and the
    // active status) opens a session for the new person.
    const session = await run((tx) =>
      loginWithPin(tx, { tenantId, tillId, personId: id, pin: "5678" }),
    );
    expect(session).toEqual({
      id: expect.any(String),
      tenantId,
      personId: id,
      tillId,
      role: "supervisor",
      locale: null,
    });
  });

  it("throws authorization.not_permitted for a staff actor, writing nothing", async () => {
    const { sessionId: staffSession } = await openManagementSession(suite.db, tenantId, "staff");
    const before = await personCount();

    const code = await codeOf(() =>
      run((tx) =>
        createPerson(tx, {
          tenantId,
          managementSessionId: staffSession,
          displayName: "Ghost",
          role: "staff",
          pin: "5678",
        }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");

    // authorizeManager() runs before the insert, so a denied actor creates no row.
    expect(await personCount()).toBe(before);
  });

  it("throws pin.too_short for a PIN below MIN_PIN_LENGTH (manager actor)", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");
    const before = await personCount();

    // "12" is length 2, below MIN_PIN_LENGTH (4). The actor IS permitted, so only the length gate
    // can be the cause here.
    const code = await codeOf(() =>
      run((tx) =>
        createPerson(tx, {
          tenantId,
          managementSessionId: sessionId,
          displayName: "TooShort",
          role: "staff",
          pin: "12",
        }),
      ),
    );
    expect(code).toBe("pin.too_short");
    expect(await personCount()).toBe(before);
  });
});

describe("createPerson email", () => {
  it("stores a normalized (trimmed, lower-cased) email", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");
    const { id } = await run((tx) =>
      createPerson(tx, {
        tenantId,
        managementSessionId: sessionId,
        displayName: "Owner",
        role: "manager",
        pin: "5678",
        email: "  Owner@X.com  ",
      }),
    );
    expect(await emailOf(id)).toBe("owner@x.com");
  });

  it("rejects a malformed email with person.email_invalid, writing no row", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");
    const before = await personCount();
    const code = await codeOf(() =>
      run((tx) =>
        createPerson(tx, {
          tenantId,
          managementSessionId: sessionId,
          displayName: "Nope",
          role: "staff",
          pin: "5678",
          email: "nope",
        }),
      ),
    );
    expect(code).toBe("person.email_invalid");
    // The screen runs before the INSERT, so a malformed email creates no row.
    expect(await personCount()).toBe(before);
  });

  it("leaves email null when the param is omitted", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");
    const { id } = await run((tx) =>
      createPerson(tx, {
        tenantId,
        managementSessionId: sessionId,
        displayName: "PinOnly",
        role: "staff",
        pin: "5678",
      }),
    );
    expect(await emailOf(id)).toBeNull();
  });
});

describe("setEmail", () => {
  it("sets a normalized login email a manager can then sign in with", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");
    const target = await seedPerson(suite.db, tenantId, "supervisor");
    await run((tx) =>
      setEmail(tx, { managementSessionId: sessionId, personId: target, email: "  New@X.com " }),
    );
    expect(await emailOf(target)).toBe("new@x.com");
  });

  it("rejects a malformed email with person.email_invalid, leaving the email unchanged", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");
    const target = await seedPerson(suite.db, tenantId, "staff"); // email null
    const code = await codeOf(() =>
      run((tx) =>
        setEmail(tx, { managementSessionId: sessionId, personId: target, email: "nope" }),
      ),
    );
    expect(code).toBe("person.email_invalid");
    expect(await emailOf(target)).toBeNull();
  });

  it("throws authorization.not_permitted for a staff actor, leaving the email unchanged", async () => {
    const { sessionId: staffSession } = await openManagementSession(suite.db, tenantId, "staff");
    const target = await seedPerson(suite.db, tenantId, "staff"); // email null

    // A genuine staff management session, no person.manage: rewriting a colleague's login email (an
    // account-takeover vector) must be rejected before the UPDATE. "ok@x.com" is a valid email, so
    // ONLY the gate can be the cause here.
    const code = await codeOf(() =>
      run((tx) =>
        setEmail(tx, { managementSessionId: staffSession, personId: target, email: "ok@x.com" }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
    // authorizeManager() runs before the UPDATE, so a denied actor writes no email.
    expect(await emailOf(target)).toBeNull();
  });
});

// The duplicate-email → person.email_taken translation, proven end to end against the DB unique
// index in staff.email.test.ts (real Postgres). Here we pin the translator's two branches directly
// with crafted errors — no DB — so the re-throw branch is covered deterministically. asEmailTaken is
// exported from staff.ts for exactly this, not from the package barrel.
describe("asEmailTaken", () => {
  it("translates a Drizzle-wrapped unique violation (23505) to person.email_taken", () => {
    let thrown: unknown;
    try {
      asEmailTaken({ cause: { code: "23505" } }, "owner@x.com");
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("person.email_taken");
    expect(isAppError(thrown) && thrown.params).toEqual({ email: "owner@x.com" });
  });

  it("translates a 23505 whose constraint is persons_tenant_email_uq", () => {
    let thrown: unknown;
    try {
      asEmailTaken({ cause: { code: "23505", constraint: "persons_tenant_email_uq" } }, "o@x.com");
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("person.email_taken");
  });

  // A 23505 on a DIFFERENT persons constraint (the id PK, or any added later) must NOT be mislabelled
  // person.email_taken — it is re-thrown untouched. Proof-by-deletion: drop the constraint gate in
  // asEmailTaken and this fails (the error becomes person.email_taken). (Copilot, PR #172.)
  it("re-throws a 23505 whose constraint is not the email index", () => {
    const original = { cause: { code: "23505", constraint: "persons_pkey" } };
    let thrown: unknown;
    try {
      asEmailTaken(original, "owner@x.com");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });

  it("re-throws a non-unique error unchanged", () => {
    const original = { code: "42501" };
    let thrown: unknown;
    try {
      asEmailTaken(original, "owner@x.com");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });
});

describe("setRole", () => {
  it("changes the role, seen by a later authorize on an already-open session", async () => {
    const tillId = await seedTill(suite.db, tenantId);
    const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");
    const targetId = await seedPerson(suite.db, tenantId, "staff");
    const targetSessionId = await openSession(suite.db, tenantId, tillId, targetId);

    // As staff, the target holds no person.manage — its own session cannot authorize it.
    const before = await codeOf(() =>
      run((tx) => authorize(tx, { sessionId: targetSessionId, permission: "person.manage" })),
    );
    expect(before).toBe("authorization.not_permitted");

    await run((tx) =>
      setRole(tx, { managementSessionId: sessionId, personId: targetId, role: "manager" }),
    );

    // authorize reads the role live, so the SAME open session now authorizes on the operator's own
    // (upgraded) role — no override, authorizedBy the target.
    const after = await run((tx) =>
      authorize(tx, { sessionId: targetSessionId, permission: "person.manage" }),
    );
    expect(after).toEqual({
      authorizedBy: targetId,
      permission: "person.manage",
      viaOverride: false,
    });
  });

  it("throws authorization.not_permitted for a staff actor, leaving the role unchanged", async () => {
    const { sessionId: staffSession } = await openManagementSession(suite.db, tenantId, "staff");
    const targetId = await seedPerson(suite.db, tenantId, "staff");

    // A genuine staff management session (authenticates fine) but no person.manage — the escalation
    // attempt is staff→manager, so if the gate were absent the role would flip.
    const code = await codeOf(() =>
      run((tx) =>
        setRole(tx, { managementSessionId: staffSession, personId: targetId, role: "manager" }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");

    // authorizeManager() runs before the UPDATE, so a denied actor changes no role.
    expect((await personRow(targetId)).role).toBe("staff");
  });
});

describe("resetPin", () => {
  it("replaces the PIN: the new PIN logs in, the old one no longer does", async () => {
    const tillId = await seedTill(suite.db, tenantId);
    const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");
    const targetId = await seedPerson(suite.db, tenantId, "staff"); // PIN "1234"

    await run((tx) =>
      resetPin(tx, { managementSessionId: sessionId, personId: targetId, pin: "8765" }),
    );

    const session = await run((tx) =>
      loginWithPin(tx, { tenantId, tillId, personId: targetId, pin: "8765" }),
    );
    expect(session).toEqual({
      id: expect.any(String),
      tenantId,
      personId: targetId,
      tillId,
      role: "staff",
      locale: null,
    });

    const oldPin = await codeOf(() =>
      run((tx) => loginWithPin(tx, { tenantId, tillId, personId: targetId, pin: "1234" })),
    );
    expect(oldPin).toBe("pin.invalid");
  });

  it("throws pin.too_short for a PIN below MIN_PIN_LENGTH, leaving the hash unchanged (manager actor)", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");
    const targetId = await seedPerson(suite.db, tenantId, "staff");
    const before = (await personRow(targetId)).pin_hash;

    const code = await codeOf(() =>
      run((tx) => resetPin(tx, { managementSessionId: sessionId, personId: targetId, pin: "1" })),
    );
    expect(code).toBe("pin.too_short");

    // The actor IS permitted; the length gate rejects before the UPDATE, so the stored hash is intact.
    expect((await personRow(targetId)).pin_hash).toBe(before);
  });

  it("throws authorization.not_permitted for a staff actor, leaving the hash unchanged", async () => {
    const { sessionId: staffSession } = await openManagementSession(suite.db, tenantId, "staff");
    const targetId = await seedPerson(suite.db, tenantId, "staff");
    const before = (await personRow(targetId)).pin_hash;

    // A genuine staff management session, no person.manage: an account-takeover attempt (rewrite the
    // target's PIN) must be rejected before the UPDATE.
    const code = await codeOf(() =>
      run((tx) =>
        resetPin(tx, { managementSessionId: staffSession, personId: targetId, pin: "9999" }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");

    expect((await personRow(targetId)).pin_hash).toBe(before);
  });
});

describe("setPassword", () => {
  it("setPassword lets a manager grant dashboard access, then that person can log in", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");
    const target = await seedPerson(suite.db, tenantId, "supervisor");
    // The target needs an email to sign in on the dashboard: loginManager now resolves by email.
    await run((tx) =>
      tx.execute(sql`update persons set email = 'granted@x.com' where id = ${target}`),
    );
    await run((tx) =>
      setPassword(tx, {
        managementSessionId: sessionId,
        personId: target,
        password: "second horse",
      }),
    );
    const session = await run((tx) =>
      loginManager(tx, { tenantId, email: "granted@x.com", password: "second horse" }),
    );
    expect(session.personId).toBe(target);
  });

  it("setPassword rejects a too-short password", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");
    const target = await seedPerson(suite.db, tenantId, "staff");
    const code = await run((tx) =>
      codeOf(() =>
        setPassword(tx, { managementSessionId: sessionId, personId: target, password: "short" }),
      ),
    );
    expect(code).toBe("password.too_short");
  });

  it("setPassword throws authorization.not_permitted for a staff actor, leaving password_hash unchanged", async () => {
    const { sessionId: staffSession } = await openManagementSession(suite.db, tenantId, "staff");
    const targetId = await seedPerson(suite.db, tenantId, "staff"); // password_hash null
    const before = (await personRow(targetId)).password_hash;

    // A genuine staff management session, no person.manage: granting a colleague dashboard access (a
    // privilege-escalation vector) must be rejected before the UPDATE. "second horse" is a
    // valid-length password, so ONLY the gate can be the cause here.
    const code = await codeOf(() =>
      run((tx) =>
        setPassword(tx, {
          managementSessionId: staffSession,
          personId: targetId,
          password: "second horse",
        }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");

    // authorizeManager() runs before the UPDATE, so a denied actor writes no password.
    expect((await personRow(targetId)).password_hash).toBe(before);
  });
});

describe("suspendPerson / reactivatePerson", () => {
  it("suspend blocks login; reactivate restores it", async () => {
    const tillId = await seedTill(suite.db, tenantId);
    const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");
    const targetId = await seedPerson(suite.db, tenantId, "staff"); // active, PIN "1234"

    // Active to begin with: login works.
    await run((tx) => loginWithPin(tx, { tenantId, tillId, personId: targetId, pin: "1234" }));

    await run((tx) => suspendPerson(tx, { managementSessionId: sessionId, personId: targetId }));
    const suspended = await codeOf(() =>
      run((tx) => loginWithPin(tx, { tenantId, tillId, personId: targetId, pin: "1234" })),
    );
    expect(suspended).toBe("person.suspended");

    await run((tx) => reactivatePerson(tx, { managementSessionId: sessionId, personId: targetId }));
    const session = await run((tx) =>
      loginWithPin(tx, { tenantId, tillId, personId: targetId, pin: "1234" }),
    );
    expect(session).toEqual({
      id: expect.any(String),
      tenantId,
      personId: targetId,
      tillId,
      role: "staff",
      locale: null,
    });
  });

  it("suspendPerson throws authorization.not_permitted for a staff actor, leaving status active", async () => {
    const { sessionId: staffSession } = await openManagementSession(suite.db, tenantId, "staff");
    const targetId = await seedPerson(suite.db, tenantId, "staff"); // active

    // A genuine staff management session, no person.manage: a lockout attempt (suspend a colleague)
    // must be rejected before the UPDATE, so the target stays active.
    const code = await codeOf(() =>
      run((tx) => suspendPerson(tx, { managementSessionId: staffSession, personId: targetId })),
    );
    expect(code).toBe("authorization.not_permitted");

    expect((await personRow(targetId)).status).toBe("active");
  });

  it("reactivatePerson throws authorization.not_permitted for a staff actor, leaving status suspended", async () => {
    const { sessionId: staffSession } = await openManagementSession(suite.db, tenantId, "staff");
    // A SUSPENDED target so reactivate would be a real change (active would hide a missing gate).
    const targetId = await seedPerson(suite.db, tenantId, "staff", "suspended");

    const code = await codeOf(() =>
      run((tx) => reactivatePerson(tx, { managementSessionId: staffSession, personId: targetId })),
    );
    expect(code).toBe("authorization.not_permitted");

    // The gate rejects before the UPDATE, so an unauthorised actor cannot un-suspend anyone.
    expect((await personRow(targetId)).status).toBe("suspended");
  });
});

describe("listActiveStaff", () => {
  it("returns active persons' id + name, sorted, no secrets", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");

    // Insert Zoe BEFORE Ana so an Ana-first result proves the orderBy(displayName), not insertion
    // order. "Gone" is created then suspended: it must NOT appear.
    const zoe = await run((tx) =>
      createPerson(tx, {
        tenantId,
        managementSessionId: sessionId,
        displayName: "Zoe",
        role: "staff",
        pin: "4444",
      }),
    );
    const ana = await run((tx) =>
      createPerson(tx, {
        tenantId,
        managementSessionId: sessionId,
        displayName: "Ana",
        role: "supervisor",
        pin: "5555",
      }),
    );
    const gone = await run((tx) =>
      createPerson(tx, {
        tenantId,
        managementSessionId: sessionId,
        displayName: "Gone",
        role: "staff",
        pin: "6666",
      }),
    );
    await run((tx) => suspendPerson(tx, { managementSessionId: sessionId, personId: gone.id }));

    const staff = await run((tx) => listActiveStaff(tx));

    // This file shares one PGlite db + tenant across every describe block, and `listActiveStaff`
    // reads every active person in the tenant — the roster therefore also carries persons the other
    // describes seeded. Restrict to the cohort THIS test created, the way
    // the sibling suites read specific rows by id, so the assertion is order-independent.
    const mine = new Set([zoe.id, ana.id, gone.id]);
    const cohort = staff.filter((s) => mine.has(s.personId));

    // Active only, name-sorted: Ana before Zoe though Zoe was inserted first; suspended "Gone" gone.
    expect(cohort.map((s) => s.displayName)).toEqual(["Ana", "Zoe"]);
    // Only id + name reach the pre-login lock screen: no pinHash, no role, no status.
    expect(Object.keys(cohort[0]!)).toEqual(["personId", "displayName"]);
  });
});

describe("listPersons", () => {
  it("listPersons returns a roster with credential booleans, no secrets", async () => {
    const { sessionId, personId: manager } = await openManagementSession(
      suite.db,
      tenantId,
      "manager",
    );
    await run((tx) =>
      createPerson(tx, {
        tenantId,
        managementSessionId: sessionId,
        displayName: "Ada",
        role: "staff",
        pin: "4321",
      }),
    );
    const roster = await run((tx) => listPersons(tx, { managementSessionId: sessionId }));
    const names = roster.map((p) => p.displayName);
    expect(names).toContain("Ada");
    const self = roster.find((p) => p.personId === manager)!;
    expect(self.hasPassword).toBe(true);
    expect(self.hasTotp).toBe(false);
    expect(Object.keys(roster[0]!)).toEqual(
      expect.arrayContaining([
        "personId",
        "displayName",
        "role",
        "status",
        "hasPassword",
        "hasTotp",
      ]),
    );
    expect(JSON.stringify(roster)).not.toContain("scrypt$");
  });

  it("projects each person's email — the stored value, and null when unset", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");
    const withEmail = await run((tx) =>
      createPerson(tx, {
        tenantId,
        managementSessionId: sessionId,
        displayName: "Mailed",
        role: "supervisor",
        pin: "4321",
        email: "mailed@x.com",
      }),
    );
    const withoutEmail = await run((tx) =>
      createPerson(tx, {
        tenantId,
        managementSessionId: sessionId,
        displayName: "Unmailed",
        role: "staff",
        pin: "4321",
      }),
    );

    const roster = await run((tx) => listPersons(tx, { managementSessionId: sessionId }));
    expect(roster.find((p) => p.personId === withEmail.id)!.email).toBe("mailed@x.com");
    expect(roster.find((p) => p.personId === withoutEmail.id)!.email).toBeNull();
    // email is part of the summary shape.
    expect(Object.keys(roster[0]!)).toEqual(expect.arrayContaining(["email"]));
  });

  it("listPersons refuses a staff role", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "staff");
    const code = await run((tx) =>
      codeOf(() => listPersons(tx, { managementSessionId: sessionId })),
    );
    expect(code).toBe("authorization.not_permitted");
  });
});

describe("MIN_PIN_LENGTH", () => {
  it("is 4 — the POS keypad floor", () => {
    expect(MIN_PIN_LENGTH).toBe(4);
  });
});
