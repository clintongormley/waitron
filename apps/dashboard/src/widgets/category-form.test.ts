import { userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { CategoryForm, categoryPath } from "./category-form.js";
import { setLocale, t } from "../i18n/t.js";
import type { CategoryInput, CategorySummary } from "../api/client.js";
afterEach(cleanupWidgets);
afterEach(() => setLocale("es-ES"));
const food: CategorySummary = {
  id: "food",
  name: { en: "Food", fr: "Cuisine" },
  parentId: null,
  image: null,
  color: null,
};
const child: CategorySummary = {
  id: "child",
  name: { en: "Sandwiches" },
  parentId: "food",
  image: null,
  color: null,
};
it("renders translated fields and excludes self and descendants from parent choices", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    languages: { defaultLanguage: "en", languages: ["en", "fr"] },
    value: food,
    categories: [food, child],
  });
  expect(el.shadowRoot!.querySelector('[name="category-name-en"]')).not.toBeNull();
  expect(el.shadowRoot!.querySelector('[name="category-name-fr"]')).not.toBeNull();
  const combo = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    'wt-combobox[name="category-parent"]',
  )!;
  expect(combo.options.map((o) => o.value)).toEqual([""]);
});
it("shows parent names in the reader's language, not the default content language", async () => {
  setLocale("en-GB"); // reader English; venue default is Spanish
  const parent: CategorySummary = {
    id: "p",
    name: { es: "Bebidas", en: "Drinks" },
    image: null,
    color: null,
    parentId: null,
  };
  const el = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    languages: { defaultLanguage: "es", languages: ["es", "en"] },
    categories: [parent],
    value: null,
  });
  const combo = el.el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    'wt-combobox[name="category-parent"]',
  )!;
  const labels = combo.options.map((o) => o.label);
  expect(labels).toContain("Drinks");
  expect(labels).not.toContain("Bebidas");
});
it("lists parent options alphabetically by their displayed label, with No parent pinned first", async () => {
  setLocale("en-GB");
  const zebra: CategorySummary = {
    id: "zebra",
    name: { en: "Zebra" },
    parentId: null,
    image: null,
    color: null,
  };
  const apple: CategorySummary = {
    id: "apple",
    name: { en: "Apple" },
    parentId: null,
    image: null,
    color: null,
  };
  const mango: CategorySummary = {
    id: "mango",
    name: { en: "Mango" },
    parentId: null,
    image: null,
    color: null,
  };
  // Two numeric names to pin the same collation the tables on this screen use: "Salsa 2" sorts
  // before "Salsa 10", not after it as a plain string compare would put it.
  const salsa10: CategorySummary = {
    id: "salsa10",
    name: { en: "Salsa 10" },
    parentId: null,
    image: null,
    color: null,
  };
  const salsa2: CategorySummary = {
    id: "salsa2",
    name: { en: "Salsa 2" },
    parentId: null,
    image: null,
    color: null,
  };
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    languages: { defaultLanguage: "en", languages: ["en"] },
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
    languages: { defaultLanguage: "en", languages: ["en", "fr"] },
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
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      'wt-input[name="category-name-en"]',
    )!.error,
  ).not.toBe("");
  expect(count).toBe(0);
  el.shadowRoot!.querySelector('[name="category-name-en"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Breakfast" }, bubbles: true, composed: true }),
  );
  el.categories = [...el.categories];
  await el.updateComplete;
  const input = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    'wt-input[name="category-name-en"]',
  )!;
  await input.updateComplete;
  input
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  expect(count).toBe(1);
  expect(submitted).toEqual({
    value: { name: { en: "Breakfast", fr: "" }, image: null, parentId: null, color: null },
  });
});
it("uses the existing image picker and preserves disabled translations in an edit", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    languages: { defaultLanguage: "en", languages: ["en"] },
    value: food,
  });
  const saved = new Promise<CustomEvent>((resolve) =>
    el.addEventListener("wt-submit", (event) => resolve(event as CustomEvent), { once: true }),
  );
  el.shadowRoot!.querySelector("dashboard-image-upload")!.dispatchEvent(
    new CustomEvent("image-changed", {
      detail: { image: "photo.jpg" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  expect((await saved).detail).toEqual({
    value: { name: food.name, image: "photo.jpg", parentId: null, color: null },
  });
});

it("submits the chosen colour", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    languages: { defaultLanguage: "en", languages: ["en"] },
    value: food,
  });
  const saved = new Promise<CustomEvent>((resolve) =>
    el.addEventListener("wt-submit", (event) => resolve(event as CustomEvent), { once: true }),
  );
  el.shadowRoot!.querySelector<HTMLElement>('[data-color="#b12525"]')!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  expect((await saved).detail.value.color).toBe("#b12525");
});

