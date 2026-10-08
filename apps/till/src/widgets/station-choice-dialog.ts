import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, saveActionState } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-dialog.js";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
import type { Station } from "../api/client.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import { trackDialog } from "./track-dialog.js";

const moveRefusals: Record<string, StringKey> = {
  "ticket.already_started": "move_station.refused.ticket.already_started",
  "working_order.not_open": "move_station.refused.working_order.not_open",
  "working_order.already_collected": "move_station.refused.working_order.already_collected",
  "tab.line_not_found": "move_station.refused.tab.line_not_found",
  "ticket.not_sent": "move_station.refused.ticket.not_sent",
  "ticket.made_here": "move_station.refused.ticket.made_here",
};

const NO_STATION = "__station_choice_none__";

@customElement("till-station-choice-dialog")
export class TillStationChoiceDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .body {
        display: grid;
        gap: var(--wt-space-3);
      }
      .refusal {
        margin: 0;
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property() mode: "make-at" | "move" = "make-at";
  @property() dishName = "";
  @property({ attribute: false }) stations: Station[] = [];
  @property() currentStationId: string | null = null;
  @property() selected: string | null | undefined = undefined;
  @property({ type: Boolean }) busy = false;
  @property() refusal: string | null = null;

  @state() private active = true;
  #scope?: DraftScope<string | null>;
  #leave?: LeaveCoordinator;
  #baseline?: { stationId: string | null };
  #observedChoice: string | null = null;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override willUpdate(): void {
    if (!this.isConnected || !this.active) return;
    if (this.#scope) {
      const choice = this.#choice();
      if (choice !== this.#observedChoice) {
        this.#observedChoice = choice;
        this.#scope.changed();
      }
      return;
    }
    this.#baseline ??= { stationId: this.#choice() };
    if (this.selected === undefined) this.selected = this.#baseline.stationId;
    const { coordinator, scope } = draftScopeFor<string | null>(this, {
      id: this,
      current: () => this.#choice(),
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => (this.selected = value),
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit(this.#baseline.stationId);
    this.#observedChoice = this.#choice();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  #cancel(): void {
    if (!this.isConnected || !this.active) return;
    if (this.#leave) {
      void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
      return;
    }
    this.#emit("close");
  }

  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#emit("close");
  }

  #choice(): string | null {
    if (this.selected !== undefined)
      return this.selected !== null && this.stations.some((station) => station.id === this.selected)
        ? this.selected
        : null;
    return this.stations.some((station) => station.id === this.currentStationId)
      ? this.currentStationId
      : null;
  }

  #emit(type: "station-chosen" | "close", detail?: { stationId: string | null }): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #submit(): void {
    if (!this.isConnected || !this.active) return;
    const choice = this.#choice();
    if (
      this.busy ||
      (this.mode === "move" && (choice === null || choice === this.currentStationId))
    )
      return;
    if (this.mode === "make-at") {
      if (saveActionState(this.#scope).unchanged) return;
      this.#baseline = { stationId: choice };
      this.#scope?.commit(choice);
    }
    this.#emit("station-chosen", { stationId: choice });
  }

  #refusal(): string {
    const code = this.refusal!;
    const key = this.mode === "move" ? moveRefusals[code] : undefined;
    return key === undefined ? codeMessage(code) : t(key);
  }

  override render() {
    const choice = this.#choice();
    const moving = this.mode === "move";
    const saveAction = saveActionState(this.#scope);
    const currentListed = this.stations.some((station) => station.id === this.currentStationId);
    const label = t(moving ? "move_station.move_to" : "move_station.make_at");
    const firstOption = moving
      ? currentListed
        ? []
        : [{ value: NO_STATION, label: t("move_station.choose") }]
      : [{ value: NO_STATION, label: t("move_station.rules") }];
    const options = [
      ...firstOption,
      ...this.stations.map((station) => ({
        value: station.id,
        label:
          moving && station.id === this.currentStationId
            ? t("move_station.now").replace("{station}", () => station.name)
            : station.open
              ? station.name
              : t("dead_end.station_closed").replace("{station}", () => station.name),
      })),
    ];
    return html`
      <wt-dialog
        ${trackDialog()}
        .open=${this.active}
        .beforeClose=${this.#leave ? this.#beforeClose : undefined}
        .heading=${`${label}: ${this.dishName}`}
        @wt-close=${(event: Event) => this.#closed(event)}
      >
        <div class="body" data-body>
          <wt-combobox
            name="station"
            label=${label}
            search="never"
            .options=${options}
            .value=${choice ?? NO_STATION}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              if (!this.isConnected || !this.active) return;
              this.selected = event.detail.value === NO_STATION ? null : event.detail.value;
              this.#observedChoice = this.#choice();
              this.#scope?.changed();
            }}
          ></wt-combobox>
          ${
            this.refusal === null
              ? nothing
              : html`<p class="refusal" role="alert">${this.#refusal()}</p>`
          }
        </div>
        <wt-button slot="footer" data-cancel variant="secondary" @click=${() => this.#cancel()}>
          ${t("action.cancel")}
        </wt-button>
        <wt-button
          slot="footer"
          data-submit
          variant=${moving ? "secondary" : saveAction.variant}
          ?disabled=${
            this.busy ||
            (moving ? choice === null || choice === this.currentStationId : saveAction.unchanged)
          }
          @click=${() => this.#submit()}
        >
          ${t(moving ? "move_station.move" : "move_station.save")}
        </wt-button>
      </wt-dialog>
    `;
  }
}
