import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { customThemes } from "./custom-themes.js";

const THEME = { colours: { brand: "#f2d300" } };

describe("custom themes", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  const insert = (nameKey: string, inUse: number | null) =>
    withTransaction(suite.db, (tx) =>
      tx.insert(customThemes).values({ name: nameKey, nameKey, inUse, theme: THEME }),
    );

  const refusal = async (fn: () => Promise<unknown>) => engineErrorMessage(await captureError(fn));

  it("lets any number of themes be out of use and at most one be in use", async () => {
    await insert("the lemon brand", null);
    await insert("the dark-green brand", null);
    await insert("the blue brand", 1);
    expect(await refusal(() => insert("the red brand", 1))).toContain(
      "UNIQUE constraint failed: custom_themes.in_use",
    );
    const rows = await suite.db.select().from(customThemes);
    expect(rows.map((r) => [r.nameKey, r.inUse]).sort()).toEqual([
      ["the blue brand", 1],
      ["the dark-green brand", null],
      ["the lemon brand", null],
    ]);
  });

  it("refuses an in-use value other than 1", async () => {
    expect(await refusal(() => insert("the lemon brand", 2))).toContain("custom_themes_in_use_ck");
    expect(await refusal(() => insert("the dark-green brand", 0))).toContain(
      "custom_themes_in_use_ck",
    );
    expect(await suite.db.select().from(customThemes)).toEqual([]);
  });

  it("refuses a second row with the same name key", async () => {
    await insert("the lemon brand", null);
    expect(await refusal(() => insert("the lemon brand", null))).toContain(
      "UNIQUE constraint failed: custom_themes.name_key",
    );
  });

  it("has nothing pointing at it and points at nothing", async () => {
    const outgoing = await suite.db.execute(
      sql`select * from pragma_foreign_key_list('custom_themes')`,
    );
    expect(outgoing.rows).toEqual([]);
    const incoming = await suite.db.execute(sql`
      select m.name from sqlite_master m, pragma_foreign_key_list(m.name) f
      where m.type = 'table' and f."table" = 'custom_themes'
    `);
    expect(incoming.rows).toEqual([]);
    const tables = await suite.db.execute(
      sql`select name from sqlite_master where type = 'table' and name = 'custom_themes'`,
    );
    expect(tables.rows).toEqual([{ name: "custom_themes" }]);
  });
});
