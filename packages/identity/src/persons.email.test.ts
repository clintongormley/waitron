/**
 * `persons_tenant_email_uq` — one login address across the venue, case-insensitively, and any
 * number of persons with no address at all.
 *
 * ## What this suite was, and what converting it cost
 *
 * It ran against real PostgreSQL through `useTemplateDb` and inserted as `identity_rls_probe`, a
 * LOGIN role holding `app_user`'s grants. That role is gone: there are no roles on this engine and
 * `asAppUser` (`packages/db/src/testing/roles.ts`) is an empty body, so **nothing here now shows
 * that an ordinary application connection is PERMITTED to insert a person.** The index is enforced
 * for whoever writes, which is the half that survives.
 *
 * **The second assertion changed, and this is the one to read carefully.** It was
 * `expect(constraintTarget(error)).toEqual(PERSONS_EMAIL)` — the table and the expression
 * PostgreSQL wrote into the refusal's DETAIL. SQLite does not report that for an index over an
 * EXPRESSION: it reports the INDEX's own name and no columns, so `constraintTarget` returns
 * `undefined` here. Measured again for this suite on 2026-09-22, Node v26.7.0, against the index
 * `drizzle/0000_baseline.sql:76` generates: errcode `2067`, message
 * `UNIQUE constraint failed: index 'persons_tenant_email_uq'`. The control in the other direction,
 * from the same probe: a PRIMARY KEY, which is not an expression, answers errcode `1555` and
 * `UNIQUE constraint failed: persons.id` — the shape that DOES carry a key.
 *
 * So the case below names the same index the old assertion named, in the engine's words instead of
 * PostgreSQL's. What it does NOT do is check that identity's own translators agree with the engine;
 * they were moved onto `indexViolated` and the index's name on 2026-09-22, and
 * `person-constraints.db.test.ts` is what drives one real collision per index through them, with
 * the plain-column `persons_tenant_google_subject_uq` as the control.
 */
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, captureError, isUniqueViolation, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { hashPin } from "./verify-pin.js";
import { persons } from "./schema/persons.js";

const PIN = hashPin("1234");

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

/**
 * Insert one persons row. Through the table definition, not raw SQL: `id` and `created_at` are
 * Drizzle `$defaultFn` generators that only the insert BUILDER runs.
 */
function insertPerson(db: Database, displayName: string, email: string | null): Promise<unknown> {
  return withTransaction(db, (tx) =>
    tx.insert(persons).values({ displayName, pinHash: PIN, email }),
  );
}

/**
 * The refusal the DRIVER raised, dug out of the chain Drizzle wraps it in.
 *
 * Asserting on the caught error's own message would prove nothing: Drizzle's wrapper message is
 * `Failed to run the query '<the statement>'`, so a match on any word the statement contains passes
 * whether the index fired or not. Same shape, and the same reason, as
 * `packages/store/src/append-only.test.ts`'s helper.
 */
function driverRefusal(error: unknown): { message: string; errcode: number } {
  let layer: unknown = error;
  while (layer !== null && typeof layer === "object") {
    const { errcode, message } = layer as { errcode?: unknown; message?: unknown };
    if (typeof errcode === "number" && typeof message === "string") return { message, errcode };
    layer = (layer as { cause?: unknown }).cause;
  }
  throw new Error("no driver refusal in the cause chain", { cause: error });
}

describe("persons.email unique index (persons_tenant_email_uq)", () => {
  it("rejects a second person with the same email, case-insensitively", async () => {
    await seedTenant(suite.db);
    await insertPerson(suite.db, "A", "Owner@x.com");

    // The differing case (Owner@x.com vs owner@x.com) is the point: the index folds them together while the
    // raw values differ. `captureError` fails the test if the insert is ACCEPTED, so the assertions
    // below can never read an absent refusal as a matching one.
    const error = await captureError(() => insertPerson(suite.db, "B", "owner@x.com"));

    expect(isUniqueViolation(error)).toBe(true);
    // Prove it is THIS index that fired, not some other unique constraint (the primary key, say).
    // The header records the measurement behind both values, and the control that distinguishes
    // this shape from a plain-column key's.
    expect(driverRefusal(error)).toEqual({
      errcode: 2067,
      message: "UNIQUE constraint failed: index 'persons_tenant_email_uq'",
    });
  });

  it("allows multiple persons with NULL email", async () => {
    await seedTenant(suite.db);
    await insertPerson(suite.db, "A", null);
    await expect(insertPerson(suite.db, "B", null)).resolves.toBeDefined();
  });
});
