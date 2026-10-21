import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import serverConfig from "../apps/server/vitest.config.ts";
import {
  balancedShards,
  defaultEstimate,
  durationSequencer,
  relativeTestPath,
  startOrder,
} from "./vitest-duration-sequencer.mjs";

// 45 paths with varied seconds and 5 the table does not name.
function fixture() {
  const seconds = {};
  const paths = [];
  for (let i = 0; i < 50; i += 1) {
    const path = `src/f${String(i).padStart(2, "0")}.test.ts`;
    paths.push(path);
    if (i < 45) seconds[path] = ((i * 37) % 23) + 0.5 * (i % 3);
  }
  return { paths, seconds };
}

describe("defaultEstimate", () => {
  it("is the mean of the table's values", () => {
    expect(defaultEstimate({ a: 30, b: 10 })).toBe(20);
  });

  it("is 1 for an empty table", () => {
    expect(defaultEstimate({})).toBe(1);
  });
});

describe("relativeTestPath", () => {
  it("is the path under the root, with / separators", () => {
    expect(relativeTestPath("/r/apps/server", "/r/apps/server/src/a.test.ts")).toBe(
      "src/a.test.ts",
    );
    expect(relativeTestPath("/r/apps/server/", "/r/apps/server/src/a.test.ts")).toBe(
      "src/a.test.ts",
    );
  });
});

describe("balancedShards", () => {
  it("puts each path, longest first, into the lightest shard", () => {
    expect(
      balancedShards(["a", "b", "c", "d", "e"], { a: 100, b: 60, c: 50, d: 40, e: 10 }, 2),
    ).toEqual([
      ["a", "d"],
      ["b", "c", "e"],
    ]);
  });

  it("packs a path absent from the table at the table's mean", () => {
    expect(balancedShards(["a", "b", "x"], { a: 30, b: 10 }, 2)).toEqual([["a"], ["x", "b"]]);
  });

  it("packs by count when the table is empty", () => {
    expect(balancedShards(["p1", "p2", "p3", "p4"], {}, 2)).toEqual([
      ["p1", "p3"],
      ["p2", "p4"],
    ]);
  });

  it("places every path exactly once, for every shard count", () => {
    const { paths, seconds } = fixture();
    for (let count = 1; count <= 20; count += 1) {
      const shards = balancedShards(paths, seconds, count);
      expect(shards).toHaveLength(count);
      const placed = shards.flat();
      expect(new Set(placed).size).toBe(placed.length);
      expect([...placed].sort()).toEqual([...paths].sort());
    }
  });

  it("leaves the extra shards empty when there are more shards than paths", () => {
    expect(balancedShards(["a", "b"], { a: 2, b: 1 }, 4)).toEqual([["a"], ["b"], [], []]);
  });

  it("gives the same shards whatever order the paths arrive in", () => {
    const { paths, seconds } = fixture();
    const expected = balancedShards(paths, seconds, 7);
    const reversed = [...paths].reverse();
    const rotated = [...paths.slice(17), ...paths.slice(0, 17)];
    expect(balancedShards(reversed, seconds, 7)).toEqual(expected);
    expect(balancedShards(rotated, seconds, 7)).toEqual(expected);
  });
});

describe("startOrder", () => {
  it("starts absent paths first, then the longest known ones", () => {
    expect(startOrder(["k1", "u2", "k2", "u1"], { k1: 5, k2: 50 })).toEqual([
      "u1",
      "u2",
      "k2",
      "k1",
    ]);
  });

  it("falls back to path order on equal seconds", () => {
    expect(startOrder(["b", "c", "a"], { a: 5, b: 5, c: 9 })).toEqual(["c", "a", "b"]);
  });

  it("keeps a path that arrives twice", () => {
    expect(startOrder(["a", "a"], {})).toEqual(["a", "a"]);
  });
});

