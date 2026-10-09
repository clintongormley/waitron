import { expect, it, onTestFinished } from "vitest";
import {
  byLabel,
  categoryAncestors,
  categoryPath,
  categoryRefusalErrors,
  categoryWithDescendants,
} from "./category-form.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { CategorySummary } from "../api/client.js";

const food: CategorySummary = {
  id: "food",
  name: "Food",
  parentId: null,
  color: null,
};
const child: CategorySummary = {
  id: "child",
  name: "Sandwiches",
  parentId: "food",
  color: null,
};

it.each([",", "."])("orders decimal weights by value with a %s separator", (separator) => {
  const names = [`0${separator}5 kg`, `1${separator}2 kg`, `0${separator}25 kg`];
  expect(names.sort(byLabel)).toEqual([
    `0${separator}25 kg`,
    `0${separator}5 kg`,
    `1${separator}2 kg`,
  ]);
});

it.each([",", "."])(
  "compares mixed names containing several numbers with %s decimals",
  (separator) => {
    expect(
      [
        `Pack 10 / 0${separator}25 kg`,
        `Pack 2 / 0${separator}5 kg`,
        `Pack 2 / 0${separator}25 kg`,
      ].sort(byLabel),
    ).toEqual([
      `Pack 2 / 0${separator}25 kg`,
      `Pack 2 / 0${separator}5 kg`,
      `Pack 10 / 0${separator}25 kg`,
    ]);
  },
);

it("keeps integer names in number order and text insensitive to case and accents", () => {
  expect(["Table 10", "Table 2", "Table 1"].sort(byLabel)).toEqual([
    "Table 1",
    "Table 2",
    "Table 10",
  ]);
  expect(byLabel("CAFÉ", "cafe")).toBe(0);
  expect(byLabel("", "")).toBe(0);
  expect(byLabel("", "Table 2")).toBeLessThan(0);
  expect(byLabel("Table 2", "")).toBeGreaterThan(0);
});

it("preserves punctuation order when one name's text run is a prefix of another", () => {
  expect(["Menu 2", "Menu (old)", "Menu 10"].sort(byLabel)).toEqual([
    "Menu (old)",
    "Menu 2",
    "Menu 10",
  ]);
  expect(byLabel("Pack 0.50 Menu 2", "Pack 0,5 Menu (old)")).toBeGreaterThan(0);
  expect(byLabel("Pack 0,5 Menu (old)", "Pack 0.50 Menu 2")).toBeLessThan(0);
});

it("compares equal decimal values by the remaining text, including leading and trailing zeros", () => {
  expect(byLabel("Pack 00,50 A", "Pack 0.5 B")).toBeLessThan(0);
  expect(byLabel("Pack 00,50", "Pack 0.5")).toBe(0);
  expect(byLabel("Pack 2", "Pack 2.0")).toBe(0);
  expect(byLabel("Pack 2.5", "Pack 2.5 kg")).toBeLessThan(0);
});

it("keeps decimal differences smaller than floating-point precision in the name order", () => {
  expect(byLabel("0.10000000000000001 kg", "0,10000000000000002 kg")).toBeLessThan(0);
  expect(byLabel("9007199254740993.0 kg", "9007199254740992,9 kg")).toBeGreaterThan(0);
});

it("names a category by the path of names down to it, joined by the shared separator or the one it is given", () => {
  expect(categoryPath(child, [food, child])).toBe("Food › Sandwiches");
  expect(categoryPath(child, [food, child], " / ")).toBe("Food / Sandwiches");
  expect(categoryPath(food, [food, child])).toBe("Food");
});

it("gathers a category and every category below it, whatever order the list is in", () => {
  const leaf: CategorySummary = { ...child, id: "leaf", parentId: "child" };
  const other: CategorySummary = { ...food, id: "other" };
  expect([...categoryWithDescendants("food", [leaf, other, child, food])].sort()).toEqual([
    "child",
    "food",
    "leaf",
  ]);
  expect([...categoryWithDescendants("leaf", [leaf, other, child, food])]).toEqual(["leaf"]);
});

it("walks up from a category to the top, stopping at a missing parent or a loop", () => {
  const leaf: CategorySummary = { ...child, id: "leaf", parentId: "child" };
  const ids = (from: CategorySummary, list: CategorySummary[]) =>
    categoryAncestors(from, list).map(({ id }) => id);
  expect(ids(leaf, [food, leaf, child])).toEqual(["leaf", "child", "food"]);
  expect(ids(leaf, [leaf, food])).toEqual(["leaf"]);
  // The walk starts from the category it is given, which the list need not hold.
  expect(ids(child, [food])).toEqual(["child", "food"]);
  const looped: CategorySummary = { ...food, parentId: "leaf" };
  expect(ids(leaf, [looped, leaf, child])).toEqual(["leaf", "child", "food"]);
});

const refusal = (code: string, params?: Record<string, unknown>) => ({ code, params, status: 400 });

it("puts a refused category write beside the form field it concerns", () => {
  for (const [code, field] of [["category.parent_cycle", "parent"]])
    expect(categoryRefusalErrors(refusal(code, {}))).toEqual({ [field]: codeMessage(code) });
  expect(categoryRefusalErrors(refusal("category.invalid", { field: "name" }))).toEqual({
    name: codeMessage("category.invalid"),
  });
  for (const [field, key] of [
    ["name", "name"],
    ["parentId", "parent"],
  ])
    expect(categoryRefusalErrors(refusal("management.request_invalid", { field }))).toEqual({
      [key]: codeMessage("management.request_invalid"),
    });
  // A missing category is the chosen parent only when it is the one the write named as parent.
  expect(categoryRefusalErrors(refusal("category.not_found", { categoryId: "c1" }), "c1")).toEqual({
    parent: codeMessage("category.not_found"),
  });
});

it("puts a refused colour under the colour chooser, and a refused name still beside the Name field", () => {
  expect(categoryRefusalErrors(refusal("category.invalid", { field: "color" }))).toEqual({
    color: t("editor.field_rejected"),
  });
  expect(categoryRefusalErrors(refusal("management.request_invalid", { field: "color" }))).toEqual({
    color: t("editor.field_rejected"),
  });
  for (const params of [{ field: "name" }, undefined])
    expect(categoryRefusalErrors(refusal("category.invalid", params))).toEqual({
      name: codeMessage("category.invalid"),
    });
});

it("puts a duplicate sibling name beside the Name field with a message of its own", () => {
  const locale = currentLocale();
  onTestFinished(() => setLocale(locale));
  setLocale("en-GB");
  expect(
    categoryRefusalErrors(refusal("category.name_taken", { field: "name", name: "Mains" })),
  ).toEqual({ name: "Another category in the same place already has this name." });
});

it("keeps a refused category write that names no field of the form for the bottom message alone", () => {
  for (const error of [
    refusal("content.translation_invalid", {}),
    refusal("content.translation_required", {}),
    refusal("content.translation_required", { language: "en" }),
    refusal("management.request_invalid", { field: "toString" }),
    refusal("management.request_invalid", { field: "image" }),
    refusal("management.request_invalid"),
    refusal("toString"),
    refusal("server.internal"),
    refusal("category.not_found", { categoryId: "c1" }),
  ])
    expect(categoryRefusalErrors(error)).toEqual({ _form: codeMessage(error.code) });
  expect(categoryRefusalErrors(refusal("category.not_found", { categoryId: "c2" }), "c1")).toEqual({
    _form: codeMessage("category.not_found"),
  });
});
