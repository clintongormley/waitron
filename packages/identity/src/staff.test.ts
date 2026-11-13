import { seedPersons } from "../test/person-rows.js";
import { hashPin } from "./verify-pin.js";
import { CORE_MIGRATIONS, refusalError, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { isAppError } from "@waitron/shared";
import { describe, expect, it, vi } from "vitest";
import {
  MIN_PIN_LENGTH,
  asEmailTaken,
  deactivatePerson,
  listActiveStaff,
  listPersons,
} from "./staff.js";
import { codeOf, openManagementSession, seedPerson } from "../test/fixtures.js";

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS],
});

// `Promise<T> | T`: `tx.execute` is synchronous on this engine.
function run<T>(fn: (tx: Transaction) => Promise<T> | T): Promise<T> {
  return withTransaction(suite.db, fn);
}

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

describe("listActiveStaff", () => {
  it("returns active persons' id + name, sorted, no secrets", async () => {
    const { token } = await openManagementSession(suite.db, "admin");

    // Insert Zoe BEFORE Ana so an Ana-first result proves the orderBy, not insertion order.
    const [zoe] = await run((tx) =>
      seedPersons(tx, {
        displayName: "Zoe",
        role: "staff",
        pinHash: hashPin("4444"),
        email: "zoe@x.com",
      }),
    );
    const [ana] = await run((tx) =>
      seedPersons(tx, {
        displayName: "Ana",
        role: "supervisor",
        pinHash: hashPin("5555"),
        email: "ana@x.com",
      }),
    );
    const [gone] = await run((tx) =>
      seedPersons(tx, {
        displayName: "Gone",
        role: "staff",
        pinHash: hashPin("6666"),
        email: "gone@x.com",
      }),
    );
    await run((tx) => deactivatePerson(tx, { managementSessionId: token, personId: gone!.id }));

    const staff = await run((tx) => listActiveStaff(tx));

    // The database is shared across this file (`resetPerTest: false`), so restrict to this test's rows.
    const mine = new Set([zoe!.id, ana!.id, gone!.id]);
    const cohort = staff.filter((s) => mine.has(s.personId));

    expect(cohort.map((s) => s.displayName)).toEqual(["Ana", "Zoe"]);
    expect(Object.keys(cohort[0]!)).toEqual(["personId", "displayName"]);
  });
});

describe("listPersons", () => {
  it("reads the staff roster in a fixed number of queries", async () => {
    const { token, personId } = await openManagementSession(suite.db, "admin");
    for (let i = 0; i < 20; i++) await seedPerson(suite.db, "staff");
    await run(async (tx) => {
      const reads = vi.spyOn(tx, "select");
      try {
        const roster = await listPersons(tx, { managementSessionId: token });
        expect(roster.length).toBeGreaterThanOrEqual(21);
        expect(roster.find((person) => person.personId === personId)?.role).toBe("admin");
        expect(reads.mock.calls.length).toBeLessThanOrEqual(4);
      } finally {
        reads.mockRestore();
      }
    });
  });

  it("listPersons returns a roster with credential booleans, no secrets", async () => {
    const { token, personId: manager } = await openManagementSession(suite.db, "admin");
    await run((tx) =>
      seedPersons(tx, {
        displayName: "Ada",
        role: "staff",
        pinHash: hashPin("4321"),
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
    const { token } = await openManagementSession(suite.db, "admin");
    const [withEmail] = await run((tx) =>
      seedPersons(tx, {
        displayName: "Mailed",
        role: "supervisor",
        pinHash: hashPin("4321"),
        email: "mailed@x.com",
      }),
    );
    const [second] = await run((tx) =>
      seedPersons(tx, {
        displayName: "Unmailed",
        role: "staff",
        pinHash: hashPin("4321"),
        email: "second@x.com",
      }),
    );

    const roster = await run((tx) => listPersons(tx, { managementSessionId: token }));
    expect(roster.find((p) => p.personId === withEmail!.id)!.email).toBe("mailed@x.com");
    expect(roster.find((p) => p.personId === second!.id)!.email).toBe("second@x.com");
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
