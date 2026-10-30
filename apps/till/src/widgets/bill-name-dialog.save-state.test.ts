import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./bill-name-dialog.js";
import type { BillNameDetail, TillBillNameDialog } from "./bill-name-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

async function mount(props: Partial<TillBillNameDialog>): Promise<TillBillNameDialog> {
  const { el } = await mountWidget<TillBillNameDialog>("till-bill-name-dialog", {
    bill: "Ana · Bill 2",
    ...props,
  });
  return el;
}
function saveButton(el: TillBillNameDialog) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-name-save]")!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: TillBillNameDialog) {
  await el.updateComplete;
  const save = saveButton(el);
  await save.updateComplete;
  return {
    variant: save.variant,
    disabled: save.disabled,
    innerDisabled: save.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
async function type(el: TillBillNameDialog, value: string) {
  const field = el.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
function confirmations(el: TillBillNameDialog) {
  const named: BillNameDetail[] = [];
  el.addEventListener("bill-name-confirm", (event) =>
    named.push((event as CustomEvent<BillNameDetail>).detail),
  );
  return named;
}

it("a bill with a stored name opens with Save quiet and disabled", async () => {
  const el = await mount({ value: "Desserts", savedValue: "Desserts" });
  expect(await saveState(el)).toEqual(quiet);
});

it("one edit makes Save primary and enabled, and typing the stored name back makes it quiet again", async () => {
  const el = await mount({ value: "Desserts", savedValue: "Desserts" });
  await type(el, "Desserts 2");
  expect(await saveState(el)).toEqual(ready);
  await type(el, "Desserts");
  expect(await saveState(el)).toEqual(quiet);
});

// A host `.click()` reaches Save's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself sends nothing for an untouched name.
it("a press that reaches Save's handler on an untouched name sends nothing and marks nothing", async () => {
  const el = await mount({ value: "x".repeat(41), savedValue: "x".repeat(41) });
  const named = confirmations(el);
  saveButton(el).click();
  await el.updateComplete;
  expect(named).toEqual([]);
  expect(el.shadowRoot!.querySelector("wt-input")!.error).toBe("");
});

it("Enter in the field on an untouched name sends nothing", async () => {
  const el = await mount({ value: "Desserts", savedValue: "Desserts" });
  const named = confirmations(el);
  el.shadowRoot!.querySelector("wt-input")!
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await el.updateComplete;
  expect(named).toEqual([]);
});

it("reopened after a refusal holding the refused name beside the stored one, Save is enabled", async () => {
  const el = await mount({
    value: "Desserts 2",
    savedValue: "Desserts",
    refusal: t("table.name_too_long"),
  });
  expect(await saveState(el)).toEqual(ready);
});

it("clearing a stored name is a change, and saving it sends a cleared name", async () => {
  const el = await mount({ value: "Desserts", savedValue: "Desserts" });
  const named = confirmations(el);
  await type(el, "");
  expect(await saveState(el)).toEqual(ready);
  saveButton(el).click();
  expect(named).toEqual([{ name: null }]);
});

it("after a save that leaves the dialog open, Save is quiet again", async () => {
  const el = await mount({ value: "Desserts", savedValue: "Desserts" });
  await type(el, "Luis");
  saveButton(el).click();
  expect(await saveState(el)).toEqual(quiet);
});

it("when the stored name changes elsewhere, an untouched field follows it and Save compares against it", async () => {
  const el = await mount({ value: "Desserts", savedValue: "Desserts" });
  el.savedValue = "Luis";
  expect(await saveState(el)).toEqual(quiet);
  const input = el.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!;
  expect(el.value).toBe("Luis");
  expect(input.value).toBe("Luis");
  await type(el, "Eva");
  expect(await saveState(el)).toEqual(ready);
  await type(el, "Desserts");
  expect(await saveState(el)).toEqual(ready);
  await type(el, "Luis");
  expect(await saveState(el)).toEqual(quiet);
});

it("when the stored name changes elsewhere, a name the waiter typed stays and Save compares against the new one", async () => {
  const el = await mount({ value: "Desserts", savedValue: "Desserts" });
  await type(el, "Eva");
  el.savedValue = "Luis";
  expect(await saveState(el)).toEqual(ready);
  expect(el.value).toBe("Eva");
  el.savedValue = "Eva";
  expect(await saveState(el)).toEqual(quiet);
  expect(el.value).toBe("Eva");
});
