import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./party-name-dialog.js";
import type { PartyNameDetail, TillPartyNameDialog } from "./party-name-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

async function mount(props: Partial<TillPartyNameDialog>): Promise<TillPartyNameDialog> {
  const { el } = await mountWidget<TillPartyNameDialog>("till-party-name-dialog", {
    tables: "Mesa 4, 5",
    ...props,
  });
  return el;
}
function saveButton(el: TillPartyNameDialog) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-name-save]")!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: TillPartyNameDialog) {
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
async function type(el: TillPartyNameDialog, value: string) {
  const field = el.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
function confirmations(el: TillPartyNameDialog) {
  const named: PartyNameDetail[] = [];
  el.addEventListener("party-name-confirm", (event) =>
    named.push((event as CustomEvent<PartyNameDetail>).detail),
  );
  return named;
}

it("a party with a stored name opens with Save quiet and disabled", async () => {
  const el = await mount({ value: "Ana", savedValue: "Ana" });
  expect(await saveState(el)).toEqual(quiet);
});

it("one edit makes Save primary and enabled, and typing the stored name back makes it quiet again", async () => {
  const el = await mount({ value: "Ana", savedValue: "Ana" });
  await type(el, "Ana B");
  expect(await saveState(el)).toEqual(ready);
  await type(el, "Ana");
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
  const el = await mount({ value: "Ana", savedValue: "Ana" });
  const named = confirmations(el);
  el.shadowRoot!.querySelector("wt-input")!
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await el.updateComplete;
  expect(named).toEqual([]);
});

it("reopened after a refusal holding the refused name beside the stored one, Save is enabled", async () => {
  const el = await mount({
    value: "Ana B",
    savedValue: "Ana",
    refusal: t("table.name_too_long"),
  });
  expect(await saveState(el)).toEqual(ready);
});

it("clearing a stored name is a change, and saving it sends a cleared name", async () => {
  const el = await mount({ value: "Ana", savedValue: "Ana" });
  const named = confirmations(el);
  await type(el, "");
  expect(await saveState(el)).toEqual(ready);
  saveButton(el).click();
  expect(named).toEqual([{ name: null }]);
});

it("after a save that leaves the dialog open, Save is quiet again", async () => {
  const el = await mount({ value: "Ana", savedValue: "Ana" });
  await type(el, "Luis");
  saveButton(el).click();
  expect(await saveState(el)).toEqual(quiet);
});
