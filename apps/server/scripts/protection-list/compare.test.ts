import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  compareSchemaLists,
  formatDifferences,
  type Difference,
  type SchemaListEntry,
  type SchemaListFile,
} from "./compare.js";
import { readSchema } from "./read-schema.js";

const BASE = `
CREATE TABLE parents (
  id INTEGER PRIMARY KEY ON CONFLICT ABORT AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE ON CONFLICT ABORT,
  data BLOB
);
CREATE TABLE sales (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES parents (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  amount INTEGER NOT NULL ON CONFLICT ABORT DEFAULT 0,
  label TEXT COLLATE NOCASE,
  doubled INTEGER GENERATED ALWAYS AS (amount * 2),
  CONSTRAINT sales_source_ck CHECK (amount >= 0)
);
CREATE TABLE pairs (a TEXT, b TEXT, PRIMARY KEY (a, b));
CREATE TABLE notes (body TEXT);
CREATE UNIQUE INDEX sales_label ON sales (label, amount);
CREATE INDEX sales_lower ON sales (lower(label)) WHERE amount > 0;
CREATE TRIGGER sales_first AFTER INSERT ON sales BEGIN SELECT 1; END;
CREATE TRIGGER sales_second AFTER INSERT ON sales BEGIN SELECT 2; END;
CREATE TRIGGER sales_update BEFORE UPDATE ON sales BEGIN SELECT 3; END;
CREATE TABLE __drizzle_migrations_core (id INTEGER PRIMARY KEY, hash TEXT);
CREATE INDEX drizzle_hash ON __drizzle_migrations_core (hash);
INSERT INTO parents (code, data) VALUES ('p1', x'00ff'), ('p2', x'01');
INSERT INTO __drizzle_migrations_core (hash) VALUES ('h1');
`;

function entryOf(sql: string, overrides: Partial<SchemaListEntry> = {}): SchemaListEntry {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(sql);
    return {
      composition: "fiscal-verifactu",
      phase: "post-runtime",
      database: "venue",
      setOrder: ["core", "catalogue"],
      journals: { core: { entries: [{ idx: 0, tag: "0000_core" }] } },
      bookkeepingRows: { core: 1 },
      owningSet: { "table sales": "core" },
      schema: readSchema(db),
      ...overrides,
    };
  } finally {
    db.close();
  }
}

const fileOf = (...entries: SchemaListEntry[]): SchemaListFile => ({ entries });

function variant(from: string, to: string): string {
  if (!BASE.includes(from)) throw new Error(`The fixture has no ${from}`);
  return BASE.replace(from, to);
}

const where = { composition: "fiscal-verifactu", phase: "post-runtime", database: "venue" };

function against(sql: string): Difference[] {
  return compareSchemaLists(fileOf(entryOf(BASE)), fileOf(entryOf(sql)));
}

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, inner]) => [key, reverseKeys(inner)]),
    );
  }
  return value;
}

describe("compareSchemaLists accepts", () => {
  it("the same schema", () => {
    expect(against(BASE)).toEqual([]);
  });

  it("reordered keys and rows", () => {
    const entry = entryOf(BASE);
    const rowsReversed: SchemaListEntry = {
      ...entry,
      schema: {
        ...entry.schema,
        tables: entry.schema.tables.map((table) => ({ ...table, rows: [...table.rows].reverse() })),
      },
    };
    const parents = rowsReversed.schema.tables.find((table) => table.name === "parents");
    expect(parents?.rows[0]?.[1]).toEqual(["text", "p2"]);
    const reordered = reverseKeys(fileOf(rowsReversed)) as SchemaListFile;
    expect(Object.keys(reordered.entries[0] ?? {})[0]).toBe("schema");
    expect(compareSchemaLists(fileOf(entry), reordered)).toEqual([]);
  });

  it("whitespace outside quotes, and different quoting of the same names", () => {
    const spaced = variant("CHECK (amount >= 0)", "CHECK (  amount\n  >=   0 )")
      .replace("WHERE amount > 0", "WHERE   amount   >   0")
      .replace("BEGIN SELECT 1; END", "BEGIN\n  SELECT   1;\nEND")
      .replace("CREATE TABLE notes (body TEXT)", 'CREATE TABLE "notes" ( "body"   TEXT )');
    expect(against(spaced)).toEqual([]);
  });

  it("differences only in set order, journals, owning set, rowids and stored sql", () => {
    const before = fileOf(entryOf(BASE));
    const movedFirst = `CREATE TABLE notes (body TEXT);\n${variant("CREATE TABLE notes (body TEXT);", "")}`;
    const after = fileOf(
      entryOf(movedFirst, {
        setOrder: ["catalogue", "core"],
        journals: { merged: { entries: [] } },
        bookkeepingRows: { merged: 8 },
        owningSet: { "table sales": "merged" },
      }),
    );
    expect(compareSchemaLists(before, after)).toEqual([]);
  });

  it("the bookkeeping tables changing, or going", () => {
    const renamed = variant(
      "CREATE TABLE __drizzle_migrations_core (id INTEGER PRIMARY KEY, hash TEXT);\nCREATE INDEX drizzle_hash ON __drizzle_migrations_core (hash);",
      "CREATE TABLE __drizzle_migrations_merged (id INTEGER PRIMARY KEY, created_at INTEGER);",
    ).replace("INSERT INTO __drizzle_migrations_core (hash) VALUES ('h1');", "");
    expect(against(renamed)).toEqual([]);
  });

  it("triggers on one table created in another order when they differ in timing or event", () => {
    const moved = variant(
      "CREATE TRIGGER sales_update BEFORE UPDATE ON sales BEGIN SELECT 3; END;",
      "",
    ).replace(
      "CREATE TRIGGER sales_first",
      "CREATE TRIGGER sales_update BEFORE UPDATE ON sales BEGIN SELECT 3; END;\nCREATE TRIGGER sales_first",
    );
    expect(against(moved)).toEqual([]);
  });
});

