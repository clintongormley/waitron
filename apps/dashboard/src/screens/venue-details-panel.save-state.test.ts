import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { venueClockPreviewFixture, venueDetailsFixture } from "../testing/venue-details-fixture.js";
import { setLocale } from "../i18n/t.js";
import type { DashboardApi, VenueDetailsModel, VenueDetailWrite } from "../api/client.js";
import "./venue-details-panel.js";
import type { VenueDetailsPanel } from "./venue-details-panel.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

// Every field holds something, the cutover in the seconds spelling a stored time comes back in,
// and the province is editable, so a field that rewrites its value on first draw shows as a change.
function filled(): VenueDetailsModel {
  const model = venueDetailsFixture({ addressLine2: "Piso 2", dayCutover: "06:00:00" });
  model.policy.province = { decision: "allow", reasons: [] };
  return model;
}

function stubApi(model: VenueDetailsModel) {
  let current = structuredClone(model);
  return {
    liveData: new LiveData(),
    getVenueDetails: vi.fn(async () => structuredClone(current)),
    getVenueClockPreview: vi.fn(async () => venueClockPreviewFixture()),
    patchVenueDetails: vi.fn(async (body: VenueDetailWrite) => {
      current = { ...current, details: { ...current.details, ...body.changes } };
      return { changed: true, model: structuredClone(current) };
    }),
  };
}

const q = <T extends HTMLElement = HTMLElement>(el: VenueDetailsPanel, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
async function settle(el: VenueDetailsPanel) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}
async function open(el: VenueDetailsPanel) {
  q(el, "[data-test=edit]")!.click();
  await settle(el);
  expect(q(el, "form")).not.toBeNull();
}
async function mountOpen(model = filled()) {
  setLocale("en-GB");
  const api = stubApi(model);
  const { el } = await mountWidget<VenueDetailsPanel>("dashboard-venue-details-panel", {
    api: api as unknown as DashboardApi,
  });
  await vi.waitFor(() => expect(q(el, "[data-test=edit]")).not.toBeNull());
  await open(el);
  return { el, api };
}

function save(el: VenueDetailsPanel) {
  return q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function state(el: VenueDetailsPanel) {
  await settle(el);
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
async function press(el: VenueDetailsPanel, selector: string) {
  const host = q<HTMLElementTagNameMap["wt-button"]>(el, selector)!;
  await userEvent.click(page.elementLocator(host.shadowRoot!.querySelector("button")!), {
    force: true,
  });
  await settle(el);
}
async function type(el: VenueDetailsPanel, name: string, value: string) {
  const field = q<HTMLElementTagNameMap["wt-input"]>(el, `wt-input[name="${name}"]`)!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await settle(el);
}

it("a filled record opens with Save quiet, and a press sends nothing and keeps the form open", async () => {
  const { el, api } = await mountOpen();
  expect(q(el, "wt-combobox[name=province]")).not.toBeNull();
  expect(await state(el)).toEqual(quiet);
  await press(el, "[data-test=save]");
  expect(api.patchVenueDetails).not.toHaveBeenCalled();
  expect(q(el, "form")).not.toBeNull();
  expect(q(el, "[data-test=acknowledge]")).toBeNull();
});

it("a record with unset address values opens with Save quiet", async () => {
  const { el } = await mountOpen(
    venueDetailsFixture({ addressLine1: null, postalCode: null, city: null, province: null }),
  );
  expect(await state(el)).toEqual(quiet);
});

it("one edit wakes Save, and typing the stored value back, in any stored spelling, quiets it", async () => {
  const { el } = await mountOpen();
  await type(el, "addressLine1", "Calle Mayor 2");
  expect(await state(el)).toEqual(ready);
  await type(el, "addressLine1", "Calle Mayor 1");
  expect(await state(el)).toEqual(quiet);
  await type(el, "addressLine2", "Piso 3");
  expect(await state(el)).toEqual(ready);
  await type(el, "addressLine2", "Piso 2");
  expect(await state(el)).toEqual(quiet);
  await type(el, "dayCutover", "06:00");
  expect(await state(el)).toEqual(quiet);
});

it("a change that needs acknowledging is drawn primary and disabled until acknowledged", async () => {
  const { el } = await mountOpen();
  await type(el, "venueName", "Renamed");
  expect(await state(el)).toEqual(blocked);
  await press(el, "[data-test=acknowledge]");
  expect(await state(el)).toEqual(ready);
});

it("after a save, the reopened form shows the saved values with Save quiet", async () => {
  const { el, api } = await mountOpen();
  await type(el, "addressLine1", "Calle Mayor 2");
  await press(el, "[data-test=save]");
  expect(api.patchVenueDetails).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(q(el, "form")).toBeNull());
  await open(el);
  expect(await state(el)).toEqual(quiet);
});

// A host `.click()` reaches the listener even while the inner button is disabled, so this presses
// the host: what it proves is that the handler itself sends nothing for an untouched form.
it("a press that reaches an untouched Save's handler sends nothing and keeps the form open", async () => {
  const { el, api } = await mountOpen();
  save(el).click();
  await settle(el);
  expect(api.patchVenueDetails).not.toHaveBeenCalled();
  expect(q(el, "form")).not.toBeNull();
});

it("Cancel closes a changed form when no application coordinates leaving", async () => {
  const { el } = await mountOpen();
  await type(el, "addressLine1", "Calle Mayor 2");
  q(el, "[data-test=cancel]")!.click();
  await settle(el);
  expect(q(el, "form")).toBeNull();
});
