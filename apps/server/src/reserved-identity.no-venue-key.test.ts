import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

it("refuses a standby without a venue even after the node's venue foreign key is removed", async () => {
  await seedTenant(suite.db);
  const tables = await suite.db.execute<{ sql: string }>(
    sql`select sql from sqlite_master where type = 'table' and name = 'nodes'`,
  );
  const foreignKey = /,\s*FOREIGN KEY \(`location_id`\) REFERENCES `locations`\(`id`\)[^,)]*/g;
  expect(tables.rows[0]!.sql.match(foreignKey)).toHaveLength(1);
  const createScratch = tables.rows[0]!.sql.replace(foreignKey, "").replace(
    "`nodes`",
    "`nodes_scratch`",
  );
  expect(createScratch).toContain("`nodes_scratch`");
  const triggers = await suite.db.execute<{ sql: string }>(
    sql`select sql from sqlite_master where type = 'trigger' and tbl_name = 'nodes'`,
  );
  await suite.db.execute(sql`pragma foreign_keys = off`);
  try {
    await suite.db.execute(sql.raw(createScratch));
    await suite.db.execute(sql`insert into nodes_scratch select * from nodes`);
    await suite.db.execute(sql`drop table nodes`);
    await suite.db.execute(sql`alter table nodes_scratch rename to nodes`);
    for (const trigger of triggers.rows) await suite.db.execute(sql.raw(trigger.sql));
  } finally {
    await suite.db.execute(sql`pragma foreign_keys = on`);
  }
  const keys = await suite.db.execute<{ table: string }>(sql`pragma foreign_key_list(nodes)`);
  expect(keys.rows.some((key) => key.table === "locations")).toBe(false);
  expect((await suite.db.execute(sql`pragma foreign_key_check`)).rows).toEqual([]);

  const standby = generateStandbyIdentity();
  await expect(
    establishReservedStandbyIdentity(
      { ownerDb: suite.db },
      {
        locationId: randomUUID(),
        standby,
        nodeName: "cloud",
        filingModule: null,
        taxModule: null,
        modules: [],
        reserved: {
          modules: {},
          series: [],
          endorsement: {
            nodeId: standby.nodeId,
            publicKey: standby.publicKey,
            endorsedBy: "e",
            signature: "s",
          },
        },
      },
    ),
  ).rejects.toMatchObject({ code: "mirror.venue_not_copied" });
  expect((await suite.db.execute(sql`select 1 from nodes`)).rows).toEqual([]);
});
