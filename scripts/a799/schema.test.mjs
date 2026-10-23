import { describe, expect, it } from "vitest";
import * as schema from "./schema.mjs";

const table = () => ({
  kind: "table",
  name: "products",
  table: "products",
  module: "catalogue",
  protection: "ordinary",
  rawSql:
    "CREATE TABLE products(id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'two words', CHECK(length(name)>0))",
  columns: [
    { name: "id", type: "TEXT", notNull: false, defaultSql: null, primaryKey: 1 },
    { name: "name", type: "TEXT", notNull: true, defaultSql: "'two words'", primaryKey: 0 },
  ],
  keys: [{ name: "pk", columns: ["id"], kind: "primary" }],
  checks: ["length(name)>0"],
  foreignKeys: [],
});
const trigger = () => ({
  kind: "trigger",
  name: "protect",
  table: "products",
  module: "catalogue",
  protection: "ordinary",
  rawSql:
    "CREATE TRIGGER protect BEFORE DELETE ON products BEGIN SELECT RAISE(ABORT, 'two words'); END",
  target: "products",
  body: "BEGIN SELECT RAISE(ABORT, 'two words'); END",
});
const index = () => ({
  kind: "index",
  name: "by_name",
  table: "products",
  module: "catalogue",
  protection: "ordinary",
  rawSql: "CREATE UNIQUE INDEX by_name ON products(lower(name)) WHERE name <> ''",
  unique: true,
  expressions: ["lower(name)"],
  predicate: "name <> ''",
});
const view = () => ({
  kind: "view",
  name: "named",
  table: "named",
  module: "catalogue",
  protection: "ordinary",
  rawSql: "CREATE VIEW named AS SELECT name FROM products",
  body: "SELECT name FROM products",
});

