import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "@waitron/db";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { afterEach, describe, expect, it } from "vitest";
import { createPerson, setEmail } from "./staff.js";
import { openManagementSession, seedPerson } from "../test/fixtures.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

afterEach(async () => {
  await suite.db.execute(sql`delete from management_sessions`);
  await suite.db.execute(sql`delete from persons`);
});

function run<T>(db: Database, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, fn);
}

describe("createPerson / setEmail email_taken on a real unique index", () => {
  it("createPerson rejects a second person with the same email", async () => {
    const { sessionId } = await openManagementSession(suite.db, "manager");

    await run(suite.db, (tx) =>
      createPerson(tx, {
        managementSessionId: sessionId,
        displayName: "A",
        role: "staff",
        pin: "5678",
        email: "owner@x.com",
      }),
    );

    // Different case, same address (lower(email) collides) — the translator maps 23505 → email_taken.
    await expect(
      run(suite.db, (tx) =>
        createPerson(tx, {
          managementSessionId: sessionId,
          displayName: "B",
          role: "staff",
          pin: "5678",
          email: "Owner@X.com",
        }),
      ),
    ).rejects.toMatchObject({ code: "person.email_taken", params: { email: "owner@x.com" } });
  });

  it("setEmail rejects a duplicate address", async () => {
    const { sessionId } = await openManagementSession(suite.db, "manager");

    await run(suite.db, (tx) =>
      createPerson(tx, {
        managementSessionId: sessionId,
        displayName: "A",
        role: "staff",
        pin: "5678",
        email: "owner@x.com",
      }),
    );
    const target = await seedPerson(suite.db, "staff"); // email null

    await expect(
      run(suite.db, (tx) =>
        setEmail(tx, { managementSessionId: sessionId, personId: target, email: "owner@x.com" }),
      ),
    ).rejects.toMatchObject({ code: "person.email_taken", params: { email: "owner@x.com" } });
  });
});
