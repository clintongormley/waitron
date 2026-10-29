import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import { foldName } from "@waitron/catalogue/src/name-uniqueness.js";
import type { CatalogueSummary, DashboardApi } from "../api/client.js";
import { fill, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";

@customElement("dashboard-menu-copy-dialog")
export class MenuCopyDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .form {
        padding-block: var(--wt-space-3);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) menu: Pick<CatalogueSummary, "id" | "name"> | null = null;
  @property({ attribute: false }) menus: readonly CatalogueSummary[] = [];
  @property({ attribute: false }) api!: Pick<DashboardApi, "duplicateCatalogue">;
  @state() private name = "";
  @state() private busy = false;
  @state() private attempted = false;
  @state() private requestError: { message: string; field: boolean } | null = null;
  private scope?: DraftScope<string>;
  private leave?: LeaveCoordinator;
  private opening?: string;
  private generation: object = {};
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override disconnectedCallback() {
    this.reset();
    super.disconnectedCallback();
  }
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  private reset() {
    this.scope?.dispose();
    this.scope = undefined;
    this.leave = undefined;
    this.opening = undefined;
    this.generation = {};
    this.busy = false;
  }
  protected override willUpdate() {
    if (!this.open || !this.menu) {
      this.reset();
      return;
    }
    if (this.opening !== this.menu.id) {
      this.reset();
      this.opening = this.menu.id;
      this.name = "";
      this.attempted = false;
      this.requestError = null;
    }
    if (!this.scope && this.isConnected) {
      const { scope, coordinator } = draftScopeFor<string>(this, {
        id: this.generation,
        current: () => this.name.trim(),
        snapshot: (value) => value,
        equal: (a, b) => a === b,
        restore: (value) => {
          this.name = value;
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit("");
    }
  }
  private get ownError(): string {
    if (!this.name.trim()) return t("menus.name_required");
    if (this.menus.some((menu) => foldName(menu.name) === foldName(this.name)))
      return t("menus.name_taken");
    return "";
  }
  private readonly beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.busy || !this.isConnected) return false;
    if (!this.scope || !this.leave) return true;
    const generation = this.generation;
    const result = await this.leave.request({ scopes: [this.scope.id], reason, proceed() {} });
    return generation === this.generation && this.isConnected && result === "proceeded";
  };
  private async copy() {
    if (
      !this.open ||
      !this.menu ||
      !this.isConnected ||
      this.busy ||
      saveActionState(this.scope).unchanged
    )
      return;
    this.attempted = true;
    this.requestError = null;
    if (this.ownError) {
      await this.updateComplete;
      void focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const generation = this.generation;
    const name = this.name.trim();
    this.busy = true;
    try {
      await this.api.duplicateCatalogue(this.menu.id, name);
    } catch (error) {
      if (generation !== this.generation) return;
      const code = codeOf(error);
      const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
      this.requestError = {
        field: field === "name" || field === "internalName",
        message: code === "menu.name_taken" ? t("menus.name_taken") : codeMessage(code),
      };
      return;
    } finally {
      if (generation === this.generation) this.busy = false;
    }
    if (generation !== this.generation) return;
    this.scope?.commit(name);
    this.shadowRoot!.querySelector("wt-modal")!.closeAfter("saved");
    this.open = false;
    this.dispatchEvent(new CustomEvent("menu-copied", { bubbles: true, composed: true }));
  }
  override render() {
    if (!this.open || !this.menu) return nothing;
    const save = saveActionState(this.scope);
    const error = this.requestError?.field
      ? this.requestError.message
      : this.attempted
        ? this.ownError
        : "";
    const bottom = [
      this.requestError && !this.requestError.field ? this.requestError.message : "",
      error ? t("form.fix_fields") : "",
    ]
      .filter(Boolean)
      .join(" ");
    const generation = this.generation;
    return keyed(
      generation,
      html`<wt-modal
        open
        size="compact"
        heading=${fill("menus.copy_heading", { name: this.menu.name })}
        .beforeClose=${this.beforeClose}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (generation !== this.generation || event.target !== event.currentTarget || this.busy)
            return;
          this.open = false;
          this.dispatchEvent(new CustomEvent("menu-copy-close", { bubbles: true, composed: true }));
        }}
        @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=copy]"))}
      >
        <div class="form">
          <wt-input
            name="name"
            label=${t("menus.name")}
            required
            .value=${this.name}
            .error=${error}
            ?disabled=${this.busy}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              if (this.busy) return;
              this.name = event.detail.value;
              if (this.requestError?.field) this.requestError = null;
              this.scope?.changed();
            }}
          ></wt-input>
        </div>
        <wt-form-actions slot="footer" .error=${bottom}>
          <wt-button
            slot="cancel"
            data-test="cancel"
            variant="secondary"
            ?disabled=${this.busy}
            @click=${() => void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel")}
            >${t("action.cancel")}</wt-button
          >
          <wt-button
            data-test="copy"
            variant=${save.variant}
            ?disabled=${save.unchanged || this.busy || (this.attempted && !!this.ownError)}
            ?loading=${this.busy}
            @click=${() => void this.copy()}
            >${t("menus.copy_action")}</wt-button
          >
        </wt-form-actions>
      </wt-modal>`,
    );
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-copy-dialog": MenuCopyDialog;
  }
}