describe("durationSequencer", () => {
  const seconds = {
    "src/1.test.ts": 50,
    "src/2.test.ts": 40,
    "src/3.test.ts": 30,
    "src/4.test.ts": 20,
    "src/5.test.ts": 10,
  };
  const specs = [1, 2, 3, 4, 5, 6].map((n) => ({ moduleId: `/r/src/${n}.test.ts` }));
  const ctx = (index) => ({ config: { root: "/r", shard: { index, count: 3 } } });

  it("carries its table on the class", () => {
    expect(durationSequencer(seconds).table).toBe(seconds);
  });

  it("returns every spec in exactly one shard, and writes one line per shard", async () => {
    const lines = [];
    const Sequencer = durationSequencer(seconds, { write: (line) => lines.push(line) });
    const seen = [];
    for (let index = 1; index <= 3; index += 1) {
      seen.push(...(await new Sequencer(ctx(index)).shard(specs)));
    }
    expect(seen).toHaveLength(specs.length);
    for (const spec of specs) expect(seen.filter((s) => s === spec)).toHaveLength(1);
    expect(lines).toEqual([
      "[duration-sequencer] shard 1/3: 2 files, 60 estimated s, 0 absent from the table",
      "[duration-sequencer] shard 2/3: 2 files, 60 estimated s, 0 absent from the table",
      "[duration-sequencer] shard 3/3: 2 files, 60 estimated s, 1 absent from the table: src/6.test.ts",
    ]);
  });

  it("returns the shard Vitest asked for", async () => {
    const Sequencer = durationSequencer(seconds, { write: () => {} });
    const shard = await new Sequencer(ctx(3)).shard(specs);
    expect(shard).toEqual([specs[2], specs[5]]);
  });

  it("names every absent file, sorted, and rounds the estimate", async () => {
    const lines = [];
    const Sequencer = durationSequencer(
      { "src/a.test.ts": 1.2, "src/b.test.ts": 1.4 },
      { write: (line) => lines.push(line) },
    );
    const absent = ["z", "y", "a", "b"].map((n) => ({ moduleId: `/r/src/${n}.test.ts` }));
    await new Sequencer({ config: { root: "/r", shard: { index: 1, count: 1 } } }).shard(absent);
    expect(lines).toEqual([
      "[duration-sequencer] shard 1/1: 4 files, 5 estimated s, 2 absent from the table: src/y.test.ts, src/z.test.ts",
    ]);
  });

  it("keeps both specs when two projects name the same file", async () => {
    const Sequencer = durationSequencer(seconds, { write: () => {} });
    const twice = [{ moduleId: "/r/src/1.test.ts" }, { moduleId: "/r/src/1.test.ts" }];
    const one = { config: { root: "/r", shard: { index: 1, count: 1 } } };
    expect(await new Sequencer(one).shard(twice)).toEqual(twice);
    const sorted = await new Sequencer(one).sort(twice);
    expect(sorted[0]).toBe(twice[0]);
    expect(sorted[1]).toBe(twice[1]);
  });

  it("sorts specs in start order", async () => {
    const Sequencer = durationSequencer(seconds, { write: () => {} });
    const sorted = await new Sequencer(ctx(1)).sort([...specs].reverse());
    expect(sorted.map((s) => s.moduleId)).toEqual([
      "/r/src/6.test.ts",
      "/r/src/1.test.ts",
      "/r/src/2.test.ts",
      "/r/src/3.test.ts",
      "/r/src/4.test.ts",
      "/r/src/5.test.ts",
    ]);
  });

  it("writes its line to stdout by default", async () => {
    const Sequencer = durationSequencer(seconds);
    const written = [];
    const original = process.stdout.write;
    process.stdout.write = (chunk) => {
      written.push(String(chunk));
      return true;
    };
    try {
      await new Sequencer(ctx(1)).shard(specs);
    } finally {
      process.stdout.write = original;
    }
    expect(written).toEqual([
      "[duration-sequencer] shard 1/3: 2 files, 60 estimated s, 0 absent from the table\n",
    ]);
  });
});

describe("apps/server's wiring", () => {
  const serverRoot = join(import.meta.dirname, "..", "apps", "server");

  function serverTestFiles() {
    const found = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules") walk(path);
        } else if (entry.name.endsWith(".test.ts") && statSync(path).isFile()) {
          found.push(relative(serverRoot, path).split(sep).join("/"));
        }
      }
    };
    for (const top of ["src", "test", "scripts"]) {
      if (existsSync(join(serverRoot, top))) walk(join(serverRoot, top));
    }
    return found;
  }

  it("apps/server's config packs every server test file into exactly one shard", () => {
    const table = JSON.parse(readFileSync(join(serverRoot, "test-durations.json"), "utf8"));
    const wired = serverConfig.test.sequence.sequencer.table;
    expect(wired).toEqual(table);
    for (const [file, value] of Object.entries(wired)) {
      expect(Number.isFinite(value) && value > 0, file).toBe(true);
    }

    const paths = serverTestFiles();
    expect(paths.length).toBeGreaterThan(0);
    const sorted = [...paths].sort();
    for (let count = 2; count <= 24; count += 1) {
      const packed = balancedShards(paths, wired, count).flat();
      expect(new Set(packed).size).toBe(packed.length);
      expect([...packed].sort()).toEqual(sorted);
    }
  });
});
