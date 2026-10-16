import { LitElement, html } from "lit";
import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
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
import { original, pick, clickSave, unload } from "../testing/receipt-language-fixture.js";
import "./receipt-language-panel.js";

class ReceiptBoundaryHost extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-receipt-language-panel
        .api=${this.api}
      ></dashboard-receipt-language-panel>
      <dashboard-department-receipt-dialog .api=${this.api}></dashboard-department-receipt-dialog>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("receipt-boundary-test-host", ReceiptBoundaryHost);
beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
async function mount() {
  const receipt = receiptApi();
  const languageWrite = deferred<void>();
  const languageWrites: string[] = [];
  let languageReadCount = 0;
  const api = Object.assign(receipt, {
    getReceiptLanguage: async () => {
      languageReadCount++;
      return structuredClone(original);
    },
    getContentLanguages: async () => ({ defaultLanguage: "es", languages: ["es", "ca"] }),
    putReceiptLanguage: async (value: string) => {
      languageWrites.push(value);
      await languageWrite.promise;
    },
  });
  const { el: app } = await mountWidget<ReceiptBoundaryHost>("receipt-boundary-test-host", {
    api: api as unknown as DashboardApi,
  });
  const language = app.shadowRoot!.querySelector("dashboard-receipt-language-panel")!;
  const el = app.shadowRoot!.querySelector("dashboard-department-receipt-dialog")!;
  await expect
    .poll(() => language.shadowRoot!.querySelector("[name=receiptLanguage]"))
    .toBeTruthy();
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
  "a language %s settles only its draft while a separate receipt is edited",
  async (answer) => {
    const { language, el, receipt, languageWrite, languageWrites, openReceipt } = await mount();
    await pick(language, "ca-ES");
    await clickSave(language);
    await openReceipt();
    await editReceipt(el, "email", "bar@example.com");
    if (answer === "success") languageWrite.resolve();
    else languageWrite.reject({ code: "receipt.language_orders_open" });
    await expect
      .poll(
        () =>
          language.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
            "[data-test=language-save]",
          )?.loading,
      )
      .toBe(false);
    expect(receiptField(el, "email").value).toBe("bar@example.com");
    expect(receiptSave(el).disabled).toBe(false);
    expect(unload()).toBe(true);
    expect(languageWrites).toEqual(["ca-ES"]);
    expect(receipt.putDepartmentReceipt).not.toHaveBeenCalled();
    await editReceipt(el, "email", "");
    expect(unload()).toBe(answer === "refusal");
  },
);
it("a receipt save commits only its authored draft and leaves a staged venue language protected", async () => {
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
it("a successful language write retires an old leave choice without cleaning a receipt draft", async () => {
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
it("an unchanged receipt read keeps the outstanding language leave choice current", async () => {
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
  expect(
    language.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "[name=receiptLanguage]",
    )!.value,
  ).toBe("ca-ES");
  expect(language.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
});

it("an unchanged language read leaves an outstanding receipt leave choice current", async () => {
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
