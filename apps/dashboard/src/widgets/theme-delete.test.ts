import { afterEach, describe, expect, it } from "vitest";
import { es } from "../i18n/strings.js";
import { setLocale } from "../i18n/t.js";
import { themeDeleteCopy, themeDeleteImpact } from "./theme-delete.js";

afterEach(() => setLocale("en-GB"));

const row = { id: "t", name: "Bar Lucía" };

describe("a theme's delete impact", () => {
  it("names the theme, and a theme in use is the one thing that changes", () => {
    const impact = themeDeleteImpact(row, true);
    expect(impact).toEqual({
      target: row,
      refusals: [],
      ends: [{ key: "theme_in_use", count: 1, targets: [row] }],
      removes: [],
    });
  });

  it("a theme not in use changes nothing", () => {
    expect(themeDeleteImpact(row, false)).toEqual({
      target: row,
      refusals: [],
      ends: [],
      removes: [],
    });
  });
});

describe("a theme's delete dialog copy", () => {
  it("words the dialog and the theme in use, in English", () => {
    setLocale("en-GB");
    const copy = themeDeleteCopy();
    expect(copy.heading).toBe("Delete theme?");
    expect(copy.ends).toBe("What changes");
    expect(copy.confirm).toBe("Delete");
    expect(copy.cancel).toBe("Cancel");
    expect(copy.irreversible).toBe("This can't be undone.");
    const [item] = themeDeleteImpact(row, true).ends;
    expect(copy.item(item!)).toBe(
      "Bar Lucía is in use on every screen. Deleting it puts Waitron's theme on every screen.",
    );
  });

  it("words a refusal by its code", () => {
    setLocale("en-GB");
    expect(themeDeleteCopy().refusal({ code: "theme.not_found", params: {}, targets: [] })).toBe(
      "This theme no longer exists.",
    );
  });

  it("words the dialog and the theme in use, in Spanish", () => {
    setLocale("es-ES");
    const copy = themeDeleteCopy();
    expect(copy.heading).toBe(es["appearance.delete_heading"]);
    expect(copy.ends).toBe(es["appearance.delete_changes"]);
    expect(copy.confirm).toBe(es["action.delete"]);
    const [item] = themeDeleteImpact(row, true).ends;
    expect(copy.item(item!)).toBe(es["appearance.delete_in_use"].replace("{name}", "Bar Lucía"));
  });
});
