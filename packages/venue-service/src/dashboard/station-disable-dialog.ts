import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import { keyed } from "lit/directives/keyed.js";
import { codeOf } from "@waitron/dashboard-kit";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { PrepStationsApi, StationClosing, StationDisableChoice } from "./routing-client.js";
import { t } from "./strings.js";
import { format } from "./hours-view.js";

const LEAVE = "__leave__";

@customElement("station-disable-dialog")
export class StationDisableDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .body {
        display: grid;
        gap: var(--wt-space-3);
      }
      p,
      ul {
        margin: 0;
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) api!: PrepStationsApi;
  @property() stationId = "";
  @property() stationName = "";
  @property({ attribute: false }) namingCells: readonly string[] = [];
  @state() private closing?: StationClosing;
  @state() private loading = true;
  @state() private busy = false;
  @state() private error = "";
  @state() private fieldError = "";
  @state() private choice = "";
  @state() private closed = false;
  private identity?: object;
  private readIdentity?: object;
  private scope?: DraftScope<string>;
  private leave?: LeaveCoordinator;
  private closeGuard?: (reason: LeaveReason) => Promise<boolean>;

  override disconnectedCallback() {
    this.identity = undefined;
    this.readIdentity = undefined;
    this.scope?.dispose();
    this.scope = undefined;
    this.leave = undefined;
    super.disconnectedCallback();
  }
  protected override willUpdate(changed: PropertyValues<this>) {
    if (!this.isConnected) return;
    if (!this.identity || changed.has("stationId")) {
      this.scope?.dispose();
      this.identity = {};
      const opening = this.identity;
      this.closeGuard = (reason) => this.beforeClose(reason, opening);
      this.closed = false;
      this.choice = "";
      this.busy = false;
      const { scope, coordinator } = draftScopeFor(this, {
        id: this.identity,
        current: () => this.choice,
        snapshot: (value) => value,
        equal: (a, b) => a === b,
        restore: (value) => {
          this.choice = value;
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit("");
      void this.read();
    }
  }
  private current(identity: object | undefined) {
    return this.isConnected && identity === this.identity;
  }
  private async read() {
    const identity = this.identity;
    const request = (this.readIdentity = {});
    this.loading = true;
    this.closing = undefined;
    this.error = "";
    this.fieldError = "";
    try {
      const closing = await this.api.readStationClosing(this.stationId);
      if (this.current(identity) && request === this.readIdentity) this.closing = closing;
    } catch {
      if (this.current(identity) && request === this.readIdentity)
        this.error = t("prep.disable_load_error");
    } finally {
      if (this.current(identity) && request === this.readIdentity) this.loading = false;
    }
  }
  private get validChoice() {
    return (
      this.choice === LEAVE || !!this.closing?.destinations.some((row) => row.id === this.choice)
    );
  }
  private async beforeClose(reason: LeaveReason, identity: object | undefined) {
    if (!this.current(identity) || this.busy) return false;
    if (!this.leave || !this.scope) return true;
    const outcome = await this.leave.request({ scopes: [this.scope.id], reason, proceed() {} });
    return this.current(identity) && outcome === "proceeded";
  }
  allowReplacement(): Promise<boolean> {
    return this.beforeClose("navigation", this.identity);
  }
  private finish(event: "disabled" | "cancel") {
    this.scope?.dispose();
    this.scope = undefined;
    this.closed = true;
    this.dispatchEvent(
      new CustomEvent(event, {
        detail: { stationId: this.stationId },
        bubbles: true,
        composed: true,
      }),
    );
  }
  private async disable() {
    if (
      this.busy ||
      this.loading ||
      !this.closing ||
      (this.closing.openDishCount > 0 && !this.validChoice)
    )
      return;
    const identity = this.identity;
    const submitted = this.choice;
    const choice: StationDisableChoice | undefined =
      this.closing.openDishCount === 0
        ? undefined
        : submitted === LEAVE
          ? { openDishes: "leave" }
          : { openDishes: "send", sendsToStationId: submitted };
    this.busy = true;
    this.error = "";
    this.fieldError = "";
    try {
      if (choice) await this.api.deactivateStation(this.stationId, choice);
      else await this.api.deactivateStation(this.stationId);
      if (!this.current(identity)) return;
      this.scope?.commit(submitted);
      this.finish("disabled");
    } catch (error) {
      if (!this.current(identity)) return;
      const field =
        typeof error === "object" &&
        error !== null &&
        "params" in error &&
        typeof error.params === "object" &&
        error.params !== null &&
        "field" in error.params
          ? error.params.field
          : undefined;
      const code = codeOf(error);
      if (code === "management.request_invalid" && field === "openDishes") {
        await this.read();
        return;
      }
      const destinationRefused =
        code === "station.destination_invalid" ||
        (code === "management.request_invalid" && field === "sendsToStationId");
      this.fieldError = destinationRefused ? t("prep.disable_destination_error") : "";
      this.error = destinationRefused ? this.fieldError : t("prep.save_error");
    } finally {
      if (this.current(identity)) this.busy = false;
    }
  }
  override render(): unknown {
    if (this.closed || !this.isConnected) return nothing;
    const identity = this.identity;
    const canAct =
      !this.loading && !!this.closing && (this.closing.openDishCount === 0 || this.validChoice);
    return keyed(
      identity,
      html`<wt-modal
        open
        heading=${t("prep.disable")}
        size="compact"
        .dismissible=${!this.busy}
        .beforeClose=${this.closeGuard}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (event.target === event.currentTarget && this.current(identity)) this.finish("cancel");
        }}
      >
        <div class="body">
          <p>${format("prep.disable_question", { station: this.stationName })}</p>
          ${
            this.namingCells.length
              ? html`<p>${t("prep.disable_cells")}</p>
                  <ul>
                    ${this.namingCells.map((cell) => html`<li>${cell}</li>`)}
                  </ul>`
              : nothing
          }
          <p>${t("prep.disable_new_default")}</p>
          ${this.loading ? html`<p>${t("prep.disable_loading")}</p>` : nothing}
          ${
            this.closing && this.closing.openDishCount > 0
              ? html`<wt-combobox
                    name="openDishes"
                    required
                    label=${format("prep.disable_waiting", { count: String(this.closing.openDishCount) })}
                    placeholder=${t("prep.disable_choose")}
                    .searchPlaceholder=${t("prep.search_stations")}
                    .options=${[{ value: LEAVE, label: t("prep.disable_leave") }, ...this.closing.destinations.map((row) => ({ value: row.id, label: format("prep.disable_send", { station: row.name }) }))]}
                    .value=${this.choice}
                    ?disabled=${this.busy}
                    @wt-change=${(event: CustomEvent<{ value: string }>) => {
                      if (!this.busy && this.current(identity)) {
                        this.choice = event.detail.value;
                        this.scope?.changed();
                      }
                    }}
                  ></wt-combobox>
                  ${this.fieldError ? html`<p class="error" data-field-error="openDishes">${this.fieldError}</p>` : nothing}`
              : nothing
          }
          ${this.error ? html`<p class="error" role="alert" data-test="disable-error">${this.error}</p>` : nothing}
          ${
            !this.loading && !this.closing
              ? html`<wt-button
                  variant="secondary"
                  data-test="disable-retry"
                  @click=${() => {
                    if (this.current(identity)) void this.read();
                  }}
                  >${t("prep.disable_retry")}</wt-button
                >`
              : nothing
          }
        </div>
        <wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            variant="secondary"
            data-test="disable-cancel"
            ?disabled=${this.busy}
            @click=${(event: Event) => {
              if (this.current(identity))
                void (event.currentTarget as HTMLElement)
                  .closest("wt-modal")!
                  .requestClose("cancel");
            }}
            >${t("prep.cancel")}</wt-button
          >
          <wt-button
            data-test="disable-confirm"
            variant=${canAct ? "danger" : "secondary"}
            ?disabled=${this.busy || !canAct}
            @click=${() => {
              if (this.current(identity)) void this.disable();
            }}
            >${t("prep.disable")}</wt-button
          ></wt-form-actions
        >
      </wt-modal>`,
    );
  }
}
