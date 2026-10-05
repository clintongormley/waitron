import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, type TemplateResult } from "lit";
import { categoryPathField, categoryPathText } from "./classification-fields.js";
import type { CategorySummary } from "../api/client.js";

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => host.remove());

type Combobox = HTMLElement & {
  updateComplete: Promise<unknown>;
  options: { value: string; label: string; depth?: number; valueLabel?: string }[];
  value: string;
  placeholder: string;
  error: string;
  invalid: boolean;
  disabled: boolean;
  label: string;
  appearance: string;
  actionLabel: string;
  showEmptyOption: boolean;
};

const fieldOf = (overrides: Partial<Parameters<typeof categoryPathField>[0]>) =>
  categoryPathField({
    name: "primary",
    label: "Category",
    actionLabel: "Change",
    categories: [tapas, food, drinks],
    value: null,
    noneLabel: "Uncategorised",
    missingLabel: "Unavailable",
    disabled: false,
    change: () => {},
    ...overrides,
  });

const food: CategorySummary = {
  id: "food",
  name: "Comida",
  parentId: null,
  color: null,
};
const tapas: CategorySummary = {
  id: "tapas",
  name: "Tapas",
  parentId: "food",
  color: null,
};
const drinks: CategorySummary = {
  id: "drinks",
  name: "Bebidas",
  parentId: null,
  color: null,
};

async function mount(template: TemplateResult): Promise<Combobox> {
  render(template, host);
  const combobox = host.querySelector<Combobox>("wt-combobox")!;
  await combobox.updateComplete;
  return combobox;
}

function pick(combobox: HTMLElement, detail: { value: string }): void {
  combobox.dispatchEvent(new CustomEvent("wt-change", { detail, bubbles: true, composed: true }));
}

it("offers none and then every category as a tree, each named by its own name and chosen by its path", async () => {
  const combobox = await mount(fieldOf({ value: "tapas" }));
  expect(combobox.getAttribute("name")).toBe("primary");
  expect(combobox.label).toBe("Category");
  expect(combobox.appearance).toBe("link");
  expect(combobox.actionLabel).toBe("Change");
  expect(combobox.showEmptyOption).toBe(true);
  expect(combobox.options).toEqual([
    { value: "", label: "Uncategorised" },
    { value: "drinks", label: "Bebidas", depth: 0, valueLabel: "Bebidas" },
    { value: "food", label: "Comida", depth: 0, valueLabel: "Comida" },
    { value: "tapas", label: "Tapas", depth: 1, valueLabel: "Comida › Tapas" },
  ]);
  expect(combobox.value).toBe("tapas");
  expect(combobox.placeholder).toBe("Unavailable");
});

it("orders numbered sibling categories by value, as the tables do", async () => {
  const named = (id: string, name: string): CategorySummary => ({
    id,
    name: name,
    parentId: null,
    color: null,
  });
  const combobox = await mount(
    fieldOf({ categories: [named("c10", "Cat 10"), named("c9", "Cat 9")] }),
  );
  expect(combobox.options.map((option) => option.label)).toEqual([
    "Uncategorised",
    "Cat 9",
    "Cat 10",
  ]);
});

it("lists a category whose parent the list lacks at the top level", async () => {
  const combobox = await mount(fieldOf({ categories: [tapas, drinks] }));
  expect(combobox.options.slice(1)).toEqual([
    { value: "drinks", label: "Bebidas", depth: 0, valueLabel: "Bebidas" },
    { value: "tapas", label: "Tapas", depth: 0, valueLabel: "Tapas" },
  ]);
});

it("shows the error it is given, and can be disabled", async () => {
  const combobox = await mount(fieldOf({ error: "Choose another", disabled: true }));
  expect(combobox.value).toBe("");
  expect(combobox.error).toBe("Choose another");
  expect(combobox.invalid).toBe(true);
  expect(combobox.disabled).toBe(true);
});

it("reports a picked category, and none as null, without letting the combobox's event escape", async () => {
  const change = vi.fn();
  const escaped = vi.fn();
  host.addEventListener("wt-change", escaped);
  const combobox = await mount(fieldOf({ categories: [food], change }));
  pick(combobox, { value: "food" });
  pick(combobox, { value: "" });
  expect(change.mock.calls).toEqual([["food"], [null]]);
  expect(escaped).not.toHaveBeenCalled();
});

it("writes a category's whole path, or the missing wording for an id the list lacks", () => {
  expect(categoryPathText("tapas", [food, tapas], "Unavailable")).toBe("Comida › Tapas");
  expect(categoryPathText("gone", [food, tapas], "Unavailable")).toBe("Unavailable");
});
