import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { headSnapshot, migrationSets } from "../packages/sync-enrolment/src/migration-tables.js";

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
 *    `generate` diffs. A hand-written migration (`*_sql.sql`, a custom migration) does not change
 *    the snapshot, so a constraint added or dropped by hand is invisible here, and a `.sql` file
 *    edited after it was generated is too.
 * 2. **It passes only `dialect`, `schema` and `out` to drizzle-kit.** The config is loaded and its
 *    keys pinned to the set known today, so an option that would change what `generate` emits
 *    (`casing`, say) fails the key check and forces this file to be revisited rather than being
 *    silently dropped.
 * 3. **It trusts drizzle-kit's own diff.** Whatever drizzle-kit does not model, this does not see.
 *
 * `--out` is a path RELATIVE to the package: measured 2026-09-23 on drizzle-kit v0.31.10, an
 * absolute `--out` fails because drizzle-kit prefixes `./` and gets ENOENT on `.//tmp/...`.
 */

const repoRoot = join(import.meta.dirname, "..");

/** The keys every `drizzle.config.ts` in the tree sets, as read on 2026-09-23. */
const KNOWN_CONFIG_KEYS = ["dialect", "migrations", "out", "schema"];

/**
 * Measured 2026-09-23: all thirteen sets regenerated one after another in 7s, about half a second
 * each. The spawn limit is far above that; the per-test bound clears the spawn limit plus the copy
 * and the comparison around it.
 */
const GENERATE_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 60_000;

interface DrizzleConfig {
  dialect: string;
  schema: string;
  out: string;
}

let scratch = "";
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "migrations-match-schema-"));
});
afterAll(() => {
  if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
});

/** Every file under `dir`, relative to it and sorted. */
function filesUnder(dir: string): string[] {
  const walk = (at: string): string[] =>
    readdirSync(at).flatMap((entry) => {
      const full = join(at, entry);
      return statSync(full).isDirectory() ? walk(full) : [relative(dir, full)];
    });
  return walk(dir).sort();
}

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

/** The package's drizzle config, loaded as code rather than read as text. */
async function loadConfig(packageDir: string): Promise<Record<string, unknown>> {
  const path = join(packageDir, "drizzle.config.ts");
  const loaded = (await import(pathToFileURL(path).href)) as { default: Record<string, unknown> };
  return loaded.default;
}

/** Runs `drizzle-kit generate` for a package, writing into `outDir` instead of its own set. */
function generate(packageDir: string, config: DrizzleConfig, outDir: string) {
  const bin = join(packageDir, "node_modules", ".bin", "drizzle-kit");
  const args = ["generate", "--dialect", config.dialect, "--schema", config.schema];
  args.push("--out", relative(packageDir, outDir));
  return spawnSync(bin, args, {
    cwd: packageDir,
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
  // Vacuous-pass anchor: a discovery that matched nothing would run no case below and pass.
  it("checks the real sets", () => {
    expect(sets.length).toBeGreaterThanOrEqual(13);
    expect(sets).toContain(join("packages", "db", "drizzle"));
    expect(sets).toContain(join("packages", "fiscal-verifactu", "drizzle"));
  });

  it.each(sets)(
    "%s: drizzle-kit generate changes nothing",
    async (set) => {
      const packageDir = join(repoRoot, dirname(set));
      const configPath = join(packageDir, "drizzle.config.ts");
      const bin = join(packageDir, "node_modules", ".bin", "drizzle-kit");
      expect(existsSync(configPath), `${set}: no drizzle.config.ts beside it`).toBe(true);
      expect(existsSync(bin), `${set}: no node_modules/.bin/drizzle-kit in its package`).toBe(true);

      const config = await loadConfig(packageDir);
      expect(Object.keys(config).sort(), `${set}: drizzle.config.ts keys`).toEqual(
        KNOWN_CONFIG_KEYS,
      );
      expect(typeof config.dialect).toBe("string");
      expect(typeof config.schema).toBe("string");
      expect(typeof config.out).toBe("string");
      expect(resolve(packageDir, config.out as string), `${set}: config's out`).toBe(
        join(repoRoot, set),
      );

      const copy = join(scratch, set.replaceAll("/", "__"));
      cpSync(join(repoRoot, set), copy, { recursive: true });
      const run = generate(packageDir, config as unknown as DrizzleConfig, copy);
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
      const packageDir = join(repoRoot, dirname(set));
      const config = (await loadConfig(packageDir)) as unknown as DrizzleConfig;
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

      const run = generate(packageDir, config, copy);
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
  const packageDir = join(repoRoot, dirname(set));

  it(
    "is refused when the schema module throws at import",
    async () => {
      const config = (await loadConfig(packageDir)) as unknown as DrizzleConfig;
      const copy = join(scratch, "control-throws");
      cpSync(join(repoRoot, set), copy, { recursive: true });
      const throwing = join(scratch, "throwing-schema.ts");
      writeFileSync(throwing, 'throw new Error("negative control: schema import failed");\n');

      const run = generate(packageDir, { ...config, schema: relative(packageDir, throwing) }, copy);
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
      const config = (await loadConfig(packageDir)) as unknown as DrizzleConfig;
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

      const run = generate(packageDir, config, copy);
      expect(differences(edited, copy)).toEqual([]);
      expect(generationFailure(run) ?? "accepted as finished").toContain(
        "Interactive prompts require a TTY",
      );
    },
    TEST_TIMEOUT_MS,
  );
});
