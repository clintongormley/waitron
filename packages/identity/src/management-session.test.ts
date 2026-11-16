import { captureError, restrictRefused, readActivityForPerson } from "@waitron/db";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { personRoles, roles } from "@waitron/db";
import {
  IDLE_TIMEOUT_MS,
  checkManagementSession,
  endManagementSession,
  resolveManagementSession,
  startManagementSession,
  withInspectorAdmitted,
  withPassiveManagementRead,
} from "./management-session.js";
import { authorizeManager } from "./manager-login.js";
import { codeOf, seedPerson } from "../test/fixtures.js";
import { hashSessionToken } from "./session-token.js";

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS],
});

// `Promise<T> | T`: `tx.execute` is synchronous on this engine and a `Promise<T>`-only parameter
// refuses it.
const run = <T>(fn: (tx: Transaction) => Promise<T> | T): Promise<T> =>
  withTransaction(suite.db, fn);

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const agedTo = (at: string, token: string) =>
  sql`update dashboard_sessions set last_seen_at = ${at} where token_hash = ${hashSessionToken(token)}`;

describe("management session lifecycle", () => {
  it("records dashboard.signed_in with the method", async () => {
    const personId = await seedPerson(suite.db, "manager");
    await run((tx) => startManagementSession(tx, { personId, method: "passkey" }));
    const entries = await readActivityForPerson(suite.db, personId);
    expect(entries).toEqual([
      expect.objectContaining({
        kind: "dashboard.signed_in",
        subjectKind: "person",
        subjectId: personId,
        personId,
        data: { method: "passkey" },
      }),
    ]);
  });

  it("a new login has no fresh proof", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { method: "password", personId }));
    const [row] = (
      await suite.db.execute<Record<string, unknown>>(
        sql`select * from dashboard_sessions where token_hash = ${hashSessionToken(session.token)}`,
      )
    ).rows;
    expect(row!.proved_at).toBeNull();
  });

  it("does not extend a passive refresh's session, while an ordinary read still extends it", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { method: "password", personId }));
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
    const session = await run((tx) => startManagementSession(tx, { method: "password", personId }));
    const aged = minutesAgo(10);
    await run((tx) => tx.execute(agedTo(aged, session.token)));
    await run((tx) => resolveManagementSession(tx, session.token));
    const [row] = (
      await suite.db.execute<{ last_seen_at: string }>(
        sql`select last_seen_at from dashboard_sessions where person_id = ${personId}`,
      )
    ).rows;
    expect(Date.parse(row!.last_seen_at)).toBeGreaterThan(Date.parse(aged) + 9 * 60_000);
  });

  it("starts and resolves a session, returning the person's authority and locale", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { method: "password", personId }));
    const resolved = await run((tx) => resolveManagementSession(tx, session.token));
    const [row] = (
      await suite.db.execute<{ id: string }>(
        sql`select id from dashboard_sessions where person_id = ${personId}`,
      )
    ).rows;
    const [person] = (
      await suite.db.execute<{ display_name: string }>(
        sql`select display_name from persons where id = ${personId}`,
      )
    ).rows;
    expect(resolved).toEqual({
      sessionRowId: row!.id,
      personId,
      authority: {
        personId,
        admin: false,
        roleIds: [expect.any(String)],
        permissions: expect.any(Set),
      },
      email: null,
      displayName: person!.display_name,
      locale: null,
      expiresAt: expect.any(String),
    });
  });

  it("returns the person's set locale, not just the null default", async () => {
    const personId = await seedPerson(suite.db, "manager");
    await run((tx) => tx.execute(sql`update persons set locale = 'es-ES' where id = ${personId}`));
    const session = await run((tx) => startManagementSession(tx, { method: "password", personId }));
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
    const session = await run((tx) => startManagementSession(tx, { method: "password", personId }));
    expect(await run((tx) => endManagementSession(tx, session.token, "signed_out"))).toBe(true);
    const code = await run((tx) => codeOf(() => resolveManagementSession(tx, session.token)));
    expect(code).toBe("management_session.required");
    expect(
      (await suite.db.execute(sql`select id from dashboard_sessions where person_id=${personId}`))
        .rows,
    ).toEqual([]);
    const entries = await readActivityForPerson(suite.db, personId);
    expect(entries.map(({ kind, data }) => ({ kind, data }))).toEqual([
      { kind: "dashboard.signed_in", data: { method: "password" } },
      { kind: "dashboard.signed_out", data: { reason: "signed_out" } },
    ]);
    expect(entries[1]).toMatchObject({ personId, subjectKind: "person", subjectId: personId });
    expect(await run((tx) => endManagementSession(tx, session.token, "signed_out"))).toBe(false);
    expect(await readActivityForPerson(suite.db, personId)).toEqual(entries);
  });

  it("refuses deleting the person behind a dashboard session", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { method: "password", personId }));
    const error = await captureError(() =>
      run((tx) => tx.execute(sql`delete from persons where id = ${personId}`)),
    );
    expect(restrictRefused(error)).toBe(true);
    expect((await run((tx) => resolveManagementSession(tx, session.token))).personId).toBe(
      personId,
    );
  });

  it("throws management_session.expired past the idle timeout", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { method: "password", personId }));
    await run((tx) => tx.execute(agedTo(minutesAgo(2 * 24 * 60), session.token)));
    const code = await run((tx) => codeOf(() => resolveManagementSession(tx, session.token)));
    expect(code).toBe("management_session.expired");
    expect(
      (await suite.db.execute(sql`select id from dashboard_sessions where person_id=${personId}`))
        .rows,
    ).toHaveLength(1);
  });

  describe("a last-seen time ahead of the clock, as a backward clock step leaves it", () => {
    const aheadBy = (ms: number) => new Date(Date.now() + ms).toISOString();
    // Frozen, so each boundary is exact however long the transactions between stamp and read take.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-31T12:00:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("throws management_session.expired once last-seen is more than the idle timeout ahead", async () => {
      const personId = await seedPerson(suite.db, "manager");
      const session = await run((tx) =>
        startManagementSession(tx, { method: "password", personId }),
      );
      await run((tx) => tx.execute(agedTo(aheadBy(IDLE_TIMEOUT_MS + 1), session.token)));
      const code = await run((tx) => codeOf(() => resolveManagementSession(tx, session.token)));
      expect(code).toBe("management_session.expired");
    });

    it("accepts a last-seen exactly the idle timeout ahead", async () => {
      const personId = await seedPerson(suite.db, "manager");
      const session = await run((tx) =>
        startManagementSession(tx, { method: "password", personId }),
      );
      await run((tx) => tx.execute(agedTo(aheadBy(IDLE_TIMEOUT_MS), session.token)));
      const resolved = await run((tx) => resolveManagementSession(tx, session.token));
      expect(resolved.personId).toBe(personId);
    });

    it("accepts a last-seen ten minutes ahead, and the touch stamps it back at the clock", async () => {
      const personId = await seedPerson(suite.db, "manager");
      const session = await run((tx) =>
        startManagementSession(tx, { method: "password", personId }),
      );
      await run((tx) => tx.execute(agedTo(aheadBy(10 * 60_000), session.token)));
      const before = Date.now();
      await run((tx) => resolveManagementSession(tx, session.token));
      const after = Date.now();
      const [row] = (
        await suite.db.execute<{ last_seen_at: string }>(
          sql`select last_seen_at from dashboard_sessions where person_id = ${personId}`,
        )
      ).rows;
      expect(Date.parse(row!.last_seen_at)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(row!.last_seen_at)).toBeLessThanOrEqual(after);
    });
  });

  it("throws person.suspended when the person is suspended mid-session", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { method: "password", personId }));
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
    const session = await run((tx) => startManagementSession(tx, { method: "password", personId }));
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
    const session = await run((tx) => startManagementSession(tx, { method: "password", personId }));
    const rows = await suite.db.execute<{ id: string; token_hash: string }>(
      sql`select id, token_hash from dashboard_sessions where person_id = ${personId}`,
    );
    expect(rows.rows).toEqual([
      { id: expect.any(String), token_hash: hashSessionToken(session.token) },
    ]);
    expect(rows.rows[0]!.id).not.toBe(session.token);
  });

  it("refuses the row's own id and its stored hash as a token, and accepts the token", async () => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { method: "password", personId }));
    const [row] = (
      await suite.db.execute<{ id: string; token_hash: string }>(
        sql`select id, token_hash from dashboard_sessions where person_id = ${personId}`,
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

it.each(["active", "unknown", "expired", "suspended", "pending", "ended"] as const)(
  "checks a management session without a write or activity stamp: %s",
  async (state) => {
    const personId = await seedPerson(suite.db, "manager");
    const session = await run((tx) => startManagementSession(tx, { method: "password", personId }));
    const at = minutesAgo(state === "expired" ? 31 : 10);
    await run((tx) => tx.execute(agedTo(at, session.token)));
    if (state === "suspended" || state === "pending")
      await run((tx) =>
        tx.execute(sql`update persons set status = ${state} where id = ${personId}`),
      );
    if (state === "ended") await run((tx) => endManagementSession(tx, session.token, "signed_out"));
    const check = checkManagementSession(suite.db, state === "unknown" ? "unknown" : session.token);
    if (state === "active") await expect(check).resolves.toBeUndefined();
    else
      await expect(check).rejects.toMatchObject({
        code:
          state === "expired"
            ? "management_session.expired"
            : state === "suspended"
              ? "person.suspended"
              : "management_session.required",
      });
    const [row] = (
      await suite.db.execute<{ last_seen_at: string }>(
        sql`select last_seen_at from dashboard_sessions where token_hash = ${hashSessionToken(session.token)}`,
      )
    ).rows;
    if (state === "ended") expect(row).toBeUndefined();
    else expect(row!.last_seen_at).toBe(at);
  },
);

/** A session for a new person whose one role grants exactly `permissions`. */
async function sessionHolding(permissions: string[]): Promise<{ token: string; personId: string }> {
  const personId = await seedPerson(suite.db, "staff");
  return run(async (tx) => {
    await tx.delete(personRoles).where(eq(personRoles.personId, personId));
    const name = `Only ${crypto.randomUUID()}`;
    const [role] = await tx
      .insert(roles)
      .values({ name, nameFolded: name.toLowerCase(), permissions })
      .returning({ id: roles.id });
    await tx.insert(personRoles).values({ personId, roleId: role!.id });
    const { token } = await startManagementSession(tx, { method: "password", personId });
    return { token, personId };
  });
}

const lastSeen = async (token: string) =>
  (
    await suite.db.execute<{ last_seen_at: string }>(
      sql`select last_seen_at from dashboard_sessions where token_hash = ${hashSessionToken(token)}`,
    )
  ).rows[0]!.last_seen_at;

describe("a session holding invoice.inspect alone", () => {
  const refusal = { code: "authorization.inspection_only", params: {} };

  it("is refused by an ordinary resolve, without stamping its activity", async () => {
    const { token } = await sessionHolding(["invoice.inspect"]);
    const at = minutesAgo(10);
    await run((tx) => tx.execute(agedTo(at, token)));
    await expect(run((tx) => resolveManagementSession(tx, token))).rejects.toMatchObject(refusal);
    await expect(
      run((tx) => resolveManagementSession(tx, token, { touch: false })),
    ).rejects.toMatchObject(refusal);
    expect(await lastSeen(token)).toBe(at);
  });

  it("is refused by the live stream's re-check, without stamping its activity", async () => {
    const { token } = await sessionHolding(["invoice.inspect"]);
    const at = minutesAgo(10);
    await run((tx) => tx.execute(agedTo(at, token)));
    await expect(checkManagementSession(suite.db, token)).rejects.toMatchObject(refusal);
    expect(await lastSeen(token)).toBe(at);
    const other = await sessionHolding(["invoice.inspect", "report.view"]);
    await expect(checkManagementSession(suite.db, other.token)).resolves.toBeUndefined();
  });

  it("is re-checked by the live stream in one read that counts every role the person holds", async () => {
    const { token, personId } = await sessionHolding(["invoice.inspect"]);
    const select = vi.spyOn(suite.db, "select");
    try {
      await expect(checkManagementSession(suite.db, token)).rejects.toMatchObject(refusal);
      expect(select).toHaveBeenCalledTimes(1);
    } finally {
      select.mockRestore();
    }
    await run(async (tx) => {
      const name = `Also ${crypto.randomUUID()}`;
      const [role] = await tx
        .insert(roles)
        .values({ name, nameFolded: name.toLowerCase(), permissions: ["report.view"] })
        .returning({ id: roles.id });
      await tx.insert(personRoles).values({ personId, roleId: role!.id });
    });
    await expect(checkManagementSession(suite.db, token)).resolves.toBeUndefined();
    const roleless = await sessionHolding([]);
    await run((tx) => tx.delete(personRoles).where(eq(personRoles.personId, roleless.personId)));
    await expect(checkManagementSession(suite.db, roleless.token)).resolves.toBeUndefined();
  });

  it("is served inside a route that admits it", async () => {
    const { token, personId } = await sessionHolding(["invoice.inspect"]);
    const session = await withInspectorAdmitted(() =>
      run((tx) => resolveManagementSession(tx, token)),
    );
    expect(session.personId).toBe(personId);
    await expect(run((tx) => resolveManagementSession(tx, token))).rejects.toMatchObject(refusal);
  });

  it("passes authorizeManager for invoice.inspect only, and is refused as inspection-only for any other", async () => {
    const { token, personId } = await sessionHolding(["invoice.inspect"]);
    await expect(
      run((tx) =>
        authorizeManager(tx, { managementSessionId: token, permission: "invoice.inspect" }),
      ),
    ).resolves.toMatchObject({ authorizedBy: personId });
    await expect(
      run((tx) => authorizeManager(tx, { managementSessionId: token, permission: "report.view" })),
    ).rejects.toMatchObject(refusal);
  });

  it.each([
    ["no permission at all", []],
    ["invoice.inspect beside another permission", ["invoice.inspect", "report.view"]],
    ["one other permission", ["report.view"]],
  ])("leaves a session holding %s resolving as before", async (_name, permissions) => {
    const { token, personId } = await sessionHolding(permissions);
    expect((await run((tx) => resolveManagementSession(tx, token))).personId).toBe(personId);
  });

  it("leaves an administrator resolving as before", async () => {
    const personId = await seedPerson(suite.db, "admin");
    const { token } = await run((tx) =>
      startManagementSession(tx, { method: "password", personId }),
    );
    expect((await run((tx) => resolveManagementSession(tx, token))).personId).toBe(personId);
  });
});
