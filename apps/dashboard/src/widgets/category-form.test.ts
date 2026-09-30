import { userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import {
  CategoryForm,
  categoryAncestors,
  categoryRefusalErrors,
  categoryWithDescendants,
} from "./category-form.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import type { CategoryInput, CategorySummary } from "../api/client.js";
afterEach(cleanupWidgets);
afterEach(() => setLocale("es-ES"));
const food: CategorySummary = {
  id: "food",
  name: "Food",
  parentId: null,
};
const child: CategorySummary = {
  id: "child",
  name: "Sandwiches",
  parentId: "food",
};

async function bottomOf(el: CategoryForm): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}

const nameOf = (el: CategoryForm) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('wt-input[name="name"]')!;

const saveOf = (el: CategoryForm): HTMLElementTagNameMap["wt-button"] =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save"]')!;

function typeName(el: CategoryForm, value: string): void {
  nameOf(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

it("renders one name field holding the name, and excludes self and descendants from parent choices", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    value: food,
    categories: [food, child],
  });
  expect(el.shadowRoot!.querySelectorAll("wt-input")).toHaveLength(1);
  expect(nameOf(el).value).toBe("Food");
  expect(el.shadowRoot!.querySelector("dashboard-image-upload")).toBeNull();
  expect(el.shadowRoot!.querySelector('[role="radiogroup"]')).toBeNull();
  expect(el.shadowRoot!.querySelector('input[type="color"]')).toBeNull();
  const combo = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    'wt-combobox[name="category-parent"]',
  )!;
  expect(combo.options.map((o) => o.value)).toEqual([""]);
});
it("renders exactly one name field whatever content languages the venue has enabled", async () => {
  // `languages` is what the form took when it had a field per language; it is ignored now.
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    languages: { defaultLanguage: "es", languages: ["es", "en", "fr"] },
  } as Partial<CategoryForm>);
  expect(el.shadowRoot!.querySelectorAll('wt-input[name="name"]')).toHaveLength(1);
  expect(el.shadowRoot!.querySelectorAll("wt-input")).toHaveLength(1);
});
it("names a parent option by the path of names down to it", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    categories: [food, child],
  });
  const combo = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    'wt-combobox[name="category-parent"]',
  )!;
  expect(combo.options.map((o) => o.label)).toEqual([
    t("categories.no_parent"),
    "Food",
    "Food / Sandwiches",
  ]);
});
it("lists parent options alphabetically by their displayed label, with No parent pinned first", async () => {
  setLocale("en-GB");
  const zebra: CategorySummary = {
    id: "zebra",
    name: "Zebra",
    parentId: null,
  };
  const apple: CategorySummary = {
    id: "apple",
    name: "Apple",
    parentId: null,
  };
  const mango: CategorySummary = {
    id: "mango",
    name: "Mango",
    parentId: null,
  };
  // Two numeric names to pin the same collation the tables on this screen use: "Salsa 2" sorts
  // before "Salsa 10", not after it as a plain string compare would put it.
  const salsa10: CategorySummary = {
    id: "salsa10",
    name: "Salsa 10",
    parentId: null,
  };
  const salsa2: CategorySummary = {
    id: "salsa2",
    name: "Salsa 2",
    parentId: null,
  };
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    categories: [zebra, apple, mango, salsa10, salsa2],
    value: null,
  });
  const combo = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    'wt-combobox[name="category-parent"]',
  )!;
  expect(combo.options[0]!.value).toBe("");
  expect(combo.options.slice(1).map((o) => o.label)).toEqual([
    "Apple",
    "Mango",
    "Salsa 2",
    "Salsa 10",
    "Zebra",
  ]);
});
it("retains the draft during lookup refreshes, validates and emits the reusable submit contract once", async () => {
  const { el, host } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    categories: [food, child],
  });
  let submitted: { value: CategoryInput } | undefined;
  let count = 0;
  host.addEventListener("wt-submit", (event) => {
    submitted = (event as CustomEvent).detail;
    count++;
  });
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  await el.updateComplete;
  expect(nameOf(el).error).not.toBe("");
  expect(count).toBe(0);
  nameOf(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Breakfast" }, bubbles: true, composed: true }),
  );
  el.categories = [...el.categories];
  await el.updateComplete;
  const input = nameOf(el);
  await input.updateComplete;
  input
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  expect(count).toBe(1);
  expect(submitted).toEqual({
    value: { name: "Breakfast", parentId: null },
  });
});
it("creates inside a host draft, selects the saved category and leaves the draft intact", async () => {
  const { el, host } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    categories: [food],
  });
  const draft = document.createElement("input");
  draft.name = "product-name";
  draft.value = "Avocado toast";
  host.prepend(draft);
  let selected = "";
  const saved = new Promise<void>((resolve) =>
    host.addEventListener(
      "wt-submit",
      (event) => {
        event.stopPropagation();
        const input = (event as CustomEvent<{ value: CategoryInput }>).detail.value;
        // The host owns the durable category write and adds its returned identity to its product draft.
        void Promise.resolve({ id: "breakfast", ...input }).then((category) => {
          selected = category.id;
          el.open = false;
          resolve();
        });
      },
      { once: true },
    ),
  );
  nameOf(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Breakfast" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  await saved;
  await el.updateComplete;
  expect(selected).toBe("breakfast");
  expect(draft.value).toBe("Avocado toast");
  expect(el.open).toBe(false);
});

