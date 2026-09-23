import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  filesUnder,
  headSnapshot,
  migrationSets,
} from "../packages/sync-enrolment/src/testing/migration-sets.js";

/**
 * Every migration set is what `drizzle-kit generate` would produce from its package's TypeScript
 * schema today: regenerating into a copy of the set changes nothing.
 *
 * Without this, a schema edit committed without its migration — a column, an index, a foreign key —
 * reaches no database, and the guards that read drizzle's snapshots
 * (`two-file-foreign-keys.test.ts`, `no-tenant-column.test.ts`) judge the snapshot while the
 * TypeScript says something else.
 *
 * WEAKER THAN ITS NAME, in the ways a reader would otherwise assume away:
 *
 * 1. **It compares the TypeScript schema with the head SNAPSHOT, never with the SQL.** That is what
 *    `generate` diffs. A hand-written migration (a `drizzle-kit generate --custom` migration) does
 *    not change the snapshot, so a constraint added or dropped by hand is invisible here, and a
 *    `.sql` file edited after it was generated is too.
 * 2. **It trusts drizzle-kit's own diff.** Whatever drizzle-kit does not model, this does not see.
 *
 * drizzle-kit reads a throwaway config that spreads the package's own and replaces only `out`, so
 * every option the package sets reaches `generate`. `out` is a path RELATIVE to the package:
 * measured 2026-09-23 on drizzle-kit v0.31.10, an absolute one fails because drizzle-kit prefixes
 * `./` and gets ENOENT on `.//tmp/...` — and exits 0, which `generationFailure` refuses.
 */

const repoRoot = join(import.meta.dirname, "..");

/**
 * Measured 2026-09-23: one set regenerates in about half a second. The spawn limit is far above
 * that; the per-test bound clears the spawn limit plus the copy and the comparison around it.
 */
const GENERATE_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 60_000;

let scratch = "";
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "migrations-match-schema-"));
});
afterAll(() => {
  if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
});

/** What differs between two directory trees, file by file. Empty when they are byte-identical. */
function differences(before: string, after: string): string[] {
  const was = new Set(filesUnder(before));
  const now = new Set(filesUnder(after));
  const out: string[] = [];
  for (const file of now) {
    if (!was.has(file)) out.push(`new: ${file}`);
    else if (!readFileSync(join(before, file)).equals(readFileSync(join(after, file)))) {
      out.push(`changed: ${file}`);
    }
  }
  for (const file of was) if (!now.has(file)) out.push(`removed: ${file}`);
  return out.sort();
}

/** The package that owns a migration set: its folder, its drizzle-kit and its config file. */
interface DrizzlePackage {
  dir: string;
  bin: string;
  configPath: string;
}

/**
 * The package that owns `set`, after checking it can regenerate that set: it has a
 * `drizzle.config.ts` and its own drizzle-kit, and the config — loaded as code, not read as text —
 * writes to `set` itself, so the copy compared below is a copy of what `generate` would change.
 */
async function drizzlePackage(set: string): Promise<DrizzlePackage> {
  const dir = join(repoRoot, dirname(set));
  const configPath = join(dir, "drizzle.config.ts");
  const bin = join(dir, "node_modules", ".bin", "drizzle-kit");
  if (!existsSync(configPath)) throw new Error(`${set}: no drizzle.config.ts beside it`);
  if (!existsSync(bin)) throw new Error(`${set}: no node_modules/.bin/drizzle-kit in its package`);
  const loaded = (await import(pathToFileURL(configPath).href)) as { default: { out?: unknown } };
  const { out } = loaded.default;
  if (typeof out !== "string" || resolve(dir, out) !== join(repoRoot, set)) {
    throw new Error(`${set}: drizzle.config.ts's out is ${String(out)}, not this set`);
  }
  return { dir, bin, configPath };
}

/**
 * Runs `drizzle-kit generate` for a package, writing into `outDir` instead of its own set. The
 * config drizzle-kit reads is the package's own with `out` replaced, and with `overrides` on top.
 */
function generate(
  pkg: DrizzlePackage,
  outDir: string,
  name: string,
  overrides: Record<string, string> = {},
) {
  const configPath = join(scratch, `${name}.drizzle.config.ts`);
  const replaced = { out: relative(pkg.dir, outDir), ...overrides };
  writeFileSync(
    configPath,
    `import base from ${JSON.stringify(pkg.configPath)};\n` +
      `export default { ...base, ...${JSON.stringify(replaced)} };\n`,
  );
  return spawnSync(pkg.bin, ["generate", "--config", configPath], {
    cwd: pkg.dir,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: GENERATE_TIMEOUT_MS,
  });
}

/** A readable account of a run, for an assertion message. */
function describeRun(run: ReturnType<typeof generate>): string {
  return (
    `status ${String(run.status)}, signal ${String(run.signal)}` +
    (run.error === undefined ? "" : `, ${run.error.message}`) +
    `\n--- stdout\n${run.stdout}\n--- stderr\n${run.stderr}`
  );
}

/**
 * What drizzle-kit v0.31.10 prints when `generate` reaches the end: the first when the schema
 * matches the head snapshot, the second when it wrote a migration (`writeResult` in its `bin.cjs`).
 *
 * The exit status alone is not evidence. Measured 2026-09-23: a schema module that throws at import,
 * and a column rename (which makes drizzle-kit ask an interactive question and fail with
 * `Interactive prompts require a TTY terminal`), each printed the error, exited 0 and left the copy
 * untouched, so a check reading the status and the files passed both.
 */
