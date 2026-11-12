import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../../migrations.js";
import { useVenueDb } from "../../testing/venue-db.js";

const venue = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it("keeps job roles in core and reserves names only for visible roles", () => {
  venue.db.run(sql`insert into staff_roles (id, name) values ('old', 'Cook')`);
  expect(() =>
    venue.db.run(sql`insert into staff_roles (id, name) values ('duplicate', 'Cook')`),
  ).toThrowError(expect.objectContaining({ cause: expect.objectContaining({ errcode: 2067 }) }));
  venue.db.run(sql`update staff_roles set hidden_at='2026-11-12T12:00:00.000Z' where id='old'`);
  venue.db.run(sql`insert into staff_roles (id, name) values ('new', 'Cook')`);
  expect(venue.db.all(sql`select id, name, hidden_at from staff_roles order by id`)).toEqual([
    { id: "new", name: "Cook", hidden_at: null },
    { id: "old", name: "Cook", hidden_at: "2026-11-12T12:00:00.000Z" },
  ]);
});
