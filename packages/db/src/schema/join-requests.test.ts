import { asc, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { CHECK_VIOLATION } from "../sql-state.js";
import { isPgError } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { joinRequests } from "./join-requests.js";
import { locations, tenants } from "./tenants.js";

// LOSS, from the storage swap: a third case used to read `has_table_privilege` and pin that
// `app_user` held SELECT, INSERT and DELETE on this table and NOT UPDATE. SQLite has no roles and
// no grants, so that question has no counterpart here and the case is deleted rather than kept in
// a form that asserts nothing (`packages/db/src/testing/roles.ts`). Nothing in this package now
// states which privileges this table was granted.
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";

describe("join_requests", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeAll(async () => {
    await suite.db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    // operation_description is Spanish test DATA, not a schema identifier, exactly as the sibling
    // devices/kitchen-stations tests use 'Hostelería'.
    await suite.db.insert(locations).values({
      id: LOCATION_A,
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
  });

  it("accepts a device request and a print_agent request", async () => {
    await withTransaction(suite.db, async (tx) => {
      await tx.insert(joinRequests).values([
        {
          locationId: LOCATION_A,
          kind: "device",
          label: "Bar till",
          tokenHash: "h1",
          verificationNumber: "47",
          decoyNumbers: ["12", "83"],
        },
        {
          locationId: LOCATION_A,
          kind: "print_agent",
          label: "Kitchen box",
          tokenHash: "h2",
          verificationNumber: "13",
          decoyNumbers: ["04", "91"],
        },
      ]);
      const rows = await tx
        .select({ kind: joinRequests.kind })
        .from(joinRequests)
        .orderBy(asc(joinRequests.kind));
      expect(rows.map((r) => r.kind)).toEqual(["device", "print_agent"]);
    });
  });

  it("refuses an unknown kind", async () => {
    // Raw SQL, because `kind` is typed to the two labels and the builder would not compile with a
    // third. `id` and `created_at` are stated because both are `$defaultFn` columns Drizzle fills
    // CLIENT-side — a raw insert reaches neither, and the row would be refused NOT NULL on `id`
    // rather than by the CHECK under test.
    //
    // The refusal is caught OUTSIDE the transaction, around the whole `withTransaction`
    // (CLAUDE.md §3).
    const e = await captureError(() =>
      withTransaction(suite.db, async (tx) => {
        await tx.run(sql`
          insert into join_requests
            (id, location_id, kind, label, token_hash, verification_number, decoy_numbers, created_at)
          values ('jr-bad', ${LOCATION_A}, 'kitchen_sink', 'x', 'h', '00', '["01","02"]',
                  ${new Date().toISOString()})`);
      }),
    );
    // PostgreSQL refused this with `22P02` because `kind` was an ENUM TYPE and the label was not
    // one of its values. The regenerated SQLite column is `text` with an `in (...)` CHECK
    // (`packages/db/src/schema/columns.ts`'s `enumType`/`enumCheck`), so the same bad label is
    // refused by that CHECK instead. Same question, the engine's own vocabulary.
    expect(isPgError(e, CHECK_VIOLATION)).toBe(true);
  });
});
