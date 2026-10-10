import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import type {
  TillApi,
  Station,
  StationDestination,
  StationTodayWrite,
  StaffMember,
} from "../api/client.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./station-today-dialog.js";
import "./supervisor-override-dialog.js";
import type { OverrideConfirmDetail } from "./supervisor-override-dialog.js";

@customElement("till-station-today")
export class TillStationToday extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .line {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
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
  @property({ attribute: false }) api?: TillApi;
  @property({ attribute: false }) station?: Omit<Station, "displayOrder">;
  @property({ attribute: false }) stations: readonly Pick<Station, "id" | "name">[] = [];
  @property({ type: Boolean }) deviceMode = false;
  @state() private busy = false;
  @state() private openDishCount = 0;
  @state() private destinations: StationDestination[] | null = null;
  @state() private refusal: string | null = null;
  @state() private authorizers: StaffMember[] | null = null;
  @state() private pinError: string | null = null;
  #intent?: StationTodayWrite;
  #deviceAuthorizers: StaffMember[] = [];
  #generation = 0;
  override disconnectedCallback(): void {
    this.#reset();
    super.disconnectedCallback();
  }
  override willUpdate(changed: PropertyValues): void {
    if (
      changed.has("station") &&
      (changed.get("station") as Station | undefined)?.id !== this.station?.id
    )
      this.#reset();
  }
  #reset(): void {
    this.#generation++;
    this.busy = false;
    this.destinations = null;
    this.openDishCount = 0;
    this.authorizers = null;
    this.#intent = undefined;
    this.#deviceAuthorizers = [];
    this.refusal = null;
    this.pinError = null;
  }
  #current(generation: number, id: string): boolean {
    return this.isConnected && generation === this.#generation && this.station?.id === id;
  }
  #code(error: unknown): string {
    return typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
      ? error.code
      : "network.error";
  }
  async #act(): Promise<void> {
    const station = this.station;
    if (
      !this.isConnected ||
      !this.api ||
      !station ||
      !station.active ||
      station.isDefault ||
      this.busy ||
      this.destinations ||
      this.authorizers
    )
      return;
    if (!station.open && !this.deviceMode) {
      await this.#write({ state: "open" });
      return;
    }
    const generation = ++this.#generation;
    const id = station.id;
    this.busy = true;
    this.refusal = null;
    try {
      const answer = await this.#readToday(id);
      if (this.#current(generation, id)) {
        if (answer.authorizers) this.#deviceAuthorizers = answer.authorizers;
        if (station.open) {
          this.destinations = answer.destinations;
          this.openDishCount = answer.openDishCount;
        } else this.#askDeviceManager({ state: "open" });
      }
    } catch (error) {
      if (this.#current(generation, id)) this.refusal = this.#code(error);
    } finally {
      if (this.#current(generation, id)) this.busy = false;
    }
  }
  async #readToday(id: string): Promise<{
    destinations: StationDestination[];
    authorizers?: StaffMember[];
    openDishCount: number;
  }> {
    if (!this.deviceMode) return this.api!.stationToday(id);
    const answer = await this.api!.deviceStationToday(id);
    return answer;
  }
  #askDeviceManager(intent: StationTodayWrite): void {
    this.#intent = intent;
    this.authorizers = this.#deviceAuthorizers;
  }
  async #write(intent: StationTodayWrite, override?: OverrideConfirmDetail): Promise<void> {
    if (!this.isConnected || !this.api || !this.station || this.busy) return;
    if (this.deviceMode && !override) {
      this.#askDeviceManager(intent);
      return;
    }
    const generation = ++this.#generation;
    const id = this.station.id;
    this.#intent = intent;
    this.busy = true;
    this.refusal = null;
    this.pinError = null;
    try {
      if (this.deviceMode) {
        const { state, sendsToStationId, openDishes } = intent;
        await this.api.deviceSetStationToday(id, {
          state,
          ...(sendsToStationId === undefined ? {} : { sendsToStationId }),
          ...(openDishes === undefined ? {} : { openDishes }),
          authorizer: override!,
        });
      } else await this.api.setStationToday(id, override ? { ...intent, override } : intent);
      if (!this.#current(generation, id)) return;
      this.shadowRoot!.querySelector("till-station-today-dialog")?.commit();
      this.#reset();
      this.dispatchEvent(
        new CustomEvent("station-today-changed", {
          detail: { stationId: id },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      if (!this.#current(generation, id)) return;
      const code = this.#code(error);
      if (this.authorizers && (code === "pin.invalid" || code === "pin.throttled")) {
        this.pinError = code;
      } else if (code === "authorization.not_permitted") {
        try {
          const people = this.deviceMode
            ? (await this.api.deviceStationToday(id)).authorizers
            : await this.api.serviceDayAuthorizers();
          if (this.#current(generation, id)) {
            this.authorizers = people;
            if (this.deviceMode) this.#deviceAuthorizers = people;
          }
        } catch (readError) {
          if (this.#current(generation, id)) this.refusal = this.#code(readError);
        }
      } else {
        this.authorizers = null;
        this.refusal = code;
        const needsDishChoice =
          code === "management.request_invalid" &&
          typeof error === "object" &&
          error !== null &&
          "field" in error &&
          error.field === "openDishes";
        if (
          (code === "station.destination_invalid" || needsDishChoice) &&
          this.destinations !== null
        ) {
          try {
            const answer = await this.#readToday(id);
            if (this.#current(generation, id)) {
              this.destinations = answer.destinations;
              this.openDishCount = answer.openDishCount;
              if (needsDishChoice) this.refusal = null;
              if (answer.authorizers) this.#deviceAuthorizers = answer.authorizers;
            }
          } catch {
            /* Keep the write refusal when the refresh also fails. */
          }
        }
      }
    } finally {
      if (this.#current(generation, id)) this.busy = false;
    }
  }
  #line(): string {
    const s = this.station!;
    if (!s.active) return t("station_today.switched_off");
    if (s.isDefault) return t("station_today.default");
    if (s.open) return t("station_today.open");
    const destination = this.stations.find((d) => d.id === s.sendsTo)?.name;
    return destination
      ? t("station_today.closed_by_hand").replace("{station}", () => destination)
      : t("station_today.closed");
  }
  override render() {
    const station = this.station;
    if (!station) return nothing;
    return html`<div class="line">
        <p data-status>${this.#line()}</p>
        ${
          station.active && !station.isDefault
            ? html`<wt-button
                data-action
                variant=${this.destinations !== null || this.authorizers !== null ? "secondary" : "primary"}
                ?disabled=${this.busy || this.destinations !== null || this.authorizers !== null}
                @click=${() => this.#act()}
                >${t(station.open ? "station_today.close" : "station_today.open_action")}</wt-button
              >`
            : nothing
        }
      </div>
      ${this.refusal && this.destinations === null ? html`<p class="refusal" role="alert">${codeMessage(this.refusal)}</p>` : nothing}
      ${
        this.destinations !== null
          ? html`<till-station-today-dialog
              .stationName=${station.name}
              .openDishCount=${this.openDishCount}
              .destinations=${this.destinations}
              .busy=${this.busy || this.authorizers !== null}
              .refusal=${this.refusal}
              @close=${(e: Event) => {
                e.stopPropagation();
                this.#reset();
              }}
              @station-today-confirm=${(
                e: CustomEvent<Pick<StationTodayWrite, "sendsToStationId" | "openDishes">>,
              ) => {
                e.stopPropagation();
                void this.#write({ state: "closed", ...e.detail });
              }}
            ></till-station-today-dialog>`
          : nothing
      }
      ${
        this.authorizers !== null
          ? html`<till-supervisor-override-dialog
              .authorizers=${this.authorizers}
              .approverRole=${"manager"}
              .error=${this.pinError}
              @override-cancel=${(e: Event) => {
                e.stopPropagation();
                if (!this.busy) {
                  this.authorizers = null;
                  this.pinError = null;
                }
              }}
              @override-confirm=${(e: CustomEvent<OverrideConfirmDetail>) => {
                e.stopPropagation();
                if (this.#intent) void this.#write(this.#intent, e.detail);
              }}
            ></till-supervisor-override-dialog>`
          : nothing
      }`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "till-station-today": TillStationToday;
  }
}
