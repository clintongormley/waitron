import { DraftRows, QueryController } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { isValidTelephone, resolveContentText, type ContentLanguages } from "@waitron/shared";
import { baseStyles, focusFirstInvalid, submitOnEnter, navigationGuardFor } from "@waitron/ui";
import { observeNavigation } from "@waitron/ui/src/navigation-guard.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-textarea.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-switch.js";
import "../widgets/image-upload.js";
import type {
  DashboardApi,
  PrintPaperWidth,
  ReceiptConfig,
  ReceiptLanguage,
  ReceiptMarkName,
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

type TextField = "headerSubtitle" | "footerMessage" | "phone" | "email";
const TEXT_FIELDS: readonly TextField[] = ["headerSubtitle", "footerMessage", "phone", "email"];
type TrimField = TextField | "printAddress" | "logo";
const TRIM_FIELDS: readonly TrimField[] = [...TEXT_FIELDS, "printAddress", "logo"];
const MARK_NAMES: readonly ReceiptMarkName[] = [
  "logo",
  "headerSubtitle",
  "address",
  "phone",
  "email",
  "footerMessage",
];

type Trim = Record<TextField, string> & { printAddress: boolean; logo: string | null };

const MAX_LENGTH = { phone: 30, email: 254 } as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Why a save would refuse this trimmed phone or email; "" when it would not, blank included. */
function contactProblem(field: "phone" | "email", value: string): string {
  if (value === "") return "";
  if (value.length > MAX_LENGTH[field]) {
    return t("receipts.trim_too_long").replace("{max}", String(MAX_LENGTH[field]));
  }
  if (field === "phone") return isValidTelephone(value) ? "" : t("receipts.invalid_phone");
  return EMAIL.test(value) ? "" : t("receipts.invalid_email");
}

/** The field a `receipt.invalid` names, if it is one this page shows. */
function refusedField(error: unknown): TrimField | undefined {
  if (codeOf(error) !== "receipt.invalid") return undefined;
  const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
  return TRIM_FIELDS.find((each) => each === field);
}

/** The sentence under the field a refused save names. */
function refusalSentence(error: unknown): string {
  const params = (error as { params?: { reason?: unknown; maxLength?: unknown } } | null)?.params;
  if (typeof params?.maxLength === "number") {
    return t("receipts.trim_too_long").replace("{max}", String(params.maxLength));
  }
  switch (params?.reason) {
    case "invalid_phone":
      return t("receipts.invalid_phone");
    case "invalid_email":
      return t("receipts.invalid_email");
    case "invalid_logo":
      return t("receipts.invalid_logo");
    case "image_not_found":
      return t("receipts.logo_not_found");
    default:
      return codeMessage(codeOf(error));
  }
}

/**
 * The venue-wide receipt trim and this location's receipt language and invoice operation
 * description, saved by one Save, beside a live preview the server draws as the receipt will print.
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
      .error {
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-danger);
      }
      .address .reason {
        margin-top: var(--wt-space-2);
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

  readonly #draft = new DraftRows<Trim & { id: string }>();
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
  readonly #languageQueries = new QueryController(
    this,
    () => this.api.liveData,
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
  @state() private phone = "";
  @state() private email = "";
  @state() private printAddress = true;
  @state() private logo: string | null = null;
  /** This location's address as a receipt prints it, shown under the switch. */
  @state() private venueAddress: string[] = [];
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
  /** A failed language save's sentence for the bottom message, until the next Save. */
  @state() private languageError: string | null = null;
  @state() private contentLanguages: ContentLanguages | null = null;
  #dirty = false;
  /** Successful description writes so far; a read stamped with an older count may predate the latest one. */
  #saves = 0;
  /** The same, for this page's receipt-language writes. */
  #languageSaves = 0;

  @state() private attempted = false;
  @state() private saving = false;
  @state() private saved = false;

  @state() private preview: ReceiptPreview | null = null;
  @state() private departments: { id: string; name: string }[] = [];
  @state() private previewDepartmentId: string | null = null;
  #departmentsLoaded = false;
  @state() private previewFailed = false;
  @state() private focusedTrim: ReceiptMarkName | null = null;
  /** The paper width the person chose, kept for every later preview; never saved. */
  @state() private chosenWidth: PrintPaperWidth | null = null;
  #previewTimer: ReturnType<typeof setTimeout> | undefined;
  #previewInFlight = false;
  #previewAgain = false;
  #previewRequested: string | null = null;
  #previewActive = false;

  #stopNavigation?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
    void this.#loadDepartments();
    void this.#loadContentLanguages();
    this.#stopNavigation = observeNavigation(window, this.#restorePreviewDepartment);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.#previewTimer);
    this.#previewAgain = false;
    this.#stopNavigation?.();
    this.#stopNavigation = undefined;
  }

  readonly #restorePreviewDepartment = (): void => {
    if (!this.#departmentsLoaded) return;
    const guard = navigationGuardFor(window);
    const url = new URL(guard?.href ?? location.href);
    if (url.pathname !== "/manage/venue-settings/view/receipts") return;
    const requested = url.searchParams.get("departmentId");
    const selected =
      this.departments.length > 1
        ? (this.departments.find((department) => department.id === requested)?.id ??
          this.departments[0]?.id ??
          null)
        : null;
    if (selected !== null && selected !== requested) {
      url.searchParams.set("departmentId", selected);
      if (guard) void guard.write(url, true);
      else history.replaceState(history.state, "", url);
    }
    if (selected !== this.previewDepartmentId) {
      this.previewDepartmentId = selected;
      if (this.receiptLoaded) void this.#sendPreview();
    }
  };

  async #loadDepartments(): Promise<void> {
    try {
      this.departments = (await this.api.getVenueDepartments()).filter(
        (department) => department.active,
      );
    } catch {
      this.departments = [];
    }
    this.#departmentsLoaded = true;
    this.#restorePreviewDepartment();
  }

  #choosePreviewDepartment(departmentId: string): void {
    if (!this.departments.some((department) => department.id === departmentId)) return;
    const guard = navigationGuardFor(window);
    const url = new URL(guard?.href ?? location.href);
    url.searchParams.set("departmentId", departmentId);
    if (guard) void guard.write(url);
    else {
      history.pushState(history.state, "", url);
      this.#restorePreviewDepartment();
    }
  }

  async #load(): Promise<void> {
    this.receiptLoadError = null;
    this.locationLoadFailed = false;
    this.languageLoadFailed = false;
    await Promise.all([this.#loadReceipt(), this.#loadLocation(), this.#loadLanguage()]);
  }

  async #loadLanguage(): Promise<void> {
    const query = dashboardQuery(this.api, "getReceiptLanguage", []);
    try {
      await this.#languageQueries.watch(
        "getReceiptLanguage",
        {
          ...query,
          key: `${query.key}:save-stamped`,
          read: async () => {
            const saves = this.#languageSaves;
            return { saves, value: await query.read() };
          },
        },
        ({ saves, value }) => {
          if (saves !== this.#languageSaves) return;
          const savedElsewhere =
            this.receiptLanguage !== null && this.receiptLanguage.language !== value.language;
          this.receiptLanguage = value;
          this.languageLoadFailed = false;
          // A fixed language has no dropdown left to take back a pick or show its refusal.
          const droppedPick = value.fixed !== null && this.pickedLanguage !== null;
          if (value.fixed !== null) {
            this.pickedLanguage = null;
            this.languageRefusal = "";
          }
          if ((savedElsewhere || droppedPick) && this.receiptLoaded && this.pickedLanguage === null)
            this.#redrawInSavedLanguage();
        },
      );
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
      await this.#receiptQueries.watch("getReceipt", [], ({ receipt, venueAddress }) => {
        const [merged] = this.#draft.merge(
          [{ id: "receipt", ...this.#shown() }],
          [
            {
              id: "receipt",
              headerSubtitle: receipt.headerSubtitle ?? "",
              footerMessage: receipt.footerMessage ?? "",
              phone: receipt.phone ?? "",
              email: receipt.email ?? "",
              printAddress: receipt.printAddress !== false,
              logo: receipt.logo ?? null,
            },
          ],
        );
        const shown = this.#shown();
        const changed = TRIM_FIELDS.some((field) => merged![field] !== shown[field]);
        const moved = venueAddress.join("\n") !== this.venueAddress.join("\n");
        for (const field of TEXT_FIELDS) this[field] = merged![field];
        this.printAddress = merged!.printAddress;
        this.logo = merged!.logo;
        this.venueAddress = venueAddress;
        this.receiptLoadError = null;
        if (!this.receiptLoaded) {
          this.receiptLoaded = true;
          this.#previewActive = true;
          void this.#sendPreview();
        } else if (moved) {
          // The address is not in what a preview asks for, so the same request must be sent again.
          this.#previewRequested = null;
          this.#schedulePreview();
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

  #shown(): Trim {
    return {
      headerSubtitle: this.headerSubtitle,
      footerMessage: this.footerMessage,
      phone: this.phone,
      email: this.email,
      printAddress: this.printAddress,
      logo: this.logo,
    };
  }

  /** What a save sends: each text trimmed, a blank one left out, and the switch only when off. */
  #trim(): ReceiptConfig {
    const config: ReceiptConfig = {};
    for (const field of TEXT_FIELDS) {
      const value = this[field].trim();
      if (value !== "") config[field] = value;
    }
    if (!this.printAddress) config.printAddress = false;
    if (this.logo !== null) config.logo = this.logo;
    return config;
  }

  #schedulePreview(): void {
    clearTimeout(this.#previewTimer);
    this.#previewTimer = setTimeout(() => void this.#sendPreview(), RECEIPT_PREVIEW_QUIET_MS);
  }

  async #sendPreview(): Promise<void> {
    if (this.#previewInFlight) {
      this.#previewAgain = true;
      return;
    }
    const client = this.#previewActive ? this.api : (this.api.background ?? this.api);
    this.#previewActive = false;
    const config = this.#trim();
    for (const field of ["phone", "email"] as const) {
      if (contactProblem(field, config[field] ?? "") !== "") delete config[field];
    }
    const width = this.chosenWidth;
    const language = this.#changedLanguage();
    const requested = JSON.stringify([config, width, language, this.previewDepartmentId]);
    if (requested === this.#previewRequested) return;
    this.#previewRequested = requested;
    this.#previewInFlight = true;
    const departmentId = this.previewDepartmentId;
    try {
      this.preview = await (departmentId !== null
        ? client.previewReceipt(config, width ?? undefined, language ?? undefined, departmentId)
        : language !== null
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

  #changeTrim(field: TextField, value: string): void {
    this[field] = value;
    this.#changed(field);
    this.#schedulePreview();
  }

  #changeAddress(checked: boolean): void {
    this.printAddress = checked;
    this.#changed("printAddress");
    void this.#sendPreview();
  }

  #changeLogo(image: string | null): void {
    this.logo = image;
    this.#changed("logo");
    void this.#sendPreview();
  }

  #changed(field: TrimField): void {
    const refusals = { ...this.trimRefusals };
    delete refusals[field];
    this.trimRefusals = refusals;
    this.saved = false;
    this.#previewActive = true;
  }

  #chooseWidth(width: PrintPaperWidth): void {
    this.chosenWidth = width;
    this.#previewActive = true;
    void this.#sendPreview();
  }

  /** The saved language is not part of the preview's key, because no parameter is sent for it. */
  #redrawInSavedLanguage(): void {
    this.#previewRequested = null;
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
    if (field !== "receiptLanguage") {
      this.languageError = `${t("receipts.language_save_error")} ${codeMessage(code)}`;
      return;
    }
    const sentence =
      code === "management.request_invalid" ? t("receipts.language_invalid") : codeMessage(code);
    // A fixed language is shown read-only, so there is no field to mark.
    if (this.receiptLanguage!.fixed === null) this.languageRefusal = sentence;
    else this.languageError = sentence;
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
    this.#languageSaves += 1;
    // A picked language was already drawn; one saved without a pick (Use Catalan) was not.
    if (this.pickedLanguage === null) {
      this.#previewActive = true;
      this.#redrawInSavedLanguage();
    }
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

  #failsOwnChecks(): boolean {
    return (
      this.#validate() !== "" ||
      contactProblem("phone", this.phone.trim()) !== "" ||
      contactProblem("email", this.email.trim()) !== ""
    );
  }

  #contactError(field: "phone" | "email"): string {
    return (
      (this.attempted ? contactProblem(field, this[field].trim()) : "") ||
      (this.trimRefusals[field] ?? "")
    );
  }

  #descriptionError(): string {
    return (this.attempted ? this.#validate() : "") || this.refusal;
  }

  #form(): HTMLElement {
    return this.shadowRoot!.querySelector<HTMLElement>(".form")!;
  }

  #receiptRefused(error: unknown): void {
    // A logo the save could not draw is refused with media's own code.
    const field = codeOf(error) === "image.invalid_file" ? ("logo" as const) : refusedField(error);
    if (field === undefined) this.errorKey = codeOf(error);
    else this.trimRefusals = { ...this.trimRefusals, [field]: refusalSentence(error) };
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
    if (this.#failsOwnChecks()) {
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

  #focusTrim(field: ReceiptMarkName): void {
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

  #renderLogo(): TemplateResult {
    const error = this.trimRefusals.logo;
    return html`<dashboard-image-upload
        .api=${this.api}
        label=${t("receipts.logo")}
        .image=${this.logo}
        .invalid=${error !== undefined}
        .disabled=${this.saving}
        @image-changed=${(event: CustomEvent<{ image: string | null }>) => {
          event.stopPropagation();
          this.#changeLogo(event.detail.image);
        }}
        @image-picker-state=${(event: Event) => event.stopPropagation()}
        @focusin=${() => this.#focusTrim("logo")}
        @focusout=${() => this.#blurTrim()}
      ></dashboard-image-upload>
      ${error === undefined ? nothing : html`<p class="error" data-test="logo-error">${error}</p>`}`;
  }

  #renderAddress(): TemplateResult {
    const error = this.trimRefusals.printAddress;
    return html`<div class="address">
      <wt-switch
        name="printAddress"
        label=${t("receipts.print_address")}
        .checked=${this.printAddress}
        ?disabled=${this.saving}
        @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
          event.stopPropagation();
          this.#changeAddress(event.detail.checked);
        }}
        @focusin=${() => this.#focusTrim("address")}
        @focusout=${() => this.#blurTrim()}
      ></wt-switch>
      ${
        this.venueAddress.length > 0
          ? html`<p class="reason" data-test="venue-address">
              ${this.venueAddress.map((line, index) => html`${index > 0 ? html`<br />` : nothing}${line}`)}
            </p>`
          : html`<p class="reason" data-test="no-address">${t("receipts.no_address")}</p>`
      }
      ${
        error === undefined
          ? nothing
          : html`<p class="error" data-test="print-address-error">${error}</p>`
      }
    </div>`;
  }

  #renderContact(field: "phone" | "email", type: "tel" | "email"): TemplateResult {
    return html`<wt-input
      name=${field}
      type=${type}
      autocomplete="off"
      label=${t(`receipts.${field}`)}
      hint=${t(`receipts.${field}_hint`)}
      .value=${this[field]}
      error=${this.#contactError(field)}
      ?disabled=${this.saving}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.#changeTrim(field, event.detail.value);
      }}
      @focusin=${() => this.#focusTrim(field)}
      @focusout=${() => this.#blurTrim()}
      @keydown=${(event: KeyboardEvent) => this.#enter(event)}
    ></wt-input>`;
  }

  #renderWarning(language: string): TemplateResult | typeof nothing {
    return this.contentLanguages === null
      ? nothing
      : receiptLanguageWarning(language, this.contentLanguages);
  }

  #renderLanguage(receiptLanguage: ReceiptLanguage): TemplateResult {
    const error = this.languageRefusal;
    const { fixed, language: stored } = receiptLanguage;
    if (fixed !== null) {
      const fixedName = receiptLanguageName(fixed.locale, false);
      return html`<div data-test="receipt-language">
        <span class="field-label">${t("receipts.language")}</span>
        <span class="field-value" data-test="receipt-language-value"
          >${receiptLanguageName(stored)}</span
        >
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
      <wt-combobox
        name="receiptLanguage"
        label=${t("receipts.language")}
        required
        search="auto"
        .options=${offered.map((language) => ({
          value: language,
          label: receiptLanguageName(language),
        }))}
        .value=${chosen}
        error=${error}
        ?disabled=${this.saving}
        @wt-change=${(event: CustomEvent<{ value: string }>) =>
          this.#pickLanguage(event.detail.value)}
      ></wt-combobox>
      ${this.#renderWarning(chosen)}
    </div>`;
  }

  #renderForm(): TemplateResult {
    const descriptionError = this.#descriptionError();
    const marked =
      descriptionError !== "" ||
      this.languageRefusal !== "" ||
      Object.keys(this.trimRefusals).length > 0 ||
      this.#contactError("phone") !== "" ||
      this.#contactError("email") !== "";
    const bottom = [
      this.languageError ?? "",
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
        ${this.#renderLogo()}
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
        <p class="reason">
          ${t("receipts.trading_name_location")}
          <a href="/manage/venue-operations">${t("receipts.departments_zones")}</a>.
        </p>
        ${this.#renderAddress()} ${this.#renderContact("phone", "tel")}
        ${this.#renderContact("email", "email")} ${this.#renderFooter()}
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
          ?disabled=${this.saving || (this.attempted && this.#failsOwnChecks())}
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
    for (const name of MARK_NAMES) {
      const range = preview?.marks[name];
      if (range) marks.push({ name, range, active: this.focusedTrim === name });
    }
    return html`<div class="preview">
      <h2>${t("receipts.preview")}</h2>
      ${
        this.departments.length > 1
          ? html`<wt-combobox
              name="previewDepartment"
              label=${t("receipts.preview_for")}
              .options=${this.departments.map((department) => ({ value: department.id, label: department.name }))}
              .value=${this.previewDepartmentId ?? ""}
              @wt-change=${(event: CustomEvent<{ value: string }>) => this.#choosePreviewDepartment(event.detail.value)}
            ></wt-combobox>`
          : nothing
      }
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
    return html` ${
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
