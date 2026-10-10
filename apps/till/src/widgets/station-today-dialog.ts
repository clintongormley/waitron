import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, saveActionState } from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-dialog.js";
import type { StationDestination, StationTodayWrite } from "../api/client.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { trackDialog } from "./track-dialog.js";

@customElement("till-station-today-dialog")
export class TillStationTodayDialog extends LitElement {
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
  @property() stationName = "";
  @property({ type: Number }) openDishCount = 0;
  @state() private openDishes: StationTodayWrite["openDishes"];
  @property({ attribute: false }) destinations: readonly StationDestination[] = [];
  @property() selected: string | undefined = undefined;
  @property({ type: Boolean }) busy = false;
  @property() refusal: string | null = null;
  @state() private active = true;
  @state() private savableAtOpen = true;
  @state() private fieldEdited = false;
  #scope?: DraftScope<{ destination: string; openDishes: StationTodayWrite["openDishes"] }>;
  #leave?: LeaveCoordinator;
  #baseline?: { value: { destination: string; openDishes: StationTodayWrite["openDishes"] } };
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
  #choice(): string {
    return this.destinations.some((d) => d.id === this.selected)
      ? this.selected!
      : (this.destinations.find((d) => d.isDefault)?.id ?? this.destinations[0]?.id ?? "");
  }
  #draft() {
    return { destination: this.#choice(), openDishes: this.openDishes };
  }
  override willUpdate(changed: PropertyValues): void {
    if (!this.isConnected || !this.active) return;
    if (changed.has("refusal")) this.fieldEdited = false;
    this.selected = this.#choice();
    if (this.#scope) {
      if (this.selected !== this.#observed) {
        this.#observed = this.selected;
        this.#scope.changed();
      }
      return;
    }
    this.#baseline ??= { value: this.#draft() };
    const { coordinator, scope } = draftScopeFor(this, {
      id: this,
      current: () => this.#draft(),
      snapshot: (value) => value,
      equal: (a, b) => a.destination === b.destination && a.openDishes === b.openDishes,
      restore: (value) => {
        this.selected = value.destination;
        this.openDishes = value.openDishes;
      },
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit(this.#baseline.value);
    this.#observed = this.selected;
  }
  commit(): void {
    if (!this.isConnected || !this.active) return;
    this.#baseline = { value: this.#draft() };
    this.#scope?.commit(this.#baseline.value);
    this.savableAtOpen = false;
  }
  #confirm(): void {
    if (
      !this.isConnected ||
      !this.active ||
      this.busy ||
      !this.#choice() ||
      (this.openDishCount > 0 && this.openDishes === undefined) ||
      saveActionState(this.#scope, { savableAtOpen: this.savableAtOpen }).unchanged
    )
      return;
    this.fieldEdited = true;
    this.dispatchEvent(
      new CustomEvent("station-today-confirm", {
        detail: {
          sendsToStationId: this.#choice(),
          ...(this.openDishCount > 0 ? { openDishes: this.openDishes } : {}),
        },
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
    const action = saveActionState(this.#scope, { savableAtOpen: this.savableAtOpen });
    const missing = !this.#choice() || (this.openDishCount > 0 && this.openDishes === undefined);
    const fieldRefusal = this.refusal === "station.destination_invalid";
    const refusal =
      this.refusal === null || (fieldRefusal && this.fieldEdited) ? "" : codeMessage(this.refusal);
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .beforeClose=${this.#leave ? this.#beforeClose : () => !this.busy}
      .heading=${t("station_today.dialog_heading").replace("{station}", () => this.stationName)}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <div class="body">
        <wt-combobox
          name="sendsToStationId"
          required
          label=${t("station_today.destination")}
          search="never"
          .options=${this.destinations.map((d) => ({ value: d.id, label: d.isDefault ? t("station_today.default_choice").replace("{station}", () => d.name) : d.name }))}
          .value=${this.#choice()}
          .disabled=${this.busy}
          .error=${fieldRefusal ? refusal : ""}
          @wt-change=${(e: CustomEvent<{ value: string }>) => {
            e.stopPropagation();
            if (!this.isConnected || !this.active || this.busy) return;
            this.selected = e.detail.value;
            this.fieldEdited = true;
            this.#observed = this.#choice();
            this.#scope?.changed();
          }}
        ></wt-combobox>
        ${
          this.openDishCount > 0
            ? html`
                <p>
                  ${t(this.openDishCount === 1 ? "station_today.unfinished_one" : "station_today.unfinished_many").replace("{count}", String(this.openDishCount))}
                </p>
                <wt-combobox
                  name="openDishes"
                  required
                  label=${t("station_today.unfinished_choice")}
                  search="never"
                  .options=${[
                    { value: "send", label: t("station_today.send_waiting") },
                    { value: "leave", label: t("station_today.leave_finish") },
                  ]}
                  .value=${this.openDishes ?? ""}
                  .disabled=${this.busy}
                  @wt-change=${(e: CustomEvent<{ value: string }>) => {
                    e.stopPropagation();
                    if (!this.isConnected || !this.active || this.busy) return;
                    if (e.detail.value !== "send" && e.detail.value !== "leave") return;
                    this.openDishes = e.detail.value;
                    this.#scope?.changed();
                  }}
                ></wt-combobox>
                <p>${t("station_today.started_stay")}</p>
              `
            : html`<p>${t("station_today.sent_stay")}</p>`
        }
        ${refusal ? html`<p class="refusal" role="alert">${fieldRefusal ? t("form.fix_fields") : refusal}</p>` : nothing}
      </div>
      <wt-button
        slot="footer"
        data-cancel
        variant="secondary"
        ?disabled=${this.busy}
        @click=${() => this.#cancel()}
        >${t("action.cancel")}</wt-button
      >
      <wt-button
        slot="footer"
        data-submit
        variant=${missing ? "secondary" : action.variant}
        ?disabled=${this.busy || missing || action.unchanged}
        @click=${() => this.#confirm()}
        >${t("station_today.close")}</wt-button
      >
    </wt-dialog>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "till-station-today-dialog": TillStationTodayDialog;
  }
}
