import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { installChangeFeed } from "../packages/db/src/change-feed.js";
import { openVenueDatabase } from "../packages/db/src/client.js";
import { applyMigrations } from "../packages/migrations/src/apply.js";
import {
  migrationOptionsFor,
  type VenueMigrationOptions,
} from "../packages/migrations/src/manifest.js";
import { orderedMigrationSets } from "../packages/module/src/module.js";
import { migrationUpgradeBudget } from "./migration-upgrade-budget.mjs";
import { appendOnlyTriggers } from "../packages/store/src/append-only.js";
import { scratchParent } from "./scratch-dir.mjs";
import { createStepWatch, reportStallAfter } from "./step-watch.mjs";

/**
 * One database upgraded the way a box is, from the squash epoch onwards. The initial checkpoint
 * applies only the migrations {@link EPOCH_FILE} names, in the descriptors' dependency order, then
 * does what boot does after migrating (the change feed) and fills every table. It then repeats
 * `applyMigrations` and the change feed on the filled database, and every row must be unchanged.
 * Every later migration, in any set, including one the epoch does not name, runs at its own date,
 * with the change feed installed between steps and rows carried through; on one date, a set runs
 * after the sets it requires. Before anything runs, a foreign key that names another set's table
 * is refused unless its set requires that set and the table is created no later than the key. At
 * every step the walk migrates, installs the change feed, then runs `applyMigrations` once more so
 * the append-only triggers go on the tables the step created, and installs the change feed again;
 * it then fails if a declared append-only table lacks its triggers, or if a trigger the step before
 * left is gone while its table remains and the step's SQL never drops it by name, before any row
 * is written.
 *
 * After each step every table is topped up to two rows, read from that step's own schema (its
 * columns, foreign keys, unique indexes and CHECK constraints) and written with the file's foreign
 * keys, CHECKs and triggers in force. The second row repeats the first wherever its constraints
 * allow and differs in the primary key and in every unique index over plain columns, so a later
 * unique index over a column the two rows share is refused. Each table's row count is recorded
 * before the next step; a table that still exists after it holding fewer rows fails the test,
 * naming the step.
 *
 * Weaker than its name in these ways. The change feed at each step is TODAY's list, less whatever
 * that step's schema lacks, and the append-only tables are TODAY's list filtered to the tables that
 * exist: a step's own migration runs with only the tables the PREVIOUS step left protected, so a
 * table the step creates gets its triggers at the second pass, not while that step migrates. The
 * rows are synthetic, not the product's: a few generic values per declared type, a CHECK's own
 * literals, a column's default and {@link CANDIDATES}. A nullable column outside every unique
 * index is null wherever its constraints allow, except that a second row points a self-reference
 * at the first. So a migration that fails only on values the product writes and these rows lack
 * passes. The reference check reads the SQL as text, with comments removed and quoted names not
 * parsed: a `--`, `/*` or `'` inside a quoted name can hide a later key, and a string literal
 * holding `REFERENCES <table>` or `CREATE TABLE <table>` is read as if it were SQL. A reference is
 * to the latest migration in run order, at or before it, whose `CREATE TABLE` or `RENAME TO` names
 * the table; drops are not followed, so a key to a table dropped before it is caught only when the
 * fill writes rows; a table named only in a trigger body or a view is not checked, and a set's
 * requirements count through other sets. A lost trigger is judged by name alone: one recreated with
 * another body passes. A change-feed trigger counts as lost only when today's change-feed source
 * names a column the step drops, since the feed then leaves it out. The tables {@link ONE_ROW}
 * names, and a singleton (`CHECK (id = 1)`), hold one row. Steps a walk's resets list names cannot
 * carry the rows, and the walk restarts from an empty database at each. Between steps rows are
 * counted, not compared, so a migration that rewrites a value passes; only the epoch's repeat
 * compares values. After the final step it also pins the nine product triggers and the append-only
 * triggers of every table the sets declare; no trigger is compared across the initial checkpoint,
 * which starts empty.
 */

type ChangeSource = NonNullable<(typeof ALL_MODULES)[number]["changes"]>[number];

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

/** A migration set as the walk applies it: `applyMigrations`'s options plus the set's name. */
interface WalkSet extends VenueMigrationOptions {
  readonly name: string;
  /** The sets this one's descriptors require, by set name. */
  readonly requires?: readonly string[];
}

interface EpochEntry {
  name: string;
  tag: string;
  when: number;
  sha256: string;
}

/** The migrations a squashed venue starts from; a later migration is not in it. */
interface Epoch {
  version: number;
  entries: EpochEntry[];
  emptySets: string[];
}

type ResetExpectation = { refused: readonly string[] } | { lost: readonly string[] };

/**
 * Shipped steps that cannot carry these rows, each keyed `set/tag` with the failure it must still
 * show: the parts of a refusal's message, or exactly the tables whose rows the step loses, so a
 * loss beside the listed ones fails the guard. Before go-live a schema change may need a venue
 * reset (CLAUDE.md §3), so at a listed step the guard checks the failure, then migrates an empty
 * database to the same point and fills it again. A listed step that carries the rows, a step two
 * keys name, or a key naming no step the walk takes, fails the guard.
 */
type Resets = Readonly<Record<string, ResetExpectation>>;

const RESETS: Resets = {};

const EPOCH_FILE = new URL("./migration-baseline-epoch.json", import.meta.url);

const SET_REQUIRES = setRequires(ALL_MODULES);
const sets: WalkSet[] = orderedMigrationSets(ALL_MODULES).map((set) => ({
  name: set.name,
  ...migrationOptionsFor([set], null)[0],
  requires: SET_REQUIRES.get(set.name) ?? [],
}));
const epoch = readEpoch();
const { cuts } = planWalk(sets, epoch);
const {
  workMs: WORK_BUDGET_MS,
  idleMs: NO_PROGRESS_LIMIT_MS,
  timeoutMs: TEST_BOUND_MS,
} = migrationUpgradeBudget(cuts.length + 1);
const SCRATCH_PARENT = scratchParent();

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function readJournal(folder: string): Journal {
  return JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8"));
}

function readEpoch(file: URL | string = EPOCH_FILE): Epoch {
  return JSON.parse(readFileSync(file, "utf8"));
}

function sqlHash(folder: string, tag: string): string {
  return createHash("sha256")
    .update(readFileSync(join(folder, `${tag}.sql`)))
    .digest("hex");
}

