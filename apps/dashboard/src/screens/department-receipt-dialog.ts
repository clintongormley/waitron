import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { leaveCoordinatorFor, type LeaveReason, type WtDialog } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { DepartmentReceiptEditor } from "./department-receipt-editor.js";
import "./department-receipt-editor.js";
import "@waitron/ui/src/components/wt-modal.js";

export type {
  DepartmentReceiptModel as DepartmentReceiptDialogModel,
  DepartmentReceiptClient as DepartmentReceiptDialogApi,
} from "../api/department-receipts.js";
import type { DepartmentReceiptClient as DepartmentReceiptDialogApi } from "../api/department-receipts.js";

@customElement("dashboard-department-receipt-dialog")
export class DepartmentReceiptDialog extends LitElement {
  static override styles = css`
    :host {
      display: contents;
    }
  `;
  @property({ attribute: false }) api!: DepartmentReceiptDialogApi;
  @property({ attribute: false }) subject?: { id: string; name: string };
  @property({ type: Boolean }) canManagePolicy = true;
  @property({ type: Boolean }) requiresDescription = true;
  @state() private department: { id: string; name: string } | null = null;
  #subjectId?: string;
  #opening = 0;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("subject")) return;
    if (!this.subject) {
      if (this.department === null) this.#subjectId = undefined;
      return;
    }
    if (this.department?.id === this.subject.id) {
      this.department = { ...this.department, name: this.subject.name };
      return;
    }
    if (this.department === null && this.subject.id !== this.#subjectId) {
      this.#subjectId = this.subject.id;
      this.show(this.subject);
    }
  }
  show(department: { id: string; name: string }): void {
    if (this.department !== null || !this.isConnected) return;
    this.#opening++;
    this.department = { ...department };
  }
  dismiss(): void {
    this.#dialog()?.closeAfter("security");
    this.#close(true);
  }
  override connectedCallback(): void {
    super.connectedCallback();
    if (this.department) this.requestUpdate();
  }
  override disconnectedCallback(): void {
    this.requestUpdate();
    super.disconnectedCallback();
  }
  #close(notifyHost = false): void {
    const departmentId = this.department?.id;
    this.department = null;
    if (notifyHost && departmentId && this.isConnected)
      this.dispatchEvent(
        new CustomEvent("department-receipt-closed", {
          detail: { departmentId },
          bubbles: true,
          composed: true,
        }),
      );
  }
  #dialog(): WtDialog | null {
    return this.shadowRoot?.querySelector("wt-modal") ?? null;
  }
  #editor(): DepartmentReceiptEditor | null {
    return this.shadowRoot?.querySelector("dashboard-department-receipt-editor") ?? null;
  }
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    const editor = this.#editor();
    if (editor?.saving) return false;
    const scope = editor?.leaveScope;
    const leave = leaveCoordinatorFor(this);
    return (
      !scope ||
      !leave ||
      (await leave.request({ scopes: [scope], reason, proceed() {} })) === "proceeded"
    );
  };
  override render() {
    return html`<wt-modal
      size="wide"
      heading=${t("receipts.edit")}
      description=${this.department?.name ?? ""}
      .open=${this.isConnected && this.department !== null}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (this.isConnected && event.target === event.currentTarget) this.#close(true);
      }}
    >
      ${
        this.department
          ? keyed(
              this.#opening,
              html`<dashboard-department-receipt-editor
                .api=${this.api}
                .subject=${this.department}
                .canManagePolicy=${this.canManagePolicy}
                .requiresDescription=${this.requiresDescription}
                @department-receipt-saved=${() => {
                  this.#dialog()?.closeAfter("saved");
                  this.#close();
                }}
                @department-receipt-cancel=${(event: Event) => {
                  event.stopPropagation();
                  void this.#dialog()?.requestClose("cancel");
                }}
                @department-receipt-closed=${() => {
                  this.#dialog()?.closeAfter("security");
                  this.#close();
                }}
              ></dashboard-department-receipt-editor>`,
            )
          : nothing
      }
    </wt-modal>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-department-receipt-dialog": DepartmentReceiptDialog;
  }
}
