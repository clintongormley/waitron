import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { guideRoot, readGuide } from "./guide-catalogue.js";

let scratch: string | undefined;

afterEach(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

describe("readGuide", () => {
  it("returns the page's markdown from <root>/<language>/<page>.md", () => {
    scratch = mkdtempSync(join(tmpdir(), "guide-catalogue-"));
    mkdirSync(join(scratch, "es"));
    writeFileSync(join(scratch, "es", "modifiers.md"), "# Modificadores\n");

    expect(readGuide(scratch, "es", "modifiers")).toBe("# Modificadores\n");
  });

  it("returns undefined when the page's file is missing", () => {
    scratch = mkdtempSync(join(tmpdir(), "guide-catalogue-"));

    expect(readGuide(scratch, "es", "products")).toBeUndefined();
  });

  it("throws a read failure other than a missing file", () => {
    scratch = mkdtempSync(join(tmpdir(), "guide-catalogue-"));
    mkdirSync(join(scratch, "en", "products.md"), { recursive: true });

    expect(() => readGuide(scratch!, "en", "products")).toThrow(/EISDIR/);
  });
});

describe("guideRoot", () => {
  it("is the guide folder beside this module, holding the English products page", () => {
    expect(guideRoot().endsWith(join("src", "guide") + "/")).toBe(true);
    expect(readGuide(guideRoot(), "en", "products")).toMatch(/^# /);
  });
});
