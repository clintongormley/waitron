import { expect, it } from "vitest";
import { defineZoneProcessMatrix, run } from "./testing/zone-process-matrix.js";

defineZoneProcessMatrix(["core-only-emergency"]);

it("refuses a nonzero child exit even when it prints a plausible result", async () => {
  await expect(
    run(["--eval", 'console.log("{\\"casesRun\\":10}");process.exit(7)'], { timeout: 1000 }),
  ).rejects.toThrow("Child exit 7");
});
it("bounds a child that never finishes", async () => {
  await expect(run(["--eval", "setInterval(() => {}, 10)"], { timeout: 100 })).rejects.toThrow(
    "Child timed out",
  );
});
