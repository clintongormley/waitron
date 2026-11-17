import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { leaveCoordinatorFor, type WtInput } from "@waitron/ui";
import { setLocale, t } from "@waitron/dashboard-kit";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { deep, mountReceiptApp } from "./testing/department-receipt-app-fixture.js";
import {
  chooseSettingRow,
  searchBox,
  searchResult,
  searchSettings,
  settingChooser,
} from "./testing/setting-search-fixture.js";
const originalViewport: [number, number] = [window.innerWidth, window.innerHeight];
beforeEach(async () => {
  await page.viewport(1280, 800);
});
afterEach(async () => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
  await page.viewport(...originalViewport);
});
const zones = [
  {
    id: "z1",
    name: "Terrace",
    departmentId: "bar",
    departmentName: "Bar",
    serviceMode: "prepay" as const,
  },
  {
    id: "z2",
    name: "Terrace",
    departmentId: "restaurant",
    departmentName: "Restaurant",
    serviceMode: "prepay" as const,
  },
];
const zoneEditor = (app: Parameters<typeof deep>[0]) =>
  deep(app, "zone-edit-dialog") as HTMLElementTagNameMap["zone-edit-dialog"] | null;
it.each(["en-GB", "es-ES"])("%s Zone name opens its editor", async (locale) => {
  const { app } = await mountReceiptApp({
    locale,
    path: "/venue-operations",
    zones: zones.slice(0, 1),
  });
  await searchSettings(app, t("venue.order_start"));
  expect(searchResult(app, "venue-service:department:orderStart")?.textContent).toContain(
    t("venue.department_tab.service"),
  );
  expect(searchResult(app, "venue-service:zone:orderStart")?.textContent).toContain(
    t("venue.edit_zone"),
  );
  await searchSettings(app, t("venue.zone_name"));
  expect(searchResult(app, "venue-service:zone:name")).toBeTruthy();
  await userEvent.click(searchResult(app, "venue-service:zone:name")!);
  await expect.poll(() => zoneEditor(app.shadowRoot!)?.zoneId).toBe("z1");
  await expect
    .poll(() => zoneEditor(app.shadowRoot!)?.shadowRoot?.querySelector("[name=name]"))
    .toBeTruthy();
  expect(location.pathname).toBe("/venue-operations/department/bar/view/zones/zone/z1");
  expect(searchBox(app).value).toBe("");
});
it("same-zone search preserves its edited draft", async () => {
  const { app } = await mountReceiptApp({
    path: "/venue-operations/department/bar/view/zones/zone/z1",
    zones,
    departments: [
      { id: "bar", name: "Bar" },
      { id: "restaurant", name: "Restaurant" },
    ],
  });
  await expect
    .poll(() => zoneEditor(app.shadowRoot!)?.shadowRoot?.querySelector("[name=name]"))
    .toBeTruthy();
  const name = () =>
    zoneEditor(app.shadowRoot!)!.shadowRoot!.querySelector<WtInput>("[name=name]")!;
  name().dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Edited terrace" },
      bubbles: true,
      composed: true,
    }),
  );
  await expect.poll(() => leaveCoordinatorFor(app)!.isDirty()).toBe(true);
  await searchSettings(app, "Zone name");
  expect(searchResult(app, "venue-service:zone:name")).toBeTruthy();
  searchResult(app, "venue-service:zone:name")!.click();
  await expect.poll(() => settingChooser(app)?.querySelector("wt-combobox")).toBeTruthy();
  await chooseSettingRow(app, "z1");
  await userEvent.click(
    settingChooser(app)!.querySelector<HTMLElement>("[data-test=setting-open]")!,
  );
  await expect.poll(() => settingChooser(app)).toBeNull();
  expect(zoneEditor(app.shadowRoot!)?.zoneId).toBe("z1");
  expect(name().value).toBe("Edited terrace");
  expect(leaveCoordinatorFor(app)!.isDirty()).toBe(true);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(searchBox(app).value).toBe("");
});
