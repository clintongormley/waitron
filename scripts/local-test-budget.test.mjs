import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("local test budgets", () => {
  it("bounds the root test commands and caps package concurrency", () => {
    const { scripts } = JSON.parse(read("package.json"));
    for (const name of ["test", "test:coverage"]) {
      expect(scripts[name]).toContain("run-with-deadline.mjs 1200 --");
      expect(scripts[name]).toContain("--workspace-concurrency=2");
    }
  });
});
