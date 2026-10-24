import type { DownloadedFile } from "@waitron/dashboard-kit";
import { setHelpMode, type WtButton } from "@waitron/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi } from "../api/client.js";
import type { ProfileScreen } from "./profile-screen.js";
import "./profile-screen.js";

const FILE: DownloadedFile = { blob: new Blob(["zip"]), fileName: "marta-lopez-2026-10-05.zip" };

function stubApi(download?: () => Promise<DownloadedFile>): DashboardApi {
  return {
    getProfile: vi.fn().mockResolvedValue({
      displayName: "Alex",
      firstNames: "Alex",
      lastNames: "Rivera",
      telephone: "+34 600 000 000",
      email: "alex@example.com",
      locale: "en-GB",
      hasPassword: true,
      hasTotp: false,
      hasGoogle: false,
      pendingEmail: null,
      passkeys: [],
    }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [{ code: "en-GB", label: "English" }],
      venueDefault: "en-GB",
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
    downloadOwnPersonalData: vi.fn(download ?? (() => Promise.resolve(FILE))),
  } as unknown as DashboardApi;
}

function held(): {
  promise: Promise<DownloadedFile>;
  resolve: (file: DownloadedFile) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (file: DownloadedFile) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<DownloadedFile>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function mount(api: DashboardApi, theme?: "light" | "dark") {
  const mounted = await mountWidget<ProfileScreen>("dashboard-profile-screen", { api }, theme);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await mounted.el.updateComplete;
  return mounted;
}

const button = (el: ProfileScreen) =>
  el.shadowRoot!.querySelector<WtButton>("[data-test=download-data-copy]")!;
const errorLine = (el: ProfileScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=download-data-copy-error]");
const row = (el: ProfileScreen) => button(el).closest(".action-row")!;

async function settle(el: ProfileScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await button(el).updateComplete;
}

function spyOnSaving() {
  const blobs: Blob[] = [];
  const create = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return "blob:personal-data";
  });
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const links: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    links.push(this);
  });
  return { blobs, create, revoke, links };
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanupWidgets();
});

