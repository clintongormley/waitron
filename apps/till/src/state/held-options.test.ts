import { afterEach, describe, expect, it } from "vitest";
import { customerOptionSnapshotLabels } from "@waitron/menu/src/option-snapshot-labels.js";
import { deriveOptionSelections, optionSnapshotOf, sameOptionSelections } from "./held-options.js";
import { withUnavailable } from "./menu-refresh.js";
import { currentContentLanguages, setContentLanguages } from "@waitron/ui";
import type { OfferedModifier, TillMenuOffer } from "../api/client.js";
import type { OptionSnapshot } from "@waitron/shared";

/** The list's three names, and each label's three, DIFFER, so a match made on the wrong one of the
 *  six fails. */
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

function frozen(listId: string, listStaff: string, labelStaff: string): OptionSnapshot {
  return {
    listId,
    listName: { es: listStaff },
    listCustomerName: { es: `${listStaff} para el cliente` },
    listKitchenName: `${listStaff} cocina`,
    labelName: { es: labelStaff },
    labelCustomerName: { es: `${labelStaff} para el cliente` },
    labelKitchenName: `${labelStaff} cocina`,
  };
}

const doneness = list("list-punto", "Punto", [
  ["label-medium", "Al punto"],
  ["label-rare", "Poco hecho"],
]);
const breadOptions = list("list-pan", "Pan", [["label-white", "Blanco"]]);
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

describe("a newly prepared option answer", () => {
  const original = currentContentLanguages();
  afterEach(() => setContentLanguages(original));

  it.each([
    [null, null, "Staff list", "Staff label"],
    [null, { fr: "French label" }, "Staff list", "Staff label"],
    [{ fr: "French list" }, { en: "English label" }, "Staff list", "English label"],
    [{ en: "English list", es: "Spanish list" }, {}, "English list", "Staff label"],
  ] as const)(
    "freezes independent default or staff values (%j, %j)",
    (listText, labelText, wantList, wantLabel) => {
      setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
      const selectedList = {
        id: "list-staff",
        name: "Staff list",
        customerName: listText,
        kitchenName: "LIST KITCHEN",
      };
      const selectedLabel = {
        name: "Staff label",
        customerName: labelText,
        kitchenName: "LABEL KITCHEN",
      };
      const before = structuredClone([selectedList, selectedLabel]);
      const answer = optionSnapshotOf(selectedList, selectedLabel);
      expect(answer).toEqual({
        listId: "list-staff",
        listName: { en: "Staff list" },
        listCustomerName: listText === null ? null : { en: wantList },
        listKitchenName: "LIST KITCHEN",
        labelName: { en: "Staff label" },
        labelCustomerName: labelText === null ? null : { en: wantLabel },
        labelKitchenName: "LABEL KITCHEN",
      });
      expect(customerOptionSnapshotLabels([answer], "fr")).toEqual([`${wantList}: ${wantLabel}`]);
      expect([selectedList, selectedLabel]).toEqual(before);
    },
  );
});

