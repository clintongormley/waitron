import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { Station } from "../api/client.js";
import type { WtCombobox } from "@waitron/ui/src/components/wt-combobox.js";
import "./station-choice-dialog.js";
import type { TillStationChoiceDialog } from "./station-choice-dialog.js";

const stations: Station[] = [
  {
    id: "grill",
    name: "Grill",
    displayOrder: 0,
    isDefault: true,
    active: true,
    open: true,
    byHand: null,
    sendsTo: null,
    why: "default" as const,
  },
  {
    id: "bar",
    name: "Upstairs bar",
    displayOrder: 1,
    isDefault: false,
    active: true,
    open: false,
    byHand: null,
    sendsTo: null,
    why: "out_of_hours" as const,
  },
];

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

async function mount(props: Partial<TillStationChoiceDialog>): Promise<TillStationChoiceDialog> {
  const { el } = await mountWidget<TillStationChoiceDialog>("till-station-choice-dialog", {
    stations,
    dishName: "Paella",
    ...props,
  });
  return el;
}
function submitButton(el: TillStationChoiceDialog) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-submit]")!;
}
async function submitState(el: TillStationChoiceDialog) {
  await el.updateComplete;
  const submit = submitButton(el);
  await submit.updateComplete;
  return {
    variant: submit.variant,
    disabled: submit.disabled,
    innerDisabled: submit.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
async function choose(el: TillStationChoiceDialog, index: number): Promise<void> {
  const select = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="station"]')!;
  select.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!.click();
  await select.updateComplete;
  select.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')[index]!.click();
  await el.updateComplete;
}
function chosen(el: TillStationChoiceDialog) {
  const heard: unknown[] = [];
  el.addEventListener("station-chosen", (event) => heard.push((event as CustomEvent).detail));
  return heard;
}

it("Make at, opened on the line's station, has Save quiet and disabled", async () => {
  const el = await mount({ mode: "make-at", currentStationId: "bar" });
  expect(await submitState(el)).toEqual(quiet);
});

it("Make at: another station makes Save primary and enabled, and the original back makes it quiet", async () => {
  const el = await mount({ mode: "make-at", currentStationId: "bar" });
  await choose(el, 1);
  expect(await submitState(el)).toEqual(ready);
  await choose(el, 2);
  expect(await submitState(el)).toEqual(quiet);
});

it("Make at, opened with no station chosen, starts at the rules with Save quiet and disabled", async () => {
  const el = await mount({ mode: "make-at" });
  expect(await submitState(el)).toEqual(quiet);
});

// A host `.click()` reaches Save's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself sends nothing for an untouched choice.
it("Make at: a press that reaches Save's handler on an untouched choice sends nothing", async () => {
  const el = await mount({ mode: "make-at", currentStationId: "bar" });
  const heard = chosen(el);
  submitButton(el).click();
  await el.updateComplete;
  expect(heard).toEqual([]);
});

it("Make at: after a save that leaves the dialog open, Save is quiet again", async () => {
  const el = await mount({ mode: "make-at", currentStationId: "bar" });
  const heard = chosen(el);
  await choose(el, 1);
  submitButton(el).click();
  expect(heard).toEqual([{ stationId: "grill" }]);
  expect(await submitState(el)).toEqual(quiet);
});

it("Move opens quiet and disabled, and a different station enables it without turning it primary", async () => {
  const el = await mount({ mode: "move", currentStationId: "grill" });
  expect(await submitState(el)).toEqual(quiet);
  await choose(el, 1);
  expect(await submitState(el)).toEqual({
    variant: "secondary",
    disabled: false,
    innerDisabled: false,
  });
  const heard = chosen(el);
  submitButton(el).click();
  expect(heard).toEqual([{ stationId: "bar" }]);
});
