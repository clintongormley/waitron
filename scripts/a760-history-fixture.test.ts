import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { historicalSet, historicalSets } from "./fixtures/a760-history/historical-set.mjs";

const repo = resolve(import.meta.dirname, "..");
const fixtureRoot = join(repo, "scripts/fixtures/a760-history");

interface FrozenSet {
  name: string;
  source: string;
  migrationsTable: string;
  entries: number;
  journalSha256: string;
  sql: Record<string, string>;
  requires: string[];
}
const manifest = JSON.parse(readFileSync(join(fixtureRoot, "manifest.json"), "utf8")) as {
  baseCommit: string;
  oldManifestSha256: string;
  sets: FrozenSet[];
};
const oldManifestPath = join(fixtureRoot, "old-migrations.manifest.json");
const oldManifest = JSON.parse(readFileSync(oldManifestPath, "utf8")) as {
  name: string;
  table: string;
  from: string;
  database?: string;
  appendOnlyTables: string[];
}[];

const sha256 = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("the frozen pre-squash migration history", () => {
  it.each(manifest.sets.map((set) => [set.name, set] as const))(
    "%s holds exactly the bytes its manifest entry hashed",
    (_name, set) => {
      const folder = join(fixtureRoot, set.name);
      expect(readdirSync(folder).sort()).toEqual([...Object.keys(set.sql), "meta"].sort());
      expect(readdirSync(join(folder, "meta"))).toEqual(["_journal.json"]);
      for (const [file, hash] of Object.entries(set.sql)) {
        expect(sha256(join(folder, file)), file).toBe(hash);
      }
      const journalPath = join(folder, "meta/_journal.json");
      expect(sha256(journalPath)).toBe(set.journalSha256);
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
        entries: { tag: string }[];
      };
      expect(journal.entries).toHaveLength(set.entries);
      expect(journal.entries.map((entry) => `${entry.tag}.sql`).sort()).toEqual(
        Object.keys(set.sql).sort(),
      );
    },
  );

  it("names every frozen folder in its manifest, and nothing else sits beside them", () => {
    expect(readdirSync(fixtureRoot).sort()).toEqual(
      [
        ...manifest.sets.map((set) => set.name),
        "README.md",
        "historical-set.d.mts",
        "historical-set.mjs",
        "manifest.json",
        "old-migrations.manifest.json",
      ].sort(),
    );
  });

  it("keeps the old migrations manifest byte for byte", () => {
    expect(sha256(oldManifestPath)).toBe(manifest.oldManifestSha256);
  });

  it("freezes every old set that had migrations, under its old journal table, in the old order", () => {
    const withHistory = oldManifest.filter((set) => set.name !== "fiscal-none");
    expect(manifest.sets.map((set) => set.name)).toEqual(withHistory.map((set) => set.name));
    for (const [index, set] of manifest.sets.entries()) {
      const old = withHistory[index]!;
      expect(set.migrationsTable, set.name).toBe(old.table);
      expect(set.source, set.name).toBe(join("packages/migrations", old.from));
    }
  });

  it("lists each set's requirements among the sets before it", () => {
    const seen = new Set<string>();
    for (const set of manifest.sets) {
      for (const required of set.requires)
        expect(seen, `${set.name} needs ${required}`).toContain(required);
      seen.add(set.name);
    }
    expect(manifest.sets.find((set) => set.name === "staffing")?.requires).toEqual([
      "core",
      "identity",
      "venue-service",
      "workforce",
    ]);
  });

  it("hands a test the whole old world, each set as the old manifest described it", () => {
    const sets = historicalSets();
    expect(sets.map((set) => set.name)).toEqual(manifest.sets.map((set) => set.name));
    for (const set of sets) {
      const old = oldManifest.find((candidate) => candidate.name === set.name)!;
      const frozen = manifest.sets.find((candidate) => candidate.name === set.name)!;
      expect(set).toEqual({
        name: old.name,
        migrationsFolder: join(fixtureRoot, old.name),
        migrationsTable: old.table,
        appendOnlyTables: old.appendOnlyTables,
        ...(old.database === undefined ? {} : { database: old.database }),
        requires: frozen.requires,
      });
    }
    expect(sets.find((set) => set.name === "node")?.database).toBe("node");
    expect(sets.find((set) => set.name === "core")?.appendOnlyTables).toContain("sales");
  });

  it("hands a test one old set by its old name", () => {
    expect(historicalSet("catalogue")).toEqual({
      name: "catalogue",
      migrationsFolder: join(fixtureRoot, "catalogue"),
      migrationsTable: "__drizzle_migrations_catalogue",
      appendOnlyTables: ["menu_versions", "menu_version_images"],
      requires: ["core"],
    });
    expect(() => historicalSet("fiscal-none")).toThrow(
      'no frozen migration history named "fiscal-none"',
    );
  });
});

describe("the frozen history never ships", () => {
  const underFixtures = (path: string): boolean => !relative(fixtureRoot, path).startsWith("..");

  it("is named by no set in the migrations manifest, which is what copy-migrations copies", () => {
    const manifestPath = join(repo, "packages/migrations/migrations.manifest.json");
    const sets = JSON.parse(readFileSync(manifestPath, "utf8")) as { from: string }[];
    const sources = sets.map((set) => resolve(repo, "packages/migrations", set.from));
    expect(sources.filter(underFixtures)).toEqual([]);

    const copier = readFileSync(join(repo, "apps/server/scripts/copy-migrations.mjs"), "utf8");
    expect(copier).toContain("cp(resolve(manifestRoot, set.from), join(target, set.name)");
    expect(copier).not.toMatch(/fixtures/);
  });

  it("is copied into the runtime image by no Dockerfile line", () => {
    const dockerfile = readFileSync(join(repo, "deploy/Dockerfile"), "utf8").replace(
      /\\\n\s*/g,
      " ",
    );
    const runtimeSources = [...dockerfile.matchAll(/^COPY --from=build \S+ (.+) \S+$/gm)].flatMap(
      (match) => match[1]!.trim().split(/\s+/),
    );
    expect(runtimeSources.length).toBeGreaterThan(0);
    expect(runtimeSources.filter((source) => source.startsWith("/src/scripts"))).toEqual([]);
    expect(dockerfile).not.toMatch(/fixtures/);
  });
});
