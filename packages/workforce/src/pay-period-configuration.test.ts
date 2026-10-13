import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import {
  WORKFORCE_MIGRATIONS,
  WORKFORCE_CONFIGURATION_TRANSFER,
  setPayPeriodSettings,
} from "./index.js";
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
it("includes the saved venue cadence in transferable configuration without clock history or venue ids", async () => {
  await withTransaction(suite.db, (tx) =>
    setPayPeriodSettings(tx, { frequency: "fortnightly", anchorDate: "2026-10-12" }),
  );
  const names = WORKFORCE_CONFIGURATION_TRANSFER.tables.map((t) => t.name);
  expect(names).toContain("pay_period_settings");
  for (const forbidden of ["time_entries", "workforce_chains", "pay_period_closures"])
    expect(names).not.toContain(forbidden);
  const settings = WORKFORCE_CONFIGURATION_TRANSFER.tables.find(
    (t) => t.name === "pay_period_settings",
  )!;
  const exported = await suite.db.execute(sql`select * from ${sql.identifier(settings.name)}`);
  expect(exported.rows).toEqual([{ id: 1, frequency: "fortnightly", anchor_date: "2026-10-12" }]);
});
