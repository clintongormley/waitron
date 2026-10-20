import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtCombobox, WtInput, WtTextarea } from "@waitron/ui";
import type { TillCourse, TillProduct } from "../api/client.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { TillBasket } from "./basket.js";
import type { TillModifierPicker } from "./modifier-picker.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

afterEach(cleanupWidgets);
it("A738 a course removed before Save leaves every combined edit uncommitted", async () => {
  const dish: TillProduct = {
    id: "soup",
    name: "Staff soup",
    unitPrice: "5.00",
    pricingUnit: "each",
    vatClass: "general",
    category: null,
    allergens: null,
  };
  const course: TillCourse = {
    id: "starter",
    name: "Starter",
    displayOrder: 1,
    heldUntilFired: true,
  };
  const store = new WorkingOrderStore();
  store.addProduct(dish, "2", { note: "Original note" });
  const before = structuredClone(store.lines);
  const { el } = await mountWidget<TillBasket>("till-basket", {
    store,
    lineDetails: true,
    courses: [course],
  });
  el.openLineDetails(store.lines[0]!);
  await el.updateComplete;
  const picker = el.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker")!;
  await picker.updateComplete;
  const field = picker.shadowRoot!.querySelector<WtCombobox>("wt-combobox")!;
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: course.id }, bubbles: true, composed: true }),
  );
  const quantity = picker.shadowRoot!.querySelector<WtInput>('[name="quantity"]')!;
  await quantity.updateComplete;
  await userEvent.fill(quantity.shadowRoot!.querySelector("input")!, "3");
  const note = picker.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!;
  await note.updateComplete;
  await userEvent.fill(note.shadowRoot!.querySelector("textarea")!, "New note");
  await picker.updateComplete;
  const save = picker.shadowRoot!.querySelector<WtButton>(".confirm")!;
  expect(save.disabled).toBe(false);
  const observations: unknown[] = [];
  store.on("changed", () => observations.push(structuredClone(store.lines)));
  el.courses = [];
  save.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(store.lines).toEqual(before);
  expect(observations).toEqual([]);
  expect(el.shadowRoot!.querySelector("till-modifier-picker")).toBe(picker);
});