/** Throws, naming the set and tag, unless every identity the epoch records is still shipped. */
function verifyEpoch(epoch: Epoch, known: readonly WalkSet[]): void {
  if (epoch.version !== 1) throw new Error(`epoch version ${epoch.version}, expected 1`);
  if (epoch.entries.length === 0) throw new Error("epoch names no migration");
  const byName = new Map(known.map((set) => [set.name, set]));
  const named = new Set<string>();
  for (const entry of epoch.entries) {
    const at = `${entry.name}/${entry.tag}`;
    const set = byName.get(entry.name);
    if (set === undefined) throw new Error(`${at}: the epoch names an unknown set`);
    if (named.has(entry.name)) throw new Error(`${at}: the epoch names its set twice`);
    named.add(entry.name);
    const shipped = readJournal(set.migrationsFolder).entries.find((e) => e.tag === entry.tag);
    if (shipped === undefined) throw new Error(`${at}: not in its set's journal`);
    if (shipped.when !== entry.when) {
      throw new Error(`${at}: dated ${shipped.when} in its journal, ${entry.when} in the epoch`);
    }
    const hash = sqlHash(set.migrationsFolder, entry.tag);
    if (hash !== entry.sha256) {
      throw new Error(`${at}: its SQL hashes to ${hash}, the epoch records ${entry.sha256}`);
    }
  }
  for (const name of epoch.emptySets) {
    if (!byName.has(name)) throw new Error(`${name}: the epoch names an unknown empty set`);
    if (named.has(name)) throw new Error(`${name}: the epoch names it both empty and populated`);
  }
}

/**
 * Each set's journal, the epoch's entry in each, and the dates of every later migration. A
 * migration is in the initial checkpoint only if the epoch names it.
 */
function planWalk(walkSets: readonly WalkSet[], walkEpoch: Epoch, firstMigrationsInEpoch = false) {
  const journals = new Map(walkSets.map((set) => [set.name, readJournal(set.migrationsFolder)]));
  const isEpoch = (name: string, entry: JournalEntry) =>
    (firstMigrationsInEpoch && entry.idx === 0) ||
    walkEpoch.entries.some((at) => at.name === name && at.tag === entry.tag);
  const cuts = [
    ...new Set(
      [...journals].flatMap(([name, journal]) =>
        journal.entries.filter((entry) => !isEpoch(name, entry)).map((entry) => entry.when),
      ),
    ),
  ].sort((a, b) => a - b);
  return { journals, isEpoch, cuts };
}

const INITIAL = Symbol("the epoch");

interface WalkInput {
  /** In dependency order, each with the folder its migrations are staged from. */
  sets: readonly WalkSet[];
  epoch: Epoch;
  resets: Resets;
  /** The change feed's sources; the walk installs those whose table and columns exist. */
  sources?: readonly ChangeSource[];
  watch?: ReturnType<typeof createStepWatch>;
  /** Runs around the populated repeat of the initial checkpoint, for a caller's own comparison. */
  aroundRepeat?: (venueDir: string, repeat: () => Promise<void>) => Promise<void>;
  /**
   * Also puts every set's first migration in the initial checkpoint, and skips the reference
   * check: the rule the walk must not follow, kept to show how it fails.
   */
  firstMigrationsInEpoch?: boolean;
}

/**
 * Walks `input.sets` from the epoch to their last migration and returns the venue folder and the
 * row counts after the last step.
 */
async function walkUpgrade(input: WalkInput) {
  const { epoch: walkEpoch, resets } = input;
  const sources = input.sources ?? [];
  const watch = input.watch ?? createStepWatch();
  verifyEpoch(walkEpoch, input.sets);
  const ordered = orderByRequires(input.sets);
  const {
    journals,
    isEpoch,
    cuts: walkCuts,
  } = planWalk(ordered, walkEpoch, input.firstMigrationsInEpoch);
  if (input.firstMigrationsInEpoch !== true) checkReferences(ordered, journals, isEpoch);

  const root = mkdtempSync(join(SCRATCH_PARENT, "wt-migration-upgrade-"));
  scratch.push(root);
  const staged = join(root, "migrations");
  const venueDir = join(root, "venue");
  const stagedSets = ordered.map((set) => {
    const folder = join(staged, set.name);
    cpSync(set.migrationsFolder, folder, { recursive: true });
    return { ...set, migrationsFolder: folder };
  });

  const bookkeeping = new Set(stagedSets.map((set) => set.migrationsTable));
  const reachedResets = new Set<string>();
  let held = new Map<string, number>();
  let existing = new Set<string>();
  const labels: string[] = [];
  for (const cut of [INITIAL, ...walkCuts] as const) {
    const at = (name: string, entry: JournalEntry) =>
      cut === INITIAL ? isEpoch(name, entry) : entry.when === cut && !isEpoch(name, entry);
    const tags = [...journals].flatMap(([name, journal]) =>
      journal.entries.filter((entry) => at(name, entry)).map((entry) => `${name}/${entry.tag}`),
    );
    const label = cut === INITIAL ? `epoch (${tags.join(", ")})` : tags.join(", ");
    labels.push(label);
    const dropped = new Set(
      tags.flatMap((tag) => {
        const [name, file] = tag.split("/");
        const sql = readFileSync(join(staged, name, `${file}.sql`), "utf8");
        return namesAfter(sql, /\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?/gi);
      }),
    );
    for (const [name, journal] of journals) {
      const entries = journal.entries.filter(
        (entry) => isEpoch(name, entry) || (cut !== INITIAL && entry.when <= cut),
      );
      writeFileSync(
        join(staged, name, "meta", "_journal.json"),
        JSON.stringify({ ...journal, entries }),
      );
    }
    // Only tables that exist when it runs: a set's declared list is today's, and some of its tables
    // are created by later migrations.
    const migrate = (phase: string) =>
      watch.phase(`${label}: ${phase}`, () =>
        applyMigrations(
          venueDir,
          stagedSets.map((set) => optionsOf(set, existing)),
        ),
      );
    const feed = async () => {
      existing = await installPresentChangeFeed(venueDir, sources, (phase, run) =>
        watch.phase(`${label}: ${phase}`, run),
      );
    };
    const step = async () => {
      const before = cut === INITIAL ? new Map<string, string>() : triggersOf(venueDir);
      await migrate("migrate");
      await feed();
      await migrate("protect");
      await feed();
      const after = triggersOf(venueDir);
      const lost = [...before].filter(
        ([trigger, table]) =>
          !after.has(trigger) && existing.has(table) && !dropped.has(trigger.toLowerCase()),
      );
      if (lost.length > 0) {
        throw new Error(
          `Step ${label} lost triggers on tables it kept: ` +
            lost.map(([trigger, table]) => `${trigger} on ${table}`).join(", ") +
            "; a migration that drops a trigger on purpose says so with DROP TRIGGER",
        );
      }
      const unprotected = appendOnlyTriggers(
        stagedSets.flatMap((set) =>
          set.database === "node"
            ? []
            : (set.appendOnlyTables ?? []).filter((table) => existing.has(table)),
        ),
      ).filter((trigger) => !after.has(trigger.name));
      if (unprotected.length > 0) {
        throw new Error(
          `Step ${label}: append-only triggers missing before rows are written: ` +
            unprotected.map((trigger) => trigger.name).join(", "),
        );
      }
      held = await watch.phase(`${label}: rows`, () =>
        carryRows(venueDir, label, held, bookkeeping),
      );
    };

    const listed = tags.filter((tag) => tag in resets);
    for (const entry of listed) reachedResets.add(entry);
    if (listed.length > 1) {
      throw new Error(
        `Step ${label} matches ${listed.length} RESETS entries (${listed.join(", ")}); ` +
          "a step is checked against one entry, so merge them into one",
      );
    }
    const [reset] = listed;
    if (reset === undefined) {
      await step();
    } else {
      const failure = await step().then(
        () => undefined,
        (error: unknown) => error,
      );
      const mismatch = resetMismatch(resets[reset], failure);
      if (mismatch !== undefined) {
        throw new Error(
          `Step ${label} is listed in RESETS as ${JSON.stringify(resets[reset])}, but ${mismatch}`,
          { cause: failure },
        );
      }
      rmSync(venueDir, { recursive: true, force: true });
      held = new Map();
      await step();
    }

    if (cut === INITIAL) {
      const repeat = async () => {
        await migrate("repeat");
        await feed();
      };
      const around = input.aroundRepeat ?? ((_dir, run) => run());
      const before = allRows(venueDir);
      await around(venueDir, repeat);
      expect(allRows(venueDir), `${label}: rows after repeating migrate and change feed`).toEqual(
        before,
      );
    }
  }
  const unreached = Object.keys(resets).filter((key) => !reachedResets.has(key));
  if (unreached.length > 0) {
    throw new Error(`RESETS names steps the walk never took: ${unreached.join(", ")}`);
  }
  return { venueDir, held, steps: walkCuts.length + 1, labels };
}

