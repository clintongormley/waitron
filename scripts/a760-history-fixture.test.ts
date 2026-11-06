// Guards scripts/fixtures/a760-history: its bytes, its manifests, and that it never ships. Weaker
// than its name on shipping: it reads `copy-migrations.mjs` and the `COPY --from=build` lines of
// `deploy/Dockerfile` as text, and never builds the image or looks inside it.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, resolve } from "node:path";
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

/** The hash of every frozen file: each set folder, `manifest.json` and
 * `old-migrations.manifest.json`. Pinned here, not in the folder, so a changed byte needs a changed
 * line in this file, where review sees it. */
const FROZEN_TREE_SHA256 = "cf14b0e96d7212213baed1b3967d3ec09fd679c087d3537bbd606a135436119b";

function frozenTreeSha256(): string {
  const files = [
    "manifest.json",
    "old-migrations.manifest.json",
    ...manifest.sets.flatMap((set) =>
      readdirSync(join(fixtureRoot, set.name), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(fixtureRoot, join(entry.parentPath, entry.name))),
    ),
  ].sort();
  const hash = createHash("sha256");
  for (const file of files) hash.update(`${file}\0${sha256(join(fixtureRoot, file))}\n`);
  return hash.digest("hex");
}

describe("the frozen pre-squash migration history", () => {
  it("matches the hash of the whole frozen tree pinned in this file", () => {
    expect(frozenTreeSha256()).toBe(FROZEN_TREE_SHA256);
  });

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
    const sources = buildStageCopySources(readFileSync(join(repo, "deploy/Dockerfile"), "utf8"));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.filter(couldCopyFrozenHistory)).toEqual([]);
  });

  it.each([
    ["no flag before the source", "COPY --from=build /src/scripts/ /app/scripts/"],
    ["a flag before the source", "COPY --from=build --chown=waitron:waitron /src/ /app/src/"],
    ["the folder itself, unslashed", "COPY --from=build --link /src/scripts /app/scripts"],
    ["a file under it", "COPY --from=build /src/scripts/fixtures/a760-history/README.md /app/"],
    ["the build root", "COPY --from=build / /app/"],
    ["a later source on a continued line", "COPY --from=build \\\n  /src/apps/ \\\n  /src /app/"],
    ["a source given as JSON", 'COPY --from=build ["/src/scripts", "/app/scripts"]'],
    ["a pattern that reaches it", "COPY --from=build /src/s*/ /app/"],
    ["a relative source", "COPY --from=build scripts /app/scripts"],
    ["a variable", "COPY --from=build $SOURCE /app/"],
  ])("refuses a copy from the build stage with %s", (_case, line) => {
    expect(
      buildStageCopySources(`FROM node AS runtime\n${line}\n`).filter(couldCopyFrozenHistory),
    ).not.toEqual([]);
  });

  it("allows a build-stage copy beside the scripts folder", () => {
    const sources = buildStageCopySources(
      "COPY --from=build --chown=waitron:waitron /src/scripts-other/ /src/apps/s*/dist/ /app/\n" +
        "COPY --from=litestream /src/scripts/ /app/\n",
    );
    expect(sources).toEqual(["/src/scripts-other/", "/src/apps/s*/dist/"]);
    expect(sources.filter(couldCopyFrozenHistory)).toEqual([]);
  });
});

/** Every source path of every `COPY --from=build` instruction, whatever flags come before it. */
function buildStageCopySources(dockerfile: string): string[] {
  return dockerfile
    .replace(/\\\n/g, " ")
    .split("\n")
    .flatMap((line) => {
      const words = line.trim().split(/\s+/);
      if (words[0]?.toUpperCase() !== "COPY") return [];
      let first = 1;
      while (words[first]?.startsWith("--")) first += 1;
      if (!words.slice(1, first).includes("--from=build")) return [];
      const rest = words.slice(first).join(" ");
      const paths = rest.startsWith("[") ? (JSON.parse(rest) as string[]) : words.slice(first);
      return paths.slice(0, -1);
    });
}

/** Whether a copy of `source` from the build stage (whose folder is `/src`) could carry
 * `/src/scripts` or anything in it. A relative or variable source is refused unread. */
function couldCopyFrozenHistory(source: string): boolean {
  if (!source.startsWith("/") || source.includes("$")) return true;
  const glob = source.search(/[*?[]/);
  const fixed = posix.normalize(glob === -1 ? source : source.slice(0, glob));
  const scripts = "/src/scripts";
  if (glob !== -1) return `${scripts}/`.startsWith(fixed) || fixed.startsWith(scripts);
  const path = fixed.replace(/\/+$/, "") || "/";
  return (
    path === scripts ||
    path.startsWith(`${scripts}/`) ||
    scripts.startsWith(`${path}/`) ||
    path === "/"
  );
}
