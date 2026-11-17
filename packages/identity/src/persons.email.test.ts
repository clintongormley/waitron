import { seedPersons } from "../test/person-rows.js";
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
import { seedTaxpayer } from "@waitron/db/testing/seed.js";
import { hashPin } from "./verify-pin.js";

const PIN = hashPin("1234");

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

/** Through the table definition, not raw SQL: `id` and `created_at` are `$defaultFn` generators
 * that only the insert BUILDER runs. */
function insertPerson(db: Database, displayName: string, email: string | null): Promise<unknown> {
  return withTransaction(db, (tx) => seedPersons(tx, { displayName, pinHash: PIN, email }));
}

function driverRefusal(error: unknown): object {
  let layer: unknown = error;
  while (layer !== null && typeof layer === "object") {
    const { errcode, message } = layer as { errcode?: unknown; message?: unknown };
    if (typeof errcode === "number" && typeof message === "string") return layer;
    layer = (layer as { cause?: unknown }).cause;
  }
  throw new Error("no driver refusal in the cause chain", { cause: error });
}

describe("persons.email unique index (persons_email_uq)", () => {
  it("rejects a second person with the same email, case-insensitively", async () => {
    await seedTaxpayer(suite.db);
    await insertPerson(suite.db, "A", "Owner@x.com");

    const error = await captureError(() => insertPerson(suite.db, "B", "owner@x.com"));

    expect(isUniqueViolation(error)).toBe(true);
    // THIS index, not some other unique constraint.
    expect(driverRefusal(error)).toEqual(
      refusalError({ unique: { table: "persons", columns: ["email_folded"] } }),
    );
  });

  it("allows multiple persons with NULL email", async () => {
    await seedTaxpayer(suite.db);
    await insertPerson(suite.db, "A", null);
    await expect(insertPerson(suite.db, "B", null)).resolves.toBeDefined();
  });
});
