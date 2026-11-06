// Lists every protection the migrations build, or compares two such lists.
//
// Usage: pnpm --filter @waitron/server exec tsx scripts/protection-list/cli.ts list --out <absolute dir> [--migration-root <absolute dir>] [--path descriptor|manifest]
//        pnpm --filter @waitron/server exec tsx scripts/protection-list/cli.ts compare --old <absolute dir> --new <absolute dir> --report <absolute file>
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchemaListFile, PATHS, type SetPath } from "./build.js";
import {
  compareSchemaLists,
  formatDifferences,
  type SchemaListEntry,
  type SchemaListFile,
} from "./compare.js";

export const LIST_FILE = "protection-list.json";
export const SUMMARY_FILE = "summary.txt";

const USAGE =
  "Usage: list --out <absolute dir> [--migration-root <absolute dir>] [--path descriptor|manifest]\n" +
  "       compare --old <absolute dir> --new <absolute dir> --report <absolute file>";

const BOOKKEEPING_PREFIX = "__drizzle_migrations_";

const KINDS = [
  "tables",
  "views",
  "explicit indexes",
  "implicit indexes",
  "CHECKs",
  "foreign keys",
  "triggers",
] as const;
type Kind = (typeof KINDS)[number];
type Counts = Record<Kind, number>;

function flags(args: readonly string[], allowed: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index] ?? "";
    const value = args[index + 1];
    if (!allowed.includes(name) || value === undefined || found.has(name)) {
      throw new Error(USAGE);
    }
    found.set(name, value);
  }
  return found;
}

function required(found: Map<string, string>, name: string): string {
  const value = found.get(name);
  if (value === undefined) throw new Error(USAGE);
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path: ${value}`);
  return value;
}

function emptyCounts(): Counts {
  return Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Counts;
}

/** Counts each entry's protections, in total and by the set that created them. */
function countsOf(entry: SchemaListEntry): { total: Counts; bySet: Map<string, Counts> } {
  const total = emptyCounts();
  const bySet = new Map<string, Counts>();
  const add = (kind: Kind, owner: string | undefined, amount = 1) => {
    total[kind] += amount;
    const key = owner ?? "(unknown)";
    const counts = bySet.get(key) ?? emptyCounts();
    counts[kind] += amount;
    bySet.set(key, counts);
  };
  const tableOwner = (table: string) => entry.owningSet[`table ${table}`];
  for (const table of entry.schema.tables) {
    if (table.name.startsWith(BOOKKEEPING_PREFIX)) continue;
    add("tables", tableOwner(table.name));
    add("CHECKs", tableOwner(table.name), table.checks.length);
    add("foreign keys", tableOwner(table.name), table.foreignKeys.length);
  }
  for (const view of entry.schema.views) add("views", entry.owningSet[`view ${view.name}`]);
  for (const index of entry.schema.indexes) {
    if (index.table.startsWith(BOOKKEEPING_PREFIX)) continue;
    add(
      index.origin === "c" ? "explicit indexes" : "implicit indexes",
      entry.owningSet[`index ${index.name}`] ?? tableOwner(index.table),
    );
  }
  for (const trigger of entry.schema.triggers) {
    if (trigger.table.startsWith(BOOKKEEPING_PREFIX)) continue;
    add("triggers", entry.owningSet[`trigger ${trigger.name}`]);
  }
  return { total, bySet };
}

const line = (label: string, counts: Counts) =>
  `${label}: ${KINDS.map((kind) => `${counts[kind]} ${kind}`).join(", ")}`;

export function summaryOf(file: SchemaListFile): string {
  const out: string[] = [];
  for (const entry of file.entries) {
    const { total, bySet } = countsOf(entry);
    out.push(
      `composition=${entry.composition} phase=${entry.phase} database=${entry.database}`,
      line("  total", total),
    );
    const order = [
      ...entry.setOrder,
      ...[...bySet.keys()].filter((key) => !entry.setOrder.includes(key)),
    ];
    for (const set of order) {
      const counts = bySet.get(set);
      if (counts !== undefined) out.push(line(`  ${set}`, counts));
    }
    const rows = Object.entries(entry.bookkeepingRows);
    if (rows.length > 0) {
      out.push(`  journal rows: ${rows.map(([set, count]) => `${set} ${count}`).join(", ")}`);
    }
    out.push("");
  }
  return out.join("\n");
}

async function list(args: readonly string[], print: (text: string) => void): Promise<number> {
  const found = flags(args, ["--out", "--migration-root", "--path"]);
  const out = required(found, "--out");
  const path = found.get("--path") ?? "descriptor";
  if (!(PATHS as readonly string[]).includes(path)) {
    throw new Error(`--path must be descriptor or manifest: ${path}`);
  }
  const root = found.get("--migration-root");
  if (root !== undefined && !isAbsolute(root)) {
    throw new Error(`--migration-root must be an absolute path: ${root}`);
  }
  if (existsSync(out) && readdirSync(out).length > 0) throw new Error(`${out} is not empty`);
  mkdirSync(out, { recursive: true });
  const file = await buildSchemaListFile({
    migrationRoot: root ?? null,
    workDir: join(out, "databases"),
    path: path as SetPath,
  });
  writeFileSync(join(out, LIST_FILE), `${JSON.stringify(file, null, 2)}\n`);
  const summary = summaryOf(file);
  writeFileSync(join(out, SUMMARY_FILE), summary);
  print(summary);
  return 0;
}

function readList(dir: string): SchemaListFile {
  return JSON.parse(readFileSync(join(dir, LIST_FILE), "utf8")) as SchemaListFile;
}

function compare(args: readonly string[], print: (text: string) => void): number {
  const found = flags(args, ["--old", "--new", "--report"]);
  const differences = compareSchemaLists(
    readList(required(found, "--old")),
    readList(required(found, "--new")),
  );
  const report = formatDifferences(differences);
  writeFileSync(required(found, "--report"), `${report}\n`);
  print(report);
  return differences.length === 0 ? 0 : 1;
}

/** Answers the process exit status; a refusal throws. */
export async function runCli(
  argv: readonly string[],
  print: (text: string) => void,
): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "list") return list(rest, print);
  if (command === "compare") return compare(rest, print);
  throw new Error(USAGE);
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  runCli(process.argv.slice(2), (text) => console.log(text)).then(
    (status) => {
      process.exitCode = status;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 2;
    },
  );
}
