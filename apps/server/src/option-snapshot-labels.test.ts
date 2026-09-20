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

  it("takes any stored text when the requested locale is not a key of the map", () => {
    // A receipt asks for a full tag ("es-ES") while a frozen staff map is keyed by the venue's
    // default content language ("es"), so the exact-key lookup misses on every real filed line.
    expect(customerOptionSnapshotLabels([snapshot({ listCustomerName: null })], "es-ES")).toEqual([
      "Punto staff: Poco hecho customer",
    ]);
  });
});
