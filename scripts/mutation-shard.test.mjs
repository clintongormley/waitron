import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assignShards, splitRanges } from "./mutation-shard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dbSrc = join(here, "..", "packages", "db", "src");

/** Every mutate-eligible db file (*.ts minus *.test.ts), as `src/`-relative paths, sorted. */
function eligibleFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
        out.push(join("src", relative(dbSrc, full)));
    }
  };
  walk(dbSrc);
  return out.sort();
}

function shardFiles(shard, total) {
  const r = spawnSync("node", [join(here, "mutation-shard.mjs"), String(shard), String(total)], {
    encoding: "utf8",
  });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  const line = r.stdout.trim();
  return line === "" ? [] : line.split(",");
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
    expect(bounds[0][0]).toBe(1); // starts at line 1
    expect(bounds.at(-1)[1]).toBe(100); // ends at the last line
    for (let i = 1; i < bounds.length; i++) expect(bounds[i][0]).toBe(bounds[i - 1][1] + 1); // contiguous
    const sizes = bounds.map(([s, e]) => e - s + 1);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1); // balanced
    expect(sizes.reduce((a, b) => a + b)).toBe(100); // whole file
  });

  it("returns the whole file as one range when parts is 1", () => {
    expect(splitRanges("x.ts", 42, 1)).toEqual(["x.ts:1-42"]);
  });
});

describe("the CLI over the real @waitron/db tree", () => {
  const fileOf = (entry) => entry.replace(/:\d+-\d+$/, ""); // strip a `:startLine-endLine` range

  it("covers every mutate-eligible file exactly once — whole, or as ranges for a split file", () => {
    const total = 6;
    const collected = [];
    for (let shard = 1; shard <= total; shard++) collected.push(...shardFiles(shard, total));

    expect([...new Set(collected.map(fileOf))].sort()).toEqual(eligibleFiles()); // every file covered

    const ranges = collected.filter((e) => /:\d+-\d+$/.test(e));
    const wholes = collected.filter((e) => !/:\d+-\d+$/.test(e));
    expect(new Set(wholes).size).toBe(wholes.length); // no whole file duplicated
    expect([...new Set(ranges.map(fileOf))]).toEqual(["src/schema/sales.ts"]); // only sales is split
    expect(ranges).toHaveLength(3); // into 3 ranges
    expect([...new Set(collected.map(fileOf))]).not.toContain(""); // ranges kept their path
  });

  it("splits the heavy file across distinct shards (not clustered in one)", () => {
    const total = 10;
    const shardOf = {};
    for (let shard = 1; shard <= total; shard++)
      for (const entry of shardFiles(shard, total))
        if (fileOf(entry) === "src/schema/sales.ts") shardOf[entry] = shard;
    expect(new Set(Object.values(shardOf)).size).toBe(3); // 3 ranges, 3 different shards
  });

  it("emits src/-relative .ts paths (optionally line-ranged) a stryker run can consume", () => {
    const files = shardFiles(1, 6);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((p) => /^src\/.+\.ts(:\d+-\d+)?$/.test(p))).toBe(true);
    expect(files.some((p) => p.includes(".test.ts"))).toBe(false);
  });
});

describe("the CLI rejects bad input loudly", () => {
  const run = (...args) =>
    spawnSync("node", [join(here, "mutation-shard.mjs"), ...args], { encoding: "utf8" });

  it("fails with a clear message (not a TypeError) when the shard index is out of range", () => {
    const r = run("7", "6");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/shard/i);
    expect(r.stderr).not.toMatch(/TypeError/);
    expect(r.stdout.trim()).toBe("");
  });

  it("fails when a shard would select no files (more shards than slices)", () => {
    // 43 mutate slices (40 whole files + sales split into 3) into 44 shards → the last is empty;
    // must not print an empty --mutate list that would make stryker a confusing no-op.
    const r = run("44", "44");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/no files/i);
    expect(r.stdout.trim()).toBe("");
  });

  it("fails on a non-integer shard count", () => {
    const r = run("1", "abc");
    expect(r.status).not.toBe(0);
    expect(r.stdout.trim()).toBe("");
  });
});
