import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import type { WatcherForm } from "./watcher-form.js";
import "./watcher-form.js";

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  setLocale("en");
});
async function mount() {
  setLocale("en");
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const form = document.createElement("watcher-form") as WatcherForm;
  form.stations = [
    { id: "grill", name: "Grill" },
    { id: "off", name: "Off", active: false },
  ];
  form.zones = [{ id: "terrace", name: "Terrace", active: true }];
  host.append(form);
  await form.updateComplete;
  return form;
}
const q = (form: WatcherForm, selector: string) =>
  form.shadowRoot!.querySelector<HTMLElement>(selector);
const change = (form: WatcherForm, selector: string, detail: object) =>
  q(form, selector)!.dispatchEvent(new CustomEvent("wt-change", { detail }));

it("explains all three required fields after an invalid save and keeps Save disabled", async () => {
  const form = await mount();
  const saved = vi.fn();
  form.addEventListener("watcher-save", saved);
  expect(q(form, '[name="name"]')!.hasAttribute("required")).toBe(true);
  expect(q(form, '[data-test="stations"]')?.textContent).toContain("Stations *");
  expect(q(form, '[data-test="zones"]')?.textContent).toContain("Service zones *");
  expect(q(form, '[name="everyStation"]')?.parentElement?.textContent).toContain("Every station");
  expect(q(form, '[name="everyZone"]')?.parentElement?.textContent).toContain("Every service zone");
  q(form, '[data-test="save-watcher"]')!.click();
  await form.updateComplete;
  expect(q(form, '[data-field-error="name"]')?.textContent).toContain("required");
  expect(q(form, '[data-field-error="stationIds"]')?.textContent).toContain(
    "Choose at least one station",
  );
  expect(q(form, '[data-field-error="zoneIds"]')?.textContent).toContain(
    "Choose at least one service zone",
  );
  expect(q(form, '[data-test="watcher-error"]')?.textContent).toContain(
    "Fix the fields marked above.",
  );
  expect(
    (q(form, '[data-test="save-watcher"]') as HTMLElement & { disabled: boolean }).disabled,
  ).toBe(true);
  expect(saved).not.toHaveBeenCalled();
});

it("disables station boxes for every station and saves only visible checked boxes", async () => {
  const form = await mount();
  const saved = vi.fn();
  form.addEventListener("watcher-save", saved);
  change(form, '[name="name"]', { value: "Pass" });
  change(form, '[name="everyStation"]', { checked: true });
  change(form, '[name="zoneIds"]', { checked: true, value: "terrace" });
  change(form, '[name="runsPass"]', { checked: true });
  await form.updateComplete;
  expect(q(form, '[name="stationIds"]')!.hasAttribute("disabled")).toBe(true);
  expect(form.shadowRoot!.querySelectorAll('[name="stationIds"]')).toHaveLength(1);
  q(form, '[data-test="save-watcher"]')!.click();
  expect(saved.mock.calls[0]![0].detail.input).toEqual({
    name: "Pass",
    everyStation: true,
    stationIds: [],
    everyZone: false,
    zoneIds: ["terrace"],
    runsPass: true,
  });
});

it("keeps an edited watcher's saved display order", async () => {
  const form = await mount();
  const saved = vi.fn();
  form.addEventListener("watcher-save", saved);
  form.watcher = {
    id: "pass",
    name: "Pass",
    displayOrder: 7,
    active: true,
    everyStation: true,
    stationIds: [],
    everyZone: true,
    zoneIds: [],
    runsPass: true,
    printerIds: [],
  };
  await form.updateComplete;
  change(form, '[name="name"]', { value: "Main pass" });
  await form.updateComplete;
  q(form, '[data-test="save-watcher"]')!.click();
  expect(saved).toHaveBeenCalledOnce();
  expect(saved.mock.calls[0]![0].detail.input).toMatchObject({
    name: "Main pass",
    displayOrder: 7,
  });
});

it.each([
  ["watcher.name_taken", undefined, "name"],
  ["management.request_invalid", "stationIds", "stationIds"],
  ["management.request_invalid", "zoneIds", "zoneIds"],
  ["station.not_found", undefined, "stationIds"],
  ["zone.not_found", undefined, "zoneIds"],
  ["watcher.not_found", undefined, "bottom"],
] as const)("places %s refusal at %s", async (code, field, place) => {
  const form = await mount();
  form.refusal = { code, params: field ? { field } : {} };
  await form.updateComplete;
  expect(
    q(form, place === "bottom" ? '[data-test="watcher-error"]' : `[data-field-error="${place}"]`)
      ?.textContent,
  ).toBeTruthy();
});
