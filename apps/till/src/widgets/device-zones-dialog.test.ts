import { afterEach, expect, it } from "vitest";
import { DeviceZonesDialog } from "./device-zones-dialog.js";
import { userEvent } from "vitest/browser";
import type { DeviceZoneSelection, DeviceZoneSelectionInput } from "@waitron/venue-service";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
const selection: DeviceZoneSelection = {
  profileId: "profile",
  snapshot: "scope",
  adjusted: false,
  selectedZoneIds: ["bar", "room"],
  startingZoneId: "bar",
  zones: [
    {
      id: "bar",
      name: "Bar",
      departmentId: "dept",
      departmentName: "Restaurant",
      serviceMode: "prepay",
    },
    {
      id: "room",
      name: "Room",
      departmentId: "dept",
      departmentName: "Restaurant",
      serviceMode: "table_tab",
    },
  ],
};
async function mount() {
  setLocale("en");
  const { el } = await mountWidget<DeviceZonesDialog>("till-device-zones-dialog", {
    open: true,
    selection,
  });
  const saved: DeviceZoneSelectionInput[] = [];
  el.addEventListener("save-device-zones", (e: Event) =>
    saved.push((e as CustomEvent<DeviceZoneSelectionInput>).detail),
  );
  return { el, saved };
}
const input = (el: HTMLElement, name: string, value: string) =>
  el.shadowRoot?.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
const save = (el: HTMLElement) =>
  el.shadowRoot?.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-zones-save]");

it("saves a detached subset and its selected starting zone", async () => {
  const { el, saved } = await mount();
  expect(input(el, "shown-zone", "bar")).toBeTruthy();
  await userEvent.click(input(el, "starting-zone", "room")!);
  await userEvent.click(input(el, "shown-zone", "bar")!);
  await userEvent.click(save(el)!);
  expect(saved).toEqual([
    { profileId: "profile", snapshot: "scope", selectedZoneIds: ["room"], startingZoneId: "room" },
  ]);
  expect(selection.selectedZoneIds).toEqual(["bar", "room"]);
  expect(selection.startingZoneId).toBe("bar");
});

it("unchanged Save is quiet and sends nothing, including after reverting set membership", async () => {
  const { el, saved } = await mount();
  expect(save(el)?.disabled).toBe(true);
  expect(save(el)?.variant).toBe("secondary");
  save(el)!.dispatchEvent(new Event("click"));
  await userEvent.click(input(el, "shown-zone", "room")!);
  await userEvent.click(input(el, "shown-zone", "room")!);
  expect(save(el)?.disabled).toBe(true);
  expect(saved).toEqual([]);
});

it("hiding the starting zone requires an explicit visible replacement and explains an invalid save", async () => {
  const { el, saved } = await mount();
  expect(input(el, "shown-zone", "bar")).toBeTruthy();
  await userEvent.click(input(el, "shown-zone", "bar")!);
  expect(input(el, "starting-zone", "bar")!.disabled).toBe(true);
  expect(input(el, "starting-zone", "room")!.checked).toBe(false);
  await userEvent.click(save(el)!);
  expect(saved).toEqual([]);
  expect(el.shadowRoot!.querySelector("[data-start-error]")!.textContent).toContain("Choose");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
  expect(save(el)!.disabled).toBe(true);
  await userEvent.click(input(el, "starting-zone", "room")!);
  expect(save(el)!.disabled).toBe(false);
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
});

it("an empty subset marks both groups and stays protected until corrected", async () => {
  const { el, saved } = await mount();
  expect(input(el, "shown-zone", "bar")).toBeTruthy();
  await userEvent.click(input(el, "shown-zone", "bar")!);
  await userEvent.click(input(el, "shown-zone", "room")!);
  await userEvent.click(save(el)!);
  expect(el.shadowRoot!.querySelector("[data-zones-error]")!.textContent).not.toBe("");
  expect(el.shadowRoot!.querySelector("[data-start-error]")!.textContent).not.toBe("");
  expect(saved).toEqual([]);
});

it("a write refusal keeps edits and permits retry without editing", async () => {
  const { el, saved } = await mount();
  expect(input(el, "starting-zone", "room")).toBeTruthy();
  await userEvent.click(input(el, "starting-zone", "room")!);
  await userEvent.click(save(el)!);
  el.refusal = { code: "device_zones.changed", field: "selectedZoneIds" };
  await el.updateComplete;
  expect(input(el, "starting-zone", "room")!.checked).toBe(true);
  expect(save(el)!.disabled).toBe(false);
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
  await userEvent.click(save(el)!);
  expect(saved).toHaveLength(2);
  expect(saved[1]).toEqual(saved[0]);
});

it("a refreshed scope preserves dirty choices and refuses a newly forbidden zone", async () => {
  const { el, saved } = await mount();
  expect(input(el, "starting-zone", "room")).toBeTruthy();
  await userEvent.click(input(el, "starting-zone", "room")!);
  el.selection = { ...selection, snapshot: "narrowed", zones: [selection.zones[0]!] };
  await el.updateComplete;
  save(el)!.dispatchEvent(new Event("click"));
  await el.updateComplete;
  expect(saved).toEqual([]);
  expect(el.shadowRoot!.querySelector("[data-zones-error]")!.textContent).not.toBe("");
  expect(el.shadowRoot!.querySelector("[data-start-error]")!.textContent).not.toBe("");
  expect(input(el, "shown-zone", "room")!.disabled).toBe(false);
  await userEvent.click(input(el, "shown-zone", "room")!);
  await userEvent.click(input(el, "starting-zone", "bar")!);
  await userEvent.click(save(el)!);
  expect(saved).toEqual([
    { profileId: "profile", snapshot: "narrowed", selectedZoneIds: ["bar"], startingZoneId: "bar" },
  ]);
});

it("busy settings block a second submission and native field edits", async () => {
  const { el, saved } = await mount();
  expect(input(el, "starting-zone", "room")).toBeTruthy();
  await userEvent.click(input(el, "starting-zone", "room")!);
  el.busy = true;
  await el.updateComplete;
  expect(input(el, "shown-zone", "bar")!.disabled).toBe(true);
  save(el)!.dispatchEvent(new Event("click"));
  expect(saved).toEqual([]);
});