/** Each trigger in the venue file, with its table; none before the file exists. */
function triggersOf(venueDir: string): Map<string, string> {
  if (!existsSync(join(venueDir, "venue.db"))) return new Map();
  const connection = openRaw(venueDir);
  try {
    return new Map(
      connection
        .prepare("select name, tbl_name from sqlite_master where type = 'trigger'")
        .all()
        .map((row) => [String(row.name), String(row.tbl_name)]),
    );
  } finally {
    connection.close();
  }
}

/**
 * Each name, unquoted, without a `main.` prefix and lowercased as SQLite compares names, that
 * follows a match of `before` in `sql` outside its comments.
 */
function namesAfter(sql: string, before: RegExp): string[] {
  const quote = `[\`"[\\]]?`;
  const pattern = new RegExp(
    `${before.source}(?:${quote}main${quote}\\s*\\.\\s*)?${quote}(\\w+)`,
    before.flags,
  );
  // One pass, so a quoted string is skipped whole and a `--` inside it starts no comment.
  const code = sql.replace(/'(?:[^']|'')*'|\/\*[\s\S]*?\*\/|--[^\n]*/g, (match) =>
    match.startsWith("'") ? match : " ",
  );
  return [...code.matchAll(pattern)].map((match) => match[1].toLowerCase());
}

/** Each module's set's requirements, as set names: a module without a set counts as its host's. */
function setRequires(modules: typeof ALL_MODULES): Map<string, string[]> {
  const byName = new Map(modules.map((module) => [module.name, module]));
  const setOf = (name: string) => {
    const module = byName.get(name);
    return module?.migrations?.name ?? byName.get(module?.tablesIn ?? "")?.migrations?.name;
  };
  const requires = new Map<string, string[]>();
  for (const module of modules) {
    const own = setOf(module.name);
    if (own === undefined) continue;
    const deps = [
      ...(module.requires?.core === undefined ? [] : ["core"]),
      ...Object.keys(module.requires?.modules ?? {}),
    ]
      .map(setOf)
      .filter((dep): dep is string => dep !== undefined && dep !== own);
    requires.set(own, [...new Set([...(requires.get(own) ?? []), ...deps])]);
  }
  return requires;
}

/** `walkSets` with every set after the sets it requires, input order breaking ties. */
function orderByRequires(walkSets: readonly WalkSet[]): WalkSet[] {
  const names = new Set(walkSets.map((set) => set.name));
  const ordered: WalkSet[] = [];
  const placed = new Set<string>();
  let remaining = [...walkSets];
  while (remaining.length > 0) {
    const next = remaining.find((set) =>
      (set.requires ?? []).every((dep) => placed.has(dep) || !names.has(dep)),
    );
    if (next === undefined) {
      throw new Error(`these sets require each other: ${remaining.map((s) => s.name).join(", ")}`);
    }
    ordered.push(next);
    placed.add(next.name);
    remaining = remaining.filter((set) => set !== next);
  }
  return ordered;
}

/**
 * Throws unless every table a migration's foreign keys name belongs to its own set, or to a set
 * it requires directly or through another, and is created no later than the migration runs (the
 * epoch's migrations all run first). Read from the SQL as text: a reference is to the latest
 * migration, in run order, that creates the table (`CREATE TABLE` or `RENAME TO`) at or before the
 * referring one, so a table may move between sets; a foreign key is `REFERENCES`.
 */
function checkReferences(
  walkSets: readonly WalkSet[],
  journals: Map<string, Journal>,
  isEpoch: (name: string, entry: JournalEntry) => boolean,
): void {
  const byName = new Map(walkSets.map((set) => [set.name, set]));
  const required = (name: string, seen = new Set<string>()): Set<string> => {
    for (const dep of byName.get(name)?.requires ?? []) {
      if (!seen.has(dep)) required(dep, seen.add(dep));
    }
    return seen;
  };
  const migrations = walkSets
    .flatMap((set, order) =>
      journals.get(set.name)!.entries.map((entry) => ({
        set: set.name,
        entry,
        order,
        runs: isEpoch(set.name, entry) ? -Infinity : entry.when,
        sql: readFileSync(join(set.migrationsFolder, `${entry.tag}.sql`), "utf8"),
      })),
    )
    .sort((a, b) => a.runs - b.runs || a.order - b.order);
  // Each table's creating migrations, by their place in run order.
  const creators = new Map<string, number[]>();
  migrations.forEach((migration, place) => {
    for (const table of [
      ...namesAfter(migration.sql, /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/gi),
      ...namesAfter(migration.sql, /\bRENAME\s+TO\s+/gi),
    ]) {
      creators.set(table, [...(creators.get(table) ?? []), place]);
    }
  });
  for (const [place, migration] of migrations.entries()) {
    const at = `${migration.set}/${migration.entry.tag}`;
    for (const table of namesAfter(migration.sql, /\bREFERENCES\s+/gi)) {
      const places = creators.get(table) ?? [];
      const made = places.findLast((created) => created <= place) ?? places[0];
      if (made === undefined) continue;
      const creator = migrations[made];
      if (creator.set === migration.set) continue;
      if (!required(migration.set).has(creator.set)) {
        throw new Error(
          `${at} refers to ${table}, a table of ${creator.set}, which ${migration.set} does not require`,
        );
      }
      if (made > place) {
        throw new Error(
          `${at}, dated ${migration.entry.when}, refers to ${table}, which ` +
            `${creator.set}/${creator.entry.tag} ` +
            (creator.entry.when === migration.entry.when
              ? "creates on the same date but runs after it"
              : `creates only at ${creator.entry.when}`),
        );
      }
    }
  }
}

