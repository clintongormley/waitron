import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";

describe("printer kind", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("defaults to receipt on a raw insert", async () => {
    const row = await withTransaction(suite.db, async (tx) =>
      tx.get<{ kind: string }>(
        sql`insert into printers (id, name, transport, host)
            values ('receipt-printer', 'Receipt printer', 'network_tcp', '10.0.0.5')
            returning kind`,
      ),
    );
    expect(row?.kind).toBe("receipt");
  });

  it("refuses a kind other than receipt or a4", async () => {
    const error = await captureError(() =>
      withTransaction(suite.db, async (tx) =>
        tx.run(
          sql`insert into printers (id, name, transport, host, kind)
              values ('unknown-printer', 'Unknown printer', 'network_tcp', '10.0.0.5', 'unknown')`,
        ),
      ),
    );
    expect(engineErrorMessage(error)).toBe("CHECK constraint failed: printers_kind_ck");
  });
});
