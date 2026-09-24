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

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

// `Promise<T> | T`: `tx.execute` is synchronous on this engine and a `Promise<T>`-only parameter
// refuses it.
const run = <T>(fn: (tx: Transaction) => Promise<T> | T): Promise<T> =>
  withTransaction(suite.db, fn);

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
  it("an ordinary read stores the new last-seen time on the session's own row", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { personId }));
    const aged = minutesAgo(10);
    await run((tx) => tx.execute(agedTo(aged, session.token)));
    await run((tx) => resolveManagementSession(tx, session.token));
    const [row] = (
      await suite.db.execute<{ last_seen_at: string }>(
        sql`select last_seen_at from management_sessions where person_id = ${personId}`,
      )
    ).rows;
    expect(Date.parse(row!.last_seen_at)).toBeGreaterThan(Date.parse(aged) + 9 * 60_000);
  });

  it("starts and resolves a session, returning the person's role and locale", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { personId }));
    const resolved = await run((tx) => resolveManagementSession(tx, session.token));
    const [row] = (
      await suite.db.execute<{ id: string }>(
        sql`select id from management_sessions where person_id = ${personId}`,
      )
    ).rows;
    expect(resolved).toEqual({
      sessionRowId: row!.id,
      personId,
      role: "manager",
      email: null,
      locale: null,
      expiresAt: expect.any(String),
    });
  });

  it("returns the person's set locale, not just the null default", async () => {
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
    // Reachable because the table declares no key to `persons`. Two nets produce the refusal, so
    // breaking it takes both: the inner join alone can be widened to a left join and this still passes.
    await run((tx) => tx.execute(sql`delete from persons where id = ${personId}`));

    const code = await run((tx) => codeOf(() => resolveManagementSession(tx, session.token)));
    expect(code).toBe("management_session.required");
  });

  it("throws management_session.expired past the idle timeout", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { personId }));
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
    // Refused as "required" (sign in again), not "suspended": only an ACTIVE person holds a
    // management session, and nothing has been withdrawn from a pending one.
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
    expect((await run((tx) => resolveManagementSession(tx, session.token))).personId).toBe(
      personId,
    );
  });
});
