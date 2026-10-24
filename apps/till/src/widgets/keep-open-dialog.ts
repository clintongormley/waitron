import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, saveActionState } from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-dialog.js";
import type { KeepOpenZone } from "../api/client.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { trackDialog } from "./track-dialog.js";

@customElement("till-keep-open-dialog")
export class TillKeepOpenDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .body {
        display: grid;
        gap: var(--wt-space-3);
      }
      p {
        margin: 0;
      }
      .refusal {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) zone?: KeepOpenZone;
  @property() selected = "";
  @property({ type: Boolean }) busy = false;
  @property() refusal: string | null = null;
  @property() refusalField: string | null = null;
  @state() private active = true;
  @state() private fieldEdited = false;
  #scope?: DraftScope<string>;
  #leave?: LeaveCoordinator;
  #baseline = "";
  #observed = "";
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";
  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }
  override willUpdate(changed: PropertyValues): void {
    if (!this.isConnected || !this.active) return;
    if (changed.has("refusal")) this.fieldEdited = false;
    if (!this.zone?.choices.includes(this.selected)) this.selected = "";
    if (!this.#scope) {
      const { coordinator, scope } = draftScopeFor(this, {
        id: this,
        current: () => this.selected,
        snapshot: (v) => v,
        equal: (a, b) => a === b,
        restore: (v) => (this.selected = v),
      });
      this.#leave = coordinator;
      this.#scope = scope;
      scope.commit(this.#baseline);
    }
    if (this.selected !== this.#observed) {
      this.#observed = this.selected;
      this.#scope.changed();
    }
  }
  commit(): void {
    if (!this.isConnected || !this.active) return;
    this.#baseline = this.selected;
    this.#scope?.commit(this.selected);
  }
  #confirm(until: string | null): void {
    if (!this.isConnected || !this.active || this.busy || !this.zone) return;
    if (
      until === null
        ? this.zone.extendedUntil === null
        : !this.zone.choices.includes(until) || saveActionState(this.#scope).unchanged
    )
      return;
    this.fieldEdited = true;
    this.dispatchEvent(
      new CustomEvent("keep-open-confirm", {
        detail: { zoneId: this.zone.id, until },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #cancel(): void {
    if (!this.isConnected || !this.active || this.busy) return;
    void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
  }
  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }
  override render() {
    const p = this.zone;
    if (!p) return nothing;
    const action = saveActionState(this.#scope),
      missing = !p.choices.includes(this.selected);
    const refusal =
      this.refusal === null || (this.refusalField === "until" && this.fieldEdited)
        ? ""
        : codeMessage(this.refusal);
    const fieldError = this.refusalField === "until" && !this.fieldEdited ? refusal : "";
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .beforeClose=${this.#leave ? this.#beforeClose : () => !this.busy}
      .heading=${t("keep_open.zone_heading").replace("{zone}", () => p.name)}
      @wt-close=${(e: Event) => this.#closed(e)}
    >
      <div class="body">
        <p data-ends>
          ${t(p.running ? "keep_open.zone_closes" : "keep_open.zone_closed")
            .replace("{zone}", () => p.name)
            .replace("{time}", () => p.endsAt)}
        </p>
        <wt-combobox
          name="until"
          required
          search="never"
          label=${t("keep_open.until")}
          .options=${p.choices.map((value) => ({ value, label: value === p.dayEndsAt ? t("keep_open.end_of_day").replace("{time}", () => value) : value }))}
          .value=${this.selected}
          .disabled=${this.busy}
          .error=${fieldError}
          @wt-change=${(e: CustomEvent<{ value: string }>) => {
            e.stopPropagation();
            if (!this.isConnected || !this.active || this.busy) return;
            this.selected = p.choices.includes(e.detail.value) ? e.detail.value : "";
            this.fieldEdited = true;
            this.#scope?.changed();
          }}
        ></wt-combobox>
        ${refusal ? html`<p class="refusal" role="alert">${fieldError ? t("form.fix_fields") : refusal}</p>` : nothing}
      </div>
      <wt-button
        slot="footer"
        data-cancel
        variant="secondary"
        ?disabled=${this.busy}
        @click=${() => this.#cancel()}
        >${t("action.cancel")}</wt-button
      >
      ${p.extendedUntil !== null ? html`<wt-button slot="footer" data-stop variant="primary" ?disabled=${this.busy} @click=${() => this.#confirm(null)}>${t("keep_open.stop")}</wt-button>` : nothing}
      <wt-button
        slot="footer"
        data-submit
        variant=${action.variant}
        ?disabled=${this.busy || missing || action.unchanged}
        @click=${() => this.#confirm(this.selected)}
        >${t("keep_open.save")}</wt-button
      >
    </wt-dialog>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "till-keep-open-dialog": TillKeepOpenDialog;
  }
}
