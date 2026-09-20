import { describe, expect, it } from "vitest";
import { customerOptionSnapshotLabels, optionSnapshotLabels } from "./option-snapshot-labels.js";

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
    // A frozen answer is keyed by CONTENT LANGUAGE codes ("es", "en"): `buildLineExtras`
    // (`apps/server/src/modifier-selection.ts`) copies the catalogue row's customer map through
    // whole and widens each plain staff name under the venue's default content language. The
    // receipt asks with the invoice locale, which can be a full tag. Matching keys exactly would
    // miss and print whichever language the stored map happens to list first.
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
    // The requested language here is NOT blank — "es" holds text and the resolver finds it on its
    // first pass. What this pins is that a blank sitting EARLIER in the map cannot win: the code
    // this replaced read `Object.values(names)[0]`, which would have printed the empty "en" entry
    // and dropped the goods identification off a legal receipt.
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
    // The case the docstring's "first non-blank value over SORTED keys" sentence is actually about.
    // `nonBlankTranslations` keeps a map that holds text in ANY language, so the map it chose can
    // still be blank in the language the receipt asked for — and printing that blank would drop the
    // goods identification off a legal receipt while every other assertion still passed. "es" is
    // blank on both sides here, so each side falls through to "en", which sorts first among the
    // remaining keys.
    expect(
      customerOptionSnapshotLabels(
        [
          snapshot({
            listCustomerName: { es: "", en: "Punto customer" },
            labelCustomerName: { es: "  ", en: "Poco hecho customer" },
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
