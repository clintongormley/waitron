import { LitElement, html } from "lit";
import { LiveData } from "@waitron/dashboard-kit";
import { LeaveController, type WtInput, type WtTextarea } from "@waitron/ui";
import { expect, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DepartmentReceiptWrite } from "@waitron/shared";
import type { ReceiptPreview } from "../api/client.js";
import { mountWidget } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import type {
  DepartmentReceiptClient,
  DepartmentReceiptModel,
} from "../api/department-receipts.js";
import type { DepartmentReceiptEditor } from "../screens/department-receipt-editor.js";
import "../screens/department-receipt-editor.js";

export const receiptModel: DepartmentReceiptModel = {
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
    getDepartmentReceipt: vi.fn<DepartmentReceiptClient["getDepartmentReceipt"]>(async () =>
      structuredClone(stored),
    ),
    putDepartmentReceipt: vi.fn(async (_id: string, input: DepartmentReceiptWrite) => {
      void _id;
      stored = { ...stored, ...structuredClone(input) };
    }),
    previewReceiptDraft: vi.fn<DepartmentReceiptClient["previewReceiptDraft"]>(async () =>
      preview(),
    ),
    imageLibraryRequest: async <T>() => ({ images: [], total: 0 }) as T,
  };
}
class ReceiptEditorHost extends LitElement {
  readonly leave = new LeaveController(this);
  api = receiptApi();
  override render() {
    return html`<dashboard-department-receipt-editor
        .api=${this.api}
        .subject=${{ id: "bar", name: "Bar" }}
      ></dashboard-department-receipt-editor
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("receipt-editor-fixture-host", ReceiptEditorHost);
export async function mountReceiptEditor(api = receiptApi(), theme: "light" | "dark" = "light") {
  const { el: app, host } = await mountWidget<ReceiptEditorHost>(
    "receipt-editor-fixture-host",
    { api },
    theme,
  );
  const el = app.shadowRoot!.querySelector<DepartmentReceiptEditor>(
    "dashboard-department-receipt-editor",
  )!;
  const events: string[] = [];
  for (const type of [
    "department-receipt-saved",
    "department-receipt-cancel",
    "department-receipt-closed",
  ])
    el.addEventListener(type, (event) =>
      events.push(
        `${type}:${(event as CustomEvent<{ departmentId: string }>).detail.departmentId}`,
      ),
    );
  await expect.poll(() => receiptRoot(el).querySelector("[name=email]")).toBeTruthy();
  return { app, host, el, api, events };
}
export function receiptRoot(el: DepartmentReceiptEditor): ShadowRoot {
  return el.shadowRoot!;
}
export function receiptField(el: DepartmentReceiptEditor, name: string) {
  return receiptRoot(el).querySelector<WtInput | WtTextarea>(`[name="${name}"]`)!;
}
export async function editReceipt(el: DepartmentReceiptEditor, name: string, value: string) {
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
export function receiptSave(el: DepartmentReceiptEditor) {
  return receiptRoot(el).querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-receipt]",
  )!;
}
export async function clickReceiptSave(el: DepartmentReceiptEditor) {
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
