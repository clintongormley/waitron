import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareSchemaLists } from "../protection-list/compare.js";
import { readSchema } from "../protection-list/read-schema.js";
import { preserveBaseline } from "./preserve.js";
import { fixtureEntry, writeReference, type FixtureSet } from "./test-reference.js";

// `a` gains `x` by ALTER, so its stored text differs from what a generator writes for it.
const ALPHA: FixtureSet = {
  name: "alpha",
  sql: `
CREATE TABLE a (id integer PRIMARY KEY);
ALTER TABLE a ADD COLUMN x text;
CREATE INDEX a_x ON a (x);
CREATE TRIGGER z_first BEFORE INSERT ON a BEGIN SELECT 1; END;
`,
};
const BETA: FixtureSet = {
  name: "beta",
  sql: `
CREATE TABLE b (id integer PRIMARY KEY, a_id integer REFERENCES a (id));
CREATE TRIGGER a_second BEFORE INSERT ON a BEGIN SELECT 2; END;
CREATE TRIGGER b_guard BEFORE DELETE ON b BEGIN SELECT raise(abort, 'no'); END;
`,
};
const GAMMA: FixtureSet = {
  name: "gamma",
  sql: "CREATE TABLE g (id integer PRIMARY KEY); CREATE TRIGGER g_t AFTER INSERT ON g BEGIN SELECT 3; END;",
};

const GENERATED = [
  "CREATE TABLE `b` (\n\t`id` integer PRIMARY KEY,\n\t`a_id` integer,\n\tFOREIGN KEY (`a_id`) REFERENCES `a`(`id`)\n);",
  "CREATE TABLE `a` (\n\t`x` text,\n\t`id` integer PRIMARY KEY\n);",
  "CREATE INDEX `a_x` ON `a` (`x`);",
].join("\n--> statement-breakpoint\n");

const JOURNAL = `{"version":"7","dialect":"sqlite","entries":[{"idx":0,"version":"6","when":1,"tag":"0000_baseline","breakpoints":true}]}`;
const SNAPSHOT = `{"version":"6","tables":{}}\n`;

let dir: string;
let reference: string;
let folder: string;

function storedSql(name: string): string {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(ALPHA.sql + BETA.sql);
    return (db.prepare("select sql from sqlite_schema where name = ?").get(name) as { sql: string })
      .sql;
  } finally {
    db.close();
  }
}

function writeBaseline(sql: string): void {
  writeFileSync(join(folder, "0000_baseline.sql"), sql);
}

