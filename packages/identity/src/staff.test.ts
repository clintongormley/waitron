import { CORE_MIGRATIONS, refusalError, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
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

// The staff-admin API is LOGIC gated on authorizeManager() — the person.manage check, the
// PIN-length assertion, and the role/status writes — which is what the cases below assert.

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

// `Promise<T> | T`, the widening `withTransaction` itself took (`packages/db/src/tenancy.ts`):
// `tx.execute` is synchronous on this engine and a `Promise<T>`-only parameter refuses it.
function run<T>(fn: (tx: Transaction) => Promise<T> | T): Promise<T> {
  return withTransaction(suite.db, fn);
}

// No cast on the count. The `::int` this carried was refused before the statement ran —
// `unrecognized token: ":"`, because a colon opens a bind parameter to SQLite's parser. It was
// there to turn the PostgreSQL driver's BigInt into a number; measured on node v26.7.0, this driver
// hands `select count(*)` back as a JavaScript number already (`3`, `typeof "number"`).
async function personCount(): Promise<number> {
  const rows = await suite.db.execute<{ n: number }>(sql`select count(*) as n from persons`);
  return rows.rows[0]!.n;
}

// The mutable columns the staff-admin API writes. A gate that rejects BEFORE its write leaves every
// one of these unchanged.
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

// The stored login email.
async function emailOf(id: string): Promise<string | null> {
  const rows = await suite.db.execute<{ email: string | null }>(
    sql`select email from persons where id = ${id}`,
  );
  return rows.rows[0]!.email;
}

describe("createPerson", () => {
  it("creates an active person of the given role whose PIN opens a session (manager actor)", async () => {
    const tillId = await seedTill(suite.db);
    const { sessionId } = await openManagementSession(suite.db, "manager");

    const { id } = await run((tx) =>
      createPerson(tx, {
        managementSessionId: sessionId,
        displayName: "Bea",
        role: "supervisor",
        pin: "5678",
        email: "bea@x.com",
      }),
    );

    // The row landed active, with the requested role and name.
    const rows = await suite.db.execute<{ role: string; status: string; display_name: string }>(
      sql`select role, status, display_name from persons where id = ${id}`,
    );
    expect(rows.rows).toEqual([{ role: "supervisor", status: "active", display_name: "Bea" }]);

    // The stored hash verifies the given PIN end to end: loginWithPin (which checks the hash and the
    // active status) opens a session for the new person.
    const session = await run((tx) => loginWithPin(tx, { tillId, personId: id, pin: "5678" }));
    expect(session).toEqual({
      id: expect.any(String),
      personId: id,
      tillId,
      role: "supervisor",
      locale: null,
    });
  });

  it("throws authorization.not_permitted for a staff actor, writing nothing", async () => {
    const { sessionId: staffSession } = await openManagementSession(suite.db, "staff");
    const before = await personCount();

    const code = await codeOf(() =>
      run((tx) =>
        createPerson(tx, {
          managementSessionId: staffSession,
          displayName: "Ghost",
          role: "staff",
          pin: "5678",
          email: "ghost@x.com",
        }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");

    // authorizeManager() runs before the insert, so a denied actor creates no row.
    expect(await personCount()).toBe(before);
  });

  it("throws pin.too_short for a PIN below MIN_PIN_LENGTH (manager actor)", async () => {
    const { sessionId } = await openManagementSession(suite.db, "manager");
    const before = await personCount();

    // "12" is length 2, below MIN_PIN_LENGTH (4). The actor IS permitted, so only the length gate
    // can be the cause here.
    const code = await codeOf(() =>
      run((tx) =>
        createPerson(tx, {
          managementSessionId: sessionId,
          displayName: "TooShort",
          role: "staff",
          pin: "12",
          email: "too-short@x.com",
        }),
      ),
    );
    expect(code).toBe("pin.too_short");
    expect(await personCount()).toBe(before);
  });
});

describe("createPerson email", () => {
  it("stores a normalized (trimmed, lower-cased) email", async () => {
    const { sessionId } = await openManagementSession(suite.db, "manager");
    const { id } = await run((tx) =>
      createPerson(tx, {
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
    const { sessionId } = await openManagementSession(suite.db, "manager");
    const before = await personCount();
    const code = await codeOf(() =>
      run((tx) =>
        createPerson(tx, {
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

  it("rejects an omitted email with person.email_invalid, writing no row", async () => {
    const { sessionId } = await openManagementSession(suite.db, "manager");
    const before = await personCount();
    const code = await codeOf(() =>
      run((tx) =>
        createPerson(tx, {
          managementSessionId: sessionId,
          displayName: "PinOnly",
          role: "staff",
          pin: "5678",
        } as Parameters<typeof createPerson>[1]),
      ),
    );
    expect(code).toBe("person.email_invalid");
    expect(await personCount()).toBe(before);
  });
});

describe("setEmail", () => {
  it("sets a normalized login email a manager can then sign in with", async () => {
    const { sessionId } = await openManagementSession(suite.db, "manager");
    const target = await seedPerson(suite.db, "supervisor");
    await run((tx) =>
      setEmail(tx, { managementSessionId: sessionId, personId: target, email: "  New@X.com " }),
    );
    expect(await emailOf(target)).toBe("new@x.com");
  });

  it("rejects a malformed email with person.email_invalid, leaving the email unchanged", async () => {
    const { sessionId } = await openManagementSession(suite.db, "manager");
    const target = await seedPerson(suite.db, "staff"); // email null
    const code = await codeOf(() =>
      run((tx) =>
        setEmail(tx, { managementSessionId: sessionId, personId: target, email: "nope" }),
      ),
    );
    expect(code).toBe("person.email_invalid");
    expect(await emailOf(target)).toBeNull();
  });

  it("throws authorization.not_permitted for a staff actor, leaving the email unchanged", async () => {
    const { sessionId: staffSession } = await openManagementSession(suite.db, "staff");
    const target = await seedPerson(suite.db, "staff"); // email null

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
// index in staff.email.test.ts, and against one real refusal per `persons` index — the three
// expression indexes and the plain-column control — in person-constraints.db.test.ts. Here we pin
// the translator's branches directly with crafted errors — no DB — so each re-throw branch is
// covered deterministically, including shapes a real collision cannot easily produce.
//
// Each crafted refusal comes from `refusalError`, whose own suite holds it equal to the engine's.
// Four of these five cases assert a re-throw, which a matcher that can never match also passes, so
// the one translating case is what shows the matcher reads these shapes at all.
// asEmailTaken is exported from staff.ts for exactly this, not from the package barrel.
describe("asEmailTaken", () => {
  // A layer carrying the result code and no message at all: the engine always writes one, but a
  // wrapper in the chain need not re-expose it, and `indexViolated` must not read that as a match.
  it("re-throws a wrapped unique violation that names no index", () => {
    const original = { cause: { errcode: 2067 } };
    let thrown: unknown;
    try {
      asEmailTaken(original, "owner@x.com");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });

  it("translates a collision on the login-email index", () => {
    let thrown: unknown;
    try {
      asEmailTaken({ cause: refusalError({ uniqueIndex: "persons_tenant_email_uq" }) }, "o@x.com");
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown) && thrown.code).toBe("person.email_taken");
  });

  // A unique violation on a DIFFERENT persons key (the id PK here, or any index added later) must
  // NOT be mislabelled person.email_taken — it is re-thrown untouched. Proof-by-deletion: drop the
  // index gate in asEmailTaken and this fails (the error becomes person.email_taken). (Copilot,
  // PR #172.) The primary key arrives under its own result code and names the table and column
  // rather than an index.
  it("re-throws a unique violation on a persons key that is not the email index", () => {
    const original = {
      cause: refusalError({ primaryKey: { table: "persons", column: "id" } }),
    };
    let thrown: unknown;
    try {
      asEmailTaken(original, "owner@x.com");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });

  // A collision on another table's email index is not this refusal. The index's NAME is the
  // discriminator, and it identifies the table because SQLite keeps every index in one namespace
  // per database — a second `CREATE UNIQUE INDEX persons_tenant_email_uq` on another table is
  // refused `index persons_tenant_email_uq already exists` (driven 2026-09-23 on node:sqlite, Node
  // v26.7.0).
  it("re-throws a collision on another table's email index", () => {
    const original = {
      cause: refusalError({ uniqueIndex: "invitees_email_uq" }),
    };
    let thrown: unknown;
    try {
      asEmailTaken(original, "owner@x.com");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });

  // Not a unique violation at all: a NOT NULL refusal (1299) on the same table. `indexViolated`
  // asks the CLASS as well as the name, so this can never be read as an index collision.
  it("re-throws a non-unique error unchanged", () => {
    const original = {
      cause: refusalError({ notNull: { table: "persons", column: "display_name" } }),
    };
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
    const tillId = await seedTill(suite.db);
    const { sessionId } = await openManagementSession(suite.db, "manager");
    const targetId = await seedPerson(suite.db, "staff");
    const targetSessionId = await openSession(suite.db, tillId, targetId);

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
    const { sessionId: staffSession } = await openManagementSession(suite.db, "staff");
    const targetId = await seedPerson(suite.db, "staff");

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
    const tillId = await seedTill(suite.db);
    const { sessionId } = await openManagementSession(suite.db, "manager");
    const targetId = await seedPerson(suite.db, "staff"); // PIN "1234"

    await run((tx) =>
      resetPin(tx, { managementSessionId: sessionId, personId: targetId, pin: "8765" }),
    );

    const session = await run((tx) =>
      loginWithPin(tx, { tillId, personId: targetId, pin: "8765" }),
    );
    expect(session).toEqual({
      id: expect.any(String),
      personId: targetId,
      tillId,
      role: "staff",
      locale: null,
    });

    const oldPin = await codeOf(() =>
      run((tx) => loginWithPin(tx, { tillId, personId: targetId, pin: "1234" })),
    );
    expect(oldPin).toBe("pin.invalid");
  });

  it("throws pin.too_short for a PIN below MIN_PIN_LENGTH, leaving the hash unchanged (manager actor)", async () => {
    const { sessionId } = await openManagementSession(suite.db, "manager");
    const targetId = await seedPerson(suite.db, "staff");
    const before = (await personRow(targetId)).pin_hash;

    const code = await codeOf(() =>
      run((tx) => resetPin(tx, { managementSessionId: sessionId, personId: targetId, pin: "1" })),
    );
    expect(code).toBe("pin.too_short");

    // The actor IS permitted; the length gate rejects before the UPDATE, so the stored hash is intact.
    expect((await personRow(targetId)).pin_hash).toBe(before);
  });

  it("throws authorization.not_permitted for a staff actor, leaving the hash unchanged", async () => {
    const { sessionId: staffSession } = await openManagementSession(suite.db, "staff");
    const targetId = await seedPerson(suite.db, "staff");
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
    const { sessionId } = await openManagementSession(suite.db, "manager");
    const target = await seedPerson(suite.db, "supervisor");
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
      loginManager(tx, { email: "granted@x.com", password: "second horse" }),
    );
    expect(session.personId).toBe(target);
  });

  it("setPassword rejects a too-short password", async () => {
    const { sessionId } = await openManagementSession(suite.db, "manager");
    const target = await seedPerson(suite.db, "staff");
    const code = await run((tx) =>
      codeOf(() =>
        setPassword(tx, { managementSessionId: sessionId, personId: target, password: "short" }),
      ),
    );
    expect(code).toBe("password.too_short");
  });

  it("setPassword throws authorization.not_permitted for a staff actor, leaving password_hash unchanged", async () => {
    const { sessionId: staffSession } = await openManagementSession(suite.db, "staff");
    const targetId = await seedPerson(suite.db, "staff"); // password_hash null
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
  it.each(["manager", "admin"] as const)(
    "prevents a %s from suspending themselves",
    async (role) => {
      const { sessionId, personId } = await openManagementSession(suite.db, role);
      expect(
        await codeOf(() =>
          run((tx) => suspendPerson(tx, { managementSessionId: sessionId, personId })),
        ),
      ).toBe("person.self_deactivation");
      expect((await personRow(personId)).status).toBe("active");
    },
  );

  it("rejects self-deactivation with an uppercase account ID", async () => {
    const { sessionId, personId } = await openManagementSession(suite.db, "admin");
    expect(
      await codeOf(() =>
        run((tx) =>
          suspendPerson(tx, { managementSessionId: sessionId, personId: personId.toUpperCase() }),
        ),
      ),
    ).toBe("person.self_deactivation");
    expect((await personRow(personId)).status).toBe("active");
  });

  // The other half of the case above, and the half that used to be SILENT. The self-check folded
  // the id's case and the UPDATE did not, so an upper-case id naming somebody else matched no row:
  // nobody was suspended, and nothing was thrown. `persons.id` is plain text now and compares byte
  // for byte (`settleId`, staff.ts, carries the measurement). Proof-by-deletion: drop `settleId`
  // from `suspendPerson`'s `where` and this case fails on the status while the case above, which
  // only exercises the comparison, still passes.
  it("suspends another person whose id arrived in upper case", async () => {
    const { sessionId } = await openManagementSession(suite.db, "manager");
    const targetId = await seedPerson(suite.db, "staff");
    await run((tx) =>
      suspendPerson(tx, { managementSessionId: sessionId, personId: targetId.toUpperCase() }),
    );
    expect((await personRow(targetId)).status).toBe("suspended");
  });

  it("suspend blocks login; reactivate restores it", async () => {
    const tillId = await seedTill(suite.db);
    const { sessionId } = await openManagementSession(suite.db, "manager");
    const targetId = await seedPerson(suite.db, "staff"); // active, PIN "1234"

    // Active to begin with: login works.
    await run((tx) => loginWithPin(tx, { tillId, personId: targetId, pin: "1234" }));

    await run((tx) => suspendPerson(tx, { managementSessionId: sessionId, personId: targetId }));
    const suspended = await codeOf(() =>
      run((tx) => loginWithPin(tx, { tillId, personId: targetId, pin: "1234" })),
    );
    expect(suspended).toBe("person.suspended");

    await run((tx) => reactivatePerson(tx, { managementSessionId: sessionId, personId: targetId }));
    const session = await run((tx) =>
      loginWithPin(tx, { tillId, personId: targetId, pin: "1234" }),
    );
    expect(session).toEqual({
      id: expect.any(String),
      personId: targetId,
      tillId,
      role: "staff",
      locale: null,
    });
  });

  it("suspendPerson throws authorization.not_permitted for a staff actor, leaving status active", async () => {
    const { sessionId: staffSession } = await openManagementSession(suite.db, "staff");
    const targetId = await seedPerson(suite.db, "staff"); // active

    // A genuine staff management session, no person.manage: a lockout attempt (suspend a colleague)
    // must be rejected before the UPDATE, so the target stays active.
    const code = await codeOf(() =>
      run((tx) => suspendPerson(tx, { managementSessionId: staffSession, personId: targetId })),
    );
    expect(code).toBe("authorization.not_permitted");

    expect((await personRow(targetId)).status).toBe("active");
  });

  it("reactivatePerson throws authorization.not_permitted for a staff actor, leaving status suspended", async () => {
    const { sessionId: staffSession } = await openManagementSession(suite.db, "staff");
    // A SUSPENDED target so reactivate would be a real change (active would hide a missing gate).
    const targetId = await seedPerson(suite.db, "staff", "suspended");

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
    const { sessionId } = await openManagementSession(suite.db, "manager");

    // Insert Zoe BEFORE Ana so an Ana-first result proves the orderBy(displayName), not insertion
    // order. "Gone" is created then suspended: it must NOT appear.
    const zoe = await run((tx) =>
      createPerson(tx, {
        managementSessionId: sessionId,
        displayName: "Zoe",
        role: "staff",
        pin: "4444",
        email: "zoe@x.com",
      }),
    );
    const ana = await run((tx) =>
      createPerson(tx, {
        managementSessionId: sessionId,
        displayName: "Ana",
        role: "supervisor",
        pin: "5555",
        email: "ana@x.com",
      }),
    );
    const gone = await run((tx) =>
      createPerson(tx, {
        managementSessionId: sessionId,
        displayName: "Gone",
        role: "staff",
        pin: "6666",
        email: "gone@x.com",
      }),
    );
    await run((tx) => suspendPerson(tx, { managementSessionId: sessionId, personId: gone.id }));

    const staff = await run((tx) => listActiveStaff(tx));

    // This file shares one database across every describe block, and `listActiveStaff`
    // reads every active person — the roster therefore also carries persons the other
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
    const { sessionId, personId: manager } = await openManagementSession(suite.db, "manager");
    await run((tx) =>
      createPerson(tx, {
        managementSessionId: sessionId,
        displayName: "Ada",
        role: "staff",
        pin: "4321",
        email: "ada-list@x.com",
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

  it("projects every created person's required email", async () => {
    const { sessionId } = await openManagementSession(suite.db, "manager");
    const withEmail = await run((tx) =>
      createPerson(tx, {
        managementSessionId: sessionId,
        displayName: "Mailed",
        role: "supervisor",
        pin: "4321",
        email: "mailed@x.com",
      }),
    );
    const second = await run((tx) =>
      createPerson(tx, {
        managementSessionId: sessionId,
        displayName: "Unmailed",
        role: "staff",
        pin: "4321",
        email: "second@x.com",
      }),
    );

    const roster = await run((tx) => listPersons(tx, { managementSessionId: sessionId }));
    expect(roster.find((p) => p.personId === withEmail.id)!.email).toBe("mailed@x.com");
    expect(roster.find((p) => p.personId === second.id)!.email).toBe("second@x.com");
    // email is part of the summary shape.
    expect(Object.keys(roster[0]!)).toEqual(expect.arrayContaining(["email"]));
  });

  it("listPersons refuses a staff role", async () => {
    const { sessionId } = await openManagementSession(suite.db, "staff");
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