const COMPLETED = ["No schema changes, nothing to migrate", "Your SQL migration file"];

/** Why a run does not count as a completed generation, or `undefined` when it does. */
function generationFailure(run: ReturnType<typeof generate>): string | undefined {
  if (run.status === 0 && COMPLETED.some((marker) => run.stdout.includes(marker))) return undefined;
  return `drizzle-kit generate did not report finishing (${COMPLETED.join(" / ")}): ${describeRun(run)}`;
}

const sets = migrationSets(repoRoot);

describe("every migration set matches its package's TypeScript schema", () => {
  // Vacuous-pass anchor: a discovery that matched nothing would run no case below and pass. The
  // floor sits below today's tree so retiring a set does not fail it; the two names stop an empty
  // or mis-pathed discovery.
  it("checks the real sets", () => {
    expect(sets.length).toBeGreaterThan(5);
    expect(sets).toContain(join("packages", "db", "drizzle"));
    expect(sets).toContain(join("packages", "fiscal-verifactu", "drizzle"));
  });

  it.each(sets)(
    "%s: drizzle-kit generate changes nothing",
    async (set) => {
      const pkg = await drizzlePackage(set);
      const copy = join(scratch, set.replaceAll("/", "__"));
      cpSync(join(repoRoot, set), copy, { recursive: true });
      const run = generate(pkg, copy, set.replaceAll("/", "__"));
      expect(generationFailure(run), set).toBeUndefined();
      expect(
        differences(join(repoRoot, set), copy),
        `${set}: the committed migrations do not match the TypeScript schema — run ` +
          `\`drizzle-kit generate\` in ${dirname(set)}. What regenerating produced`,
      ).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});

/**
 * The cases above assert that nothing changed, which passes just as well when the detector cannot
 * see a change. This one takes a real set, removes a table from its head snapshot, and requires
 * `generate` to write a new migration for it.
 */
describe("negative control", () => {
  it(
    "writes a new migration when the snapshot lacks a table the schema declares",
    async () => {
      const set = join("packages", "identity", "drizzle");
      const pkg = await drizzlePackage(set);
      const copy = join(scratch, "control");
      cpSync(join(repoRoot, set), copy, { recursive: true });

      const head = headSnapshot(repoRoot, set);
      if (head.kind !== "file") throw new Error(`${set}: no head snapshot (${head.kind})`);
      const snapshotPath = join(copy, relative(set, head.path));
      const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
        tables: Record<string, unknown>;
      };
      expect(snapshot.tables).toHaveProperty("persons");
      delete snapshot.tables.persons;
      writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

      const run = generate(pkg, copy, "control");
      expect(generationFailure(run)).toBeUndefined();
      const found = differences(join(repoRoot, set), copy);
      expect(found.some((line) => /^new: [^/]+\.sql$/.test(line))).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});

/**
 * A generation that fails without saying so must still fail the check. Both cases run on a copy of
 * a set other than identity's, so the committed tree is never touched: one points drizzle-kit at a
 * throwaway schema module that throws at import, the other renames a column in the copy's head
 * snapshot, which makes drizzle-kit ask whether the column was renamed. Each run leaves the copy as
 * it found it, which is why the file comparison alone cannot see them.
 */
describe("negative control: a generation that did not finish", () => {
  const set = join("packages", "bookings", "drizzle");

  it(
    "is refused when the schema module throws at import",
    async () => {
      const pkg = await drizzlePackage(set);
      const copy = join(scratch, "control-throws");
      cpSync(join(repoRoot, set), copy, { recursive: true });
      const throwing = join(scratch, "throwing-schema.ts");
      writeFileSync(throwing, 'throw new Error("negative control: schema import failed");\n');

      const run = generate(pkg, copy, "control-throws", { schema: relative(pkg.dir, throwing) });
      expect(differences(join(repoRoot, set), copy)).toEqual([]);
      expect(generationFailure(run) ?? "accepted as finished").toContain(
        "negative control: schema import failed",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "is refused when drizzle-kit stops to ask whether a column was renamed",
    async () => {
      const pkg = await drizzlePackage(set);
      const copy = join(scratch, "control-prompt");
      cpSync(join(repoRoot, set), copy, { recursive: true });

      const head = headSnapshot(repoRoot, set);
      if (head.kind !== "file") throw new Error(`${set}: no head snapshot (${head.kind})`);
      const snapshotPath = join(copy, relative(set, head.path));
      const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
        tables: Record<string, { columns: Record<string, { name: string }> }>;
      };
      const columns = snapshot.tables.bookings?.columns;
      const column = columns?.booking_time;
      if (columns === undefined || column === undefined) {
        throw new Error(`${set}: head snapshot has no bookings.booking_time column`);
      }
      delete columns.booking_time;
      columns.booking_time_before = { ...column, name: "booking_time_before" };
      writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
      const edited = join(scratch, "control-prompt-edited");
      cpSync(copy, edited, { recursive: true });

      const run = generate(pkg, copy, "control-prompt");
      expect(differences(edited, copy)).toEqual([]);
      expect(generationFailure(run) ?? "accepted as finished").toContain(
        "Interactive prompts require a TTY",
      );
    },
    TEST_TIMEOUT_MS,
  );
});
