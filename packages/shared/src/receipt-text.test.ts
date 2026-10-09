import { describe, expect, it } from "vitest";
import * as receipt from "./index.js";

const venue = {
  logo: "venue.png",
  headerSubtitle: "Venue subtitle",
  footerMessage: "Venue footer",
  phone: "912345678",
  email: "venue@example.es",
  printAddress: false,
};

describe("receipt text", () => {
  it.each([
    [{ "ca-ES": " Catalan ", "es-ES": "Spanish" }, " Catalan "],
    [{ "ca-ES": " \t", "es-ES": "Spanish" }, "Spanish"],
    [{ "ca-ES": "", "es-ES": "\n", "gl-ES": "Galician" }, undefined],
    [{ "gl-ES": "Galician" }, undefined],
    [{}, undefined],
    [undefined, undefined],
  ])("uses only the printed and current receipt language for %j", (text, want) => {
    expect(receipt.resolveReceiptText(text, "ca-ES", "es-ES")).toBe(want);
  });

  it("does not read a translation inherited from a prototype", () => {
    const text = Object.create({ "ca-ES": "Inherited" }) as Record<string, string>;
    text["es-ES"] = "Own";
    expect(receipt.resolveReceiptText(text, "ca-ES", "es-ES")).toBe("Own");
  });

  it("changes the fallback with the current language without changing the printed language", () => {
    const text = { "es-ES": "Spanish", "gl-ES": "Galician" };
    expect(receipt.resolveReceiptText(text, "ca-ES", "es-ES")).toBe("Spanish");
    expect(receipt.resolveReceiptText(text, "ca-ES", "gl-ES")).toBe("Galician");
  });
});

describe("receipt trim", () => {
  it("resolves each field before inheriting, and keeps department contacts", () => {
    expect(
      receipt.resolveReceiptTrim(
        {
          logo: "department.png",
          phone: "911111111",
          email: "department@example.es",
          headerSubtitle: { "ca-ES": "Catalan subtitle", "es-ES": "Spanish subtitle" },
          footerMessage: { "ca-ES": " ", "es-ES": "Spanish footer" },
        },
        venue,
        "ca-ES",
        "es-ES",
      ),
    ).toEqual({
      logo: "department.png",
      phone: "911111111",
      email: "department@example.es",
      headerSubtitle: "Catalan subtitle",
      footerMessage: "Spanish footer",
    });
  });

  it("inherits only logo and texts for an empty department, without the address switch", () => {
    expect(receipt.resolveReceiptTrim({}, venue, "ca-ES", "es-ES")).toEqual({
      logo: "venue.png",
      headerSubtitle: "Venue subtitle",
      footerMessage: "Venue footer",
    });
  });

  it("uses venue fields alone for a null department", () => {
    expect(receipt.resolveReceiptTrim(null, venue, "ca-ES", "es-ES")).toEqual({
      logo: "venue.png",
      phone: "912345678",
      email: "venue@example.es",
      headerSubtitle: "Venue subtitle",
      footerMessage: "Venue footer",
    });
  });

  it("inherits live changes after both department candidates are cleared", () => {
    const department = { headerSubtitle: { "ca-ES": "", "es-ES": " ", "gl-ES": "Third" } };
    expect(receipt.resolveReceiptTrim(department, venue, "ca-ES", "es-ES").headerSubtitle).toBe(
      "Venue subtitle",
    );
    expect(
      receipt.resolveReceiptTrim(
        department,
        { ...venue, headerSubtitle: "Changed" },
        "ca-ES",
        "es-ES",
      ).headerSubtitle,
    ).toBe("Changed");
    expect(receipt.resolveReceiptTrim(department, {}, "ca-ES", "es-ES")).toEqual({});
  });

  it("preserves legacy venue whitespace and empty strings verbatim", () => {
    expect(
      receipt.resolveReceiptTrim({}, { headerSubtitle: "  ", footerMessage: "" }, "ca-ES", "es-ES"),
    ).toEqual({ headerSubtitle: "  ", footerMessage: "" });
  });

  it("uses the same effective subtitle for an empty field hint and receipt trim", () => {
    const department = { headerSubtitle: { "es-ES": "Fallback" } };
    expect(receipt.resolveReceiptText(department.headerSubtitle, "ca-ES", "es-ES")).toBe(
      "Fallback",
    );
    expect(receipt.resolveReceiptTrim(department, venue, "ca-ES", "es-ES").headerSubtitle).toBe(
      "Fallback",
    );
  });

  it.each([
    [null, {}, null],
    [null, venue, "venue"],
    [{}, venue, "venue"],
    [{ logo: "venue.png" }, venue, "department"],
    [{ logo: "department.png" }, {}, "department"],
  ] as const)(
    "selects the raster owner's row independently of filename equality",
    (department, defaults, want) => {
      expect(receipt.receiptLogoSource(department, defaults)).toBe(want);
    },
  );
});

describe("missing receipt translations", () => {
  const languages = ["es-ES", "ca-ES", "gl-ES"];
  it("warns for each missing field, including the current receipt language", () => {
    expect(
      receipt.untranslatedLanguages(
        [
          { "ca-ES": "Subtitle", "gl-ES": "Subtitle" },
          { "es-ES": "Footer", "gl-ES": "Footer" },
        ],
        languages,
      ),
    ).toEqual(["es-ES", "ca-ES"]);
  });
  it("does not warn for optional texts empty in all languages", () => {
    expect(receipt.untranslatedLanguages([undefined, {}, { "es-ES": " \n" }], languages)).toEqual(
      [],
    );
  });
  it("ignores an unoffered third-language entry and inherited entries", () => {
    expect(receipt.untranslatedLanguages([{ "en-GB": "English" }], languages)).toEqual([]);
    expect(
      receipt.untranslatedLanguages([Object.create({ "ca-ES": "Inherited" })], languages),
    ).toEqual([]);
  });
  it("does not warn when every written field is present in each language", () => {
    expect(
      receipt.untranslatedLanguages(
        [{ "es-ES": "Uno", "ca-ES": "Dos", "gl-ES": "Tres" }, undefined],
        languages,
      ),
    ).toEqual([]);
  });
});
