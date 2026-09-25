import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, type TemplateResult } from "lit";
import { categoryField, labelsField, labelsText } from "./classification-fields.js";
import type { CategorySummary, Label } from "../api/client.js";

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => host.remove());

type Combobox = HTMLElement & {
  updateComplete: Promise<unknown>;
  options: { value: string; label: string }[];
  value: string;
  values: string[];
  placeholder: string;
  error: string;
  disabled: boolean;
  label: string;
  multiple: boolean;
};

const food: CategorySummary = {
  id: "food",
  name: { es: "Comida" },
  image: null,
  color: null,
  parentId: null,
};
const tapas: CategorySummary = {
  id: "tapas",
  name: { es: "Tapas" },
  image: null,
  color: null,
  parentId: "food",
};
const drinks: CategorySummary = {
  id: "drinks",
  name: { es: "Bebidas" },
  image: null,
  color: null,
  parentId: null,
};
const languages = { defaultLanguage: "es", languages: ["es"] };
const alcoholic: Label = { id: "l-alc", name: "Alcoholic" };
const happy: Label = { id: "l-happy", name: "Happy hour drinks" };

async function mount(template: TemplateResult): Promise<Combobox> {
  render(template, host);
  const combobox = host.querySelector<Combobox>("wt-combobox")!;
  await combobox.updateComplete;
  return combobox;
}

function pick(combobox: HTMLElement, detail: { value: string } | { values: string[] }): void {
  combobox.dispatchEvent(new CustomEvent("wt-change", { detail, bubbles: true, composed: true }));
}

it("offers none and then every category by its path, sorted, with the chosen one selected", async () => {
  const combobox = await mount(
    categoryField({
      name: "primary",
      label: "Main category",
      categories: [tapas, food, drinks],
      languages,
      value: "tapas",
      noneLabel: "Uncategorised",
      disabled: false,
      change: () => {},
    }),
  );
  expect(combobox.getAttribute("name")).toBe("primary");
  expect(combobox.label).toBe("Main category");
  expect(combobox.options).toEqual([
    { value: "", label: "Uncategorised" },
    { value: "drinks", label: "Bebidas" },
    { value: "food", label: "Comida" },
    { value: "tapas", label: "Comida / Tapas" },
  ]);
  expect(combobox.value).toBe("tapas");
  expect(combobox.placeholder).toBe("Uncategorised");
});

it("orders numbered category paths by value, as the tables do", async () => {
  const named = (id: string, name: string): CategorySummary => ({
    id,
    name: { es: name },
    image: null,
    color: null,
    parentId: null,
  });
  const combobox = await mount(
    categoryField({
      name: "primary",
      label: "Main category",
      categories: [named("c10", "Cat 10"), named("c9", "Cat 9")],
      languages,
      value: null,
      noneLabel: "Uncategorised",
      disabled: false,
      change: () => {},
    }),
  );
  expect(combobox.options.map((option) => option.label)).toEqual([
    "Uncategorised",
    "Cat 9",
    "Cat 10",
  ]);
});

it("leaves out the excluded categories and shows the error it is given", async () => {
  const combobox = await mount(
    categoryField({
      name: "children-to",
      label: "Subcategories go to",
      categories: [food, tapas, drinks],
      languages,
      value: null,
      noneLabel: "Top level",
      exclude: new Set(["food", "tapas"]),
      error: "Choose another",
      disabled: true,
      change: () => {},
    }),
  );
  expect(combobox.options.map((option) => option.value)).toEqual(["", "drinks"]);
  expect(combobox.value).toBe("");
  expect(combobox.error).toBe("Choose another");
  expect(combobox.disabled).toBe(true);
});

it("reports a picked category, and none as null, without letting the combobox's event escape", async () => {
  const change = vi.fn();
  const escaped = vi.fn();
  host.addEventListener("wt-change", escaped);
  const combobox = await mount(
    categoryField({
      name: "primary",
      label: "Main category",
      categories: [food],
      languages,
      value: null,
      noneLabel: "Uncategorised",
      disabled: false,
      change,
    }),
  );
  pick(combobox, { value: "food" });
  pick(combobox, { value: "" });
  expect(change.mock.calls).toEqual([["food"], [null]]);
  expect(escaped).not.toHaveBeenCalled();
});

it("offers every label by name, sorted, and lists the chosen ones as lozenges", async () => {
  const change = vi.fn();
  const combobox = await mount(
    labelsField({ labels: [happy, alcoholic], value: ["l-happy"], disabled: false, change }),
  );
  expect(combobox.getAttribute("name")).toBe("labels");
  expect(combobox.multiple).toBe(true);
  expect(combobox.options).toEqual([
    { value: "l-alc", label: "Alcoholic" },
    { value: "l-happy", label: "Happy hour drinks" },
  ]);
  expect(combobox.values).toEqual(["l-happy"]);
  expect([...host.querySelectorAll("wt-lozenge")].map((chip) => chip.textContent)).toEqual([
    "Happy hour drinks",
  ]);
  pick(combobox, { values: ["l-happy", "l-alc"] });
  expect(change).toHaveBeenCalledWith(["l-happy", "l-alc"]);
});

const promo10: Label = { id: "l-10", name: "Promo 10" };
const promo9: Label = { id: "l-9", name: "Promo 9" };

it("offers and shows numbered labels by value, as the tables do", async () => {
  const combobox = await mount(
    labelsField({
      labels: [promo10, promo9],
      value: ["l-10", "l-9"],
      disabled: false,
      change: () => {},
    }),
  );
  expect(combobox.options.map((option) => option.label)).toEqual(["Promo 9", "Promo 10"]);
  expect([...host.querySelectorAll("wt-lozenge")].map((chip) => chip.textContent)).toEqual([
    "Promo 9",
    "Promo 10",
  ]);
});

it("names numbered labels by value, as the tables do", () => {
  expect(labelsText(["l-10", "l-9"], [promo10, promo9], "Missing")).toBe("Promo 9, Promo 10");
});

it("names a product's labels sorted by name, marking one that no longer exists", () => {
  expect(labelsText(["l-happy", "gone", "l-alc"], [alcoholic, happy], "Missing")).toBe(
    "Alcoholic, Happy hour drinks, Missing",
  );
  expect(labelsText([], [alcoholic, happy], "Missing")).toBe("");
});
