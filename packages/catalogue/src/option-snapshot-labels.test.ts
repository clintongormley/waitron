import { describe, expect, it } from "vitest";
import {
  customerOptionSnapshotLabels,
  optionSnapshotLabels,
  staffOptionSnapshotLabels,
} from "./option-snapshot-labels.js";

const snapshot = (over: Partial<Parameters<typeof optionSnapshotLabels>[0][number]> = {}) => ({
  listName: { es: "Punto staff" },
  listCustomerName: { es: "Punto customer" },
  listKitchenName: "Punto kitchen",
  labelName: { es: "Poco hecho staff" },
  labelCustomerName: { es: "Poco hecho customer" },
  labelKitchenName: "Poco hecho kitchen",
  ...over,
});

describe("optionSnapshotLabels", () => {
  it("prints the KITCHEN name of the list and of the chosen label", () => {
    expect(optionSnapshotLabels([snapshot()])).toEqual(["Punto kitchen: Poco hecho kitchen"]);
  });

  it("falls back to the STAFF name, never the customer text, when a kitchen name is missing", () => {
    expect(
      optionSnapshotLabels([snapshot({ listKitchenName: null, labelKitchenName: "  " })]),
    ).toEqual(["Punto staff: Poco hecho staff"]);
  });
});

describe("customerOptionSnapshotLabels", () => {
  it("prints the CUSTOMER name of the list and of the chosen label", () => {
    expect(customerOptionSnapshotLabels([snapshot()], "es")).toEqual([
      "Punto customer: Poco hecho customer",
    ]);
  });

  it("falls back to the STAFF name, never the kitchen text, when a customer name is missing", () => {
    // A map holding only blanks means the same as no map, which is the fold
    // `nonBlankTranslations` owns — so `{ es: "  " }` and `null` fall back alike.
    expect(
      customerOptionSnapshotLabels(
        [snapshot({ listCustomerName: null, labelCustomerName: { es: "  " } })],
        "es",
      ),
    ).toEqual(["Punto staff: Poco hecho staff"]);
  });

  it("answers a full tag with the bare language the stored answers are keyed by", () => {
    // A frozen answer is keyed by CONTENT LANGUAGE codes ("es", "en"), while the receipt asks with
    // the invoice locale, which can be a full tag. Matching keys exactly would miss.
    expect(
      customerOptionSnapshotLabels(
        [
          snapshot({
            listCustomerName: { es: "Punto customer", en: "Doneness customer" },
            labelCustomerName: { es: "Poco hecho customer", en: "Rare customer" },
          }),
        ],
        "en-GB",
      ),
    ).toEqual(["Doneness customer: Rare customer"]);
  });

  it("prints the asked-for language's text even when an earlier key in the map is blank", () => {
    // The requested language here is NOT blank. What this pins is that a blank sitting EARLIER in
    // the map cannot win and drop the goods identification off a legal receipt.
    expect(
      customerOptionSnapshotLabels(
        [
          snapshot({
            listCustomerName: { en: "", es: "Punto customer" },
            labelCustomerName: { en: "  ", es: "Poco hecho customer" },
          }),
        ],
        "es-ES",
      ),
    ).toEqual(["Punto customer: Poco hecho customer"]);
  });

  it("falls back to the first non-blank value over sorted keys when the asked-for language is blank", () => {
    // `nonBlankTranslations` keeps a map that holds text in ANY language, so the chosen map can
    // still be blank in the language the receipt asked for. Each map here holds TWO non-blank
    // values under keys whose sorted order (en, es, gl) differs from insertion order (es, gl, en),
    // so the assertion fails if `resolveSnapshotText` stops taking the first non-blank value over
    // SORTED keys.
    expect(
      customerOptionSnapshotLabels(
        [
          snapshot({
            listCustomerName: { es: "", gl: "Punto galego", en: "Punto customer" },
            labelCustomerName: { es: "  ", gl: "Pouco feito galego", en: "Poco hecho customer" },
          }),
        ],
        "es-ES",
      ),
    ).toEqual(["Punto customer: Poco hecho customer"]);
  });

  it("prints a staff map's one entry whatever language the receipt asks for", () => {
    // The staff fallback holds a single entry under the venue's default content language, which is
    // not necessarily the language of the receipt; that entry is the only text the answer has.
    expect(
      customerOptionSnapshotLabels(
        [snapshot({ listCustomerName: null, labelCustomerName: null })],
        "en-GB",
      ),
    ).toEqual(["Punto staff: Poco hecho staff"]);
  });
});

describe("staffOptionSnapshotLabels", () => {
  it("prints the STAFF name of the list and of the chosen label", () => {
    // The fixture gives each side three different texts, so reading the kitchen name or the
    // customer text instead of the staff name fails here rather than passing on identical strings.
    expect(staffOptionSnapshotLabels([snapshot()])).toEqual(["Punto staff: Poco hecho staff"]);
  });

  it("prints a staff map's one entry whatever language it is keyed by", () => {
    // The staff map's one key is whichever content language its builder resolved, so a reader
    // that looked up a fixed key would print nothing for a venue whose default is not that key.
    expect(
      staffOptionSnapshotLabels([
        snapshot({ listName: { gl: "Punto galego" }, labelName: { gl: "Pouco feito galego" } }),
      ]),
    ).toEqual(["Punto galego: Pouco feito galego"]);
  });
});

describe("a snapshot whose staff map holds no entry", () => {
  it("prints empty text for each side rather than the word undefined", () => {
    const empty = snapshot({
      listName: {},
      labelName: {},
      listKitchenName: null,
      labelKitchenName: null,
    });
    expect(staffOptionSnapshotLabels([empty])).toEqual([": "]);
    expect(optionSnapshotLabels([empty])).toEqual([": "]);
  });
});
