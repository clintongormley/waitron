import { LitElement, html } from "lit";
import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController, type WtButton, type WtCombobox } from "@waitron/ui";
import type { DashboardApi, VenueDefaults } from "../api/client.js";
import { mountWidget, cleanupWidgets, dialogClosed } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import {
  editReceipt,
  receiptApi,
  receiptField,
  receiptSave,
  clickReceiptSave,
  deferred,
} from "../testing/department-receipt-dialog-fixture.js";
import "./venue-defaults-panel.js";

class ReceiptBoundaryHost extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-venue-defaults-panel .api=${this.api}></dashboard-venue-defaults-panel>
      <dashboard-department-receipt-dialog .api=${this.api}></dashboard-department-receipt-dialog>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("receipt-boundary-test-host", ReceiptBoundaryHost);
type Card = HTMLElementTagNameMap["dashboard-venue-defaults-panel"];
const stored: VenueDefaults = {
  receiptLanguage: "es-ES",
  receiptLanguageChoices: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
  fixedReceiptLanguage: null,
  defaultProductVatClass: "reduced",
};
beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
const languageField = (card: Card) =>
  card.shadowRoot!.querySelector<WtCombobox>("wt-combobox[name=receiptLanguage]");
const cardSave = (card: Card) => card.shadowRoot!.querySelector<WtButton>("[data-test=save]");
async function pick(card: Card, language: string) {
  languageField(card)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: language }, bubbles: true, composed: true }),
  );
  await card.updateComplete;
}
async function clickSave(card: Card) {
  await cardSave(card)!.updateComplete;
  await userEvent.click(page.elementLocator(cardSave(card)!.shadowRoot!.querySelector("button")!));
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function mount() {
  const receipt = receiptApi();
  const languageWrite = deferred<void>();
  const languageWrites: Partial<VenueDefaults>[] = [];
  let languageReadCount = 0;
  const api = Object.assign(receipt, {
    getVenueDefaults: async () => {
      languageReadCount++;
      return structuredClone(stored);
    },
    getContentLanguages: async () => ({ defaultLanguage: "es", languages: ["es", "ca"] }),
    putVenueDefaults: async (changes: Partial<VenueDefaults>) => {
      languageWrites.push(changes);
      await languageWrite.promise;
      return { ...stored, ...changes };
    },
  });
  const { el: app } = await mountWidget<ReceiptBoundaryHost>("receipt-boundary-test-host", {
    api: api as unknown as DashboardApi,
  });
  const language = app.shadowRoot!.querySelector("dashboard-venue-defaults-panel")!;
  const el = app.shadowRoot!.querySelector("dashboard-department-receipt-dialog")!;
  await expect.poll(() => language.shadowRoot!.querySelector("[data-test=edit]")).toBeTruthy();
  language.shadowRoot!.querySelector<HTMLElement>("[data-test=edit]")!.click();
  await expect.poll(() => languageField(language)).toBeTruthy();
  async function openReceipt() {
    el.show({ id: "bar", name: "Bar" });
    await expect.poll(() => el.shadowRoot!.querySelector("[name=email]")).toBeTruthy();
    const dialog = el.shadowRoot!.querySelector("wt-modal")!;
    await expect
      .poll(() => dialog.shadowRoot!.querySelector("dialog")?.matches(":modal"))
      .toBe(true);
    return dialog;
  }
  return {
    app,
    language,
    el,
    receipt,
    languageWrite,
    languageWrites,
    openReceipt,
    languageReadCount: () => languageReadCount,
  };
}
it.each(["success", "refusal"] as const)(
  "a Defaults %s settles only its draft while a separate receipt is edited",
  async (answer) => {
    const { language, el, receipt, languageWrite, languageWrites, openReceipt } = await mount();
    await pick(language, "ca-ES");
    await clickSave(language);
    await openReceipt();
    await editReceipt(el, "email", "bar@example.com");
    if (answer === "success") languageWrite.resolve();
    else languageWrite.reject({ code: "receipt.language_orders_open" });
    if (answer === "success")
      await expect.poll(() => language.shadowRoot!.querySelector("[data-test=edit]")).toBeTruthy();
    else await expect.poll(() => cardSave(language)?.loading).toBe(false);
    expect(receiptField(el, "email").value).toBe("bar@example.com");
    expect(receiptSave(el).disabled).toBe(false);
    expect(unload()).toBe(true);
    expect(languageWrites).toEqual([{ receiptLanguage: "ca-ES" }]);
    expect(receipt.putDepartmentReceipt).not.toHaveBeenCalled();
    await editReceipt(el, "email", "");
    expect(unload()).toBe(answer === "refusal");
  },
);
it("a receipt save commits only its authored draft and leaves a staged Defaults draft protected", async () => {
  const { language, el, receipt, languageWrites, openReceipt } = await mount();
  await pick(language, "ca-ES");
  const dialog = await openReceipt();
  await editReceipt(el, "email", "bar@example.com");
  const closed = dialogClosed(dialog);
  await clickReceiptSave(el);
  await closed;
  expect(receipt.putDepartmentReceipt).toHaveBeenCalledTimes(1);
  expect(languageWrites).toEqual([]);
  expect(unload()).toBe(true);
  await pick(language, "es-ES");
  expect(unload()).toBe(false);
});
it("a successful Defaults write retires an old leave choice without cleaning a receipt draft", async () => {
  const { app, language, el, languageWrite, openReceipt } = await mount();
  await pick(language, "ca-ES");
  await clickSave(language);
  await openReceipt();
  await editReceipt(el, "email", "bar@example.com");
  let left = false;
  const pending = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {
      left = true;
    },
  });
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  const stale = question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  languageWrite.resolve();
  expect(await pending).toBe("stale");
  stale.click();
  await el.updateComplete;
  expect(left).toBe(false);
  expect(receiptField(el, "email").value).toBe("bar@example.com");
  expect(unload()).toBe(true);
  await editReceipt(el, "email", "");
  expect(unload()).toBe(false);
});
it("an unchanged receipt read keeps the outstanding Defaults leave choice current", async () => {
  const { app, language, receipt, openReceipt } = await mount();
  await pick(language, "ca-ES");
  await openReceipt();
  const pending = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  receipt.liveData.invalidate([{ type: "locations" }]);
  await expect.poll(() => receipt.getDepartmentReceipt.mock.calls.length).toBe(2);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(question.open).toBe(true);
  await question.updateComplete;
  await userEvent.click(
    page.elementLocator(question.shadowRoot!.querySelector("[data-choice=keep]")!),
  );
  expect(await pending).toBe("kept");
  expect(languageField(language)!.value).toBe("ca-ES");
  expect(language.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
});

it("an unchanged Defaults read leaves an outstanding receipt leave choice current", async () => {
  const { app, el, receipt, openReceipt, languageReadCount } = await mount();
  await openReceipt();
  await editReceipt(el, "email", "bar@example.com");
  const pending = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  receipt.liveData.invalidate([{ type: "locations" }]);
  await expect.poll(languageReadCount).toBe(2);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(question.open).toBe(true);
  await question.updateComplete;
  await userEvent.click(
    page.elementLocator(question.shadowRoot!.querySelector("[data-choice=keep]")!),
  );
  expect(await pending).toBe("kept");
  expect(receiptField(el, "email").value).toBe("bar@example.com");
  expect(unload()).toBe(true);
});
