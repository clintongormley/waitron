import { expect } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, type WtButton, type WtCombobox } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi, ReceiptLanguage } from "../api/client.js";
import { mountWidget } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import "../screens/receipt-language-panel.js";

class LanguageHost extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-receipt-language-panel
        .api=${this.api}
      ></dashboard-receipt-language-panel>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("receipt-language-test-host", LanguageHost);
type Panel = HTMLElementTagNameMap["dashboard-receipt-language-panel"];
export const original: ReceiptLanguage = {
  language: "es-ES",
  choices: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
  fixed: null,
};
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export async function mount(
  value: ReceiptLanguage = original,
  overrides: Partial<DashboardApi> = {},
) {
  let stored = structuredClone(value);
  const writes: string[] = [];
  const liveData = new LiveData();
  const api = {
    liveData,
    getReceiptLanguage: async () => structuredClone(stored),
    getContentLanguages: async () => ({ defaultLanguage: "es", languages: ["es", "ca"] }),
    putReceiptLanguage: async (language: string) => {
      writes.push(language);
      if (overrides.putReceiptLanguage) await overrides.putReceiptLanguage(language);
      stored = { ...stored, language };
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== "putReceiptLanguage"),
    ),
  } as unknown as DashboardApi;
  const { el: app, host } = await mountWidget<LanguageHost>("receipt-language-test-host", { api });
  const panel = app.shadowRoot!.querySelector<Panel>("dashboard-receipt-language-panel")!;
  expect(panel.shadowRoot, "the independent receipt language card is missing").not.toBeNull();
  await expect
    .poll(() => panel.shadowRoot?.querySelector("[data-test=language-section]"))
    .toBeTruthy();
  return { app, panel, host, writes, liveData, api };
}
export const field = (panel: Panel) =>
  panel.shadowRoot!.querySelector<WtCombobox>("[name=receiptLanguage]")!;
export const save = (panel: Panel) =>
  panel.shadowRoot!.querySelector<WtButton>("[data-test=language-save]")!;
export async function pick(panel: Panel, language: string) {
  field(panel).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: language }, bubbles: true, composed: true }),
  );
  await panel.updateComplete;
}
export async function clickSave(panel: Panel) {
  await save(panel).updateComplete;
  await userEvent.click(page.elementLocator(save(panel).shadowRoot!.querySelector("button")!));
}
export function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