describe("deriveOptionSelections", () => {
  it("does not match a label the live offer has since marked unavailable", () => {
    const offer = { productId: "dish", variants: [], offeredModifiers: [doneness] };
    const [live] = withUnavailable([offer as unknown as TillMenuOffer], {
      products: [],
      optionLabels: ["label-rare"],
    });
    expect(
      deriveOptionSelections(live!.offeredModifiers, [frozen("list-punto", "Punto", "Poco hecho")]),
    ).toEqual({ options: [], unanswered: [] });
  });

  it("names the list and the label whose staff names the answer froze", () => {
    expect(
      deriveOptionSelections([doneness], [frozen("list-punto", "Punto", "Poco hecho")]),
    ).toEqual({
      options: [{ listId: "list-punto", labelId: "label-rare" }],
      unanswered: [],
    });
  });

  it("answers every offered list, in the order the dish offers them", () => {
    const result = deriveOptionSelections(
      [doneness, toppings, breadOptions],
      [frozen("list-pan", "Pan", "Blanco"), frozen("list-punto", "Punto", "Al punto")],
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
    expect(
      deriveOptionSelections([doneness, breadOptions], [frozen("list-pan", "Pan", "Blanco")]),
    ).toEqual({
      options: [{ listId: "list-pan", labelId: "label-white" }],
      unanswered: ["list-punto"],
    });
  });

  it("keeps a recorded answer whose chosen label was renamed without selecting a substitute", () => {
    expect(
      deriveOptionSelections([doneness], [frozen("list-punto", "Punto", "A la brasa")]),
    ).toEqual({
      options: [],
      unanswered: [],
    });
  });

  it("leaves out an answer no offered list matches, since nothing may name it", () => {
    // The Pan list was deactivated between the park and the edit, so the server would refuse an
    // answer to it.
    expect(
      deriveOptionSelections(
        [doneness],
        [frozen("list-pan", "Pan", "Blanco"), frozen("list-punto", "Punto", "Al punto")],
      ),
    ).toEqual({ options: [{ listId: "list-punto", labelId: "label-medium" }], unanswered: [] });
  });

  it("gives two lists sharing a staff name one answer each", () => {
    const otherDoneness = list("list-punto-2", "Punto", [["label-medium-2", "Al punto"]]);
    const result = deriveOptionSelections(
      [doneness, otherDoneness],
      [frozen("list-punto-2", "Punto", "Al punto"), frozen("list-punto", "Punto", "Al punto")],
    );
    expect(result.options).toEqual([
      { listId: "list-punto", labelId: "label-medium" },
      { listId: "list-punto-2", labelId: "label-medium-2" },
    ]);
    expect(result.unanswered).toEqual([]);
  });

  it("does not let a new list claim a deleted list's answer even when the wording matches", () => {
    const replacement = list("list-punto-2", "Punto", [["label-medium-2", "Al punto"]]);
    expect(
      deriveOptionSelections([replacement], [frozen("list-punto", "Punto", "Al punto")]),
    ).toEqual({ options: [], unanswered: ["list-punto-2"] });
  });

  it("matches nothing when an answer arrives with no staff name in it", () => {
    const nameless = { ...frozen("list-punto", "Punto", "Al punto"), listName: {} };
    expect(deriveOptionSelections([doneness], [nameless])).toEqual({
      options: [],
      unanswered: [],
    });
  });

  it("answers nothing for a dish offering no options list, and for a line that froze none", () => {
    expect(deriveOptionSelections([toppings], [frozen("list-punto", "Punto", "Al punto")])).toEqual(
      {
        options: [],
        unanswered: [],
      },
    );
    expect(deriveOptionSelections([doneness], undefined)).toEqual({
      options: [],
      unanswered: ["list-punto"],
    });
  });
});

describe("sameOptionSelections", () => {
  const cooked = { listId: "list-cooked", labelId: "label-rare" };
  const bread = { listId: "list-bread", labelId: "label-gluten-free" };

  it("compares the answers as a set, whatever order they come in", () => {
    expect(sameOptionSelections([cooked, bread], [bread, cooked])).toBe(true);
  });

  it("tells a different label, a missing answer and an extra answer apart", () => {
    expect(sameOptionSelections([cooked], [{ ...cooked, labelId: "label-medium" }])).toBe(false);
    expect(sameOptionSelections([cooked, bread], [cooked])).toBe(false);
    expect(sameOptionSelections([], [bread])).toBe(false);
  });

  it("does not take one list's label for another list's", () => {
    expect(
      sameOptionSelections(
        [cooked, bread],
        [
          { listId: "list-cooked", labelId: "label-gluten-free" },
          { listId: "list-bread", labelId: "label-rare" },
        ],
      ),
    ).toBe(false);
  });
});
