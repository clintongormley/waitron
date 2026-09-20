import { describe, expect, it } from "vitest";
import { optionSnapshotLabels } from "./option-snapshot-labels.js";

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