/** `set` as `applyMigrations` takes it, with append-only triggers only on tables that exist. */
function optionsOf(set: VenueMigrationOptions, existing: Set<string>): VenueMigrationOptions {
  return {
    migrationsFolder: set.migrationsFolder,
    migrationsTable: set.migrationsTable,
    appendOnlyTables: (set.appendOnlyTables ?? []).filter((table) => existing.has(table)),
    ...(set.database === undefined ? {} : { database: set.database }),
  };
}

/** Installs the change feed for the sources whose table and columns exist; returns the tables. */
async function installPresentChangeFeed(
  venueDir: string,
  sources: readonly ChangeSource[],
  phase: <T>(name: string, run: () => T | Promise<T>) => Promise<T> = async (_name, run) => run(),
): Promise<Set<string>> {
  const store = await phase("open", () => openVenueDatabase(venueDir));
  try {
    const present = sources.filter((source) => {
      const columns = new Set(
        store.venue
          .all<{ name: string }>(`select name from pragma_table_info('${source.table}')`)
          .map((column) => column.name),
      );
      return columns.size > 0 && (source.related ?? []).every((rel) => columns.has(rel.column));
    });
    // The next migration meets the completed feed; its individual DDL commits are not a step.
    await phase("change feed", () =>
      store.venue.withWriteLock(() => installChangeFeed(store.venue, present)),
    );
    return new Set(
      store.venue
        .all<{ name: string }>(`select name from sqlite_master where type = 'table'`)
        .map((table) => table.name),
    );
  } finally {
    await phase("close", () => store.close());
  }
}

/** Every row of every table, sorted, keyed by table. */
function allRows(venueDir: string): Record<string, unknown[]> {
  const connection = openRaw(venueDir);
  try {
    const names = connection
      .prepare(
        `select name from sqlite_master where type = 'table' and name not like 'sqlite\\_%' escape '\\' order by name`,
      )
      .all()
      .map((row) => String(row.name));
    return Object.fromEntries(
      names.map((name) => [
        name,
        connection
          .prepare(`select * from ${ident(name)}`)
          .all()
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ]),
    );
  } finally {
    connection.close();
  }
}

const PRODUCT_TRIGGERS = [
  "products_variant_one_level_insert",
  "products_variant_parent_fixed_update",
  "products_id_fixed_update",
  "products_ordering_check_insert",
  "products_ordering_check_update",
  "products_media_image_fk_insert",
  "products_media_image_fk_update",
  "products_media_image_fk_parent_delete",
  "products_media_image_fk_parent_rename",
];

/** A made-up migration set in a scratch folder: each migration's tag, date and SQL statements. */
function syntheticSet(
  name: string,
  migrations: readonly { tag: string; when: number; sql: readonly string[] }[],
): WalkSet {
  const folder = mkdtempSync(join(SCRATCH_PARENT, `wt-upgrade-${name}-`));
  scratch.push(folder);
  const meta = join(folder, "meta");
  for (const migration of migrations) {
    writeFileSync(
      join(folder, `${migration.tag}.sql`),
      migration.sql.join("\n--> statement-breakpoint\n"),
    );
  }
  mkdirSync(meta);
  writeFileSync(
    join(meta, "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: migrations.map((migration, idx) => ({
        idx,
        version: "6",
        when: migration.when,
        tag: migration.tag,
        breakpoints: true,
      })),
    }),
  );
  return {
    name,
    migrationsFolder: folder,
    migrationsTable: `__drizzle_migrations_${name.replaceAll("-", "_")}`,
    appendOnlyTables: [],
  };
}

/** The epoch naming each set's first migration as its journal records it. */
function epochOf(walkSets: readonly WalkSet[]): Epoch {
  return {
    version: 1,
    entries: walkSets.map((set) => {
      const [first] = readJournal(set.migrationsFolder).entries;
      return {
        name: set.name,
        tag: first.tag,
        when: first.when,
        sha256: sqlHash(set.migrationsFolder, first.tag),
      };
    }),
    emptySets: [],
  };
}

const BASE = {
  tag: "0000_baseline",
  when: 1_000,
  sql: ["CREATE TABLE `kept` (`id` integer PRIMARY KEY NOT NULL, `label` text NOT NULL)"],
};

/** One synthetic set: the baseline, then `later` at a later date. */
function oneStep(later: readonly string[]): WalkSet[] {
  return [syntheticSet("synthetic", [BASE, { tag: "0001_later", when: 2_000, sql: later }])];
}

describe("the squash epoch", () => {
  it("is committed, names the seven populated sets and still matches what ships", () => {
    expect(epoch.version).toBe(1);
    expect(epoch.entries.map((entry) => entry.name)).toEqual([
      "core",
      "node",
      "workforce",
      "workforce-es",
      "payments",
      "bookings",
      "fiscal-verifactu",
    ]);
    expect(epoch.emptySets).toEqual(["fiscal-none"]);
    expect(() => verifyEpoch(epoch, sets)).not.toThrow();
  });

  it.each([
    [
      "an unknown set",
      (e: Epoch) => ({ ...e, entries: [...e.entries, { ...e.entries[0], name: "nowhere" }] }),
      "nowhere/0000_baseline: the epoch names an unknown set",
    ],
    [
      "a tag its journal lacks",
      (e: Epoch) => ({
        ...e,
        entries: e.entries.map((entry) =>
          entry.name === "payments" ? { ...entry, tag: "0000_gone" } : entry,
        ),
      }),
      "payments/0000_gone: not in its set's journal",
    ],
    [
      "a changed hash",
      (e: Epoch) => ({
        ...e,
        entries: e.entries.map((entry) =>
          entry.name === "core" ? { ...entry, sha256: "0".repeat(64) } : entry,
        ),
      }),
      `core/0000_baseline: its SQL hashes to`,
    ],
    [
      "a changed date",
      (e: Epoch) => ({
        ...e,
        entries: e.entries.map((entry) =>
          entry.name === "bookings" ? { ...entry, when: entry.when + 1 } : entry,
        ),
      }),
      "bookings/0000_baseline: dated",
    ],
    [
      "an unknown empty set",
      (e: Epoch) => ({ ...e, emptySets: [...e.emptySets, "fiscal-elsewhere"] }),
      "fiscal-elsewhere: the epoch names an unknown empty set",
    ],
    ["another version", (e: Epoch) => ({ ...e, version: 2 }), "epoch version 2, expected 1"],
    ["no entries", (e: Epoch) => ({ ...e, entries: [] }), "epoch names no migration"],
    [
      "a set named twice",
      (e: Epoch) => ({ ...e, entries: [...e.entries, e.entries[1]] }),
      "node/0000_baseline: the epoch names its set twice",
    ],
    [
      "a set both empty and populated",
      (e: Epoch) => ({ ...e, emptySets: [...e.emptySets, "workforce"] }),
      "workforce: the epoch names it both empty and populated",
    ],
  ])("refuses an epoch with %s, naming it", (_case, change, message) => {
    expect(() => verifyEpoch(change(structuredClone(epoch)), sets)).toThrow(message);
  });
});

