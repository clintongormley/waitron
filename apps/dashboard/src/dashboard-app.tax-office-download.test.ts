import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import type { WtToast } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import "./dashboard-app.js";
import type { DashboardApp } from "./dashboard-app.js";
import type { DashboardApi, MonthDownloadDto } from "./api/client.js";
import { setLocale } from "./i18n/t.js";

const FILE_URL = "/management-api/tax-office/month-download/file";
// Built from local clock parts: the toast shows the browser's local time.
const EXPIRES_AT = new Date(2026, 10, 16, 19, 42).toISOString();

const none: MonthDownloadDto = { status: "none" };
const building = (id = "b1", month = "2026-03"): MonthDownloadDto => ({
  status: "building",
  id,
  month,
});
const ready = (id = "b1", month = "2026-03"): MonthDownloadDto => ({
  status: "ready",
  id,
  month,
  bytes: 1024,
  expiresAt: EXPIRES_AT,
});
const failed = (id = "b1", month = "2026-03"): MonthDownloadDto => ({
  status: "failed",
  id,
  month,
});

const READY_EN = "The invoices for March 2026 are ready to save until 19:42.";
const READY_ES = "Las facturas de marzo de 2026 se pueden guardar hasta las 19:42.";
const FAILED_EN =
  "The invoices for March 2026 could not be prepared. Choose Download March 2026 on Invoices to try again.";
const RESTARTED_EN =
  "The server restarted before the invoices for March 2026 were ready. Choose Download March 2026 on Invoices to prepare them again.";
const MISSING_EN = "This file is no longer on the server. Choose Download again to prepare it.";

function me(permissions: string[], locale: string) {
  return {
    personId: "p1",
    roleIds: ["inspector"],
    email: "inspector@example.com",
    locale,
    venueLocale: "es-ES",
    sessionDefault: "es-ES",
    venueName: "Deli Test SL",
    onboardingIntent: "prepare",
    permissions,
    modules: [],
  };
}

/** The shell, signed in as `permissions`, with live data and a background client whose
 * `getTaxOfficeMonthDownload` is its own spy, so a case can tell a passive read from a foreground one. */
function shellApi(
  background: Mock,
  permissions = ["invoice.inspect"],
  foreground: Mock = vi.fn().mockResolvedValue(none),
  locale = "en-GB",
): { api: DashboardApi; liveData: LiveData; foreground: Mock } {
  const liveData = new LiveData();
  const common = {
    getMe: vi.fn().mockResolvedValue(me(permissions, locale)),
    forgetLocales: () => {},
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
      loginDefault: "es-ES",
      venueName: "Deli Test SL",
      onboardingIntent: "prepare",
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
    getVenueTheme: vi.fn().mockResolvedValue({ hash: "waitron", css: "", logo: null }),
    getLegalAbout: vi.fn().mockResolvedValue({ release: null, build: "test" }),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    listTaxOfficeInvoices: vi
      .fn()
      .mockResolvedValue({ rows: [], next: null, timeZone: "Europe/Madrid" }),
    listMyShifts: vi.fn().mockResolvedValue([]),
    listMySwaps: vi.fn().mockResolvedValue([]),
    listMyAbsences: vi.fn().mockResolvedValue([]),
    getStaffRoster: vi.fn().mockResolvedValue([]),
    listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
    getDiskStop: vi.fn().mockResolvedValue({ stopped: false, deleted: null }),
  };
  const api = {
    ...common,
    liveData,
    background: { ...common, getTaxOfficeMonthDownload: background },
    getTaxOfficeMonthDownload: foreground,
    taxOfficeMonthFileUrl: () => FILE_URL,
  } as unknown as DashboardApi;
  return { api, liveData, foreground };
}

async function mount(api: DashboardApi) {
  const startDownload = vi.fn();
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, startDownload });
  return { el, startDownload };
}

