import { existsSync } from "node:fs";
import { expect, it } from "vitest";
import { DEMO_BASELINE_FIXTURE_ROOT } from "./demo-testing.js";
it("exposes the independently captured demo fixtures through its test entry", () => {
  for (const filename of [
    "madrid-before-move.en.json",
    "madrid-before-move.es.json",
    "madrid-before-move.manifest.json",
  ]) {
    expect(existsSync(new URL(filename, DEMO_BASELINE_FIXTURE_ROOT))).toBe(true);
  }
});
