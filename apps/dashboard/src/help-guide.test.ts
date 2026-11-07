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

it("links mail settings and removal to both guide languages", () => {
  expect(guideHref("email.set-up", "en-GB")).toBe("/help/en/email#set-up");
  expect(guideHref("email.remove", "en-GB")).toBe("/help/en/email#remove");
  expect(guideHref("email.set-up", "es")).toBe("/help/es/email#set-up");
  expect(guideHref("email.remove", "es")).toBe("/help/es/email#remove");
});
