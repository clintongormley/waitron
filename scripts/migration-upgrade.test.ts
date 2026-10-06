import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { installChangeFeed } from "../packages/db/src/change-feed.js";
import { openVenueDatabase } from "../packages/db/src/client.js";
import { applyMigrations } from "../packages/migrations/src/apply.js";
import {
  migrationOptionsFor,
  resolveMigrationsFolder,
} from "../packages/migrations/src/manifest.js";
import { orderedMigrationSets } from "../packages/module/src/module.js";
import { scratchParent } from "./scratch-dir.mjs";
import { createStepWatch, reportStallAfter } from "./step-watch.mjs";

/**
 * One database upgraded the way a box is: every shipped migration applied in date order, with what
 * boot does after migrating (the change feed) done between each step, and rows carried through. A
 * fresh database migrated in one go never meets a trigger a previous boot left behind, nor a row a
 * migration has to keep.
 *
 * After each step every table is topped up to two rows, read from that step's own schema (its
 * columns, foreign keys, unique indexes and CHECK constraints) and written with the file's foreign
 * keys, CHECKs and triggers in force. The second row repeats the first wherever its constraints
 * allow and differs in the primary key and in every unique index over plain columns, so a later
 * unique index over a column the two rows share is refused. Each table's row count is recorded
 * before the next step; a table that still exists after it holding fewer rows fails the test,
 * naming the step.
 *
 * Weaker than its name in these ways. Every set's first migration, and everything up to
 * {@link FLOOR}, is applied together, because the baselines were regenerated out of date order
 * (core's is dated after the sets that build on it), and because core's `0003` rebuilds `products`
 * while a trigger whose BODY reads `products` exists (media's `products_media_image_fk_parent_delete`).
 * The change feed at each step is TODAY's list, less whatever that step's schema lacks, and the
 * append-only tables are TODAY's list filtered to the tables the PREVIOUS step left, so a table a
 * step creates has no append-only trigger while the NEXT step migrates, and gets one only after it;
 * neither is the list the image of that date carried. The rows are synthetic, not the product's:
 * a few generic values per declared type, a CHECK's own literals, a column's default and
 * {@link CANDIDATES}. A nullable column outside every unique index is null wherever its
 * constraints allow, except that a second row points a self-reference at the first. So a migration
 * that fails only on values the product writes and these rows lack passes: a unique index two real
 * rows break where these two differ, or a CHECK real values break and these do not. The tables
 * {@link ONE_ROW} names, and a singleton (`CHECK (id = 1)`), hold one row. The steps
 * {@link RESETS} lists cannot carry the rows, and the walk restarts from an empty database at each;
 * at one refused by a constraint, nothing else the step does to the rows is seen. Rows are counted,
 * not compared, so a migration that rewrites a value passes. After the final step it also pins
 * the nine product triggers; other triggers dropped by a rebuild are not checked here.
 */

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/**
 * Applied together with the baselines rather than stepped onto. It rebuilds `products` while a
 * trigger whose BODY reads `products` exists (media's `products_media_image_fk_parent_delete`), and
 * SQLite refuses the rename that ends the rebuild.
 */
const FLOOR = { set: "core", tag: "0003_variant_inherited_nullable" };

const TEST_BOUND_MS = 120_000;
const STALL_DEADLINE_MS = TEST_BOUND_MS - 10_000;
const SCRATCH_PARENT = scratchParent();

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function readJournal(folder: string): { entries: JournalEntry[] } {
  return JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8"));
}

describe("upgrading a venue one migration at a time", () => {
  it(
    "applies every shipped migration on top of the change feed the step before installed",
    async () => {
      const watch = createStepWatch();
      const held = await reportStallAfter(watch, STALL_DEADLINE_MS, () =>
        upgradeOneStepAtATime(watch),
      );
      // The control: a fill that wrote nothing would pass every row-count comparison.
      expect([...held].filter(([, rows]) => rows === 0).map(([table]) => table)).toEqual([]);
      const unreached = (list: object, seen: Set<string>) =>
        Object.keys(list).filter((entry) => !seen.has(entry));
      expect({
        RESETS: unreached(RESETS, reached.resets),
        CANDIDATES: unreached(CANDIDATES, reached.candidates),
        ONE_ROW: unreached(ONE_ROW, reached.oneRow),
      }).toEqual({ RESETS: [], CANDIDATES: [], ONE_ROW: [] });
      console.log(
        `${watch.summary(5)}\n${held.size} tables hold rows after the last step.\n` +
          `Scratch directory under ${SCRATCH_PARENT}.`,
      );
    },
    TEST_BOUND_MS,
  );
});

