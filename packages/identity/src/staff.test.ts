import { CORE_MIGRATIONS, captureError, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { authorize } from "./authorize.js";
import { loginWithPin } from "./login.js";
import {
  MIN_PIN_LENGTH,
  createPerson,
  reactivatePerson,
  resetPin,
  setRole,
  suspendPerson,
} from "./staff.js";
import { hashPin } from "./verify-pin.js";

// PGlite, not real Postgres: the staff-admin API is LOGIC gated on authorize() — the person.manage
// check, the PIN-length assertion, and the role/status writes. Nothing here depends on the privilege
// set or on RLS enforcement (a PGlite connection is superuser, so RLS is a false pass, CLAUDE.md §4);
// tenant-isolation of persons is proven as the app role in persons.rls.test.ts and is not re-proven.
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

// Seed a location → till as the superuser owner (RLS bypassed on PGlite — pure setup), the same
// insert shape login.test.ts / authorize.test.ts copy.
async function seedTill(db: Database): Promise<string> {
  const location = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Main', array['en'], 'Sale on premises') returning id`);
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenantId}, ${location.rows[0]!.id}, 'Till 1') returning id`);
  return till.rows[0]!.id;
}

// A person of the given role and status whose PIN is "1234". role/status are passed explicitly so a
// test seeds a real row of that shape rather than relying on a later UPDATE.
async function seedPerson(
  db: Database,
  role: "staff" | "supervisor" | "manager" | "admin" = "staff",
  status: "active" | "suspended" = "active",
): Promise<string> {
  const rows = await db.execute<{ id: string }>(sql`
    insert into persons (tenant_id, display_name, pin_hash, role, status)
    values (${tenantId}, 'P', ${hashPin("1234")}, ${role}, ${status}) returning id`);
  return rows.rows[0]!.id;
}

// Opens a shift session for a person (PIN "1234") and returns its id, exactly as the till would.
async function openSession(tillId: string, personId: string): Promise<string> {
  const session = await run((tx) => loginWithPin(tx, { tenantId, tillId, personId, pin: "1234" }));
  return session.id;
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await captureError(fn);
  return isAppError(error) ? error.code : `not an AppError: ${String(error)}`;
}

async function personCount(): Promise<number> {
  const rows = await suite.db.execute<{ n: number }>(sql`select count(*)::int as n from persons`);
  return rows.rows[0]!.n;
}

// The mutable columns the staff-admin API writes, read as the superuser owner (RLS bypassed on
// PGlite). A gate that rejects BEFORE its write leaves every one of these unchanged.
async function personRow(id: string): Promise<{ role: string; status: string; pin_hash: string }> {
  const rows = await suite.db.execute<{ role: string; status: string; pin_hash: string }>(
    sql`select role, status, pin_hash from persons where id = ${id}`,
  );
  return rows.rows[0]!;
}

describe("createPerson", () => {
  it("creates an active person of the given role whose PIN opens a session (admin actor)", async () => {
    const tillId = await seedTill(suite.db);
    const adminId = await seedPerson(suite.db, "admin");
    const adminSessionId = await openSession(tillId, adminId);

    const { id } = await run((tx) =>
      createPerson(tx, {
        tenantId,
        actorSessionId: adminSessionId,
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
    expect(session).toEqual({ id: expect.any(String), tenantId, personId: id, tillId });
  });

  it("throws authorization.not_permitted for a staff actor, writing nothing", async () => {
    const tillId = await seedTill(suite.db);
    const staffId = await seedPerson(suite.db, "staff");
    const staffSessionId = await openSession(tillId, staffId);
    const before = await personCount();

    const code = await codeOf(() =>
      run((tx) =>
        createPerson(tx, {
          tenantId,
          actorSessionId: staffSessionId,
          displayName: "Ghost",
          role: "staff",
          pin: "5678",
        }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");

    // authorize() runs before the insert, so a denied actor creates no row.
    expect(await personCount()).toBe(before);
  });

  it("throws pin.too_short for a PIN below MIN_PIN_LENGTH (admin actor)", async () => {
    const tillId = await seedTill(suite.db);
    const adminId = await seedPerson(suite.db, "admin");
    const adminSessionId = await openSession(tillId, adminId);
    const before = await personCount();

    // "12" is length 2, below MIN_PIN_LENGTH (4). The actor IS permitted, so only the length gate
    // can be the cause here.
    const code = await codeOf(() =>
      run((tx) =>
        createPerson(tx, {
          tenantId,
          actorSessionId: adminSessionId,
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

describe("setRole", () => {
  it("changes the role, seen by a later authorize on an already-open session", async () => {
    const tillId = await seedTill(suite.db);
    const adminId = await seedPerson(suite.db, "admin");
    const adminSessionId = await openSession(tillId, adminId);
    const targetId = await seedPerson(suite.db, "staff");
    const targetSessionId = await openSession(tillId, targetId);

    // As staff, the target holds no person.manage — its own session cannot authorize it.
    const before = await codeOf(() =>
      run((tx) => authorize(tx, { sessionId: targetSessionId, permission: "person.manage" })),
    );
    expect(before).toBe("authorization.not_permitted");

    await run((tx) =>
      setRole(tx, { actorSessionId: adminSessionId, personId: targetId, role: "manager" }),
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
    const tillId = await seedTill(suite.db);
    const staffActorId = await seedPerson(suite.db, "staff");
    const staffSessionId = await openSession(tillId, staffActorId);
    const targetId = await seedPerson(suite.db, "staff");

    // A genuine staff session (authenticates fine) but no person.manage — the escalation attempt is
    // staff→manager, so if the gate were absent the role would flip.
    const code = await codeOf(() =>
      run((tx) =>
        setRole(tx, { actorSessionId: staffSessionId, personId: targetId, role: "manager" }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");

    // authorize() runs before the UPDATE, so a denied actor changes no role.
    expect((await personRow(targetId)).role).toBe("staff");
  });
});

describe("resetPin", () => {
  it("replaces the PIN: the new PIN logs in, the old one no longer does", async () => {
    const tillId = await seedTill(suite.db);
    const adminId = await seedPerson(suite.db, "admin");
    const adminSessionId = await openSession(tillId, adminId);
    const targetId = await seedPerson(suite.db, "staff"); // PIN "1234"

    await run((tx) =>
      resetPin(tx, { actorSessionId: adminSessionId, personId: targetId, pin: "8765" }),
    );

    const session = await run((tx) =>
      loginWithPin(tx, { tenantId, tillId, personId: targetId, pin: "8765" }),
    );
    expect(session).toEqual({ id: expect.any(String), tenantId, personId: targetId, tillId });

    const oldPin = await codeOf(() =>
      run((tx) => loginWithPin(tx, { tenantId, tillId, personId: targetId, pin: "1234" })),
    );
    expect(oldPin).toBe("pin.invalid");
  });

  it("throws pin.too_short for a PIN below MIN_PIN_LENGTH, leaving the hash unchanged (admin actor)", async () => {
    const tillId = await seedTill(suite.db);
    const adminId = await seedPerson(suite.db, "admin");
    const adminSessionId = await openSession(tillId, adminId);
    const targetId = await seedPerson(suite.db, "staff");
    const before = (await personRow(targetId)).pin_hash;

    const code = await codeOf(() =>
      run((tx) => resetPin(tx, { actorSessionId: adminSessionId, personId: targetId, pin: "1" })),
    );
    expect(code).toBe("pin.too_short");

    // The actor IS permitted; the length gate rejects before the UPDATE, so the stored hash is intact.
    expect((await personRow(targetId)).pin_hash).toBe(before);
  });

  it("throws authorization.not_permitted for a staff actor, leaving the hash unchanged", async () => {
    const tillId = await seedTill(suite.db);
    const staffActorId = await seedPerson(suite.db, "staff");
    const staffSessionId = await openSession(tillId, staffActorId);
    const targetId = await seedPerson(suite.db, "staff");
    const before = (await personRow(targetId)).pin_hash;

    // A genuine staff session, no person.manage: an account-takeover attempt (rewrite the target's
    // PIN) must be rejected before the UPDATE.
    const code = await codeOf(() =>
      run((tx) =>
        resetPin(tx, { actorSessionId: staffSessionId, personId: targetId, pin: "9999" }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");

    expect((await personRow(targetId)).pin_hash).toBe(before);
  });
});

describe("suspendPerson / reactivatePerson", () => {
  it("suspend blocks login; reactivate restores it", async () => {
    const tillId = await seedTill(suite.db);
    const adminId = await seedPerson(suite.db, "admin");
    const adminSessionId = await openSession(tillId, adminId);
    const targetId = await seedPerson(suite.db, "staff"); // active, PIN "1234"

    // Active to begin with: login works.
    await run((tx) => loginWithPin(tx, { tenantId, tillId, personId: targetId, pin: "1234" }));

    await run((tx) => suspendPerson(tx, { actorSessionId: adminSessionId, personId: targetId }));
    const suspended = await codeOf(() =>
      run((tx) => loginWithPin(tx, { tenantId, tillId, personId: targetId, pin: "1234" })),
    );
    expect(suspended).toBe("person.suspended");

    await run((tx) => reactivatePerson(tx, { actorSessionId: adminSessionId, personId: targetId }));
    const session = await run((tx) =>
      loginWithPin(tx, { tenantId, tillId, personId: targetId, pin: "1234" }),
    );
    expect(session).toEqual({ id: expect.any(String), tenantId, personId: targetId, tillId });
  });

  it("suspendPerson throws authorization.not_permitted for a staff actor, leaving status active", async () => {
    const tillId = await seedTill(suite.db);
    const staffActorId = await seedPerson(suite.db, "staff");
    const staffSessionId = await openSession(tillId, staffActorId);
    const targetId = await seedPerson(suite.db, "staff"); // active

    // A genuine staff session, no person.manage: a lockout attempt (suspend a colleague) must be
    // rejected before the UPDATE, so the target stays active.
    const code = await codeOf(() =>
      run((tx) => suspendPerson(tx, { actorSessionId: staffSessionId, personId: targetId })),
    );
    expect(code).toBe("authorization.not_permitted");

    expect((await personRow(targetId)).status).toBe("active");
  });

  it("reactivatePerson throws authorization.not_permitted for a staff actor, leaving status suspended", async () => {
    const tillId = await seedTill(suite.db);
    const staffActorId = await seedPerson(suite.db, "staff");
    const staffSessionId = await openSession(tillId, staffActorId);
    // A SUSPENDED target so reactivate would be a real change (active would hide a missing gate).
    const targetId = await seedPerson(suite.db, "staff", "suspended");

    const code = await codeOf(() =>
      run((tx) => reactivatePerson(tx, { actorSessionId: staffSessionId, personId: targetId })),
    );
    expect(code).toBe("authorization.not_permitted");

    // The gate rejects before the UPDATE, so an unauthorised actor cannot un-suspend anyone.
    expect((await personRow(targetId)).status).toBe("suspended");
  });
});

describe("MIN_PIN_LENGTH", () => {
  it("is 4 — the POS keypad floor", () => {
    expect(MIN_PIN_LENGTH).toBe(4);
  });
});
