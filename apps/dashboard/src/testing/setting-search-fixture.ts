import { expect } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtInput } from "@waitron/ui";
import type { DashboardApp } from "../dashboard-app.js";

export const searchBox = (app: DashboardApp) =>
  app.shadowRoot!.querySelector<WtInput>("[data-test=nav-search]")!;
export const searchResult = (app: DashboardApp, id: string) =>
  app.shadowRoot!.querySelector<HTMLElement>(`[data-search-destination="${id}"]`);
export const settingChooser = (app: DashboardApp) =>
  app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("[data-test=setting-search]");
export async function searchSettings(app: DashboardApp, query: string) {
  const toggle = app.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]");
  if (toggle?.checkVisibility() && app.shadowRoot!.querySelector(".sidebar")?.hasAttribute("inert"))
    toggle.click();
  searchBox(app).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: query }, bubbles: true, composed: true }),
  );
  await app.updateComplete;
}
export async function chooseSettingRow(app: DashboardApp, value: string) {
  const field =
    settingChooser(app)!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox")!;
  await expect.poll(() => field.options.length).toBeGreaterThan(0);
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await app.updateComplete;
}

export async function cancelSettingSearch(app: DashboardApp) {
  const modal = settingChooser(app)!;
  const closed = new Promise<void>((resolve) =>
    modal.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  await userEvent.click(modal.querySelector<HTMLElement>("[data-test=setting-cancel]")!);
  await closed;
  await app.updateComplete;
}
