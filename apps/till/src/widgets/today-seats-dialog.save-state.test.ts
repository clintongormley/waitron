import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./today-seats-dialog.js";
import type { TillTodaySeatsDialog, TodaySeatsDetail } from "./today-seats-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

async function mount(props: Partial<TillTodaySeatsDialog>): Promise<TillTodaySeatsDialog> {
  const { el } = await mountWidget<TillTodaySeatsDialog>("till-today-seats-dialog", {
    heading: "Seats for 4+5",
    ...props,
  });
  return el;
}
function actionButton(el: TillTodaySeatsDialog) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-seats-action]")!;
}
/** What the action looks like and whether a person can press it: the host's state and its inner button's. */
async function actionState(el: TillTodaySeatsDialog) {
  await el.updateComplete;
  const button = actionButton(el);
  await button.updateComplete;
  return {
    variant: button.variant,
    disabled: button.disabled,
    innerDisabled: button.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
async function type(el: TillTodaySeatsDialog, value: string) {
  const field =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-number-stepper"]>("[name=seats]")!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
function confirmations(el: TillTodaySeatsDialog) {
  const sent: TodaySeatsDetail[] = [];
  el.addEventListener("today-seats-confirm", (event) =>
    sent.push((event as CustomEvent<TodaySeatsDetail>).detail),
  );
  return sent;
}

it("Join is ready at once when there is a suggestion", async () => {
  const el = await mount({ seats: 8, action: "join" });
  expect(await actionState(el)).toEqual(ready);
});

it("Join waits for a number when there is no suggestion", async () => {
  for (const seats of [null, 0]) {
    const el = await mount({ seats, action: "join" });
    expect(await actionState(el)).toEqual(quiet);
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-number-stepper"]>("[name=seats]")!
        .value,
    ).toBe("");
    await type(el, "6");
    expect(await actionState(el)).toEqual(ready);
    cleanupWidgets();
  }
});

it("Save waits for a change and goes quiet again when it is undone", async () => {
  const el = await mount({ seats: 6, action: "save" });
  expect(await actionState(el)).toEqual(quiet);
  await type(el, "7");
  expect(await actionState(el)).toEqual(ready);
  await type(el, "6");
  expect(await actionState(el)).toEqual(quiet);
});

// A host `.click()` reaches the action's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself sends nothing for an untouched number.
it("a press that reaches Save's handler with nothing changed sends nothing", async () => {
  const el = await mount({ seats: 6, action: "save" });
  const sent = confirmations(el);
  actionButton(el).click();
  await el.updateComplete;
  expect(sent).toEqual([]);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-number-stepper"]>("[name=seats]")!.error,
  ).toBe("");
});

it("after a save that leaves the dialog open, Save is quiet again", async () => {
  const el = await mount({ seats: 6, action: "save" });
  const sent = confirmations(el);
  await type(el, "7");
  actionButton(el).click();
  expect(sent).toEqual([{ seats: 7 }]);
  expect(await actionState(el)).toEqual(quiet);
});

it("the − and + buttons are changes like typing", async () => {
  const el = await mount({ seats: 6, action: "save" });
  const field =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-number-stepper"]>("[name=seats]")!;
  await field.updateComplete;
  field.shadowRoot!.querySelector<HTMLButtonElement>("[data-step='1']")!.click();
  expect(await actionState(el)).toEqual(ready);
  expect(field.value).toBe("7");
  field.shadowRoot!.querySelector<HTMLButtonElement>("[data-step='-1']")!.click();
  expect(await actionState(el)).toEqual(quiet);
});
