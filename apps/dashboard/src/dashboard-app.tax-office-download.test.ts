import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import type { WtToast } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import "./dashboard-app.js";
import type { DashboardApp } from "./dashboard-app.js";
import type { DashboardApi, MonthDownloadDto } from "./api/client.js";
import { setLocale } from "./i18n/t.js";
import { es } from "./i18n/strings.js";
import { SUPPORTED_LOCALES } from "@waitron/shared";

const fileUrl = (id: string) => `/management-api/tax-office/month-download/${id}/file`;
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
const failed = (
  id = "b1",
  month = "2026-03",
  refusal: Extract<MonthDownloadDto, { status: "failed" }>["refusal"] = null,
): MonthDownloadDto => ({
  status: "failed",
  id,
  month,
  refusal,
});
const ranOut = {
  code: "tax_office.space_ran_out" as const,
  params: { writtenBytes: 412_000_000 },
};

const READY_EN = "The invoices for March 2026 are ready to save until 19:42.";
const READY_ES = es["tax_office.notice_ready"]
  .replace("{month}", "marzo de 2026")
  .replace("{time}", "19:42");
const FAILED_EN =
  "The invoices for March 2026 could not be prepared. Choose Download March 2026 on Invoices to try again.";
const RESTARTED_EN =
  "The box restarted before the invoices for March 2026 were ready. Choose Download March 2026 on Invoices to prepare them again.";
