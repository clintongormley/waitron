import { afterEach, expect, it, vi } from "vitest";
import { monthName, saveTaxOfficeFile, startBrowserDownload } from "./tax-office-download.js";
import type { DashboardApi } from "./api/client.js";
import { setLocale } from "./i18n/t.js";

afterEach(() => {
  setLocale("es-ES");
  vi.restoreAllMocks();
});

it("starts a download by pressing a temporary download link, and leaves no link behind", () => {
  const pressed: { href: string; download: boolean }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    pressed.push({ href: this.href, download: this.hasAttribute("download") });
  });
  const before = document.querySelectorAll("a").length;
  startBrowserDownload("/management-api/tax-office/month-download/b1/file");
  expect(pressed).toEqual([
    {
      href: new URL("/management-api/tax-office/month-download/b1/file", location.href).href,
      download: true,
    },
  ]);
  expect(document.querySelectorAll("a").length).toBe(before);
});

it("names a month as the Invoices screen does, in the person's language", () => {
  setLocale("en-GB");
  expect(monthName("2026-03")).toBe("March 2026");
  setLocale("es-ES");
  expect(monthName("2026-03")).toBe("marzo de 2026");
});

it("downloads the file under the id of the ready view it just checked, and answers that id", async () => {
  const api = {
    getTaxOfficeMonthDownload: vi.fn().mockResolvedValue({
      status: "ready",
      id: "b7",
      month: "2026-03",
      bytes: 1,
      expiresAt: "2026-03-31T15:45:00.000Z",
    }),
    taxOfficeMonthFileUrl: (id: string) => `/file/${id}`,
  } as unknown as DashboardApi;
  const start = vi.fn();
  expect(await saveTaxOfficeFile(api, "2026-03", start)).toBe("b7");
  expect(start.mock.calls).toEqual([["/file/b7"]]);
});
