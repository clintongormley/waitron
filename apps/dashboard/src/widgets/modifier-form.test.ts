import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { ModifierForm } from "./modifier-form.js";
import type { Modifier } from "../api/client.js";
import { t } from "../i18n/t.js";

afterEach(cleanupWidgets);
const base = { id: "m", name: { es: "Extras", fr: "Suppléments" }, available: true };
const extra: Modifier = {
  ...base,
  type: "extras",
  required: false,
  maxTotalQuantity: null,
  choices: [
    {
      id: "a",
      name: { es: "Queso" },
      available: true,
      priceDelta: "1.00",
      maxQuantity: 2,
      preselected: true,
      dietaryEffect: { invalidates: ["halal"] },
    },
    {
      id: "b",
      name: { es: "Bacon" },
      available: true,
      priceDelta: "2.00",
      maxQuantity: 1,
      preselected: false,
    },
  ],
};
const options: Modifier = {
  ...base,
  type: "options",
  defaultChoiceId: null,
  choices: [
    { id: "c1", name: { es: "Uno" }, available: true },
    { id: "c2", name: { es: "Dos" }, available: true },
  ],
};
async function mount(value: Modifier | null = null) {
  return (
    await mountWidget<ModifierForm>("dashboard-modifier-form", {
      open: true,
      locales: ["es", "en"],
      value,
    })
  ).el;
}
async function change(el: ModifierForm, name: string, value: string | boolean) {
  const node = el.shadowRoot!.querySelector<HTMLElement>(`[name="${name}"]`)!;
  if (node instanceof HTMLSelectElement) {
    node.value = String(value);
    node.dispatchEvent(new Event("change"));
  } else
    node.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: typeof value === "boolean" ? { checked: value } : { value },
      }),
    );
  await el.updateComplete;
}
async function click(el: ModifierForm, id: string) {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${id}"]`)!.click();
  await el.updateComplete;
}
function choiceById(detail: { value: { choices: { id: string }[] } }, id: string) {
  return detail.value.choices.find((choice) => choice.id === id) as Record<string, unknown>;
}
/** The message under the choices table — not the form-wide alert above the fields. */
function choicesError(el: ModifierForm) {
  return el.shadowRoot!.querySelector(".choices-wrap + p.error")?.textContent ?? "";
}
it("shows required name feedback and emits the shared event with translations", async () => {
  const el = await mount();
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await click(el, "save");
  expect(submit).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
  await change(el, "name-es", "Nota");
  await change(el, "name-en", "Note");
  await click(el, "save");
  expect(submit.mock.calls[0]![0].detail).toEqual({
    value: { type: "text", name: { es: "Nota", en: "Note" }, available: true },
  });
  expect(submit.mock.calls[0]![0].composed).toBe(true);
});
it("changes an unused type without leaking fields and retains disabled-language names", async () => {
  const el = await mount(extra);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await change(el, "type", "yes-no");
  await click(el, "save");
  expect(submit.mock.calls[0]![0].detail.value).toEqual({
    type: "yes-no",
    name: base.name,
    available: true,
    defaultValue: false,
  });
});
it("renders extras choices as a table with a preselect checkbox per row", async () => {
  const el = await mount(extra);
  const rows = el.shadowRoot!.querySelectorAll("tbody tr");
  expect(rows.length).toBe(2);
  const check = el.shadowRoot!.querySelector<HTMLInputElement>(
    `input[type="checkbox"][data-test="preselect-b"]`,
  )!;
  expect(check).not.toBeNull();
  expect(check.checked).toBe(false);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  check.checked = true;
  check.dispatchEvent(new Event("change"));
  await el.updateComplete;
  await click(el, "save");
  const detail = submit.mock.calls[0]![0].detail;
  expect(choiceById(detail, "a").preselected).toBe(true);
  expect(choiceById(detail, "b").preselected).toBe(true);
  // The submitted extras choice carries preselected, never a defaultQuantity.
  expect(choiceById(detail, "a")).not.toHaveProperty("defaultQuantity");
});
it("uses a radio for the options default and clears it", async () => {
  const el = await mount(options);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  expect(el.shadowRoot!.querySelector('[data-test="clear-default"]')).toBeNull();
  const radio = el.shadowRoot!.querySelector<HTMLInputElement>(
    `input[type="radio"][data-test="default-c1"]`,
  )!;
  expect(radio).not.toBeNull();
  radio.checked = true;
  radio.dispatchEvent(new Event("change"));
  await el.updateComplete;
  await click(el, "save");
  expect(submit.mock.calls[0]![0].detail.value.defaultChoiceId).toBe("c1");
  submit.mockClear();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="clear-default"]')!.click();
  await el.updateComplete;
  await click(el, "save");
  expect(submit.mock.calls[0]![0].detail.value.defaultChoiceId).toBeNull();
});
it("opens the choice modal to add and to edit, and removes a row", async () => {
  const el = await mount(extra);
  await click(el, "add-choice");
  const modal = el.shadowRoot!.querySelector("dashboard-choice-form")!;
  expect(modal.getAttribute("open")).not.toBeNull();
  expect((modal as unknown as { value: unknown }).value).toBeNull();
  // Both row-menu buttons are start-aligned, as every wt-row-actions popover requires.
  for (const id of ["edit-a", "remove-a"])
    expect(el.shadowRoot!.querySelector(`[data-test="${id}"]`)!.getAttribute("align")).toBe(
      "start",
    );
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-a"]')!.click();
  await el.updateComplete;
  expect(modal.getAttribute("open")).not.toBeNull();
  expect((modal as unknown as { value: { id: string } }).value.id).toBe("a");
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="remove-b"]')!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelectorAll("tbody tr").length).toBe(1);
  expect(el.shadowRoot!.querySelector('[data-choice="b"]')).toBeNull();
});
it("writes a saved choice from the modal back into the table", async () => {
  const el = await mount(extra);
  const inner = el.shadowRoot!.querySelector("dashboard-choice-form")!;
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  inner.dispatchEvent(
    new CustomEvent("wt-choice-save", {
      bubbles: true,
      composed: true,
      detail: {
        value: {
          id: "a",
          name: { es: "Gouda" },
          available: true,
          priceDelta: "1.50",
          maxQuantity: 2,
        },
      },
    }),
  );
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[data-choice="a"]')!.textContent).toContain("Gouda");
  await click(el, "save");
  const a = choiceById(submit.mock.calls[0]![0].detail, "a");
  expect(a.name).toEqual({ es: "Gouda" });
  // The row's preselection is owned by the table, not overwritten by the modal save.
  expect(a.preselected).toBe(true);
});
it("disables the default control of an unavailable choice and clears its preselection", async () => {
  const el = await mount(extra);
  const check = el.shadowRoot!.querySelector<HTMLInputElement>('input[data-test="preselect-a"]')!;
  expect(check.checked).toBe(true);
  await change(el, "available-a", false);
  const cleared = el.shadowRoot!.querySelector<HTMLInputElement>('input[data-test="preselect-a"]')!;
  expect(cleared.disabled).toBe(true);
  expect(cleared.checked).toBe(false);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await click(el, "save");
  expect(choiceById(submit.mock.calls[0]![0].detail, "a").preselected).toBe(false);
});
it("clears an option default when its choice becomes unavailable", async () => {
  const el = await mount({ ...options, defaultChoiceId: "c1" });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  const radio = el.shadowRoot!.querySelector<HTMLInputElement>('input[data-test="default-c1"]')!;
  expect(radio.checked).toBe(true);
  await change(el, "available-c1", false);
  const disabled = el.shadowRoot!.querySelector<HTMLInputElement>('input[data-test="default-c1"]')!;
  expect(disabled.disabled).toBe(true);
  expect(disabled.checked).toBe(false);
  await click(el, "save");
  expect(submit.mock.calls[0]![0].detail.value.defaultChoiceId).toBeNull();
});
it("clears the preselection and the default of a choice saved from the modal as unavailable", async () => {
  const saveUnavailable = async (el: ModifierForm, value: object) => {
    el.shadowRoot!.querySelector("dashboard-choice-form")!.dispatchEvent(
      new CustomEvent("wt-choice-save", {
        bubbles: true,
        composed: true,
        detail: { value: { ...value, available: false } },
      }),
    );
    await el.updateComplete;
    const submit = vi.fn();
    el.addEventListener("wt-submit", submit);
    await click(el, "save");
    return submit.mock.calls[0]![0].detail.value;
  };
  const withExtras = await mount(extra);
  const saved = await saveUnavailable(withExtras, extra.choices[0]!);
  expect(choiceById({ value: saved }, "a").preselected).toBe(false);
  cleanupWidgets();
  const withOptions = await mount({ ...options, defaultChoiceId: "c1" });
  expect((await saveUnavailable(withOptions, options.choices[0]!)).defaultChoiceId).toBeNull();
});
it("rejects more preselected extras than the total quantity cap allows", async () => {
  const el = await mount(extra);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  const check = el.shadowRoot!.querySelector<HTMLInputElement>('input[data-test="preselect-b"]')!;
  check.checked = true;
  check.dispatchEvent(new Event("change"));
  await el.updateComplete;
  await change(el, "maxTotalQuantity", "1");
  await click(el, "save");
  expect(submit).not.toHaveBeenCalled();
  // The cap itself is a valid number, so the problem is reported where the manager can act on it —
  // under the choices table, not as a bad value on the cap field.
  expect(choicesError(el)).toContain(t("modifiers.too_many_preselected"));
  expect(
    (el.shadowRoot!.querySelector('[name="maxTotalQuantity"]') as unknown as { invalid: boolean })
      .invalid,
  ).toBe(false);
  await change(el, "maxTotalQuantity", "2");
  await click(el, "save");
  expect(submit).toHaveBeenCalledTimes(1);
});
it("reports a malformed total quantity cap on the cap field", async () => {
  const el = await mount(extra);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await change(el, "maxTotalQuantity", "two");
  await click(el, "save");
  expect(submit).not.toHaveBeenCalled();
  expect(
    (el.shadowRoot!.querySelector('[name="maxTotalQuantity"]') as unknown as { invalid: boolean })
      .invalid,
  ).toBe(true);
  expect(choicesError(el)).toBe("");
});
it("blocks a save when a choice has no name in the default content language", async () => {
  const el = await mount({
    ...extra,
    choices: [extra.choices[0]!, { ...extra.choices[1]!, name: {} }],
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await click(el, "save");
  expect(submit).not.toHaveBeenCalled();
  // The nameless choice has no label of its own, so the message falls back to the generic word.
  expect(choicesError(el)).toContain(t("modifiers.choice"));
  expect(choicesError(el)).toContain(t("modifiers.choice_problem"));
});
it("blocks a save when an extras choice has a malformed price", async () => {
  const el = await mount({
    ...extra,
    choices: [extra.choices[0]!, { ...extra.choices[1]!, priceDelta: "1.2.3" }],
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await click(el, "save");
  expect(submit).not.toHaveBeenCalled();
  expect(choicesError(el)).toContain("Bacon");
});
it("refuses a total quantity cap above what the server stores, beside the cap field", async () => {
  const el = await mount(extra);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await change(el, "maxTotalQuantity", "2147483648");
  await click(el, "save");
  expect(submit).not.toHaveBeenCalled();
  expect(
    (el.shadowRoot!.querySelector('[name="maxTotalQuantity"]') as unknown as { error: string })
      .error,
  ).toBe(t("modifiers.quantity_invalid"));
  await change(el, "maxTotalQuantity", "2147483647");
  await click(el, "save");
  expect(submit).toHaveBeenCalledTimes(1);
});
it.each([
  { limit: "an eleven-digit price", patch: { priceDelta: "12345678901" } },
  { limit: "a quantity above the server's integer", patch: { maxQuantity: 2147483648 } },
])("blocks a save when a loaded extras choice has $limit", async ({ patch }) => {
  const el = await mount({
    ...extra,
    choices: [extra.choices[0]!, { ...extra.choices[1]!, ...patch }],
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await click(el, "save");
  expect(submit).not.toHaveBeenCalled();
  expect(choicesError(el)).toContain("Bacon");
});
it("names the choice a server-rejected choice field belongs to", async () => {
  const el = await mount(extra);
  el.fieldErrors = { "choices.1.priceDelta": "Rejected" };
  await el.updateComplete;
  expect(choicesError(el)).toContain("Bacon");
  expect(choicesError(el)).toContain(t("modifiers.choice_problem"));
});
it("blocks an available required empty choice set", async () => {
  const el = await mount({ ...extra, required: true, choices: [extra.choices[0]!] });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await change(el, "available-a", false);
  await click(el, "save");
  expect(submit).not.toHaveBeenCalled();
  await change(el, "available", false);
  await click(el, "save");
  expect(submit).toHaveBeenCalledTimes(1);
});
function choiceOrder(el: ModifierForm) {
  return [...el.shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
    row.getAttribute("data-choice"),
  );
}
it("reorders choices with the keyboard", async () => {
  const el = await mount(extra); // choices a, b
  const handle = el.shadowRoot!.querySelector<HTMLElement>('[data-test="drag-a"]')!;
  handle.focus();
  handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await el.updateComplete;
  expect(choiceOrder(el)).toEqual(["b", "a"]);
  // The moved handle keeps the focus so a second press continues the move.
  expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector('[data-test="drag-a"]'));
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await click(el, "save");
  expect(submit.mock.calls[0]![0].detail.value.choices.map((c: { id: string }) => c.id)).toEqual([
    "b",
    "a",
  ]);
});
it("leaves the order alone at the ends, on another key, and while saving", async () => {
  // Three choices, not two: with two, moving the first one up past the start rearranges nothing
  // even when the move is NOT clamped, so the assertion would hold either way.
  const el = await mount({
    ...extra,
    choices: [
      ...extra.choices,
      {
        id: "c",
        name: { es: "Cebolla" },
        available: true,
        priceDelta: "0.50",
        maxQuantity: 1,
        preselected: false,
      },
    ],
  });
  const press = (id: string, key: string) =>
    el
      .shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${id}"]`)!
      .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  press("a", "ArrowUp");
  await el.updateComplete;
  expect(choiceOrder(el)).toEqual(["a", "b", "c"]);
  press("c", "ArrowDown");
  await el.updateComplete;
  expect(choiceOrder(el)).toEqual(["a", "b", "c"]);
  press("a", "ArrowLeft");
  await el.updateComplete;
  expect(choiceOrder(el)).toEqual(["a", "b", "c"]);
  el.busy = true;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector<HTMLButtonElement>('[data-test="drag-a"]')!.disabled).toBe(
    true,
  );
  press("a", "ArrowDown");
  await el.updateComplete;
  expect(choiceOrder(el)).toEqual(["a", "b", "c"]);
});
it("reorders choices by pointer drag", async () => {
  const el = await mount(extra);
  const handle = el.shadowRoot!.querySelector<HTMLElement>('[data-test="drag-a"]')!;
  const rowB = el.shadowRoot!.querySelector<HTMLElement>('tr[data-choice="b"]')!;
  handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
  const box = rowB.getBoundingClientRect();
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 1,
      clientY: box.top + box.height / 2,
    }),
  );
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  await el.updateComplete;
  expect(choiceOrder(el)).toEqual(["b", "a"]);
  // pointerup ends the gesture: a later move over a row must not reorder anything.
  document.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientY: box.top }),
  );
  await el.updateComplete;
  expect(choiceOrder(el)).toEqual(["b", "a"]);
});
it("follows the reordered rows across a drag that doubles back", async () => {
  const el = await mount({
    ...extra,
    choices: [
      ...extra.choices,
      {
        id: "c",
        name: { es: "Cebolla" },
        available: true,
        priceDelta: "0.50",
        maxQuantity: 1,
        preselected: false,
      },
    ],
  });
  // Row slots are fixed on screen while the choices move through them.
  const centres = [...el.shadowRoot!.querySelectorAll("tbody tr")].map((row) => {
    const box = row.getBoundingClientRect();
    return box.top + box.height / 2;
  });
  const moveTo = async (slot: number) => {
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientY: centres[slot] }),
    );
    await el.updateComplete;
  };
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="drag-a"]')!.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }),
  );
  await moveTo(1);
  expect(choiceOrder(el)).toEqual(["b", "a", "c"]);
  await moveTo(2);
  expect(choiceOrder(el)).toEqual(["b", "c", "a"]);
  // The first slot now holds b, not a: a layout read before the moves would still see a there and
  // leave the order alone.
  await moveTo(0);
  expect(choiceOrder(el)).toEqual(["a", "b", "c"]);
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
});
it("finds the row under the pointer after the modal scrolls mid-drag", async () => {
  const choices = Array.from({ length: 30 }, (_, index) => ({
    id: `c${index}`,
    name: { es: `Opción ${index}` },
    available: true,
    priceDelta: "0.00",
    maxQuantity: 1,
    preselected: false,
  }));
  const el = await mount({ ...extra, choices });
  const row = (id: string) => el.shadowRoot!.querySelector(`tr[data-choice="${id}"]`)!;
  const centre = (id: string) => {
    const box = row(id).getBoundingClientRect();
    return box.top + box.height / 2;
  };
  const move = async (clientY: number) => {
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientY }),
    );
    await el.updateComplete;
  };
  row("c0")
    .querySelector<HTMLElement>('[data-test="drag-c0"]')!
    .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
  await move(centre("c0")); // over its own row: measures, moves nothing
  const body = el.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector(".body")!;
  expect(body.scrollHeight).toBeGreaterThan(body.clientHeight + 300);
  body.scrollTop = 300;
  expect(body.scrollTop).toBe(300);
  await move(centre("c12"));
  expect(choiceOrder(el).indexOf("c0")).toBe(12);
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
});
it("ignores a second finger while a drag is live", async () => {
  const el = await mount(extra);
  const down = (id: string, pointerId: number) =>
    el
      .shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${id}"]`)!
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId }));
  const boxB = el
    .shadowRoot!.querySelector<HTMLElement>('tr[data-choice="b"]')!
    .getBoundingClientRect();
  const centreOfB = boxB.top + boxB.height / 2;
  down("a", 1);
  down("b", 2); // a drag is already live, so the second handle does not take it over
  document.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, pointerId: 2, clientY: centreOfB }),
  );
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 2 }));
  await el.updateComplete;
  expect(choiceOrder(el)).toEqual(["a", "b"]);
  // The first pointer still owns the gesture, so its own move reorders.
  document.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientY: centreOfB }),
  );
  await el.updateComplete;
  expect(choiceOrder(el)).toEqual(["b", "a"]);
  // pointercancel ends the gesture the same way pointerup does: a later move reorders nothing.
  // boxB.top is where the OTHER row sits once the two have swapped, so a still-live gesture would
  // move the row back and fail the assertion below; centreOfB would land on the dragged row itself
  // and pass either way.
  document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }));
  document.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientY: boxB.top }),
  );
  await el.updateComplete;
  expect(choiceOrder(el)).toEqual(["b", "a"]);
});
it("retains a draft across busy/server errors and emits cancel once", async () => {
  const el = await mount();
  const submit = vi.fn(),
    cancel = vi.fn();
  el.addEventListener("wt-submit", submit);
  el.addEventListener("wt-cancel", cancel);
  await change(el, "name-es", "Nota");
  el.busy = true;
  await el.updateComplete;
  await click(el, "save");
  expect(submit).not.toHaveBeenCalled();
  el.busy = false;
  el.fieldErrors = { name: "Rejected" };
  await el.updateComplete;
  expect(
    (el.shadowRoot!.querySelector('[name="name-es"]') as unknown as { value: string }).value,
  ).toBe("Nota");
  await click(el, "cancel");
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(cancel.mock.calls[0]![0].detail).toEqual({});
});