async function upgradeOneStepAtATime(watch: ReturnType<typeof createStepWatch>) {
  const sets = orderedMigrationSets(ALL_MODULES);
  const sources = ALL_MODULES.flatMap((module) => module.changes ?? []);

  const root = mkdtempSync(join(SCRATCH_PARENT, "wt-migration-upgrade-"));
  scratch.push(root);
  const staged = join(root, "migrations");
  const venueDir = join(root, "venue");
  const journals = new Map<string, ReturnType<typeof readJournal>>();
  for (const set of sets) {
    const from = resolveMigrationsFolder(set, null);
    cpSync(from, join(staged, set.name), { recursive: true });
    journals.set(set.name, readJournal(from));
  }

  const floorEntry = journals.get(FLOOR.set)?.entries.find((entry) => entry.tag === FLOOR.tag);
  expect(floorEntry).toBeDefined();
  const floor = floorEntry?.when ?? 0;

  const cuts = [
    ...new Set(
      [...journals.values()].flatMap((journal) =>
        journal.entries.filter((entry) => entry.when > floor).map((entry) => entry.when),
      ),
    ),
  ].sort((a, b) => a - b);
  expect(cuts.length).toBeGreaterThan(1);

  const bookkeeping = new Set(migrationOptionsFor(sets, staged).map((set) => set.migrationsTable));
  let held = new Map<string, number>();
  let existing = new Set<string>();
  for (const cut of [floor, ...cuts]) {
    const tags = [...journals]
      .flatMap(([name, journal]) =>
        journal.entries
          .filter((entry) => entry.when === cut)
          .map((entry) => `${name}/${entry.tag}`),
      )
      .join(", ");
    const label = cut === floor ? `baselines to ${FLOOR.set}/${FLOOR.tag}` : tags;
    // Only tables the step before already had: a set's declared list is today's, and some of its
    // tables are created by later migrations.
    const options = migrationOptionsFor(sets, staged).map((set) => ({
      ...set,
      appendOnlyTables: (set.appendOnlyTables ?? []).filter((table) => existing.has(table)),
    }));
    for (const [name, journal] of journals) {
      const entries = journal.entries.filter((entry) => entry.idx === 0 || entry.when <= cut);
      writeFileSync(
        join(staged, name, "meta", "_journal.json"),
        JSON.stringify({ ...journal, entries }),
      );
    }
    const step = async () => {
      await watch.phase(`${label}: migrate`, () => applyMigrations(venueDir, options));
      const store = await watch.phase(`${label}: open`, () => openVenueDatabase(venueDir));
      try {
        const present = sources.filter((source) => {
          const columns = new Set(
            store.venue
              .all<{ name: string }>(`select name from pragma_table_info('${source.table}')`)
              .map((column) => column.name),
          );
          return columns.size > 0 && (source.related ?? []).every((rel) => columns.has(rel.column));
        });
        await watch.phase(`${label}: change feed`, () => installChangeFeed(store.venue, present));
        existing = new Set(
          store.venue
            .all<{ name: string }>(`select name from sqlite_master where type = 'table'`)
            .map((table) => table.name),
        );
      } finally {
        await watch.phase(`${label}: close`, () => store.close());
      }
      held = await watch.phase(`${label}: rows`, () =>
        carryRows(venueDir, label, held, bookkeeping),
      );
    };

    const resets = tags.split(", ").filter((tag) => tag in RESETS);
    for (const entry of resets) reached.resets.add(entry);
    if (resets.length > 1) {
      throw new Error(
        `Step ${label} matches ${resets.length} RESETS entries (${resets.join(", ")}); ` +
          "a step is checked against one entry, so merge them into one",
      );
    }
    const [reset] = resets;
    if (reset === undefined) {
      await step();
      continue;
    }
    const failure = await step().then(
      () => undefined,
      (error: unknown) => error,
    );
    const mismatch = resetMismatch(RESETS[reset], failure);
    if (mismatch !== undefined) {
      throw new Error(
        `Step ${label} is listed in RESETS as ${JSON.stringify(RESETS[reset])}, but ${mismatch}`,
        { cause: failure },
      );
    }
    rmSync(venueDir, { recursive: true, force: true });
    held = new Map();
    await step();
  }
  const connection = openRaw(venueDir);
  try {
    const names = connection
      .prepare("select name from sqlite_master where type = 'trigger' and name like 'products_%'")
      .all()
      .map((row) => String(row.name));
    expect(names).toEqual(
      expect.arrayContaining([
        "products_variant_one_level_insert",
        "products_variant_parent_fixed_update",
        "products_id_fixed_update",
        "products_ordering_check_insert",
        "products_ordering_check_update",
        "products_media_image_fk_insert",
        "products_media_image_fk_update",
        "products_media_image_fk_parent_delete",
        "products_media_image_fk_parent_rename",
      ]),
    );
  } finally {
    connection.close();
  }
  return held;
}

/**
 * Shipped steps that cannot carry these rows, each with the failure it must still show: the parts
 * of a refusal's message, or exactly the tables whose rows the step loses, so a loss beside the
 * listed ones fails the guard. Before go-live a schema change may need a venue reset (CLAUDE.md
 * §3), so at a listed step the guard checks the failure, then migrates an empty database to the
 * same point and fills it again. A listed step that carries the rows, a step two keys name, or a
 * key naming no step the walk takes, fails the guard.
 */
