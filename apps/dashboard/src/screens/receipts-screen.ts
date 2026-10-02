import { DraftRows, QueryController } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { resolveContentText, type ContentLanguages } from "@waitron/shared";
import { baseStyles, focusFirstInvalid, selectStyles, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-textarea.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import type {
  DashboardApi,
  PrintPaperWidth,
  ReceiptConfig,
  ReceiptLanguage,
  ReceiptPreview,
} from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { dashboardQuery } from "../api/live-queries.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { PrintPaper, paperStyles, type PaperMark } from "../widgets/print-paper.js";
import { receiptLanguageName, receiptLanguageWarning } from "../widgets/receipt-language.js";

/** How long typing must pause before the preview is redrawn with the latest text. */
export const RECEIPT_PREVIEW_QUIET_MS = 300;

type TrimField = "headerSubtitle" | "footerMessage";
const TRIM_FIELDS: readonly TrimField[] = ["headerSubtitle", "footerMessage"];

/**
 * The venue-wide receipt trim and this location's receipt language and invoice operation
 * description, saved by one Save, beside a live preview the server draws as the receipt will print.
 */
@customElement("dashboard-receipts-screen")
export class ReceiptsScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
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
        margin-top: var(--wt-space-5);
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
      .field-value {
        display: block;
        font-weight: var(--wt-font-weight-bold);
      }
      .reason {
        margin: var(--wt-space-1) 0 0;
        max-width: 60ch;
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .warning {
        max-width: 60ch;
        margin: var(--wt-space-2) 0 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-warning);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }
      .use-fixed {
        margin-top: var(--wt-space-2);
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
      .paper-width {
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
  readonly #locationQueries = new QueryController(
    this,
    () => this.api.liveData,
    () => {
      this.locationLoadFailed = true;
    },
  );
  readonly #languageQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.languageLoadFailed = true;
    },
  );
  /** Only for the warning, so a failed read hides the warning and nothing else. */
  readonly #contentQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.contentLanguages = null;
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
  @state() private receiptLanguage: ReceiptLanguage | null = null;
  @state() private languageLoadFailed = false;
  /** A language picked and not yet saved; null while the saved one stands. */
  @state() private pickedLanguage: string | null = null;
  /** The server's refusal of the language, shown under it until it changes or Save is pressed. */
  @state() private languageRefusal = "";
  /** A failed language save that names no field, until the next Save. */
  @state() private languageError: string | null = null;
  @state() private contentLanguages: ContentLanguages | null = null;
  #dirty = false;
  /** Successful description writes so far; a read stamped with an older count may predate the latest one. */
  #saves = 0;

  @state() private attempted = false;
  @state() private saving = false;
  @state() private saved = false;

  @state() private preview: ReceiptPreview | null = null;
  @state() private previewFailed = false;
  @state() private focusedTrim: TrimField | null = null;
  /** The paper width the person chose, kept for every later preview; never saved. */
  @state() private chosenWidth: PrintPaperWidth | null = null;
  #previewTimer: ReturnType<typeof setTimeout> | undefined;
  #previewInFlight = false;
  #previewAgain = false;
  #previewRequested: string | null = null;
  #previewActive = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
    void this.#loadContentLanguages();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.#previewTimer);
    this.#previewAgain = false;
  }

  async #load(): Promise<void> {
    this.receiptLoadError = null;
    this.locationLoadFailed = false;
    this.languageLoadFailed = false;
    await Promise.all([this.#loadReceipt(), this.#loadLocation(), this.#loadLanguage()]);
  }

  async #loadLanguage(): Promise<void> {
    try {
      await this.#languageQueries.watch("getReceiptLanguage", [], (value) => {
        const savedElsewhere =
          this.receiptLanguage !== null && this.receiptLanguage.language !== value.language;
        this.receiptLanguage = value;
        this.languageLoadFailed = false;
        if (savedElsewhere && this.receiptLoaded && this.pickedLanguage === null) {
          this.#previewRequested = null;
          void this.#sendPreview();
        }
      });
    } catch {
      this.languageLoadFailed = true;
    }
  }

  async #loadContentLanguages(): Promise<void> {
    try {
      await this.#contentQueries.watch("getContentLanguages", [], (value) => {
        this.contentLanguages = value;
      });
    } catch {
      this.contentLanguages = null;
    }
  }

  /** The picked language when it differs from the saved one, which a preview and a save then send. */
  #changedLanguage(): string | null {
    const picked = this.pickedLanguage;
    return picked !== null && picked !== this.receiptLanguage?.language ? picked : null;
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
          this.#previewActive = true;
          void this.#sendPreview();
        } else if (changed) this.#schedulePreview();
      });
    } catch (error) {
      this.receiptLoadError = codeOf(error);
    }
  }

  async #loadLocation(): Promise<void> {
    const query = dashboardQuery(this.api, "getLocationSettings", []);
    try {
      await this.#locationQueries.watch(
        "getLocationSettings",
        {
          ...query,
          key: `${query.key}:save-stamped`,
          read: async () => {
            const saves = this.#saves;
            return { saves, value: await query.read() };
          },
        },
        ({ saves, value }) => {
          this.name = value.name;
          if (!this.#dirty && !this.saving && saves === this.#saves)
            this.description = value.operationDescription;
          this.locationLoaded = true;
          this.locationLoadFailed = false;
        },
      );
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

  /**
   * One request at a time; text typed meanwhile is sent once, as it stands, when it returns. Text
   * already asked for at the same width is not asked for again. A preview only another session's save asked for goes
   * through the passive client, so it does not count as this person's activity.
   */
  async #sendPreview(): Promise<void> {
    if (this.#previewInFlight) {
      this.#previewAgain = true;
      return;
    }
    const client = this.#previewActive ? this.api : (this.api.background ?? this.api);
    this.#previewActive = false;
    const config = this.#trim();
    const width = this.chosenWidth;
    const language = this.#changedLanguage();
    const requested = JSON.stringify([config, width, language]);
    if (requested === this.#previewRequested) return;
    this.#previewRequested = requested;
    this.#previewInFlight = true;
    try {
      this.preview = await (language !== null
        ? client.previewReceipt(config, width ?? undefined, language)
        : width === null
          ? client.previewReceipt(config)
          : client.previewReceipt(config, width));
      this.previewFailed = false;
    } catch {
      this.previewFailed = true;
      this.#previewRequested = null;
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
    this.#previewActive = true;
    this.#schedulePreview();
  }

  #chooseWidth(width: PrintPaperWidth): void {
    this.chosenWidth = width;
    this.#previewActive = true;
    void this.#sendPreview();
  }

  #pickLanguage(language: string): void {
    this.pickedLanguage = language === this.receiptLanguage!.language ? null : language;
    this.languageRefusal = "";
    this.saved = false;
    this.#previewActive = true;
    void this.#sendPreview();
  }

  #languageRefused(error: unknown): void {
    const code = codeOf(error);
    const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
    if (field === "receiptLanguage")
      this.languageRefusal =
        code === "management.request_invalid" ? t("receipts.language_invalid") : codeMessage(code);
    else this.languageError = code;
  }

  /** Whether the language was saved; a refusal is shown where it belongs. */
  async #sendLanguage(language: string): Promise<boolean> {
    try {
      await this.api.putReceiptLanguage(language);
    } catch (error) {
      this.#languageRefused(error);
      return false;
    }
    this.receiptLanguage = { ...this.receiptLanguage!, language };
    this.pickedLanguage = null;
    return true;
  }

  async #useFixedLanguage(locale: string): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.saved = false;
    this.languageRefusal = "";
    this.languageError = null;
    await this.#sendLanguage(locale);
    this.saving = false;
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
    this.languageRefusal = "";
    this.languageError = null;
    if (this.#validate() !== "") {
      await this.updateComplete;
      await focusFirstInvalid(this.#form());
      return;
    }
    this.saving = true;
    // Sent alone and first, so a refused language never leaves the other settings saved without it.
    const language = this.#changedLanguage();
    if (language !== null && !(await this.#sendLanguage(language))) {
      this.saving = false;
      await this.updateComplete;
      await focusFirstInvalid(this.#form());
      return;
    }
    const [trim, location] = await Promise.allSettled([
      this.api.putReceipt(this.#trim()),
      this.api.putLocationSettings(this.description),
    ]);
    this.saving = false;
    if (trim.status === "rejected") this.#receiptRefused(trim.reason);
    if (location.status === "rejected") this.#locationRefused(location.reason);
    else {
      this.#dirty = false;
      this.#saves += 1;
    }
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

  #blurTrim(): void {
    this.focusedTrim = null;
  }

  #renderFooter(): TemplateResult {
    const error = this.trimRefusals.footerMessage ?? "";
    return html`<wt-textarea
      name="footerMessage"
      data-test="footer-message"
      rows="3"
      label=${t("receipt.footer_message")}
      hint=${t("receipts.footer_message_hint")}
      .value=${this.footerMessage}
      error=${error}
      ?disabled=${this.saving}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.#changeTrim("footerMessage", event.detail.value);
      }}
      @focusin=${() => this.#focusTrim("footerMessage")}
      @focusout=${() => this.#blurTrim()}
    ></wt-textarea>`;
  }

  #renderWarning(language: string): TemplateResult | typeof nothing {
    return this.contentLanguages === null
      ? nothing
      : receiptLanguageWarning(language, this.contentLanguages);
  }

  #renderLanguage(receiptLanguage: ReceiptLanguage): TemplateResult {
    const error = this.languageRefusal;
    const errorLine =
      error !== ""
        ? html`<span id="receipt-language-error" class="field-error">${error}</span>`
        : nothing;
    const { fixed, language: stored } = receiptLanguage;
    if (fixed !== null) {
      const fixedName = receiptLanguageName(fixed.locale, false);
      return html`<div data-test="receipt-language">
        <span class="field-label">${t("receipts.language")}</span>
        <span class="field-value" data-test="receipt-language-value"
          >${receiptLanguageName(stored)}</span
        >
        ${errorLine}
        <p class="reason" data-test="receipt-language-reason">
          ${resolveContentText(fixed.reason, currentLocale(), "en")}
        </p>
        ${
          stored === fixed.locale
            ? nothing
            : html`<p class="warning" role="note" data-test="receipt-language-stored">
                  ${t("receipts.language_stored")
                    .replace("{stored}", receiptLanguageName(stored, false))
                    .replace("{fixed}", fixedName)}
                </p>
                <wt-button
                  class="use-fixed"
                  data-test="use-fixed-language"
                  variant="secondary"
                  ?disabled=${this.saving}
                  @click=${() => void this.#useFixedLanguage(fixed.locale)}
                  >${t("receipts.language_use").replace("{fixed}", fixedName)}</wt-button
                >`
        }
        ${this.#renderWarning(stored)}
      </div>`;
    }
    const chosen = this.pickedLanguage ?? stored;
    const offered = receiptLanguage.choices.includes(stored)
      ? receiptLanguage.choices
      : [...receiptLanguage.choices, stored];
    return html`<div data-test="receipt-language">
      <label>
        <span class="field-label">${t("receipts.language")}</span>
        <select
          name="receiptLanguage"
          aria-invalid=${error !== "" ? "true" : "false"}
          aria-describedby=${ifDefined(error !== "" ? "receipt-language-error" : undefined)}
          ?disabled=${this.saving}
          @change=${(event: Event) => this.#pickLanguage((event.target as HTMLSelectElement).value)}
        >
          ${offered.map(
            (language) =>
              html`<option value=${language} .selected=${language === chosen}>
                ${receiptLanguageName(language)}
              </option>`,
          )}
        </select>
      </label>
      ${errorLine} ${this.#renderWarning(chosen)}
    </div>`;
  }

  #renderForm(): TemplateResult {
    const descriptionError = this.#descriptionError();
    const marked =
      descriptionError !== "" ||
      this.languageRefusal !== "" ||
      this.trimRefusals.headerSubtitle !== undefined ||
      this.trimRefusals.footerMessage !== undefined;
    const bottom = [
      this.languageError === null
        ? ""
        : `${t("receipts.language_save_error")} ${codeMessage(this.languageError)}`,
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
          @focusout=${() => this.#blurTrim()}
          @keydown=${(event: KeyboardEvent) => this.#enter(event)}
        ></wt-input>
        ${this.#renderFooter()}
      </section>
      <section class="settings" aria-labelledby="location-heading">
        <h2 id="location-heading" data-test="location-name">${this.name}</h2>
        ${this.#renderLanguage(this.receiptLanguage!)}
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

  #renderWidth(preview: ReceiptPreview): TemplateResult {
    const chosen = this.chosenWidth ?? preview.paperWidth;
    return html`<wt-combobox
      class="paper-width"
      name="paperWidth"
      search="auto"
      label=${t("printers.paper_width")}
      .options=${preview.paperWidths.map((width) => ({
        value: width,
        label: t(width === "58mm" ? "printers.paper_width_58" : "printers.paper_width_80"),
      }))}
      .value=${chosen}
      @wt-change=${(event: CustomEvent<{ value: string }>) =>
        this.#chooseWidth(event.detail.value as PrintPaperWidth)}
    ></wt-combobox>`;
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
      ${preview && preview.paperWidths.length > 1 ? this.#renderWidth(preview) : nothing}
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
      ${
        this.locationLoadFailed || this.languageLoadFailed
          ? html`<p role="alert">${t("location_settings.load_error")}</p>`
          : nothing
      }
      ${
        this.locationLoadFailed || this.languageLoadFailed || this.receiptLoadError !== null
          ? html`<wt-button data-test="retry" @click=${() => void this.#load()}
              >${t("location_settings.retry")}</wt-button
            >`
          : nothing
      }
      ${
        this.receiptLoaded && this.locationLoaded && this.receiptLanguage !== null
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
