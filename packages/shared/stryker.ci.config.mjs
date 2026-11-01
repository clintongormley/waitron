import config from "./stryker.config.json" with { type: "json" };

export default {
  ...config,
  incremental: false,
  // CI enforces 90 on the combined score; a shard's subset has no separate floor.
  thresholds: { ...config.thresholds, break: 0 },
  reporters: ["clear-text", "progress", "json"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
};