const RESETS: Record<string, { refused: readonly string[] } | { lost: readonly string[] }> = {
  "venue-service/0020_retire_invoice_first": {
    refused: ["DROP TABLE `departments`", "FOREIGN KEY constraint failed"],
  },
  "core/0106_retire_location_order_flow": {
    refused: ["DROP TABLE `locations`", "FOREIGN KEY constraint failed"],
  },
  // Rebuilds `menu_items`; dropping the old one is refused while a non-cascading child holds rows.
  "catalogue/0003_menu_price_nullable": {
    refused: ["DROP TABLE `menu_items`", "FOREIGN KEY constraint failed"],
  },
  // Rebuilds `mirror_config` with `node_id` required; a copied row's `node_id` is null.
  "core/0008_node_keyed_rows": {
    refused: ["NOT NULL constraint failed: __new_mirror_config.node_id"],
  },
  // Rebuilds `management_sessions` with `token_hash` required; a copied row's is null.
  "identity/0003_session_token_hash_required": {
    refused: ["NOT NULL constraint failed: __new_management_sessions.token_hash"],
  },
  // Rebuilds `menu_items` again, as `catalogue/0003` does.
  "catalogue/0008_menu_details": {
    refused: ["DROP TABLE `menu_items`", "FOREIGN KEY constraint failed"],
  },
  // Rebuilds `drawer_opens` without copying its rows.
  "core/0012_printer_calibration": { lost: ["drawer_opens"] },
  // Rebuilds `working_order_lines` with `vat_class` required; a copied row's is null.
  "core/0026_line_vat_class": {
    refused: ["NOT NULL constraint failed: __new_working_order_lines.vat_class"],
  },
  // Rebuilds `dining_tables`, refused as `menu_items` is; #897 says every venue needs a reset.
  "core/0044_drop_table_bill_pointer": {
    refused: ["DROP TABLE `dining_tables`", "FOREIGN KEY constraint failed"],
  },
  // Rebuilds `printers`; dropping the old one is refused while a non-cascading child holds rows.
  "core/0055_drop_printer_character_set": {
    refused: ["DROP TABLE `printers`", "FOREIGN KEY constraint failed"],
  },
  // The product rebuild refuses a non-cascading child after the category rebuild carried its rows.
  "core/0060_drop_routing_station_columns": {
    refused: ["DROP TABLE `products`", "FOREIGN KEY constraint failed"],
  },
  // A line's self-reference refuses this first rebuild; sale_lines can refuse at its later rebuild.
  "core/0092_positive_price_quantity": {
    refused: ["DROP TABLE `working_order_lines`", "FOREIGN KEY constraint failed"],
  },
  "core/0095_operator_script_source": {
    refused: ["DROP TABLE `working_orders`", "FOREIGN KEY constraint failed"],
  },
  "core/0096_operator_script_restore_incident_index": {
    refused: ["UNIQUE constraint failed: index 'incidents_open_dedup'"],
  },
  "core/0103_full_invoice_model": {
    refused: ["DROP TABLE `invoice_series`", "FOREIGN KEY constraint failed"],
  },
  "catalogue/0018_sections_owned_prepare": {
    refused: ["DELETE FROM sections WHERE role = 'library'", "FOREIGN KEY constraint failed"],
  },
  "catalogue/0020_sections_owned": {
    refused: ["NOT NULL constraint failed: __new_sections.owner_menu_id"],
  },
  "catalogue/0021_sections_owned_restore": {
    refused: ["NOT NULL constraint failed: section_members.id"],
  },
  // Adds `sessions.device_id` as required with no default; a held row has no device to name.
  "identity/0005_session_device_add": {
    refused: ["ALTER TABLE `sessions` ADD `device_id`", "Cannot add a NOT NULL column"],
  },
  // Adds `incidents.source` as required with no default; a held row has no source to name.
  "core/0077_incident_origin_add": {
    refused: ["ALTER TABLE `incidents` ADD `source`", "Cannot add a NOT NULL column"],
  },
  // Rebuilds `incidents` with the source list's check; a carried row's source is not on the list.
  "core/0078_incident_origin_drop_till": {
    refused: ["CHECK constraint failed: incidents_source_ck"],
  },
  // Restores the open-alert index after the rebuild; the rows carried while it was absent collide.
  "core/0079_incident_origin_dedup": {
    refused: ["UNIQUE constraint failed: index 'incidents_open_dedup'"],
  },
  // Rebuilds the money records without `till_id`, with `source` required; a carried row has none.
  "core/0081_money_records_lose_till": {
    refused: ["NOT NULL constraint failed: __new_bill_payment_refunds.source"],
  },
  // Rebuilds `registros_facturacion` the same way.
  "fiscal-verifactu/0002_registro_lose_till": {
    refused: ["NOT NULL constraint failed: __new_registros_facturacion.source"],
  },
  "fiscal-verifactu/0003_operator_script_source": {
    refused: ["DROP TABLE `registros_facturacion`", "FOREIGN KEY constraint failed"],
  },
  // Rebuilds `payments` with `source` required; a carried row has none.
  "payments/0004_payment_origin_required": {
    refused: ["NOT NULL constraint failed: __new_payments.source"],
  },
  "payments/0005_operator_script_source": {
    refused: ["DROP TABLE `payments`", "FOREIGN KEY constraint failed"],
  },
  "workforce/0003_operator_script_source": {
    refused: ["DROP TABLE `time_entries`", "FOREIGN KEY constraint failed"],
  },
  // Adds `working_orders.source` as required with no default; a held row has no source to name.
  "core/0084_working_orders_add_origin": {
    refused: ["ALTER TABLE `working_orders` ADD `source`", "Cannot add a NOT NULL column"],
  },
  // Rebuilds `working_orders` with the source list's check; a carried row's source is not on it.
  "core/0085_working_orders_drop_till": {
    refused: ["CHECK constraint failed: working_orders_source_ck"],
  },
  // Adds `order_amendments.captured_by_source` as required with no default; a held row has none.
  "core/0087_history_origin_add": {
    refused: [
      "ALTER TABLE `order_amendments` ADD `captured_by_source`",
      "Cannot add a NOT NULL column",
    ],
  },
  // Adds `time_entries.captured_by_source` the same way.
  "workforce/0001_time_entries_origin_add": {
    refused: [
      "ALTER TABLE `time_entries` ADD `captured_by_source`",
      "Cannot add a NOT NULL column",
    ],
  },
  // Rebuilds `order_amendments` and `drawer_opens` without the till; a carried amendment's source
  // is not on the list.
  "core/0088_history_origin_drop_till": {
    refused: ["CHECK constraint failed: order_amendments_captured_by_source_ck"],
  },
  // Rebuilds `time_entries` the same way.
  "workforce/0002_time_entries_origin_drop_till": {
    refused: ["CHECK constraint failed: time_entries_captured_by_source_ck"],
  },
  // Drops `tills`, refused while a device names one, then rebuilds `devices` without `till_id`.
  "core/0090_devices_lose_till": {
    refused: ["DROP TABLE `tills`", "FOREIGN KEY constraint failed"],
  },
  // Rebuilds `menu_item_variant_overrides` with a price required; a copied row's price is null.
  "catalogue/0024_drop_menu_offered": {
    refused: [
      "INSERT INTO `__new_menu_item_variant_overrides`",
      "CHECK constraint failed: menu_item_variant_overrides_overrides_ck",
    ],
  },
};

