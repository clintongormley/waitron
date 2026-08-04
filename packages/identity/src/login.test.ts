import { CORE_MIGRATIONS, captureError, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { endSession, loginWithPin } from "./login.js";
import { hashPin } from "./verify-pin.js";

// PGlite, not real Postgres: loginWithPin/endSession are LOGIC — the not-found / suspended / bad-PIN
// gates and the open→closed transition. Nothing here depends on the privilege set or on RLS
// enforcement (a PGlite connection is superuser, so RLS is a false pass, CLAUDE.md §4); the
// tenant-isolation of `sessions` is proven as the app role in sessions.rls.test.ts and is not
// re-proven here.
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

// Seed a location → till as the superuser owner (RLS bypassed on PGlite — pure setup). Returns the
// till id a session references, the same insert shape sessions.rls.test.ts copies.
async function seedTill(db: Database): Promise<string> {
  const location = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Main', array['en'], 'Sale on premises') returning id`);
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenantId}, ${location.rows[0]!.id}, 'Till 1') returning id`);
  return till.rows[0]!.id;
}

// An active person whose PIN is "1234" unless suspended is requested. status is passed explicitly so
// the suspended case seeds a real suspended row rather than relying on a later UPDATE.
async function seedPerson(
  db: Database,
  status: "active" | "suspended" = "active",
): Promise<string> {
  const rows = await db.execute<{ id: string }>(sql`
    insert into persons (tenant_id, display_name, pin_hash, status)
    values (${tenantId}, 'Ana', ${hashPin("1234")}, ${status}) returning id`);
  return rows.rows[0]!.id;
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await captureError(fn);
  return isAppError(error) ? error.code : `not an AppError: ${String(error)}`;
}

describe("loginWithPin", () => {
  it("opens a session for a person who supplies the right PIN, left open (ended_at IS NULL)", async () => {
    const tillId = await seedTill(suite.db);
    const personId = await seedPerson(suite.db);

    const session = await run((tx) =>
      loginWithPin(tx, { tenantId, tillId, personId, pin: "1234" }),
    );

    // toEqual, not toMatchObject: every field of Session is pinned, so an unlisted extra key would
    // fail rather than be silently ignored (CLAUDE.md §4). id is a fresh uuid, hence expect.any.
    expect(session).toEqual({ id: expect.any(String), tenantId, personId, tillId });

    const rows = await suite.db.execute<{ ended_at: string | null }>(
      sql`select ended_at from sessions where id = ${session.id}`,
    );
    expect(rows.rows).toEqual([{ ended_at: null }]);
  });

  it("throws pin.invalid when the PIN does not verify", async () => {
    const tillId = await seedTill(suite.db);
    const personId = await seedPerson(suite.db);

    const code = await codeOf(() =>
      run((tx) => loginWithPin(tx, { tenantId, tillId, personId, pin: "9999" })),
    );
    expect(code).toBe("pin.invalid");

    // The rejected login opened no row — nothing to close later.
    const rows = await suite.db.execute<{ n: number }>(
      sql`select count(*)::int as n from sessions where person_id = ${personId}`,
    );
    expect(rows.rows[0]!.n).toBe(0);
  });

  it("throws person.not_found for an unknown personId", async () => {
    const tillId = await seedTill(suite.db);

    const code = await codeOf(() =>
      run((tx) =>
        loginWithPin(tx, { tenantId, tillId, personId: crypto.randomUUID(), pin: "1234" }),
      ),
    );
    expect(code).toBe("person.not_found");
  });

  it("throws person.suspended for a suspended person, even with the right PIN", async () => {
    const tillId = await seedTill(suite.db);
    const personId = await seedPerson(suite.db, "suspended");

    // Correct PIN, so this proves the suspended gate is checked BEFORE (and independently of) the
    // PIN — a suspended account cannot log in however good its credential.
    const code = await codeOf(() =>
      run((tx) => loginWithPin(tx, { tenantId, tillId, personId, pin: "1234" })),
    );
    expect(code).toBe("person.suspended");
  });
});

describe("endSession", () => {
  it("stamps ended_at and returns true, then returns false on a second call", async () => {
    const tillId = await seedTill(suite.db);
    const personId = await seedPerson(suite.db);
    const session = await run((tx) =>
      loginWithPin(tx, { tenantId, tillId, personId, pin: "1234" }),
    );

    const first = await run((tx) => endSession(tx, session.id));
    expect(first).toBe(true);

    const rows = await suite.db.execute<{ ended: boolean }>(
      sql`select ended_at is not null as ended from sessions where id = ${session.id}`,
    );
    expect(rows.rows).toEqual([{ ended: true }]);

    // The row is already closed, so the WHERE ... AND ended_at IS NULL matches nothing: no second
    // close, and the caller learns it changed nothing.
    const second = await run((tx) => endSession(tx, session.id));
    expect(second).toBe(false);
  });
});
