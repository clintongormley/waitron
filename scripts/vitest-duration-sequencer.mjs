// A Vitest sequencer that packs test files into shards by measured duration, because Vitest's own
// split cuts by file count. See docs/developers/ci-and-gates.md, "The server's shards: sixteen,
// packed by measured duration".

import path from "node:path";

const PREFIX = "[duration-sequencer]";

export function defaultEstimate(seconds) {
  const values = Object.values(seconds);
  if (values.length === 0) return 1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function relativeTestPath(root, moduleId) {
  return path.relative(root, moduleId).split(path.sep).join("/");
}

function byPath(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function estimator(seconds) {
  const fallback = defaultEstimate(seconds);
  return (file) => (Object.hasOwn(seconds, file) ? seconds[file] : fallback);
}

export function balancedShards(paths, seconds, count) {
  const estimate = estimator(seconds);
  const shards = Array.from({ length: count }, () => []);
  const totals = Array.from({ length: count }, () => 0);
  const ordered = [...paths].sort((a, b) => estimate(b) - estimate(a) || byPath(a, b));
  for (const file of ordered) {
    let lightest = 0;
    for (let i = 1; i < count; i += 1) if (totals[i] < totals[lightest]) lightest = i;
    shards[lightest].push(file);
    totals[lightest] += estimate(file);
  }
  return shards;
}

export function startOrder(paths, seconds) {
  const known = (file) => Object.hasOwn(seconds, file);
  const absent = paths.filter((file) => !known(file)).sort(byPath);
  const present = paths.filter(known).sort((a, b) => seconds[b] - seconds[a] || byPath(a, b));
  return [...absent, ...present];
}

export function durationSequencer(
  seconds,
  { write = (line) => process.stdout.write(`${line}\n`) } = {},
) {
  return class DurationSequencer {
    static table = seconds;

    constructor(ctx) {
      this.ctx = ctx;
    }

    // A file can arrive once per project, so each path keeps every spec that names it.
    byPath(specs) {
      const { root } = this.ctx.config;
      const grouped = new Map();
      for (const spec of specs) {
        const file = relativeTestPath(root, spec.moduleId);
        grouped.set(file, [...(grouped.get(file) ?? []), spec]);
      }
      return grouped;
    }

    async shard(specs) {
      const { index, count } = this.ctx.config.shard;
      const specsByPath = this.byPath(specs);
      const mine = balancedShards([...specsByPath.keys()], seconds, count)[index - 1];
      const estimate = estimator(seconds);
      const total = mine.reduce((sum, file) => sum + estimate(file), 0);
      const absent = mine.filter((file) => !Object.hasOwn(seconds, file)).sort(byPath);
      const names = absent.length > 0 ? `: ${absent.join(", ")}` : "";
      write(
        `${PREFIX} shard ${index}/${count}: ${mine.length} files, ${Math.round(total)} estimated s, ${absent.length} absent from the table${names}`,
      );
      return mine.flatMap((file) => specsByPath.get(file));
    }

    async sort(specs) {
      const specsByPath = this.byPath(specs);
      return startOrder([...specsByPath.keys()], seconds).flatMap((file) => specsByPath.get(file));
    }
  };
}
