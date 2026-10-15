import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { WorkTimeRuleset as BrowserRules } from "@waitron/workforce/roster-validation";
import { makeRuleset } from "../test/fixtures.js";

it("offers the real roster validator and rules through its public browser subpath", async () => {
  const subpath = "@waitron/workforce/roster-validation";
  const api: typeof import("./roster-validation.js") = await import(/* @vite-ignore */ subpath);
  const rules: BrowserRules = makeRuleset();
  const breaches = api.validateRoster(
    [
      {
        shiftId: "sunday",
        personId: "Ana",
        startsAt: "2026-03-01T20:00:00Z",
        endsAt: "2026-03-01T23:00:00Z",
        startsOffsetMinutes: 0,
        endsOffsetMinutes: 0,
      },
      {
        shiftId: "monday",
        personId: "Ana",
        startsAt: "2026-03-02T07:00:00Z",
        endsAt: "2026-03-02T10:00:00Z",
        startsOffsetMinutes: 0,
        endsOffsetMinutes: 0,
      },
    ],
    rules,
  );
  expect(breaches.filter((breach) => breach.kind === "rest_too_short")).toEqual([
    {
      kind: "rest_too_short",
      personId: "Ana",
      previousShiftId: "sunday",
      shiftId: "monday",
      restMinutes: 480,
      requiredMinutes: 720,
    },
  ]);
});

it("keeps the validator and rules' runtime imports inside the browser entry", () => {
  const files = ["roster-validation.ts", "ruleset.ts"];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import\s+(?!type\b)[\s\S]*?from\s+["']([^"']+)["'];/gm)];
    for (const statement of imports)
      expect(files, `${file}: ${statement[0]}`).toContain(
        statement[1]!.replace("./", "").replace(/\.js$/, ".ts"),
      );
    expect(source).not.toMatch(/\b(?:require\s*\(|import\s*\()/);
    expect(source).not.toMatch(/^import\s*["']/m);
  }
});
