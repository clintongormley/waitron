import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { filesUnder } from "../packages/sync-enrolment/src/testing/migration-sets.js";
import {
  EPOCH_FILE,
  folderProblems,
  generationFailure,
  rebuildBaseline,
  rebuildSets,
  runDrizzleKit,
  type RebuildSet,
} from "../apps/server/scripts/migration-baseline/rebuild.js";

// Weaker than its name: trusts drizzle-kit and the epoch, does not execute triggers, and does
// not see SQL installed by code at migration or start. behavioural-triggers checks trigger writes.
const sets = rebuildSets();
const epoch = JSON.parse(readFileSync(EPOCH_FILE, "utf8")) as { entries: { name: string }[] };
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
function copy(name: string) {
  const source = sets.find((set) => set.name === name);
  if (source === undefined) throw new Error(`No ${name} set`);
  const root = mkdtempSync(join(tmpdir(), "wt-starting-control-"));
  scratch.push(root);
  const set: RebuildSet = { ...source, folder: join(root, "drizzle") };
  cpSync(source.folder, set.folder, { recursive: true });
  const epochFile = join(root, "epoch.json");
  cpSync(EPOCH_FILE, epochFile);
  return { root, set, epochFile };
}
const text = (file: string) => readFileSync(file, "utf8");
const bytes = (folder: string) =>
  filesUnder(folder).map((file) => [file, text(join(folder, file))]);
function config(root: string, set: RebuildSet, outDir: string, schema?: string) {
  const path = join(root, "drizzle.config.ts");
  writeFileSync(
    path,
    `import base from ${JSON.stringify(join(set.packageDir, "drizzle.config.ts"))};\nexport default { ...base, out: ${JSON.stringify(relative(set.packageDir, outDir))}${schema === undefined ? "" : `, schema: ${JSON.stringify(relative(set.packageDir, schema))}`} };\n`,
  );
  return { packageDir: set.packageDir, configPath: path, outDir };
}

describe("starting migrations", () => {
  it("every set holds one starting migration and nothing else", () => {
    expect(sets).toHaveLength(8);
    for (const set of sets)
      expect(
        folderProblems(
          filesUnder(set.folder),
          epoch.entries.some((entry) => entry.name === set.name),
        ),
        set.name,
      ).toEqual([]);
  });
  it.concurrent.for(sets)(
    "$name: a rebuild would change nothing",
    async (set, { expect }) => {
      const result = await rebuildBaseline({ set, mode: "check" });
      expect(
        result.outcome,
        `${result.differences.join("\n")}\nRun migration-baseline rebuild --set ${set.name}`,
      ).toBe("unchanged");
    },
    330_000,
  );
  it("refuses an additional migration in a copy", () => {
    const { set } = copy("bookings");
    writeFileSync(join(set.folder, "0001_x.sql"), "SELECT 1;");
    expect(folderProblems(filesUnder(set.folder), true)).toEqual([
      expect.stringContaining("drizzle/0001_x.sql is not the starting migration"),
    ]);
  });
  it.concurrent(
    "detects a byte appended to SQL in a copy",
    async () => {
      const f = copy("bookings"),
        path = join(f.set.folder, "0000_baseline.sql");
      writeFileSync(path, text(path) + " ");
      const before = bytes(f.set.folder);
      const result = await rebuildBaseline({ ...f, mode: "check" });
      expect(result.outcome).not.toBe("unchanged");
      expect(result.differences).toContain("0000_baseline.sql differs");
      expect(bytes(f.set.folder)).toEqual(before);
    },
    330_000,
  );
  it.concurrent(
    "detects a snapshot that lacks a table the schema declares",
    async () => {
      const f = copy("workforce"),
        path = join(f.set.folder, "meta/0000_snapshot.json");
      const snapshot = JSON.parse(text(path));
      expect(snapshot.tables).toHaveProperty("shifts");
      delete snapshot.tables.shifts;
      writeFileSync(path, JSON.stringify(snapshot));
      const result = await rebuildBaseline({ ...f, mode: "check" });
      expect(result.differences).toContain("meta/0000_snapshot.json differs");
    },
    330_000,
  );
  it.concurrent(
    "refuses a schema module that throws at import",
    async () => {
      const f = copy("bookings"),
        schema = join(f.root, "throwing-schema.ts");
      writeFileSync(schema, 'throw new Error("negative control: schema import failed");');
      const outDir = join(f.root, "empty");
      const run = await runDrizzleKit(config(f.root, f.set, outDir, schema));
      expect(generationFailure(run) ?? "accepted as finished").toContain(
        "negative control: schema import failed",
      );
      expect(bytes(f.set.folder)).toEqual(
        bytes(sets.find((set) => set.name === "bookings")!.folder),
      );
    },
    330_000,
  );
  it.concurrent(
    "refuses drizzle-kit stopping to ask about a rename",
    async () => {
      const f = copy("bookings"),
        path = join(f.set.folder, "meta/0000_snapshot.json");
      const snapshot = JSON.parse(text(path)),
        columns = snapshot.tables.bookings.columns;
      expect(columns).toHaveProperty("booking_time");
      columns.booking_time_before = { ...columns.booking_time, name: "booking_time_before" };
      delete columns.booking_time;
      writeFileSync(path, JSON.stringify(snapshot));
      const before = bytes(f.set.folder);
      const run = await runDrizzleKit(config(f.root, f.set, f.set.folder));
      expect(generationFailure(run) ?? "accepted as finished").toContain(
        "Interactive prompts require a TTY",
      );
      expect(bytes(f.set.folder)).toEqual(before);
    },
    330_000,
  );
});