async function flush(el: DashboardApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const toast = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<WtToast>("wt-toast[data-test=tax-office-toast]")!;
const saveButton = (el: DashboardApp) =>
  toast(el).querySelector<HTMLElement>("[data-test=tax-office-save]");
const changed = (liveData: LiveData) =>
  liveData.invalidate([{ type: "tax_office_download", id: "x" }]);

const initialUrl = location.href;
beforeEach(() => {
  history.replaceState(null, "", "/manage");
  setLocale("en-GB");
});
afterEach(() => {
  cleanupWidgets();
  history.replaceState(null, "", initialUrl);
  sessionStorage.clear();
  localStorage.clear();
  setLocale("es-ES");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the shell's notice for the tax office's month file", () => {
  it("tells the person when the file is ready, and Save the file starts the browser's download", async () => {
    const background = vi.fn().mockResolvedValueOnce(building()).mockResolvedValue(ready());
    const { api, liveData } = shellApi(
      background,
      ["invoice.inspect"],
      vi.fn().mockResolvedValue(ready()),
    );
    const { el, startDownload } = await mount(api);
    await expect.poll(() => background.mock.calls.length).toBe(1);
    changed(liveData);
    await expect.poll(() => toast(el).open).toBe(true);
    expect(toast(el).message).toBe(READY_EN);
    expect(toast(el).tone).toBe("info");
    expect(toast(el).duration).toBe(0);
    expect(saveButton(el)!.textContent!.trim()).toBe("Save the file");
    saveButton(el)!.click();
    await expect.poll(() => startDownload.mock.calls).toEqual([[FILE_URL]]);
    await expect.poll(() => toast(el).open).toBe(false);
  });

  it("words the ready notice in Spanish", async () => {
    const background = vi.fn().mockResolvedValueOnce(building()).mockResolvedValue(ready());
    const { api, liveData } = shellApi(background, ["invoice.inspect"], undefined, "es-ES");
    const { el } = await mount(api);
    await expect.poll(() => background.mock.calls.length).toBe(1);
    changed(liveData);
    await expect.poll(() => toast(el).open).toBe(true);
    expect(toast(el).message).toBe(READY_ES);
    expect(saveButton(el)!.textContent!.trim()).toBe("Guardar el archivo");
  });

  it("shows no notice when the sign-in's first read already finds the file ready", async () => {
    const background = vi.fn().mockResolvedValue(ready());
    const { api, liveData } = shellApi(background);
    const { el } = await mount(api);
    await expect.poll(() => background.mock.calls.length).toBe(1);
    changed(liveData);
    await expect.poll(() => background.mock.calls.length).toBe(2);
    await flush(el);
    expect(toast(el).open).toBe(false);
  });

  it("an inspector whose live stream is refused gets the notice by polling, for a month asked for before any read answered", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    // Without the screen's request, the first answered read would be taken as old news.
    const background = vi
      .fn()
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockResolvedValue(ready("b7"));
    const liveUpdates = { start: vi.fn(), stop: vi.fn() };
    const { api } = shellApi(background);
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, liveUpdates });
    await expect.poll(() => background.mock.calls.length).toBe(1);
    expect(liveUpdates.start).not.toHaveBeenCalled();
    el.shadowRoot!.querySelector(".shell")!.dispatchEvent(
      new CustomEvent("tax-office-month-requested", {
        detail: building("b7"),
        bubbles: true,
        composed: true,
      }),
    );
    vi.advanceTimersByTime(10_000);
    await expect.poll(() => background.mock.calls.length).toBe(2);
    await expect.poll(() => toast(el).open).toBe(true);
    expect(toast(el).message).toBe(READY_EN);
  });

  it("polls a confined session every 10 seconds, and shows the notice once building turns ready", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const background = vi.fn().mockResolvedValueOnce(building()).mockResolvedValue(ready());
    const { api } = shellApi(background);
    const { el } = await mount(api);
    await expect.poll(() => background.mock.calls.length).toBe(1);
    vi.advanceTimersByTime(9_999);
    await flush(el);
    expect(background).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    await expect.poll(() => toast(el).open).toBe(true);
    expect(toast(el).message).toBe(READY_EN);
  });

  it("shows the notice again for a second file of the same month", async () => {
    const background = vi
      .fn()
      .mockResolvedValueOnce(building("b1"))
      .mockResolvedValueOnce(ready("b1"))
      .mockResolvedValue(ready("b2"));
    const { api, liveData } = shellApi(background);
    const { el } = await mount(api);
    await expect.poll(() => background.mock.calls.length).toBe(1);
    changed(liveData);
    await expect.poll(() => toast(el).open).toBe(true);
    toast(el).shadowRoot!.querySelector<HTMLButtonElement>("button.close")!.click();
    await expect.poll(() => toast(el).open).toBe(false);
    changed(liveData);
    await expect.poll(() => toast(el).open).toBe(true);
    expect(toast(el).message).toBe(READY_EN);
  });

  it("does not show the same file's notice twice", async () => {
    const background = vi.fn().mockResolvedValueOnce(building()).mockResolvedValue(ready());
    const { api, liveData } = shellApi(background);
    const { el } = await mount(api);
    await expect.poll(() => background.mock.calls.length).toBe(1);
    changed(liveData);
    await expect.poll(() => toast(el).open).toBe(true);
    toast(el).shadowRoot!.querySelector<HTMLButtonElement>("button.close")!.click();
    await expect.poll(() => toast(el).open).toBe(false);
    changed(liveData);
    await expect.poll(() => background.mock.calls.length).toBe(3);
    await flush(el);
    expect(toast(el).open).toBe(false);
  });

  it("tells the person when the file could not be prepared", async () => {
    const background = vi.fn().mockResolvedValueOnce(building()).mockResolvedValue(failed());
    const { api, liveData } = shellApi(background);
    const { el } = await mount(api);
    await expect.poll(() => background.mock.calls.length).toBe(1);
    changed(liveData);
    await expect.poll(() => toast(el).open).toBe(true);
    expect(toast(el).message).toBe(FAILED_EN);
    expect(toast(el).tone).toBe("error");
    expect(toast(el).duration).toBe(0);
    expect(saveButton(el)).toBeNull();
  });

  it("tells the person the server restarted when a build gives way to nothing, past a refused read", async () => {
    const background = vi
      .fn()
      .mockResolvedValueOnce(building())
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockResolvedValue(none);
    const { api, liveData } = shellApi(background);
    const { el } = await mount(api);
    await expect.poll(() => background.mock.calls.length).toBe(1);
    changed(liveData);
    await expect.poll(() => background.mock.calls.length).toBe(2);
    await flush(el);
    expect(toast(el).open).toBe(false);
    changed(liveData);
    await expect.poll(() => toast(el).open).toBe(true);
    expect(toast(el).message).toBe(RESTARTED_EN);
    expect(toast(el).tone).toBe("error");
  });

  it("shows the missing-file words, and starts no download, when the file is gone by Save the file", async () => {
    const background = vi.fn().mockResolvedValueOnce(building()).mockResolvedValue(ready());
    const foreground = vi.fn().mockResolvedValue(none);
    const { api, liveData } = shellApi(background, ["invoice.inspect"], foreground);
    const { el, startDownload } = await mount(api);
    await expect.poll(() => background.mock.calls.length).toBe(1);
    changed(liveData);
    await expect.poll(() => saveButton(el)).not.toBeNull();
    saveButton(el)!.click();
    await expect.poll(() => toast(el).message).toBe(MISSING_EN);
    expect(foreground).toHaveBeenCalledOnce();
    expect(toast(el).open).toBe(true);
    expect(toast(el).tone).toBe("error");
    expect(saveButton(el)).toBeNull();
    expect(startDownload).not.toHaveBeenCalled();
  });

  it("sends every read through the background client, the first included", async () => {
    const background = vi.fn().mockResolvedValue(none);
    const { api, liveData, foreground } = shellApi(background);
    await mount(api);
    await expect.poll(() => background.mock.calls.length).toBe(1);
    changed(liveData);
    await expect.poll(() => background.mock.calls.length).toBe(2);
    expect(foreground).not.toHaveBeenCalled();
  });

  it("never reads the file's state for a session without invoice.inspect", async () => {
    const background = vi.fn().mockResolvedValue(ready());
    const { api, foreground } = shellApi(background, []);
    const { el } = await mount(api);
    await expect.poll(() => (api.getDiskStop as Mock).mock.calls.length).toBe(1);
    await flush(el);
    expect(background).not.toHaveBeenCalled();
    expect(foreground).not.toHaveBeenCalled();
  });
});
