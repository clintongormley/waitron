import { beforeEach, expect, it } from "vitest";
import { setContentLanguages } from "@waitron/ui";
import { descriptionFor, snapshotDescriptionFor, trimQuantity } from "./dish-format.js";

beforeEach(() => setContentLanguages({ defaultLanguage: "es", languages: ["es"] }));

it("trims a three-place quantity's trailing zeros and leaves a whole number alone", () => {
  expect(trimQuantity("2.000")).toBe("2");
  expect(trimQuantity("0.320")).toBe("0.32");
  expect(trimQuantity("10")).toBe("10");
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