/** What a step's failure lacks against its RESETS entry, or `undefined` when it matches. */
function resetMismatch(expected: (typeof RESETS)[string], failure: unknown): string | undefined {
  if (failure === undefined) return "it carried the rows";
  if ("refused" in expected) {
    const message = messagesOf(failure);
    return expected.refused.every((part) => message.includes(part))
      ? undefined
      : `it failed with: ${message}`;
  }
  if (!(failure instanceof RowsLost)) return `it failed with: ${messagesOf(failure)}`;
  const unlisted = Object.keys(failure.lost).filter((table) => !expected.lost.includes(table));
  const kept = expected.lost.filter((table) => !Object.hasOwn(failure.lost, table));
  if (unlisted.length === 0 && kept.length === 0) return undefined;
  return [
    unlisted.length > 0 &&
      `it also lost rows RESETS does not list:\n${unlisted.map((t) => failure.lost[t]).join("\n")}`,
    kept.length > 0 &&
      `it did not lose rows from ${kept.join(", ")} (it kept them, or the table no longer exists)`,
  ]
    .filter(Boolean)
    .join("; ");
}

class RowsLost extends Error {
  /** Each table that holds fewer rows, with its before-and-after line. */
  readonly lost: Readonly<Record<string, string>>;
  constructor(label: string, lost: Record<string, string>) {
    super(`Step ${label} lost rows the step before wrote:\n${Object.values(lost).join("\n")}`);
    this.lost = lost;
  }
}

/** An error's message and its causes', outermost first. */
function messagesOf(error: unknown): string {
  const messages: string[] = [];
  for (let at = error; at instanceof Error; at = at.cause) messages.push(at.message);
  return messages.join(" <- ");
}

type Value = bigint | number | string | Uint8Array | null;
type Row = Record<string, Value>;

/**
 * Values tried in order, instead of the generic ones, for a column whose CHECK constraint or
 * trigger refuses every generic value. Keyed `table.column`.
 */
const CANDIDATES: Record<string, readonly Value[]> = {
  // The CHECK wants 64 lowercase hex digits and an image extension.
  "media_images.filename": [`${"0".repeat(63)}1.jpg`, `${"0".repeat(63)}2.jpg`],
  // A trigger refuses a filename `media_images` does not hold.
  "menu_version_images.filename": [`${"0".repeat(63)}1.jpg`, `${"0".repeat(63)}2.jpg`],
  // CHECKs on the byte length of an encryption's nonce and tag.
  "tenant_credentials.iv": [new Uint8Array(12)],
  "tenant_credentials.auth_tag": [new Uint8Array(16)],
  // A trigger wants an object keyed by exactly the venue's invoice locales, `["es"]` here.
  "working_order_lines.descriptions": ['{"es":"a"}'],
  // A settlement's trigger wants the sale's tenders to sum to its total; a sale of nothing settles
  // with none, in whichever order the two tables are filled.
  "sales.total": [0n],
};

