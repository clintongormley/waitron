import { LitElement, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles, type LeaveReason } from "@waitron/ui";
import type { VenueServiceApi, VenueServiceView } from "./client.js";
import { t } from "./strings.js";
import "@waitron/ui/src/components/wt-modal.js";
import "./department-settings.js";

@customElement("department-edit-dialog")
export class DepartmentEditDialog extends LitElement {
  static override styles = [baseStyles];
  @property({ attribute: false }) api!: VenueServiceApi;
  @property({ attribute: false }) model!: VenueServiceView;
  @property() departmentId = "";
  @property({ type: Boolean }) refreshing = false;
  @state() private dismissed = false;
  private shownDepartment = "";
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
    const modal = this.shadowRoot?.querySelector("wt-modal");
    if (modal)
      void modal.updateComplete.then(() => {
        if (
          this.isConnected &&
          !this.dismissed &&
          this.shadowRoot?.querySelector("wt-modal") === modal
        )
          modal.open = true;
      });
  }
  override disconnectedCallback() {
    this.shadowRoot?.querySelector("wt-modal")?.closeAfter("security");
    super.disconnectedCallback();
  }
  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("departmentId")) this.dismissed = false;
    if (this.model?.departments.some((row) => row.id === this.departmentId && row.active))
      this.shownDepartment = this.departmentId;
    else if (
      this.shownDepartment &&
      this.shownDepartment === this.departmentId &&
      !this.dismissed
    ) {
      this.dismissed = true;
      this.emit("gone", this.departmentId);
    }
  }
  private readonly beforeClose = async (reason: LeaveReason) =>
    this.shadowRoot!.querySelector("department-settings")?.requestLeave(reason) ?? true;

  private emit(name: string, id: string) {
    this.dispatchEvent(
      new CustomEvent(name, { detail: { departmentId: id }, bubbles: true, composed: true }),
    );
  }
  private async saved(event: Event) {
    event.stopPropagation();
    const id = this.departmentId;
    const form = event.target as HTMLElementTagNameMap["department-settings"];
    await form.updateComplete;
    if (!this.isConnected || this.departmentId !== id || !form.isConnected) return;
    if (form.hasUnsavedChanges) {
      this.emit("written", id);
      return;
    }
    const modal = this.shadowRoot!.querySelector("wt-modal")!;
    this.dismissed = true;
    modal.closeAfter("saved");
    await modal.updateComplete;
    this.emit("saved", id);
  }

  override render(): unknown {
    const department = this.model?.departments.find(
      (row) => row.id === this.departmentId && row.active,
    );
    if (!department) return nothing;
    return keyed(
      department.id,
      html`<wt-modal
        .open=${this.isConnected && !this.dismissed}
        size="standard"
        heading=${`${t("venue.edit_department")}: ${department.name}`}
        .beforeClose=${this.beforeClose}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (
            (event.currentTarget as HTMLElement).isConnected &&
            this.departmentId === department.id &&
            !this.dismissed
          ) {
            this.dismissed = true;
            this.emit("closed", department.id);
          }
        }}
      >
        <department-settings
          .api=${this.api}
          .model=${this.model}
          .departmentId=${department.id}
          .refreshing=${this.refreshing}
          @saved=${this.saved}
          @cancelled=${(event: Event) => {
            event.stopPropagation();
            void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
          }}
        ></department-settings>
      </wt-modal>`,
    );
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "department-edit-dialog": DepartmentEditDialog;
  }
}
