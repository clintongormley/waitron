import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { QueryController } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { baseStyles } from "@waitron/ui";
import type { VenueServiceApi, VenueServiceSettingsView } from "./client.js";
import { t } from "./strings.js";

type Field = "editSentLines";

@customElement("dashboard-venue-service-settings")
export class ServiceSettingsPanel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      section {
        margin-block: var(--wt-space-3);
      }
      .field-error,
      [role="alert"] {
        color: var(--wt-color-danger);
      }
      .field-error {
        margin: 0;
        font-weight: normal;
      }
      .setting {
        margin-top: var(--wt-space-4);
      }
      .hint {
        margin: var(--wt-space-1) 0 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];
  @property({ attribute: false }) api!: VenueServiceApi;
  @property({ attribute: false }) readOnly = false;
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    () => {
      this.loadError = t("venue.load_error");
    },
  );
  #loaded = false;
  @state() private model?: VenueServiceSettingsView;
  @state() private loadError?: string;
  @state() private fieldErrors: Partial<Record<Field, string>> = {};
  @state() private busy = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    try {
      let initial = !this.#loaded;
      this.#loaded = true;
      await this.#queries.watch(
        "settings",
        {
          key: "venue-service:settings",
          dependencies: QUERY_DEPENDENCIES.settings.map((type) => ({ type })),
          refreshMs: 60_000,
          read: () => {
            const api = initial ? this.api : (this.api.background ?? this.api);
            initial = false;
            return this.readOnly ? api.loadSettingsReadOnly() : api.loadSettings();
          },
        },
        (value) => {
          this.model = value;
          this.loadError = undefined;
        },
      );
    } catch {
      this.loadError = t("venue.load_error");
    }
  }

  /** A failed refresh after a stored change is a load failure, not a failed save. */
  async #save(
    field: Field,
    write: () => Promise<void>,
    stored: Partial<VenueServiceSettingsView>,
  ): Promise<void> {
    if (this.busy || this.readOnly) return;
    this.busy = true;
    this.fieldErrors = {};
    try {
      await write();
      this.model = { ...this.model!, ...stored };
      await this.#load();
    } catch {
      this.fieldErrors = { [field]: t("venue.save_error") };
    } finally {
      this.busy = false;
    }
  }

  #fieldError(name: Field) {
    const message = this.fieldErrors[name];
    return message
      ? html`<p id=${`error-${name}`} class="field-error" data-field-error=${name}>${message}</p>`
      : nothing;
  }

  #switch(name: Field, label: string, checked: boolean, save: (value: boolean) => void) {
    return html`<wt-switch
      class="setting"
      name=${name}
      label=${label}
      .checked=${live(checked)}
      .disabled=${this.busy || this.readOnly}
      @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
        event.stopPropagation();
        if (this.readOnly) return;
        save(event.detail.checked);
      }}
    ></wt-switch>`;
  }

  #kitchen(model: VenueServiceSettingsView): TemplateResult {
    return html`<section data-test="kitchen-changes">
      <h2>${t("venue.kitchen_changes")}</h2>
      ${this.#switch(
        "editSentLines",
        t("venue.edit_sent_lines"),
        model.settings.editSentLines,
        (editSentLines) =>
          void this.#save("editSentLines", () => this.api.saveSettings({ editSentLines }), {
            settings: { editSentLines },
          }),
      )}
      <p class="hint" data-test="edit-sent-lines-hint">${t("venue.edit_sent_lines_hint")}</p>
      ${this.#fieldError("editSentLines")}
    </section>`;
  }

  override render() {
    const messages = [
      ...(this.loadError ? [this.loadError] : []),
      ...Object.values(this.fieldErrors),
    ];
    return html`<div role="alert" data-test="page-alert">
        ${messages.map((message) => html`<p>${message}</p>`)}
      </div>
      ${this.model === undefined ? nothing : this.#kitchen(this.model)}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-venue-service-settings": ServiceSettingsPanel;
  }
}
