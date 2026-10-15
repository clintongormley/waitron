import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, installChangeFeed, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { ChangeSource } from "@waitron/shared";
import { seedLocation } from "../test/fixtures.js";
import * as api from "./index.js";
import { WORKFORCE_ES_MIGRATIONS } from "./migrations.js";
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
  },
});
it("announces inserted, changed and removed labour rules through the module's real feed triggers", async () => {
  const locationId = await seedLocation(suite.db);
  const sources =
    (api as unknown as { WORKFORCE_ES_CHANGE_SOURCES?: readonly ChangeSource[] })
      .WORKFORCE_ES_CHANGE_SOURCES ?? [];
  await installChangeFeed(suite.db, sources);
  let id = "";
  for (const operation of ["insert", "update", "delete"]) {
    const resources = await withTransaction(suite.db, async (tx) => {
      await tx.execute(sql`delete from change_log`);
      if (operation === "insert") {
        const [row] = await tx.insert(api.convenioConfig).values({ locationId }).returning();
        id = row!.id;
      }
      if (operation === "update")
        await tx.execute(sql`update convenio_config set max_weekly_minutes=2100 where id=${id}`);
      if (operation === "delete") await tx.execute(sql`delete from convenio_config where id=${id}`);
      const answer = await tx.execute<{ payload: string }>(sql`select payload from change_log`);
      return answer.rows.map(
        (row) =>
          (JSON.parse(row.payload) as { resources: { type: string; id: string }[] }).resources,
      );
    });
    expect(resources, operation).toEqual(
      Array.from({ length: operation === "update" ? 2 : 1 }, () => [
        { type: "convenio_config", id },
      ]),
    );
  }
});
