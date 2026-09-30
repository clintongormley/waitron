import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { endSession, loginWithPin } from "./login.js";
import { codeOf, refusalOf, seedPerson, seedTill } from "../test/fixtures.js";
import { hashSessionToken } from "./session-token.js";
import { verifyPin } from "./verify-pin.js";

// Spy on verifyPin while delegating to the real hash check, so the equalising check is observable.
vi.mock("./verify-pin.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./verify-pin.js")>();
  return { ...actual, verifyPin: vi.fn(actual.verifyPin) };
});

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

// `Promise<T> | T`: `tx.execute` is synchronous on this engine and a `Promise<T>`-only parameter
// refuses it.
function run<T>(fn: (tx: Transaction) => Promise<T> | T): Promise<T> {
  return withTransaction(suite.db, fn);
}

describe("loginWithPin", () => {
  it("opens a session for a person who supplies the right PIN, left open (ended_at IS NULL)", async () => {
    const tillId = await seedTill(suite.db);
    const personId = await seedPerson(suite.db);

    const session = await run((tx) => loginWithPin(tx, { tillId, personId, pin: "1234" }));

    // toEqual, not toMatchObject: an unlisted extra key fails rather than being silently ignored.
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
    const tillId = await seedTill(suite.db);
    const personId = await seedPerson(suite.db, "manager");

    const session = await run((tx) => loginWithPin(tx, { tillId, personId, pin: "1234" }));

    expect(session.role).toBe("manager");
  });

  it("carries the person's set locale in the session (not just the null default)", async () => {
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

    const rows = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from sessions where person_id = ${personId}`,
    );
    expect(rows.rows[0]!.n).toBe(0);
  });

  it("refuses an unknown personId with pin.invalid, opening no session", async () => {
    const tillId = await seedTill(suite.db);
    const personId = crypto.randomUUID();

    const code = await codeOf(() =>
      run((tx) => loginWithPin(tx, { tillId, personId, pin: "1234" })),
    );
    expect(code).toBe("pin.invalid");
    expect(await sessionCount(personId)).toBe(0);
  });

  it("refuses a suspended person with pin.invalid, even with the right PIN, opening no session", async () => {
    const tillId = await seedTill(suite.db);
    const personId = await seedPerson(suite.db, "staff", "suspended");

    const code = await codeOf(() =>
      run((tx) => loginWithPin(tx, { tillId, personId, pin: "1234" })),
    );
    expect(code).toBe("pin.invalid");
    expect(await sessionCount(personId)).toBe(0);
  });
});

async function sessionCount(personId: string): Promise<number> {
  const rows = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from sessions where person_id = ${personId}`,
  );
  return rows.rows[0]!.n;
}

// Each refusal cause, with the right PIN wherever the account has one, so only the cause differs.
async function refusalCauses(): Promise<Record<string, { personId: string; pin: string }>> {
  const noPin = await seedPerson(suite.db);
  await run((tx) => tx.execute(sql`update persons set pin_hash = null where id = ${noPin}`));
  return {
    unknown: { personId: crypto.randomUUID(), pin: "1234" },
    suspended: { personId: await seedPerson(suite.db, "staff", "suspended"), pin: "1234" },
    pending: { personId: await seedPerson(suite.db, "staff", "pending"), pin: "1234" },
    noPin: { personId: noPin, pin: "1234" },
    wrongPin: { personId: await seedPerson(suite.db), pin: "9999" },
  };
}

describe("loginWithPin's refusals", () => {
  it("are one answer whatever the cause", async () => {
    const tillId = await seedTill(suite.db);
    const refusals: Record<string, unknown> = {};
    for (const [cause, input] of Object.entries(await refusalCauses())) {
      refusals[cause] = await refusalOf(() => run((tx) => loginWithPin(tx, { tillId, ...input })));
    }
    const expected = { code: "pin.invalid", params: {} };
    expect(refusals).toEqual({
      unknown: expected,
      suspended: expected,
      pending: expected,
      noPin: expected,
      wrongPin: expected,
    });
  });

  // A refusal that settled before its PIN check finished would be told apart from a wrong PIN by
  // its time.
  it("each wait for one PIN check before refusing", async () => {
    const tillId = await seedTill(suite.db);
    const spy = vi.mocked(verifyPin);
    for (const [cause, input] of Object.entries(await refusalCauses())) {
      spy.mockClear();
      let finish: ((matched: boolean) => void) | undefined;
      spy.mockImplementationOnce(() => new Promise<boolean>((resolve) => (finish = resolve)));
      let settled = false;
      const refused = codeOf(() => run((tx) => loginWithPin(tx, { tillId, ...input }))).finally(
        () => (settled = true),
      );
      try {
        await vi.waitFor(() => expect(finish, cause).toBeTypeOf("function"));
        await new Promise((resolve) => setImmediate(resolve));
        expect(settled, cause).toBe(false);
      } finally {
        // Release the held check, or drop it unused, so no later login waits on it.
        if (finish === undefined) spy.mockReset();
        else finish(false);
      }
      expect(await refused, cause).toBe("pin.invalid");
      expect(spy, cause).toHaveBeenCalledTimes(1);
      expect(spy, cause).toHaveBeenCalledWith(input.pin, expect.any(String));
    }
  });
});

describe("endSession", () => {
  it("stamps ended_at and returns true, then returns false on a second call", async () => {
    const tillId = await seedTill(suite.db);
    const personId = await seedPerson(suite.db);
    const session = await run((tx) => loginWithPin(tx, { tillId, personId, pin: "1234" }));

    const first = await run((tx) => endSession(tx, session.token));
    expect(first).toBe(true);

    // The COLUMN, not `ended_at is not null`: a raw select of a boolean expression answers 0 or 1
    // on this engine.
    const rows = await suite.db.execute<{ ended_at: string | null }>(
      sql`select ended_at from sessions where id = ${session.id}`,
    );
    expect(rows.rows).toEqual([{ ended_at: expect.any(String) }]);

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