it("lays out every palette hue as a column of three tones", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    languages: { defaultLanguage: "en", languages: ["en"] },
    value: food,
  });
  const swatches = [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>('.swatches [data-color]:not([data-color=""])'),
  ];
  expect(swatches).toHaveLength(24);

  const boxes = swatches.slice(0, 4).map((swatch) => swatch.getBoundingClientRect());
  expect(boxes[1]!.left).toBe(boxes[0]!.left);
  expect(boxes[2]!.left).toBe(boxes[0]!.left);
  expect(boxes[1]!.top).toBeGreaterThan(boxes[0]!.top);
  expect(boxes[2]!.top).toBeGreaterThan(boxes[1]!.top);
  expect(boxes[3]!.left).toBeGreaterThan(boxes[0]!.left);
  expect(boxes[3]!.top).toBe(boxes[0]!.top);
  const secondHalf = swatches[12]!.getBoundingClientRect();
  expect(secondHalf.left).toBeGreaterThan(boxes[3]!.left);
  expect(secondHalf.top).toBe(boxes[0]!.top);

  const yellow = el.shadowRoot!.querySelector<HTMLElement>('[data-color="#dddd5f"]')!;
  expect(yellow).not.toBeNull();
  expect(getComputedStyle(yellow).backgroundColor).toBe("rgb(221, 221, 95)");
});

it("edits from an existing colour and can clear it", async () => {
  const coloredFood: CategorySummary = { ...food, color: "#256bb1" };
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    languages: { defaultLanguage: "en", languages: ["en"] },
    value: coloredFood,
  });
  const saved = new Promise<CustomEvent>((resolve) =>
    el.addEventListener("wt-submit", (event) => resolve(event as CustomEvent), { once: true }),
  );
  el.shadowRoot!.querySelector<HTMLElement>('[data-color=""]')!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  expect((await saved).detail.value.color).toBeNull();
});

it("submits a custom colour picked via the native colour input", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    languages: { defaultLanguage: "en", languages: ["en"] },
    value: food,
  });
  const saved = new Promise<CustomEvent>((resolve) =>
    el.addEventListener("wt-submit", (event) => resolve(event as CustomEvent), { once: true }),
  );
  const input = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="color"]')!;
  input.value = "#123456";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  expect((await saved).detail.value.color).toBe("#123456");
});

it("creates inside a host draft, selects the saved category and leaves the draft intact", async () => {
  const { el, host } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    languages: { defaultLanguage: "en", languages: ["en"] },
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
  el.shadowRoot!.querySelector('[name="category-name-en"]')!.dispatchEvent(
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
    languages: { defaultLanguage: "en", languages: ["en"] },
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

it("keeps the editor open when Escape is pressed during a save", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    busy: true,
    languages: { defaultLanguage: "en", languages: ["en"] },
    value: food,
  });
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  await userEvent.keyboard("{Escape}");
  expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
});

it("names a category in a path by its id when it has no name in any enabled language", () => {
  const unnamed: CategorySummary = {
    id: "untitled",
    name: {},
    parentId: "food",
    image: null,
    color: null,
  };
  expect(categoryPath(unnamed, [food, unnamed], "en")).toBe("Food / untitled");
});

it("submits the chosen parent and returns to no parent when None is chosen", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    languages: { defaultLanguage: "en", languages: ["en"] },
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
    languages: { defaultLanguage: "en", languages: ["en"] },
    value: food,
  });
  const cancel = vi.fn();
  host.addEventListener("wt-cancel", cancel);
  el.shadowRoot!.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
  expect(cancel).toHaveBeenCalledOnce();
  expect(cancel.mock.calls[0]![0].detail).toEqual({});
});

it("neither saves nor cancels while the image library is open over it", async () => {
  const { el, host } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    languages: { defaultLanguage: "en", languages: ["en"] },
    value: food,
  });
  const seen = vi.fn();
  host.addEventListener("wt-submit", seen);
  host.addEventListener("wt-cancel", seen);
  const upload = el.shadowRoot!.querySelector("dashboard-image-upload")!;
  upload.dispatchEvent(
    new CustomEvent("image-picker-state", {
      detail: { open: true },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  const save = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    '[data-test="save"]',
  )!;
  expect(save.disabled).toBe(true);
  save.click();
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  modal.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  expect(seen).not.toHaveBeenCalled();

  upload.dispatchEvent(
    new CustomEvent("image-picker-state", {
      detail: { open: false },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(save.disabled).toBe(false);
  save.click();
  expect(seen).toHaveBeenCalledOnce();
  expect(seen.mock.calls[0]![0].type).toBe("wt-submit");
});

it("neither saves nor cancels while a save is in flight", async () => {
  const { el, host } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    busy: true,
    languages: { defaultLanguage: "en", languages: ["en"] },
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

it("refuses to save with the name-required message when no content language is configured", async () => {
  const { el, host } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    languages: { defaultLanguage: "en", languages: [] },
  });
  const submit = vi.fn();
  host.addEventListener("wt-submit", submit);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-error-summary"]>(
      "wt-form-error-summary",
    )!.errors,
  ).toEqual([t("categories.name_required")]);
});
