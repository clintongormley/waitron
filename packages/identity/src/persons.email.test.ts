/**
 * `persons_tenant_email_uq`. The engine reports a collision on an index over an expression by the
 * index's own name and no columns, so the case below identifies it by that name. It does NOT check
 * identity's own translators; `person-constraints.db.test.ts` does.
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

/** Through the table definition, not raw SQL: `id` and `created_at` are `$defaultFn` generators
 * that only the insert BUILDER runs. */
function insertPerson(db: Database, displayName: string, email: string | null): Promise<unknown> {
  return withTransaction(db, (tx) =>
    tx.insert(persons).values({ displayName, pinHash: PIN, email }),
  );
}

/**
 * The refusal the DRIVER raised, dug out of the chain Drizzle wraps it in. Drizzle's own message
 * quotes the statement, so a match on it passes whether the index fired or not.
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

    const error = await captureError(() => insertPerson(suite.db, "B", "owner@x.com"));

    expect(isUniqueViolation(error)).toBe(true);
    // THIS index, not some other unique constraint.
    expect(driverRefusal(error)).toEqual(refusalError({ uniqueIndex: "persons_tenant_email_uq" }));
  });

  it("allows multiple persons with NULL email", async () => {
    await seedTenant(suite.db);
    await insertPerson(suite.db, "A", null);
    await expect(insertPerson(suite.db, "B", null)).resolves.toBeDefined();
  });
});
