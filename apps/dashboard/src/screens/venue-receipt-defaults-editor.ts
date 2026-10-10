import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { VenueReceiptSettings } from "@waitron/shared";
import { QueryController } from "@waitron/dashboard-kit";
import {
  baseStyles,
  draftScopeFor,
  saveActionState,
  focusFirstInvalid,
  submitOnEnter,
  type DraftScope,
} from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import { dashboardQuery } from "../api/live-queries.js";
import { sameValue } from "../widgets/product-editor-model.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import "../widgets/image-upload.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-textarea.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";

type Field = keyof VenueReceiptSettings;
const fields: readonly Field[] = ["logo", "headerSubtitle", "footerMessage", "printAddress"];

@customElement("dashboard-venue-receipt-defaults-editor")
export class VenueReceiptDefaultsEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-md);
      }
      .error {
        color: var(--wt-color-danger);
      }
      wt-form-actions {
        margin-top: var(--wt-space-4);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) draftParent?: object;
  @state() private draft: VenueReceiptSettings = {};
  @state() private loaded = false;
  @state() private saving = false;
  @state() private loadError = "";
  @state() private actionError = "";
  @state() private errors: Partial<Record<Field, string>> = {};
  #saved: VenueReceiptSettings = {};
  #scope?: DraftScope<VenueReceiptSettings>;
  #identity = {};
  #epoch = 0;
  #revision = 0;
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      this.loadError = codeMessage(codeOf(error));
    },
  );
  override connectedCallback(): void {
    super.connectedCallback();
    if (this.loaded) this.#register();
    void this.#load();
  }
  override disconnectedCallback(): void {
    this.#epoch++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.saving = false;
    super.disconnectedCallback();
  }
  #register(): void {
    if (this.#scope || !this.isConnected) return;
    this.#scope = draftScopeFor<VenueReceiptSettings>(this, {
      id: this.#identity,
      parent: this.draftParent ?? this,
      current: () => this.draft,
      snapshot: (value) => structuredClone(value),
      equal: sameValue,
      restore: (value) => {
        this.draft = structuredClone(value);
        this.errors = {};
        this.actionError = "";
        this.#changed();
      },
    }).scope;
    this.#scope.commit(structuredClone(this.#saved));
  }
  async #load(): Promise<void> {
    const epoch = this.#epoch;
    const revision = this.#revision;
    const query = dashboardQuery(this.api, "getVenueReceiptSettings", []);
    try {
      await this.#queries.watch(
        "defaults",
        {
          ...query,
          key: `${query.key}:revision-${revision}`,
          read: async () => ({ revision: this.#revision, value: await query.read() }),
        },
        ({ revision: readRevision, value }) => {
          if (epoch !== this.#epoch || readRevision !== this.#revision) return;
          this.loadError = "";
          if (!this.#scope?.isDirty() && !this.saving) {
            this.#saved = structuredClone(value.settings);
            this.draft = structuredClone(value.settings);
            this.loaded = true;
            this.#register();
            this.#scope?.commit(structuredClone(this.#saved));
          }
          this.#changed();
        },
      );
    } catch (error) {
      if (epoch === this.#epoch) this.loadError = codeMessage(codeOf(error));
    }
  }
  #changed(): void {
    this.#scope?.changed();
    this.dispatchEvent(
      new CustomEvent("venue-receipt-draft-changed", {
        detail: { settings: structuredClone(this.draft) },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #edit(field: Field, value: string | boolean | null): void {
    const next = { ...this.draft };
    if (field === "printAddress") {
      if (value === true && this.#saved.printAddress === undefined) delete next.printAddress;
      else next.printAddress = value === true;
    } else if (typeof value === "string" && value !== "") next[field] = value;
    else delete next[field];
    this.draft = next;
    const errors = { ...this.errors };
    delete errors[field];
    this.errors = errors;
    this.actionError = "";
    this.#changed();
  }
  async #save(): Promise<void> {
    if (this.saving || !this.#scope || saveActionState(this.#scope).unchanged) return;
    this.errors = {};
    this.actionError = "";
    this.saving = true;
    const epoch = this.#epoch;
    const scope = this.#scope;
    const submitted = structuredClone(this.draft);
    try {
      await this.api.putVenueReceiptSettings(submitted);
    } catch (error) {
      if (epoch !== this.#epoch) return;
      const params = (error as { params?: { field?: unknown; maxLength?: unknown } })?.params;
      const field =
        codeOf(error) === "image.invalid_file"
          ? "logo"
          : fields.find((name) => name === params?.field);
      const sentence =
        typeof params?.maxLength === "number"
          ? t("receipts.trim_too_long").replace("{max}", String(params.maxLength))
          : codeMessage(codeOf(error));
      this.actionError = sentence;
      if (field) this.errors = { [field]: sentence };
      this.saving = false;
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    if (epoch !== this.#epoch || scope !== this.#scope) return;
    this.#saved = submitted;
    scope.commit(submitted);
    this.#revision++;
    this.saving = false;
    await this.#load();
  }
  override render() {
    const action = saveActionState(this.#scope);
    const marked = Object.keys(this.errors).length > 0;
    return html` ${
      this.loadError
        ? html`<p class="error" role="alert" data-test="defaults-load-error">${this.loadError}</p>
            <wt-button variant="secondary" @click=${() => void this.#load()}
              >${t("location_settings.retry")}</wt-button
            >`
        : nothing
    }
    ${
      this.loaded
        ? html`<div
              class="fields"
              @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=defaults-save]"))}
            >
              <h2>${t("receipts.venue_defaults")}</h2>
              <dashboard-image-upload
                .api=${this.api}
                label=${t("receipts.logo")}
                .image=${this.draft.logo ?? null}
                .draftParent=${this.draftParent ?? this}
                .disabled=${this.saving}
                .invalid=${!!this.errors.logo}
                @image-changed=${(event: CustomEvent<{ image: string | null }>) => {
                  event.stopPropagation();
                  this.#edit("logo", event.detail.image);
                }}
              ></dashboard-image-upload>
              ${this.errors.logo ? html`<p class="error">${this.errors.logo}</p>` : nothing}
              <wt-input
                name="headerSubtitle"
                label=${t("receipts.subtitle")}
                .value=${this.draft.headerSubtitle ?? ""}
                error=${this.errors.headerSubtitle ?? ""}
                ?disabled=${this.saving}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.#edit("headerSubtitle", event.detail.value);
                }}
              ></wt-input>
              <wt-textarea
                name="footerMessage"
                label=${t("receipt.footer_message")}
                .value=${this.draft.footerMessage ?? ""}
                error=${this.errors.footerMessage ?? ""}
                ?disabled=${this.saving}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.#edit("footerMessage", event.detail.value);
                }}
              ></wt-textarea>
              <wt-switch
                name="printAddress"
                label=${t("receipts.print_address")}
                .checked=${this.draft.printAddress !== false}
                ?disabled=${this.saving}
                @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                  event.stopPropagation();
                  this.#edit("printAddress", event.detail.checked);
                }}
              ></wt-switch>
              ${this.errors.printAddress ? html`<p class="error">${this.errors.printAddress}</p>` : nothing}
            </div>
            <wt-form-actions .error=${marked ? t("form.fix_fields") : this.actionError}>
              <wt-button
                data-test="defaults-save"
                variant=${action.variant}
                ?loading=${this.saving}
                ?disabled=${action.unchanged || this.saving}
                @click=${() => void this.#save()}
                >${t("action.save")}</wt-button
              >
            </wt-form-actions>`
        : nothing
    }`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-venue-receipt-defaults-editor": VenueReceiptDefaultsEditor;
  }
}
