import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { checksIn, createdObject, normaliseSql } from "./sql-tokens.js";

describe("normaliseSql", () => {
  it("leaves whitespace inside quoted text untouched and removes it between tokens", () => {
    expect(normaliseSql(`  CHECK  (  a = 'a  b'  AND  "a  b" > 1 )\n`)).toBe(
      `CHECK(a='a  b'AND"a  b">1)`,
    );
    expect(normaliseSql("`a  b` , [a  b]")).toBe("`a  b`,[a  b]");
  });

  it("gives two spellings that differ only in whitespace between tokens the same text", () => {
    expect(normaliseSql("CREATE TABLE t (a INT)")).toBe(
      normaliseSql("CREATE\n\tTABLE t(a\r\n INT)"),
    );
  });

  it("never changes the case of anything", () => {
    expect(normaliseSql("Create  TABLE  T ( a  Int )")).toBe("Create TABLE T(a Int)");
  });

  it.each([
    ["a  b", "a b"],
    ["1  - -1", "1- -1"],
    ["'a'  'b'", "'a' 'b'"],
    ["x  'ab'", "x 'ab'"],
    ["1  .5", "1 .5"],
    ["a  |  |  b", "a| |b"],
    ["a  <  =  b", "a< =b"],
    ["/  *  a", "/ *a"],
  ])("keeps one space where removing it would change the tokens: %s", (input, expected) => {
    expect(normaliseSql(input)).toBe(expected);
    expect(normaliseSql(expected)).toBe(expected);
  });

  it("does not read a run of doubled quotes or a blob as separate tokens", () => {
    expect(normaliseSql("'it''s  ok'  ,  x'AB'  ,  \"a\"\"  b\"")).toBe(
      "'it''s  ok',x'AB',\"a\"\"  b\"",
    );
  });

  it("keeps comments as tokens, with their inner whitespace", () => {
    expect(normaliseSql("a  /*  two  spaces  */  b")).toBe("a/*  two  spaces  */b");
    expect(normaliseSql("a  --  it's  a  note\n  b")).toBe("a--  it's  a  note\nb");
    expect(normaliseSql("a /* one */ b")).not.toBe(normaliseSql("a /* other */ b"));
  });

  it("does not take a character the engine reads as part of a name for whitespace", () => {
    const noBreakSpace = " ";
    expect(normaliseSql(`a ${noBreakSpace} b`)).toBe(`a ${noBreakSpace} b`);
    expect(normaliseSql(`a${noBreakSpace}b`)).toBe(`a${noBreakSpace}b`);
  });
});

describe("checksIn", () => {
  const fixture = `CREATE TABLE "CHECK (fake > 0)" (
    id INTEGER PRIMARY KEY,
    "check" TEXT DEFAULT 'CHECK (fake > 1)', -- CHECK (fake > 2)
    bare INTEGER CHECK (bare > 0),
    tricky TEXT CHECK ( tricky <> ')' AND tricky <> '-- not a comment' ),
    multi INTEGER CONSTRAINT multi_ck CHECK (
      multi IN (1, 2) -- the two allowed
      OR multi IS NULL
    ),
    /* CHECK (fake > 3) */
    late INTEGER CONSTRAINT "late ""quoted"" ck" NOT NULL CHECK (late > 0) CHECK (late < 9),
    CONSTRAINT named_ck CHECK (id > 0),
    CONSTRAINT other_unique UNIQUE (late),
    CHECK ("check" <> '') ON CONFLICT FAIL
  ) STRICT`;

  it("returns every table and column CHECK with its exact expression", () => {
    expect(checksIn(fixture)).toEqual([
      { name: null, expression: "bare > 0" },
      { name: null, expression: "tricky <> ')' AND tricky <> '-- not a comment'" },
      {
        name: "multi_ck",
        expression: "multi IN (1, 2) -- the two allowed\n      OR multi IS NULL",
      },
      { name: 'late "quoted" ck', expression: "late > 0" },
      { name: 'late "quoted" ck', expression: "late < 9" },
      { name: "named_ck", expression: "id > 0" },
      { name: null, expression: `"check" <> ''` },
    ]);
  });

  it("names a CHECK as the engine does", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(fixture.replace(" STRICT", ""));
    const refusal = (values: string): string => {
      try {
        db.exec(`INSERT INTO "CHECK (fake > 0)" (id, "check", late, bare) VALUES ${values}`);
      } catch (error) {
        return (error as Error).message;
      }
      return "accepted";
    };
    expect(refusal(`(1, 'x', 10, 1)`)).toBe(`CHECK constraint failed: late "quoted" ck`);
    expect(refusal(`(-1, 'x', 1, 1)`)).toBe("CHECK constraint failed: named_ck");
    expect(refusal(`(1, 'x', 1, -1)`)).toBe("CHECK constraint failed: bare > 0");
    db.close();
  });

  it("gives back expressions the engine applies the same way", () => {
    const db = new DatabaseSync(":memory:");
    const clauses = checksIn(`CREATE TABLE t (
      a TEXT CHECK (a <> ')' AND a <> '-- x'),
      b INTEGER CHECK (b IN (1, 2) -- note
      )
    )`);
    db.exec(
      `CREATE TABLE copy (a TEXT, b INTEGER, ${clauses.map((c) => `CHECK (${c.expression}\n)`).join(", ")})`,
    );
    expect(() => db.exec(`INSERT INTO copy VALUES ('fine', 1)`)).not.toThrow();
    expect(() => db.exec(`INSERT INTO copy VALUES (')', 1)`)).toThrow(/CHECK constraint failed/);
    expect(() => db.exec(`INSERT INTO copy VALUES ('-- x', 1)`)).toThrow(/CHECK constraint failed/);
    expect(() => db.exec(`INSERT INTO copy VALUES ('fine', 3)`)).toThrow(/CHECK constraint failed/);
    db.close();
  });

  it("finds nothing in a table that has no CHECK", () => {
    expect(checksIn(`CREATE TABLE t (a TEXT DEFAULT 'CHECK (a)')`)).toEqual([]);
  });
});

describe("createdObject", () => {
  it.each([
    ["CREATE TABLE `a b` (x)", { kind: "table", name: "a b" }],
    ['create  temp table if not exists "t" (x)', { kind: "table", name: "t" }],
    ["CREATE UNIQUE INDEX IF NOT EXISTS main.[i] ON t (x)", { kind: "index", name: "i" }],
    [
      "-- note\nCREATE TRIGGER t_x BEFORE INSERT ON t BEGIN SELECT 1; END",
      { kind: "trigger", name: "t_x" },
    ],
    ["CREATE VIEW v AS SELECT 1", { kind: "view", name: "v" }],
  ])("names what %s creates", (sql, expected) => {
    expect(createdObject(sql)).toEqual(expected);
  });

  it.each([
    "INSERT INTO t VALUES (1)",
    "ALTER TABLE t ADD COLUMN y",
    "CREATE VIRTUAL TABLE v USING fts5(x)",
    "",
  ])("answers null for %j", (sql) => {
    expect(createdObject(sql)).toBeNull();
  });
});
