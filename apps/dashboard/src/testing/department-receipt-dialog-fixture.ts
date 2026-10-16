import { LitElement, html } from "lit";
import { LiveData } from "@waitron/dashboard-kit";
import { LeaveController, type WtInput, type WtTextarea, type WtDialog } from "@waitron/ui";
import { expect, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DepartmentReceiptWrite } from "@waitron/shared";
import type { ReceiptPreview } from "../api/client.js";
import { mountWidget } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import type {
  DepartmentReceiptDialog,
  DepartmentReceiptDialogApi,
  DepartmentReceiptDialogModel,
} from "../screens/department-receipt-dialog.js";
import "../screens/department-receipt-dialog.js";

export const receiptModel: DepartmentReceiptDialogModel = {
  receipt: {
    operationDescription: "Dining service",
    headerSubtitle: { "es-ES": "Bar", "eu-ES": "Retained" },
  },
  policy: { receiptPrintMode: "auto", printTradingName: true },
  receiptLanguage: "es-ES",
  operationDescriptionRequired: true,
  languages: ["es-ES", "ca-ES"],
  warningLanguages: ["ca-ES"],
  venueAddress: ["Calle Mayor 1"],
};
export function preview(text = "Sample"): ReceiptPreview {
  return {
    preview: {
      widthDots: 512,
      columns: 42,
      text,
      blocks: [{ kind: "text", text }],
      qrData: [],
      omittedGraphics: false,
      truncated: false,
      unsupported: false,
    },
    paperWidth: "80mm",
    paperWidths: ["58mm", "80mm"],
    marks: {
      logo: null,
      headerSubtitle: null,
      footerMessage: null,
      phone: null,
      email: null,
      address: null,
    },
  };
}
export function receiptApi(model = receiptModel) {
  let stored = structuredClone(model);
  return {
    liveData: new LiveData(),
    getDepartmentReceipt: vi.fn<DepartmentReceiptDialogApi["getDepartmentReceipt"]>(async () =>
      structuredClone(stored),
    ),
    putDepartmentReceipt: vi.fn(async (_id: string, input: DepartmentReceiptWrite) => {
      void _id;
      stored = { ...stored, ...structuredClone(input) };
    }),
    previewReceiptDraft: vi.fn<DepartmentReceiptDialogApi["previewReceiptDraft"]>(async () =>
      preview(),
    ),
    imageLibraryRequest: async <T>() => ({ images: [], total: 0 }) as T,
  };
}
class ReceiptDialogHost extends LitElement {
  readonly leave = new LeaveController(this);
  api = receiptApi();
  override render() {
    return html`<dashboard-department-receipt-dialog
        .api=${this.api}
      ></dashboard-department-receipt-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("receipt-dialog-test-host", ReceiptDialogHost);
export async function mountReceiptDialog(api = receiptApi(), theme: "light" | "dark" = "light") {
  const { el: app, host } = await mountWidget<ReceiptDialogHost>(
    "receipt-dialog-test-host",
    { api },
    theme,
  );
  const el = app.shadowRoot!.querySelector<DepartmentReceiptDialog>(
    "dashboard-department-receipt-dialog",
  )!;
  await el.updateComplete;
  el.show({ id: "bar", name: "Bar" });
  await expect.poll(() => el.shadowRoot?.querySelector("[name=email]")).toBeTruthy();
  const dialog = el.shadowRoot!.querySelector<WtDialog>("wt-modal")!;
  await expect.poll(() => dialog.shadowRoot?.querySelector("dialog")?.matches(":modal")).toBe(true);
  return { app, host, el, dialog, api };
}
export function receiptField(el: DepartmentReceiptDialog, name: string) {
  return el.shadowRoot!.querySelector<WtInput | WtTextarea>(`[name="${name}"]`)!;
}
export async function editReceipt(el: DepartmentReceiptDialog, name: string, value: string) {
  const field = receiptField(el, name);
  await field.updateComplete;
  await userEvent.fill(
    page.elementLocator(
      field.shadowRoot!.querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea")!,
    ),
    value,
  );
  await el.updateComplete;
}
export function receiptSave(el: DepartmentReceiptDialog) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-receipt]",
  )!;
}
export async function clickReceiptSave(el: DepartmentReceiptDialog) {
  await userEvent.click(page.elementLocator(receiptSave(el)));
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
