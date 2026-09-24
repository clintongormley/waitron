import { expect, it } from "vitest";
import fiscalConfig from "../packages/fiscal-verifactu/vitest.config.js";
import mediaConfig from "../packages/media/vitest.config.js";

// Pins the arrangement fiscal-verifactu and media chose — a `maxWorkers` cap on the outer config,
// none inside a project — not how Vitest resolves the cap (docs/developers/testing-guide.md).

it("caps the shared fiscal worker pool at the outer Vitest configuration", () => {
  expect(fiscalConfig.test?.maxWorkers).toBe(4);
});

it("caps media's worker pool at the outer configuration, not inside one of its projects", () => {
  const projects = mediaConfig.test?.projects ?? [];
  expect(
    projects.length,
    "media must still use projects, or this case pins nothing",
  ).toBeGreaterThan(0);
  expect(mediaConfig.test?.maxWorkers).toBe(2);
  const projectLimits = projects.map((project) =>
    typeof project === "object" && "test" in project ? project.test?.maxWorkers : undefined,
  );
  expect(projectLimits.filter((limit) => limit !== undefined)).toEqual([]);
});