it("emits cancellation across the host boundary when Escape closes the modal", async () => {
  const { el, host } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
  });
  let detail: unknown;
  host.addEventListener("wt-cancel", (event) => {
    detail = (event as CustomEvent).detail;
  });
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  const dialog = modal.shadowRoot!.querySelector("dialog")!;
  expect(dialog.open).toBe(true);
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(detail).toEqual({}));
});

it("sends one wt-cancel when the dialog reports its close after the form has been closed", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
  });
  let cancels = 0;
  el.addEventListener("wt-cancel", () => cancels++);

  el.shadowRoot!.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
  el.open = false;
  await el.updateComplete;
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  await closeReportsDelivered();

  expect(cancels).toBe(1);
});

it("sends one wt-cancel when its dialog is dismissed with Escape while the form is open", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
  });
  let cancels = 0;
  el.addEventListener("wt-cancel", () => cancels++);

  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(cancels).toBe(1));
  await closeReportsDelivered();

  expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
  expect(cancels).toBe(1);
});

it("keeps the editor open when Escape is pressed during a save", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    busy: true,
    value: food,
  });
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  await userEvent.keyboard("{Escape}");
  expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
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

it("submits the chosen parent and returns to no parent when None is chosen", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    value: child,
    categories: [food, child],
  });
  const submitted: CategoryInput[] = [];
  el.addEventListener("wt-submit", (event) => {
    submitted.push((event as CustomEvent<{ value: CategoryInput }>).detail.value);
  });
  const parent = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    'wt-combobox[name="category-parent"]',
  )!;
  const save = el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!;
  expect(parent.value).toBe("food");
  parent.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  save.click();
  parent.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "food" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  save.click();
  expect(submitted.map((value) => value.parentId)).toEqual([null, "food"]);
});

it("emits a bubbling, composed wt-cancel with an empty detail from Cancel", async () => {
  const { el, host } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    value: food,
  });
  const cancel = vi.fn();
  host.addEventListener("wt-cancel", cancel);
  el.shadowRoot!.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
  expect(cancel).toHaveBeenCalledOnce();
  expect(cancel.mock.calls[0]![0].detail).toEqual({});
});

it("neither saves nor cancels while a save is in flight", async () => {
  const { el, host } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    busy: true,
    value: food,
  });
  const seen = vi.fn();
  host.addEventListener("wt-submit", seen);
  host.addEventListener("wt-cancel", seen);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  el.shadowRoot!.querySelector("wt-modal")!.dispatchEvent(
    new CustomEvent("wt-close", { bubbles: true, composed: true }),
  );
  expect(seen).not.toHaveBeenCalled();
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

