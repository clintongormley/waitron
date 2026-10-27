import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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

it("retains the exact original exporter named by the frozen manifest", () => {
  const source = new URL("original-exporter.ts.txt", DEMO_BASELINE_FIXTURE_ROOT);
  expect(existsSync(source), "original exporter source is available for the recorded digest").toBe(
    true,
  );
  const manifest = JSON.parse(
    readFileSync(new URL("madrid-before-move.manifest.json", DEMO_BASELINE_FIXTURE_ROOT), "utf8"),
  );
  expect(createHash("sha256").update(readFileSync(source)).digest("hex")).toBe(
    manifest.exporterSha256,
  );
});
