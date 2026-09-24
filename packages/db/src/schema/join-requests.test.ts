import { asc, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { CHECK_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { joinRequests } from "./join-requests.js";
import { locations, tenants } from "./tenants.js";

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("join_requests", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeAll(async () => {
    await suite.db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
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
          nodeId: NODE,
          locationId: LOCATION_A,
          kind: "device",
          label: "Bar till",
          tokenHash: "h1",
          verificationNumber: "47",
          decoyNumbers: ["12", "83"],
        },
        {
          nodeId: NODE,
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
    // CLIENT-side, and the row would otherwise be refused NOT NULL rather than by the CHECK.
    const e = await captureError(() =>
      withTransaction(suite.db, async (tx) => {
        await tx.run(sql`
          insert into join_requests
            (id, node_id, location_id, kind, label, token_hash, verification_number, decoy_numbers,
             created_at)
          values ('jr-bad', ${NODE}, ${LOCATION_A}, 'kitchen_sink', 'x', 'h', '00', '["01","02"]',
                  ${new Date().toISOString()})`);
      }),
    );
    expect(isRefusal(e, CHECK_VIOLATION)).toBe(true);
  });
});
