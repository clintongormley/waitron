import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import { manifestCopySets } from "./copies.js";
import { createdObject, significantTokens } from "../protection-list/sql-tokens.js";

export interface RebuildSet {
  readonly name: string;
  readonly folder: string;
  readonly packageDir: string;
}
export interface GenerateInput {
  readonly packageDir: string;
  readonly configPath: string;
  readonly outDir: string;
}
export interface GenerateRun {
  status: number | null;
  signal: string | null;
  error: string | undefined;
  stdout: string;
  stderr: string;
}
export type Generate = (input: GenerateInput) => Promise<GenerateRun>;
export interface RebuildOptions {
  readonly set: RebuildSet;
  readonly epochFile?: string;
  readonly generate?: Generate;
  readonly mode?: "write" | "check";
}
export interface RebuildResult {
  readonly outcome: "rebuilt" | "unchanged" | "epoch-only";
  readonly differences: readonly string[];
  readonly when: number | null;
  readonly sha256: string | null;
}
interface Journal {
  entries: { idx: number; tag: string; when: number }[];
}
interface Snapshot {
  id: string;
  prevId: string;
  tables: unknown;
}
interface Epoch {
  entries: { name: string; when: number; sha256: string }[];
  emptySets: string[];
}
export const EPOCH_FILE = join(
  import.meta.dirname,
  "../../../../scripts/migration-baseline-epoch.json",
);
const read = (file: string): string => readFileSync(file, "utf8");
const parse = <T>(file: string): T => JSON.parse(read(file)) as T;
const digest = (text: string): string => createHash("sha256").update(text).digest("hex");
function filesUnder(dir: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => relative(dir, join(e.parentPath, e.name)))
        .sort()
    : [];
}
export function rebuildSets(): RebuildSet[] {
  return manifestCopySets().map((set) => ({ ...set, packageDir: dirname(set.folder) }));
}
export function triggerFileFor(set: Pick<RebuildSet, "name" | "packageDir">): string {
  return join(set.packageDir, "triggers", `${set.name}.sql`);
}
export function splitStatements(sql: string): string[] {
  return sql.split("--> statement-breakpoint").map((s) => s.trim());
}
export function readTriggers(file: string): string | null {
  if (!existsSync(file)) return null;
  const text = read(file).trimEnd();
  if (!text) throw new Error(`${file} holds no CREATE TRIGGER`);
  const names = new Set<string>();
  for (const [i, statement] of splitStatements(text).entries()) {
    if (!statement) throw new Error(`${file}: statement ${i + 1} is empty`);
    const object = createdObject(statement);
    if (object?.kind !== "trigger")
      throw new Error(`${file}: statement ${i + 1} is not a CREATE TRIGGER`);
    const tokens = significantTokens(statement);
    const end = tokens.findIndex(
      (token, index) =>
        token.kind === "word" &&
        token.text.toUpperCase() === "END" &&
        tokens[index - 1]?.text === ";",
    );
    const afterEnd = end + (tokens[end + 1]?.text === ";" ? 2 : 1);
    if (end < 0 || afterEnd !== tokens.length)
      throw new Error(
        `${file}: statement ${i + 1} holds SQL after its complete CREATE TRIGGER; add a statement-breakpoint`,
      );
    if (names.has(object.name)) throw new Error(`${file}: ${object.name} defined twice`);
    names.add(object.name);
  }
  return text;
}
export function folderProblems(files: readonly string[], populated: boolean): string[] {
  const allowed = [
    "meta/_journal.json",
    ...(populated ? ["0000_baseline.sql", "meta/0000_snapshot.json"] : []),
  ];
  return [
    ...files
      .filter((file) => !allowed.includes(file))
      .map(
        (file) =>
          `drizzle/${file} is not the starting migration; a rebuild would delete it. Move hand-written SQL to triggers/<set>.sql.`,
      ),
    ...allowed.filter((file) => !files.includes(file)).map((file) => `drizzle/${file} is missing`),
  ];
}
export function assembleBaseline(generated: string, triggers: string | null): string {
  return triggers === null ? generated : `${generated}\n--> statement-breakpoint\n${triggers}`;
}
export function generationFailure(run: GenerateRun): string | undefined {
  if (
    run.status === 0 &&
    ["No schema changes, nothing to migrate", "Your SQL migration file"].some((marker) =>
      run.stdout.includes(marker),
    )
  )
    return undefined;
  return `drizzle-kit generate did not report finishing: status ${String(run.status)}, signal ${String(run.signal)}, ${run.error ?? ""}\n${run.stdout}\n${run.stderr}`;
}
export function nextWhen(generated: number, previous: readonly number[]): number {
  return Math.max(generated, ...previous.map((n) => n + 1));
}
export function updateEpochText(text: string, name: string, when: number, sha256: string): string {
  const original = JSON.parse(text) as Epoch;
  const expected = structuredClone(original);
  const entry = expected.entries.find((e) => e.name === name);
  if (entry === undefined) throw new Error(`${name} has no entry in the epoch`);
  entry.when = when;
  entry.sha256 = sha256;
  const result = text.replace(/\{[^{}]*\}/g, (block) => {
    const candidate = JSON.parse(block) as { name?: string };
    return candidate.name === name
      ? block
          .replace(/("when"\s*:\s*)\d+/, `$1${when}`)
          .replace(/("sha256"\s*:\s*)"[^"]*"/, `$1"${sha256}"`)
      : block;
  });
  if (!isDeepStrictEqual(JSON.parse(result), expected))
    throw new Error(`${name}: epoch update changed other values`);
  return result;
}
const execFileAsync = promisify(execFile);
export const runDrizzleKit: Generate = async ({ packageDir, configPath }) => {
  try {
    const { stdout, stderr } = await execFileAsync(
      join(packageDir, "node_modules/.bin/drizzle-kit"),
      ["generate", "--config", configPath, "--name", "baseline"],
      { cwd: packageDir, encoding: "utf8", timeout: 300_000 },
    );
    return { status: 0, signal: null, error: undefined, stdout, stderr };
  } catch (thrown) {
    const error = thrown as Error & {
      code?: number | string;
      signal?: string;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: typeof error.code === "number" ? error.code : null,
      signal: error.signal ?? null,
      error: error.message,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
};
function withoutId(snapshot: Snapshot): unknown {
  const rest: Partial<Snapshot> = { ...snapshot };
  delete rest.id;
  return rest;
}

export async function rebuildBaseline({
  set,
  epochFile = EPOCH_FILE,
  generate = runDrizzleKit,
  mode = "write",
}: RebuildOptions): Promise<RebuildResult> {
  const epochText = read(epochFile),
    epoch = JSON.parse(epochText) as Epoch;
  const entry = epoch.entries.find((e) => e.name === set.name),
    populated = entry !== undefined;
  if (!populated && !epoch.emptySets.includes(set.name))
    throw new Error(`${set.name} has no entry in the epoch`);
  const problems = folderProblems(filesUnder(set.folder), populated);
  if (problems.length) throw new Error(`${set.name}: ${problems.join("\n")}`);
  const oldJournal = parse<Journal>(join(set.folder, "meta/_journal.json"));
  if (oldJournal.entries.length !== (populated ? 1 : 0))
    throw new Error(`${set.name}: journal holds more than the starting migration`);
  const triggerFile = triggerFileFor(set);
  const unexpected = filesUnder(dirname(triggerFile)).filter((file) => file !== `${set.name}.sql`);
  if (unexpected.length)
    throw new Error(`${set.name}: unexpected file in triggers/: ${unexpected.join(", ")}`);
  const triggers = readTriggers(triggerFile);
  if (!populated && triggers !== null)
    throw new Error(`${set.name}: empty set cannot hold trigger SQL`);
  const scratch = mkdtempSync(join(tmpdir(), "wt-rebuild-")),
    outDir = join(scratch, "drizzle"),
    configPath = join(scratch, "drizzle.config.ts");
  try {
    writeFileSync(
      configPath,
      `import base from ${JSON.stringify(join(set.packageDir, "drizzle.config.ts"))};\nexport default { ...base, out: ${JSON.stringify(relative(set.packageDir, outDir))} };\n`,
    );
    const run = await generate({ packageDir: set.packageDir, configPath, outDir });
    const failure = generationFailure(run);
    if (failure !== undefined) throw new Error(failure);
    const generatedFiles = filesUnder(outDir),
      hasSQL = generatedFiles.includes("0000_baseline.sql");
    if (populated && !hasSQL) throw new Error(`${set.name}: generated nothing`);
    if (!populated && hasSQL) throw new Error(`${set.name}: empty epoch set declares tables`);
    const generatedProblems = folderProblems(generatedFiles, populated);
    if (generatedProblems.length) throw new Error(`${set.name}: ${generatedProblems.join("\n")}`);
    const generatedJournal = parse<Journal>(join(outDir, "meta/_journal.json"));
    const normalJournal = (j: Journal) => ({
      ...j,
      entries: j.entries.map((e) => ({ ...e, when: 0 })),
    });
    const journalChanged = !isDeepStrictEqual(
      normalJournal(oldJournal),
      normalJournal(generatedJournal),
    );
    if (!populated) {
      if (journalChanged && mode === "write")
        writeFileSync(
          join(set.folder, "meta/_journal.json"),
          read(join(outDir, "meta/_journal.json")),
        );
      return {
        outcome: journalChanged ? "rebuilt" : "unchanged",
        differences: journalChanged ? ["meta/_journal.json differs"] : [],
        when: null,
        sha256: null,
      };
    }
    const sql = assembleBaseline(read(join(outDir, "0000_baseline.sql")), triggers),
      sha256 = digest(sql);
    const differences: string[] = [];
    if (sql !== read(join(set.folder, "0000_baseline.sql")))
      differences.push("0000_baseline.sql differs");
    if (
      !isDeepStrictEqual(
        withoutId(parse<Snapshot>(join(outDir, "meta/0000_snapshot.json"))),
        withoutId(parse<Snapshot>(join(set.folder, "meta/0000_snapshot.json"))),
      )
    )
      differences.push("meta/0000_snapshot.json differs");
    if (journalChanged) differences.push("meta/_journal.json differs");
    const rebuild = differences.length > 0;
    const oldWhen = oldJournal.entries[0]?.when;
    if (oldWhen === undefined) throw new Error(`${set.name}: missing starting journal entry`);
    if (entry?.when !== oldWhen) differences.push("epoch when differs");
    if (entry?.sha256 !== sha256) differences.push("epoch sha256 differs");
    const generatedWhen = generatedJournal.entries[0]?.when;
    if (generatedWhen === undefined)
      throw new Error(`${set.name}: generated journal has no starting entry`);
    const when = rebuild
      ? nextWhen(
          generatedWhen,
          oldJournal.entries.map((e) => e.when),
        )
      : oldWhen;
    const outcome = rebuild ? "rebuilt" : differences.length ? "epoch-only" : "unchanged";
    if (mode === "write" && outcome !== "unchanged") {
      const updatedEpoch = updateEpochText(epochText, set.name, when, sha256);
      if (rebuild) {
        const contents = new Map(
          filesUnder(set.folder).map((file) => [file, read(join(set.folder, file))]),
        );
        try {
          for (const file of contents.keys()) rmSync(join(set.folder, file));
          writeFileSync(join(set.folder, "0000_baseline.sql"), sql);
          writeFileSync(
            join(set.folder, "meta/0000_snapshot.json"),
            read(join(outDir, "meta/0000_snapshot.json")),
          );
          writeFileSync(
            join(set.folder, "meta/_journal.json"),
            read(join(outDir, "meta/_journal.json")).replace(/("when"\s*:\s*)\d+/, `$1${when}`),
          );
          writeFileSync(epochFile, updatedEpoch);
        } catch (error) {
          for (const file of filesUnder(set.folder)) rmSync(join(set.folder, file));
          for (const [file, text] of contents) {
            mkdirSync(dirname(join(set.folder, file)), { recursive: true });
            writeFileSync(join(set.folder, file), text);
          }
          writeFileSync(epochFile, epochText);
          throw error;
        }
      } else writeFileSync(epochFile, updatedEpoch);
    }
    return { outcome, differences, when, sha256 };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
