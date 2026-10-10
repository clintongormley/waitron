import { QueryController } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  isValidTelephone,
  resolveContentText,
  type ContentLanguages,
  type DepartmentReceiptConfig,
  type VenueReceiptSettings,
} from "@waitron/shared";
import { baseStyles, focusFirstInvalid, submitOnEnter, navigationGuardFor } from "@waitron/ui";
import { draftScopeFor, leaveCoordinatorFor, saveActionState, type DraftScope } from "@waitron/ui";
import { sameValue } from "../widgets/product-editor-model.js";
import { observeNavigation } from "@waitron/ui/src/navigation-guard.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-textarea.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-switch.js";
import "./department-receipt-editor.js";
import "./venue-receipt-defaults-editor.js";
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
const MARK_NAMES: readonly ReceiptMarkName[] = [
  "logo",
  "headerSubtitle",
  "address",
  "phone",
  "email",
  "footerMessage",
];

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
      .form-column {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-6);
        flex: 1 1 calc(var(--wt-tap-min) * 7);
        max-width: var(--wt-form-max-width);
      }
      .department-settings {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
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

  #connection = 0;
  #languageScope?: DraftScope<string>;
  #descriptionScope?: DraftScope<string>;
  #savedDescription = "";
  #savedLanguage = "";

  #shownLanguage(): string {
    return this.pickedLanguage ?? this.receiptLanguage!.language;
  }

  #registerLanguage(): void {
    if (this.#languageScope) return;
    this.#languageScope = draftScopeFor<string>(this, {
      id: {},
      parent: this,
      current: () => this.#shownLanguage(),
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => {
        this.pickedLanguage = value === this.receiptLanguage!.language ? null : value;
        this.languageRefusal = "";
        this.languageError = null;
        this.#redrawInSavedLanguage();
      },
    }).scope;
    this.#languageScope.commit(this.#savedLanguage);
  }

  #registerDescription(): void {
    if (this.#descriptionScope) return;
    this.#descriptionScope = draftScopeFor<string>(this, {
      id: {},
      parent: this,
      current: () => this.description,
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => {
        this.description = value;
        this.#dirty = false;
        this.refusal = "";
      },
    }).scope;
    this.#descriptionScope.commit(this.#savedDescription);
  }

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

  @state() private languageSaving = false;
  @state() private descriptionSaving = false;
  @state() private languageSaved = false;
  @state() private descriptionSaved = false;
  @state() private descriptionAttempted = false;

  @state() private preview: ReceiptPreview | null = null;
  @state() private departments: {
    id: string;
    name: string;
    active: boolean;
    isDefault: boolean;
  }[] = [];
  @state() private departmentLoadError = "";
  @state() private departmentDraft: DepartmentReceiptConfig | null = null;
  @state() private venueDefaultsDraft: VenueReceiptSettings | null = null;
  #departmentGeneration = 0;
  @state() private previewDepartmentId: string | null = null;
  #departmentsLoaded = false;
  @state() private previewFailed = false;
  @state() private focusedTrim: ReceiptMarkName | null = null;
  /** The paper width the person chose, kept for every later preview; never saved. */
  @state() private chosenWidth: PrintPaperWidth | null = null;
  @state() private chosenPreviewLanguage: string | null = null;
  #previewTimer: ReturnType<typeof setTimeout> | undefined;
  #previewInFlight = false;
  #previewAgain = false;
  #previewRequested: string | null = null;
  #previewActive = false;

  #stopNavigation?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.receiptLanguage !== null) this.#registerLanguage();
    if (this.locationLoaded) this.#registerDescription();
    void this.#load();
    void this.#loadDepartments();
    void this.#loadContentLanguages();
    this.#stopNavigation = observeNavigation(window, this.#restorePreviewDepartment);
  }

  override disconnectedCallback(): void {
    this.#connection++;
    this.#departmentGeneration++;
    this.#departmentsLoaded = false;
    this.#languageScope?.dispose();
    this.#languageScope = undefined;
    this.#descriptionScope?.dispose();
    this.#descriptionScope = undefined;
    this.languageSaving = false;
    this.descriptionSaving = false;
    this.languageSaved = false;
    this.descriptionSaved = false;
    this.descriptionAttempted = false;
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
    this.#selectDepartment(url.searchParams.get("departmentId"), url);
  };

  #selectDepartment(requested: string | null, url?: URL): void {
    const selected =
      this.departments.find((department) => department.id === requested) ??
      this.departments.find((department) => department.active && department.isDefault) ??
      this.departments.find((department) => department.active);
    const id = selected?.id ?? null;
    if (url && id !== requested) {
      if (id === null) url.searchParams.delete("departmentId");
      else url.searchParams.set("departmentId", id);
      const guard = navigationGuardFor(window);
      if (guard) void guard.write(url, true);
      else history.replaceState(history.state, "", url);
    }
    if (id !== this.previewDepartmentId) {
      this.previewDepartmentId = id;
      this.departmentDraft = null;
      this.preview = null;
      this.#previewRequested = null;
      this.#departmentGeneration++;
    }
    if (this.receiptLoaded) void this.#sendPreview();
  }

  async #loadDepartments(): Promise<void> {
    const connection = this.#connection;
    try {
      const departments = await (this.api.background ?? this.api).getVenueDepartments();
      if (connection !== this.#connection) return;
      this.departments = departments;
      this.departmentLoadError = "";
    } catch (error) {
      if (connection !== this.#connection) return;
      this.departments = [];
      this.departmentLoadError = codeOf(error);
    }
    this.#departmentsLoaded = true;
    const url = new URL(navigationGuardFor(window)?.href ?? location.href);
    this.#selectDepartment(
      url.searchParams.get("departmentId"),
      url.pathname === "/manage/venue-settings/view/receipts" ? url : undefined,
    );
  }

  #departmentChanged(
    event: CustomEvent<{ departmentId: string; receipt: DepartmentReceiptConfig }>,
  ): void {
    event.stopPropagation();
    if (event.detail.departmentId !== this.previewDepartmentId) return;
    if (sameValue(this.departmentDraft, event.detail.receipt)) return;
    this.departmentDraft = structuredClone(event.detail.receipt);
    this.#departmentGeneration++;
    this.#schedulePreview();
  }

  #venueDefaults(): VenueReceiptSettings {
    if (this.venueDefaultsDraft !== null) return this.venueDefaultsDraft;
    const settings = this.#trim();
    delete settings.phone;
    delete settings.email;
    return settings;
  }

  #defaultsChanged(event: CustomEvent<{ settings: VenueReceiptSettings; active?: boolean }>): void {
    event.stopPropagation();
    const changed = !sameValue(this.#venueDefaults(), event.detail.settings);
    this.venueDefaultsDraft = structuredClone(event.detail.settings);
    if (changed) this.#departmentGeneration++;
    this.#previewActive ||= event.detail.active === true;
    this.#schedulePreview();
  }

  requestDepartmentNavigation(proceed: () => void, signal?: AbortSignal) {
    const editor = this.shadowRoot?.querySelector("dashboard-department-receipt-editor");
    const coordinator = leaveCoordinatorFor(this);
    if (coordinator) {
      return coordinator.request({
        scopes: editor ? [editor.draftOwner] : [],
        reason: "navigation",
        proceed,
        signal,
      });
    }
    proceed();
    return Promise.resolve("proceeded" as const);
  }

  #choosePreviewDepartment(departmentId: string): void {
    const picker = this.shadowRoot?.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "wt-combobox[name=departmentId]",
    );
    if (picker) picker.value = this.previewDepartmentId ?? "";
    if (!this.departments.some((department) => department.id === departmentId)) return;
    const guard = navigationGuardFor(window);
    const url = new URL(guard?.href ?? location.href);
    url.searchParams.set("departmentId", departmentId);
    if (guard) void guard.write(url);
    else {
      void this.requestDepartmentNavigation(() => {
        history.pushState(history.state, "", url);
        this.#restorePreviewDepartment();
      });
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
          const wasClean = this.#languageScope !== undefined && !this.#languageScope.isDirty();
          const previousLanguage = this.receiptLanguage === null ? null : this.#shownLanguage();
          const savedElsewhere =
            this.receiptLanguage !== null && this.receiptLanguage.language !== value.language;
          if (this.receiptLanguage === null || wasClean || value.fixed !== null)
            this.#savedLanguage = value.language;
          this.receiptLanguage = value;
          this.languageLoadFailed = false;
          // A fixed language has no dropdown left to take back a pick or show its refusal.
          const droppedPick = value.fixed !== null && this.pickedLanguage !== null;
          if (value.fixed !== null) {
            this.pickedLanguage = null;
            this.languageRefusal = "";
          }
          this.#registerLanguage();
          if (
            (wasClean && previousLanguage !== this.#shownLanguage()) ||
            (value.fixed !== null && this.#languageScope?.isDirty())
          )
            this.#languageScope?.commit(this.#shownLanguage());
          if ((savedElsewhere || droppedPick) && this.pickedLanguage === null)
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

  async #loadReceipt(): Promise<void> {
    try {
      await this.#receiptQueries.watch("getReceipt", [], ({ receipt, venueAddress }) => {
        const changed =
          this.phone !== (receipt.phone ?? "") || this.email !== (receipt.email ?? "");
        const moved = venueAddress.join("\n") !== this.venueAddress.join("\n");
        this.headerSubtitle = receipt.headerSubtitle ?? "";
        this.footerMessage = receipt.footerMessage ?? "";
        this.phone = receipt.phone ?? "";
        this.email = receipt.email ?? "";
        this.printAddress = receipt.printAddress !== false;
        this.logo = receipt.logo ?? null;
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
          const wasClean =
            this.#descriptionScope !== undefined && !this.#descriptionScope.isDirty();
          const previousDescription = this.description;
          const adopt = !this.#dirty && !this.descriptionSaving && saves === this.#saves;
          if (adopt) {
            this.description = value.operationDescription;
            this.#savedDescription = this.description;
          }
          this.#registerDescription();
          if (adopt && wasClean && previousDescription !== this.description)
            this.#descriptionScope?.commit(this.description);
          this.locationLoaded = true;
          this.locationLoadFailed = false;
        },
      );
    } catch {
      this.locationLoadFailed = true;
    }
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
    if (
      (this.previewDepartmentId === null &&
        (!this.receiptLoaded || this.venueDefaultsDraft === null)) ||
      !this.#departmentsLoaded ||
      (this.previewDepartmentId !== null && this.departmentDraft === null)
    )
      return;
    if (this.#previewInFlight) {
      this.#previewAgain = true;
      return;
    }
    const passive = !this.#previewActive;
    const client = passive ? (this.api.background ?? this.api) : this.api;
    this.#previewActive = false;
    const config: ReceiptConfig = {
      ...this.#venueDefaults(),
      ...(this.phone.trim() ? { phone: this.phone.trim() } : {}),
      ...(this.email.trim() ? { email: this.email.trim() } : {}),
    };
    for (const field of ["phone", "email"] as const) {
      if (contactProblem(field, config[field] ?? "") !== "") delete config[field];
    }
    const width = this.chosenWidth;
    const language = this.chosenPreviewLanguage;
    const requested = JSON.stringify([
      config,
      width,
      language,
      this.previewDepartmentId,
      this.departmentDraft,
    ]);
    if (requested === this.#previewRequested) return;
    this.#previewRequested = requested;
    this.#previewInFlight = true;
    const departmentId = this.previewDepartmentId;
    const receipt = structuredClone(this.departmentDraft ?? {});
    for (const field of ["phone", "email"] as const) {
      if (contactProblem(field, receipt[field]?.trim() ?? "") !== "") delete receipt[field];
    }
    const generation = this.#departmentGeneration;
    try {
      const preview = await client.previewReceiptDraft(
        {
          departmentId,
          receipt,
          settings: this.#venueDefaults(),
          ...(width === null ? {} : { paperWidth: width }),
          ...(language === null ? {} : { language }),
        },
        ...(passive ? [{ passive: true }] : []),
      );
      if (generation === this.#departmentGeneration) {
        this.preview = preview;
        this.previewFailed = false;
      }
    } catch {
      if (generation === this.#departmentGeneration) this.previewFailed = true;
      this.#previewRequested = null;
    } finally {
      this.#previewInFlight = false;
    }
    if (this.#previewAgain) {
      this.#previewAgain = false;
      void this.#sendPreview();
    }
  }

  #choosePreviewLanguage(language: string): void {
    this.chosenPreviewLanguage = language === this.receiptLanguage?.language ? null : language;
    this.#departmentGeneration++;
    this.#previewActive = true;
    void this.#sendPreview();
  }

  #chooseWidth(width: PrintPaperWidth): void {
    this.chosenWidth = width;
    this.#previewActive = true;
    void this.#sendPreview();
  }

  #redrawInSavedLanguage(): void {
    if (this.chosenPreviewLanguage === null) this.#departmentGeneration++;
    this.#previewRequested = null;
    void this.#sendPreview();
  }

  #pickLanguage(language: string): void {
    this.pickedLanguage = language === this.receiptLanguage!.language ? null : language;
    this.languageRefusal = "";
    this.languageError = null;
    this.languageSaved = false;
    this.#languageScope?.changed();
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
    const connection = this.#connection;
    const scope = this.#languageScope;
    try {
      await this.api.putReceiptLanguage(language);
    } catch (error) {
      if (connection !== this.#connection) return false;
      this.#languageRefused(error);
      return false;
    }
    if (connection !== this.#connection) return false;
    const picked = this.pickedLanguage;
    this.receiptLanguage = { ...this.receiptLanguage!, language };
    this.#languageSaves += 1;
    if (this.chosenPreviewLanguage === null) {
      this.#previewActive = true;
      this.#redrawInSavedLanguage();
    }
    if (picked === language) this.pickedLanguage = null;
    this.#savedLanguage = language;
    if (scope === this.#languageScope) scope?.commit(language);
    return true;
  }

  async #saveLanguage(): Promise<void> {
    if (
      this.languageSaving ||
      !this.#languageScope ||
      saveActionState(this.#languageScope).unchanged
    )
      return;
    const connection = this.#connection;
    const language = this.#shownLanguage();
    this.languageSaving = true;
    this.languageSaved = false;
    this.languageRefusal = "";
    this.languageError = null;
    const accepted = await this.#sendLanguage(language);
    if (connection !== this.#connection) return;
    this.languageSaving = false;
    this.languageSaved = accepted;
    if (!accepted && this.languageRefusal) {
      await this.updateComplete;
      await focusFirstInvalid(
        this.shadowRoot!.querySelector<HTMLElement>("[data-test=language-section]")!,
      );
    }
  }

  async #saveDescription(): Promise<void> {
    if (
      this.descriptionSaving ||
      !this.#descriptionScope ||
      saveActionState(this.#descriptionScope).unchanged
    )
      return;
    this.descriptionAttempted = true;
    this.descriptionSaved = false;
    this.refusal = "";
    this.saveFailed = false;
    if (this.#validate()) {
      await this.updateComplete;
      await focusFirstInvalid(
        this.shadowRoot!.querySelector<HTMLElement>("[data-test=description-section]")!,
      );
      return;
    }
    const connection = this.#connection;
    const scope = this.#descriptionScope;
    const submitted = this.description;
    this.descriptionSaving = true;
    try {
      await this.api.putLocationSettings(submitted);
    } catch (error) {
      if (connection !== this.#connection || scope !== this.#descriptionScope) return;
      this.#locationRefused(error);
      this.descriptionSaving = false;
      if (this.refusal) {
        await this.updateComplete;
        await focusFirstInvalid(
          this.shadowRoot!.querySelector<HTMLElement>("[data-test=description-section]")!,
        );
      }
      return;
    }
    if (connection !== this.#connection || scope !== this.#descriptionScope) return;
    this.#savedDescription = submitted;
    scope.commit(submitted);
    this.#dirty = scope.isDirty();
    this.#saves++;
    this.descriptionSaving = false;
    this.descriptionSaved = true;
    this.descriptionAttempted = false;
  }

  async #useFixedLanguage(locale: string): Promise<void> {
    if (this.languageSaving) return;
    const connection = this.#connection;
    this.languageSaving = true;
    this.languageRefusal = "";
    this.languageError = null;
    await this.#sendLanguage(locale);
    if (connection === this.#connection) this.languageSaving = false;
  }

  #validate(): string {
    return this.description.trim() === "" ? t("location_settings.required") : "";
  }

  #descriptionError(): string {
    return (this.descriptionAttempted ? this.#validate() : "") || this.refusal;
  }

  #locationRefused(error: unknown): void {
    const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
    if (codeOf(error) === "management.request_invalid" && field === "operationDescription")
      this.refusal = t("location_settings.invalid");
    else this.saveFailed = true;
  }

  #focusField(event: CustomEvent<{ field: string | null }>): void {
    const name = event.detail.field;
    this.focusedTrim =
      MARK_NAMES.find(
        (mark) =>
          name === mark ||
          name?.startsWith(`${mark}-`) ||
          (mark === "address" && name === "printAddress"),
      ) ?? null;
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
                  ?disabled=${this.languageSaving}
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
        ?disabled=${this.languageSaving}
        @wt-change=${(event: CustomEvent<{ value: string }>) =>
          this.#pickLanguage(event.detail.value)}
      ></wt-combobox>
      ${this.#renderWarning(chosen)}
    </div>`;
  }

  #renderLocation(): TemplateResult | typeof nothing {
    if (!this.locationLoaded && this.receiptLanguage === null) return nothing;
    const heading = this.locationLoaded ? this.name : t("receipts.language");
    const descriptionError = this.#descriptionError();
    return html`
      <section class="settings" aria-labelledby="location-heading">
        <h2 id="location-heading" data-test="location-name">${heading}</h2>
        ${
          this.receiptLanguage !== null
            ? html`
                <div data-test="language-section">
                  ${this.#renderLanguage(this.receiptLanguage!)}
                  ${this.languageSaved ? html`<p role="status">${t("receipts.saved")}</p>` : nothing}
                  <wt-form-actions
                    data-test="language-actions"
                    .error=${[this.languageError ?? "", this.languageRefusal ? t("form.fix_fields") : ""].filter(Boolean).join(" ")}
                  >
                    <wt-button
                      data-test="language-save"
                      variant=${saveActionState(this.#languageScope).variant}
                      ?loading=${this.languageSaving}
                      ?disabled=${this.languageSaving || saveActionState(this.#languageScope).unchanged}
                      @click=${() => void this.#saveLanguage()}
                      >${t("action.save")}</wt-button
                    >
                  </wt-form-actions>
                </div>
              `
            : nothing
        }
        ${
          this.locationLoaded
            ? html`
                <div data-test="description-section">
                  <wt-input
                    name="operationDescription"
                    autocomplete="off"
                    required
                    label=${t("location_settings.description")}
                    hint=${t("receipts.operation_description_hint")}
                    .value=${this.description}
                    error=${descriptionError}
                    ?invalid=${descriptionError !== ""}
                    ?disabled=${this.descriptionSaving}
                    @wt-change=${(event: CustomEvent<{ value: string }>) => {
                      event.stopPropagation();
                      this.description = event.detail.value;
                      this.#descriptionScope?.changed();
                      this.#dirty = this.#descriptionScope!.isDirty();
                      this.refusal = "";
                      this.descriptionSaved = false;
                    }}
                    @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=description-save]"))}
                  >
                    <wt-help-tooltip slot="help" aria-label=${t("location_settings.help_label")}
                      >${t("location_settings.help")}</wt-help-tooltip
                    >
                  </wt-input>
                  ${this.descriptionSaved ? html`<p role="status">${t("receipts.saved")}</p>` : nothing}
                  <wt-form-actions
                    data-test="description-actions"
                    .error=${[this.saveFailed ? t("location_settings.save_error") : "", descriptionError ? t("form.fix_fields") : ""].filter(Boolean).join(" ")}
                  >
                    <wt-button
                      data-test="description-save"
                      variant=${saveActionState(this.#descriptionScope).variant}
                      ?loading=${this.descriptionSaving}
                      ?disabled=${this.descriptionSaving || saveActionState(this.#descriptionScope).unchanged || (this.descriptionAttempted && this.#validate() !== "")}
                      @click=${() => void this.#saveDescription()}
                      >${t("action.save")}</wt-button
                    >
                  </wt-form-actions>
                </div>
              `
            : nothing
        }
      </section>
    `;
  }

  #renderDepartment(): TemplateResult {
    const selected = this.departments.find(
      (department) => department.id === this.previewDepartmentId,
    );
    const offered = this.departments.filter(
      (department) => department.active || department.id === this.previewDepartmentId,
    );
    return html`
      ${
        this.departmentLoadError
          ? html`<p role="alert">${codeMessage(this.departmentLoadError)}</p>
              <wt-button variant="secondary" @click=${() => void this.#loadDepartments()}
                >${t("location_settings.retry")}</wt-button
              >`
          : nothing
      }
      ${
        selected
          ? html` <wt-combobox
                name="departmentId"
                label=${t("receipts.department")}
                .options=${offered.map((department) => ({ value: department.id, label: department.name }))}
                .value=${selected.id}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#choosePreviewDepartment(event.detail.value)}
              ></wt-combobox>
              <dashboard-department-receipt-editor
                .api=${this.api}
                .departmentId=${selected.id}
                .departmentName=${selected.name}
                .receiptLanguage=${this.receiptLanguage?.language ?? ""}
                .venueDefaults=${this.#venueDefaults()}
                .draftParent=${this}
                @receipt-field-focus=${(event: CustomEvent<{ field: string | null }>) => this.#focusField(event)}
                @receipt-draft-changed=${(event: CustomEvent<{ departmentId: string; receipt: DepartmentReceiptConfig }>) => this.#departmentChanged(event)}
              ></dashboard-department-receipt-editor>`
          : this.#departmentsLoaded && !this.departmentLoadError
            ? html`<p data-test="no-department">${t("receipts.no_department")}</p>`
            : nothing
      }
    `;
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
        this.receiptLanguage
          ? html`<wt-combobox
              name="previewLanguage"
              label=${t("receipts.preview_language")}
              .value=${this.chosenPreviewLanguage ?? this.receiptLanguage.language}
              .options=${[
                ...new Set([this.receiptLanguage.language, ...this.receiptLanguage.choices]),
              ].map((language) => ({ value: language, label: receiptLanguageName(language) }))}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                event.stopPropagation();
                this.#choosePreviewLanguage(event.detail.value);
              }}
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
    const locationReady =
      this.receiptLoaded && this.locationLoaded && this.receiptLanguage !== null;
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
      <div class="layout">
        <div class="form-column">
          <section class="department-settings">${this.#renderDepartment()}</section>
          <dashboard-venue-receipt-defaults-editor
            .api=${this.api}
            .draftParent=${this}
            .venueAddress=${this.venueAddress}
            @receipt-field-focus=${(event: CustomEvent<{ field: string | null }>) => this.#focusField(event)}
            @venue-receipt-draft-changed=${(event: CustomEvent<{ settings: VenueReceiptSettings }>) => this.#defaultsChanged(event)}
          ></dashboard-venue-receipt-defaults-editor>
          ${this.#renderLocation()}
        </div>
        ${locationReady || this.departmentDraft !== null ? this.#renderPreview() : nothing}
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-receipts-screen": ReceiptsScreen;
  }
}