const MISSING_EN = "This file is no longer on the box. Choose Download again to prepare it.";
const RAN_OUT_EN =
  "The box ran short of disk space while preparing this file, so it stopped and deleted it. The file had already reached 412 MB; free more space than that on the box, for example by keeping fewer backups under Backups, then try again.";

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
  overrides: Record<string, unknown> = {},
): { api: DashboardApi; liveData: LiveData; foreground: Mock } {
  const liveData = new LiveData();
  const common = {
    getMe: vi.fn().mockResolvedValue(me(permissions, locale)),
    logout: vi.fn().mockResolvedValue(undefined),
    forgetLocales: () => {},
    getLocales: vi.fn().mockResolvedValue({
      locales: [...SUPPORTED_LOCALES],
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
    ...overrides,
  };
  const api = {
    ...common,
    liveData,
    background: { ...common, getTaxOfficeMonthDownload: background },
    getTaxOfficeMonthDownload: foreground,
    taxOfficeMonthFileUrl: fileUrl,
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
const closeButton = (el: DashboardApp) =>
  toast(el).shadowRoot!.querySelector<HTMLButtonElement>("button.close")!;
const requested = (el: DashboardApp, view: MonthDownloadDto) =>
  el.shadowRoot!.querySelector(".shell")!.dispatchEvent(
    new CustomEvent("tax-office-month-requested", {
      detail: view,
      bubbles: true,
      composed: true,
    }),
  );
const screen = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-tax-office-screen");
const screenSave = (el: DashboardApp) =>
  screen(el)?.shadowRoot?.querySelector<HTMLElement>("[data-test=save-month-file]") ?? null;
const monthLine = (el: DashboardApp) =>
  screen(el)?.shadowRoot?.querySelector<HTMLElement>("[data-test=month-file]") ?? null;
const monthButton = (el: DashboardApp) =>
  screen(el)?.shadowRoot?.querySelector<HTMLElement>("[data-test=download-month]") ?? null;
const login = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-login-screen");
const signIn = (el: DashboardApp) =>
  login(el)!.dispatchEvent(
    new CustomEvent("logged-in", {
      detail: { loginMethod: "password", rememberEmail: false },
      bubbles: true,
      composed: true,
    }),
  );

/** Mounts the shell, then turns the person's file from building to ready so the notice opens. */
async function openReadyNotice(background: Mock, overrides: Record<string, unknown> = {}) {
  const { api, liveData } = shellApi(
    background,
    ["invoice.inspect"],
    vi.fn().mockResolvedValue(ready()),
    "en-GB",
    overrides,
  );
  const mounted = await mount(api);
  await expect.poll(() => background.mock.calls.length).toBe(1);
  changed(liveData);
  await expect.poll(() => toast(mounted.el).open).toBe(true);
  await toast(mounted.el).updateComplete;
  return { ...mounted, api, liveData };
}

const initialUrl = location.href;
beforeEach(() => {
  history.replaceState(null, "", "/");
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
    await expect.poll(() => startDownload.mock.calls).toEqual([[fileUrl("b1")]]);
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
    expect(saveButton(el)!.textContent!.trim()).toBe(es["tax_office.save_file"]);
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

  it.each([
    ["open", false],
    ["closed", true],
  ])(
    "shows the next sign-in nothing of the last one's file, with its notice %s at sign-out",
    async (_case, closeFirst) => {
      const background = vi
        .fn()
        .mockResolvedValueOnce(building("b1"))
        .mockResolvedValueOnce(ready("b1"))
        .mockResolvedValue(ready("b9"));
      const { el } = await openReadyNotice(background);
      if (closeFirst) {
        closeButton(el).click();
        await expect.poll(() => toast(el).open).toBe(false);
      }
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=logout]")!.click();
      await expect.poll(() => login(el)).not.toBeNull();
      signIn(el);
      await expect.poll(() => background.mock.calls.length).toBe(3);
      await flush(el);
      expect(login(el)).toBeNull();
      expect(toast(el).open).toBe(false);
    },
  );

  it("shows a file's notice once when the screen's request answer arrives after a read saw it ready", async () => {
    const background = vi.fn().mockResolvedValueOnce(building()).mockResolvedValue(ready());
    const { el, liveData } = await openReadyNotice(background);
    closeButton(el).click();
    await expect.poll(() => toast(el).open).toBe(false);
    requested(el, building());
    changed(liveData);
    await expect.poll(() => background.mock.calls.length).toBe(3);
    await flush(el);
    expect(toast(el).open).toBe(false);
  });

  it("returns keyboard focus to where it was when the notice is closed from the keyboard", async () => {
    const background = vi.fn().mockResolvedValueOnce(building()).mockResolvedValue(ready());
    const { el } = await openReadyNotice(background);
    const accountMenu = el.shadowRoot!.querySelector<HTMLElement>("[data-test=account-menu]")!;
    accountMenu.focus();
    closeButton(el).focus();
    closeButton(el).click();
    await expect.poll(() => toast(el).open).toBe(false);
    await flush(el);
    expect(el.shadowRoot!.activeElement).toBe(accountMenu);
  });

  it.each([
    ["the download starts", ready()],
    ["the file is gone", none],
  ])(
    "returns keyboard focus to where it was when Save the file is pressed and %s",
    async (_case, current) => {
      const background = vi.fn().mockResolvedValueOnce(building()).mockResolvedValue(ready());
      const { el } = await openReadyNotice(background, {});
      (el.api.getTaxOfficeMonthDownload as Mock).mockResolvedValue(current);
      const accountMenu = el.shadowRoot!.querySelector<HTMLElement>("[data-test=account-menu]")!;
      accountMenu.focus();
      const press = saveButton(el)!.shadowRoot!.querySelector("button")!;
      press.focus();
      press.click();
      await expect.poll(() => saveButton(el)).toBeNull();
      await flush(el);
      expect(el.shadowRoot!.activeElement).toBe(accountMenu);
    },
  );

  it.each([
    ["the file is gone", none],
    ["another file is being prepared", building("b2")],
  ])("closes the ready notice when %s", async (_case, next) => {
    const background = vi
      .fn()
      .mockResolvedValueOnce(building())
      .mockResolvedValueOnce(ready())
      .mockResolvedValue(next);
    const { el, liveData } = await openReadyNotice(background);
    changed(liveData);
    await expect.poll(() => toast(el).open).toBe(false);
  });

  it("closes the ready notice once the Invoices screen saved that same file", async () => {
    const background = vi.fn().mockResolvedValueOnce(building()).mockResolvedValue(ready());
    const { el } = await openReadyNotice(background);
    const saved = (id: string) =>
      el.shadowRoot!.querySelector(".shell")!.dispatchEvent(
        new CustomEvent("tax-office-month-settled", {
          detail: { id },
          bubbles: true,
          composed: true,
        }),
      );
    saved("b0");
    await flush(el);
    expect(toast(el).open).toBe(true);
    saved("b1");
    await expect.poll(() => toast(el).open).toBe(false);
  });

  it("takes the Invoices screen's ready line away once the notice's Save the file saved it", async () => {
    history.replaceState(null, "", "/invoices");
    const background = vi.fn().mockResolvedValueOnce(building()).mockResolvedValue(ready());
    const { el } = await openReadyNotice(background);
    await expect.poll(() => screenSave(el)).not.toBeNull();
    saveButton(el)!.click();
    await expect.poll(() => monthLine(el)).toBeNull();
  });

  it("says how far the file had got when the server ran short of space, and offers an administrator's sign-in to a session that cannot open Backups", async () => {
    const background = vi
      .fn()
      .mockResolvedValueOnce(building())
      .mockResolvedValue(failed("b1", "2026-03", ranOut));
    const { api, liveData } = shellApi(background);
    const { el } = await mount(api);
    await expect.poll(() => background.mock.calls.length).toBe(1);
    changed(liveData);
    await expect.poll(() => toast(el).open).toBe(true);
    expect(toast(el).message).toBe(RAN_OUT_EN);
    expect(toast(el).tone).toBe("error");
    expect(toast(el).querySelector("[data-test=tax-office-go-to-backups]")).toBeNull();
    const signInButton = toast(el).querySelector<HTMLElement>(
      "[data-test=tax-office-admin-sign-in]",
    )!;
    expect(signInButton.textContent!.trim()).toBe("Sign in as an administrator");
    signInButton.click();
    await expect.poll(() => login(el)).not.toBeNull();
    expect(api.logout).toHaveBeenCalledOnce();
    expect(location.pathname).toBe("/backup");
  });

  it("offers Backups itself on the low-disk notice to a session that can open it", async () => {
    const background = vi
      .fn()
      .mockResolvedValueOnce(building())
      .mockResolvedValue(failed("b1", "2026-03", ranOut));
    const { api, liveData } = shellApi(
      background,
      ["venue.view", "invoice.inspect", "system.manage"],
      undefined,
      "en-GB",
      {
        getBackupStatus: vi.fn().mockResolvedValue({
          enabled: false,
          isPrimary: true,
          loadErrorCode: null,
          destinations: [],
          backupStatus: { configured: false },
          archiveUnderCurrentKey: false,
          recoveryKeySet: true,
          recoveryKeyTooShort: false,
        }),
        getStreamSettings: vi.fn().mockResolvedValue({
          isPrimary: true,
          configured: false,
          bucket: null,
          status: { state: "off" },
          recoveryKeySet: true,
          keyFingerprint: null,
        }),
      },
    );
    const { el } = await mount(api);
    await expect.poll(() => background.mock.calls.length).toBe(1);
    changed(liveData);
    await expect.poll(() => toast(el).open).toBe(true);
    expect(toast(el).querySelector("[data-test=tax-office-admin-sign-in]")).toBeNull();
    const goTo = toast(el).querySelector<HTMLElement>("[data-test=tax-office-go-to-backups]")!;
    expect(goTo.textContent!.trim()).toBe("Go to Backups");
    goTo.click();
    await expect.poll(() => location.pathname).toBe("/backup");
    expect(api.logout).not.toHaveBeenCalled();
    expect(toast(el).open).toBe(false);
  });

  it("keeps Save on the Invoices screen when the file turns ready before the request's own answer arrives", async () => {
    history.replaceState(null, "", "/invoices/from/2026-03-01/to/2026-03-31");
    let answer!: (view: MonthDownloadDto) => void;
    const requestTaxOfficeMonth = vi.fn(
      () => new Promise<MonthDownloadDto>((resolve) => (answer = resolve)),
    );
    const background = vi.fn().mockResolvedValueOnce(none).mockResolvedValue(ready());
    const { api, liveData } = shellApi(background, ["invoice.inspect"], undefined, "en-GB", {
      requestTaxOfficeMonth,
    });
    const { el } = await mount(api);
    await expect.poll(() => background.mock.calls.length).toBe(1);
    await expect.poll(() => monthButton(el)).not.toBeNull();
    monthButton(el)!.click();
    await expect.poll(() => requestTaxOfficeMonth.mock.calls.length).toBe(1);
    changed(liveData);
    await expect.poll(() => screenSave(el)).not.toBeNull();
    answer(building());
    await flush(el);
    await screen(el)!.updateComplete;
    expect(screenSave(el)).not.toBeNull();
    expect(toast(el).message).toBe(READY_EN);
  });

  it("reads the month file once for the notice and the Invoices screen, and the screen shows what it read", async () => {
    history.replaceState(null, "", "/invoices");
    const background = vi.fn().mockResolvedValue(building());
    const { api, foreground } = shellApi(background);
    const { el } = await mount(api);
    await expect
      .poll(() => monthLine(el)?.textContent?.trim())
      .toBe(
        "Preparing the invoices for March 2026. You can leave this page: a notice appears when they are ready.",
      );
    await flush(el);
    expect(background).toHaveBeenCalledOnce();
    expect(foreground).not.toHaveBeenCalled();
  });

  it("reads a session's month file only at the slow pace while nothing of theirs is being prepared", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const background = vi.fn().mockResolvedValue(ready());
    const { api } = shellApi(background);
    const { el } = await mount(api);
    await expect.poll(() => background.mock.calls.length).toBe(1);
    vi.advanceTimersByTime(59_999);
    await flush(el);
    expect(background).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    await expect.poll(() => background.mock.calls.length).toBe(2);
  });

  it("stops the quick reads once the file being prepared is ready", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const background = vi.fn().mockResolvedValueOnce(building()).mockResolvedValue(ready());
    const { api } = shellApi(background);
    const { el } = await mount(api);
    await expect.poll(() => background.mock.calls.length).toBe(1);
    vi.advanceTimersByTime(10_000);
    await expect.poll(() => toast(el).open).toBe(true);
    vi.advanceTimersByTime(40_000);
    await flush(el);
    expect(background).toHaveBeenCalledTimes(2);
  });

  it("leaves a building file to the live stream while it is connected", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const background = vi.fn().mockResolvedValue(building());
    const { api, liveData } = shellApi(background);
    liveData.setConnected(true);
    const { el } = await mount(api);
    await expect.poll(() => background.mock.calls.length).toBe(1);
    vi.advanceTimersByTime(30_000);
    await flush(el);
    expect(background).toHaveBeenCalledOnce();
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

describe("where the shell draws the notice", () => {
  const alert = {
    key: "incident:1",
    kind: "event",
    code: "payment.refund_unresolved",
    params: { amount: "12.50", paymentRef: "pi_1" },
    severity: "warning",
    since: "2026-09-14T12:00:00.000Z",
    area: "payments",
  };
  const alertToast = (el: DashboardApp) =>
    el.shadowRoot!.querySelector<WtToast>("[data-test=alert-toast]")!;
  const boxOf = (notice: WtToast) =>
    notice.shadowRoot!.querySelector(".toast")!.getBoundingClientRect();
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  afterEach(async () => {
    await page.viewport(viewport.width, viewport.height);
  });

  it.each([1280, 390])(
    "stacks the notice under the alerts pop-up at %i px, over the page rather than pushing it down",
    async (width) => {
      await page.viewport(width, 844);
      history.replaceState(null, "", "/invoices");
      const listAlerts = vi
        .fn()
        .mockResolvedValueOnce({ visible: true, alerts: [] })
        .mockResolvedValue({ visible: true, alerts: [alert] });
      const background = vi.fn().mockResolvedValueOnce(building()).mockResolvedValue(ready());
      const { api, liveData } = shellApi(
        background,
        ["venue.view", "invoice.inspect"],
        undefined,
        "en-GB",
        { listAlerts },
      );
      const { el } = await mount(api);
      await expect.poll(() => background.mock.calls.length).toBe(1);
      await expect.poll(() => listAlerts.mock.calls.length).toBe(1);
      await flush(el);
      const layout = el.shadowRoot!.querySelector<HTMLElement>(".layout")!;
      const layoutTop = layout.getBoundingClientRect().top;
      liveData.invalidate([{ type: "incidents", id: "new" }]);
      changed(liveData);
      await expect.poll(() => alertToast(el).open && toast(el).open).toBe(true);
      await alertToast(el).updateComplete;
      await toast(el).updateComplete;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(layout.getBoundingClientRect().top).toBe(layoutTop);
      const first = boxOf(alertToast(el));
      const second = boxOf(toast(el));
      expect(second.top).toBeGreaterThanOrEqual(first.bottom);
      for (const [notice, box] of [
        [alertToast(el), first],
        [toast(el), second],
      ] as const) {
        const hit = el.shadowRoot!.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        expect(hit?.closest("wt-toast")).toBe(notice);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(window.innerWidth);
      }
      // The stack's empty parts, between the two and beside the narrower one, leave the page pressable.
      const empty: [number, number][] = [
        [second.left + second.width / 2, (first.bottom + second.top) / 2],
      ];
      if (second.left - first.left > 8)
        empty.push([(first.left + second.left) / 2, second.top + second.height / 2]);
      if (width === 1280) expect(empty).toHaveLength(2);
      for (const [x, y] of empty) {
        const hit = el.shadowRoot!.elementFromPoint(x, y);
        expect(hit).not.toBeNull();
        expect(hit!.closest(".toast-stack")).toBeNull();
      }

      const menu = el.shadowRoot!.querySelector("[data-test=account-menu]")!;
      await userEvent.click(menu.shadowRoot!.querySelector("button")!);
      await expect.poll(() => alertToast(el).shadowRoot!.querySelector(".toast")).toBeNull();
      expect(alertToast(el)).toMatchObject({ open: true, held: true });
      const stack = toast(el).parentElement!.getBoundingClientRect();
      expect(boxOf(toast(el)).top).toBeCloseTo(stack.top);
    },
  );
});
