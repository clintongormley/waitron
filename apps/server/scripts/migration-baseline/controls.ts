import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LIST_FILE } from "../protection-list/cli.js";
import {
  compareSchemaLists,
  formatDifferences,
  type SchemaListEntry,
  type SchemaListFile,
} from "../protection-list/compare.js";
import { readSchema } from "../protection-list/read-schema.js";

export type Change =
  | { readonly sql: string }
  /** Edits one object's stored definition in place, so a table keeps its rows and every other object. */
  | { readonly rewrite: { readonly name: string; readonly from: string; readonly to: string } }
  /** The statement must fail, with an error that contains `message`. */
  | { readonly refuses: string; readonly message: string };

export interface Control {
  readonly label: string;
  readonly composition: string;
  /** `change-feed` is read from the product database, which ends in that phase. */
  readonly phase: "sql-only" | "change-feed";
  readonly database: "venue" | "node";
  /** Applied to both copies, so the comparison starts from a known fixture. */
  readonly setup?: string;
  readonly change: Change | null;
  /** Every `<kind> <object>` the comparison must report, and nothing else; empty means `EQUAL`. */
  readonly expect: readonly string[];
}

export interface ControlOutcome {
  readonly label: string;
  readonly passed: boolean;
  readonly detail: string;
}

const where = (c: { composition: string; phase: string; database: string }) =>
  `composition=${c.composition} phase=${c.phase} database=${c.database}`;

function entryFor(reference: SchemaListFile, control: Control): SchemaListEntry {
  const entry = reference.entries.find(
    (candidate) =>
      candidate.composition === control.composition &&
      candidate.phase === control.phase &&
      candidate.database === control.database,
  );
  if (entry === undefined) throw new Error(`The reference has no entry for ${where(control)}`);
  return entry;
}

/** Copies the database file, and its write-ahead log when one is left, into `dir`. */
function copyDatabase(referenceDir: string, control: Control, dir: string): string {
  const folder = control.phase === "sql-only" ? "sql-only" : "product";
  const source = join(
    referenceDir,
    "databases",
    control.composition,
    folder,
    `${control.database}.db`,
  );
  if (!existsSync(source)) throw new Error(`The reference has no database at ${source}`);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${control.database}.db`);
  copyFileSync(source, target);
  if (existsSync(`${source}-wal`)) copyFileSync(`${source}-wal`, `${target}-wal`);
  return target;
}

function rewrite(file: string, change: { name: string; from: string; to: string }): void {
  const db = new DatabaseSync(file, { defensive: false });
  try {
    const row = db.prepare("select sql from sqlite_schema where name = ?").get(change.name) as
      { sql: string | null } | undefined;
    const sql = row?.sql ?? "";
    if (sql.split(change.from).length !== 2) {
      throw new Error(
        `The stored definition of ${change.name} does not hold ${JSON.stringify(change.from)} once`,
      );
    }
    db.exec("pragma writable_schema = on");
    db.prepare("update sqlite_schema set sql = ? where name = ?").run(
      sql.replace(change.from, change.to),
      change.name,
    );
    db.exec("pragma writable_schema = off");
  } finally {
    db.close();
  }
}

function withDatabase<T>(file: string, use: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file);
  try {
    return use(db);
  } finally {
    db.close();
  }
}

function runOne(
  referenceDir: string,
  reference: SchemaListFile,
  control: Control,
  dir: string,
): ControlOutcome {
  const entry = entryFor(reference, control);
  const change = control.change;
  if (change !== null && "refuses" in change) {
    const file = copyDatabase(referenceDir, control, dir);
    try {
      withDatabase(file, (db) => db.exec(change.refuses));
    } catch (error) {
      const message = (error as Error).message;
      return { label: control.label, passed: message.includes(change.message), detail: message };
    }
    return { label: control.label, passed: false, detail: "the statement applied" };
  }

  let before = entry;
  if (control.setup !== undefined) {
    const setupFile = copyDatabase(referenceDir, control, join(dir, "before"));
    const setup = control.setup;
    before = {
      ...entry,
      schema: withDatabase(setupFile, (db) => (db.exec(setup), readSchema(db))),
    };
  }
  const file = copyDatabase(referenceDir, control, join(dir, "after"));
  if (control.setup !== undefined) withDatabase(file, (db) => db.exec(control.setup as string));
  if (change !== null && "sql" in change) withDatabase(file, (db) => db.exec(change.sql));
  if (change !== null && "rewrite" in change) rewrite(file, change.rewrite);
  const after = { ...entry, schema: withDatabase(file, readSchema) };

  const differences = compareSchemaLists({ entries: [before] }, { entries: [after] });
  const reported = differences.map((d) => `${d.kind} ${d.object}`).sort();
  const expected = [...control.expect].sort();
  return {
    label: control.label,
    passed: JSON.stringify(reported) === JSON.stringify(expected),
    detail: formatDifferences(differences),
  };
}

/** Makes each control's change in its own copy under `out` and compares the copy with the reference. */
export function runControls(options: {
  reference: string;
  out: string;
  controls?: readonly Control[];
}): ControlOutcome[] {
  const reference = JSON.parse(
    readFileSync(join(options.reference, LIST_FILE), "utf8"),
  ) as SchemaListFile;
  const controls = options.controls ?? CONTROLS;
  for (const control of controls) entryFor(reference, control);
  return controls.map((control, index) =>
    runOne(
      options.reference,
      reference,
      control,
      join(options.out, String(index + 1).padStart(2, "0")),
    ),
  );
}

export function formatOutcomes(outcomes: readonly ControlOutcome[]): string {
  return outcomes
    .map(
      (outcome) =>
        `${outcome.passed ? "PASS" : "FAIL"} ${outcome.label}\n${outcome.detail
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n")}`,
    )
    .join("\n");
}

