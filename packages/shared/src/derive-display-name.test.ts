import { describe, expect, it } from "vitest";
import { deriveDisplayName } from "./derive-display-name.js";

describe("deriveDisplayName", () => {
  it("generates 'First Last' when the current display name is blank", () => {
    expect(deriveDisplayName("", "", "", "Alba", "Ruiz")).toBe("Alba Ruiz");
  });

  it("regenerates when the current name still equals the previously-generated one", () => {
    expect(deriveDisplayName("Alba Ruiz", "Alba", "Ruiz", "Alba", "Soler")).toBe("Alba Soler");
  });

  it("leaves a customised name unchanged", () => {
    expect(deriveDisplayName("Chef Alba", "Alba", "Ruiz", "Alba", "Soler")).toBe("Chef Alba");
  });

  it("produces a single word with no stray spaces when only one name is present", () => {
    expect(deriveDisplayName("", "", "", "Alba", "")).toBe("Alba");
    expect(deriveDisplayName("", "", "", "", "Ruiz")).toBe("Ruiz");
  });

  it("resumes generating after the display name is cleared to blank", () => {
    expect(deriveDisplayName("", "Chef Alba", "", "Alba", "Ruiz")).toBe("Alba Ruiz");
  });

  it("single-spaces a generated name even when the source fields carry stray spaces", () => {
    expect(deriveDisplayName("", "", "", "  Alba  ", "  Ruiz  ")).toBe("Alba Ruiz");
  });

  it("regenerates cleanly from stray-space fields when the current name matched the last generated one", () => {
    expect(deriveDisplayName("Alba Ruiz", "  Alba  ", "  Ruiz  ", "  Alba  ", "  Soler  ")).toBe(
      "Alba Soler",
    );
  });

  it("compares correctly when previous names carry internal spaces", () => {
    expect(deriveDisplayName("Alex Ramos", "Alex Maria", "Ramos", "Alex Maria", "Soler")).toBe(
      "Alex Soler",
    );
  });

  it("takes the first given name and the first surname from multi-word fields", () => {
    expect(deriveDisplayName("", "", "", "María José", "García López")).toBe("María García");
  });

  it("takes the first word of the one field that is filled in", () => {
    expect(deriveDisplayName("", "", "", "  María   José ", "")).toBe("María");
    expect(deriveDisplayName("", "", "", "", "  García   López ")).toBe("García");
  });

  it("regenerates a name the first-word rule generated from multi-word previous values", () => {
    expect(
      deriveDisplayName("María García", "María José", "García López", "Ana Belén", "Ruiz Soler"),
    ).toBe("Ana Ruiz");
  });

  it("keeps a customised name that spells out the whole of both fields", () => {
    expect(
      deriveDisplayName(
        "María José García López",
        "María José",
        "García López",
        "Ana Belén",
        "Ruiz Soler",
      ),
    ).toBe("María José García López");
  });
});