describe("profile-screen copy of your data", () => {
  it("shows the row on the details tab with a Download button", async () => {
    const { el } = await mount(stubApi());
    const details = el.shadowRoot!.querySelector("[slot=details]")!;
    const download = button(el);
    expect(details.contains(download)).toBe(true);
    expect(row(el).querySelector(".text .field-value")!.textContent!.trim()).toBe(
      t("profile.data_copy"),
    );
    expect(row(el).querySelector(".text .field-meta")!.textContent!.trim()).toBe(
      t("profile.data_copy_hint"),
    );
    expect(download.textContent!.trim()).toBe(t("action.download"));
    expect(download.getAttribute("aria-label")).toBe(t("profile.data_copy_download"));
    expect(download.disabled).toBe(false);
    expect(download.loading).toBe(false);
    expect(errorLine(el)).toBeNull();
  });

  it("saves the file the server sent under the server's name", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    const saving = spyOnSaving();
    button(el).click();
    await settle(el);
    expect(api.downloadOwnPersonalData).toHaveBeenCalledExactlyOnceWith();
    expect(saving.blobs).toHaveLength(1);
    expect(saving.blobs[0]).toBe(FILE.blob);
    expect(saving.links.map((link) => [link.getAttribute("href"), link.download])).toEqual([
      ["blob:personal-data", "marta-lopez-2026-10-05.zip"],
    ]);
    expect(saving.revoke).toHaveBeenCalledExactlyOnceWith("blob:personal-data");
  });

  it("names the file personal-data.zip when the server sent no name", async () => {
    const api = stubApi(() => Promise.resolve({ blob: FILE.blob, fileName: null }));
    const { el } = await mount(api);
    const saving = spyOnSaving();
    button(el).click();
    await settle(el);
    expect(saving.links.map((link) => link.download)).toEqual(["personal-data.zip"]);
  });

  it("refuses a second press while the request is sent", async () => {
    const request = held();
    const api = stubApi(() => request.promise);
    const { el, host } = await mount(api);
    const saving = spyOnSaving();
    button(el).click();
    await settle(el);
    expect(button(el).loading).toBe(true);
    expect(button(el).textContent!.trim()).toBe(t("profile.data_copy_busy"));
    expect(button(el).getAttribute("aria-label")).toBe(t("profile.data_copy_busy"));
    await expectNoA11yViolations(host);
    button(el).click();
    await settle(el);
    expect(api.downloadOwnPersonalData).toHaveBeenCalledTimes(1);
    request.resolve(FILE);
    await settle(el);
    expect(button(el).loading).toBe(false);
    expect(button(el).textContent!.trim()).toBe(t("action.download"));
    expect(button(el).getAttribute("aria-label")).toBe(t("profile.data_copy_download"));
    expect(saving.links).toHaveLength(1);
  });

  it("shows a refusal under the row, and never at the foot of an edit dialog", async () => {
    const refused = held();
    const api = stubApi(() => refused.promise);
    const { el } = await mount(api);
    const saving = spyOnSaving();
    button(el).click();
    await settle(el);
    el.editDetails();
    await el.updateComplete;
    refused.reject({ code: "connection.failed" });
    await settle(el);
    const line = errorLine(el)!;
    expect(line.textContent!.trim()).toBe(codeMessage("connection.failed"));
    expect(line.getAttribute("role")).toBe("alert");
    expect(button(el).disabled).toBe(false);
    expect(button(el).loading).toBe(false);
    const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
    expect((actions as HTMLElement & { error: string }).error).toBe("");
    expect((await formMessageOf(actions))?.textContent?.trim() ?? "").toBe("");

    const request = held();
    vi.mocked(api.downloadOwnPersonalData).mockReturnValue(request.promise);
    button(el).click();
    await settle(el);
    expect(errorLine(el)).toBeNull();
    request.resolve(FILE);
    await settle(el);
    expect(errorLine(el)).toBeNull();
    expect(saving.links).toHaveLength(1);
  });

  it("drops the file when the screen was removed while it was sent", async () => {
    const request = held();
    const { el } = await mount(stubApi(() => request.promise));
    const saving = spyOnSaving();
    button(el).click();
    await settle(el);
    el.remove();
    request.resolve(FILE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saving.create).not.toHaveBeenCalled();
    expect(saving.links).toHaveLength(0);
  });

  it("drops a refusal when the screen was removed while it was sent", async () => {
    const request = held();
    const { el, host } = await mount(stubApi(() => request.promise));
    button(el).click();
    await settle(el);
    el.remove();
    request.reject({ code: "connection.failed" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    host.append(el);
    await settle(el);
    expect(errorLine(el)).toBeNull();
    expect(button(el).loading).toBe(false);
  });

  it("speaks Spanish", async () => {
    const previous = currentLocale();
    setLocale("es-ES");
    try {
      const request = held();
      const { el } = await mount(stubApi(() => request.promise));
      expect(row(el).querySelector(".text .field-value")!.textContent!.trim()).toBe(
        t("profile.data_copy"),
      );
      expect(row(el).querySelector(".text .field-meta")!.textContent!.trim()).toBe(
        t("profile.data_copy_hint"),
      );
      expect(button(el).textContent!.trim()).toBe(t("action.download"));
      expect(button(el).getAttribute("aria-label")).toBe(t("profile.data_copy_download"));
      button(el).click();
      await settle(el);
      expect(button(el).textContent!.trim()).toBe(t("profile.data_copy_busy"));
      spyOnSaving();
      request.resolve(FILE);
      await settle(el);
    } finally {
      setLocale(previous);
    }
  });
});

describe.each(["light", "dark"] as const)("profile-screen copy of your data a11y (%s)", (theme) => {
  it("is accessible at rest", async () => {
    const { host } = await mount(stubApi(), theme);
    await expectNoA11yViolations(host);
  });

  it("is accessible while sent", async () => {
    const request = held();
    const { el, host } = await mount(
      stubApi(() => request.promise),
      theme,
    );
    button(el).click();
    await settle(el);
    expect(button(el).loading).toBe(true);
    await expectNoA11yViolations(host);
    spyOnSaving();
    request.resolve(FILE);
    await settle(el);
  });

  it("is accessible with the error line shown", async () => {
    const { el, host } = await mount(
      stubApi(() => Promise.reject({ code: "connection.failed" })),
      theme,
    );
    button(el).click();
    await settle(el);
    expect(errorLine(el)).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});

const tooltip = (el: ProfileScreen) => row(el).querySelector<HTMLElement>(".text wt-help-tooltip");

describe("profile-screen copy of your data help", () => {
  it("carries one help-mode tooltip that links the guide's section", async () => {
    const previous = currentLocale();
    setLocale("en");
    try {
      const { el } = await mount(stubApi());
      expect(row(el).querySelectorAll("wt-help-tooltip")).toHaveLength(1);
      const help = tooltip(el)!;
      expect(help.getAttribute("mode")).toBe("help-mode");
      expect(help.getAttribute("guide-href")).toBe("/help/en/staff#own-data");
      expect(help.getAttribute("aria-label")).toBe(t("profile.data_copy_help_label"));
      expect(help.getAttribute("guide-label")).toBe(t("profile.data_copy_help_guide"));
      expect(help.textContent!.trim()).toBe(t("profile.data_copy_help"));
    } finally {
      setLocale(previous);
    }
  });

  it("links the Spanish guide in Spanish", async () => {
    const previous = currentLocale();
    setLocale("es-ES");
    try {
      const { el } = await mount(stubApi());
      const help = tooltip(el)!;
      expect(help.getAttribute("guide-href")).toBe("/help/es/staff#own-data");
      expect(help.getAttribute("aria-label")).toBe(t("profile.data_copy_help_label"));
      expect(help.getAttribute("guide-label")).toBe(t("profile.data_copy_help_guide"));
      expect(help.textContent!.trim()).toBe(t("profile.data_copy_help"));
    } finally {
      setLocale(previous);
    }
  });
});

describe("profile-screen copy of your data help placement", () => {
  it("hangs the help badge over the label's top trailing corner, inside its row", async () => {
    setHelpMode(true);
    try {
      const { el } = await mount(stubApi());
      await document.fonts.ready;
      const help = tooltip(el)!;
      const badge = help.getBoundingClientRect();
      const label = row(el).querySelector(".text .field-value")!.getBoundingClientRect();
      const box = row(el).getBoundingClientRect();
      const download = button(el).getBoundingClientRect();
      expect(badge.width).toBeGreaterThan(0);
      expect(badge.bottom).toBeGreaterThan(box.top);
      expect(badge.top).toBeLessThan(box.bottom);
      const [x, y] = [badge.left + badge.width / 2, badge.top + badge.height / 2];
      expect(Math.abs(x - label.right)).toBeLessThanOrEqual(1);
      expect(Math.abs(y - label.top)).toBeLessThanOrEqual(1);
      expect(badge.right).toBeLessThanOrEqual(download.left);
    } finally {
      setHelpMode(false);
    }
  });
});

describe.each(["light", "dark"] as const)(
  "profile-screen copy of your data help a11y (%s)",
  (theme) => {
    it("is accessible with help mode on", async () => {
      setHelpMode(true);
      try {
        const { el, host } = await mount(stubApi(), theme);
        expect(tooltip(el)).not.toBeNull();
        await expectNoA11yViolations(host);
      } finally {
        setHelpMode(false);
      }
    });
  },
);