const sqlOnly = { composition: "fiscal-verifactu", phase: "sql-only", database: "venue" } as const;
const feed = { ...sqlOnly, phase: "change-feed" } as const;

const SALES_DEVICE_KEY =
  "FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict";
const INVOICE_NUMBER_CHECK =
  'CONSTRAINT "sales_invoice_number_ck" CHECK("sales"."invoice_number" >= 1)';

/** The real schema's controls, for a list `protection-list list` built. */
export const CONTROLS: readonly Control[] = [
  { ...sqlOnly, label: "unchanged copy (sql-only)", change: null, expect: [] },
  { ...feed, label: "unchanged copy (change-feed)", change: null, expect: [] },
  {
    ...sqlOnly,
    database: "node",
    label: "unchanged copy (node database)",
    change: null,
    expect: [],
  },
  {
    ...sqlOnly,
    composition: "fiscal-none",
    label: "unchanged copy (fiscal-none)",
    change: null,
    expect: [],
  },
  {
    ...sqlOnly,
    label: "whitespace between tokens in a behavioural trigger",
    change: {
      rewrite: {
        name: "working_orders_enforce_transition",
        from: "BEFORE UPDATE ON working_orders",
        to: "BEFORE\n    UPDATE   ON working_orders",
      },
    },
    expect: [],
  },
  {
    ...sqlOnly,
    label: "behavioural trigger removed",
    change: { sql: "DROP TRIGGER working_orders_enforce_transition" },
    expect: ["missing trigger working_orders_enforce_transition"],
  },
  {
    ...sqlOnly,
    label: "behavioural trigger body changed",
    change: {
      rewrite: {
        name: "working_orders_enforce_transition",
        from: "'working order cannot make that transition'",
        to: "'working order cannot make that change'",
      },
    },
    expect: ["changed trigger working_orders_enforce_transition.body"],
  },
  {
    ...sqlOnly,
    label: "media parent trigger removed",
    change: { sql: "DROP TRIGGER products_media_image_fk_parent_delete" },
    // The later BEFORE DELETE triggers on media_images each move up one place.
    expect: [
      "missing trigger products_media_image_fk_parent_delete",
      "changed trigger menu_version_images_media_image_fk_parent_delete.order",
      "changed trigger section_members_media_image_fk_parent_delete.order",
    ],
  },
  {
    ...sqlOnly,
    label: "media parent trigger body changed",
    change: {
      rewrite: {
        name: "products_media_image_fk_parent_delete",
        from: "WHERE image = old.filename",
        to: "WHERE image = old.filename || ''",
      },
    },
    expect: ["changed trigger products_media_image_fk_parent_delete.body"],
  },
  {
    ...feed,
    label: "append-only pair removed",
    change: { sql: "DROP TRIGGER sales_append_only_update; DROP TRIGGER sales_append_only_delete" },
    expect: [
      "missing trigger sales_append_only_update",
      "missing trigger sales_append_only_delete",
    ],
  },
  {
    ...feed,
    label: "append-only pair body changed",
    change: {
      rewrite: {
        name: "sales_append_only_update",
        from: "'sales is append-only'",
        to: "'sales is append only'",
      },
    },
    expect: ["changed trigger sales_append_only_update.body"],
  },
  {
    ...feed,
    label: "feed trigger removed",
    change: { sql: "DROP TRIGGER waitron_change_absences_insert" },
    expect: ["missing trigger waitron_change_absences_insert"],
  },
  {
    ...feed,
    label: "feed trigger body changed",
    change: { rewrite: { name: "waitron_change_absences_insert", from: "'-4'", to: "'-5'" } },
    expect: ["changed trigger waitron_change_absences_insert.body"],
  },
  {
    ...sqlOnly,
    label: "ordinary index removed",
    change: { sql: "DROP INDEX ticket_items_queue_idx" },
    expect: ["missing index ticket_items_queue_idx"],
  },
  {
    ...sqlOnly,
    label: "ordinary index columns changed",
    change: {
      rewrite: {
        name: "ticket_items_queue_idx",
        from: "(`station_id`,`state`)",
        to: "(`state`,`station_id`)",
      },
    },
    expect: [
      "changed index ticket_items_queue_idx.columns[0].column",
      "changed index ticket_items_queue_idx.columns[1].column",
    ],
  },
  {
    ...sqlOnly,
    label: "expression index removed",
    change: { sql: "DROP INDEX incidents_open_dedup" },
    expect: ["missing index incidents_open_dedup"],
  },
  {
    ...sqlOnly,
    label: "expression index expression changed",
    change: {
      rewrite: {
        name: "incidents_open_dedup",
        from: `case when "device_id" is null then '' else`,
        to: `case when "device_id" is null then '-' else`,
      },
    },
    expect: ["changed index incidents_open_dedup.columns[1].expression"],
  },
  {
    ...sqlOnly,
    label: "expression index predicate changed",
    change: {
      rewrite: {
        name: "incidents_open_dedup",
        from: `"acknowledged_at" is null`,
        to: `"acknowledged_at" is not null`,
      },
    },
    expect: ["changed index incidents_open_dedup.predicate"],
  },
  {
    ...sqlOnly,
    label: "quoted incident expression refused",
    change: {
      refuses:
        "DROP INDEX incidents_open_dedup; CREATE UNIQUE INDEX incidents_open_dedup ON incidents " +
        '(`source`, `case when "device_id" is null then \'\' else "device_id" end`, `code`)',
      message: "no such column: case when",
    },
    expect: [],
  },
  {
    ...sqlOnly,
    label: "CHECK removed",
    change: { rewrite: { name: "sales", from: `,\n\t${INVOICE_NUMBER_CHECK}`, to: "" } },
    expect: ["missing table sales.checks[sales_invoice_number_ck]"],
  },
  {
    ...sqlOnly,
    label: "CHECK body changed",
    change: {
      rewrite: {
        name: "sales",
        from: INVOICE_NUMBER_CHECK,
        to: INVOICE_NUMBER_CHECK.replace(">= 1", ">= 2"),
      },
    },
    expect: ["changed table sales.checks[sales_invoice_number_ck].expression"],
  },
  {
    ...sqlOnly,
    label: "quoted text inside a CHECK changed by whitespace alone",
    change: { rewrite: { name: "sales", from: "'demo_seed'", to: "'demo_seed '" } },
    expect: ["changed table sales.checks[sales_source_ck].expression"],
  },
  {
    ...sqlOnly,
    label: "foreign key removed",
    change: { rewrite: { name: "sales", from: `\n\t${SALES_DEVICE_KEY},`, to: "" } },
    expect: ["missing table sales.foreignKeys[device_id->devices(id)]"],
  },
  {
    ...sqlOnly,
    label: "foreign key action changed",
    change: {
      rewrite: {
        name: "sales",
        from: SALES_DEVICE_KEY,
        to: SALES_DEVICE_KEY.replace("restrict", "cascade"),
      },
    },
    expect: ["changed table sales.foreignKeys[device_id->devices(id)].onDelete"],
  },
  {
    ...sqlOnly,
    label: "column type changed",
    change: {
      rewrite: { name: "sales", from: "`total` integer NOT NULL", to: "`total` text NOT NULL" },
    },
    expect: ["changed table sales.columns[total].type"],
  },
  {
    ...sqlOnly,
    label: "column default changed",
    change: {
      rewrite: {
        name: "floor_zones",
        from: "`display_order` integer DEFAULT 0",
        to: "`display_order` integer DEFAULT 1",
      },
    },
    expect: ["changed table floor_zones.columns[display_order].defaultValue"],
  },
  {
    ...sqlOnly,
    label: "primary key columns changed",
    change: {
      rewrite: {
        name: "station_printers",
        from: "PRIMARY KEY(`station_id`, `printer_id`)",
        to: "PRIMARY KEY(`printer_id`, `station_id`)",
      },
    },
    expect: [
      "changed table station_printers.columns[station_id].primaryKeyPosition",
      "changed table station_printers.columns[printer_id].primaryKeyPosition",
      "missing table station_printers.keys[PRIMARY KEY(station_id,printer_id)]",
      "extra table station_printers.keys[PRIMARY KEY(printer_id,station_id)]",
      "missing index station_printers.primary key(station_id,printer_id)",
      "extra index station_printers.primary key(printer_id,station_id)",
    ],
  },
  {
    ...sqlOnly,
    label: "unique index columns changed",
    change: {
      rewrite: {
        name: "tenants_country_tax_id_key",
        from: "(`country`,`tax_id`)",
        to: "(`tax_id`)",
      },
    },
    expect: [
      "changed index tenants_country_tax_id_key.columns[0].column",
      // The engine's rowid column moves up into the second place.
      "changed index tenants_country_tax_id_key.columns[1].column",
      "changed index tenants_country_tax_id_key.columns[1].key",
      "missing index tenants_country_tax_id_key.columns[2]",
    ],
  },
  {
    ...sqlOnly,
    label: "unexpected table added",
    change: { sql: "CREATE TABLE __keep_media_image_data (id integer)" },
    expect: ["extra table __keep_media_image_data"],
  },
  {
    ...sqlOnly,
    label: "seeded value changed in a controlled seeded fixture",
    setup: "CREATE TABLE control_seed (value); INSERT INTO control_seed VALUES ('a');",
    change: { sql: "UPDATE control_seed SET value = 'b'" },
    expect: ["changed table control_seed.rows[0]"],
  },
  {
    ...sqlOnly,
    label: "seeded BLOB byte changed in a controlled seeded fixture",
    setup: "CREATE TABLE control_seed (value); INSERT INTO control_seed VALUES (x'00ff');",
    change: { sql: "UPDATE control_seed SET value = x'00fe'" },
    expect: ["changed table control_seed.rows[0]"],
  },
];
