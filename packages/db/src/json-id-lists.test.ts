import { beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { useVenueDb } from "./testing/venue-db.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { id, label, table } from "./schema/columns.js";
import { withTransaction } from "./tenancy.js";
import { removeIdFromJson, withoutId } from "./json-id-lists.js";

const owner = table("zz_owners", { id: id("id").primaryKey(), ids: label("ids") });
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
beforeAll(async () => {
  await suite.db.execute(sql`create table zz_owners (id text primary key, ids text)`);
});

it("removes matching array elements and nulls object fields at every depth", () => {
  expect(withoutId(["a", "b"], "a")).toEqual(["b"]);
  expect(withoutId({ r: { ids: ["a"], defaultId: "a" } }, "a")).toEqual({
    r: { ids: [], defaultId: null },
  });
  expect(withoutId([null, 3, { x: "a" }, ["a", "ab"]], "a")).toEqual([
    null,
    3,
    { x: null },
    ["ab"],
  ]);
});

it("preserves the reference of values without a matching id", () => {
  const value = { r: { ids: ["ab"], defaultId: null }, n: 3 };
  expect(withoutId(value, "a")).toBe(value);
  expect(withoutId(null, "a")).toBeNull();
});

it("changes only rows naming the id and reports their count", async () => {
  await withTransaction(suite.db, async (tx) => {
    await tx.execute(
      sql`insert into zz_owners values ('one','["a","b"]'),('two','{"r":{"ids":["a"],"defaultId":"a"}}'),('three','[ "ab" ]'),('four',null)`,
    );
    expect(await removeIdFromJson(tx, owner.ids, "a")).toBe(2);
    expect((await tx.execute(sql`select id,ids from zz_owners order by id`)).rows).toEqual([
      { id: "four", ids: null },
      { id: "one", ids: '["b"]' },
      { id: "three", ids: '[ "ab" ]' },
      { id: "two", ids: '{"r":{"ids":[],"defaultId":null}}' },
    ]);
    expect(await removeIdFromJson(tx, owner.ids, "a")).toBe(0);
  });
});
