import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import type { StationHoursForm } from "./station-hours-form.js";
import "./station-hours-form.js";

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  setLocale("en");
});

async function mount(hours: { weekday: number; opensAt: string; closesAt: string }[]) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const form = document.createElement("station-hours-form") as StationHoursForm;
  form.hours = hours;
  host.append(form);
  await form.updateComplete;
  return form;
}

it("keeps one editable row per interval and saves the entire list", async () => {
  const form = await mount([
    { weekday: 5, opensAt: "19:00", closesAt: "21:00" },
    { weekday: 6, opensAt: "19:00", closesAt: "21:00" },
  ]);
  expect(form.shadowRoot!.querySelectorAll('[data-test="hours-row"]')).toHaveLength(2);
  const saved = vi.fn();
  form.addEventListener("hours-save", saved);
  form.shadowRoot!.querySelector<HTMLElement>('[data-test="save-hours"]')!.click();
  await form.updateComplete;
  expect(saved.mock.calls[0]![0].detail.hours).toEqual([
    { weekday: 5, opensAt: "19:00", closesAt: "21:00" },
    { weekday: 6, opensAt: "19:00", closesAt: "21:00" },
  ]);
});

it("refuses equal times beside both fields, and accepts an overnight interval", async () => {
  const form = await mount([{ weekday: 5, opensAt: "22:00", closesAt: "22:00" }]);
  const saved = vi.fn();
  form.addEventListener("hours-save", saved);
  form.shadowRoot!.querySelector<HTMLElement>('[data-test="save-hours"]')!.click();
  await form.updateComplete;
  expect(form.shadowRoot!.querySelectorAll('[data-field-error="hours.0"]')).toHaveLength(2);
  expect(saved).not.toHaveBeenCalled();
  const close = form.shadowRoot!.querySelector('[data-test="closes-0"]')!;
  close.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "02:00" } }));
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector('[data-test="next-day-0"]')?.textContent).toContain(
    "until 02:00 the next day",
  );
  form.shadowRoot!.querySelector<HTMLElement>('[data-test="save-hours"]')!.click();
  expect(saved.mock.calls[0]![0].detail.hours).toEqual([
    { weekday: 5, opensAt: "22:00", closesAt: "02:00" },
  ]);
});

it("keeps Save disabled after an invalid attempt until the row is corrected", async () => {
  const form = await mount([{ weekday: 5, opensAt: "22:00", closesAt: "22:00" }]);
  const save = form.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    '[data-test="save-hours"]',
  )!;
  save.click();
  await form.updateComplete;
  expect(save.disabled).toBe(true);
  const close = form.shadowRoot!.querySelector('[data-test="closes-0"]')!;
  close.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "02:00" } }));
  await form.updateComplete;
  expect(save.disabled).toBe(false);
  expect(form.shadowRoot!.querySelector("[data-field-error]")).toBeNull();
});

it("explains a missing opening time beside its field and marks time fields required", async () => {
  const form = await mount([{ weekday: 5, opensAt: "", closesAt: "02:00" }]);
  form.shadowRoot!.querySelector<HTMLElement>('[data-test="save-hours"]')!.click();
  await form.updateComplete;
  expect(
    form.shadowRoot!.querySelector('[data-test="opens-0"]')!.getAttribute("aria-invalid"),
  ).toBe("true");
  expect(form.shadowRoot!.querySelector('[data-test="opens-0"]')!.hasAttribute("required")).toBe(
    true,
  );
  expect(form.shadowRoot!.querySelector('[data-field-error="hours.0"]')?.textContent).toContain(
    "required",
  );
});

it("adds and removes intervals without dropping edits in the other row", async () => {
  const form = await mount([{ weekday: 5, opensAt: "22:00", closesAt: "02:00" }]);
  form.shadowRoot!.querySelector<HTMLElement>('[data-test="add-hours"]')!.click();
  await form.updateComplete;
  const weekday = form.shadowRoot!.querySelector('[data-test="weekday-1"]')!;
  weekday.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "6" } }));
  await form.updateComplete;
  form.shadowRoot!.querySelector<HTMLElement>('[aria-label="Remove hours 1"]')!.click();
  await form.updateComplete;
  const saved = vi.fn();
  form.addEventListener("hours-save", saved);
  form.shadowRoot!.querySelector<HTMLElement>('[data-test="save-hours"]')!.click();
  expect(saved.mock.calls[0]![0].detail.hours).toEqual([
    { weekday: 6, opensAt: "09:00", closesAt: "17:00" },
  ]);
});

it("keeps hours actions in the dialog footer when editing many intervals", async () => {
  const form = await mount(
    Array.from({ length: 14 }, (_, index) => ({
      weekday: index % 7,
      opensAt: "22:00",
      closesAt: "02:00",
    })),
  );
  (form as StationHoursForm & { inDialog: boolean }).inDialog = true;
  form.requestUpdate();
  await form.updateComplete;
  const modal = form.shadowRoot!.querySelector("wt-modal");
  expect(modal).not.toBeNull();
  expect(modal!.querySelector('wt-form-actions[slot="footer"]')).not.toBeNull();
  expect(form.shadowRoot!.querySelectorAll('[data-test="hours-row"]')).toHaveLength(14);
});

it("clears a server row refusal when that interval is edited and permits retry", async () => {
  const form = await mount([{ weekday: 5, opensAt: "22:00", closesAt: "02:00" }]);
  form.serverErrors = { 0: "The interval was refused." };
  await form.updateComplete;
  expect(form.shadowRoot!.querySelectorAll('[data-field-error="hours.0"]')).toHaveLength(2);
  expect(
    (
      form.shadowRoot!.querySelector('[data-test="save-hours"]') as HTMLElement & {
        disabled: boolean;
      }
    ).disabled,
  ).toBe(false);
  const close = form.shadowRoot!.querySelector('[data-test="closes-0"]')!;
  close.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "03:00" } }));
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector('[data-field-error="hours.0"]')).toBeNull();
});