/** Tables filled with one row rather than two, each with its reason. */
const ONE_ROW: Record<string, string> = {
  sale_settlements:
    "a tender naming a settled sale is refused, so one sale stays open for the tenders",
  menu_item_variant_overrides:
    "its key is a menu item and a variant of that item's product, and the rows hold one such pair",
};

/**
 * The entries of {@link RESETS}, {@link CANDIDATES} and {@link ONE_ROW} the walk reached; one it
 * never reached fails the guard. Reaching a CANDIDATES or ONE_ROW entry shows only that the walk
 * met its column or table, not that the entry is still needed.
 */
const reached = {
  resets: new Set<string>(),
  candidates: new Set<string>(),
  oneRow: new Set<string>(),
};

const SOLUTIONS_TRIED = 100;
const SEARCH_BUDGET = 200_000;

const hex64 = (last: string) => `${"0".repeat(63)}${last}`;
const GENERIC: Record<"integer" | "real" | "text" | "blob", readonly Value[]> = {
  integer: [1n, 2n, 0n, 3n],
  real: [1.5, 2.5, 0],
  text: [
    "a",
    "b",
    hex64("1"),
    hex64("2"),
    "2026-01-01T00:00:00.000Z",
    "2026-01-02T00:00:00.000Z",
    '["es"]',
    "es",
    "{}",
  ],
  blob: [Uint8Array.of(1), Uint8Array.of(2)],
};

interface Column {
  name: string;
  type: string;
  notnull: boolean;
  dflt: string | null;
  pk: number;
}

interface ForeignKey {
  parent: string;
  from: string[];
  to: string[];
}

interface Check {
  expression: string;
  columns: string[];
}

interface Shape {
  name: string;
  columns: Column[];
  foreignKeys: ForeignKey[];
  checks: Check[];
  unique: Set<string>;
  /** The column lists of the primary key and of each unique index over plain columns. */
  distinct: string[][];
  singleton: boolean;
}

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;

const key = (value: Value): string =>
  value === null
    ? "null"
    : value instanceof Uint8Array
      ? `x${Buffer.from(value).toString("hex")}`
      : `${typeof value}:${String(value)}`;

/**
 * Opened on the closed file rather than through the store, with the two pragmas the store sets on
 * its writer that change what a write does (`packages/store/src/index.ts`), so the file's foreign
 * keys, CHECKs and triggers all apply.
 */
function openRaw(venueDir: string): DatabaseSync {
  const connection = new DatabaseSync(join(venueDir, "venue.db"));
  connection.exec("pragma foreign_keys = on");
  connection.exec("pragma recursive_triggers = on");
  return connection;
}

function tableCounts(connection: DatabaseSync, skip: Set<string>): Map<string, number> {
  const names = connection
    .prepare(
      `select name from sqlite_master where type = 'table' and name not like 'sqlite\\_%' escape '\\'`,
    )
    .all()
    .map((row) => String(row.name))
    .filter((name) => !skip.has(name));
  return new Map(
    names.map((name) => [
      name,
      Number(connection.prepare(`select count(*) as n from ${ident(name)}`).get()?.n),
    ]),
  );
}

/**
 * After a step: every table the step before filled that still exists holds at least the rows it
 * held, and every table holds two rows (one for a singleton or a table {@link ONE_ROW} names).
 * Returns the counts the next step is held to. A table a step dropped or renamed away is absent
 * from `sqlite_master` afterwards and is not compared.
 */
function carryRows(
  venueDir: string,
  label: string,
  kept: Map<string, number>,
  skip: Set<string>,
): Map<string, number> {
  const connection = openRaw(venueDir);
  try {
    const now = tableCounts(connection, skip);
    const lost = Object.fromEntries(
      [...kept]
        .filter(([table, before]) => now.has(table) && (now.get(table) ?? 0) < before)
        .map(([table, before]) => [
          table,
          `${table}: ${before} rows before, ${now.get(table)} after`,
        ]),
    );
    if (Object.keys(lost).length > 0) throw new RowsLost(label, lost);
    const shapes = parentsFirst([...now.keys()].map((table) => shapeOf(connection, table)));
    connection.exec("begin");
    try {
      for (const shape of shapes) fill(connection, shape, label);
      connection.exec("commit");
    } catch (error) {
      connection.exec("rollback");
      throw error;
    }
    return tableCounts(connection, skip);
  } finally {
    connection.close();
  }
}