describe("upgrading a venue one migration at a time", () => {
  it("inspects schemas only for tables that may need more rows", () => {
    const root = mkdtempSync(join(SCRATCH_PARENT, "wt-upgrade-filled-"));
    scratch.push(root);
    const connection = openRaw(root);
    try {
      connection.exec(`
        create table filled (id text primary key, label text not null);
        insert into filled values ('first', 'kept'), ('second', 'also kept');
        create table short (id text primary key references filled(id), label text not null);
        insert into short values ('first', 'kept');
      `);
    } finally {
      connection.close();
    }
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
    try {
      expect(carryRows(root, "filled-table probe", new Map(), new Set())).toEqual(
        new Map([
          ["filled", 2],
          ["short", 2],
        ]),
      );
      const shapeReads = prepare.mock.calls.filter(([query]) =>
        query.includes("dflt_value, pk from pragma_table_info"),
      );
      expect(shapeReads).toHaveLength(1);
    } finally {
      prepare.mockRestore();
    }
    const readback = openRaw(root);
    try {
      expect(readback.prepare("select * from filled order by id").all()).toEqual([
        { id: "first", label: "kept" },
        { id: "second", label: "also kept" },
      ]);
      expect(readback.prepare("select * from short order by id").all()).toEqual([
        { id: "first", label: "kept" },
        { id: "second", label: "kept" },
      ]);
    } finally {
      readback.close();
    }
  });

  it("reports row loss even when the remaining rows already fill the table", () => {
    const root = mkdtempSync(join(SCRATCH_PARENT, "wt-upgrade-loss-"));
    scratch.push(root);
    const connection = openRaw(root);
    let before: Map<string, number>;
    try {
      connection.exec(`
        create table filled (id integer primary key);
        insert into filled values (1), (2), (3);
      `);
      before = tableCounts(connection, new Set());
      connection.exec("delete from filled where id = 3");
    } finally {
      connection.close();
    }
    expect(() => carryRows(root, "row-loss probe", before, new Set())).toThrow(
      "filled: 3 rows before, 2 after",
    );
  });

  it("counts a listed one-row table as reached even when it already has two rows", () => {
    const root = mkdtempSync(join(SCRATCH_PARENT, "wt-upgrade-one-row-"));
    scratch.push(root);
    const connection = openRaw(root);
    try {
      connection.exec(`
        create table sale_settlements (id integer primary key);
        insert into sale_settlements values (1), (2);
      `);
    } finally {
      connection.close();
    }
    const wasReached = reached.oneRow.has("sale_settlements");
    reached.oneRow.delete("sale_settlements");
    try {
      expect(carryRows(root, "one-row reach probe", new Map(), new Set())).toEqual(
        new Map([["sale_settlements", 2]]),
      );
      expect(reached.oneRow.has("sale_settlements")).toBe(true);
    } finally {
      if (!wasReached) reached.oneRow.delete("sale_settlements");
      else reached.oneRow.add("sale_settlements");
    }
  });

  it("carries rows through a later step that keeps them", async () => {
    const walkSets = oneStep(["ALTER TABLE `kept` ADD `note` text"]);
    const { held, steps } = await walkUpgrade({
      sets: walkSets,
      epoch: epochOf(walkSets),
      resets: {},
    });
    expect(steps).toBe(2);
    expect(held.get("kept")).toBe(2);
  });

  it("fails a later step that loses rows no resets entry lists", async () => {
    const walkSets = oneStep(["DELETE FROM `kept` WHERE `id` = (SELECT max(`id`) FROM `kept`)"]);
    await expect(
      walkUpgrade({ sets: walkSets, epoch: epochOf(walkSets), resets: {} }),
    ).rejects.toThrow("Step synthetic/0001_later lost rows the step before wrote:\nkept: 2 rows");
  });

  it("passes a listed step that fails for exactly its stated reason", async () => {
    const refusing = oneStep(["ALTER TABLE `kept` ADD `required` text NOT NULL"]);
    const refused = await walkUpgrade({
      sets: refusing,
      epoch: epochOf(refusing),
      resets: {
        "synthetic/0001_later": {
          refused: ["ALTER TABLE `kept` ADD `required`", "Cannot add a NOT NULL column"],
        },
      },
    });
    expect(refused.held.get("kept")).toBe(2);

    const losing = oneStep(["DELETE FROM `kept`"]);
    const lost = await walkUpgrade({
      sets: losing,
      epoch: epochOf(losing),
      resets: { "synthetic/0001_later": { lost: ["kept"] } },
    });
    expect(lost.held.get("kept")).toBe(2);
  });

  it("fails a listed step that fails for another reason", async () => {
    const walkSets = oneStep(["ALTER TABLE `kept` ADD `required` text NOT NULL"]);
    await expect(
      walkUpgrade({
        sets: walkSets,
        epoch: epochOf(walkSets),
        resets: { "synthetic/0001_later": { refused: ["FOREIGN KEY constraint failed"] } },
      }),
    ).rejects.toThrow(/is listed in RESETS as .* but it failed with: .*Cannot add a NOT NULL/s);
  });

  it("fails a listed step that loses rows beside the tables it lists", async () => {
    const walkSets = [
      syntheticSet("synthetic", [
        {
          ...BASE,
          sql: [...BASE.sql, "CREATE TABLE `other` (`id` integer PRIMARY KEY NOT NULL)"],
        },
        { tag: "0001_later", when: 2_000, sql: ["DELETE FROM `kept`", "DELETE FROM `other`"] },
      ]),
    ];
    await expect(
      walkUpgrade({
        sets: walkSets,
        epoch: epochOf(walkSets),
        resets: { "synthetic/0001_later": { lost: ["kept"] } },
      }),
    ).rejects.toThrow("it also lost rows RESETS does not list:\nother: 2 rows before, 0 after");
  });

  it("fails a listed step that carries its rows", async () => {
    const walkSets = oneStep(["ALTER TABLE `kept` ADD `note` text"]);
    await expect(
      walkUpgrade({
        sets: walkSets,
        epoch: epochOf(walkSets),
        resets: { "synthetic/0001_later": { lost: ["kept"] } },
      }),
    ).rejects.toThrow("but it carried the rows");
  });

  it("fails a listed step the walk never reaches", async () => {
    const walkSets = oneStep(["ALTER TABLE `kept` ADD `note` text"]);
    await expect(
      walkUpgrade({
        sets: walkSets,
        epoch: epochOf(walkSets),
        resets: { "synthetic/0009_nowhere": { lost: ["kept"] } },
      }),
    ).rejects.toThrow("RESETS names steps the walk never took: synthetic/0009_nowhere");
  });

  it("refuses to walk from an epoch that no longer matches what ships", async () => {
    const walkSets = oneStep(["ALTER TABLE `kept` ADD `note` text"]);
    const stale = epochOf(walkSets);
    stale.entries[0].sha256 = "0".repeat(64);
    await expect(walkUpgrade({ sets: walkSets, epoch: stale, resets: {} })).rejects.toThrow(
      "synthetic/0000_baseline: its SQL hashes to",
    );
  });

  it(
    "applies every shipped migration from the epoch on top of the change feed the step before installed",
    async () => {
      const watch = createStepWatch();
      reached.candidates.clear();
      reached.oneRow.clear();
      const wallStartedAt = performance.now();
      const cpuStartedAt = process.threadCpuUsage();
      let comparedKitchenRows = false;
      const { held, venueDir } = await reportStallAfter(
        watch,
        { workMs: WORK_BUDGET_MS, idleMs: NO_PROGRESS_LIMIT_MS },
        () =>
          walkUpgrade({
            sets,
            epoch,
            resets: RESETS,
            sources: ALL_MODULES.flatMap((module) => module.changes ?? []),
            watch,
            aroundRepeat: async (dir, repeat) => {
              const kitchenBefore = kitchenRows(dir);
              await repeat();
              expect(kitchenRows(dir), "epoch repeat: parent and child row values").toEqual(
                kitchenBefore,
              );
              comparedKitchenRows = true;
            },
          }),
      );
      const cpu = process.threadCpuUsage(cpuStartedAt);
      const cpuMs = Math.round((cpu.user + cpu.system) / 1000);
      const wallMs = Math.round(performance.now() - wallStartedAt);
      expect(comparedKitchenRows, "the epoch repeat compared course and station rows").toBe(true);
      // The control: a fill that wrote nothing would pass every row-count comparison.
      expect([...held].filter(([, rows]) => rows === 0).map(([table]) => table)).toEqual([]);
      const unreached = (list: object, seen: Set<string>) =>
        Object.keys(list).filter((entry) => !seen.has(entry));
      expect({
        CANDIDATES: unreached(CANDIDATES, reached.candidates).filter(
          (entry) => !FROZEN_CANDIDATES.includes(entry),
        ),
        ONE_ROW: unreached(ONE_ROW, reached.oneRow),
      }).toEqual({ CANDIDATES: [], ONE_ROW: [] });
      const connection = openRaw(venueDir);
      try {
        const names = connection
          .prepare(
            "select name from sqlite_master where type = 'trigger' and name like 'products_%'",
          )
          .all()
          .map((row) => String(row.name));
        expect(names).toEqual(expect.arrayContaining(PRODUCT_TRIGGERS));
        const declared = sets.flatMap((set) =>
          set.database === "node" ? [] : (set.appendOnlyTables ?? []),
        );
        expect(declared.length, "the sets declare append-only tables").toBeGreaterThan(0);
        const installed = connection
          .prepare("select name from sqlite_master where type = 'trigger'")
          .all()
          .map((row) => String(row.name));
        expect(installed).toEqual(
          expect.arrayContaining(appendOnlyTriggers(declared).map((trigger) => trigger.name)),
        );
      } finally {
        connection.close();
      }
      console.log(
        `${watch.summary(5)}\n${held.size} tables hold rows after the last step.\n` +
          `${cuts.length + 1} steps: ${cpuMs} ms of processor time against a ${WORK_BUDGET_MS} ms work budget, ` +
          `${wallMs} ms of wall time, ${NO_PROGRESS_LIMIT_MS} ms no-progress limit.\n` +
          `Scratch directory under ${SCRATCH_PARENT}.`,
      );
    },
    TEST_BOUND_MS,
  );
});

