import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { seedNode, seedPerson } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendHistory } from "./history.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

it("sequences appends by write order and returns the ids of the stored evidence", async () => {
  const [first, second] = await withTransaction(suite.db, async (tx) => {
    const nodeId = await seedNode(tx);
    const personId = await seedPerson(tx);
    const entry = { kind: "clock.confirmed", nodeId, personId } as const;
    const data = { source: "admin", reason: "start", stepMs: 1, proof: {} } as const;
    const first = await appendHistory(tx, {
      ...entry,
      at: new Date("2026-10-19T22:00:00.000Z"),
      data: { ...data, confirmedAt: "2026-10-19T22:00:00.001Z" },
    });
    const second = await appendHistory(tx, {
      ...entry,
      at: new Date("2026-10-19T21:00:00.000Z"),
      data: { ...data, stepMs: -1, confirmedAt: "2026-10-19T20:59:59.999Z" },
    });
    return [first, second];
  });
  expect(first.seq).toBe(1);
  expect(second.seq).toBe(2);
  const { rows } = await suite.db.execute(sql`
    select id, seq, at, json_extract(data, '$.stepMs') as step_ms
    from verifactu_history order by seq`);
  expect(rows).toEqual([
    { id: first.id, seq: 1, at: "2026-10-19T22:00:00.000Z", step_ms: 1 },
    { id: second.id, seq: 2, at: "2026-10-19T21:00:00.000Z", step_ms: -1 },
  ]);
});
