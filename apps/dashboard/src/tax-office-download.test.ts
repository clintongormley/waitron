import { afterEach, expect, it, vi } from "vitest";
import { monthName, startBrowserDownload } from "./tax-office-download.js";
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
  startBrowserDownload("/management-api/tax-office/month-download/file");
  expect(pressed).toEqual([
    {
      href: new URL("/management-api/tax-office/month-download/file", location.href).href,
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