describe("the walk past the epoch", () => {
  const parentSql =
    "CREATE TABLE `later_parent` (`id` integer PRIMARY KEY NOT NULL, `label` text NOT NULL)";
  const childSql =
    "CREATE TABLE `child` (`id` integer PRIMARY KEY NOT NULL, " +
    "`parent_id` integer NOT NULL REFERENCES `later_parent`(`id`))";
  // Fails while `later_parent` is missing, so it shows which set ran first.
  const parentTriggerSql =
    "CREATE TRIGGER `later_parent_seen` AFTER INSERT ON `later_parent` BEGIN SELECT 1; END";
  /**
   * A base set whose parent table arrives after the epoch, and a set that refers to it, passed
   * first so that running it after `base` is the walk's doing.
   */
  const a624 = (
    childWhen: number,
    requires: readonly string[] = ["base"],
    sql: readonly string[] = [childSql, parentTriggerSql],
  ): WalkSet[] => [
    {
      ...syntheticSet("dependent", [{ tag: "0000_child", when: childWhen, sql }]),
      requires,
    },
    syntheticSet("base", [
      { ...BASE, tag: "0000_baseline" },
      { tag: "0001_parent", when: 2_000, sql: [parentSql] },
    ]),
  ];
  const baseEpoch = (walkSets: readonly WalkSet[]) =>
    epochOf(walkSets.filter((set) => set.name === "base"));

  it("runs a set that first appears after the epoch at its own date, after the sets it requires", async () => {
    const walkSets = a624(2_000);
    const { held, labels, venueDir } = await walkUpgrade({
      sets: walkSets,
      epoch: baseEpoch(walkSets),
      resets: {},
    });
    expect(labels).toEqual([
      "epoch (base/0000_baseline)",
      "base/0001_parent, dependent/0000_child",
    ]);
    expect(held.get("later_parent")).toBe(2);
    expect(held.get("child")).toBe(2);
    const connection = openRaw(venueDir);
    try {
      expect(
        connection
          .prepare(
            "select count(*) as n from `child` join `later_parent` on `later_parent`.`id` = `child`.`parent_id`",
          )
          .get()?.n,
      ).toBe(2);
    } finally {
      connection.close();
    }
  });

  it("runs sets in the order given when neither requires the other, so a wrong order fails", async () => {
    const walkSets = a624(2_000, [], [parentTriggerSql]);
    const failure = await walkUpgrade({
      sets: walkSets,
      epoch: baseEpoch(walkSets),
      resets: {},
    }).then(() => "it passed", messagesOf);
    expect(failure).toContain("no such table: main.later_parent");
  });

  it("shows why: putting every set's first migration in the epoch fails on the later parent", async () => {
    const walkSets = a624(2_000, ["base"], [childSql]);
    await expect(
      walkUpgrade({
        sets: walkSets,
        epoch: baseEpoch(walkSets),
        resets: {},
        firstMigrationsInEpoch: true,
      }),
    ).rejects.toThrow("could not write child: no such table: main.later_parent");
  });

  it("refuses a foreign key to a table of a set the referring set does not require", async () => {
    const walkSets = a624(2_000, []);
    await expect(
      walkUpgrade({ sets: walkSets, epoch: baseEpoch(walkSets), resets: {} }),
    ).rejects.toThrow(
      "dependent/0000_child refers to later_parent, a table of base, which dependent does not require",
    );
  });

  it("refuses a migration that refers to a table its required set creates only later", async () => {
    const walkSets = a624(1_500);
    await expect(
      walkUpgrade({ sets: walkSets, epoch: baseEpoch(walkSets), resets: {} }),
    ).rejects.toThrow(
      "dependent/0000_child, dated 1500, refers to later_parent, which base/0001_parent creates only at 2000",
    );
  });

  it("refuses a key to a table its required set creates on the same date but runs later", () => {
    const wrongOrder = a624(2_000);
    const { journals, isEpoch } = planWalk(wrongOrder, baseEpoch(wrongOrder));
    expect(() => checkReferences(wrongOrder, journals, isEpoch)).toThrow(
      "dependent/0000_child, dated 2000, refers to later_parent, which base/0001_parent " +
        "creates on the same date but runs after it",
    );
  });

  it("credits a table that moved between sets to the set that created it last", async () => {
    const walkSets: WalkSet[] = [
      syntheticSet("base", [BASE, { tag: "0001_drop", when: 2_000, sql: ["DROP TABLE `kept`"] }]),
      syntheticSet("other", [
        {
          tag: "0000_kept",
          when: 3_000,
          sql: [
            "CREATE TABLE `kept` (`id` integer PRIMARY KEY NOT NULL, `label` text NOT NULL)",
            "CREATE TABLE `kept_child` (`id` integer PRIMARY KEY NOT NULL, " +
              "`kept_id` integer NOT NULL REFERENCES `kept`(`id`))",
          ],
        },
      ]),
    ];
    const { held } = await walkUpgrade({
      sets: walkSets,
      epoch: epochOf(walkSets.slice(0, 1)),
      resets: {},
    });
    expect(held.get("kept")).toBe(2);
    expect(held.get("kept_child")).toBe(2);
  });

  it("reads a REFERENCES after a quoted '--' as a foreign key", async () => {
    const walkSets: WalkSet[] = [
      syntheticSet("base", [BASE]),
      syntheticSet("loose", [
        {
          tag: "0000_kchild",
          when: 2_000,
          sql: [
            "CREATE TABLE `kchild` (`id` integer PRIMARY KEY NOT NULL, `note` text DEFAULT '--', " +
              "`kept_id` integer REFERENCES `kept`(`id`))",
          ],
        },
      ]),
    ];
    await expect(
      walkUpgrade({ sets: walkSets, epoch: epochOf(walkSets.slice(0, 1)), resets: {} }),
    ).rejects.toThrow(
      "loose/0000_kchild refers to kept, a table of base, which loose does not require",
    );
  });

  it("does not read a REFERENCES inside a comment as a foreign key", async () => {
    const walkSets = a624(
      2_000,
      [],
      [
        "-- once: `parent_id` integer REFERENCES `later_parent`(`id`)\n" +
          "CREATE TABLE `child` (`id` integer PRIMARY KEY NOT NULL /* REFERENCES `later_parent` */)",
      ],
    );
    const { held } = await walkUpgrade({
      sets: walkSets,
      epoch: baseEpoch(walkSets),
      resets: {},
    });
    expect(held.get("child")).toBe(2);
  });

  it("carries rows through two later steps", async () => {
    const walkSets = [
      syntheticSet("synthetic", [
        BASE,
        { tag: "0001_note", when: 2_000, sql: ["ALTER TABLE `kept` ADD `note` text"] },
        {
          tag: "0002_size",
          when: 3_000,
          sql: ["ALTER TABLE `kept` ADD `size` integer DEFAULT 1 NOT NULL"],
        },
      ]),
    ];
    const { held, labels, venueDir } = await walkUpgrade({
      sets: walkSets,
      epoch: epochOf(walkSets),
      resets: {},
    });
    expect(labels).toEqual([
      "epoch (synthetic/0000_baseline)",
      "synthetic/0001_note",
      "synthetic/0002_size",
    ]);
    expect(held.get("kept")).toBe(2);
    expect(allRows(venueDir).kept).toHaveLength(2);
  });

  it("reads an epoch file and runs a new set and a later migration of a named set at their dates", async () => {
    const walkSets: WalkSet[] = [
      syntheticSet("base", [
        BASE,
        { tag: "0001_note", when: 3_000, sql: ["ALTER TABLE `kept` ADD `note` text"] },
      ]),
      {
        ...syntheticSet("dependent", [
          {
            tag: "0000_child",
            when: 2_000,
            sql: [
              "CREATE TABLE `child` (`id` integer PRIMARY KEY NOT NULL, " +
                "`kept_id` integer NOT NULL REFERENCES `kept`(`id`))",
            ],
          },
        ]),
        requires: ["base"],
      },
    ];
    const folder = mkdtempSync(join(SCRATCH_PARENT, "wt-upgrade-epoch-file-"));
    scratch.push(folder);
    const file = join(folder, "migration-baseline-epoch.json");
    writeFileSync(file, JSON.stringify(epochOf(walkSets.slice(0, 1))));
    const { held, labels } = await walkUpgrade({
      sets: walkSets,
      epoch: readEpoch(file),
      resets: {},
    });
    expect(labels).toEqual([
      "epoch (base/0000_baseline)",
      "dependent/0000_child",
      "base/0001_note",
    ]);
    expect(held.get("kept")).toBe(2);
    expect(held.get("child")).toBe(2);
  });

  it("puts append-only triggers on a table a later step creates before writing its rows", async () => {
    const walkSets = [
      {
        ...syntheticSet("synthetic", [
          BASE,
          {
            tag: "0001_ledger",
            when: 2_000,
            sql: [
              "CREATE TABLE `ledger` (`id` integer PRIMARY KEY NOT NULL, `label` text NOT NULL)",
            ],
          },
        ]),
        appendOnlyTables: ["kept", "ledger"],
      },
    ];
    const { held, venueDir } = await walkUpgrade({
      sets: walkSets,
      epoch: epochOf(walkSets),
      resets: {},
    });
    expect(held.get("ledger")).toBe(2);
    const connection = openRaw(venueDir);
    try {
      expect(() => connection.exec("update `ledger` set `label` = 'changed'")).toThrow(
        "ledger is append-only",
      );
    } finally {
      connection.close();
    }
  });

  const rebuild = (copy: string) => [
    "CREATE TABLE `__new_kept` (`id` integer PRIMARY KEY NOT NULL, `label` text NOT NULL)",
    `INSERT INTO \`__new_kept\`(\`id\`, \`label\`) SELECT \`id\`, \`label\` FROM \`kept\`${copy}`,
    "DROP TABLE `kept`",
    "ALTER TABLE `__new_kept` RENAME TO `kept`",
  ];
  const otherTouch =
    "CREATE TRIGGER `other_touch` AFTER INSERT ON `other` BEGIN " +
    "UPDATE `kept` SET `label` = `label` WHERE 0; END";
  const keptStamp = "CREATE TRIGGER `kept_stamp` AFTER INSERT ON `kept` BEGIN SELECT 1; END";
  const TRIGGERED = {
    ...BASE,
    sql: [
      ...BASE.sql,
      "CREATE TABLE `other` (`id` integer PRIMARY KEY NOT NULL)",
      otherTouch,
      keptStamp,
    ],
  };

  it("passes a step that drops a trigger by name, in any case and quoting, or drops the trigger's table", async () => {
    const walkSets = [
      syntheticSet("synthetic", [
        TRIGGERED,
        {
          tag: "0001_later",
          when: 2_000,
          sql: ["drop trigger if exists main.[KEPT_STAMP]", "DROP TABLE `other`"],
        },
      ]),
    ];
    const { held, venueDir } = await walkUpgrade({
      sets: walkSets,
      epoch: epochOf(walkSets),
      resets: {},
    });
    expect(held.get("kept")).toBe(2);
    expect([...triggersOf(venueDir).keys()]).toEqual([]);
  });

  it.each([
    {
      failure: "row loss",
      base: BASE,
      wrong: rebuild(" WHERE `id` = (SELECT min(`id`) FROM `kept`)"),
      right: rebuild(""),
      message:
        "Step synthetic/0001_later lost rows the step before wrote:\nkept: 2 rows before, 1 after",
    },
    {
      failure: "a NOT NULL column with no default",
      base: BASE,
      wrong: ["ALTER TABLE `kept` ADD `required` text NOT NULL"],
      right: ["ALTER TABLE `kept` ADD `required` text DEFAULT 'none' NOT NULL"],
      message: "Cannot add a NOT NULL column with default value NULL",
    },
    {
      failure: "a duplicate unique value",
      base: BASE,
      wrong: ["CREATE UNIQUE INDEX `kept_label_unique` ON `kept` (`label`)"],
      right: [
        "UPDATE `kept` SET `label` = `label` || '-' || `id`",
        "CREATE UNIQUE INDEX `kept_label_unique` ON `kept` (`label`)",
      ],
      message: "UNIQUE constraint failed: kept.label",
    },
    {
      failure: "a rebuild of a table another trigger's body names",
      base: TRIGGERED,
      wrong: [...rebuild(""), keptStamp],
      right: ["DROP TRIGGER `other_touch`", ...rebuild(""), otherTouch, keptStamp],
      message: "error in trigger other_touch: no such table: main.kept",
    },
    {
      failure: "a rebuild that does not recreate its table's trigger",
      base: TRIGGERED,
      wrong: ["DROP TRIGGER `other_touch`", ...rebuild(""), otherTouch],
      right: ["DROP TRIGGER `other_touch`", ...rebuild(""), otherTouch, keptStamp],
      message:
        "Step synthetic/0001_later lost triggers on tables it kept: kept_stamp on kept; " +
        "a migration that drops a trigger on purpose says so with DROP TRIGGER",
    },
  ])(
    "fails $failure and passes the same change made safely",
    async ({ base, wrong, right, message }) => {
      const walk = (later: readonly string[]) => {
        const walkSets = [
          syntheticSet("synthetic", [base, { tag: "0001_later", when: 2_000, sql: later }]),
        ];
        return walkUpgrade({ sets: walkSets, epoch: epochOf(walkSets), resets: {} });
      };
      // A refused migration's own message is the cause of `migrations.apply_failed`.
      expect(await walk(wrong).then(() => "it passed", messagesOf)).toContain(message);
      const { held } = await walk(right);
      expect(held.get("kept")).toBe(2);
    },
  );
});

