import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale, t } from "./i18n/t.js";
import { cleanupWidgets, dialogClosed } from "./widgets/test-helpers.js";
import { device, deviceScreen, mountDeviceApp } from "./testing/device-settings-fixture.js";
import {
  cancelSettingSearch,
  chooseSettingRow,
  searchResult,
  searchSettings,
  settingChooser,
} from "./testing/setting-search-fixture.js";
const viewport: [number, number] = [window.innerWidth, window.innerHeight];
beforeEach(async () => {
  await page.viewport(1280, 800);
});
afterEach(async () => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
  await page.viewport(...viewport);
});
it.each(["en-GB", "es-ES"])(
  "%s opens the actual device editor without writes, including Cancel",
  async (locale) => {
    const { app, fetchImpl } = await mountDeviceApp({ locale });
    const start = fetchImpl.mock.calls.length;
    await searchSettings(app, t("devices.name"));
    expect(searchResult(app, "dashboard:device:name")).toBeTruthy();
    await userEvent.click(searchResult(app, "dashboard:device:name")!);
    const screen = deviceScreen(app);
    await expect
      .poll(() =>
        screen.shadowRoot!.querySelector("[name=defaultReaderId]")?.hasAttribute("disabled"),
      )
      .toBe(false);
    expect(screen.shadowRoot!.querySelector("[name=name]")).toHaveProperty("value", "Counter till");
    expect(location.pathname).toBe("/devices/device/d1");
    const modal = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
      "[data-test=edit-device-modal]",
    )!;
    const closed = dialogClosed(modal);
    await userEvent.click(modal.querySelector<HTMLElement>("[data-test=edit-cancel]")!);
    await closed;
    expect(fetchImpl.mock.calls.slice(start).filter(([, init]) => init.method !== "GET")).toEqual(
      [],
    );
  },
);
it("chooses a device row and Cancel does not pair or write", async () => {
  const { app, fetchImpl } = await mountDeviceApp({
    devices: [device, { ...device, id: "d2", label: "Handheld" }],
  });
  const start = fetchImpl.mock.calls.length;
  await searchSettings(app, t("devices.device_profile"));
  await userEvent.click(searchResult(app, "dashboard:device:profileId")!);
  await expect
    .poll(() => settingChooser(app)?.querySelector("wt-combobox")?.options)
    .toEqual([
      { value: "d1", label: "Counter till" },
      { value: "d2", label: "Handheld" },
    ]);
  await cancelSettingSearch(app);
  expect(fetchImpl.mock.calls.slice(start).filter(([, init]) => init.method !== "GET")).toEqual([]);
  await userEvent.click(searchResult(app, "dashboard:device:profileId")!);
  await chooseSettingRow(app, "d1");
  await userEvent.click(
    settingChooser(app)!.querySelector<HTMLElement>("[data-test=setting-open]")!,
  );
  await expect
    .poll(() =>
      deviceScreen(app)
        .shadowRoot!.querySelector("[name=defaultReaderId]")
        ?.hasAttribute("disabled"),
    )
    .toBe(false);
  expect(location.pathname).toBe("/devices/device/d1");
  expect(fetchImpl.mock.calls.slice(start).filter(([, init]) => init.method !== "GET")).toEqual([]);
});
it("requires hardware permission alongside the page gate", async () => {
  const own = await mountDeviceApp({ permissions: [], path: "/overview" });
  expect(own.app.shadowRoot!.querySelector("[data-test=nav-search]")).toBeNull();
  expect(searchResult(own.app, "dashboard:device:name")).toBeNull();
  cleanupWidgets();
  const { app } = await mountDeviceApp({ permissions: ["venue.view"], path: "/overview" });
  await searchSettings(app, t("devices.name"));
  expect(searchResult(app, "dashboard:device:name")).toBeNull();
});
