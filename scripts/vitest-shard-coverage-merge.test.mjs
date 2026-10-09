import v8 from "@vitest/coverage-v8";
import { describe, expect, it, vi } from "vitest";
import coverageModule, { keepLoadedEntries } from "./vitest-shard-coverage-merge.mjs";

const v8Provider = await v8.getProvider();

function coverageMap(...entries) {
  const map = v8Provider.createCoverageMap();
  for (const entry of entries) map.merge(entry);
  return map;
}

const FILE = "/src/screen.ts";

/** One function at line 1; the ending column is what the two transforms disagree on. */
function fileData({ hits, endColumn, path = FILE }) {
  return {
    path,
    statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } } },
    fnMap: {
      0: {
        name: "render",
        decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 6 } },
        loc: { start: { line: 1, column: 0 }, end: { line: 3, column: endColumn } },
        line: 1,
      },
    },
    branchMap: {
      0: {
        type: "if",
        line: 2,
        loc: { start: { line: 2, column: 0 }, end: { line: 2, column: 5 } },
        locations: [
          { start: { line: 2, column: 0 }, end: { line: 2, column: 5 } },
          { start: { line: 2, column: 0 }, end: { line: 2, column: 5 } },
        ],
      },
    },
    s: { 0: hits },
    f: { 0: hits },
    b: { 0: [hits, 0] },
  };
}

const typeOnly = (path) => ({
  path,
  statementMap: {},
  fnMap: {},
  branchMap: {},
  s: {},
  f: {},
  b: {},
});

const merged = (maps) => coverageMap(...keepLoadedEntries(maps));

describe("keepLoadedEntries", () => {
  it("drops a shard's untested copy of a file another shard loaded, so its function is counted once", () => {
    const untested = { [FILE]: fileData({ hits: 0, endColumn: null }) };
    const loaded = { [FILE]: fileData({ hits: 3, endColumn: 91 }) };

    const summary = merged([untested, loaded]).fileCoverageFor(FILE).toSummary();

    expect(summary.functions.total).toBe(1);
    expect(summary.functions.covered).toBe(1);
    // The plain merge keeps both copies of the function and reads one of two covered.
    const plain = coverageMap(untested, loaded);
    expect(plain.fileCoverageFor(FILE).toSummary().functions.pct).toBe(50);
  });

  it("keeps and sums every shard that loaded a file", () => {
    const shards = [1, 2].map((hits) => ({ [FILE]: fileData({ hits, endColumn: 91 }) }));

    const coverage = merged(shards).fileCoverageFor(FILE);

    expect(coverage.s[0]).toBe(3);
    expect(coverage.f[0]).toBe(3);
    expect(coverage.b[0]).toEqual([3, 0]);
  });

  it("keeps one untested copy of a file no shard loaded, so it reports at zero", () => {
    const shards = [1, 2].map(() => ({ [FILE]: fileData({ hits: 0, endColumn: null }) }));

    const kept = keepLoadedEntries(shards);

    expect(kept).toEqual([{ [FILE]: fileData({ hits: 0, endColumn: null }) }]);
    const summary = merged(shards).fileCoverageFor(FILE).toSummary();
    expect(summary.statements.total).toBe(1);
    expect(summary.statements.pct).toBe(0);
    expect(summary.functions.pct).toBe(0);
  });

  it("keeps one copy of a file with no counters at all", () => {
    const path = "/src/types.ts";

    expect(keepLoadedEntries([{ [path]: typeOnly(path) }, { [path]: typeOnly(path) }])).toEqual([
      { [path]: typeOnly(path) },
    ]);
  });

  it("decides file by file, and reads a coverage map object as well as plain data", () => {
    const other = "/src/other.ts";
    const first = coverageMap({
      [FILE]: fileData({ hits: 0, endColumn: null }),
      [other]: fileData({ hits: 2, endColumn: 91, path: other }),
    });
    const second = {
      [FILE]: fileData({ hits: 1, endColumn: 91 }),
      [other]: fileData({ hits: 0, endColumn: null, path: other }),
    };

    const map = merged([first, second]);

    expect(map.fileCoverageFor(FILE).toSummary().functions.total).toBe(1);
    expect(map.fileCoverageFor(other).toSummary().functions.total).toBe(1);
    expect(map.fileCoverageFor(other).f[0]).toBe(2);
  });
});

describe("the provider module", () => {
  it("hands back the v8 provider with its merge replaced", async () => {
    const provider = await coverageModule.getProvider();
    const generateReports = vi.fn();
    provider.generateReports = generateReports;
    const untested = { [FILE]: fileData({ hits: 0, endColumn: null }) };
    const loaded = { [FILE]: fileData({ hits: 3, endColumn: 91 }) };

    await provider.mergeReports([untested, loaded]);

    expect(provider.name).toBe("v8");
    expect(generateReports).toHaveBeenCalledTimes(1);
    const [map, allTestsRun] = generateReports.mock.calls[0];
    expect(allTestsRun).toBe(true);
    expect(map.fileCoverageFor(FILE).toSummary().functions).toMatchObject({ total: 1, covered: 1 });
  });

  it("passes the runtime hooks through to v8's own module", async () => {
    expect(coverageModule.startCoverage).toBe(v8.startCoverage);
    expect(coverageModule.takeCoverage).toBe(v8.takeCoverage);
    expect(coverageModule.stopCoverage).toBe(v8.stopCoverage);
  });
});