describe("compareSchemaLists refuses", () => {
  const missing = (object: string): Difference => ({ kind: "missing", ...where, object });
  const extra = (object: string): Difference => ({ kind: "extra", ...where, object });
  const changed = (object: string, before: string, after: string): Difference => ({
    kind: "changed",
    ...where,
    object,
    before,
    after,
  });

  it("a missing table", () => {
    expect(against(variant("CREATE TABLE notes (body TEXT);", ""))).toEqual([
      missing("table notes"),
    ]);
  });

  it("a missing index", () => {
    expect(
      against(variant("CREATE INDEX sales_lower ON sales (lower(label)) WHERE amount > 0;", "")),
    ).toEqual([missing("index sales_lower")]);
  });

  it("a missing CHECK", () => {
    expect(against(variant(",\n  CONSTRAINT sales_source_ck CHECK (amount >= 0)", ""))).toEqual([
      missing("table sales.checks[sales_source_ck]"),
    ]);
  });

  it("a missing foreign key", () => {
    expect(
      against(
        variant(" REFERENCES parents (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED", ""),
      ),
    ).toEqual([missing("table sales.foreignKeys[parent_id->parents(id)]")]);
  });

  it("a missing trigger", () => {
    expect(
      against(
        variant("CREATE TRIGGER sales_update BEFORE UPDATE ON sales BEGIN SELECT 3; END;", ""),
      ),
    ).toEqual([missing("trigger sales_update")]);
  });

  it("an extra object", () => {
    expect(against(`${BASE}\nCREATE INDEX notes_body ON notes (body);`)).toEqual([
      extra("index notes_body"),
    ]);
  });

  it("a same-name change to a foreign key's action", () => {
    expect(against(variant("ON DELETE CASCADE", "ON DELETE SET NULL"))).toEqual([
      changed("table sales.foreignKeys[parent_id->parents(id)].onDelete", "CASCADE", "SET NULL"),
    ]);
  });

  it("a same-name change to a foreign key's DEFERRABLE setting", () => {
    expect(
      against(variant("DEFERRABLE INITIALLY DEFERRED", "DEFERRABLE INITIALLY IMMEDIATE")),
    ).toEqual([
      changed(
        "table sales.foreignKeys[parent_id->parents(id)].deferrable",
        "DEFERRABLE INITIALLY DEFERRED",
        "DEFERRABLE INITIALLY IMMEDIATE",
      ),
    ]);
  });

  it("a same-name change to a CHECK body", () => {
    expect(against(variant("CHECK (amount >= 0)", "CHECK (amount > 0)"))).toEqual([
      changed("table sales.checks[sales_source_ck].expression", "amount>=0", "amount>0"),
    ]);
  });

  it("a same-name change to an index expression", () => {
    expect(against(variant("(lower(label))", "(upper(label))"))).toEqual([
      changed("index sales_lower.columns[0].expression", "lower(label)", "upper(label)"),
    ]);
  });

  it("a same-name change to an index predicate", () => {
    expect(against(variant("WHERE amount > 0", "WHERE amount > 1"))).toEqual([
      changed("index sales_lower.predicate", "amount>0", "amount>1"),
    ]);
  });

  it("a same-name change to a column type", () => {
    expect(against(variant("label TEXT COLLATE", "label BLOB COLLATE"))).toEqual([
      changed("table sales.columns[label].type", "TEXT", "BLOB"),
    ]);
  });

  it("a same-name change to a column default", () => {
    expect(against(variant("DEFAULT 0", "DEFAULT 1"))).toEqual([
      changed("table sales.columns[amount].defaultValue", "0", "1"),
    ]);
  });

  it("a same-name change to a column's own COLLATE", () => {
    expect(against(variant("COLLATE NOCASE", "COLLATE RTRIM"))).toEqual([
      changed("index sales_label.columns[0].collation", "NOCASE", "RTRIM"),
      changed("table sales.columns[label].collation", "NOCASE", "RTRIM"),
    ]);
  });

  it("a same-name change to a generated column's formula", () => {
    expect(against(variant("AS (amount * 2)", "AS (amount * 3)"))).toEqual([
      changed("table sales.columns[doubled].generated", "amount*2", "amount*3"),
    ]);
  });

  it("a same-name change to a NOT NULL conflict clause", () => {
    expect(
      against(variant("NOT NULL ON CONFLICT ABORT DEFAULT", "NOT NULL ON CONFLICT IGNORE DEFAULT")),
    ).toEqual([changed("table sales.columns[amount].notNullOnConflict", "ABORT", "IGNORE")]);
  });

  it("a same-name change to a UNIQUE conflict clause", () => {
    expect(against(variant("UNIQUE ON CONFLICT ABORT", "UNIQUE ON CONFLICT REPLACE"))).toEqual([
      changed("table parents.keys[UNIQUE(code)].onConflict", "ABORT", "REPLACE"),
    ]);
  });

  it("a same-name change to a PRIMARY KEY conflict clause", () => {
    expect(
      against(variant("PRIMARY KEY ON CONFLICT ABORT", "PRIMARY KEY ON CONFLICT FAIL")),
    ).toEqual([changed("table parents.keys[PRIMARY KEY(id)].onConflict", "ABORT", "FAIL")]);
  });

  it("a same-name change to a primary-key position", () => {
    expect(against(variant("PRIMARY KEY (a, b)", "PRIMARY KEY (b, a)"))).toEqual([
      missing("index pairs.primary key(a,b)"),
      changed("table pairs.columns[a].primaryKeyPosition", "1", "2"),
      changed("table pairs.columns[b].primaryKeyPosition", "2", "1"),
      missing("table pairs.keys[PRIMARY KEY(a,b)]"),
      extra("table pairs.keys[PRIMARY KEY(b,a)]"),
      extra("index pairs.primary key(b,a)"),
    ]);
  });

  it("a same-name change to a unique index's column list", () => {
    expect(against(variant("sales (label, amount)", "sales (label, id)"))).toEqual([
      changed("index sales_label.columns[1].column", "amount", "id"),
    ]);
  });

  it("a same-name change to a trigger body", () => {
    expect(against(variant("SELECT 1; END", "SELECT 9; END"))).toEqual([
      changed("trigger sales_first.body", "SELECT 1;", "SELECT 9;"),
    ]);
  });

  it("two triggers with the same table, timing and event created in the other order", () => {
    const swapped = variant(
      "CREATE TRIGGER sales_first AFTER INSERT ON sales BEGIN SELECT 1; END;\nCREATE TRIGGER sales_second AFTER INSERT ON sales BEGIN SELECT 2; END;",
      "CREATE TRIGGER sales_second AFTER INSERT ON sales BEGIN SELECT 2; END;\nCREATE TRIGGER sales_first AFTER INSERT ON sales BEGIN SELECT 1; END;",
    );
    expect(against(swapped)).toEqual([
      changed("trigger sales_first.order", "0", "1"),
      changed("trigger sales_second.order", "1", "0"),
    ]);
  });

  it("a changed BLOB byte", () => {
    expect(against(variant("x'00ff'", "x'00fe'"))).toEqual([
      changed(
        "table parents.rows[0]",
        '[["integer","1"],["text","p1"],["blob","00ff"]]',
        '[["integer","1"],["text","p1"],["blob","00fe"]]',
      ),
    ]);
  });

  it("a changed seeded value", () => {
    expect(against(variant("('p2', x'01')", "('p3', x'01')"))).toEqual([
      changed(
        "table parents.rows[1]",
        '[["integer","2"],["text","p2"],["blob","01"]]',
        '[["integer","2"],["text","p3"],["blob","01"]]',
      ),
    ]);
  });

  it("a whole database or phase on one side only", () => {
    const before = fileOf(entryOf(BASE), entryOf(BASE, { phase: "pre-runtime" }));
    const after = fileOf(entryOf(BASE), entryOf(BASE, { database: "node" }));
    expect(compareSchemaLists(before, after)).toEqual([
      { kind: "missing", ...where, phase: "pre-runtime", object: "database venue" },
      { kind: "extra", ...where, database: "node", object: "database node" },
    ]);
  });

  it("either side with nothing to compare", () => {
    const empty = fileOf(entryOf("CREATE TABLE __drizzle_migrations_core (id INTEGER);"));
    const full = fileOf(entryOf(BASE));
    expect(() => compareSchemaLists(empty, full)).toThrow(/nothing to compare/);
    expect(() => compareSchemaLists(full, empty)).toThrow(/nothing to compare/);
    expect(() => compareSchemaLists(fileOf(), full)).toThrow(/nothing to compare/);
    expect(() => compareSchemaLists(full, fileOf())).toThrow(/nothing to compare/);
  });

  it("either side listing one composition, phase and database twice", () => {
    const original = entryOf(BASE);
    const changedEntry = entryOf(variant("CHECK (amount >= 0)", "CHECK (amount > 0)"));
    const twice = /lists composition=fiscal-verifactu phase=post-runtime database=venue twice/;
    expect(() => compareSchemaLists(fileOf(changedEntry, original), fileOf(original))).toThrow(
      twice,
    );
    expect(() => compareSchemaLists(fileOf(original), fileOf(original, changedEntry))).toThrow(
      twice,
    );
  });
});

