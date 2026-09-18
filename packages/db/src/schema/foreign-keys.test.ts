import { foreignKey } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { id, label, table } from "./columns.js";
import { declaredForeignKeys } from "./foreign-keys.js";

/**
 * Fixture tables, not real ones: the helper's subject is "what does a schema module declare", and a
 * real table's foreign keys are free to change for reasons that have nothing to do with this file.
 */
const venues = table("p7_venues", { id: id("id").primaryKey() });

const rooms = table(
  "p7_rooms",
  { id: id("id").primaryKey(), venueId: id("venue_id").notNull() },
  (t) => [
    foreignKey({ columns: [t.venueId], foreignColumns: [venues.id], name: "p7_rooms_venue_fk" }),
  ],
);

const seats = table("p7_seats", {
  id: id("id").primaryKey(),
  roomId: id("room_id")
    .notNull()
    /* v8 ignore next -- drizzle resolves the thunk in a separate process; never called here */
    .references(() => rooms.id),
});

const bookings = table(
  "p7_bookings",
  { venueId: id("venue_id").notNull(), roomId: id("room_id").notNull() },
  (t) => [
    foreignKey({
      columns: [t.venueId, t.roomId],
      foreignColumns: [rooms.venueId, rooms.id],
      name: "p7_bookings_room_fk",
    }),
  ],
);

const notes = table("p7_notes", { id: id("id").primaryKey(), body: label("body").notNull() });

describe("declaredForeignKeys", () => {
  it("reports a foreign key declared with the table-level builder", () => {
    expect(declaredForeignKeys({ venues, rooms })).toEqual([
      { table: "p7_rooms", columns: ["venue_id"], references: "p7_venues" },
    ]);
  });

  it("reports a foreign key declared inline on the column", () => {
    expect(declaredForeignKeys({ seats })).toEqual([
      { table: "p7_seats", columns: ["room_id"], references: "p7_rooms" },
    ]);
  });

  it("reports every column of a composite foreign key, in order", () => {
    expect(declaredForeignKeys({ bookings })).toEqual([
      { table: "p7_bookings", columns: ["venue_id", "room_id"], references: "p7_rooms" },
    ]);
  });

  it("reports nothing for a table that declares none, and ignores what is not a table", () => {
    expect(declaredForeignKeys({ notes, aString: "p7_rooms", aFunction: () => rooms })).toEqual([]);
  });
});
