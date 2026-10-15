import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./party-guests-dialog.js";
import type { PartyGuestsDetail, TillPartyGuestsDialog } from "./party-guests-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

async function mount(props: Partial<TillPartyGuestsDialog>): Promise<TillPartyGuestsDialog> {
  const { el } = await mountWidget<TillPartyGuestsDialog>("till-party-guests-dialog", {
    tables: "Mesa 4, 5",
    ...props,
  });
  return el;
}
function saveButton(el: TillPartyGuestsDialog) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-guests-save]")!;
}
async function saveState(el: TillPartyGuestsDialog) {
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
async function type(el: TillPartyGuestsDialog, value: string) {
  const field = el.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
function confirmations(el: TillPartyGuestsDialog) {
  const counted: PartyGuestsDetail[] = [];
  el.addEventListener("party-guests-confirm", (event) =>
    counted.push((event as CustomEvent<PartyGuestsDetail>).detail),
  );
  return counted;
}

it("a party with a stored count opens with Save quiet and disabled", async () => {
  const el = await mount({ value: "2", savedValue: "2" });
  expect(await saveState(el)).toEqual(quiet);
});

it("a party with no count opens with Save quiet and disabled", async () => {
  const el = await mount({ value: "", savedValue: "" });
  expect(await saveState(el)).toEqual(quiet);
});

it("one edit makes Save primary and enabled, and typing the stored count back makes it quiet again", async () => {
  const el = await mount({ value: "2", savedValue: "2" });
  await type(el, "4");
  expect(await saveState(el)).toEqual(ready);
  await type(el, " 2 ");
  expect(await saveState(el)).toEqual(quiet);
  await type(el, "02");
  expect(await saveState(el)).toEqual(quiet);
});

// A host `.click()` reaches Save's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself sends nothing for an untouched count.
it("a press that reaches Save's handler on an untouched count sends nothing and marks nothing", async () => {
  const el = await mount({ value: "0", savedValue: "0" });
  const counted = confirmations(el);
  saveButton(el).click();
  await el.updateComplete;
  expect(counted).toEqual([]);
  expect(el.shadowRoot!.querySelector("wt-input")!.error).toBe("");
});

it("Enter in the field on an untouched count sends nothing", async () => {
  const el = await mount({ value: "2", savedValue: "2" });
  const counted = confirmations(el);
  el.shadowRoot!.querySelector("wt-input")!
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await el.updateComplete;
  expect(counted).toEqual([]);
});

it("reopened after a refusal holding the refused count beside the stored one, Save is enabled", async () => {
  const el = await mount({ value: "4", savedValue: "2", refusal: t("seat.guest_count_invalid") });
  expect(await saveState(el)).toEqual(ready);
});

it("clearing a stored count is a change, and saving it sends a cleared count", async () => {
  const el = await mount({ value: "2", savedValue: "2" });
  const counted = confirmations(el);
  await type(el, "");
  expect(await saveState(el)).toEqual(ready);
  saveButton(el).click();
  expect(counted).toEqual([{ guestCount: null }]);
});

it("after a save that leaves the dialog open, Save is quiet again", async () => {
  const el = await mount({ value: "2", savedValue: "2" });
  await type(el, "4");
  saveButton(el).click();
  expect(await saveState(el)).toEqual(quiet);
});
