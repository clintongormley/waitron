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
    // goods identification off a legal receipt while every other assertion still passed.
    //
    // Each map here holds TWO non-blank values, under keys whose sorted order differs from their
    // insertion order: "es" is blank, so sorted keys (en, es, gl) reach the ENGLISH text first
    // while insertion order (es, gl, en) would reach the Galician. The assertion therefore fails if
    // the `.sort()` in `resolveSnapshotText` (`packages/shared/src/content-languages.ts`) is
    // deleted — proven that way, and the deleted-sort run printed the Galician pair.
    //
    // Note the resolver sorts ALL the keys and then takes the first non-blank VALUE; it does not
    // drop the blanks and sort what is left. The two orders coincide here, but a key that sorted
    // before "en" and held only blanks would still be looked at and passed over.
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
    // `buildLineExtras` (`apps/server/src/modifier-selection.ts`) writes
    // `listName: { [defaultLanguage]: list.name }`, so the key is the venue's default content
    // language and the map holds one entry. A builder that looked up a fixed key would print
    // nothing for a venue whose default is not that key.
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
