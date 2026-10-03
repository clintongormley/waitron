import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import type { WatcherInput } from "./routing-client.js";
import type { WatcherView } from "./watchers-seen.js";
import { t } from "./strings.js";

type Choice = { id: string; name: string; active?: boolean };
type Refusal = { code: string; params?: { field?: string } };

@customElement("watcher-form")
export class WatcherForm extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .body {
        display: grid;
        gap: var(--wt-space-4);
        padding-block: var(--wt-space-3);
      }
      .group {
        display: grid;
        gap: var(--wt-space-2);
      }
      .choices {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
      }
      .choice {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
      }
      .error {
        color: var(--wt-color-danger);
      }
      .hint {
        color: var(--wt-color-text-muted);
        margin: 0;
      }
    `,
  ];
  @property({ attribute: false }) watcher?: WatcherView;
  @property({ attribute: false }) stations: readonly Choice[] = [];
  @property({ attribute: false }) zones: readonly Choice[] = [];
  @property({ attribute: false }) refusal?: Refusal;
  @property({ type: Boolean }) busy = false;
  @state() private draft: WatcherInput = {
    name: "",
    everyStation: false,
    stationIds: [],
    everyZone: false,
    zoneIds: [],
    runsPass: false,
  };
  @state() private attempted = false;

  protected override willUpdate(changed: Map<PropertyKey, unknown>) {
    if (changed.has("watcher")) {
      this.draft = this.watcher
        ? {
            name: this.watcher.name,
            everyStation: this.watcher.everyStation,
            stationIds: [...this.watcher.stationIds],
            everyZone: this.watcher.everyZone,
            zoneIds: [...this.watcher.zoneIds],
            runsPass: this.watcher.runsPass,
            displayOrder: this.watcher.displayOrder,
          }
        : {
            name: "",
            everyStation: false,
            stationIds: [],
            everyZone: false,
            zoneIds: [],
            runsPass: false,
          };
      this.attempted = false;
    }
  }
  private get visibleStations() {
    return this.stations.filter((row) => row.active !== false);
  }
  private get visibleZones() {
    return this.zones.filter((row) => row.active !== false);
  }
  private get input(): WatcherInput {
    return {
      ...this.draft,
      name: this.draft.name.trim(),
      stationIds: this.draft.everyStation
        ? []
        : this.visibleStations
            .filter((row) => this.draft.stationIds.includes(row.id))
            .map((row) => row.id),
      zoneIds: this.draft.everyZone
        ? []
        : this.visibleZones
            .filter((row) => this.draft.zoneIds.includes(row.id))
            .map((row) => row.id),
    };
  }
  private get invalid() {
    const input = this.input;
    return (
      !input.name ||
      (!input.everyStation && !input.stationIds.length) ||
      (!input.everyZone && !input.zoneIds.length)
    );
  }
  private set(field: keyof WatcherInput, value: WatcherInput[typeof field]) {
    this.draft = { ...this.draft, [field]: value };
    this.refusal = undefined;
  }
  private toggle(field: "stationIds" | "zoneIds", id: string, checked: boolean) {
    this.set(
      field,
      checked ? [...this.draft[field], id] : this.draft[field].filter((value) => value !== id),
    );
  }
  private error(field: "name" | "stationIds" | "zoneIds"): string {
    const code = this.refusal?.code;
    if (field === "name" && code === "watcher.name_taken") return t("watchers.name_taken");
    if (
      field === "stationIds" &&
      (code === "station.not_found" ||
        (code === "management.request_invalid" && this.refusal?.params?.field === field))
    )
      return t("watchers.need_station");
    if (
      field === "zoneIds" &&
      (code === "zone.not_found" ||
        (code === "management.request_invalid" && this.refusal?.params?.field === field))
    )
      return t("watchers.need_zone");
    if (!this.attempted) return "";
    if (field === "name" && !this.input.name) return t("venue.field_required");
    if (field === "stationIds" && !this.input.everyStation && !this.input.stationIds.length)
      return t("watchers.need_station");
    if (field === "zoneIds" && !this.input.everyZone && !this.input.zoneIds.length)
      return t("watchers.need_zone");
    return "";
  }
  private save() {
    if (this.busy) return;
    this.attempted = true;
    if (this.invalid) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.dispatchEvent(new CustomEvent("watcher-save", { detail: { input: this.input } }));
  }
  override render() {
    const nameError = this.error("name");
    const stationError = this.error("stationIds");
    const zoneError = this.error("zoneIds");
    const refusalBottom =
      this.refusal?.code === "watcher.not_found"
        ? t("watchers.not_found")
        : this.refusal && !nameError && !stationError && !zoneError
          ? t("prep.save_error")
          : "";
    return html`<div class="body">
        <div>
          <wt-input
            name="name"
            label=${t("prep.name")}
            required
            .value=${this.draft.name}
            aria-invalid=${nameError ? "true" : "false"}
            .invalid=${Boolean(nameError)}
            @wt-change=${(event: CustomEvent<{ value: string }>) => this.set("name", event.detail.value)}
          ></wt-input>
          ${nameError ? html`<p class="error" role="alert" data-field-error="name">${nameError}</p>` : nothing}
        </div>
        <div
          class="group"
          data-test="stations"
          role="group"
          aria-label=${t("watchers.stations")}
          aria-invalid=${stationError ? "true" : "false"}
        >
          <strong>${t("watchers.stations")} *</strong>
          <label class="choice"
            ><input
              name="everyStation"
              type="checkbox"
              .checked=${this.draft.everyStation}
              @change=${(event: Event) => this.set("everyStation", (event.target as HTMLInputElement).checked)}
              @wt-change=${(event: CustomEvent<{ checked: boolean }>) => this.set("everyStation", event.detail.checked)}
            />${t("watchers.choose_every_station")}</label
          >
          <div class="choices">
            ${this.visibleStations.map(
              (row) =>
                html`<label class="choice"
                  ><input
                    name="stationIds"
                    type="checkbox"
                    value=${row.id}
                    ?disabled=${this.draft.everyStation}
                    .checked=${this.draft.stationIds.includes(row.id)}
                    @change=${(event: Event) => this.toggle("stationIds", row.id, (event.target as HTMLInputElement).checked)}
                    @wt-change=${(event: CustomEvent<{ checked: boolean }>) => this.toggle("stationIds", row.id, event.detail.checked)}
                  />${row.name}</label
                >`,
            )}
          </div>
          ${stationError ? html`<p class="error" role="alert" data-field-error="stationIds">${stationError}</p>` : nothing}
        </div>
        <div
          class="group"
          data-test="zones"
          role="group"
          aria-label=${t("watchers.zones")}
          aria-invalid=${zoneError ? "true" : "false"}
        >
          <strong>${t("watchers.zones")} *</strong>
          <label class="choice"
            ><input
              name="everyZone"
              type="checkbox"
              .checked=${this.draft.everyZone}
              @change=${(event: Event) => this.set("everyZone", (event.target as HTMLInputElement).checked)}
              @wt-change=${(event: CustomEvent<{ checked: boolean }>) => this.set("everyZone", event.detail.checked)}
            />${t("watchers.choose_every_zone")}</label
          >
          <div class="choices">
            ${this.visibleZones.map(
              (row) =>
                html`<label class="choice"
                  ><input
                    name="zoneIds"
                    type="checkbox"
                    value=${row.id}
                    ?disabled=${this.draft.everyZone}
                    .checked=${this.draft.zoneIds.includes(row.id)}
                    @change=${(event: Event) => this.toggle("zoneIds", row.id, (event.target as HTMLInputElement).checked)}
                    @wt-change=${(event: CustomEvent<{ checked: boolean }>) => this.toggle("zoneIds", row.id, event.detail.checked)}
                  />${row.name}</label
                >`,
            )}
          </div>
          ${zoneError ? html`<p class="error" role="alert" data-field-error="zoneIds">${zoneError}</p>` : nothing}
        </div>
        <div>
          <wt-switch
            name="runsPass"
            label=${t("watchers.runs_pass")}
            .checked=${this.draft.runsPass}
            @wt-change=${(event: CustomEvent<{ checked: boolean }>) => this.set("runsPass", event.detail.checked)}
          ></wt-switch>
          <p class="hint">${t("watchers.runs_pass_hint")}</p>
        </div>
        ${this.attempted && this.invalid ? html`<p class="error" role="alert" data-test="watcher-error">${t("watchers.fix_fields")}</p>` : nothing}
        ${refusalBottom ? html`<p class="error" role="alert" data-test="watcher-error">${refusalBottom}</p>` : nothing}
      </div>
      <wt-form-actions>
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => this.dispatchEvent(new CustomEvent("watcher-cancel"))}
          >${t("venue.cancel")}</wt-button
        >
        <wt-button
          data-test="save-watcher"
          ?disabled=${this.busy || (this.attempted && this.invalid)}
          @click=${() => this.save()}
          >${t("venue.save")}</wt-button
        >
      </wt-form-actions>`;
  }
}
