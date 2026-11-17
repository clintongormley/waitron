import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale, t } from "./i18n/t.js";
import { reader } from "./testing/reader-settings-fixture.js";
import { selectProfileTab } from "./testing/profile-table.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import {
  deviceProfile,
  mountProfileApp,
  profileScreen,
} from "./testing/device-settings-fixture.js";
import {
  cancelSettingSearch,
  chooseSettingRow,
  searchResult,
  searchSettings,
  settingChooser,
} from "./testing/setting-search-fixture.js";
const viewport: [number, number] = [innerWidth, innerHeight];
beforeEach(async () => {
  await page.viewport(1280, 800);
});
afterEach(async () => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
  await page.viewport(...viewport);
});
it("settings land on their tab without writes", async () => {
  const { app, fetchImpl } = await mountProfileApp({
    respond: (path) =>
      path === "/management-api/payments/readers"
        ? Promise.resolve(Response.json([reader]))
        : undefined,
  });
  const start = fetchImpl.mock.calls.length;
  await searchSettings(app, t("device_profiles.inactivity_timeout_label"));
  const result = searchResult(app, "dashboard:device-profile:inactivityTimeout:general");
  expect(result).toBeTruthy();
  await userEvent.click(result!);
  await expect
    .poll(() => profileScreen(app).shadowRoot!.querySelector("[name=inactivityTimeout]"))
    .toBeTruthy();
  expect(location.pathname).toBe("/device-profiles/profile/dp1/view/general");
  await expect
    .poll(() => profileScreen(app).shadowRoot!.querySelector("[name=defaultReaderId]"))
    .toBeTruthy();
  await expect
    .poll(() => fetchImpl.mock.calls.some(([path]) => path.endsWith("/dp1/readers")))
    .toBe(true);
  await expect
    .poll(() =>
      profileScreen(app)
        .shadowRoot!.querySelector("[data-test=profile-save]")
        ?.hasAttribute("disabled"),
    )
    .toBe(true);
  expect(fetchImpl.mock.calls.slice(start).filter(([, init]) => init.method !== "GET")).toEqual([]);
});
it("chooser selects a profile and Cancel stays put", async () => {
  const { app } = await mountProfileApp({
    profiles: [deviceProfile, { ...deviceProfile, id: "p2", name: "Bar" }],
  });
  await searchSettings(app, t("device_profiles.name"));
  await userEvent.click(searchResult(app, "dashboard:device-profile:name:general")!);
  await expect
    .poll(() => settingChooser(app)?.querySelector("wt-combobox")?.options)
    .toEqual([
      { value: "dp1", label: "Counter" },
      { value: "p2", label: "Bar" },
    ]);
  const push = vi.spyOn(history, "pushState");
  await cancelSettingSearch(app);
  expect(push).not.toHaveBeenCalled();
  await userEvent.click(searchResult(app, "dashboard:device-profile:name:general")!);
  await chooseSettingRow(app, "p2");
  await userEvent.click(
    settingChooser(app)!.querySelector<HTMLElement>("[data-test=setting-open]")!,
  );
  await expect
    .poll(() => profileScreen(app).shadowRoot!.querySelector("[name=name]"))
    .toHaveProperty("value", "Bar");
});
it.each([
  ["venue.view"],
  ["venue.view", "venue.configure"],
  ["venue.view", "hardware.manage"],
  ["venue.view", "venue.configure", "hardware.manage"],
])("profile and equipment gates match their reads: %j", async (...permissions: string[]) => {
  const { app } = await mountProfileApp({ permissions, path: "/overview" });
  await searchSettings(app, t("device_profiles.name"));
  expect(!!searchResult(app, "dashboard:device-profile:name:general")).toBe(
    permissions.includes("venue.configure"),
  );
  await searchSettings(app, t("device_profiles.reader_default"));
  expect(!!searchResult(app, "dashboard:device-profile:defaultReaderId:equipment")).toBe(
    permissions.includes("venue.configure") && permissions.includes("hardware.manage"),
  );
  await searchSettings(app, t("device_profiles.receipt_default"));
  expect(!!searchResult(app, "dashboard:device-profile:receiptPrinterDefaultId:equipment")).toBe(
    permissions.includes("venue.configure") && permissions.includes("hardware.manage"),
  );
});

it("same-profile search asks Keep/Discard and retains the editor without reloading", async () => {
  const { app, fetchImpl } = await mountProfileApp({ path: "/device-profiles/profile/dp1" });
  const screen = profileScreen(app);
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=name]")).toBeTruthy();
  screen
    .shadowRoot!.querySelector("[name=name]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Draft" } }));
  await selectProfileTab(screen, "who");
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(location.pathname).toBe("/device-profiles/profile/dp1/view/who");
  expect(screen.shadowRoot!.querySelector("[name=name]")).toHaveProperty("value", "Draft");
  await selectProfileTab(screen, "general");
  const open = async () => {
    await searchSettings(app, t("device_profiles.capability.take-cash"));
    await userEvent.click(
      searchResult(app, "dashboard:device-profile:capability.take-cash:capabilities")!,
    );
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  };
  const choose = async (decision: string) => {
    const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await userEvent.click(
      question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!,
    );
    await expect.poll(() => question.open).toBe(false);
  };
  await open();
  await choose("keep");
  expect(screen.shadowRoot!.querySelector("[name=name]")).toHaveProperty("value", "Draft");
  expect(screen.shadowRoot!.querySelector("wt-tabs")).toHaveProperty("value", "general");
  await open();
  await choose("discard");
  await expect
    .poll(() => screen.shadowRoot!.querySelector("wt-tabs"))
    .toHaveProperty("value", "capabilities");
  expect(screen.shadowRoot!.querySelector("[name=name]")).toHaveProperty("value", "Counter");
  expect(
    fetchImpl.mock.calls.filter(([path]) => path === "/management-api/device-profiles/dp1"),
  ).toHaveLength(1);
});
