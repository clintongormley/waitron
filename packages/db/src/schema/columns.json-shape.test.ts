import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { SQLiteSyncDialect, check, getTableConfig } from "drizzle-orm/sqlite-core";
import { jsonShapeCheck, label, table } from "./columns.js";

const probe = table("t", { list: label("list"), doc: label("doc").notNull() }, (t) => [
  check("t_list_ck", jsonShapeCheck(t.list, "array")),
  check("t_doc_ck", jsonShapeCheck(t.doc, "object")),
]);

function withProbe(run: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(":memory:");
  try {
    const constraints = getTableConfig(probe).checks.map(
      (c) => `constraint "${c.name}" check (${new SQLiteSyncDialect().sqlToQuery(c.value).sql})`,
    );
    db.exec(`create table t (list text, doc text not null, ${constraints.join(", ")})`);
    run(db);
  } finally {
    db.close();
  }
}

it("accepts arrays and objects of the declared shape", () => {
  withProbe((db) => {
    const insert = db.prepare("insert into t values (?, ?)");
    insert.run("[]", "{}");
    insert.run('["a"]', '{"a":1}');
    expect(db.prepare("select count(*) as n from t").get()?.n).toBe(2);
  });
});

it.each(["{}", "3", "nope"])("refuses %s in an array column", (value) => {
  withProbe((db) => {
    expect(() => db.prepare("insert into t values (?, '{}')").run(value)).toThrow("t_list_ck");
  });
});

it("refuses an array in an object column", () => {
  withProbe((db) => {
    expect(() => db.exec("insert into t values ('[]', '[]')")).toThrow("t_doc_ck");
  });
});

it("accepts null in a nullable column and leaves NOT NULL to refuse it elsewhere", () => {
  withProbe((db) => {
    db.exec("insert into t values (null, '{}')");
    expect(db.prepare("select list from t").get()?.list).toBeNull();
    expect(() => db.exec("insert into t values ('[]', null)")).toThrow("NOT NULL constraint");
  });
});
