import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client.js";
import { refusalCode } from "./constraint-target.js";
import { locations, tenants } from "./schema/tenants.js";
import { CHECK_VIOLATION, type RefusalClass } from "./sql-state.js";
import { pgErrorMessage } from "./testing/errors.js";
import { useVenueDb } from "./testing/venue-db.js";
import { CORE_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

// Each case gets empty mutable fixture tables while sharing the migrated database.
afterEach(async () => {
  await suite.db.execute(sql`delete from locations`);
  await suite.db.execute(sql`delete from tenants`);
});

/**
 * Asserts that `promise` is refused by the engine, with `refusal`'s class and a message matching
 * `pattern`.
 *
 * Both halves are needed and each rules out a different wrong answer: the class alone also accepts
 * a sibling CHECK on the same table, and the message alone also accepts any error whose text
 * happens to name the constraint — a wrapper reproducing the failed SQL among them.
 *
 * The identity comes from `errcode` on the error itself, because on the path this suite takes
 * nothing wraps it. Every case below rejects from an awaited drizzle query builder, and that path
 * hands back the engine's own error: measured on Node v26.7.0 by logging the empty-list case below,
 * a plain `Error` whose own properties are `stack`, `message`, `code`, `errcode` and `errstr`, with
 * `code` the constant `"ERR_SQLITE_ERROR"`, `errcode` 275 and `cause` undefined — which is why the
 * `.cause` this helper used to require is not there to require.
 *
 * **That is a fact about this path, not about the driver.** `db.run` wraps the same refusal in
 * drizzle's `DrizzleError` and puts the engine's error on `.cause` (the same refusal, taken down
 * both paths on the same runtime, 2026-09-23). Nothing breaks either way: `refusalCode` walks the
 * cause chain and `pgErrorMessage` falls back across it, so a case added here through `run` would
 * still be read correctly — it would just not match the shape described above.
 */
async function rejectsWithRefusal(
  promise: Promise<unknown>,
  refusal: RefusalClass,
  pattern: RegExp,
): Promise<void> {
  await promise.then(
    () => {
      throw new Error("expected promise to reject, but it resolved");
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(Error);
      expect(refusal).toContain(refusalCode(err));
      expect(pgErrorMessage(err)).toMatch(pattern);
    },
  );
}

describe("invoice_locales", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    await db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "B44444447", legalName: "Bar Gamma SL" });
  });

  const insertLocales = async (invoiceLocales: string[]): Promise<unknown> => {
    return db.insert(locations).values({
      name: `locales-${invoiceLocales.join("-") || "empty"}`,
      invoiceLocales,
      operationDescription: "Servicios de restauración",
    });
  };

  it("accepts a single locale", async () => {
    await expect(insertLocales(["es"])).resolves.toBeDefined();
  });

  it("accepts two locales and preserves their order", async () => {
    await insertLocales(["ca", "es"]);

    const [row] = await db
      .select()
      .from(locations)
      .where(sql`${locations.name} = 'locales-ca-es'`);

    // ["ca","es"] and ["es","ca"] are different invoices, not the same invoice
    // rendered differently. A set-valued column would lose that distinction.
    expect(row?.invoiceLocales).toEqual(["ca", "es"]);
  });

  it("rejects an empty locale list", async () => {
    // The trap this constraint exists for, which survives the engine change: a CHECK whose
    // expression is NULL is SATISFIED, so a length function returning NULL on an empty list would
    // let this row through. `json_array_length('[]')` is 0, not NULL — measured on Node v26.7.0
    // against `node:sqlite`, with `json_array_length(null)` as the control, which IS null and is
    // accepted by the same CHECK.
    await rejectsWithRefusal(insertLocales([]), CHECK_VIOLATION, /locations_invoice_locales_len/);
  });

  it("rejects three locales", async () => {
    await rejectsWithRefusal(
      insertLocales(["es", "ca", "en"]),
      CHECK_VIOLATION,
      /locations_invoice_locales_len/,
    );
  });
});

/*
 * LOSS, from the storage swap: the `withTransaction transaction context` case is deleted.
 *
 * It opened a transaction and read back the `app.tenant_id` session setting, asserting it was
 * never set — the database holds one taxpayer, so there is no tenant to scope a session to
 * (spec §1). SQLite has no session-setting facility, so there is no setting to read and nothing
 * for the assertion to distinguish: any wording would pass against an engine that could not have
 * failed it. The property is structural here rather than checked.
 */
