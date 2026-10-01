import { DraftRows } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid, submitOnEnter, visuallyHiddenStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import type { DashboardApi, ReceiptConfig, ReceiptPreview } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { PrintPaper, paperStyles, type PaperMark } from "../widgets/print-paper.js";

/** How long typing must pause before the preview is redrawn with the latest text. */
export const RECEIPT_PREVIEW_QUIET_MS = 300;

type TrimField = "headerSubtitle" | "footerMessage";
const TRIM_FIELDS: readonly TrimField[] = ["headerSubtitle", "footerMessage"];

/**
 * The venue-wide receipt trim and this location's invoice operation description, saved by one Save,
 * beside a live preview the server draws as the receipt will print. The footer is a native
 * `<textarea>` because `wt-input` has no multiline form.
 */
@customElement("dashboard-receipts-screen")
export class ReceiptsScreen extends LitElement {
  static override styles = [
    baseStyles,
    paperStyles,
    css`
      :host {
        display: block;
      }
      .layout {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--wt-space-6);
      }
      .form {
        flex: 1 1 calc(var(--wt-tap-min) * 7);
        max-width: var(--wt-form-max-width);
      }
      h1 {
        margin: 0 0 var(--wt-space-6);
        font-size: var(--wt-font-size-xl);
      }
      .settings {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }
      .settings + .settings {
        margin-top: var(--wt-space-6);
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        text-transform: uppercase;
        color: var(--wt-color-text-muted);
      }
      .field-label {
        display: block;
        margin-bottom: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      textarea {
        box-sizing: border-box;
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        resize: vertical;
      }
      textarea::placeholder {
        color: var(--wt-color-text-muted);
      }
      textarea[aria-invalid="true"] {
        border-color: var(--wt-color-danger);
      }
      textarea:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .hint {
        ${visuallyHiddenStyles}
      }
      .field-error {
        display: block;
        margin-top: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-danger);
      }
      wt-form-actions {
        margin-top: var(--wt-space-4);
      }
      .preview {
        flex: 0 1 auto;
        min-width: 0;
        max-width: 100%;
      }
      .preview h2 {
        margin-bottom: var(--wt-space-3);
      }
      .paper-viewport {
        overflow-x: auto;
      }
      .paper-viewport:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .preview-error {
        margin: 0 0 var(--wt-space-2);
        color: var(--wt-color-text-muted);
      }
      .not-printed {
        margin-top: var(--wt-space-4);
      }
      .not-printed h3 {
        margin: 0;
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .not-printed p {
        margin: var(--wt-space-1) 0 0;
        overflow-wrap: anywhere;
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;

  readonly #draft = new DraftRows<{ id: string; headerSubtitle: string; footerMessage: string }>();
  readonly #receiptQueries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.receiptLoadError = codeOf(error);
    },
  );
  readonly #locationQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.locationLoadFailed = true;
    },
  );
  readonly #paper = new PrintPaper();

  @state() private headerSubtitle = "";
  @state() private footerMessage = "";
  @state() private receiptLoaded = false;
  @state() private receiptLoadError: string | null = null;
  /** The receipt trim's refusal that names no field shown, until the next Save. */
  @state() private errorKey: string | null = null;
  /** The receipt trim's refusals naming a field, each shown until that field changes. */
  @state() private trimRefusals: Partial<Record<TrimField, string>> = {};

  @state() private name = "";
  @state() private description = "";
  @state() private locationLoaded = false;
  @state() private locationLoadFailed = false;
  /** The server's refusal of the description, shown until the field changes. */
  @state() private refusal = "";
  @state() private saveFailed = false;
  #dirty = false;

  @state() private attempted = false;
  @state() private saving = false;
  @state() private saved = false;

  @state() private preview: ReceiptPreview | null = null;
  @state() private previewFailed = false;
  @state() private focusedTrim: TrimField | null = null;
  #previewTimer: ReturnType<typeof setTimeout> | undefined;
  #previewInFlight = false;
  #previewAgain = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.#previewTimer);
    this.#previewAgain = false;
  }

  async #load(): Promise<void> {
    this.receiptLoadError = null;
    this.locationLoadFailed = false;
    await Promise.all([this.#loadReceipt(), this.#loadLocation()]);
  }

  async #loadReceipt(): Promise<void> {
    try {
      await this.#receiptQueries.watch("getReceipt", [], ({ receipt }) => {
        const [merged] = this.#draft.merge(
          [
            {
              id: "receipt",
              headerSubtitle: this.headerSubtitle,
              footerMessage: this.footerMessage,
            },
          ],
          [
            {
              id: "receipt",
              headerSubtitle: receipt.headerSubtitle ?? "",
              footerMessage: receipt.footerMessage ?? "",
            },
          ],
        );
        const changed =
          merged!.headerSubtitle !== this.headerSubtitle ||
          merged!.footerMessage !== this.footerMessage;
        this.headerSubtitle = merged!.headerSubtitle;
        this.footerMessage = merged!.footerMessage;
        this.receiptLoadError = null;
        if (!this.receiptLoaded) {
          this.receiptLoaded = true;
          void this.#sendPreview();
        } else if (changed) this.#schedulePreview();
      });
    } catch (error) {
      this.receiptLoadError = codeOf(error);
    }
  }

  async #loadLocation(): Promise<void> {
    try {
      await this.#locationQueries.watch("getLocationSettings", [], (value) => {
        this.name = value.name;
        if (!this.#dirty && !this.saving) this.description = value.operationDescription;
        this.locationLoaded = true;
        this.locationLoadFailed = false;
      });
    } catch {
      this.locationLoadFailed = true;
    }
  }

  /** What a save sends: each text trimmed, a blank one left out. */
  #trim(): ReceiptConfig {
    const config: ReceiptConfig = {};
    const header = this.headerSubtitle.trim();
    const footer = this.footerMessage.trim();
    if (header !== "") config.headerSubtitle = header;
    if (footer !== "") config.footerMessage = footer;
    return config;
  }

  #schedulePreview(): void {
    clearTimeout(this.#previewTimer);
    this.#previewTimer = setTimeout(() => void this.#sendPreview(), RECEIPT_PREVIEW_QUIET_MS);
  }

  /** One request at a time; text typed meanwhile is sent once, as it stands, when it returns. */
  async #sendPreview(): Promise<void> {
    if (this.#previewInFlight) {
      this.#previewAgain = true;
      return;
    }
    this.#previewInFlight = true;
    try {
      this.preview = await this.api.previewReceipt(this.#trim());
      this.previewFailed = false;
    } catch {
      this.previewFailed = true;
    } finally {
      this.#previewInFlight = false;
    }
    if (this.#previewAgain) {
      this.#previewAgain = false;
      void this.#sendPreview();
    }
  }

  #changeTrim(field: TrimField, value: string): void {
    this[field] = value;
    const refusals = { ...this.trimRefusals };
    delete refusals[field];
    this.trimRefusals = refusals;
    this.saved = false;
    this.#schedulePreview();
  }

  #validate(): string {
    return this.description.trim() === "" ? t("location_settings.required") : "";
  }

  #descriptionError(): string {
    return (this.attempted ? this.#validate() : "") || this.refusal;
  }

  #form(): HTMLElement {
    return this.shadowRoot!.querySelector<HTMLElement>(".form")!;
  }

  #receiptRefused(error: unknown): void {
    const params = (error as { params?: { field?: unknown; maxLength?: unknown } } | null)?.params;
    const field = TRIM_FIELDS.find((each) => each === params?.field);
    if (codeOf(error) === "receipt.invalid" && field !== undefined) {
      this.trimRefusals = {
        ...this.trimRefusals,
        [field]:
          typeof params?.maxLength === "number"
            ? t("receipts.trim_too_long").replace("{max}", String(params.maxLength))
            : codeMessage("receipt.invalid"),
      };
    } else this.errorKey = codeOf(error);
  }

  #locationRefused(error: unknown): void {
    const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
    if (codeOf(error) === "management.request_invalid" && field === "operationDescription")
      this.refusal = t("location_settings.invalid");
    else this.saveFailed = true;
  }

  async #save(): Promise<void> {
    if (this.saving) return;
    this.saved = false;
    this.saveFailed = false;
    this.errorKey = null;
    this.trimRefusals = {};
    this.attempted = true;
    this.refusal = "";
    if (this.#validate() !== "") {
      await this.updateComplete;
      await focusFirstInvalid(this.#form());
      return;
    }
    this.saving = true;
    const [trim, location] = await Promise.allSettled([
      this.api.putReceipt(this.#trim()),
      this.api.putLocationSettings(this.description),
    ]);
    this.saving = false;
    if (trim.status === "rejected") this.#receiptRefused(trim.reason);
    if (location.status === "rejected") this.#locationRefused(location.reason);
    else this.#dirty = false;
    if (trim.status === "fulfilled" && location.status === "fulfilled") {
      this.saved = true;
      this.attempted = false;
    }
    if (this.refusal !== "" || Object.keys(this.trimRefusals).length > 0) {
      await this.updateComplete;
      await focusFirstInvalid(this.#form());
    }
  }

  #enter(event: KeyboardEvent): void {
    submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"));
  }

  #focusTrim(field: TrimField): void {
    this.focusedTrim = field;
  }

  #blurTrim(field: TrimField): void {
    if (this.focusedTrim === field) this.focusedTrim = null;
  }

  #renderFooter(): TemplateResult {
    const error = this.trimRefusals.footerMessage ?? "";
    return html`<div>
      <label>
        <span class="field-label">${t("receipt.footer_message")}</span>
        <textarea
          name="footerMessage"
          data-test="footer-message"
          rows="3"
          placeholder=${t("receipts.footer_message_hint")}
          aria-invalid=${error !== "" ? "true" : "false"}
          aria-describedby=${error !== "" ? "footer-message-hint footer-message-error" : "footer-message-hint"}
          .value=${this.footerMessage}
          ?disabled=${this.saving}
          @input=${(event: Event) => {
            event.stopPropagation();
            this.#changeTrim("footerMessage", (event.target as HTMLTextAreaElement).value);
          }}
          @focus=${() => this.#focusTrim("footerMessage")}
          @blur=${() => this.#blurTrim("footerMessage")}
        ></textarea>
      </label>
      <span id="footer-message-hint" class="hint">${t("receipts.footer_message_hint")}</span>
      ${error !== "" ? html`<span id="footer-message-error" class="field-error">${error}</span>` : nothing}
    </div>`;
  }

  #renderForm(): TemplateResult {
    const descriptionError = this.#descriptionError();
    const marked =
      descriptionError !== "" ||
      this.trimRefusals.headerSubtitle !== undefined ||
      this.trimRefusals.footerMessage !== undefined;
    const bottom = [
      this.errorKey === null
        ? ""
        : `${t("receipts.trim_save_error")} ${codeMessage(this.errorKey)}`,
      this.saveFailed ? t("location_settings.save_error") : "",
      marked ? t("form.fix_fields") : "",
    ]
      .filter(Boolean)
      .join(" ");
    return html`<div class="form">
      <section class="settings" aria-labelledby="venue-wide-heading">
        <h2 id="venue-wide-heading">${t("receipts.venue_wide")}</h2>
        <wt-input
          name="headerSubtitle"
          data-test="header-subtitle"
          autocomplete="off"
          label=${t("receipt.header_subtitle")}
          hint=${t("receipts.header_subtitle_hint")}
          .value=${this.headerSubtitle}
          error=${this.trimRefusals.headerSubtitle ?? ""}
          ?disabled=${this.saving}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#changeTrim("headerSubtitle", event.detail.value);
          }}
          @focusin=${() => this.#focusTrim("headerSubtitle")}
          @focusout=${() => this.#blurTrim("headerSubtitle")}
          @keydown=${(event: KeyboardEvent) => this.#enter(event)}
        ></wt-input>
        ${this.#renderFooter()}
      </section>
      <section class="settings" aria-labelledby="location-heading">
        <h2 id="location-heading" data-test="location-name">${this.name}</h2>
        <wt-input
          name="operationDescription"
          autocomplete="off"
          required
          label=${t("location_settings.description")}
          hint=${t("receipts.operation_description_hint")}
          .value=${this.description}
          error=${descriptionError}
          ?invalid=${descriptionError !== ""}
          ?disabled=${this.saving}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.description = event.detail.value;
            this.#dirty = true;
            this.refusal = "";
            this.saved = false;
          }}
          @keydown=${(event: KeyboardEvent) => this.#enter(event)}
        >
          <wt-help-tooltip slot="help" aria-label=${t("location_settings.help_label")}
            >${t("location_settings.help")}</wt-help-tooltip
          >
        </wt-input>
      </section>
      ${this.saved ? html`<p role="status">${t("receipts.saved")}</p>` : nothing}
      <wt-form-actions .error=${bottom}
        ><wt-button
          data-test="save"
          variant="primary"
          ?loading=${this.saving}
          ?disabled=${this.saving || (this.attempted && this.#validate() !== "")}
          @click=${() => void this.#save()}
          >${t("action.save")}</wt-button
        ></wt-form-actions
      >
    </div>`;
  }

  #renderPreview(): TemplateResult {
    const preview = this.preview;
    const marks: PaperMark[] = [];
    for (const name of TRIM_FIELDS) {
      const range = preview?.marks[name];
      if (range) marks.push({ name, range, active: this.focusedTrim === name });
    }
    return html`<div class="preview">
      <h2>${t("receipts.preview")}</h2>
      ${
        this.previewFailed
          ? html`<p class="preview-error" data-test="preview-error">
              ${t("receipts.preview_error")}
            </p>`
          : nothing
      }
      ${
        preview
          ? html`<div
              class="paper-viewport"
              tabindex="0"
              role="region"
              aria-label=${t("receipts.preview_paper")}
            >
              ${this.#paper.render(preview.preview, marks)}
            </div>`
          : nothing
      }
      <section class="not-printed" data-test="not-printed" aria-labelledby="not-printed-heading">
        <h3 id="not-printed-heading">${t("receipts.not_printed")}</h3>
        <p>${this.description}</p>
      </section>
    </div>`;
  }

  override render(): TemplateResult {
    return html`<h1>${t("receipts.title")}</h1>
      ${
        this.receiptLoadError !== null
          ? html`<p role="alert">${codeMessage(this.receiptLoadError)}</p>`
          : nothing
      }
      ${this.locationLoadFailed ? html`<p role="alert">${t("location_settings.load_error")}</p>` : nothing}
      ${
        this.locationLoadFailed || this.receiptLoadError !== null
          ? html`<wt-button data-test="retry" @click=${() => void this.#load()}
              >${t("location_settings.retry")}</wt-button
            >`
          : nothing
      }
      ${
        this.receiptLoaded && this.locationLoaded
          ? html`<div class="layout">${this.#renderForm()} ${this.#renderPreview()}</div>`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-receipts-screen": ReceiptsScreen;
  }
}
