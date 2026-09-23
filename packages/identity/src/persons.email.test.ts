/**
 * `persons_tenant_email_uq` — one login address across the venue, case-insensitively, and any
 * number of persons with no address at all.
 *
 * ## What this suite was, and what converting it cost
 *
 * There are no roles on this engine, so **nothing here shows that an ordinary application
 * connection is PERMITTED to insert a person.** The index is enforced for whoever writes, which is
 * the half that survives.
 *
 * The engine reports a collision on an index over an EXPRESSION by the INDEX's own name and no
 * columns, so the case below identifies it by that name (`refusalError`'s `uniqueIndex` shape)
 * rather than by a table and key. It does NOT check that identity's own translators agree with the
 * engine; `person-constraints.db.test.ts` drives one real collision per index through them, with
 * the plain-column `persons_tenant_google_subject_uq` as the control.
 */
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  captureError,
  isUniqueViolation,
  refusalError,
  withTransaction,
} from "@waitron/db";
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
 * whether the index fired or not. It walks the cause chain for the same reason as
 * `packages/store/src/append-only.test.ts`'s helper, but returns the whole driver layer.
 */
function driverRefusal(error: unknown): object {
  let layer: unknown = error;
  while (layer !== null && typeof layer === "object") {
    const { errcode, message } = layer as { errcode?: unknown; message?: unknown };
    if (typeof errcode === "number" && typeof message === "string") return layer;
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
    expect(driverRefusal(error)).toEqual(refusalError({ uniqueIndex: "persons_tenant_email_uq" }));
  });

  it("allows multiple persons with NULL email", async () => {
    await seedTenant(suite.db);
    await insertPerson(suite.db, "A", null);
    await expect(insertPerson(suite.db, "B", null)).resolves.toBeDefined();
  });
});
