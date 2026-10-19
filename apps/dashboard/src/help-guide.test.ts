import { expect, it } from "vitest";
import { guideHref } from "./help-guide.js";

it("builds an English link for an English or unknown locale and a Spanish one for es-*", () => {
  expect(guideHref("products.course", "en-GB")).toBe("/help/en/products#course");
  expect(guideHref("products.course", "es-ES")).toBe("/help/es/products#course");
  expect(guideHref("products.course", "es")).toBe("/help/es/products#course");
  expect(guideHref("products.course", "fr-FR")).toBe("/help/en/products#course");
});

it("keeps the section", () => {
  expect(guideHref("products.selling-unit", "en-GB")).toBe("/help/en/products#selling-unit");
  expect(guideHref("products.variants", "en-GB")).toBe("/help/en/products#variants");
});
