// Classifies actor columns by name. The behaviour test checks the contents of the download.
import { readFileSync, readdirSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { expect, it } from "vitest";
import { bookings } from "./schema/bookings.js";

const ACTOR_COLUMN =
  /(^|_)(person_id|person|by|operator_id|actor_id)$|^(credited_to|owner_id|editor_id)$/;

it("classifies every actor column of the Bookings migration schema", () => {
  const meta = new URL("../drizzle/meta/", import.meta.url);
  const newest = readdirSync(meta)
    .filter((name) => /^\d+_snapshot\.json$/.test(name))
    .sort()
    .at(-1)!;
  const snapshot = JSON.parse(readFileSync(new URL(newest, meta), "utf8")) as {
    tables: Record<string, { name: string; columns: Record<string, { name: string }> }>;
  };
  const actors = Object.values(snapshot.tables).flatMap(({ name, columns }) =>
    Object.values(columns)
      .filter((column) => ACTOR_COLUMN.test(column.name))
      .map((column) => `${name}.${column.name}`),
  );
  expect(actors.sort()).toEqual(["bookings.created_by"]);
});

it("classifies every field of bookings", () => {
  const included = ["id", "created_at", "created_by"];
  const excluded = [
    "booking_date",
    "booking_time",
    "party_size",
    "contact_name",
    "contact_phone",
    "notes",
    "table_id",
    "table_label",
    "tab_id",
    "status",
  ];
  const columns = getTableConfig(bookings).columns.map(({ name }) => name);
  expect(columns.sort()).toEqual([...included, ...excluded].sort());
});