function shapeOf(connection: DatabaseSync, table: string): Shape {
  const columns = connection
    .prepare(`select name, type, "notnull", dflt_value, pk from pragma_table_info(?)`)
    .all(table)
    .map((row) => ({
      name: String(row.name),
      type: String(row.type),
      notnull: Number(row.notnull) === 1,
      dflt: row.dflt_value === null ? null : String(row.dflt_value),
      pk: Number(row.pk),
    }));
  const primaryKey = columns
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name);

  const byId = new Map<number, ForeignKey>();
  for (const row of connection
    .prepare(`select id, "table", "from", "to" from pragma_foreign_key_list(?) order by id, seq`)
    .all(table)) {
    const id = Number(row.id);
    const fk = byId.get(id) ?? { parent: String(row.table), from: [], to: [] };
    fk.from.push(String(row.from));
    if (row.to !== null) fk.to.push(String(row.to));
    byId.set(id, fk);
  }
  const foreignKeys = [...byId.values()].map((fk) =>
    fk.to.length > 0 ? fk : { ...fk, to: primaryKeyOf(connection, fk.parent) },
  );

  const unique = new Set(primaryKey);
  const distinct = primaryKey.length > 0 ? [primaryKey] : [];
  for (const index of connection
    .prepare(`select name from pragma_index_list(?) where "unique" = 1`)
    .all(table)) {
    const name = String(index.name);
    const parts = connection.prepare(`select cid, name from pragma_index_info(?)`).all(name);
    if (parts.every((part) => part.name !== null)) distinct.push(parts.map((p) => String(p.name)));
    for (const part of parts) {
      if (part.name !== null) unique.add(String(part.name));
      else if (Number(part.cid) === -2) {
        // An expression: every column the index's SQL names.
        const sql = String(
          connection.prepare(`select sql from sqlite_master where name = ?`).get(name)?.sql ?? "",
        );
        for (const column of columnsNamedIn(sql, columns)) unique.add(column);
      }
    }
  }

  const createSql = String(
    connection.prepare(`select sql from sqlite_master where type = 'table' and name = ?`).get(table)
      ?.sql ?? "",
  );
  const checks = checkExpressions(createSql).map((expression) => ({
    expression,
    columns: columnsNamedIn(expression, columns),
  }));
  const singleton = checks.some((check) =>
    /^\s*(?:"[^"]+"\.)?"?id"?\s*=\s*1\s*$/i.test(check.expression),
  );
  return { name: table, columns, foreignKeys, checks, unique, distinct, singleton };
}

function primaryKeyOf(connection: DatabaseSync, table: string): string[] {
  return connection
    .prepare(`select name, pk from pragma_table_info(?) where pk > 0 order by pk`)
    .all(table)
    .map((row) => String(row.name));
}

/** Skips a quoted string or identifier starting at `at`; returns the index after it. */
function skipQuoted(sql: string, at: number): number {
  const close = sql[at] === "[" ? "]" : sql[at];
  let i = at + 1;
  while (i < sql.length) {
    if (sql[i] === close) {
      if (close !== "]" && sql[i + 1] === close) i += 2;
      else return i + 1;
    } else i += 1;
  }
  return i;
}

/** The body of every `CHECK (…)` in a `CREATE TABLE` statement. */
function checkExpressions(sql: string): string[] {
  const found: string[] = [];
  let i = 0;
  while (i < sql.length) {
    if ("'\"`[".includes(sql[i])) {
      i = skipQuoted(sql, i);
      continue;
    }
    const opening = /^check\s*\(/i.exec(sql.slice(i, i + 32));
    if (opening && !/\w/.test(sql[i - 1] ?? "")) {
      let depth = 0;
      let j = i + opening[0].length - 1;
      const start = j + 1;
      while (j < sql.length) {
        if ("'\"`[".includes(sql[j])) {
          j = skipQuoted(sql, j);
          continue;
        }
        if (sql[j] === "(") depth += 1;
        if (sql[j] === ")") depth -= 1;
        if (depth === 0) break;
        j += 1;
      }
      found.push(sql.slice(start, j));
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return found;
}

/** The table's columns that `sql` names, outside its string literals. */
function columnsNamedIn(sql: string, columns: Column[]): string[] {
  const words = new Set(
    [...sql.replaceAll(/'(?:[^']|'')*'/g, "''").matchAll(/"((?:[^"]|"")+)"|`([^`]+)`|(\w+)/g)].map(
      (match) => (match[1] ?? match[2] ?? match[3]).toLowerCase(),
    ),
  );
  return columns.map((column) => column.name).filter((name) => words.has(name.toLowerCase()));
}

/** The string literals a CHECK compares `column` with, by `=` or `in (…)`. */
function listedValues(expression: string, column: string): string[] {
  const name = column.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const compared = new RegExp(
    `"?${name}"?\\s*(?:=\\s*('(?:[^']|'')*')|in\\s*\\(((?:'(?:[^']|'')*'|[^()'])*)\\))`,
    "gi",
  );
  return [...expression.matchAll(compared)].flatMap((match) =>
    [...(match[1] ?? match[2]).matchAll(/'((?:[^']|'')*)'/g)].map((literal) =>
      literal[1].replaceAll("''", "'"),
    ),
  );
}

function affinity(type: string): keyof typeof GENERIC {
  const upper = type.toUpperCase();
  if (upper.includes("INT")) return "integer";
  if (/CHAR|CLOB|TEXT/.test(upper)) return "text";
  if (upper === "" || upper.includes("BLOB")) return "blob";
  if (/REAL|FLOA|DOUB/.test(upper)) return "real";
  return "integer";
}

