import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";
import { mutationCallers } from "./mutation-workflow.mjs";

import {
  assignShards,
  fileWeights,
  HEAVY_FILES,
  missingHeavyFiles,
  mutateFiles,
  packageSelection,
  shardFiles as shardFilesOf,
  splitRanges,
} from "./mutation-shard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const packageDir = (pkg) => join(root, "packages", pkg);

/** Every `.ts` file under a package's `src/` that is not a test, as `src/`-relative paths. */
function eligibleFiles(pkg = "db") {
  const src = join(packageDir(pkg), "src");
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
        out.push(join("src", relative(src, full)));
    }
  };
  walk(src);
  return out.sort();
}

function shardFiles(shard, total, pkg = "db") {
  const r = spawnSync(
    "node",
    [join(here, "mutation-shard.mjs"), pkg, String(shard), String(total)],
    { encoding: "utf8" },
  );
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  const line = r.stdout.trim();
  return line === "" ? [] : line.split(",");
}

const temporaryRoots = [];
afterAll(() => {
  for (const dir of temporaryRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A package directory holding the given `src/`-relative files, each with `content`. */
function fixturePackage(files, content = "export const x = 1;\n") {
  const dir = mkdtempSync(join(tmpdir(), "mutation-shard-"));
  temporaryRoots.push(dir);
  for (const path of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const f = (path, weight) => ({ path, weight });
const weightOf = (files) => (shard) =>
  shard.reduce((sum, path) => sum + files.find((x) => x.path === path).weight, 0);

describe("assignShards", () => {
  it("places every file in exactly one shard", () => {
    const files = [f("a", 1), f("b", 1), f("c", 1), f("d", 1), f("e", 1)];
    const shards = assignShards(files, 2);
    expect(shards.flat().sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("returns exactly totalShards groups, even when some are empty", () => {
    const shards = assignShards([f("a", 1), f("b", 1)], 5);
    expect(shards).toHaveLength(5);
    expect(shards.filter((s) => s.length === 0)).toHaveLength(3);
    expect(shards.flat().sort()).toEqual(["a", "b"]);
  });

  it("balances total file weight greedily, not round-robin", () => {
    // sizes 5,4,3,3,3 (total 18) into 2 shards: greedy → {8,10}; index round-robin → {11,7}.
    const files = [f("a", 5), f("b", 4), f("c", 3), f("d", 3), f("e", 3)];
    const shards = assignShards(files, 2);
    const weights = shards.map(weightOf(files)).sort((x, y) => x - y);
    expect(weights).toEqual([8, 10]);
  });

  it("is deterministic across calls", () => {
    const files = [f("a", 5), f("b", 4), f("c", 3), f("d", 2), f("e", 1)];
    expect(assignShards(files, 3)).toEqual(assignShards(files, 3));
  });

  it("puts every file in the one shard when totalShards is 1", () => {
    expect(assignShards([f("a", 1), f("b", 2)], 1)).toEqual([["a", "b"]]);
  });
});

describe("fileWeights", () => {
  const sized = (path, size) => ({ path, size });

  it("weighs every file by its bytes when the package has no cost table", () => {
    expect(fileWeights([sized("a", 600), sized("b", 20)], undefined)).toEqual([
      f("a", 600),
      f("b", 20),
    ]);
  });

  it("weighs a file the table names by its seconds, whatever its bytes", () => {
    expect(fileWeights([sized("a", 600), sized("b", 20)], { a: 3, b: 90 })).toEqual([
      f("a", 3),
      f("b", 90),
    ]);
  });

  it("weighs a file the table does not name by its bytes at the named files' seconds per byte", () => {
    // 50 + 150 seconds over 100 + 200 bytes: two thirds of a second per byte.
    const weights = fileWeights([sized("a", 100), sized("b", 200), sized("c", 30)], {
      a: 50,
      b: 150,
    });
    expect(weights[2].path).toBe("c");
    expect(weights[2].weight).toBeCloseTo(20);
  });

  it("falls back to bytes when the table names none of the files", () => {
    expect(fileWeights([sized("a", 600)], { gone: 9 })).toEqual([f("a", 600)]);
  });

  for (const bad of ["3", 0, -1, Number.NaN, Number.POSITIVE_INFINITY, null]) {
    it(`refuses a table that gives a file it weighs ${String(bad)} seconds, naming the file and the table`, () => {
      expect(() =>
        fileWeights([sized("a", 600), sized("b", 20)], { a: 3, b: bad }, "pkg/mutation-costs.json"),
      ).toThrow(
        /pkg\/mutation-costs\.json gives "b" .*; every cost must be a number of seconds above zero/,
      );
    });
  }

  it("ignores a bad value for a file it does not weigh", () => {
    expect(fileWeights([sized("a", 600)], { a: 3, gone: 0 }, "t.json")).toEqual([f("a", 3)]);
  });
});

describe("splitRanges", () => {
  it("splits a file into equal contiguous Stryker mutation-range slices", () => {
    expect(splitRanges("src/schema/sales.ts", 180, 3)).toEqual([
      "src/schema/sales.ts:1-60",
      "src/schema/sales.ts:61-120",
      "src/schema/sales.ts:121-180",
    ]);
  });

  it("covers every line exactly once with no gaps or overlaps when it doesn't divide evenly", () => {
    const parts = splitRanges("x.ts", 100, 3).map((r) => r.replace("x.ts:", ""));
    const bounds = parts.map((p) => p.split("-").map(Number));
    expect(bounds[0][0]).toBe(1);
    expect(bounds.at(-1)[1]).toBe(100);
    for (let i = 1; i < bounds.length; i++) expect(bounds[i][0]).toBe(bounds[i - 1][1] + 1);
    const sizes = bounds.map(([s, e]) => e - s + 1);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(sizes.reduce((a, b) => a + b)).toBe(100);
  });

  it("returns the whole file as one range when parts is 1", () => {
    expect(splitRanges("x.ts", 42, 1)).toEqual(["x.ts:1-42"]);
  });
});

describe("mutateFiles", () => {
  it("keeps a file a positive pattern matches and no negation removes", () => {
    const dir = fixturePackage(["src/a.ts", "src/deep/b.ts", "src/a.test.ts", "src/notes.md"]);
    expect(mutateFiles(dir, ["src/**/*.ts", "!src/**/*.test.ts"])).toEqual([
      "src/a.ts",
      "src/deep/b.ts",
    ]);
  });

  it("honours a negation written as a glob, not only a plain path", () => {
    const dir = fixturePackage(["src/a.ts", "src/deep/x-one.ts", "src/x-two.ts", "src/y-x.ts"]);
    expect(mutateFiles(dir, ["src/**/*.ts", "!src/**/x-*.ts"])).toEqual(["src/a.ts", "src/y-x.ts"]);
  });

  it("honours a negation written as a plain path", () => {
    const dir = fixturePackage(["src/a.ts", "src/helpers.ts", "src/deep/helpers.ts"]);
    expect(mutateFiles(dir, ["src/**/*.ts", "!src/helpers.ts"])).toEqual([
      "src/a.ts",
      "src/deep/helpers.ts",
    ]);
  });

  it("keeps only what a positive pattern narrower than src/** selects", () => {
    const dir = fixturePackage(["src/a.ts", "src/components/b.ts", "src/components/deep/c.ts"]);
    expect(mutateFiles(dir, ["src/components/*.ts"])).toEqual(["src/components/b.ts"]);
  });

  it("selects nothing when there is no positive pattern", () => {
    const dir = fixturePackage(["src/a.ts"]);
    expect(mutateFiles(dir, ["!src/b.ts"])).toEqual([]);
  });

  // Stryker 10.0.0's ProjectReader applies the list in order: a later positive pattern puts back
  // what an earlier `!` took out.
  it("applies the patterns in order, so a later positive pattern re-includes an excluded file", () => {
    const dir = fixturePackage(["src/a.ts", "src/b.ts", "src/deep/x-one.ts", "src/x-two.ts"]);
    expect(mutateFiles(dir, ["src/**/*.ts", "!src/b.ts", "src/b.ts"])).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/deep/x-one.ts",
      "src/x-two.ts",
    ]);
    expect(mutateFiles(dir, ["!src/b.ts", "src/**/*.ts"])).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/deep/x-one.ts",
      "src/x-two.ts",
    ]);
    expect(mutateFiles(dir, ["src/**/*.ts", "!src/**/x-*.ts", "src/deep/x-one.ts"])).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/deep/x-one.ts",
    ]);
  });

  it("applies the patterns in order, so an exclusion after an inclusion still excludes", () => {
    const dir = fixturePackage(["src/a.ts", "src/b.ts", "src/deep/x-one.ts", "src/x-two.ts"]);
    expect(mutateFiles(dir, ["src/**/*.ts", "src/b.ts", "!src/b.ts"])).toEqual([
      "src/a.ts",
      "src/deep/x-one.ts",
      "src/x-two.ts",
    ]);
    expect(mutateFiles(dir, ["src/deep/x-one.ts", "src/**/*.ts", "!src/**/x-*.ts"])).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });
});

describe("the selection follows each package's own stryker config", () => {
  const configOf = (pkg) =>
    JSON.parse(readFileSync(join(packageDir(pkg), "stryker.config.json"), "utf8"));

  it("leaves out exactly src/english-only.ts of db's non-test .ts files", () => {
    // `src/english-only.ts`'s suite is `scripts/english-only.test.ts` in the ROOT project, so
    // packages/db's own run cannot kill a single one of its mutants.
    const selected = mutateFiles(packageDir("db"), configOf("db").mutate);
    expect(eligibleFiles("db").filter((path) => !selected.includes(path))).toEqual([
      "src/english-only.ts",
    ]);
  });

  it("leaves out exactly ui's test-helper files of its non-test .ts files", () => {
    const selected = mutateFiles(packageDir("ui"), configOf("ui").mutate);
    expect(eligibleFiles("ui").filter((path) => !selected.includes(path))).toEqual([
      "src/a11y-helpers.ts",
      "src/icon-button-test-helpers.ts",
      "src/test-helpers.ts",
    ]);
  });

  it("leaves out exactly ui-core's test-helper files of its non-test .ts files", () => {
    const selected = mutateFiles(packageDir("ui-core"), configOf("ui-core").mutate);
    expect(eligibleFiles("ui-core").filter((path) => !selected.includes(path))).toEqual([
      "src/a11y-helpers.ts",
      "src/test-helpers.ts",
      "src/tokens/token-test-helpers.ts",
      "src/vitest-park-pointer.ts",
    ]);
  });
});

describe("HEAVY_FILES", () => {
  it("splits ui's large components, keeping db, ui-core and shared whole", () => {
    expect(HEAVY_FILES).toEqual({
      db: {},
      ui: {
        "src/components/wt-combobox.ts": 4,
        "src/components/wt-data-table.ts": 12,
        "src/components/wt-dialog.ts": 6,
      },
      "ui-core": {},
      shared: {},
    });
  });

  it("names, for each package, a heavy file the selection no longer holds", () => {
    expect(missingHeavyFiles({ "src/gone.ts": 2, "src/here.ts": 2 }, ["src/here.ts"])).toEqual([
      "src/gone.ts",
    ]);
    for (const pkg of mutationCallers(
      readFileSync(join(root, ".github/workflows/mutation.yml"), "utf8"),
    ).map((caller) => caller.package)) {
      const config = JSON.parse(readFileSync(join(packageDir(pkg), "stryker.config.json"), "utf8"));
      expect(
        missingHeavyFiles(HEAVY_FILES[pkg], mutateFiles(packageDir(pkg), config.mutate)),
      ).toEqual([]);
    }
  });
});

describe("shardFiles", () => {
  it("packs db sales whole exactly once alongside the other whole files", () => {
    const all = Array.from({ length: 13 }, (_, i) => shardFilesOf("db", i + 1, 13, root)).flat();
    expect(all.filter((path) => path.startsWith("src/schema/sales.ts"))).toEqual([
      "src/schema/sales.ts",
    ]);
  });

  it("partitions every shared mutation target into four nonempty whole-file shards", () => {
    const shards = [1, 2, 3, 4].map((shard) => shardFilesOf("shared", shard, 4, root));
    expect(shards.every((paths) => paths.length > 0)).toBe(true);
    expect(shards.flat().some((path) => path.includes(":"))).toBe(false);
    expect(shards.flat().sort()).toEqual(eligibleFiles("shared"));
  });

  it("refuses a package it has no heavy-file list for", () => {
    expect(() => shardFilesOf("nope", 1, 1, root)).toThrow(/unknown package "nope"/);
  });

  it("refuses when a heavy file has been renamed or removed", () => {
    const dir = fixturePackage(["packages/ui/src/a.ts"]);
    writeFileSync(
      join(dir, "packages/ui/stryker.config.json"),
      JSON.stringify({ mutate: ["src/**/*.ts"] }),
    );
    expect(() => shardFilesOf("ui", 1, 1, dir)).toThrow(
      /HEAVY_FILES names "src\/components\/wt-combobox.ts".*renamed or removed/,
    );
  });

  function dbFixture(others) {
    const dir = fixturePackage(["packages/db/src/schema/sales.ts"], "line\n".repeat(98));
    for (const path of others) {
      mkdirSync(dirname(join(dir, "packages", "db", path)), { recursive: true });
      writeFileSync(join(dir, "packages", "db", path), "export const a = 1;\n".repeat(30));
    }
    writeFileSync(
      join(dir, "packages", "db", "stryker.config.json"),
      JSON.stringify({ mutate: ["src/**/*.ts"] }),
    );
    return dir;
  }

  it("gives every range of every heavy file a shard of its own, files by path, ranges by line", () => {
    const heavy = Object.keys(HEAVY_FILES.ui);
    const dir = fixturePackage(
      heavy.map((path) => `packages/ui/${path}`),
      "line\n".repeat(119),
    );
    for (const path of ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"])
      writeFileSync(join(dir, "packages", "ui", path), "export const a = 1;\n");
    writeFileSync(
      join(dir, "packages", "ui", "stryker.config.json"),
      JSON.stringify({ mutate: ["src/**/*.ts"] }),
    );
    const ranges = heavy.sort().flatMap((path) => splitRanges(path, 120, HEAVY_FILES.ui[path]));
    expect(ranges).toHaveLength(22);
    const total = ranges.length + 3;
    const shards = Array.from({ length: total }, (_, i) => shardFilesOf("ui", i + 1, total, dir));
    expect(shards).toEqual([
      ...ranges.map((range) => [range]),
      ["src/a.ts", "src/d.ts"],
      ["src/b.ts", "src/e.ts"],
      ["src/c.ts"],
    ]);
  });

  it("packs by the package's cost table, so a small costly file gets a shard to itself", () => {
    const others = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"];
    const dir = dbFixture(others);
    writeFileSync(
      join(dir, "packages", "db", "mutation-costs.json"),
      JSON.stringify({
        "src/a.ts": 1,
        "src/b.ts": 1,
        "src/c.ts": 1,
        "src/d.ts": 1,
        "src/e.ts": 100,
        "src/schema/sales.ts": 1,
      }),
    );
    const shards = [1, 2, 3].map((shard) => shardFilesOf("db", shard, 3, dir));
    expect(shards).toEqual([
      ["src/e.ts"],
      ["src/a.ts", "src/c.ts", "src/schema/sales.ts"],
      ["src/b.ts", "src/d.ts"],
    ]);
  });

  it("refuses a cost table that gives a file zero seconds, naming the table", () => {
    const dir = dbFixture(["src/a.ts", "src/b.ts"]);
    const tablePath = join(dir, "packages", "db", "mutation-costs.json");
    writeFileSync(tablePath, JSON.stringify({ "src/a.ts": 1, "src/b.ts": 0 }));
    expect(() => shardFilesOf("db", 4, 5, dir)).toThrow(
      `${tablePath} gives "src/b.ts" 0 seconds; every cost must be a number of seconds above zero`,
    );
  });

  it("refuses a shard count that cannot hold the heavy ranges plus the other files", () => {
    const heavy = Object.keys(HEAVY_FILES.ui);
    const dir = fixturePackage(
      heavy.map((path) => `packages/ui/${path}`),
      "line\n".repeat(119),
    );
    writeFileSync(join(dir, "packages/ui/src/a.ts"), "export const a = 1;\n");
    writeFileSync(
      join(dir, "packages/ui/stryker.config.json"),
      JSON.stringify({ mutate: ["src/**/*.ts"] }),
    );
    expect(() => shardFilesOf("ui", 1, 22, dir)).toThrow(
      /22 shards cannot hold the 22 heavy ranges plus the other files/,
    );
    expect(() => shardFilesOf("ui", 1, 21, dir)).toThrow(
      /21 shards cannot hold the 22 heavy ranges/,
    );
    expect(shardFilesOf("ui", 23, 23, dir)).toEqual(["src/a.ts"]);
  });
});

function workflowShardCount(pkg) {
  const workflow = readFileSync(join(root, ".github", "workflows", "mutation.yml"), "utf8");
  const caller = mutationCallers(workflow).find((candidate) => candidate.package === pkg);
  expect(caller, `no mutation caller for ${pkg}`).toBeDefined();
  return caller.shards.length;
}

for (const pkg of mutationCallers(
  readFileSync(join(root, ".github/workflows/mutation.yml"), "utf8"),
).map((caller) => caller.package)) {
  describe(`the CLI over the real @waitron/${pkg} tree at the workflow's shard count`, () => {
    const heavy = HEAVY_FILES[pkg];
    const fileOf = (entry) => entry.replace(/:\d+-\d+$/, "");
    const isRange = (entry) => /:\d+-\d+$/.test(entry);
    const rangeCount = Object.values(heavy).reduce((sum, parts) => sum + parts, 0);
    let shards;
    const shardsOf = () => {
      if (shards === undefined) {
        const total = workflowShardCount(pkg);
        shards = Array.from({ length: total }, (_, i) => shardFiles(i + 1, total, pkg));
      }
      return shards;
    };

    it("fills every shard", () => {
      expect(shardsOf().filter((shard) => shard.length === 0)).toEqual([]);
    });

    it("covers every mutate-eligible file exactly once — whole, or as ranges for a split file", () => {
      const config = JSON.parse(readFileSync(join(packageDir(pkg), "stryker.config.json"), "utf8"));
      const collected = shardsOf().flat();
      expect([...new Set(collected.map(fileOf))].sort()).toEqual(
        mutateFiles(packageDir(pkg), config.mutate),
      );
      const wholes = collected.filter((e) => !isRange(e));
      expect(new Set(wholes).size).toBe(wholes.length);
      expect(wholes.filter((e) => Object.hasOwn(heavy, e))).toEqual([]);
      const ranges = collected.filter(isRange);
      expect([...new Set(ranges.map(fileOf))].sort()).toEqual(Object.keys(heavy).sort());
      expect(ranges).toHaveLength(rangeCount);
    });

    it("gives each heavy range a shard of its own", () => {
      const withRange = shardsOf().filter((shard) => shard.some(isRange));
      expect(withRange).toHaveLength(rangeCount);
      for (const shard of withRange) expect(shard).toHaveLength(1);
    });

    it("emits src/-relative .ts paths (optionally line-ranged) a stryker run can consume", () => {
      const files = shardsOf().flat();
      expect(files.every((p) => /^src\/.+\.ts(:\d+-\d+)?$/.test(p))).toBe(true);
      expect(files.some((p) => p.includes(".test.ts"))).toBe(false);
    });
  });
}

describe("db's committed cost table", () => {
  const tablePath = join(packageDir("db"), "mutation-costs.json");

  it("exists, so db's shards are packed by estimated seconds rather than bytes", () => {
    expect(existsSync(tablePath)).toBe(true);
  });

  it("holds a positive number of seconds for src/-relative files, none of them split", () => {
    const table = JSON.parse(readFileSync(tablePath, "utf8"));
    const entries = Object.entries(table);
    expect(entries.length).toBeGreaterThan(0);
    for (const [path, seconds] of entries) {
      expect(path).toMatch(/^src\/.+\.ts$/);
      expect(Object.hasOwn(HEAVY_FILES.db, path)).toBe(false);
      expect(typeof seconds === "number" && seconds > 0).toBe(true);
    }
  });

  it("names only files db's stryker config still mutates, so a rename or deletion fails here", () => {
    const table = JSON.parse(readFileSync(tablePath, "utf8"));
    const selected = packageSelection("db").paths;
    expect(Object.keys(table).filter((path) => !selected.includes(path))).toEqual([]);
  });
});

describe("the CLI leaves out a db file whose only suite is in another vitest project", () => {
  it("never lists src/english-only.ts in any shard", () => {
    // `src/english-only.ts` is imported by `scripts/english-only.test.ts` in the ROOT project and by
    // nothing under `packages/db`, so this package's own run cannot kill a single one of its
    // mutants.
    const total = 6;
    const collected = [];
    for (let shard = 1; shard <= total; shard++) collected.push(...shardFiles(shard, total));

    expect(collected.map((e) => e.replace(/:\d+-\d+$/, ""))).not.toContain("src/english-only.ts");
  });
});

describe("the CLI rejects bad input loudly", () => {
  const run = (...args) =>
    spawnSync("node", [join(here, "mutation-shard.mjs"), ...args], { encoding: "utf8" });

  it("fails with a clear message (not a TypeError) when the shard index is out of range", () => {
    const r = run("db", "7", "6");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/shard/i);
    expect(r.stderr).not.toMatch(/TypeError/);
    expect(r.stdout.trim()).toBe("");
  });

  it("fails when a shard would select no files (more shards than slices)", () => {
    const ranges = Object.values(HEAVY_FILES.db).reduce((sum, parts) => sum + parts, 0);
    const slices = shardFiles(ranges + 1, ranges + 1).length + ranges;
    const n = String(slices + 1);
    const r = run("db", n, n);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/no files/i);
    expect(r.stdout.trim()).toBe("");
  });

  it("fails on a non-integer shard count", () => {
    const r = run("db", "1", "abc");
    expect(r.status).not.toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("fails with a message naming the package when the package is unknown", () => {
    const r = run("nope", "1", "1");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/unknown package "nope"/);
    expect(r.stdout.trim()).toBe("");
  });
});
