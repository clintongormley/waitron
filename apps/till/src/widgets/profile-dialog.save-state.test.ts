import { afterEach, beforeEach, expect, it } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { WtCombobox } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./profile-dialog.js";
import type { TillProfileDialog } from "./profile-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

const COUNTER = { id: "pr-counter", name: "Counter till" };
const BAR = { id: "pr-bar", name: "Bar till" };

async function mount(props: Partial<TillProfileDialog> = {}): Promise<TillProfileDialog> {
  const { el } = await mountWidget<TillProfileDialog>("till-profile-dialog", {
    open: true,
    profiles: [COUNTER, BAR],
    activeProfileId: COUNTER.id,
    ...props,
  });
  return el;
}
const picker = (el: TillProfileDialog) =>
  el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="profileId"]')!;
const switchButton = (el: TillProfileDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="profile-switch"]')!;
/** What Switch looks like and whether a person can press it: the host's state and its inner button's. */
async function switchState(el: TillProfileDialog) {
  await el.updateComplete;
  const button = switchButton(el);
  await button.updateComplete;
  return {
    variant: button.variant,
    disabled: button.disabled,
    innerDisabled: button.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
async function choose(el: TillProfileDialog, id: string) {
  await chooseOption(picker(el), id);
  await el.updateComplete;
}
function switches(el: TillProfileDialog): string[] {
  const seen: string[] = [];
  el.addEventListener("profile-switch", (event) =>
    seen.push((event as CustomEvent<{ profileId: string }>).detail.profileId),
  );
  return seen;
}

it("opens on the active profile with Switch quiet and disabled", async () => {
  const el = await mount();
  expect(await switchState(el)).toEqual(quiet);
});

it("choosing another profile makes Switch primary and enabled, and choosing the active one again makes it quiet", async () => {
  const el = await mount();
  await choose(el, BAR.id);
  expect(await switchState(el)).toEqual(ready);
  await choose(el, COUNTER.id);
  expect(await switchState(el)).toEqual(quiet);
});

// A host `.click()` reaches Switch's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself reports nothing for an untouched choice.
it("a press that reaches Switch's handler with the active profile chosen reports nothing", async () => {
  const el = await mount();
  const seen = switches(el);
  switchButton(el).click();
  await el.updateComplete;
  expect(seen).toEqual([]);
});

it.each([
  ["a refusal about the chosen profile", { code: "device_profile.not_approved" }],
  ["an order in progress", "order_open" as const],
])("with %s and another profile chosen, Switch stays enabled", async (_name, notice) => {
  const el = await mount();
  await choose(el, BAR.id);
  el.notice = notice;
  expect(await switchState(el)).toEqual(ready);
});
