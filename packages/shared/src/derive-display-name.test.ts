import { describe, expect, it } from "vitest";
import { deriveDisplayName } from "./derive-display-name.js";

describe("deriveDisplayName", () => {
  it("generates 'First Last' when the current display name is blank", () => {
    expect(deriveDisplayName("", "", "", "Alba", "Ruiz")).toBe("Alba Ruiz");
  });

  it("regenerates when the current name still equals the previously-generated one", () => {
    // current holds the old generated value, so a name change flows through
    expect(deriveDisplayName("Alba Ruiz", "Alba", "Ruiz", "Alba", "Soler")).toBe("Alba Soler");
  });

  it("leaves a customised name unchanged", () => {
    // current differs from the previously-generated name and is non-blank → the person typed it
    expect(deriveDisplayName("Chef Alba", "Alba", "Ruiz", "Alba", "Soler")).toBe("Chef Alba");
  });

  it("produces a single word with no stray spaces when only one name is present", () => {
    expect(deriveDisplayName("", "", "", "Alba", "")).toBe("Alba");
    expect(deriveDisplayName("", "", "", "", "Ruiz")).toBe("Ruiz");
  });

  it("resumes generating after the display name is cleared to blank", () => {
    // The person cleared the field ("" current), so the next name change regenerates
    expect(deriveDisplayName("", "Chef Alba", "", "Alba", "Ruiz")).toBe("Alba Ruiz");
  });

  it("single-spaces a generated name even when the source fields carry stray spaces", () => {
    expect(deriveDisplayName("", "", "", "  Alba  ", "  Ruiz  ")).toBe("Alba Ruiz");
  });

  it("regenerates cleanly from stray-space fields when the current name matched the last generated one", () => {
    // prevGenerated collapses "  Alba  "/"  Ruiz  " to "Alba Ruiz", which the current name equals,
    // so the change flows through and the new value is single-spaced too.
    expect(deriveDisplayName("Alba Ruiz", "  Alba  ", "  Ruiz  ", "  Alba  ", "  Soler  ")).toBe(
      "Alba Soler",
    );
  });

  it("compares correctly when previous names carry internal spaces", () => {
    // prevGenerated is "Alex Maria Ramos"; current matches it, so it regenerates
    expect(
      deriveDisplayName("Alex Maria Ramos", "Alex Maria", "Ramos", "Alex Maria", "Soler"),
    ).toBe("Alex Maria Soler");
  });
});
