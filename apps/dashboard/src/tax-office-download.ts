import type { DashboardApi } from "./api/client.js";
import { currentLocale } from "./i18n/t.js";

export type StartDownload = (url: string) => void;

/** A link carrying `download` saves its target without leaving the page. */
export function startBrowserDownload(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  link.click();
}

/** `YYYY-MM` as the Invoices screen names it, such as "March 2026". */
export function monthName(month: string): string {
  return new Intl.DateTimeFormat(currentLocale(), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

/** Hours and minutes in the browser's own time zone. The shell reads no venue time zone, so this is
 * the venue's time only when the browser is set to the venue's zone. */
export function clockTime(iso: string): string {
  return new Intl.DateTimeFormat(currentLocale(), { hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

/** Starts the browser's download of the person's file for `month`, once the server still holds it
 * ready; otherwise throws `tax_office.download_missing`. */
export async function saveTaxOfficeFile(
  api: DashboardApi,
  month: string,
  start: StartDownload = startBrowserDownload,
): Promise<void> {
  const view = await api.getTaxOfficeMonthDownload();
  if (view.status !== "ready" || view.month !== month)
    throw { code: "tax_office.download_missing" };
  start(api.taxOfficeMonthFileUrl());
}