it("keeps a refused category write that names no field of the form for the bottom message alone", () => {
  for (const error of [
    refusal("content.translation_invalid", {}),
    refusal("content.translation_required", {}),
    refusal("content.translation_required", { language: "en" }),
    refusal("management.request_invalid", { field: "toString" }),
    refusal("management.request_invalid", { field: "image" }),
    refusal("management.request_invalid", { field: "color" }),
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

it("says nothing about errors before the first submission, and Save works", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
  });
  typeName(el, "");
  await el.updateComplete;

  expect(nameOf(el).error).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("on an invalid submission shows the field and bottom messages, focuses the name and disables Save", async () => {
  const { el, host } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
  });
  const submit = vi.fn();
  host.addEventListener("wt-submit", submit);
  typeName(el, "  ");
  await el.updateComplete;
  saveOf(el).click();
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve));

  expect(submit).not.toHaveBeenCalled();
  expect(nameOf(el).error).toBe(t("categories.name_required"));
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(nameOf(el).shadowRoot!.activeElement).toBe(nameOf(el).shadowRoot!.querySelector("input"));
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);
});

it("re-checks every change after a failed submission, and Save works again once fixed", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
  });
  saveOf(el).click();
  await el.updateComplete;

  typeName(el, "Breakfast");
  await el.updateComplete;
  expect(nameOf(el).error).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);

  typeName(el, " ");
  await el.updateComplete;
  expect(nameOf(el).error).toBe(t("categories.name_required"));
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);
});

it("keeps a field's refusal until that field changes, with Save working throughout", async () => {
  const message = codeMessage("category.parent_cycle");
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    value: child,
    categories: [food, child],
    fieldErrors: { parent: message },
  });
  const parent = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    'wt-combobox[name="category-parent"]',
  )!;
  expect(parent.error).toBe(message);
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(saveOf(el).disabled).toBe(false);

  typeName(el, "Toasties");
  await el.updateComplete;
  expect(parent.error).toBe(message);
  expect(saveOf(el).disabled).toBe(false);

  parent.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(parent.error).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("submits past a field's refusal, which goes until the next refusal arrives", async () => {
  const message = codeMessage("category.parent_cycle");
  const { el, host } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    value: child,
    categories: [food, child],
    fieldErrors: { parent: message },
  });
  const submit = vi.fn();
  host.addEventListener("wt-submit", submit);
  const parent = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    'wt-combobox[name="category-parent"]',
  )!;

  saveOf(el).click();
  await el.updateComplete;
  expect(submit).toHaveBeenCalledOnce();
  expect(parent.error).toBe("");
  expect(await bottomOf(el)).toBe("");
});

it("focuses the field a refusal names when the refusal arrives", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    value: food,
  });
  el.fieldErrors = { name: codeMessage("category.invalid") };
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve));

  expect(nameOf(el).shadowRoot!.activeElement).toBe(nameOf(el).shadowRoot!.querySelector("input"));
});

it("leaves Save working on a refusal that names no field, and drops it on the next submission", async () => {
  const { el, host } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    value: food,
    fieldErrors: { _form: codeMessage("server.internal") },
  });
  const submit = vi.fn();
  host.addEventListener("wt-submit", submit);
  expect(await bottomOf(el)).toBe(codeMessage("server.internal"));
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);

  saveOf(el).click();
  await el.updateComplete;
  expect(submit).toHaveBeenCalledOnce();
  expect(await bottomOf(el)).toBe("");
});

it("shows the refusal and the generic sentence together when both apply", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    fieldErrors: {
      _form: codeMessage("server.internal"),
      parent: codeMessage("category.parent_cycle"),
    },
  });
  expect(await bottomOf(el)).toBe(`${codeMessage("server.internal")} ${t("form.fix_fields")}`);
});

it("starts again when reopened: no messages and Save working", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
  });
  saveOf(el).click();
  await el.updateComplete;
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;

  expect(nameOf(el).error).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});
