import { readFileSync } from "node:fs";
import { readDefaults } from "@waitron/ui-core/theme";
import { describe, expect, it } from "vitest";
import { SERVER_THEME_DEFAULTS } from "./theme-defaults.js";

const ownFile = (name: string) =>
  readFileSync(new URL(`../../../packages/ui-core/src/tokens/${name}`, import.meta.url), "utf8");

describe("SERVER_THEME_DEFAULTS", () => {
  it("reads Waitron's values from ui-core's token files", () => {
    expect(SERVER_THEME_DEFAULTS.light["--wt-color-primary"]).toBe("#1f6feb");
    expect(SERVER_THEME_DEFAULTS.dark["--wt-color-bg"]).toBe("#101216");
    expect(SERVER_THEME_DEFAULTS.structure["--wt-radius-md"]).toBe("8px");
  });

  it("reads the package's own files", () => {
    expect(SERVER_THEME_DEFAULTS).toEqual(
      readDefaults(ownFile("colors.css"), ownFile("structure.css")),
    );
  });
});
