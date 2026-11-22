import { LitElement, html, nothing } from "lit";
import { applyTokens, draftScopeFor, LeaveController, type DraftScope } from "@waitron/ui";
import { property } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { type DashboardRequest } from "@waitron/dashboard-kit";
import { basisPointsToDecimal, stringToBasisPoints } from "@waitron/shared";
import { expect } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  VenueServiceApi,
  type VenueServiceView,
  type DepartmentSettingsInput,
} from "../dashboard/client.js";
import { zonesModel } from "./department-zones-fixture.js";
import "@waitron/ui/src/components/wt-input.js";
import "../dashboard/department-edit-dialog.js";
import type { DepartmentTab } from "../dashboard/department-settings.js";

export function departmentSettingsAnswer(
  model: VenueServiceView,
  departmentId: string,
  input: DepartmentSettingsInput,
): VenueServiceView {
  const answer = structuredClone(model);
  Object.assign(
    answer.departments.find((row) => row.id === departmentId)!,
    { name: input.name, tradingName: input.tradingName },
  );
  const policy = answer.salePolicies.departments.find((row) => row.departmentId === departmentId);
  const fields = {
    orderStart: input.orderStart,
    paidWhen: input.paidWhen,
    collectionNumber: input.collectionNumber,
    ...(input.dining === undefined ? {} : { dining: input.dining }),
    ...(input.diningStartsAs === undefined ? {} : { diningStartsAs: input.diningStartsAs }),
  };
  if (policy) Object.assign(policy, fields);
  else
    answer.salePolicies.departments.push({
      departmentId,
      ...fields,
      printTradingName: false,
    });
  if (input.needsClearing !== undefined)
    answer.needsClearingDepartmentIds = [
      ...answer.needsClearingDepartmentIds.filter((id) => id !== departmentId),
      ...(input.needsClearing ? [departmentId] : []),
    ];
  if (input.lateSendNeedsManager !== undefined)
    answer.lateSendManagerDepartmentIds = [
      ...answer.lateSendManagerDepartmentIds.filter((id) => id !== departmentId),
      ...(input.lateSendNeedsManager ? [departmentId] : []),
    ];
  if (input.estimatedMargin === null) delete answer.estimatedMarginByDepartment[departmentId];
  else if (input.estimatedMargin !== undefined)
    answer.estimatedMarginByDepartment[departmentId] = basisPointsToDecimal(
      stringToBasisPoints(input.estimatedMargin),
    );
  if (input.courseSettings !== undefined)
    answer.courseSettingsByDepartment[departmentId] = input.courseSettings.filter(
      (row) => !row.heldUntilFired || row.reminderMinutes !== 10,
    );
  if (input.serviceSteps)
    answer.serviceSteps = [
      ...answer.serviceSteps.filter((step) => step.departmentId !== departmentId),
      ...input.serviceSteps.map((step, index) => ({
        ...step,
        departmentId,
        id: step.id ?? `s${index + 1}`,
        afterStepId:
          input.serviceSteps!.findIndex(
            (parent) => (parent.key ?? parent.id) === step.afterStepKey,
          ) < 0
            ? null
            : (() => {
                const at = input.serviceSteps!.findIndex(
                  (parent) => (parent.key ?? parent.id) === step.afterStepKey,
                );
                return input.serviceSteps![at]!.id ?? `s${at + 1}`;
              })(),
      })),
    ];
  return answer;
}

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
  const supplied =
    request ??
    ((async (path, method = "GET", body) => {
      if (method === "GET")
        return path.endsWith("/profiles")
          ? []
          : { receivingProfileId: null, destinationDepartmentIds: [], profiles: [] };
      writes.push([path, method, body]);
      if (path.endsWith("/settings"))
        return departmentSettingsAnswer(el.model, el.departmentId, body as DepartmentSettingsInput);
    }) as DashboardRequest);
  el.api = new VenueServiceApi((async (path, method = "GET", body, options) => {
    const answer = await supplied(path, method, body, options);
    return method === "PUT" && path.endsWith("/settings")
      ? departmentSettingsAnswer(el.model, el.departmentId, body as DepartmentSettingsInput)
      : answer;
  }) as DashboardRequest);
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
export function departmentActions(form: HTMLElement) {
  return (
    (form as HTMLElement & { saveButton?: HTMLElement | null }).saveButton?.closest(
      "wt-form-actions",
    ) ?? form.shadowRoot!.querySelector("wt-form-actions")!
  );
}
export function departmentCancel(form: HTMLElement) {
  return departmentActions(form).querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[slot=cancel]",
  )!;
}
export function departmentSave(form: HTMLElement) {
  return (
    (form as HTMLElement & { saveButton?: HTMLElementTagNameMap["wt-button"] | null }).saveButton ??
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-editor]")!
  );
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
  @property({ attribute: false }) externalActions = false;
  private readonly saveRef = createRef<HTMLElementTagNameMap["wt-button"]>();
  get saveButton() {
    return this.saveRef.value ?? null;
  }
  protected override updated() {
    if (this.externalActions)
      this.dispatchEvent(
        new CustomEvent("footer-change", { detail: {}, bubbles: true, composed: true }),
      );
  }
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
  savedOperationDescription?: string;
  descriptionRefusal?: string;
  descriptionSaves: string[] = [];
  descriptionProblem(value: string) {
    if (!value.trim()) return "Description required";
    return value.length > 500 ? "Description invalid" : "";
  }
  protected override firstUpdated() {
    if (this.savedOperationDescription !== undefined) this.notify("department-receipt-description");
  }
  offerDescription(saved: string | undefined) {
    this.savedOperationDescription = saved;
    this.notify("department-receipt-description");
  }
  async saveOperationDescription(value: string) {
    this.descriptionSaves.push(value);
    this.busy = true;
    if (this.hold)
      await new Promise<void>((resolve) => {
        this.finish = resolve;
      });
    this.busy = false;
    if (this.descriptionRefusal) return this.descriptionRefusal;
    this.savedOperationDescription = value;
    return undefined;
  }
  async refuse(error = "Refused") {
    this.error = error;
    this.requestUpdate();
    await this.updateComplete;
    this.notify("department-receipt-invalid", { invalid: true });
  }
  async save() {
    this.busy = true;
    this.requestUpdate();
    if (this.hold)
      await new Promise<void>((resolve) => {
        this.finish = resolve;
      });
    this.#scope!.commit(this.value);
    this.busy = false;
    this.requestUpdate();
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
  renderFooter(slot?: "footer") {
    return html`<wt-form-actions slot=${slot ?? nothing} .showError=${slot !== "footer"}>
      <wt-button
        ${ref(this.saveRef)}
        data-test="save-receipt"
        ?disabled=${this.busy || !this.hasUnsavedChanges}
        @click=${() => void this.save()}
        >Save</wt-button
      >
      <wt-button
        slot="cancel"
        data-test="cancel-receipt"
        ?disabled=${this.busy}
        @click=${() => this.notify("department-receipt-cancel")}
        >Cancel</wt-button
      >
    </wt-form-actions>`;
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
          this.requestUpdate();
          if (this.error) {
            this.error = "";
            this.requestUpdate();
            void this.updateComplete.then(() =>
              this.notify("department-receipt-invalid", { invalid: false }),
            );
          }
        }}
      ></wt-input
      >${this.externalActions ? nothing : this.renderFooter()}`;
  }
}
customElements.define("dashboard-department-receipt-editor", ReceiptEditorStub);
export async function supplyReceiptEditor(
  el: HTMLElementTagNameMap["department-edit-dialog"],
  form: HTMLElementTagNameMap["department-settings"],
  description?: string,
) {
  const editor = document.createElement("dashboard-department-receipt-editor") as ReceiptEditorStub;
  editor.savedOperationDescription = description;
  el.receiptEditor = html`${editor}`;
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