/** Parents before children; a cycle is broken at a foreign key with a nullable column. */
function parentsFirst(shapes: Shape[]): Shape[] {
  const present = new Set(shapes.map((shape) => shape.name));
  const done = new Set<string>();
  const ordered: Shape[] = [];
  let remaining = shapes;
  let relaxed = false;
  while (remaining.length > 0) {
    const ready = remaining.filter((shape) =>
      shape.foreignKeys.every(
        (fk) =>
          fk.parent === shape.name ||
          done.has(fk.parent) ||
          !present.has(fk.parent) ||
          (relaxed && fk.from.some((name) => !shape.columns.find((c) => c.name === name)?.notnull)),
      ),
    );
    if (ready.length === 0) {
      if (relaxed) {
        throw new Error(
          `Foreign keys with no nullable column form a cycle: ${remaining.map((s) => s.name).join(", ")}`,
        );
      }
      relaxed = true;
      continue;
    }
    relaxed = false;
    for (const shape of ready) {
      ordered.push(shape);
      done.add(shape.name);
    }
    remaining = remaining.filter((shape) => !done.has(shape.name));
  }
  return ordered;
}

function readRows(connection: DatabaseSync, query: string, ...params: Value[]): Row[] {
  const statement = connection.prepare(query);
  statement.setReadBigInts(true);
  return statement.all(...params) as Row[];
}

/**
 * Tops `shape` up to two rows (one for a singleton or a table {@link ONE_ROW} names), or fails
 * naming the table.
 */
function fill(connection: DatabaseSync, shape: Shape, label: string) {
  if (shape.name in ONE_ROW) reached.oneRow.add(shape.name);
  const want = shape.singleton || shape.name in ONE_ROW ? 1 : 2;
  const rows = readRows(connection, `select * from ${ident(shape.name)} limit 2`);
  // Ahead of preparing the insert, which fails while a foreign key names a table this step lacks.
  if (rows.length >= want) return;
  let insert: StatementSync;
  try {
    insert = connection.prepare(
      `insert into ${ident(shape.name)} (${shape.columns.map((c) => ident(c.name)).join(", ")}) ` +
        `values (${shape.columns.map(() => "?").join(", ")})`,
    );
  } catch (error) {
    throw new Error(`Step ${label}: could not write ${shape.name}: ${messagesOf(error)}`, {
      cause: error,
    });
  }
  while (rows.length < want) {
    const template = rows[0];
    let refusal = "no values satisfy its CHECK constraints and foreign keys";
    let tried = 0;
    let written: Row | undefined;
    const search = { spent: false };
    for (const row of solutions(connection, shape, search, template)) {
      try {
        insert.run(...shape.columns.map((column) => row[column.name]));
        written = row;
        break;
      } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
        tried += 1;
        if (tried >= SOLUTIONS_TRIED) break;
      }
    }
    if (search.spent)
      refusal = `gave up after ${SEARCH_BUDGET} values, ${tried} rows refused, the last: ${refusal}`;
    if (written === undefined) {
      throw new Error(
        `Step ${label}: could not write row ${rows.length + 1} of ${shape.name}: ${refusal}`,
      );
    }
    rows.push(written);
  }
}

/**
 * Candidate rows for `shape`, each satisfying its CHECK constraints and foreign keys. With a
 * `template` (the row already there), the columns of its primary key and unique indexes take a
 * different value and every other column the template's value where one is accepted.
 */
