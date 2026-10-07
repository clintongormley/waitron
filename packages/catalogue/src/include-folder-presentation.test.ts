import { describe, expect, it } from "vitest";
import {
  FOLLOWING_FOLDER,
  folderOverridesFrom,
  folderPresentation,
} from "./include-folder-presentation.js";
import type { Presentation } from "./section-types.js";

const own: Presentation = {
  names: { en: "Drinks", es: "Bebidas" },
  image: "drinks.jpg",
  color: "#445566",
};

describe("folderPresentation", () => {
  it("a folder that follows shows the included menu's own presentation", () => {
    expect(FOLLOWING_FOLDER).toEqual({ showAsFolder: true, overrides: {} });
    expect(folderPresentation(own, FOLLOWING_FOLDER)).toEqual(own);
  });

  it("switched off, the own presentation shows whatever is stored", () => {
    expect(
      folderPresentation(own, {
        showAsFolder: false,
        overrides: { names: { en: "Bar" }, color: "#112233" },
      }),
    ).toEqual(own);
  });

  it("a fixed language replaces only that language, and a blank one is dropped", () => {
    expect(
      folderPresentation(own, {
        showAsFolder: true,
        overrides: { names: { es: "Barra", en: "" } },
      }),
    ).toEqual({ ...own, names: { es: "Barra" } });
    expect(
      folderPresentation(own, {
        showAsFolder: true,
        overrides: { names: { es: "Barra", en: "  " } },
      }).names,
    ).toEqual({ es: "Barra" });
    expect(
      folderPresentation(own, { showAsFolder: true, overrides: { names: { fr: "Boissons" } } })
        .names,
    ).toEqual({ en: "Drinks", es: "Bebidas", fr: "Boissons" });
  });

  it("a fixed null image or colour hides the included menu's", () => {
    expect(
      folderPresentation(own, { showAsFolder: true, overrides: { image: null, color: null } }),
    ).toEqual({ ...own, image: null, color: null });
    expect(
      folderPresentation(own, {
        showAsFolder: true,
        overrides: { image: "bar.jpg", color: "#112233" },
      }),
    ).toEqual({ ...own, image: "bar.jpg", color: "#112233" });
  });
});

describe("folderOverridesFrom", () => {
  const languages = ["en", "es"];

  it("fixes only the fields that differ from the included menu", () => {
    expect(folderOverridesFrom(own, own, languages, {})).toEqual({});
    expect(
      folderOverridesFrom(
        own,
        { names: { en: " Bar ", es: "Bebidas" }, image: null, color: "#445566" },
        languages,
        {},
      ),
    ).toEqual({ names: { en: "Bar" }, image: null });
    expect(
      folderOverridesFrom(own, { ...own, color: "#112233" }, languages, {
        names: { en: "Old" },
        image: "old.jpg",
      }),
    ).toEqual({ color: "#112233" });
  });

  it("a language neither side names follows, and one only the dialog names is fixed", () => {
    expect(folderOverridesFrom(own, own, ["en", "es", "fr"], {})).toEqual({});
    expect(
      folderOverridesFrom(
        own,
        { ...own, names: { ...own.names, fr: "Boissons" } },
        ["en", "es", "fr"],
        {},
      ),
    ).toEqual({ names: { fr: "Boissons" } });
  });

  it("a language set back to the included menu's text follows again", () => {
    expect(
      folderOverridesFrom(own, { ...own, names: { en: "Drinks ", es: "Barra" } }, languages, {
        names: { en: "Bar", es: "Barra" },
      }),
    ).toEqual({ names: { es: "Barra" } });
  });

  it("a language emptied where the included menu has text is fixed blank", () => {
    expect(
      folderOverridesFrom(own, { ...own, names: { en: "Drinks", es: " " } }, languages, {}),
    ).toEqual({ names: { es: "" } });
  });

  it("keeps a stored fixed language the dialog does not show", () => {
    expect(
      folderOverridesFrom(own, { ...own, names: { en: "Bar", es: "Bebidas" } }, languages, {
        names: { fr: "Boissons", es: "Barra" },
      }),
    ).toEqual({ names: { fr: "Boissons", en: "Bar" } });
  });

  it("an untouched field follows even when the stored value differed", () => {
    expect(
      folderOverridesFrom(
        { ...own, names: { en: "Drinks" } },
        { ...own, names: { en: "Drinks" } },
        ["en"],
        { names: { en: "Old" } },
      ),
    ).toEqual({});
  });
});
