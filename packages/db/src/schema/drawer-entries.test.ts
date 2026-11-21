import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { printers } from "./printers.js";
import { seedNode, seedPerson } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";

const fx = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it("keeps a recorded drawer entry immutable and refuses a duplicate position", async () => {
  const nodeId = await seedNode(fx.db);
  const personId = await seedPerson(fx.db);
  const [printer] = await fx.db
    .insert(printers)
    .values({
      name: "Bar drawer",
      transport: "network_tcp",
      host: "bar.test",
      hasCashDrawer: true,
    })
    .returning();
  const insert = (entryId: string) =>
    fx.db.run(sql`
    insert into drawer_entries (id, printer_id, node_id, sequence, recorded_at, person_id, kind, amount)
    values (${entryId}, ${printer!.id}, ${nodeId}, 1, '2026-11-21T12:00:00.000Z',
            ${personId}, 'cash_in', 1000)
  `);
  insert("first");
  expect(() => insert("second")).toThrow(
    expect.objectContaining({
      cause: expect.objectContaining({
        message: "UNIQUE constraint failed: drawer_entries.printer_id, drawer_entries.sequence",
      }),
    }),
  );
  const immutable = expect.objectContaining({
    cause: expect.objectContaining({ message: "drawer_entries is append-only" }),
  });
  expect(() => fx.db.run(sql`update drawer_entries set amount = 2000`)).toThrow(immutable);
  expect(() => fx.db.run(sql`delete from drawer_entries`)).toThrow(immutable);
});