function* solutions(
  connection: DatabaseSync,
  shape: Shape,
  search: { spent: boolean },
  template?: Row,
): Generator<Row> {
  const parentRows = new Map(
    shape.foreignKeys.map((fk) => [
      fk,
      readRows(connection, `select ${fk.to.map(ident).join(", ")} from ${ident(fk.parent)}`),
    ]),
  );
  const parentKeys = new Map(
    shape.foreignKeys.map((fk) => [
      fk,
      new Set(
        (parentRows.get(fk) ?? []).map((row) => fk.to.map((column) => key(row[column])).join("|")),
      ),
    ]),
  );

  const ownValues = (column: Column): Value[] => {
    const declared = CANDIDATES[`${shape.name}.${column.name}`];
    if (declared !== undefined) {
      reached.candidates.add(`${shape.name}.${column.name}`);
      return [...declared];
    }
    const kind = affinity(column.type);
    const values: Value[] = [];
    if (column.dflt !== null) {
      try {
        const statement = connection.prepare(`select ${column.dflt} as v`);
        statement.setReadBigInts(true);
        values.push((statement.get() as Row).v);
      } catch {
        // A default this engine cannot evaluate on its own is left to the generic values.
      }
    }
    if (kind === "text") {
      values.push(...shape.checks.flatMap((check) => listedValues(check.expression, column.name)));
    }
    return [...values, ...GENERIC[kind]];
  };

  const candidatesFor = (column: Column): Value[] => {
    const unique = shape.unique.has(column.name);
    const references = shape.foreignKeys.filter((fk) => fk.from.includes(column.name));
    let values: Value[];
    if (CANDIDATES[`${shape.name}.${column.name}`] !== undefined || references.length === 0) {
      values = ownValues(column);
    } else {
      values = references.flatMap((fk) =>
        (parentRows.get(fk) ?? []).map((row) => row[fk.to[fk.from.indexOf(column.name)]]),
      );
      // A row of a self-referencing table may point at its own key.
      for (const fk of references.filter((fk) => fk.parent === shape.name && column.notnull)) {
        const target = shape.columns.find((c) => c.name === fk.to[fk.from.indexOf(column.name)]);
        if (target !== undefined && target !== column) values.push(...ownValues(target));
      }
    }
    values = values.filter((value) => value !== null);
    if (!column.notnull) values = unique ? [...values, null] : [null, ...values];
    const seen = new Set<string>();
    values = values.filter((value) => !seen.has(key(value)) && seen.add(key(value)));
    if (template !== undefined) {
      const was = key(template[column.name] ?? null);
      const others = values.filter((value) => key(value) !== was);
      const same = template[column.name] ?? null;
      // The second row of a self-referencing table points at the first where it may.
      const pointsBack = references.some((fk) => fk.parent === shape.name);
      values = unique || pointsBack ? [...others, same] : [same, ...others];
    }
    return values;
  };

  const tests: { columns: string[]; test: (row: Row) => boolean }[] = [];
  for (const check of shape.checks) {
    const statement = connection.prepare(
      `select case when (${check.expression}) then 1 when (${check.expression}) is null then 1 ` +
        `else 0 end as ok from (select ${shape.columns
          .map((column) => `? as ${ident(column.name)}`)
          .join(", ")}) as ${ident(shape.name)}`,
    );
    tests.push({
      columns: check.columns,
      test: (row) => {
        try {
          return Number(statement.get(...shape.columns.map((c) => row[c.name] ?? null))?.ok) === 1;
        } catch {
          return false;
        }
      },
    });
  }
  for (const fk of shape.foreignKeys) {
    const allowed = parentKeys.get(fk) ?? new Set<string>();
    tests.push({
      columns: fk.parent === shape.name ? [...new Set([...fk.from, ...fk.to])] : fk.from,
      test: (row) => {
        const values = fk.from.map((column) => row[column] ?? null);
        if (values.some((value) => value === null)) return true;
        const tuple = values.map(key).join("|");
        if (allowed.has(tuple)) return true;
        return (
          fk.parent === shape.name &&
          fk.from.every((name) => shape.columns.find((c) => c.name === name)?.notnull) &&
          tuple === fk.to.map((c) => key(row[c] ?? null)).join("|")
        );
      },
    });
  }
  if (template !== undefined) {
    for (const columns of shape.distinct) {
      const taken = columns.map((column) => key(template[column] ?? null)).join("|");
      tests.push({
        columns,
        test: (row) =>
          columns.some((column) => row[column] === null) ||
          columns.map((column) => key(row[column] ?? null)).join("|") !== taken,
      });
    }
  }

  // A column no test reads takes its first value: varying it cannot satisfy a test.
  const constrained = new Set(tests.flatMap((test) => test.columns));
  const fixed: Row = Object.fromEntries(
    shape.columns
      .filter((column) => !constrained.has(column.name))
      .map((column) => [column.name, candidatesFor(column)[0] ?? null]),
  );
  // A self-reference's columns come first, so its preference for the first row is tried first.
  const vars = [
    ...shape.foreignKeys.filter((fk) => fk.parent === shape.name).flatMap((fk) => fk.from),
    ...[...tests]
      .sort((a, b) => a.columns.length - b.columns.length)
      .flatMap((test) => test.columns),
  ]
    .filter((name, index, all) => all.indexOf(name) === index)
    .map((name) => shape.columns.find((column) => column.name === name))
    .filter((column): column is Column => column !== undefined)
    .map((column) => ({ name: column.name, candidates: candidatesFor(column) }));
  const position = new Map(vars.map((v, index) => [v.name, index]));
  // Each test runs once its last column has a value, and names the earlier columns it read.
  const testsAt = vars.map(() => [] as { test: (row: Row) => boolean; reads: number[] }[]);
  for (const test of tests) {
    const reads = test.columns.map((name) => position.get(name) ?? -1);
    const last = Math.max(...reads);
    if (last >= 0) testsAt[last].push({ test: test.test, reads: reads.filter((p) => p < last) });
  }

  // Backtracking that, when a column runs out of values, jumps back to the latest column a failed
  // test read rather than to the one just before it (conflict-directed backjumping). After a row
  // has been handed out it steps back one column at a time, so every row is reachable.
  let budget = SEARCH_BUDGET;
  let found = 0;
  const row: Row = { ...fixed };
  function* assign(index: number): Generator<Row, Set<number>> {
    if (index === vars.length) {
      found += 1;
      yield { ...row };
      return new Set();
    }
    const conflicts = new Set<number>();
    for (const value of vars[index].candidates) {
      budget -= 1;
      if (budget < 0) {
        search.spent = true;
        return new Set();
      }
      row[vars[index].name] = value;
      const failed = testsAt[index].find((test) => !test.test(row));
      if (failed !== undefined) {
        for (const read of failed.reads) conflicts.add(read);
        continue;
      }
      const before = found;
      const below = yield* assign(index + 1);
      if (search.spent) return new Set();
      if (found > before) continue;
      if (!below.has(index)) {
        delete row[vars[index].name];
        return below;
      }
      for (const read of below) if (read !== index) conflicts.add(read);
    }
    delete row[vars[index].name];
    return conflicts;
  }
  yield* assign(0);
}