describe("compareSchemaLists on two foreign keys from one column", () => {
  const twoKeys = (first: string, second: string): string => `
    CREATE TABLE p (id INTEGER PRIMARY KEY, a UNIQUE, b UNIQUE);
    CREATE TABLE c (x, FOREIGN KEY (x) REFERENCES ${first}, FOREIGN KEY (x) REFERENCES ${second});
  `;
  const compare = (before: string, after: string): Difference[] =>
    compareSchemaLists(fileOf(entryOf(before)), fileOf(entryOf(after)));
  const changed = (object: string, before: string, after: string): Difference => ({
    kind: "changed",
    ...where,
    object,
    before,
    after,
  });

  it("accepts the same keys declared in the other order", () => {
    const before = twoKeys(
      "p (a) DEFERRABLE INITIALLY DEFERRED",
      "p (b) NOT DEFERRABLE INITIALLY IMMEDIATE",
    );
    const after = twoKeys(
      "p (b) NOT DEFERRABLE INITIALLY IMMEDIATE",
      "p (a) DEFERRABLE INITIALLY DEFERRED",
    );
    expect(compare(before, before)).toEqual([]);
    expect(compare(before, after)).toEqual([]);
  });

  it("refuses their parent columns trading DEFERRABLE settings", () => {
    const before = twoKeys(
      "p (a) DEFERRABLE INITIALLY DEFERRED",
      "p (b) NOT DEFERRABLE INITIALLY IMMEDIATE",
    );
    const after = twoKeys(
      "p (b) DEFERRABLE INITIALLY DEFERRED",
      "p (a) NOT DEFERRABLE INITIALLY IMMEDIATE",
    );
    expect(compare(before, after)).toEqual([
      changed(
        "table c.foreignKeys[x->p(a)].deferrable",
        "DEFERRABLE INITIALLY DEFERRED",
        "NOT DEFERRABLE INITIALLY IMMEDIATE",
      ),
      changed(
        "table c.foreignKeys[x->p(b)].deferrable",
        "NOT DEFERRABLE INITIALLY IMMEDIATE",
        "DEFERRABLE INITIALLY DEFERRED",
      ),
    ]);
  });

  it("refuses a key to the primary key trading DEFERRABLE settings with a named one", () => {
    const before = twoKeys("p DEFERRABLE INITIALLY DEFERRED", "p (a) NOT DEFERRABLE");
    const after = twoKeys("p NOT DEFERRABLE", "p (a) DEFERRABLE INITIALLY DEFERRED");
    expect(compare(before, after)).toEqual([
      changed(
        "table c.foreignKeys[x->p(a)].deferrable",
        "NOT DEFERRABLE",
        "DEFERRABLE INITIALLY DEFERRED",
      ),
      changed(
        "table c.foreignKeys[x->p].deferrable",
        "DEFERRABLE INITIALLY DEFERRED",
        "NOT DEFERRABLE",
      ),
    ]);
  });
});

describe("formatDifferences", () => {
  it("prints EQUAL for no differences", () => {
    expect(formatDifferences([])).toBe("EQUAL");
  });

  it("prints the runbook's report under one header per composition, phase and database", () => {
    const differences = [
      ...against(
        variant("CREATE TRIGGER sales_update BEFORE UPDATE ON sales BEGIN SELECT 3; END;", ""),
      ),
      ...against(variant("CHECK (amount >= 0)", "CHECK (amount > 0)")),
      ...against(`${BASE}\nCREATE TABLE __keep_media_image_data (x);`),
    ];
    expect(formatDifferences(differences)).toBe(
      [
        "DIFF composition=fiscal-verifactu phase=post-runtime database=venue",
        "missing trigger sales_update",
        "changed table sales.checks[sales_source_ck].expression",
        "old: amount>=0",
        "new: amount>0",
        "extra table __keep_media_image_data",
      ].join("\n"),
    );
  });
});