describe("complete historical schema comparison", () => {
  it.each([
    ["SELECT 1_000", "SELECT 1 _000"],
    ["SELECT 0x1_2", "SELECT 0x1 _2"],
    ["SELECT 1.2", "SELECT 1 . 2"],
    ["SELECT a<=b", "SELECT a< =b"],
    ["SELECT a||b", "SELECT a| |b"],
    ["SELECT x'1234'", "SELECT x '1234'"],
    ["SELECT 1e+2", "SELECT 1e + 2"],
    ["SELECT a--b\n+c", "SELECT a- -b+c"],
    ["SELECT 1/*a b*/", "SELECT 1/ *a b* /"],
  ])("preserves SQL token boundaries: %s", (a, b) => {
    expect(schema.sqlTokens(a)).not.toEqual(schema.sqlTokens(b));
  });
  it("refuses unterminated SQL comments", () => {
    expect(() => schema.sqlTokens("SELECT 1 /* unfinished")).toThrow("history.invalid");
  });
  it("binds an exact schema transformation to the source, candidate, module and migration", () => {
    const old = table();
    const next = table();
    next.columns.push({
      name: "label",
      type: "TEXT",
      notNull: false,
      defaultSql: null,
      primaryKey: 0,
    });
    next.rawSql =
      "CREATE TABLE products(id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'two words', label TEXT, CHECK(length(name)>0))";
    const cell = {
      sourceEpoch: "epoch",
      sourceSha: "1".repeat(40),
      candidateSha: "2".repeat(40),
      migrations: [{ hash: "3".repeat(64), module: "catalogue" }],
      disabledModules: [],
    };
    const mapping = {
      id: "nullable-label-schema",
      sourceEpoch: "epoch",
      sourceSha: cell.sourceSha,
      candidateSha: cell.candidateSha,
      migrationHash: "3".repeat(64),
      module: "catalogue",
      object: { subject: "schema", key: "table:products" },
      field: "object",
      before: old,
      after: next,
      exactTransform: "replace-exact",
      reason: "New optional label",
      approvalReceipt: "review",
    };
    expect(schema.compareSchema([old], [next], [mapping], cell)).toEqual([]);
    const damaged = globalThis.structuredClone(next);
    damaged.columns[0].type = "INTEGER";
    expect(schema.compareSchema([old], [damaged], [mapping], cell)).toContainEqual(
      expect.objectContaining({ field: "columns" }),
    );
    expect(() => schema.compareSchema([old], [next], [mapping])).toThrow("history.mapping");
    const protectedOld = { ...old, protection: "fiscal" };
    expect(() =>
      schema.compareSchema([protectedOld], [next], [{ ...mapping, before: protectedOld }], cell),
    ).toThrow("history.mapping");
  });
  it("accepts reordered objects and whitespace outside SQL quotes, retaining both input spellings", () => {
    const old = [table(), trigger(), index(), view()];
    const next = globalThis.structuredClone(old).reverse();
    next.find((o) => o.kind === "table").rawSql = table().rawSql.replaceAll(" ", "\n  ");
    // Restore the literal: whitespace inside it is data.
    next.find((o) => o.kind === "table").rawSql = next
      .find((o) => o.kind === "table")
      .rawSql.replace("two\n  words", "two words");
    expect(schema.compareSchema(old, next, [])).toEqual([]);
    expect(old[0].rawSql).toBe(table().rawSql);
    expect(next.find((o) => o.kind === "table").rawSql).toContain("\n");
  });
  it.each([
    [
      "trigger body",
      trigger,
      (o) => {
        o.body = "BEGIN SELECT 1; END";
      },
      "body",
    ],
    [
      "trigger target",
      trigger,
      (o) => {
        o.target = "other";
      },
      "target",
    ],
    [
      "quoted whitespace",
      trigger,
      (o) => {
        o.rawSql = o.rawSql.replace("two words", "two  words");
      },
      "rawSql",
    ],
    [
      "index expression",
      index,
      (o) => {
        o.expressions = ["upper(name)"];
      },
      "expressions",
    ],
    [
      "index predicate",
      index,
      (o) => {
        o.predicate = "name IS NOT NULL";
      },
      "predicate",
    ],
    [
      "index uniqueness",
      index,
      (o) => {
        o.unique = false;
      },
      "unique",
    ],
    [
      "column type",
      table,
      (o) => {
        o.columns[0].type = "BLOB";
      },
      "columns",
    ],
    [
      "column default",
      table,
      (o) => {
        o.columns[1].defaultSql = "''";
      },
      "columns",
    ],
    [
      "column nullability",
      table,
      (o) => {
        o.columns[1].notNull = false;
      },
      "columns",
    ],
    [
      "primary key",
      table,
      (o) => {
        o.keys[0].columns = ["name"];
      },
      "keys",
    ],
    [
      "CHECK",
      table,
      (o) => {
        o.checks = ["length(name)>=0"];
      },
      "checks",
    ],
    [
      "foreign key action",
      table,
      (o) => {
        o.foreignKeys = [
          {
            columns: ["name"],
            target: "names",
            targetColumns: ["id"],
            onUpdate: "NO ACTION",
            onDelete: "CASCADE",
            match: "NONE",
            deferred: false,
          },
        ];
      },
      "foreignKeys",
    ],
    [
      "view body",
      view,
      (o) => {
        o.body = "SELECT id FROM products";
      },
      "body",
    ],
  ])("reports an altered %s under the original name", (_name, make, mutate, field) => {
    const old = make();
    const next = globalThis.structuredClone(old);
    mutate(next);
    expect(schema.compareSchema([old], [next], [])).toEqual([
      expect.objectContaining({
        subject: "schema",
        key: `${old.kind}:${old.name}`,
        field,
        cause: "changed",
      }),
    ]);
  });
  it("reports missing and unexpected objects independently with equal counts", () => {
    const old = table();
    const next = table();
    next.name = "other";
    next.table = "other";
    expect(schema.compareSchema([old], [next], []).map((d) => [d.key, d.cause])).toEqual([
      ["table:products", "missing"],
      ["table:other", "unexpected"],
    ]);
  });
  it.each([
    (o) => {
      o.kind = "unknown";
    },
    (o) => {
      o.extra = true;
    },
    (o) => {
      delete o.columns;
    },
    (o) => {
      o.columns[0].surprise = 1;
    },
    (o) => {
      o.columns.push(o.columns[0]);
    },
    (o) => {
      o.protection = "ignored";
    },
    (o) => {
      o.rawSql = "SELECT 'unterminated";
    },
    (o) => {
      o.columns[0].notNull = "false";
    },
    (o) => {
      o.columns[0].primaryKey = -1;
    },
    (o) => {
      o.columns = [];
    },
    (o) => {
      o.foreignKeys = [
        {
          columns: ["id"],
          target: "other",
          targetColumns: ["id", "name"],
          onUpdate: "NO ACTION",
          onDelete: "RESTRICT",
          match: "NONE",
          deferred: false,
        },
      ];
    },
  ])("refuses unknown or incomplete schema input %#", (mutate) => {
    const o = table();
    mutate(o);
    expect(() => schema.compareSchema([o], [table()], [])).toThrow("history.invalid");
  });
  it("refuses duplicate object identities", () => {
    expect(() => schema.compareSchema([table(), table()], [], [])).toThrow("history.invalid");
  });
  it("keeps whitespace inside each quoting style exact and ignores only external whitespace", () => {
    for (const sql of [
      "SELECT 'a  b'",
      'SELECT "a  b"',
      "SELECT `a  b`",
      "SELECT [a  b]",
      "SELECT 'a''  b'",
    ])
      expect(schema.sqlTokens(sql)).not.toEqual(schema.sqlTokens(sql.replace("  ", " ")));
    expect(schema.sqlTokens("a\n ( b )")).toEqual(["a", "(", "b", ")"]);
    expect(schema.sqlTokens("a b")).not.toEqual(schema.sqlTokens("ab"));
  });
});
