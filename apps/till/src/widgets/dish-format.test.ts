import { beforeEach, expect, it } from "vitest";
import { setContentLanguages } from "@waitron/ui";
import { descriptionFor, dishLine, snapshotDescriptionFor, trimQuantity } from "./dish-format.js";

beforeEach(() => setContentLanguages({ defaultLanguage: "es", languages: ["es"] }));

it("trims a three-place quantity's trailing zeros and leaves a whole number alone", () => {
  expect(trimQuantity("2.000")).toBe("2");
  expect(trimQuantity("0.320")).toBe("0.32");
  expect(trimQuantity("10")).toBe("10");
});

it("trims a negative quantity, drops a bare point, and leaves a whole zero alone", () => {
  expect(trimQuantity("-0.50")).toBe("-0.5");
  expect(trimQuantity("2.")).toBe("2");
  expect(trimQuantity("0")).toBe("0");
});

it("keeps a stored receipt name in a language the venue has since disabled", () => {
  // Live catalogue text reads enabled languages only; a snapshot keeps whatever it was frozen in.
  const frozen = { ca: "Pa amb tomàquet" };
  expect(descriptionFor(frozen, "staff name", "es")).toBe("staff name");
  expect(snapshotDescriptionFor(frozen, "staff name", "es")).toBe("Pa amb tomàquet");
});

it("falls back to the given name when a stored receipt name has no text in any language", () => {
  expect(snapshotDescriptionFor({}, "staff name", "es")).toBe("staff name");
  expect(snapshotDescriptionFor({ es: "   ", en: "" }, "staff name", "es")).toBe("staff name");
});

it("leaves the unit out of a dish line counted in Each", () => {
  expect(
    dishLine({ quantity: "2.000", unitName: { es: "ud" }, soldInEach: true }, "Croqueta"),
  ).toBe("2× Croqueta");
});

it("shows no unit on a dish line with no unit snapshot", () => {
  expect(dishLine({ quantity: "2.000", unitName: null }, "Croqueta")).toBe("2× Croqueta");
});

it("keeps the unit when the payload carries no Each flag", () => {
  expect(dishLine({ quantity: "2.000", unitName: { es: "ud" } }, "Croqueta")).toBe(
    "2 ud× Croqueta",
  );
});

it("keeps a measured unit after the trimmed quantity", () => {
  expect(dishLine({ quantity: "0.500", unitName: { es: "kg" }, soldInEach: false }, "Pulpo")).toBe(
    "0.5 kg× Pulpo",
  );
});
