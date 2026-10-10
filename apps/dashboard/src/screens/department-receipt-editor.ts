import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  isValidTelephone,
  resolveReceiptTrim,
  type DepartmentReceiptConfig,
  type VenueReceiptSettings,
} from "@waitron/shared";
import {
  baseStyles,
  draftScopeFor,
  saveActionState,
  focusFirstInvalid,
  submitOnEnter,
  type DraftScope,
} from "@waitron/ui";
import { QueryController } from "@waitron/dashboard-kit";
import type { DashboardApi, DepartmentReceiptSettings } from "../api/client.js";
import { dashboardQuery } from "../api/live-queries.js";
import { sameValue } from "../widgets/product-editor-model.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import "../widgets/image-upload.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-textarea.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-button.js";

type Field = "phone" | "email" | "logo" | "headerSubtitle" | "footerMessage";
function receiptBody(receipt: DepartmentReceiptConfig): DepartmentReceiptConfig {
  const body = structuredClone(receipt);
  for (const field of ["phone", "email"] as const) {
    const value = receipt[field]?.trim() ?? "";
    if (value) body[field] = value;
    else delete body[field];
  }
  return body;
}
const fields: readonly Field[] = ["phone", "email", "logo", "headerSubtitle", "footerMessage"];

@customElement("dashboard-department-receipt-editor")
export class DepartmentReceiptEditor extends LitElement {
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
      h2,
      h3 {
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
  @property() departmentId = "";
  @property() departmentName = "";
  @property() receiptLanguage = "";
  @property({ attribute: false }) venueDefaults?: VenueReceiptSettings;
  @property({ attribute: false }) draftParent?: object;
  @state() private settings: DepartmentReceiptSettings | null = null;
  @state() private draft: DepartmentReceiptConfig = {};
  @state() private saving = false;
  @state() private attempted = false;
  @state() private loadError = "";
  @state() private actionError = "";
  @state() private errors: Partial<Record<string, string>> = {};
  #saved: DepartmentReceiptConfig = {};
  #scope?: DraftScope<DepartmentReceiptConfig>;
  #identity = {};
  #context = "";
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
    if (this.settings !== null) {
      this.#register();
      this.requestUpdate();
      void this.#load();
    }
  }
  override disconnectedCallback(): void {
    this.#epoch++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.saving = false;
    super.disconnectedCallback();
  }
  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("departmentId") && this.departmentId !== this.#context) {
      this.#epoch++;
      this.#queries.release("receipt");
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#identity = {};
      this.#context = this.departmentId;
      this.#revision = 0;
      this.settings = null;
      this.draft = {};
      this.#saved = {};
      this.actionError = "";
      this.errors = {};
      this.attempted = false;
      this.saving = false;
      if (this.isConnected && this.departmentId) void this.#load();
    }
  }
  #register(): void {
    if (this.#scope || !this.isConnected) return;
    this.#scope = draftScopeFor<DepartmentReceiptConfig>(this, {
      id: this.#identity,
      parent: this.draftParent ?? this,
      current: () => this.draft,
      snapshot: (value) => structuredClone(value),
      equal: (a, b) => sameValue(receiptBody(a), receiptBody(b)),
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
    const query = dashboardQuery(this.api, "getDepartmentReceipt", [this.departmentId]);
    try {
      await this.#queries.watch(
        "receipt",
        {
          ...query,
          key: `${query.key}:revision-${revision}`,
          read: async () => ({ revision: this.#revision, value: await query.read() }),
        },
        ({ revision: readRevision, value }) => {
          if (epoch !== this.#epoch || readRevision !== this.#revision) return;
          const dirty = this.#scope?.isDirty() ?? false;
          this.settings = value;
          this.loadError = "";
          if (!dirty && !this.saving) {
            const baselineChanged = !sameValue(this.#saved, value.receipt);
            this.#saved = structuredClone(value.receipt);
            this.draft = structuredClone(value.receipt);
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
    this.#publish();
  }
  #publish(): void {
    this.dispatchEvent(
      new CustomEvent("receipt-draft-changed", {
        detail: { departmentId: this.departmentId, receipt: structuredClone(this.draft) },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #edit(field: Field, value: string | null, language?: string): void {
    const next = structuredClone(this.draft);
    if (field === "headerSubtitle" || field === "footerMessage") {
      const map = { ...next[field], [language!]: value ?? "" };
      if (value === "" && this.#saved[field]?.[language!] === undefined) delete map[language!];
      if (Object.keys(map).length) next[field] = map;
      else delete next[field];
    } else if (!value) delete next[field];
    else next[field] = value;
    this.draft = next;
    const errors = { ...this.errors };
    const key = language ? `${field}-${language}` : field;
    if (errors[key]) this.actionError = "";
    delete errors[key];
    this.errors = errors;
    this.#changed();
  }
  #contactProblem(field: "phone" | "email"): string {
    const value = (this.draft[field] ?? "").trim();
    if (!value) return "";
    const max = field === "phone" ? 30 : 254;
    if (value.length > max) return t("receipts.trim_too_long").replace("{max}", String(max));
    return field === "phone"
      ? isValidTelephone(value)
        ? ""
        : t("receipts.invalid_phone")
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        ? ""
        : t("receipts.invalid_email");
  }
  #contactError(field: "phone" | "email"): string {
    return (this.attempted ? this.#contactProblem(field) : "") || this.errors[field] || "";
  }
  async #save(): Promise<void> {
    if (this.saving || !this.#scope || saveActionState(this.#scope).unchanged) return;
    this.attempted = true;
    this.actionError = "";
    this.errors = {};
    if (this.#contactProblem("phone") || this.#contactProblem("email")) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.saving = true;
    const epoch = this.#epoch;
    const id = this.departmentId;
    const submitted = structuredClone(this.draft);
    const scope = this.#scope;
    try {
      await this.api.putDepartmentReceipt(id, receiptBody(submitted));
    } catch (error) {
      if (epoch !== this.#epoch) return;
      const params = (
        error as {
          params?: { field?: unknown; language?: unknown; reason?: unknown; maxLength?: unknown };
        }
      )?.params;
      const field = fields.find((name) => name === params?.field);
      const language =
        typeof params?.language === "string" && this.settings?.languages.includes(params.language)
          ? params.language
          : undefined;
      const sentence =
        params?.reason === "invalid_phone"
          ? t("receipts.invalid_phone")
          : params?.reason === "invalid_email"
            ? t("receipts.invalid_email")
            : typeof params?.maxLength === "number"
              ? t("receipts.trim_too_long").replace("{max}", String(params.maxLength))
              : codeMessage(codeOf(error));
      this.actionError = sentence;
      if (field && ((field !== "headerSubtitle" && field !== "footerMessage") || language)) {
        this.errors = { [language ? `${field}-${language}` : field]: sentence };
      }
      this.saving = false;
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    if (epoch !== this.#epoch || scope !== this.#scope) return;
    this.#saved = submitted;
    scope.commit(submitted);
    this.attempted = false;
    this.#revision++;
    this.saving = false;
    await this.#load();
  }
  #hint(field: "headerSubtitle" | "footerMessage", language: string): string {
    if ((this.draft[field]?.[language] ?? "").trim()) return "";
    return (
      resolveReceiptTrim(
        this.draft,
        this.venueDefaults ?? this.settings!.venueDefaults,
        language,
        this.receiptLanguage,
      )[field] ?? ""
    );
  }
  #text(field: "headerSubtitle" | "footerMessage", language: string) {
    const name = `${field}-${language}`;
    const label = t(field === "headerSubtitle" ? "receipts.subtitle" : "receipt.footer_message");
    const value = this.draft[field]?.[language] ?? "";
    const error = this.errors[name] ?? "";
    const change = (event: CustomEvent<{ value: string }>) => {
      event.stopPropagation();
      this.#edit(field, event.detail.value, language);
    };
    return field === "headerSubtitle"
      ? html`<wt-input
          name=${name}
          label=${label}
          .value=${value}
          hint=${this.#hint(field, language)}
          error=${error}
          ?disabled=${this.saving}
          @wt-change=${change}
        ></wt-input>`
      : html`<wt-textarea
          name=${name}
          label=${label}
          .value=${value}
          hint=${this.#hint(field, language)}
          error=${error}
          ?disabled=${this.saving}
          @wt-change=${change}
        ></wt-textarea>`;
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
    const settings = this.settings;
    const action = saveActionState(this.#scope);
    const defaults = this.venueDefaults ?? settings?.venueDefaults ?? {};
    const marked = Object.keys(this.errors).length > 0;
    const invalidContact =
      this.attempted && (!!this.#contactProblem("phone") || !!this.#contactProblem("email"));
    const bottom = [
      marked || invalidContact ? t("form.fix_fields") : "",
      marked ? "" : this.actionError,
    ]
      .filter(Boolean)
      .join(" ");
    return html`
      ${
        this.loadError
          ? html`<p class="error" role="alert" data-test="department-load-error">
                ${this.loadError}
              </p>
              <wt-button variant="secondary" @click=${() => void this.#load()}
                >${t("location_settings.retry")}</wt-button
              >`
          : nothing
      }
      ${
        settings
          ? html`<div
                class="fields"
                @focusin=${(event: FocusEvent) => this.#focus(event)}
                @focusout=${() => this.#focus(null)}
                @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=department-save]"))}
              >
                <h2>${this.departmentName}</h2>
                <dashboard-image-upload
                  .api=${this.api}
                  label=${t("receipts.logo")}
                  .image=${this.draft.logo ?? null}
                  .inheritedImage=${defaults.logo ?? null}
                  .draftParent=${this.draftParent ?? this}
                  .disabled=${this.saving}
                  .invalid=${!!this.errors.logo}
                  @image-changed=${(event: CustomEvent<{ image: string | null }>) => {
                    event.stopPropagation();
                    this.#edit("logo", event.detail.image);
                  }}
                ></dashboard-image-upload>
                ${this.errors.logo ? html`<p class="error">${this.errors.logo}</p>` : nothing}
                ${(["phone", "email"] as const).map(
                  (field) =>
                    html`<wt-input
                      name=${field}
                      type=${field === "phone" ? "tel" : "email"}
                      autocomplete="off"
                      label=${t(`receipts.${field}`)}
                      .value=${this.draft[field] ?? ""}
                      hint=${t(`receipts.${field}_hint`)}
                      error=${this.#contactError(field)}
                      ?disabled=${this.saving}
                      @wt-change=${(event: CustomEvent<{ value: string }>) => {
                        event.stopPropagation();
                        this.#edit(field, event.detail.value);
                      }}
                    ></wt-input>`,
                )}
                ${settings.languages.map(
                  (language) =>
                    html`<h3 lang=${language}>${language}</h3>
                      ${this.#text("headerSubtitle", language)}${this.#text("footerMessage", language)}`,
                )}
              </div>
              <wt-form-actions .error=${bottom}
                ><wt-button
                  data-test="department-save"
                  variant=${action.variant}
                  ?loading=${this.saving}
                  ?disabled=${action.unchanged || this.saving || (this.attempted && (!!this.#contactProblem("phone") || !!this.#contactProblem("email")))}
                  @click=${() => void this.#save()}
                  >${t("action.save")}</wt-button
                ></wt-form-actions
              >`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-department-receipt-editor": DepartmentReceiptEditor;
  }
}
