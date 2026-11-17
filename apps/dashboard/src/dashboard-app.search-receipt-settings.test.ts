import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale, t } from "./i18n/t.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import {
  departmentDialog,
  mountReceiptApp,
  receiptTabEditor,
} from "./testing/department-receipt-app-fixture.js";
import {
  chooseSettingRow,
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
const id = (name: string) => `dashboard:department-receipt:${name}`;
it.each([
  ["en-GB", "receipts.email", "email"],
  ["es-ES", "receipts.phone", "phone"],
  ["en-GB", "appearance.logo", "logo"],
] as const)("real receipt label %s/%s opens Receipt", async (locale, label, name) => {
  const { app, fetchImpl } = await mountReceiptApp({
    locale,
    path: "/venue-operations",
    departments: [
      { id: "bar", name: "Bar" },
      { id: "closed", name: "Closed", active: false },
    ],
  });
  await searchSettings(app, t(label));
  expect(searchResult(app, id(name))).toBeTruthy();
  if (name === "logo")
    expect(
      app.shadowRoot!.querySelectorAll(
        `[data-search-destination^="dashboard:department-receipt:logo"]`,
      ),
    ).toHaveLength(1);
  await userEvent.click(searchResult(app, id(name))!);
  await expect.poll(() => departmentDialog(app)?.tab).toBe("receipt");
  await expect
    .poll(() => receiptTabEditor(app)?.shadowRoot?.querySelector(`[name=${name}]`))
    .toBeTruthy();
  expect(location.pathname).toBe("/venue-operations/department/bar/view/receipt");
  const reads = fetchImpl.mock.calls.filter(
    ([path]) => path === "/management-api/venue-service/departments-and-zones",
  );
  expect(reads.some(([, init]) => new Headers(init.headers).get("x-waitron-live") === "1")).toBe(
    true,
  );
});
it("receipt chooser includes the current department and excludes inactive rows", async () => {
  const { app } = await mountReceiptApp({
    departments: [
      { id: "bar", name: "Bar" },
      { id: "restaurant", name: "Restaurant" },
      { id: "closed", name: "Closed", active: false },
    ],
  });
  await searchSettings(app, t("receipts.email"));
  expect(searchResult(app, id("email"))).toBeTruthy();
  searchResult(app, id("email"))!.click();
  await expect.poll(() => settingChooser(app)?.querySelector("wt-combobox")).toBeTruthy();
  expect(settingChooser(app)!.querySelector("wt-combobox")!.options).toEqual([
    { value: "bar", label: "Bar" },
    { value: "restaurant", label: "Restaurant" },
  ]);
  await chooseSettingRow(app, "restaurant");
  await userEvent.click(
    settingChooser(app)!.querySelector<HTMLElement>("[data-test=setting-open]")!,
  );
  await expect
    .poll(() => location.pathname)
    .toBe("/venue-operations/department/restaurant/view/receipt");
  await expect.poll(() => receiptTabEditor(app)?.subject?.id).toBe("restaurant");
});
it.each([{ permissions: ["venue.view"] }, { modules: [] }])(
  "receipt search is absent without configure permission or venue-service (%j)",
  async (options) => {
    const { app } = await mountReceiptApp({ ...options, path: "/overview" });
    await searchSettings(app, t("receipts.email"));
    expect(searchResult(app, id("email"))).toBeNull();
  },
);

it("keeps an open receipt chooser usable after returning to the browser tab", async () => {
  const { app, fetchImpl } = await mountReceiptApp({
    path: "/overview",
    departments: [
      { id: "bar", name: "Bar" },
      { id: "restaurant", name: "Restaurant" },
    ],
  });
  await searchSettings(app, t("receipts.email"));
  await userEvent.click(searchResult(app, id("email"))!);
  await expect.poll(() => settingChooser(app)?.querySelector("wt-combobox")).toBeTruthy();
  await chooseSettingRow(app, "restaurant");
  const fetch = fetchImpl.getMockImplementation()!;
  fetchImpl.mockImplementation(async (path, init) => {
    const response = await fetch(path, init);
    if (path !== "/management-api/session/me") return response;
    return new Response(
      JSON.stringify({ ...(await response.json()), venueName: "Refreshed venue" }),
      {
        headers: { "content-type": "application/json" },
      },
    );
  });
  document.dispatchEvent(new Event("visibilitychange"));
  await expect
    .poll(() => app.shadowRoot!.querySelector("[data-test=venue-name]")?.textContent)
    .toBe("Refreshed venue");
  await userEvent.click(
    settingChooser(app)!.querySelector<HTMLElement>("[data-test=setting-open]")!,
  );
  await expect
    .poll(() => location.pathname)
    .toBe("/venue-operations/department/restaurant/view/receipt");
  await expect.poll(() => receiptTabEditor(app)?.subject?.id).toBe("restaurant");
});
