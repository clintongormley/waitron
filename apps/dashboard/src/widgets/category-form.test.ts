import { userEvent } from "@vitest/browser/context";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { CategoryForm } from "./category-form.js";
import type { CategoryInput, CategorySummary } from "../api/client.js";
afterEach(cleanupWidgets);
const food: CategorySummary = {
  id: "food",
  name: { en: "Food", fr: "Cuisine" },
  parentId: null,
  image: null,
};
const child: CategorySummary = {
  id: "child",
  name: { en: "Sandwiches" },
  parentId: "food",
  image: null,
};
it("renders translated fields and excludes self and descendants from parent choices", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    locales: ["en", "fr"],
    value: food,
    categories: [food, child],
  });
  expect(el.shadowRoot!.querySelector('[name="category-name-en"]')).not.toBeNull();
  expect(el.shadowRoot!.querySelector('[name="category-name-fr"]')).not.toBeNull();
  expect(
    [...el.shadowRoot!.querySelectorAll('select[name="category-parent"] option')].map(
      (o) => (o as HTMLOptionElement).value,
    ),
  ).toEqual([""]);
});
it("retains the draft during lookup refreshes, validates and emits the reusable submit contract once", async () => {
  const { el, host } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    locales: ["en", "fr"],
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
    value: { name: { en: "Breakfast", fr: "" }, image: null, parentId: null },
  });
});
it("uses the existing image picker and preserves disabled translations in an edit", async () => {
  const { el } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    locales: ["en"],
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
    value: { name: food.name, image: "photo.jpg", parentId: null },
  });
});

it("creates inside a host draft, selects the saved category and leaves the draft intact", async () => {
  const { el, host } = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    locales: ["en"],
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
    locales: ["en"],
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
    locales: ["en"],
    value: food,
  });
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  await userEvent.keyboard("{Escape}");
  expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
});
