import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSchema, type SchemaList } from "./read-schema.js";

const FIXTURE = `
CREATE TABLE parents (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE);
CREATE TABLE "child table" (
  first_id INTEGER NOT NULL,
  second_id INTEGER NOT NULL,
  parent_id INTEGER DEFAULT 7 REFERENCES parents (id) ON DELETE CASCADE ON UPDATE SET NULL,
  label TEXT DEFAULT 'a  b',
  doubled INTEGER GENERATED ALWAYS AS (first_id * 2) VIRTUAL,
  tripled INTEGER GENERATED ALWAYS AS (first_id * 3) STORED,
  CONSTRAINT child_pk PRIMARY KEY (second_id, first_id),
  CONSTRAINT label_ck CHECK (label <> ')') ON CONFLICT FAIL,
  CHECK (first_id > 0)
);
CREATE TABLE kv (k TEXT PRIMARY KEY, v BLOB) STRICT, WITHOUT ROWID;
CREATE TABLE cells (a);
CREATE VIEW parent_codes AS SELECT code FROM parents;
CREATE UNIQUE INDEX child_label ON "child table" (label COLLATE NOCASE DESC, first_id ASC);
CREATE INDEX child_lower ON "child table" (lower(label), (first_id + 1) COLLATE RTRIM DESC)
  WHERE label <> 'x  ) y' AND parent_id IS NOT NULL;
CREATE TRIGGER parents_first AFTER UPDATE OF code, id ON parents
  FOR EACH ROW WHEN new.code <> 'x -- y' AND CASE WHEN old.id > 0 THEN 1 ELSE 0 END
BEGIN
  -- a note; with a semicolon and END
  UPDATE parents SET code = 'END;  BEGIN' WHERE id = new.id;

  SELECT CASE WHEN 1 THEN 2 END;
END;
CREATE TRIGGER parents_second AFTER UPDATE ON parents BEGIN SELECT 1; END;
CREATE TRIGGER before BEFORE DELETE ON parents BEGIN SELECT 2; END;
CREATE TRIGGER child_default INSERT ON "child table" BEGIN SELECT 3; END /* tail */;
CREATE TRIGGER codes_instead INSTEAD OF INSERT ON parent_codes BEGIN SELECT 4; END;
`;

const byName = <T extends { name: string }>(entries: readonly T[], name: string): T => {
  const found = entries.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`no ${name}`);
  return found;
};

