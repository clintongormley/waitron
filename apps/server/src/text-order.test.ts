import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { byText } from "./text-order.js";

/** The names in the order the database's binary collation sorts them. */
function databaseOrder(names: readonly string[]): string[] {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("create table names (name text not null)");
    const insert = db.prepare("insert into names (name) values (?)");
    for (const name of names) insert.run(name);
    return db
      .prepare("select name from names order by name")
      .all()
      .map((row) => row.name as string);
  } finally {
    db.close();
  }
}

describe("byText", () => {
  it.each([
    ["accents and case", ["Zeta", "Álvaro", "bar", "Bar", "a", "álvaro"]],
    ["a character above U+FFFF beside one from U+E000 to U+FFFF", ["！Bang", "😀Grin", "Private"]],
    ["a name that begins another", ["Grill", "Gril", "Grill 2", ""]],
  ])("sorts %s as the database does", (_what, names) => {
    const expected = databaseOrder(names);
    expect([...names].sort(byText)).toEqual(expected);
    expect([...names].reverse().sort(byText)).toEqual(expected);
  });

  it("answers 0 for equal text", () => {
    expect(byText("Grill", "Grill")).toBe(0);
  });
});
