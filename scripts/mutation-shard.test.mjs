import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  assignShards,
  HEAVY_FILES,
  missingHeavyFiles,
  mutateFiles,
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

const f = (path, size) => ({ path, size });
const weightOf = (files) => (shard) =>
  shard.reduce((sum, path) => sum + files.find((x) => x.path === path).size, 0);

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
    expect(mutateFiles(dir, ["!src/b.ts", "src/**/*.ts"])).toContain("src/b.ts");
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
      "src/test-helpers.ts",
    ]);
  });
});

describe("HEAVY_FILES", () => {
  it("splits db's sales schema in three and ui's combobox, data table and dialog", () => {
    expect(HEAVY_FILES).toEqual({
      db: { "src/schema/sales.ts": 3 },
      ui: {
        "src/components/wt-combobox.ts": 4,
        "src/components/wt-data-table.ts": 12,
        "src/components/wt-dialog.ts": 6,
      },
    });
  });

  it("names, for each package, a heavy file the selection no longer holds", () => {
    expect(missingHeavyFiles({ "src/gone.ts": 2, "src/here.ts": 2 }, ["src/here.ts"])).toEqual([
      "src/gone.ts",
    ]);
    for (const pkg of ["db", "ui"]) {
      const config = JSON.parse(readFileSync(join(packageDir(pkg), "stryker.config.json"), "utf8"));
      expect(
        missingHeavyFiles(HEAVY_FILES[pkg], mutateFiles(packageDir(pkg), config.mutate)),
      ).toEqual([]);
    }
  });
});

describe("shardFiles", () => {
  it("refuses a package it has no heavy-file list for", () => {
    expect(() => shardFilesOf("nope", 1, 1, root)).toThrow(/unknown package "nope"/);
  });

  it("refuses when a heavy file has been renamed or removed", () => {
    const dir = fixturePackage(["packages/db/src/a.ts"]);
    writeFileSync(
      join(dir, "packages", "db", "stryker.config.json"),
      JSON.stringify({ mutate: ["src/**/*.ts"] }),
    );
    expect(() => shardFilesOf("db", 1, 1, dir)).toThrow(
      /HEAVY_FILES names "src\/schema\/sales.ts".*renamed or removed/,
    );
  });

  it("splits a heavy file into line ranges over distinct shards", () => {
    const dir = fixturePackage(
      ["packages/db/src/schema/sales.ts", "packages/db/src/a.ts"],
      "line\n".repeat(98),
    );
    writeFileSync(
      join(dir, "packages", "db", "stryker.config.json"),
      JSON.stringify({ mutate: ["src/**/*.ts"] }),
    );
    writeFileSync(join(dir, "packages", "db", "src", "a.ts"), "export const a = 1;\n");
    const shards = [1, 2, 3, 4].map((shard) => shardFilesOf("db", shard, 4, dir));
    expect(shards.slice(0, 3).map((s) => s.filter((p) => p.includes(":")))).toEqual([
      ["src/schema/sales.ts:1-33"],
      ["src/schema/sales.ts:34-66"],
      ["src/schema/sales.ts:67-99"],
    ]);
    expect(shards.flat()).toContain("src/a.ts");
  });

  /**
   * A db fixture: `sales.ts`, 99 lines in 495 bytes (three ranges of 33), beside `others`, each
   * 600 bytes, so a packer weighing by bytes would place them first and the ranges beside them.
   */
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

  it("gives each heavy range a shard of its own and packs the other files into the rest", () => {
    const others = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"];
    const dir = dbFixture(others);
    const shards = [1, 2, 3, 4, 5, 6].map((shard) => shardFilesOf("db", shard, 6, dir));
    expect(shards.slice(0, 3)).toEqual([
      ["src/schema/sales.ts:1-33"],
      ["src/schema/sales.ts:34-66"],
      ["src/schema/sales.ts:67-99"],
    ]);
    expect(shards.slice(3)).toEqual([
      ["src/a.ts", "src/d.ts"],
      ["src/b.ts", "src/e.ts"],
      ["src/c.ts"],
    ]);
  });

  it("gives every range of every heavy file a shard of its own, files by path, ranges by line", () => {
    const heavy = Object.keys(HEAVY_FILES.ui);
    const dir = fixturePackage(
      heavy.map((path) => `packages/ui/${path}`),
      "line\n".repeat(119),
    );
    for (const path of ["src/a.ts", "src/b.ts"])
      writeFileSync(join(dir, "packages", "ui", path), "export const a = 1;\n");
    writeFileSync(
      join(dir, "packages", "ui", "stryker.config.json"),
      JSON.stringify({ mutate: ["src/**/*.ts"] }),
    );
    const ranges = heavy.sort().flatMap((path) => splitRanges(path, 120, HEAVY_FILES.ui[path]));
    expect(ranges).toHaveLength(22);
    const total = ranges.length + 2;
    const shards = Array.from({ length: total }, (_, i) => shardFilesOf("ui", i + 1, total, dir));
    expect(shards).toEqual([...ranges.map((range) => [range]), ["src/a.ts"], ["src/b.ts"]]);
  });

  it("refuses a shard count that cannot hold the heavy ranges plus the other files", () => {
    const dir = dbFixture(["src/a.ts"]);
    expect(() => shardFilesOf("db", 1, 3, dir)).toThrow(
      /3 shards cannot hold the 3 heavy ranges plus the other files — raise the shard count/,
    );
    expect(() => shardFilesOf("db", 1, 2, dir)).toThrow(/2 shards cannot hold the 3 heavy ranges/);
    expect(shardFilesOf("db", 4, 4, dir)).toEqual(["src/a.ts"]);
  });
});

/**
 * The length of the `shard: [...]` matrix list in mutation.yml's `mutation-<pkg>` job, which is
 * the `strategy.job-total` the job hands the sharder as its total.
 */
function workflowShardCount(pkg) {
  const workflow = readFileSync(join(root, ".github", "workflows", "mutation.yml"), "utf8");
  const start = workflow.indexOf(`\n  mutation-${pkg}:\n`);
  expect(start, `no \`mutation-${pkg}\` job in mutation.yml`).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const end = rest.slice(1).search(/\n {2}\S/);
  const job = end === -1 ? rest : rest.slice(0, end + 1);
  const list = /^ {8}shard:\s*\[([^\]]*)\]/m.exec(job);
  expect(list, `no inline \`shard:\` list in \`mutation-${pkg}\``).not.toBeNull();
  return list[1].split(",").filter((entry) => entry.trim() !== "").length;
}

for (const pkg of ["db", "ui"]) {
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
    // Derive the shard count from the LIVE slice count (at one shard past db's three ranges, the
    // last shard holds every other file) rather than hard-coding it — `@waitron/db` grows, and a
    // fixed number silently stops exceeding the slice count once it does. One more shard than there
    // are slices guarantees the HIGHEST-index shard is empty (greedy packs slices into the
    // lowest-index shards), so requesting it must fail loudly, never print an empty --mutate list
    // that would make stryker a confusing no-op.
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
