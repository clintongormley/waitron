/**
 * The coverage provider a browser package's `test:merge` names: v8's own, with one change to how
 * the shards' coverage maps are merged.
 *
 * A shard reports every `coverage.include` file it never loaded as an untested copy built by a
 * different transform from the one its browser tests loaded the file through, and some function
 * positions differ between the two. Merged as they come, both copies of such a function are kept
 * and the untested one is never hit, so the merged total reads LOWER than an unsharded run's. So a
 * file's untested copies are dropped wherever any shard loaded it; a file no shard loaded keeps
 * one, and reports at zero. Measured and explained in docs/developers/ci-and-gates.md.
 */
import v8 from "@vitest/coverage-v8";

function asData(map) {
  return typeof map.toJSON === "function" ? map.toJSON() : map;
}

function wasLoaded(file) {
  const counts = [
    ...Object.values(file.s),
    ...Object.values(file.f),
    ...Object.values(file.b).flat(),
  ];
  return counts.some((count) => count > 0);
}

/**
 * The coverage entries to merge: for each file, every shard's entry that has a count above zero,
 * or — when no shard has one — the first shard's entry alone.
 */
export function keepLoadedEntries(coverageMaps) {
  const byFile = new Map();
  for (const data of coverageMaps.map(asData)) {
    for (const [path, file] of Object.entries(data)) {
      const entries = byFile.get(path) ?? [];
      entries.push(file);
      byFile.set(path, entries);
    }
  }
  const kept = [];
  for (const [path, entries] of byFile) {
    const loaded = entries.filter(wasLoaded);
    for (const file of loaded.length > 0 ? loaded : entries.slice(0, 1))
      kept.push({ [path]: file });
  }
  return kept;
}

export default {
  ...v8,
  async getProvider() {
    const provider = await v8.getProvider();
    provider.mergeReports = async (coverageMaps) => {
      const coverageMap = provider.createCoverageMap();
      for (const entry of keepLoadedEntries(coverageMaps)) coverageMap.merge(entry);
      await provider.generateReports(coverageMap, true);
    };
    return provider;
  },
};
