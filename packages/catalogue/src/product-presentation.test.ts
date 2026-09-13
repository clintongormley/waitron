import { expect, it } from "vitest";
import { productPresentationName, kitchenPresentationName } from "./product-presentation.js";

it("resolves product and variant names separately using recorded translations", () => {
  const presentation = {
    productName: { es: "Café", en: "Coffee" },
    variantName: { es: "Grande" },
    kitchenName: null,
  };
  expect(productPresentationName(presentation, "en-GB", "es")).toBe("Coffee · Grande");
  expect(kitchenPresentationName(presentation, "es-ES", "es")).toBe("Café · Grande");
  expect(productPresentationName(presentation, "it", "it")).toBe("Coffee · Grande");
});
it("uses a kitchen override with the variant and falls back when blank", () => {
  const presentation = {
    productName: { en: "Coffee" },
    variantName: { en: "Large" },
    kitchenName: "BAR",
  };
  expect(kitchenPresentationName(presentation, "en", "en")).toBe("BAR · Large");
  expect(kitchenPresentationName({ ...presentation, kitchenName: "  " }, "en", "en")).toBe(
    "Coffee · Large",
  );
  expect(productPresentationName(presentation, "en", "en")).toBe("Coffee · Large");
  expect(kitchenPresentationName({ ...presentation, variantName: null }, "en", "en")).toBe("BAR");
});
