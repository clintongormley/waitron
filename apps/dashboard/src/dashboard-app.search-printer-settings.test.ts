import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale, t } from "./i18n/t.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import {
  mountPrinterApp,
  officePrinter,
  printerScreen,
} from "./testing/printer-settings-fixture.js";
import {
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
it.each([
  ["en-GB", "printers.paper_width", "paper-width", "printer-ruler-number", 1],
  ["es-ES", "printers.resolution", "resolution", "printer-qr-square", 1],
  ["en-GB", "printers.portable", "printer-portable", "printer-portable", 3],
] as const)(
  "%s/%s opens its actual calibration control without hardware actions",
  async (locale, label, id, name, step) => {
    const { app, fetchImpl } = await mountPrinterApp({ locale });
    const start = fetchImpl.mock.calls.length;
    await searchSettings(app, t(label));
    expect(searchResult(app, `dashboard:printer:${id}`)).toBeTruthy();
    await userEvent.click(searchResult(app, `dashboard:printer:${id}`)!);
    const screen = printerScreen(app);
    await expect
      .poll(() =>
        screen
          .shadowRoot!.querySelector(`[data-test=calibration-step-${step}]`)
          ?.hasAttribute("hidden"),
      )
      .toBe(false);
    expect(screen.shadowRoot!.querySelector(`[name=${name}]`)).toBeTruthy();
    expect(location.pathname).toBe(
      `/printers/view/printers/printer/p1/editor/calibrate/step/${step}`,
    );
    expect(fetchImpl.mock.calls.slice(start).filter(([, init]) => init.method !== "GET")).toEqual(
      [],
    );
  },
);
it("Name chooser includes receipt and A4 rows and opens A4 Edit", async () => {
  const { app } = await mountPrinterApp({ pagePrinters: [officePrinter] });
  await searchSettings(app, t("printers.name"));
  await userEvent.click(searchResult(app, "dashboard:printer:printer-detail-name")!);
  await expect
    .poll(() => settingChooser(app)?.querySelector("wt-combobox")?.options)
    .toEqual([
      { value: "p1", label: "Kitchen" },
      { value: "pp1", label: "Office" },
    ]);
  await chooseSettingRow(app, "pp1");
  await userEvent.click(
    settingChooser(app)!.querySelector<HTMLElement>("[data-test=setting-open]")!,
  );
  await expect
    .poll(() => printerScreen(app).shadowRoot!.querySelector("[name=printer-detail-name]"))
    .toBeTruthy();
  expect(printerScreen(app).shadowRoot!.querySelector("[name=printer-detail-host]")).toBeNull();
  expect(location.pathname).toBe("/printers/view/printers/printer/pp1/editor/edit");
});
it("permission hides printer settings", async () => {
  const { app } = await mountPrinterApp({ permissions: ["venue.view"], path: "/overview" });
  await searchSettings(app, t("printers.portable"));
  expect(searchResult(app, "dashboard:printer:printer-portable")).toBeNull();
});