describe("readSchema", () => {
  let db: DatabaseSync;
  let list: SchemaList;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(FIXTURE);
    db.exec(`
      INSERT INTO parents (code) VALUES ('p1');
      INSERT INTO kv VALUES ('bytes', x'00ff10e2'), ('none', NULL), ('empty', x'');
      INSERT INTO cells VALUES
        (NULL), (1), (1.0), ('1'), (x'31'), (9007199254740993), (0.1), (9e999),
        ('a  b'), ('a' || char(0) || 'b');
    `);
    list = readSchema(db);
  });

  afterEach(() => {
    db?.close();
  });

  it("lists every table, view, index and trigger, leaving out the catalogue itself", () => {
    expect(list.tables.map((table) => table.name)).toEqual([
      "cells",
      "child table",
      "kv",
      "parents",
      "sqlite_sequence",
    ]);
    expect(list.views.map((view) => view.name)).toEqual(["parent_codes"]);
    expect(list.indexes.map((index) => index.name)).toEqual([
      "child_label",
      "child_lower",
      "sqlite_autoindex_child table_1",
      "sqlite_autoindex_kv_1",
      "sqlite_autoindex_parents_1",
    ]);
    expect(list.triggers.map((trigger) => trigger.name)).toEqual([
      "child_default",
      "codes_instead",
      "parents_first",
      "parents_second",
      "before",
    ]);
  });

  it("reads table options", () => {
    expect(byName(list.tables, "kv")).toMatchObject({
      type: "table",
      strict: true,
      withoutRowid: true,
      autoincrement: false,
    });
    expect(byName(list.tables, "parents")).toMatchObject({
      strict: false,
      withoutRowid: false,
      autoincrement: true,
    });
  });

  it("reads columns in order, with type, nullability, default, generated status and key position", () => {
    expect(byName(list.tables, "child table").columns).toEqual([
      {
        name: "first_id",
        type: "INTEGER",
        notNull: true,
        defaultValue: null,
        hidden: 0,
        primaryKeyPosition: 2,
      },
      {
        name: "second_id",
        type: "INTEGER",
        notNull: true,
        defaultValue: null,
        hidden: 0,
        primaryKeyPosition: 1,
      },
      {
        name: "parent_id",
        type: "INTEGER",
        notNull: false,
        defaultValue: "7",
        hidden: 0,
        primaryKeyPosition: 0,
      },
      {
        name: "label",
        type: "TEXT",
        notNull: false,
        defaultValue: "'a  b'",
        hidden: 0,
        primaryKeyPosition: 0,
      },
      {
        name: "doubled",
        type: "INTEGER",
        notNull: false,
        defaultValue: null,
        hidden: 2,
        primaryKeyPosition: 0,
      },
      {
        name: "tripled",
        type: "INTEGER",
        notNull: false,
        defaultValue: null,
        hidden: 3,
        primaryKeyPosition: 0,
      },
    ]);
    expect(byName(list.views, "parent_codes").columns.map((column) => column.name)).toEqual([
      "code",
    ]);
  });

  it("reads foreign keys with both actions", () => {
    expect(byName(list.tables, "child table").foreignKeys).toEqual([
      {
        table: "parents",
        from: ["parent_id"],
        to: ["id"],
        onUpdate: "SET NULL",
        onDelete: "CASCADE",
        match: "NONE",
        deferrable: null,
      },
    ]);
  });

  it("ignores an ON INSERT clause, which the engine accepts and ignores", () => {
    const other = new DatabaseSync(":memory:");
    try {
      other.exec(`
        CREATE TABLE p (a INTEGER UNIQUE);
        CREATE TABLE c (x INTEGER, FOREIGN KEY (x) REFERENCES p (a) ON INSERT CASCADE ON DELETE SET NULL);
      `);
      expect(byName(readSchema(other).tables, "c").foreignKeys).toMatchObject([
        { table: "p", from: ["x"], to: ["a"], onUpdate: "NO ACTION", onDelete: "SET NULL" },
      ]);
    } finally {
      other.close();
    }
  });

  it("reads a composite foreign key column by column, and an implicit target as null", () => {
    db.exec(`
      CREATE TABLE pair_target (a, b, PRIMARY KEY (a, b));
      CREATE TABLE pairs (x, y, z REFERENCES parents, FOREIGN KEY (y, x) REFERENCES pair_target (b, a));
    `);
    const keys = byName(readSchema(db).tables, "pairs").foreignKeys;
    expect(keys.map((key) => [key.table, key.from, key.to])).toEqual([
      ["pair_target", ["y", "x"], ["b", "a"]],
      ["parents", ["z"], [null]],
    ]);
  });

  it("reads CHECKs with their conflict clauses", () => {
    expect(byName(list.tables, "child table").checks).toEqual([
      { name: "label_ck", expression: "label <> ')'", onConflict: "FAIL" },
      { name: null, expression: "first_id > 0", onConflict: null },
    ]);
  });

  it("reads an explicit index: unique, key order, collation, descending", () => {
    expect(byName(list.indexes, "child_label")).toMatchObject({
      table: "child table",
      unique: true,
      origin: "c",
      partial: false,
      predicate: null,
      columns: [
        { column: "label", expression: null, descending: true, collation: "NOCASE", key: true },
        { column: "first_id", expression: null, descending: false, collation: "BINARY", key: true },
        { column: null, expression: null, descending: false, collation: "BINARY", key: false },
      ],
    });
  });

  it("reads an index's partial predicate and expression SQL", () => {
    expect(byName(list.indexes, "child_lower")).toMatchObject({
      unique: false,
      partial: true,
      predicate: "label <> 'x  ) y' AND parent_id IS NOT NULL",
    });
    const keys = byName(list.indexes, "child_lower").columns.filter((column) => column.key);
    expect(keys).toEqual([
      {
        column: null,
        expression: "lower(label)",
        descending: false,
        collation: "BINARY",
        key: true,
      },
      {
        column: null,
        expression: "(first_id + 1)",
        descending: true,
        collation: "RTRIM",
        key: true,
      },
    ]);
  });

  it("reads implicit indexes by origin, with no stored SQL", () => {
    expect(byName(list.indexes, "sqlite_autoindex_parents_1")).toMatchObject({
      table: "parents",
      unique: true,
      origin: "u",
      sql: null,
    });
    expect(byName(list.indexes, "sqlite_autoindex_kv_1")).toMatchObject({
      table: "kv",
      origin: "pk",
    });
  });

  it("reads a trigger's target, event, WHEN and whole multi-line body", () => {
    expect(byName(list.triggers, "parents_first")).toMatchObject({
      table: "parents",
      timing: "AFTER",
      event: "UPDATE",
      updateOf: ["code", "id"],
      when: "new.code <> 'x -- y' AND CASE WHEN old.id > 0 THEN 1 ELSE 0 END",
      body: `-- a note; with a semicolon and END
  UPDATE parents SET code = 'END;  BEGIN' WHERE id = new.id;

  SELECT CASE WHEN 1 THEN 2 END;`,
    });
  });

  it("reads each trigger timing and event, including the engine's default and a keyword name", () => {
    expect(byName(list.triggers, "before")).toMatchObject({
      timing: "BEFORE",
      event: "DELETE",
      updateOf: null,
      when: null,
      body: "SELECT 2;",
    });
    expect(byName(list.triggers, "child_default")).toMatchObject({
      timing: "BEFORE",
      event: "INSERT",
      body: "SELECT 3;",
    });
    expect(byName(list.triggers, "codes_instead")).toMatchObject({
      table: "parent_codes",
      timing: "INSTEAD OF",
      event: "INSERT",
    });
  });

  it("gives back a trigger that rebuilds from its parts", () => {
    const trigger = byName(list.triggers, "parents_first");
    const rebuilt = `CREATE TRIGGER rebuilt ${trigger.timing} ${trigger.event} OF ${trigger.updateOf?.join(", ")} ON ${trigger.table} WHEN ${trigger.when} BEGIN ${trigger.body} END`;
    db.exec(rebuilt);
    const reread = byName(readSchema(db).triggers, "rebuilt");
    expect([reread.when, reread.body]).toEqual([trigger.when, trigger.body]);
  });

  it("does not take a column named begin for the start of a trigger's body", () => {
    db.exec(`
      CREATE TABLE spans (begin INTEGER);
      CREATE TRIGGER spans_begin AFTER INSERT ON spans WHEN new.begin > 0 BEGIN SELECT 5; END;
    `);
    expect(byName(readSchema(db).triggers, "spans_begin")).toMatchObject({
      when: "new.begin > 0",
      body: "SELECT 5;",
    });
  });

  it("numbers triggers by creation order on the same table", () => {
    const order = list.triggers
      .filter((trigger) => trigger.table === "parents")
      .map((trigger) => [trigger.name, trigger.creationOrder]);
    expect(order).toEqual([
      ["parents_first", 0],
      ["parents_second", 1],
      ["before", 2],
    ]);
  });

  it("keeps creation order when a later trigger takes a name that sorts earlier", () => {
    db.exec(`CREATE TRIGGER aaa_late AFTER UPDATE ON parents BEGIN SELECT 6; END;`);
    expect(byName(readSchema(db).triggers, "aaa_late").creationOrder).toBe(3);
  });

  it("carries each object's stored SQL and catalogue rowid", () => {
    const stored = new Map(
      db
        .prepare("SELECT name, sql, rowid FROM sqlite_schema")
        .all()
        .map((row) => [row.name as string, { sql: row.sql, rowid: row.rowid }]),
    );
    for (const entry of [...list.tables, ...list.views, ...list.indexes, ...list.triggers]) {
      expect({ sql: entry.sql, rowid: entry.rowid }).toEqual(
        stored.get(entry.name) ?? { sql: null, rowid: null },
      );
    }
    expect(stored.has("sqlite_autoindex_kv_1")).toBe(false);
    expect(byName(list.tables, "kv").sql).toBe(
      "CREATE TABLE kv (k TEXT PRIMARY KEY, v BLOB) STRICT, WITHOUT ROWID",
    );
  });

  it("reads BLOBs byte-exact", () => {
    expect(byName(list.tables, "kv").rows).toEqual([
      [
        ["text", "bytes"],
        ["blob", "00ff10e2"],
      ],
      [
        ["text", "empty"],
        ["blob", ""],
      ],
      [["text", "none"], ["null"]],
    ]);
  });

  it("keeps each value's storage type and full precision", () => {
    expect(byName(list.tables, "cells").rows.map((row) => row[0])).toEqual([
      ["null"],
      ["integer", "1"],
      ["real", "1"],
      ["text", "1"],
      ["blob", "31"],
      ["integer", "9007199254740993"],
      ["real", "0.1"],
      ["real", "Infinity"],
      ["text", "a  b"],
      ["text", "a\u0000b"],
    ]);
  });

  it("tells reals apart that differ in their last bit, and negative zero from zero", () => {
    db.exec(`
      CREATE TABLE reals (r);
      INSERT INTO reals VALUES (0.3), (0.1 + 0.2), (0.0), (-1e-320 * 1e-320);
    `);
    expect(byName(readSchema(db).tables, "reals").rows).toEqual([
      [["real", "0.3"]],
      [["real", "0.30000000000000004"]],
      [["real", "0"]],
      [["real", "-0"]],
    ]);
  });

  it("reads engine-owned sequence rows", () => {
    expect(byName(list.tables, "sqlite_sequence").rows).toEqual([
      [
        ["text", "parents"],
        ["integer", "1"],
      ],
    ]);
  });

  it("refuses text whose bytes it could not give back exactly", () => {
    db.exec(`
      CREATE TABLE broken (t TEXT);
      INSERT INTO broken VALUES (CAST(x'ff' AS TEXT));
    `);
    expect(() => readSchema(db)).toThrow(/broken\.t/);
  });

  it("reads the protections only the stored CREATE text states", () => {
    db.exec(`
      CREATE TABLE declared (
        id INTEGER PRIMARY KEY ASC ON CONFLICT REPLACE AUTOINCREMENT,
        code TEXT COLLATE NOCASE NOT NULL ON CONFLICT IGNORE UNIQUE ON CONFLICT FAIL,
        plain TEXT DEFAULT -1 NOT NULL,
        twice INTEGER GENERATED ALWAYS AS (id  *  2) STORED,
        parent INTEGER REFERENCES parents (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
        other INTEGER CONSTRAINT other_fk REFERENCES parents MATCH SIMPLE NOT DEFERRABLE,
        CONSTRAINT both_unique UNIQUE (code, plain) ON CONFLICT ROLLBACK,
        FOREIGN KEY (plain, code) REFERENCES "child table" (label, first_id) DEFERRABLE,
        CHECK (plain <> ',')
      );
    `);
    expect(byName(readSchema(db).tables, "declared").declared).toEqual({
      columns: [
        { name: "id", collation: null, generated: null, notNullOnConflict: null },
        { name: "code", collation: "NOCASE", generated: null, notNullOnConflict: "IGNORE" },
        { name: "plain", collation: null, generated: null, notNullOnConflict: null },
        { name: "twice", collation: null, generated: "id  *  2", notNullOnConflict: null },
        { name: "parent", collation: null, generated: null, notNullOnConflict: null },
        { name: "other", collation: null, generated: null, notNullOnConflict: null },
      ],
      keys: [
        { kind: "PRIMARY KEY", columns: ["id"], onConflict: "REPLACE" },
        { kind: "UNIQUE", columns: ["code"], onConflict: "FAIL" },
        { kind: "UNIQUE", columns: ["code", "plain"], onConflict: "ROLLBACK" },
      ],
    });
    expect(
      byName(readSchema(db).tables, "declared").foreignKeys.map((key) => [
        key.table,
        key.from,
        key.to,
        key.onDelete,
        key.match,
        key.deferrable,
      ]),
    ).toEqual([
      ["child table", ["plain", "code"], ["label", "first_id"], "NO ACTION", "NONE", "DEFERRABLE"],
      ["parents", ["other"], [null], "NO ACTION", "NONE", "NOT DEFERRABLE"],
      ["parents", ["parent"], ["id"], "CASCADE", "NONE", "DEFERRABLE INITIALLY DEFERRED"],
    ]);
  });

  it("attaches each DEFERRABLE setting to the key whose whole definition it was declared with", () => {
    db.exec(`
      CREATE TABLE two_parents (id INTEGER PRIMARY KEY, a UNIQUE, b UNIQUE);
      CREATE TABLE "Twice" (
        X,
        FOREIGN KEY (x) REFERENCES "TWO_parents" (A) ON DELETE set null DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (x) REFERENCES two_parents (a) NOT DEFERRABLE INITIALLY IMMEDIATE,
        FOREIGN KEY (x) REFERENCES two_parents (b) DEFERRABLE,
        FOREIGN KEY (x) REFERENCES two_parents ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE
      );
    `);
    expect(
      byName(readSchema(db).tables, "Twice").foreignKeys.map((key) => [
        key.to,
        key.onDelete,
        key.deferrable,
      ]),
    ).toEqual([
      [[null], "NO ACTION", "DEFERRABLE INITIALLY IMMEDIATE"],
      [["b"], "NO ACTION", "DEFERRABLE"],
      [["a"], "NO ACTION", "NOT DEFERRABLE INITIALLY IMMEDIATE"],
      [["A"], "SET NULL", "DEFERRABLE INITIALLY DEFERRED"],
    ]);
  });

  it("reads what a later ALTER TABLE added to a column", () => {
    db.exec(`ALTER TABLE cells ADD COLUMN extra TEXT COLLATE RTRIM`);
    expect(byName(readSchema(db).tables, "cells").declared.columns).toEqual([
      { name: "a", collation: null, generated: null, notNullOnConflict: null },
      { name: "extra", collation: "RTRIM", generated: null, notNullOnConflict: null },
    ]);
  });

  it("survives names that need quoting", () => {
    db.exec(`CREATE TABLE "odd ""name" ("a ""col" INTEGER); INSERT INTO "odd ""name" VALUES (2);`);
    expect(byName(readSchema(db).tables, 'odd "name').rows).toEqual([[["integer", "2"]]]);
  });
});
