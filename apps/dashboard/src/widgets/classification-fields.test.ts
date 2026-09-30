import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, type TemplateResult } from "lit";
import { categoryField } from "./classification-fields.js";
import type { CategorySummary } from "../api/client.js";

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
  placeholder: string;
  error: string;
  disabled: boolean;
  label: string;
};

const food: CategorySummary = {
  id: "food",
  name: "Comida",
  parentId: null,
};
const tapas: CategorySummary = {
  id: "tapas",
  name: "Tapas",
  parentId: "food",
};
const drinks: CategorySummary = {
  id: "drinks",
  name: "Bebidas",
  parentId: null,
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

it("offers none and then every category by its path, sorted, with the chosen one selected", async () => {
  const combobox = await mount(
    categoryField({
      name: "primary",
      label: "Main category",
      categories: [tapas, food, drinks],
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
    name: name,
    parentId: null,
  });
  const combobox = await mount(
    categoryField({
      name: "primary",
      label: "Main category",
      categories: [named("c10", "Cat 10"), named("c9", "Cat 9")],
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
