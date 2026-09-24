import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { endSession, loginWithPin } from "./login.js";
import { codeOf, seedPerson, seedTill } from "../test/fixtures.js";
import { hashSessionToken } from "./session-token.js";

// loginWithPin/endSession are LOGIC — the not-found / suspended / bad-PIN gates and the open→closed
// transition, which is what the cases below assert.

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

// `Promise<T> | T`, the widening `withTransaction` itself took (`packages/db/src/tenancy.ts`):
// `tx.execute` is synchronous on this engine and a `Promise<T>`-only parameter refuses it.
function run<T>(fn: (tx: Transaction) => Promise<T> | T): Promise<T> {
  return withTransaction(suite.db, fn);
}

describe("loginWithPin", () => {
  it("opens a session for a person who supplies the right PIN, left open (ended_at IS NULL)", async () => {
    const tillId = await seedTill(suite.db);
    const personId = await seedPerson(suite.db);

    const session = await run((tx) => loginWithPin(tx, { tillId, personId, pin: "1234" }));

    // toEqual, not toMatchObject: every field of Session is pinned, so an unlisted extra key would
    // fail rather than be silently ignored (CLAUDE.md §4). id is a fresh uuid, hence expect.any.
    // `role` is the person's own role (seedPerson's default is "staff"), surfaced so the till can
    // gate its manager-only affordances client-side (the server still re-checks every gate). `locale`
    // is the person's preferred UI language, null for a seedPerson with no preference set.
    expect(session).toEqual({
      id: expect.any(String),
      token: expect.any(String),
      personId,
      tillId,
      role: "staff",
      locale: null,
    });

    const rows = await suite.db.execute<{ ended_at: string | null }>(
      sql`select ended_at from sessions where id = ${session.id}`,
    );
    expect(rows.rows).toEqual([{ ended_at: null }]);
  });

  it("carries the person's own role in the session (a manager, not just the staff default)", async () => {
    // Proves `role` is the LOOKED-UP role, not a hardcoded constant — a mutant returning "staff"
    // (or dropping the field) fails here.
    const tillId = await seedTill(suite.db);
    const personId = await seedPerson(suite.db, "manager");

    const session = await run((tx) => loginWithPin(tx, { tillId, personId, pin: "1234" }));

    expect(session.role).toBe("manager");
  });

  it("carries the person's set locale in the session (not just the null default)", async () => {
    // Proves `locale` is the LOOKED-UP persons.locale threaded through verifyPersonCredential, not a
    // hardcoded null — a mutant dropping the field (or returning null) fails here.
    const tillId = await seedTill(suite.db);
    const personId = await seedPerson(suite.db);
    await run((tx) => tx.execute(sql`update persons set locale = 'es-ES' where id = ${personId}`));

    const session = await run((tx) => loginWithPin(tx, { tillId, personId, pin: "1234" }));

    expect(session.locale).toBe("es-ES");
  });

  it("throws pin.invalid when the PIN does not verify", async () => {
    const tillId = await seedTill(suite.db);
    const personId = await seedPerson(suite.db);

    const code = await codeOf(() =>
      run((tx) => loginWithPin(tx, { tillId, personId, pin: "9999" })),
    );
    expect(code).toBe("pin.invalid");

    // The rejected login opened no row — nothing to close later.
    // No cast on the count. The `::int` this carried was refused before the statement ran —
    // `unrecognized token: ":"`, because a colon opens a bind parameter to SQLite's parser. It was
    // there to turn the PostgreSQL driver's BigInt into a number; measured on node v26.7.0, this
    // driver hands `select count(*)` back as a JavaScript number already (`3`, `typeof "number"`).
    const rows = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from sessions where person_id = ${personId}`,
    );
    expect(rows.rows[0]!.n).toBe(0);
  });

  it("throws person.not_found for an unknown personId", async () => {
    const tillId = await seedTill(suite.db);

    const code = await codeOf(() =>
      run((tx) => loginWithPin(tx, { tillId, personId: crypto.randomUUID(), pin: "1234" })),
    );
    expect(code).toBe("person.not_found");
  });

  it("throws person.suspended for a suspended person, even with the right PIN", async () => {
    const tillId = await seedTill(suite.db);
    const personId = await seedPerson(suite.db, "staff", "suspended");

    // Correct PIN, so this proves the suspended gate is checked BEFORE (and independently of) the
    // PIN — a suspended account cannot log in however good its credential.
    const code = await codeOf(() =>
      run((tx) => loginWithPin(tx, { tillId, personId, pin: "1234" })),
    );
    expect(code).toBe("person.suspended");
  });
});

describe("endSession", () => {
  it("stamps ended_at and returns true, then returns false on a second call", async () => {
    const tillId = await seedTill(suite.db);
    const personId = await seedPerson(suite.db);
    const session = await run((tx) => loginWithPin(tx, { tillId, personId, pin: "1234" }));

    const first = await run((tx) => endSession(tx, session.token));
    expect(first).toBe(true);

    // The COLUMN, not `ended_at is not null` — a raw select of a boolean expression answers 0 or 1
    // on this engine, so reading the stamp itself is what survives the storage swap. `expect.any`
    // rather than a fixed instant: the stamp is the server clock at close time.
    const rows = await suite.db.execute<{ ended_at: string | null }>(
      sql`select ended_at from sessions where id = ${session.id}`,
    );
    expect(rows.rows).toEqual([{ ended_at: expect.any(String) }]);

    // The row is already closed, so the WHERE ... AND ended_at IS NULL matches nothing: no second
    // close, and the caller learns it changed nothing.
    const second = await run((tx) => endSession(tx, session.token));
    expect(second).toBe(false);
  });
});

describe("the stored shift session", () => {
  it("stores the token's hash, and ending by the row id ends nothing", async () => {
    const tillId = await seedTill(suite.db);
    const personId = await seedPerson(suite.db);
    const session = await run((tx) => loginWithPin(tx, { tillId, personId, pin: "1234" }));
    const rows = await suite.db.execute<{ token_hash: string }>(
      sql`select token_hash from sessions where id = ${session.id}`,
    );
    expect(rows.rows).toEqual([{ token_hash: hashSessionToken(session.token) }]);
    expect(session.token).not.toBe(session.id);
    expect(await run((tx) => endSession(tx, session.id))).toBe(false);
    expect(await run((tx) => endSession(tx, session.token))).toBe(true);
  });
});
