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

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

// `Promise<T> | T`: `tx.execute` is synchronous on this engine.
function run<T>(fn: (tx: Transaction) => Promise<T> | T): Promise<T> {
  return withTransaction(suite.db, fn);
}

async function personCount(): Promise<number> {
  const rows = await suite.db.execute<{ n: number }>(sql`select count(*) as n from persons`);
  return rows.rows[0]!.n;
}

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

async function emailOf(id: string): Promise<string | null> {
  const rows = await suite.db.execute<{ email: string | null }>(
    sql`select email from persons where id = ${id}`,
  );
  return rows.rows[0]!.email;
}

describe("createPerson", () => {
  it("creates an active person of the given role whose PIN opens a session (manager actor)", async () => {
    const tillId = await seedTill(suite.db);
    const { token } = await openManagementSession(suite.db, "manager");

    const { id } = await run((tx) =>
      createPerson(tx, {
        managementSessionId: token,
        displayName: "Bea",
        role: "supervisor",
        pin: "5678",
        email: "bea@x.com",
      }),
    );

    const rows = await suite.db.execute<{ role: string; status: string; display_name: string }>(
      sql`select role, status, display_name from persons where id = ${id}`,
    );
    expect(rows.rows).toEqual([{ role: "supervisor", status: "active", display_name: "Bea" }]);

    const session = await run((tx) => loginWithPin(tx, { tillId, personId: id, pin: "5678" }));
    expect(session).toEqual({
      id: expect.any(String),
      token: expect.any(String),
      personId: id,
      tillId,
      role: "supervisor",
      locale: null,
    });
  });

  it("throws authorization.not_permitted for a staff actor, writing nothing", async () => {
    const { token: staffSession } = await openManagementSession(suite.db, "staff");
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
    expect(await personCount()).toBe(before);
  });

  it("throws pin.too_short for a PIN below MIN_PIN_LENGTH (manager actor)", async () => {
    const { token } = await openManagementSession(suite.db, "manager");
    const before = await personCount();

    // The actor IS permitted, so only the length gate can be the cause here.
    const code = await codeOf(() =>
      run((tx) =>
        createPerson(tx, {
          managementSessionId: token,
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
    const { token } = await openManagementSession(suite.db, "manager");
    const { id } = await run((tx) =>
      createPerson(tx, {
        managementSessionId: token,
        displayName: "Owner",
        role: "manager",
        pin: "5678",
        email: "  Owner@X.com  ",
      }),
    );
    expect(await emailOf(id)).toBe("owner@x.com");
  });

  it("rejects a malformed email with person.email_invalid, writing no row", async () => {
    const { token } = await openManagementSession(suite.db, "manager");
    const before = await personCount();
    const code = await codeOf(() =>
      run((tx) =>
        createPerson(tx, {
          managementSessionId: token,
          displayName: "Nope",
          role: "staff",
          pin: "5678",
          email: "nope",
        }),
      ),
    );
    expect(code).toBe("person.email_invalid");
    expect(await personCount()).toBe(before);
  });

  it("rejects an omitted email with person.email_invalid, writing no row", async () => {
    const { token } = await openManagementSession(suite.db, "manager");
    const before = await personCount();
    const code = await codeOf(() =>
      run((tx) =>
        createPerson(tx, {
          managementSessionId: token,
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
    const { token } = await openManagementSession(suite.db, "manager");
    const target = await seedPerson(suite.db, "supervisor");
    await run((tx) =>
      setEmail(tx, { managementSessionId: token, personId: target, email: "  New@X.com " }),
    );
    expect(await emailOf(target)).toBe("new@x.com");
  });

  it("rejects a malformed email with person.email_invalid, leaving the email unchanged", async () => {
    const { token } = await openManagementSession(suite.db, "manager");
    const target = await seedPerson(suite.db, "staff"); // email null
    const code = await codeOf(() =>
      run((tx) => setEmail(tx, { managementSessionId: token, personId: target, email: "nope" })),
    );
    expect(code).toBe("person.email_invalid");
    expect(await emailOf(target)).toBeNull();
  });

  it("throws authorization.not_permitted for a staff actor, leaving the email unchanged", async () => {
    const { token: staffSession } = await openManagementSession(suite.db, "staff");
    const target = await seedPerson(suite.db, "staff"); // email null

    // "ok@x.com" is a valid email, so ONLY the gate can be the cause here.
    const code = await codeOf(() =>
      run((tx) =>
        setEmail(tx, { managementSessionId: staffSession, personId: target, email: "ok@x.com" }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
    expect(await emailOf(target)).toBeNull();
  });
});

// Four of these five cases assert a re-throw, which a matcher that can never match also passes, so
// the one translating case is what shows the matcher reads these shapes at all.
describe("asEmailTaken", () => {
  // A wrapper in the chain need not re-expose the engine's message.
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

  // The index's NAME identifies the table because SQLite keeps every index in one namespace per
  // database.
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
    const { token } = await openManagementSession(suite.db, "manager");
    const targetId = await seedPerson(suite.db, "staff");
    const targetSessionId = await openSession(suite.db, tillId, targetId);

    const before = await codeOf(() =>
      run((tx) => authorize(tx, { sessionId: targetSessionId, permission: "person.manage" })),
    );
    expect(before).toBe("authorization.not_permitted");

    await run((tx) =>
      setRole(tx, { managementSessionId: token, personId: targetId, role: "manager" }),
    );

    // authorize reads the role live, so the SAME open session now authorizes.
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
    const { token: staffSession } = await openManagementSession(suite.db, "staff");
    const targetId = await seedPerson(suite.db, "staff");

    const code = await codeOf(() =>
      run((tx) =>
        setRole(tx, { managementSessionId: staffSession, personId: targetId, role: "manager" }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
    expect((await personRow(targetId)).role).toBe("staff");
  });
});

describe("resetPin", () => {
  it("replaces the PIN: the new PIN logs in, the old one no longer does", async () => {
    const tillId = await seedTill(suite.db);
    const { token } = await openManagementSession(suite.db, "manager");
    const targetId = await seedPerson(suite.db, "staff"); // PIN "1234"

    await run((tx) =>
      resetPin(tx, { managementSessionId: token, personId: targetId, pin: "8765" }),
    );

    const session = await run((tx) =>
      loginWithPin(tx, { tillId, personId: targetId, pin: "8765" }),
    );
    expect(session).toEqual({
      id: expect.any(String),
      token: expect.any(String),
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
    const { token } = await openManagementSession(suite.db, "manager");
    const targetId = await seedPerson(suite.db, "staff");
    const before = (await personRow(targetId)).pin_hash;

    const code = await codeOf(() =>
      run((tx) => resetPin(tx, { managementSessionId: token, personId: targetId, pin: "1" })),
    );
    expect(code).toBe("pin.too_short");
    expect((await personRow(targetId)).pin_hash).toBe(before);
  });

  it("throws authorization.not_permitted for a staff actor, leaving the hash unchanged", async () => {
    const { token: staffSession } = await openManagementSession(suite.db, "staff");
    const targetId = await seedPerson(suite.db, "staff");
    const before = (await personRow(targetId)).pin_hash;

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
    const { token } = await openManagementSession(suite.db, "manager");
    const target = await seedPerson(suite.db, "supervisor");
    // loginManager resolves by email.
    await run((tx) =>
      tx.execute(sql`update persons set email = 'granted@x.com' where id = ${target}`),
    );
    await run((tx) =>
      setPassword(tx, {
        managementSessionId: token,
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
    const { token } = await openManagementSession(suite.db, "manager");
    const target = await seedPerson(suite.db, "staff");
    const code = await run((tx) =>
      codeOf(() =>
        setPassword(tx, { managementSessionId: token, personId: target, password: "short" }),
      ),
    );
    expect(code).toBe("password.too_short");
  });

  it("setPassword throws authorization.not_permitted for a staff actor, leaving password_hash unchanged", async () => {
    const { token: staffSession } = await openManagementSession(suite.db, "staff");
    const targetId = await seedPerson(suite.db, "staff"); // password_hash null
    const before = (await personRow(targetId)).password_hash;

    // "second horse" is a valid-length password, so ONLY the gate can be the cause here.
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
    expect((await personRow(targetId)).password_hash).toBe(before);
  });
});

describe("suspendPerson / reactivatePerson", () => {
  it.each(["manager", "admin"] as const)(
    "prevents a %s from suspending themselves",
    async (role) => {
      const { token, personId } = await openManagementSession(suite.db, role);
      expect(
        await codeOf(() =>
          run((tx) => suspendPerson(tx, { managementSessionId: token, personId })),
        ),
      ).toBe("person.self_deactivation");
      expect((await personRow(personId)).status).toBe("active");
    },
  );

  it("rejects self-deactivation with an uppercase account ID", async () => {
    const { token, personId } = await openManagementSession(suite.db, "admin");
    expect(
      await codeOf(() =>
        run((tx) =>
          suspendPerson(tx, { managementSessionId: token, personId: personId.toUpperCase() }),
        ),
      ),
    ).toBe("person.self_deactivation");
    expect((await personRow(personId)).status).toBe("active");
  });

  // The case above exercises only the self-check; this one needs the UPDATE to fold the id's case.
  it("suspends another person whose id arrived in upper case", async () => {
    const { token } = await openManagementSession(suite.db, "manager");
    const targetId = await seedPerson(suite.db, "staff");
    await run((tx) =>
      suspendPerson(tx, { managementSessionId: token, personId: targetId.toUpperCase() }),
    );
    expect((await personRow(targetId)).status).toBe("suspended");
  });

  it("suspend blocks login; reactivate restores it", async () => {
    const tillId = await seedTill(suite.db);
    const { token } = await openManagementSession(suite.db, "manager");
    const targetId = await seedPerson(suite.db, "staff"); // active, PIN "1234"

    await run((tx) => loginWithPin(tx, { tillId, personId: targetId, pin: "1234" }));

    await run((tx) => suspendPerson(tx, { managementSessionId: token, personId: targetId }));
    const suspended = await codeOf(() =>
      run((tx) => loginWithPin(tx, { tillId, personId: targetId, pin: "1234" })),
    );
    expect(suspended).toBe("person.suspended");

    await run((tx) => reactivatePerson(tx, { managementSessionId: token, personId: targetId }));
    const session = await run((tx) =>
      loginWithPin(tx, { tillId, personId: targetId, pin: "1234" }),
    );
    expect(session).toEqual({
      id: expect.any(String),
      token: expect.any(String),
      personId: targetId,
      tillId,
      role: "staff",
      locale: null,
    });
  });

  it("suspendPerson throws authorization.not_permitted for a staff actor, leaving status active", async () => {
    const { token: staffSession } = await openManagementSession(suite.db, "staff");
    const targetId = await seedPerson(suite.db, "staff"); // active

    const code = await codeOf(() =>
      run((tx) => suspendPerson(tx, { managementSessionId: staffSession, personId: targetId })),
    );
    expect(code).toBe("authorization.not_permitted");

    expect((await personRow(targetId)).status).toBe("active");
  });

  it("reactivatePerson throws authorization.not_permitted for a staff actor, leaving status suspended", async () => {
    const { token: staffSession } = await openManagementSession(suite.db, "staff");
    // A SUSPENDED target so reactivate would be a real change.
    const targetId = await seedPerson(suite.db, "staff", "suspended");

    const code = await codeOf(() =>
      run((tx) => reactivatePerson(tx, { managementSessionId: staffSession, personId: targetId })),
    );
    expect(code).toBe("authorization.not_permitted");
    expect((await personRow(targetId)).status).toBe("suspended");
  });
});

describe("listActiveStaff", () => {
  it("returns active persons' id + name, sorted, no secrets", async () => {
    const { token } = await openManagementSession(suite.db, "manager");

    // Insert Zoe BEFORE Ana so an Ana-first result proves the orderBy, not insertion order.
    const zoe = await run((tx) =>
      createPerson(tx, {
        managementSessionId: token,
        displayName: "Zoe",
        role: "staff",
        pin: "4444",
        email: "zoe@x.com",
      }),
    );
    const ana = await run((tx) =>
      createPerson(tx, {
        managementSessionId: token,
        displayName: "Ana",
        role: "supervisor",
        pin: "5555",
        email: "ana@x.com",
      }),
    );
    const gone = await run((tx) =>
      createPerson(tx, {
        managementSessionId: token,
        displayName: "Gone",
        role: "staff",
        pin: "6666",
        email: "gone@x.com",
      }),
    );
    await run((tx) => suspendPerson(tx, { managementSessionId: token, personId: gone.id }));

    const staff = await run((tx) => listActiveStaff(tx));

    // The database is shared across this file (`resetPerTest: false`), so restrict to this test's rows.
    const mine = new Set([zoe.id, ana.id, gone.id]);
    const cohort = staff.filter((s) => mine.has(s.personId));

    expect(cohort.map((s) => s.displayName)).toEqual(["Ana", "Zoe"]);
    expect(Object.keys(cohort[0]!)).toEqual(["personId", "displayName"]);
  });
});

describe("listPersons", () => {
  it("listPersons returns a roster with credential booleans, no secrets", async () => {
    const { token, personId: manager } = await openManagementSession(suite.db, "manager");
    await run((tx) =>
      createPerson(tx, {
        managementSessionId: token,
        displayName: "Ada",
        role: "staff",
        pin: "4321",
        email: "ada-list@x.com",
      }),
    );
    const roster = await run((tx) => listPersons(tx, { managementSessionId: token }));
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
    const { token } = await openManagementSession(suite.db, "manager");
    const withEmail = await run((tx) =>
      createPerson(tx, {
        managementSessionId: token,
        displayName: "Mailed",
        role: "supervisor",
        pin: "4321",
        email: "mailed@x.com",
      }),
    );
    const second = await run((tx) =>
      createPerson(tx, {
        managementSessionId: token,
        displayName: "Unmailed",
        role: "staff",
        pin: "4321",
        email: "second@x.com",
      }),
    );

    const roster = await run((tx) => listPersons(tx, { managementSessionId: token }));
    expect(roster.find((p) => p.personId === withEmail.id)!.email).toBe("mailed@x.com");
    expect(roster.find((p) => p.personId === second.id)!.email).toBe("second@x.com");
    expect(Object.keys(roster[0]!)).toEqual(expect.arrayContaining(["email"]));
  });

  it("listPersons refuses a staff role", async () => {
    const { token } = await openManagementSession(suite.db, "staff");
    const code = await run((tx) => codeOf(() => listPersons(tx, { managementSessionId: token })));
    expect(code).toBe("authorization.not_permitted");
  });
});

describe("MIN_PIN_LENGTH", () => {
  it("is 4 — the POS keypad floor", () => {
    expect(MIN_PIN_LENGTH).toBe(4);
  });
});