const baseline = () => readFileSync(join(folder, "0000_baseline.sql"), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wt-preserve-"));
  const sqlOnly = fixtureEntry(join(dir, "reference"), [ALPHA, BETA, GAMMA]);
  // An installer trigger that the migrated phase files under alpha: reading that phase would bring it in.
  const migrated = fixtureEntry(
    join(dir, "reference"),
    [
      ALPHA,
      BETA,
      GAMMA,
      {
        name: "alpha",
        sql: "CREATE TRIGGER a_append_only BEFORE UPDATE ON a BEGIN SELECT 9; END;",
      },
    ],
    { phase: "migrated", folder: "product" },
  );
  // Key order in the list means nothing, so reversing it must not change the order written.
  const reversed = {
    ...sqlOnly,
    owningSet: Object.fromEntries(Object.entries(sqlOnly.owningSet).reverse()),
  };
  reference = writeReference(join(dir, "reference"), [reversed, migrated]);
  folder = join(dir, "drizzle");
  mkdirSync(join(folder, "meta"), { recursive: true });
  writeFileSync(join(folder, "meta", "_journal.json"), JOURNAL);
  writeFileSync(join(folder, "meta", "0000_snapshot.json"), SNAPSHOT);
  writeBaseline(GENERATED);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("preserveBaseline", () => {
  it("swaps in the old stored text and appends the old triggers in old creation order", () => {
    const result = preserveBaseline({ reference, folder, from: ["beta", "alpha"] });
    expect(result.changed).toBe(true);
    expect(baseline()).toBe(
      ["b", "a", "a_x", "z_first", "a_second", "b_guard"]
        .map((name) => `${storedSql(name)};`)
        .join("\n--> statement-breakpoint\n"),
    );
  });

  it("builds the same schema as the old sets did", () => {
    preserveBaseline({ reference, folder, from: ["alpha", "beta"] });
    const read = (sql: string) => {
      const db = new DatabaseSync(":memory:");
      try {
        db.exec(sql);
        return readSchema(db);
      } finally {
        db.close();
      }
    };
    const entry = (sql: string) => ({
      composition: "c",
      phase: "p",
      database: "venue",
      setOrder: [],
      journals: {},
      bookkeepingRows: {},
      owningSet: {},
      schema: read(sql),
    });
    const preserved = baseline().split("--> statement-breakpoint").join("\n");
    expect(
      compareSchemaLists(
        { entries: [entry(ALPHA.sql + BETA.sql)] },
        { entries: [entry(preserved)] },
      ),
    ).toEqual([]);
  });

  it("changes nothing when it runs a second time", () => {
    preserveBaseline({ reference, folder, from: ["alpha", "beta"] });
    const first = baseline();
    const again = preserveBaseline({ reference, folder, from: ["alpha", "beta"] });
    expect(again.changed).toBe(false);
    expect(baseline()).toBe(first);
  });

  it("leaves the journal and snapshot bytes alone", () => {
    preserveBaseline({ reference, folder, from: ["alpha", "beta"] });
    expect(readFileSync(join(folder, "meta", "_journal.json"), "utf8")).toBe(JOURNAL);
    expect(readFileSync(join(folder, "meta", "0000_snapshot.json"), "utf8")).toBe(SNAPSHOT);
  });

  it("names where each statement came from", () => {
    const { provenance } = preserveBaseline({ reference, folder, from: ["alpha", "beta"] });
    expect(provenance).toEqual([
      "table b: old text from beta",
      "table a: old text from alpha",
      "index a_x: old text from alpha",
      "trigger z_first: appended from alpha",
      "trigger a_second: appended from beta",
      "trigger b_guard: appended from beta",
    ]);
  });

  it("refuses a generated table the old sets do not have", () => {
    writeBaseline(
      `${GENERATED}\n--> statement-breakpoint\nCREATE TABLE \`extra_t\` (\`id\` integer);`,
    );
    expect(() => preserveBaseline({ reference, folder, from: ["alpha", "beta"] })).toThrow(
      "generated but not in the old sets: table extra_t",
    );
    expect(baseline()).toContain("extra_t");
  });

  it("refuses when the generator lost a table the old sets have", () => {
    writeBaseline(
      GENERATED.split("\n--> statement-breakpoint\n").slice(1).join("\n--> statement-breakpoint\n"),
    );
    expect(() => preserveBaseline({ reference, folder, from: ["alpha", "beta"] })).toThrow(
      "in the old sets but not generated: table b",
    );
  });

  it("refuses a generated table whose meaning differs, not only its spelling", () => {
    writeBaseline(GENERATED.replace("`x` text", "`x` integer"));
    expect(() => preserveBaseline({ reference, folder, from: ["alpha", "beta"] })).toThrow(
      "table a.columns[x].type",
    );
  });

  it("refuses an old set that owns nothing in the reference", () => {
    expect(() => preserveBaseline({ reference, folder, from: ["alpha", "beta", "delta"] })).toThrow(
      "delta owns nothing",
    );
  });

  it("refuses a statement that creates nothing", () => {
    writeBaseline(`${GENERATED}\n--> statement-breakpoint\nINSERT INTO a VALUES (1, 'x');`);
    expect(() => preserveBaseline({ reference, folder, from: ["alpha", "beta"] })).toThrow(
      "creates no table, index, trigger or view",
    );
  });

  it("refuses a trigger already in the baseline that differs from the old one", () => {
    writeBaseline(
      `${GENERATED}\n--> statement-breakpoint\nCREATE TRIGGER z_first BEFORE INSERT ON a BEGIN SELECT 7; END;`,
    );
    expect(() => preserveBaseline({ reference, folder, from: ["alpha", "beta"] })).toThrow(
      "trigger z_first differs from the old one",
    );
  });

  it("refuses when two compositions disagree about an old set's objects", () => {
    const other = fixtureEntry(join(dir, "other"), [
      { name: "alpha", sql: ALPHA.sql.replace("SELECT 1", "SELECT 5") },
      BETA,
    ]);
    const disagreeing = writeReference(join(dir, "disagreeing"), [
      fixtureEntry(join(dir, "disagreeing"), [ALPHA, BETA]),
      { ...other, composition: "fiscal-none" },
    ]);
    expect(() =>
      preserveBaseline({ reference: disagreeing, folder, from: ["alpha", "beta"] }),
    ).toThrow("disagree");
  });
});
