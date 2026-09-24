import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import {
  endManagementSession,
  resolveManagementSession,
  startManagementSession,
  withPassiveManagementRead,
} from "./management-session.js";
import { codeOf, seedPerson } from "../test/fixtures.js";
import { hashSessionToken } from "./session-token.js";

// This suite tests the lifecycle LOGIC — start/resolve/end, the idle timeout, and the mid-session
// status re-check.

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

// `Promise<T> | T`, the widening `withTransaction` itself took (`packages/db/src/tenancy.ts`):
// `tx.execute` is synchronous on this engine and a `Promise<T>`-only parameter refuses it.
const run = <T>(fn: (tx: Transaction) => Promise<T> | T): Promise<T> =>
  withTransaction(suite.db, fn);

/**
 * An instant `minutes` before now, as the exact string the column stores.
 *
 * The two ageing updates below used to read `now() - interval '10 minutes'`. Both halves are gone
 * from this engine, each run on its own against a `node:sqlite` in-memory database (node v26.7.0):
 * `update t set c = now()` answers `no such function: now`, and any statement carrying the interval
 * literal answers `near "'10 minutes'": syntax error` — there is no interval type, and the parse
 * stops there before the missing function is ever reached. So the subtraction happens on a
 * JavaScript `Date` and the result binds as an ordinary parameter. `last_seen_at` is a
 * `tsString` column (`packages/identity/src/schema/management-sessions.ts`), which holds exactly
 * what `toISOString` produced, so a bound ISO string is the same shape the writer wrote.
 */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const agedTo = (at: string, token: string) =>
  sql`update management_sessions set last_seen_at = ${at} where token_hash = ${hashSessionToken(token)}`;

describe("management session lifecycle", () => {
  it("does not extend a passive refresh's session, while an ordinary read still extends it", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { personId }));
    await run((tx) => tx.execute(agedTo(minutesAgo(10), session.token)));
    const before = await run((tx) => resolveManagementSession(tx, session.token, { touch: false }));
    const passive = await withPassiveManagementRead(() =>
      run((tx) => resolveManagementSession(tx, session.token)),
    );
    expect(passive.expiresAt).toBe(before.expiresAt);
    const ordinary = await run((tx) => resolveManagementSession(tx, session.token));
    expect(Date.parse(ordinary.expiresAt)).toBeGreaterThan(
      Date.parse(before.expiresAt) + 9 * 60_000,
    );
  });
  it("starts and resolves a session, returning the person's role and locale", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { personId }));
    const resolved = await run((tx) => resolveManagementSession(tx, session.token));
    // `locale` is null for a seedPerson with no preference set; expiry is issued by the server.
    expect(resolved).toEqual({
      personId,
      role: "manager",
      email: null,
      locale: null,
      expiresAt: expect.any(String),
    });
  });

  it("returns the person's set locale, not just the null default", async () => {
    // Proves `locale` is the LOOKED-UP persons.locale from the join, not a hardcoded null — a mutant
    // dropping the field (or returning null) fails here.
    const personId = await seedPerson(suite.db, "manager");
    await run((tx) => tx.execute(sql`update persons set locale = 'es-ES' where id = ${personId}`));
    const session = await run((tx) => startManagementSession(tx, { personId }));
    const resolved = await run((tx) => resolveManagementSession(tx, session.token));
    expect(resolved.locale).toBe("es-ES");
  });

  it("throws management_session.required for an unknown id", async () => {
    const code = await run((tx) =>
      codeOf(() => resolveManagementSession(tx, "00000000-0000-4000-8000-000000000000")),
    );
    expect(code).toBe("management_session.required");
  });

  it("throws management_session.required after endManagementSession", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { personId }));
    expect(await run((tx) => endManagementSession(tx, session.token))).toBe(true);
    const code = await run((tx) => codeOf(() => resolveManagementSession(tx, session.token)));
    expect(code).toBe("management_session.required");
  });

  it("throws management_session.required when the session's person row has been deleted", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { personId }));
    // Reachable because the table holds no foreign key to `persons`. Two nets
    // produce the refusal, so breaking it takes both: measured by mutation, the inner join alone can
    // be widened to a left join and this case still passes.
    await run((tx) => tx.execute(sql`delete from persons where id = ${personId}`));

    const code = await run((tx) => codeOf(() => resolveManagementSession(tx, session.token)));
    expect(code).toBe("management_session.required");
  });

  it("throws management_session.expired past the idle timeout", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { personId }));
    // Age last_seen_at beyond the timeout via a raw SQL update — deterministic, no clock injection.
    await run((tx) => tx.execute(agedTo(minutesAgo(2 * 24 * 60), session.token)));
    const code = await run((tx) => codeOf(() => resolveManagementSession(tx, session.token)));
    expect(code).toBe("management_session.expired");
  });

  it("throws person.suspended when the person is suspended mid-session", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { personId }));
    await run((tx) =>
      tx.execute(sql`update persons set status = 'suspended' where id = ${personId}`),
    );
    const code = await run((tx) => codeOf(() => resolveManagementSession(tx, session.token)));
    expect(code).toBe("person.suspended");
  });

  it("throws management_session.required when the person is put back to pending mid-session", async () => {
    // `pending` is the third status — an account that exists but has not been taken up yet. It is
    // neither active nor suspended, so it falls past both checks above, and the session must be
    // refused rather than resolved: only an ACTIVE person holds a management session. Refused as
    // "required" (sign in again), not "suspended", because nothing has been withdrawn from them.
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { personId }));
    await run((tx) =>
      tx.execute(sql`update persons set status = 'pending' where id = ${personId}`),
    );
    const code = await run((tx) => codeOf(() => resolveManagementSession(tx, session.token)));
    expect(code).toBe("management_session.required");
  });
});

describe("what the table holds, as anyone reading a copy of the database sees it", () => {
  it("stores the token's hash and never the token", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { personId }));
    const rows = await suite.db.execute<{ id: string; token_hash: string }>(
      sql`select id, token_hash from management_sessions where person_id = ${personId}`,
    );
    expect(rows.rows).toEqual([
      { id: expect.any(String), token_hash: hashSessionToken(session.token) },
    ]);
    expect(rows.rows[0]!.id).not.toBe(session.token);
  });

  it("refuses the row's own id and its stored hash as a token, and accepts the token", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { personId }));
    const [row] = (
      await suite.db.execute<{ id: string; token_hash: string }>(
        sql`select id, token_hash from management_sessions where person_id = ${personId}`,
      )
    ).rows;
    expect(await run((tx) => codeOf(() => resolveManagementSession(tx, row!.id)))).toBe(
      "management_session.required",
    );
    expect(await run((tx) => codeOf(() => resolveManagementSession(tx, row!.token_hash)))).toBe(
      "management_session.required",
    );
    // The other direction: the cookie's own token still signs the person in.
    expect((await run((tx) => resolveManagementSession(tx, session.token))).personId).toBe(
      personId,
    );
  });
});
