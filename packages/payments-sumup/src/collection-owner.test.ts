import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { setup } from "./testing/setup.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

describe("a SumUp payment carries the node id of the box that started it", () => {
  it("SumUpCloudProvider.collect", async () => {
    const { t, provider, params } = await setup(suite);
    const result = await provider.collect(params);
    expect(result.state).toBe("captured");
    const rows = await suite.db.execute<{ node_id: string | null }>(
      sql`select node_id from payments where provider = 'sumup' and payment_ref = ${result.paymentRef}`,
    );
    expect(rows.rows).toEqual([{ node_id: t.nodeId }]);
  });
});
