import { describe, expect, it } from "vitest";
import { deriveOptionSelections } from "./held-options.js";
import type { OfferedModifier } from "../api/client.js";
import type { OptionSnapshot } from "@waitron/shared";

/** One offered options list. Its three names, and each label's three, DIFFER, so a match made on the
 *  wrong one of the six fails (CLAUDE.md §4). */
function list(id: string, staff: string, labels: [string, string][]): OfferedModifier {
  return {
    kind: "options",
    id,
    name: staff,
    customerName: { es: `${staff} para el cliente` },
    kitchenName: `${staff} cocina`,
    defaultLabelId: null,
    labels: labels.map(([labelId, labelStaff]) => ({
      id: labelId,
      name: labelStaff,
      customerName: { es: `${labelStaff} para el cliente` },
      kitchenName: `${labelStaff} cocina`,
      available: true,
    })),
  };
}

/** One answer as a held order hands it back: six names, and no id anywhere. */
function frozen(listStaff: string, labelStaff: string): OptionSnapshot {
  return {
    listName: { es: listStaff },
    listCustomerName: { es: `${listStaff} para el cliente` },
    listKitchenName: `${listStaff} cocina`,
    labelName: { es: labelStaff },
    labelCustomerName: { es: `${labelStaff} para el cliente` },
    labelKitchenName: `${labelStaff} cocina`,
  };
}

const punto = list("list-punto", "Punto", [
  ["label-medium", "Al punto"],
  ["label-rare", "Poco hecho"],
]);
const pan = list("list-pan", "Pan", [["label-white", "Blanco"]]);
const toppings: OfferedModifier = {
  kind: "extras",
  id: "list-toppings",
  name: "Toppings",
  customerName: { es: "Toppings para el cliente" },
  kitchenName: "Toppings cocina",
  minPicks: 0,
  maxPicks: null,
  items: [],
};

describe("deriveOptionSelections", () => {
  it("names the list and the label whose staff names the answer froze", () => {
    expect(deriveOptionSelections([punto], [frozen("Punto", "Poco hecho")])).toEqual({
      options: [{ listId: "list-punto", labelId: "label-rare" }],
      unanswered: [],
    });
  });

  it("answers every offered list, in the order the dish offers them", () => {
    const result = deriveOptionSelections(
      [punto, toppings, pan],
      [frozen("Pan", "Blanco"), frozen("Punto", "Al punto")],
    );
    expect(result.options).toEqual([
      { listId: "list-punto", labelId: "label-medium" },
      { listId: "list-pan", labelId: "label-white" },
    ]);
    expect(result.unanswered).toEqual([]);
  });

  it("reports a list no frozen answer names, rather than filling it in", () => {
    // The dish's Pan list was answered before Punto was attached to it. Inventing an answer would
    // change what the diner asked for on a line that is about to be billed.
    expect(deriveOptionSelections([punto, pan], [frozen("Pan", "Blanco")])).toEqual({
      options: [{ listId: "list-pan", labelId: "label-white" }],
      unanswered: ["list-punto"],
    });
  });

  it("reports a list whose chosen label was renamed, and names no other label of it", () => {
    expect(deriveOptionSelections([punto], [frozen("Punto", "A la brasa")])).toEqual({
      options: [],
      unanswered: ["list-punto"],
    });
  });

  it("leaves out an answer no offered list matches, since nothing may name it", () => {
    // The Pan list was deactivated between the park and the edit: `validateOptionSelections` asks
    // for no answer to it and refuses one (`options.invalid`), so the wire carries none.
    expect(
      deriveOptionSelections([punto], [frozen("Pan", "Blanco"), frozen("Punto", "Al punto")]),
    ).toEqual({ options: [{ listId: "list-punto", labelId: "label-medium" }], unanswered: [] });
  });

  it("gives two lists sharing a staff name one answer each", () => {
    const otherPunto = list("list-punto-2", "Punto", [["label-medium-2", "Al punto"]]);
    const result = deriveOptionSelections(
      [punto, otherPunto],
      [frozen("Punto", "Al punto"), frozen("Punto", "Al punto")],
    );
    expect(result.options).toEqual([
      { listId: "list-punto", labelId: "label-medium" },
      { listId: "list-punto-2", labelId: "label-medium-2" },
    ]);
    expect(result.unanswered).toEqual([]);
  });

  it("matches nothing when an answer arrives with no staff name in it", () => {
    // A list and a label each hold a non-blank staff name (`staffName`,
    // `packages/catalogue/src/option-contract.ts` refuses a blank one), so an empty map is an answer
    // that lost the wording it is identified by — which must not fall through to a match.
    const nameless = { ...frozen("Punto", "Al punto"), listName: {} };
    expect(deriveOptionSelections([punto], [nameless])).toEqual({
      options: [],
      unanswered: ["list-punto"],
    });
  });

  it("answers nothing for a dish offering no options list, and for a line that froze none", () => {
    expect(deriveOptionSelections([toppings], [frozen("Punto", "Al punto")])).toEqual({
      options: [],
      unanswered: [],
    });
    expect(deriveOptionSelections([punto], undefined)).toEqual({
      options: [],
      unanswered: ["list-punto"],
    });
  });
});
