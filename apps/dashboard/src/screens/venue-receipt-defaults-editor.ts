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

function settingsBody(settings: VenueReceiptSettings): VenueReceiptSettings {
  const body = { ...settings };
  for (const field of ["headerSubtitle", "footerMessage"] as const) {
    const value = settings[field]?.trim() ?? "";
    if (value) body[field] = value;
    else delete body[field];
  }
  return body;
}

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
  @property({ attribute: false }) venueAddress: string[] = [];
  @state() private draft: VenueReceiptSettings = {};
  @state() private loaded = false;
  @state() private saving = false;
  @state() private saved = false;
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
      equal: (a, b) => sameValue(settingsBody(a), settingsBody(b)),
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
          if (!this.saving) {
            const saved = { ...this.#saved };
            const draft = { ...this.draft };
            const shownBody = settingsBody(this.draft);
            const savedBody = settingsBody(this.#saved);
            for (const field of fields) {
              if (this.loaded && !sameValue(shownBody[field], savedBody[field])) continue;
              delete saved[field];
              delete draft[field];
              Object.assign(
                saved,
                field in value.settings ? { [field]: value.settings[field] } : {},
              );
              Object.assign(
                draft,
                field in value.settings ? { [field]: value.settings[field] } : {},
              );
            }
            const baselineChanged = !sameValue(this.#saved, saved);
            this.#saved = saved;
            this.draft = draft;
            this.loaded = true;
            this.#register();
            if (baselineChanged) this.#scope?.commit(structuredClone(this.#saved));
          }
          this.#publish();
        },
      );
    } catch (error) {
      if (epoch === this.#epoch) this.loadError = codeMessage(codeOf(error));
    }
  }
  #changed(): void {
    this.#scope?.changed();
    this.#publish(true);
  }
  #publish(active = false): void {
    this.dispatchEvent(
      new CustomEvent("venue-receipt-draft-changed", {
        detail: { settings: settingsBody(this.draft), active },
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
    this.saved = false;
    const errors = { ...this.errors };
    if (errors[field]) this.actionError = "";
    delete errors[field];
    this.errors = errors;
    this.#changed();
  }
  async #save(): Promise<void> {
    if (this.saving || !this.#scope || saveActionState(this.#scope).unchanged) return;
    this.errors = {};
    this.actionError = "";
    this.saved = false;
    this.saving = true;
    const epoch = this.#epoch;
    const scope = this.#scope;
    const submitted = structuredClone(this.draft);
    try {
      await this.api.putVenueReceiptSettings(settingsBody(submitted));
    } catch (error) {
      if (epoch !== this.#epoch) return;
      const params = (
        error as { params?: { field?: unknown; maxLength?: unknown; reason?: unknown } }
      )?.params;
      const field =
        codeOf(error) === "image.invalid_file"
          ? "logo"
          : fields.find((name) => name === params?.field);
      const sentence =
        params?.reason === "invalid_logo"
          ? t("receipts.invalid_logo")
          : params?.reason === "image_not_found"
            ? t("receipts.logo_not_found")
            : typeof params?.maxLength === "number"
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
    this.saved = true;
    await this.#load();
  }
  #focus(event: FocusEvent | null): void {
    const target = event
      ?.composedPath()
      .find(
        (node) =>
          node instanceof HTMLElement &&
          (node.hasAttribute("name") || node.localName === "dashboard-image-upload"),
      ) as HTMLElement | undefined;
    this.dispatchEvent(
      new CustomEvent("receipt-field-focus", {
        detail: {
          field:
            target?.getAttribute("name") ??
            (target?.localName === "dashboard-image-upload" ? "logo" : null),
        },
        bubbles: true,
        composed: true,
      }),
    );
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
              @focusin=${(event: FocusEvent) => this.#focus(event)}
              @focusout=${() => this.#focus(null)}
              @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=defaults-save]"))}
            >
              <h2>${t("receipts.venue_defaults")}</h2>
              <a href="/manage/venue-operations">${t("receipts.departments_zones")}</a>
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
              ${this.errors.logo ? html`<p class="error" data-test="logo-error">${this.errors.logo}</p>` : nothing}
              <wt-input
                data-test="header-subtitle"
                name="headerSubtitle"
                label=${t("receipts.subtitle")}
                hint=${t("receipts.header_subtitle_hint")}
                .value=${this.draft.headerSubtitle ?? ""}
                error=${this.errors.headerSubtitle ?? ""}
                ?disabled=${this.saving}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.#edit("headerSubtitle", event.detail.value);
                }}
              ></wt-input>
              <wt-textarea
                data-test="footer-message"
                name="footerMessage"
                label=${t("receipt.footer_message")}
                hint=${t("receipts.footer_message_hint")}
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
              <p data-test=${this.venueAddress.length ? "venue-address" : "no-address"}>
                ${this.venueAddress.length ? this.venueAddress.map((line, index) => html`${index ? html`<br />` : nothing}${line}`) : t("receipts.no_address")}
              </p>
              ${this.errors.printAddress ? html`<p class="error" data-test="print-address-error">${this.errors.printAddress}</p>` : nothing}
            </div>
            ${this.saved ? html`<p role="status">${t("receipts.saved")}</p>` : nothing}
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
