// Classifies actor columns by name. The behaviour test checks the contents of the download.
import * as schema from "@waitron/db/schema/menu.js";
import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { expect, it } from "vitest";

const ACTOR_COLUMN =
  /(^|_)(person_id|person|by|operator_id|actor_id)$|^(credited_to|owner_id|editor_id)$/;
const READ = ["menu_versions.created_by", "menu_releases.cancelled_by"];

it("classifies every actor column of the menu schema exports", () => {
  const tables = Object.values(schema).flatMap((value) =>
    is(value, SQLiteTable) ? [getTableConfig(value)] : [],
  );
  const actors = tables.flatMap(({ name, columns }) =>
    columns
      .filter((column) => ACTOR_COLUMN.test(column.name))
      .map((column) => `${name}.${column.name}`),
  );
  expect(actors.sort()).toEqual([...READ].sort());
});

it.each([
  {
    table: schema.menuVersions,
    included: ["menu_id", "number", "created_at", "created_by", "id"],
    excluded: ["document", "content_hash"],
  },
  {
    table: schema.menuReleases,
    included: ["menu_id", "version_id", "cancelled_by", "cancelled_at"],
    excluded: ["state", "activates_at"],
  },
])("classifies every field of the publication table %#", ({ table, included, excluded }) => {
  const columns = getTableConfig(table).columns.map(({ name }) => name);
  expect(columns.sort()).toEqual([...included, ...excluded].sort());
});
