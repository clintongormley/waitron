import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import type { DashboardApi } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { t } from "../i18n/t.js";
import { codeOf } from "../i18n/codes.js";

@customElement("dashboard-location-settings-screen")
export class LocationSettingsScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private name = "";
  @state() private description = "";
  @state() private loaded = false;
  @state() private loadFailed = false;
  @state() private fieldError = "";
  @state() private saveFailed = false;
  @state() private saving = false;
  @state() private saved = false;
  #dirty = false;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.loadFailed = true;
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }
  async #load(): Promise<void> {
    this.loadFailed = false;
    try {
      await this.#queries.watch("getLocationSettings", [], (value) => {
        this.name = value.name;
        if (!this.#dirty && !this.saving) this.description = value.operationDescription;
        this.loaded = true;
        this.loadFailed = false;
      });
    } catch {
      this.loadFailed = true;
    }
  }
  async #save(): Promise<void> {
    if (!this.loaded || this.saving) return;
    this.saved = false;
    this.saveFailed = false;
    this.fieldError = this.description.trim() === "" ? t("location_settings.required") : "";
    if (this.fieldError !== "") return;
    this.saving = true;
    try {
      await this.api.putLocationSettings(this.description);
      this.#dirty = false;
      this.saved = true;
    } catch (error) {
      if (codeOf(error) === "management.request_invalid")
        this.fieldError = t("location_settings.invalid");
      else this.saveFailed = true;
    } finally {
      this.saving = false;
    }
  }
  override render() {
    return html`<h1>${t("location_settings.title")}</h1>
      <p>${this.name}</p>
      ${
        this.loadFailed
          ? html`<p role="alert">${t("location_settings.load_error")}</p>
              <wt-button data-test="retry" @click=${() => void this.#load()}
                >${t("location_settings.retry")}</wt-button
              >`
          : nothing
      }
      ${
        this.loaded
          ? html`
              <wt-form-error-summary
                heading=${t("form.error_heading")}
                .errors=${this.fieldError === "" ? [] : [this.fieldError]}
              ></wt-form-error-summary>
              <wt-input
                name="operationDescription"
                autocomplete="off"
                required
                label=${t("location_settings.description")}
                .value=${this.description}
                error=${this.fieldError}
                ?invalid=${this.fieldError !== ""}
                ?disabled=${this.saving}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.description = event.detail.value;
                  this.#dirty = true;
                  this.fieldError = "";
                  this.saved = false;
                }}
                @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
              >
                <wt-help-tooltip slot="help" aria-label=${t("location_settings.help_label")}
                  >${t("location_settings.help")}</wt-help-tooltip
                >
              </wt-input>
              ${this.saveFailed ? html`<p role="alert">${t("location_settings.save_error")}</p>` : nothing}
              ${this.saved ? html`<p role="status">${t("location_settings.saved")}</p>` : nothing}
              <wt-form-actions
                ><wt-button
                  data-test="save"
                  variant="primary"
                  ?loading=${this.saving}
                  @click=${() => void this.#save()}
                  >${t("action.save")}</wt-button
                ></wt-form-actions
              >
            `
          : nothing
      }`;
  }
}