/** What a step's failure lacks against its RESETS entry, or `undefined` when it matches. */
function resetMismatch(expected: ResetExpectation, failure: unknown): string | undefined {
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
  "party_allergy_guests.allergens": ['{"milk":{}}'],
  "location_day_cutover_changes.effective_business_day": ["2026-01-01", "2026-01-02"],
  "location_day_cutover_changes.day_cutover": ["05:00:00", "07:00:00"],
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
  // The CHECK wants a bare `YYYY-MM-DD`, a shape none of the generic text values has.
  "special_dates.date": ["2026-01-01", "2026-01-02"],
  "special_day_dates.date": ["2026-01-01", "2026-01-02"],
  // Its CHECK wants a bare `MM-DD` that is not `02-29`.
  "seasons.starts_on": ["03-01", "06-01"],
};

/** {@link CANDIDATES} entries for a table no shipped migration creates, so the walk never meets them. */
const FROZEN_CANDIDATES: readonly string[] = ["special_dates.date"];

/** Tables filled with one row rather than two, each with its reason. */
const ONE_ROW: Record<string, string> = {
  sale_settlements:
    "a tender naming a settled sale is refused, so one sale stays open for the tenders",
  menu_item_variant_overrides:
    "its key is a menu item and a variant of that item's product, and the rows hold one such pair",
};

