import { expect, it } from "vitest";
import { t } from "../i18n/t.js";
import { memberKindLabel, memberName } from "./member-names.js";

const products = new Map([
  ["p-burger", "Burger"],
  ["s-drinks", "Product keyed like a section"],
]);
const sections = new Map([
  ["s-drinks", "Drinks"],
  ["p-burger", "Section keyed like a product"],
]);

it("names a product from the product map and a section from the section map", () => {
  expect(memberName({ kind: "product", productId: "p-burger" }, products, sections)).toBe("Burger");
  expect(memberName({ kind: "section", sectionId: "s-drinks" }, products, sections)).toBe("Drinks");
});

it("names a missing member by the name it carries", () => {
  expect(memberName({ kind: "missing", name: "Old soup" }, products, sections)).toBe("Old soup");
});

it("names a product or section it does not know as unavailable", () => {
  expect(memberName({ kind: "product", productId: "p-gone" }, products, sections)).toBe(
    t("members.missing"),
  );
  expect(memberName({ kind: "section", sectionId: "s-gone" }, products, sections)).toBe(
    t("members.missing"),
  );
});

it("labels each kind of member with its own text", () => {
  expect(memberKindLabel({ kind: "product", productId: "p-burger" })).toBe(
    t("members.kind_product"),
  );
  expect(memberKindLabel({ kind: "section", sectionId: "s-drinks" })).toBe(
    t("members.kind_section"),
  );
  expect(memberKindLabel({ kind: "missing", name: "Old soup" })).toBe(t("members.missing"));
  expect(
    new Set([t("members.kind_product"), t("members.kind_section"), t("members.missing")]).size,
  ).toBe(3);
});
