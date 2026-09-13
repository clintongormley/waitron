import { expect, it } from "vitest";
import fiscalConfig from "../packages/fiscal-verifactu/vitest.config.js";
import mediaConfig from "../packages/media/vitest.config.js";

// Vitest 3 creates its shared pool from the outer config; a project's `maxForks` is ignored.

it("caps the shared fiscal worker pool at the outer Vitest configuration", () => {
  expect(fiscalConfig.test?.poolOptions?.forks?.maxForks).toBe(4);
});

it("caps media's worker pool at the outer configuration, not inside one of its projects", () => {
  const projects = mediaConfig.test?.projects ?? [];
  expect(
    projects.length,
    "media must still use projects, or this case pins nothing",
  ).toBeGreaterThan(0);
  expect(mediaConfig.test?.poolOptions?.forks?.maxForks).toBe(2);
  const projectLimits = projects.map((project) =>
    typeof project === "object" && "test" in project
      ? project.test?.poolOptions?.forks?.maxForks
      : undefined,
  );
  expect(projectLimits.filter((limit) => limit !== undefined)).toEqual([]);
});
