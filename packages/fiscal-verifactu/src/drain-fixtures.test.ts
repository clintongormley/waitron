import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openSendingGate } from "../test/drain-fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

it("restores the never-sent state and puts the gate's delete trigger back", async () => {
  await suite.db.execute(sql`insert into verifactu_sending_state
    (id, proximo_envio_en, tiempo_espera_seg, technical_incident_token)
    values (1, '2026-07-21T00:01:00.000Z', 60, 'incident')`);
  await openSendingGate(suite.db);
  expect((await suite.db.execute(sql`select id from verifactu_sending_state`)).rows).toEqual([]);
  expect(
    (
      await suite.db.execute(sql`select name from sqlite_schema where type = 'trigger'
      and name = 'verifactu_sending_state_no_delete'`)
    ).rows,
  ).toEqual([{ name: "verifactu_sending_state_no_delete" }]);
});
