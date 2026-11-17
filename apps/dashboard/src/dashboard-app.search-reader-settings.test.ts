import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale, t } from "./i18n/t.js";
import { cleanupWidgets, dialogClosed } from "./widgets/test-helpers.js";
import { reader, mountReaderApp, readyReaderEditor } from "./testing/reader-settings-fixture.js";
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
it.each(["en-GB", "es-ES"])("%s settings land without writes", async (locale) => {
  const { app, fetchImpl } = await mountReaderApp({ locale });
  const start = fetchImpl.mock.calls.length;
  await searchSettings(app, t("payments.prints_own_slip_automatically"));
  const result = searchResult(app, "dashboard:reader:prints-own-slip-automatically");
  expect(result).toBeTruthy();
  await userEvent.click(result!);
  const editor = await readyReaderEditor(app);
  expect(editor.querySelector("[name=reader-name]")).toHaveProperty("value", "Counter");
  expect(location.pathname).toBe("/payments/reader/r1");
  const closed = dialogClosed(editor);
  await userEvent.click(editor.querySelector<HTMLElement>("[data-test=close-reader-editor]")!);
  await closed;
  expect(fetchImpl.mock.calls.slice(start).filter(([, init]) => init.method !== "GET")).toEqual([]);
});
it("chooser selects the reader and Cancel stays put", async () => {
  const { app, fetchImpl } = await mountReaderApp({
    readers: [reader, { ...reader, id: "r2", name: "Bar", active: false }],
  });
  const start = fetchImpl.mock.calls.length;
  await searchSettings(app, t("payments.reader_col_name"));
  await userEvent.click(searchResult(app, "dashboard:reader:reader-name")!);
  await expect
    .poll(() => settingChooser(app)?.querySelector("wt-combobox")?.options)
    .toEqual([
      { value: "r1", label: "Counter" },
      { value: "r2", label: "Bar" },
    ]);
  const push = vi.spyOn(history, "pushState");
  await cancelSettingSearch(app);
  expect(push).not.toHaveBeenCalled();
  expect(location.pathname).toBe("/payments");
  await userEvent.click(searchResult(app, "dashboard:reader:reader-name")!);
  await chooseSettingRow(app, "r2");
  await userEvent.click(
    settingChooser(app)!.querySelector<HTMLElement>("[data-test=setting-open]")!,
  );
  const editor = await readyReaderEditor(app);
  expect(editor.querySelector("[name=reader-name]")).toHaveProperty("value", "Bar");
  expect(location.pathname).toBe("/payments/reader/r2");
  expect(fetchImpl.mock.calls.slice(start).filter(([, init]) => init.method !== "GET")).toEqual([]);
});
it("hardware permission gates reader settings", async () => {
  const { app } = await mountReaderApp({ permissions: ["venue.view"], path: "/overview" });
  await searchSettings(app, t("payments.reader_col_name"));
  expect(searchResult(app, "dashboard:reader:reader-name")).toBeNull();
  await searchSettings(app, t("payments.prints_own_slip_automatically"));
  expect(searchResult(app, "dashboard:reader:prints-own-slip-automatically")).toBeNull();
});