/**
 * The entries of {@link CANDIDATES} and {@link ONE_ROW} the walk reached; one it never reached
 * fails the guard. Reaching a CANDIDATES or ONE_ROW entry shows only that the walk
 * met its column or table, not that the entry is still needed.
 */
const reached = {
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

function kitchenRows(venueDir: string): [string, unknown[]][] {
  const connection = openRaw(venueDir);
  const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;
  try {
    const parents = new Set(["kitchen_courses", "kitchen_stations"]);
    const tables = connection
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all()
      .map((row) => String(row.name));
    const related = tables.filter(
      (table) =>
        parents.has(table) ||
        connection
          .prepare(`pragma foreign_key_list(${quoted(table)})`)
          .all()
          .some((key) => parents.has(String(key.table))),
    );
    expect(related).toEqual(
      expect.arrayContaining([
        "kitchen_courses",
        "kitchen_stations",
        "products",
        "ticket_items",
        "kitchen_print_jobs",
      ]),
    );
    return related.map((table) => {
      const rows = connection
        .prepare(`select * from ${quoted(table)}`)
        .all()
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      expect(rows.length, `${table}: upgrade comparison must hold rows`).toBeGreaterThan(0);
      return [table, rows];
    });
  } finally {
    connection.close();
  }
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
    // Two is the fill target's maximum; a full table needs neither schema discovery nor a write.
    const shapes = parentsFirst(
      [...now]
        .filter(([table, count]) => count < 2 || table in ONE_ROW)
        .map(([table]) => shapeOf(connection, table)),
    );
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
