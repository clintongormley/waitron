import { LitElement, html } from "lit";
import { applyTokens, draftScopeFor, LeaveController, type DraftScope } from "@waitron/ui";
import { type DashboardRequest } from "@waitron/dashboard-kit";
import { expect } from "vitest";
import { page, userEvent } from "vitest/browser";
import { VenueServiceApi } from "../dashboard/client.js";
import { zonesModel } from "./department-zones-fixture.js";
import "@waitron/ui/src/components/wt-input.js";
import "../dashboard/department-edit-dialog.js";
import type { DepartmentTab } from "../dashboard/department-settings.js";

class DepartmentEditHost extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<department-edit-dialog></department-edit-dialog
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("a493-department-edit-host", DepartmentEditHost);
const hosts = new Set<DepartmentEditHost>();
export function cleanupDepartmentEditors() {
  for (const host of hosts) host.remove();
  hosts.clear();
}
export async function mountDepartmentEditor(
  request?: DashboardRequest,
  theme: "light" | "dark" = "light",
) {
  const app = document.createElement("a493-department-edit-host") as DepartmentEditHost;
  hosts.add(app);
  applyTokens(app);
  app.setAttribute("data-theme", theme);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector("department-edit-dialog")!;
  const writes: unknown[][] = [];
  el.api = new VenueServiceApi(
    request ??
      ((async (path, method = "GET", body) => {
        if (method === "GET")
          return path.endsWith("/profiles")
            ? []
            : { receivingProfileId: null, destinationDepartmentIds: [], profiles: [] };
        writes.push([path, method, body]);
      }) as DashboardRequest),
  );
  el.model = structuredClone(zonesModel);
  el.departmentId = "d1";
  await el.updateComplete;
  const form = departmentForm(el);
  await form.updateComplete;
  await expect.poll(() => form.shadowRoot!.querySelector("[name=receivingProfileId]")).toBeTruthy();
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  await expect.poll(() => modal.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(true);
  return { el, app, form, modal, writes };
}
export function departmentForm(el: HTMLElementTagNameMap["department-edit-dialog"]) {
  return el.shadowRoot!.querySelector("department-settings")!;
}
export async function editDepartmentField(
  form: HTMLElementTagNameMap["department-settings"],
  name: string,
  value: string,
) {
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name=${name}]`,
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await form.updateComplete;
}
export function departmentSave(form: HTMLElementTagNameMap["department-settings"]) {
  return form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-editor]",
  )!;
}
export async function selectDepartmentTab(
  form: HTMLElementTagNameMap["department-settings"],
  tab: DepartmentTab,
) {
  await form.updateComplete;
  const strip = form.shadowRoot!.querySelector("wt-tabs")!;
  await strip.updateComplete;
  await userEvent.click(
    page.elementLocator(strip.shadowRoot!.querySelector(`[role=tab][data-key=${tab}]`)!),
  );
  await form.updateComplete;
  await strip.updateComplete;
}

export class ReceiptEditorStub extends LitElement {
  departmentId = "d1";
  value = "";
  hold = false;
  busy = false;
  error = "";
  finish?: () => void;
  #scope?: DraftScope<string>;
  override connectedCallback() {
    super.connectedCallback();
    this.#scope = draftScopeFor(this, {
      id: this,
      current: () => this.value,
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => {
        this.value = value;
        this.requestUpdate();
      },
    }).scope;
  }
  override disconnectedCallback() {
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }
  get leaveScope(): object | undefined {
    return this.#scope?.id;
  }
  get hasUnsavedChanges(): boolean {
    return this.#scope?.isDirty() ?? false;
  }
  get saving(): boolean {
    return this.busy;
  }
  get invalid(): boolean {
    return !!this.error;
  }
  async refuse(error = "Refused") {
    this.error = error;
    this.requestUpdate();
    await this.updateComplete;
    this.notify("department-receipt-invalid", { invalid: true });
  }
  async save() {
    this.busy = true;
    if (this.hold)
      await new Promise<void>((resolve) => {
        this.finish = resolve;
      });
    this.#scope!.commit(this.value);
    this.busy = false;
    this.notify("department-receipt-saved");
  }
  notify(type: string, detail: object = {}) {
    this.dispatchEvent(
      new CustomEvent(type, {
        detail: { departmentId: this.departmentId, ...detail },
        bubbles: true,
        composed: true,
      }),
    );
  }
  override render() {
    return html`<wt-input
        name="receiptSubtitle"
        label="Subtitle"
        .value=${this.value}
        error=${this.error}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.value = event.detail.value;
          this.#scope?.changed();
          if (this.error) {
            this.error = "";
            this.requestUpdate();
            void this.updateComplete.then(() =>
              this.notify("department-receipt-invalid", { invalid: false }),
            );
          }
        }}
      ></wt-input
      ><button data-test="save-receipt" @click=${() => void this.save()}>Save</button
      ><button data-test="cancel-receipt" @click=${() => this.notify("department-receipt-cancel")}>
        Cancel
      </button>`;
  }
}
customElements.define("dashboard-department-receipt-editor", ReceiptEditorStub);
export async function supplyReceiptEditor(
  el: HTMLElementTagNameMap["department-edit-dialog"],
  form: HTMLElementTagNameMap["department-settings"],
) {
  const editor = document.createElement("dashboard-department-receipt-editor") as ReceiptEditorStub;
  el.receiptEditor = editor;
  await el.updateComplete;
  await form.updateComplete;
  await editor.updateComplete;
  return editor;
}
export function receiptInput(editor: ReceiptEditorStub) {
  return editor.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!;
}
export async function editReceipt(editor: ReceiptEditorStub, value: string) {
  await userEvent.fill(page.elementLocator(receiptInput(editor)), value);
}
