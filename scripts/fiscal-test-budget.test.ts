import { expect, it } from "vitest";
import fiscalConfig from "../packages/fiscal-verifactu/vitest.config.js";
import mediaConfig from "../packages/media/vitest.config.js";

// What these cases pin is the arrangement fiscal-verifactu and media chose — a `maxWorkers` cap on
// the outer config, with none inside a project — not a claim about how Vitest resolves the cap. On
// Vitest 4 a project's own `maxWorkers` wins and the outer config's is the fallback, so keeping the
// cap outside is these two packages' choice rather than something Vitest forces
// (docs/developers/testing-guide.md). Vitest 4 removed `poolOptions`: the option is the top-level
// `maxWorkers`.

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
