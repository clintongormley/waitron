import { setLocale } from "@waitron/dashboard-kit";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import "./kitchen-screen.js";
import type { KitchenScreen } from "./kitchen-screen.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

const stored = { warmAfterMinutes: 3, overdueAfterMinutes: 7, forgottenAfterMinutes: 12 };

function stubApi() {
  let timing = { ...stored };
  return {
    getBumpMode: vi.fn(async () => ({ mode: "line" })),
    getFireControl: vi.fn(async () => ({ mode: "waiter" })),
    listCourses: vi.fn(async () => []),
    getKitchenTimingDefaults: vi.fn(async () => ({ ...timing })),
    setKitchenTimingDefaults: vi.fn(async (next: typeof stored) => {
      timing = { ...next };
    }),
  };
}

const q = <T extends HTMLElement = HTMLElement>(el: KitchenScreen, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);

async function mountOpen() {
  setLocale("en");
  const api = stubApi();
  const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", {
    api: api as unknown as DashboardApi,
  });
  await vi.waitFor(() => expect(q(el, '[data-test="timing-values"]')).not.toBeNull());
  await open(el);
  return { el, api };
}
async function open(el: KitchenScreen) {
  q(el, '[data-test="edit-timing"]')!.click();
  await el.updateComplete;
  expect(q(el, '[data-test="timing-form"]')).not.toBeNull();
}

function save(el: KitchenScreen) {
  return q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="save-timing"]')!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function state(el: KitchenScreen) {
  await el.updateComplete;
  const action = save(el);
  await action.updateComplete;
  return {
    variant: action.variant,
    disabled: action.disabled,
    innerDisabled: action.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
const blocked = { variant: "primary", disabled: true, innerDisabled: true };

/** A real pointer press on the inner button; `force` presses a disabled one too. */
async function press(el: KitchenScreen) {
  await userEvent.click(page.elementLocator(save(el).shadowRoot!.querySelector("button")!), {
    force: true,
  });
  await el.updateComplete;
}
async function type(el: KitchenScreen, name: string, value: string) {
  const field = q<HTMLElementTagNameMap["wt-input"]>(el, `wt-input[name="${name}"]`)!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}

it("the late-flag form opens on the stored values with Save quiet, and a press sends nothing", async () => {
  const { el, api } = await mountOpen();
  expect(await state(el)).toEqual(quiet);
  await press(el);
  expect(api.setKitchenTimingDefaults).not.toHaveBeenCalled();
  expect(q(el, '[data-test="timing-form"]')).not.toBeNull();
});

it("one edit wakes Save, and typing the stored value back quiets it", async () => {
  const { el } = await mountOpen();
  for (const [name, edited, original] of [
    ["warmAfterMinutes", "4", "3"],
    ["overdueAfterMinutes", "8", "7"],
    ["forgottenAfterMinutes", "15", "12"],
  ] as const) {
    await type(el, name, edited);
    expect(await state(el)).toEqual(ready);
    await type(el, name, original);
    expect(await state(el)).toEqual(quiet);
  }
});

it("a changed form its own checks refuse stays drawn primary and disabled after a press", async () => {
  const { el, api } = await mountOpen();
  await type(el, "overdueAfterMinutes", "2");
  expect(await state(el)).toEqual(ready);
  await press(el);
  expect(api.setKitchenTimingDefaults).not.toHaveBeenCalled();
  expect(await state(el)).toEqual(blocked);
});

it("after a save, the reopened form shows the saved values with Save quiet", async () => {
  const { el, api } = await mountOpen();
  await type(el, "forgottenAfterMinutes", "15");
  await press(el);
  expect(api.setKitchenTimingDefaults).toHaveBeenCalledExactlyOnceWith({
    ...stored,
    forgottenAfterMinutes: 15,
  });
  await vi.waitFor(() => expect(q(el, '[data-test="timing-values"]')?.textContent).toContain("15"));
  await open(el);
  expect(await state(el)).toEqual(quiet);
});

// A host `.click()` reaches the listener even while the inner button is disabled, so this presses
// the host: what it proves is that the handler itself sends nothing for an untouched form.
it("a press that reaches an untouched Save's handler sends nothing", async () => {
  const { el, api } = await mountOpen();
  save(el).click();
  await el.updateComplete;
  expect(api.setKitchenTimingDefaults).not.toHaveBeenCalled();
  expect(q(el, '[data-test="timing-form"]')).not.toBeNull();
});

it("Cancel and Escape close the form when no application coordinates leaving", async () => {
  const { el } = await mountOpen();
  await type(el, "warmAfterMinutes", "4");
  q(el, '[data-test="cancel-timing"]')!.click();
  await el.updateComplete;
  expect(q(el, '[data-test="timing-form"]')).toBeNull();
  await open(el);
  await type(el, "warmAfterMinutes", "4");
  await userEvent.keyboard("{Escape}");
  await el.updateComplete;
  expect(q(el, '[data-test="timing-form"]')).toBeNull();
});
