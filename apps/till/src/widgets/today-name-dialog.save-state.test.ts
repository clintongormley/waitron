import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./today-name-dialog.js";
import type { TodayNameDetail, TillTodayNameDialog } from "./today-name-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

async function mount(props: Partial<TillTodayNameDialog>): Promise<TillTodayNameDialog> {
  const { el } = await mountWidget<TillTodayNameDialog>("till-today-name-dialog", {
    heading: "Rename Counter 4",
    normalName: "Counter 4",
    ...props,
  });
  return el;
}
function saveButton(el: TillTodayNameDialog) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-rename-save]")!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: TillTodayNameDialog) {
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
async function type(el: TillTodayNameDialog, value: string) {
  const field = el.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
function confirmations(el: TillTodayNameDialog) {
  const named: TodayNameDetail[] = [];
  el.addEventListener("today-name-confirm", (event) =>
    named.push((event as CustomEvent<TodayNameDetail>).detail),
  );
  return named;
}

it("a table with today's name opens with Save quiet and disabled", async () => {
  const el = await mount({ value: "García birthday" });
  expect(await saveState(el)).toEqual(quiet);
});

it("a table with no name of its own today opens with Save quiet and disabled", async () => {
  const el = await mount({ value: "" });
  expect(await saveState(el)).toEqual(quiet);
});

it("one edit makes Save primary and enabled, and typing the name back makes it quiet again", async () => {
  const el = await mount({ value: "García birthday" });
  await type(el, "García");
  expect(await saveState(el)).toEqual(ready);
  await type(el, " García birthday ");
  expect(await saveState(el)).toEqual(quiet);
});

// A host `.click()` reaches Save's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself sends nothing for an untouched name.
it("a press that reaches Save's handler on an untouched name sends nothing and marks nothing", async () => {
  const el = await mount({ value: "x".repeat(41) });
  const named = confirmations(el);
  saveButton(el).click();
  await el.updateComplete;
  expect(named).toEqual([]);
  expect(el.shadowRoot!.querySelector("wt-input")!.error).toBe("");
});

it("Enter in the field on an untouched name sends nothing", async () => {
  const el = await mount({ value: "García birthday" });
  const named = confirmations(el);
  el.shadowRoot!.querySelector("wt-input")!
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await el.updateComplete;
  expect(named).toEqual([]);
});

it("clearing today's name is a change, and saving it sends null", async () => {
  const el = await mount({ value: "García birthday" });
  const named = confirmations(el);
  await type(el, "");
  expect(await saveState(el)).toEqual(ready);
  saveButton(el).click();
  expect(named).toEqual([{ name: null }]);
});

it("busy draws a changed Save disabled, and the change makes it ready again once the answer is in", async () => {
  const el = await mount({ value: "" });
  await type(el, "García birthday");
  el.busy = true;
  expect(await saveState(el)).toEqual({ variant: "primary", disabled: true, innerDisabled: true });
  el.busy = false;
  expect(await saveState(el)).toEqual(ready);
});

it("a sent name stays a change until the holder commits it, then Save is quiet", async () => {
  const el = await mount({ value: "" });
  await type(el, "García birthday");
  saveButton(el).click();
  expect(await saveState(el)).toEqual(ready);
  el.commit();
  expect(await saveState(el)).toEqual(quiet);
});
