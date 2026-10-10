import { DraftRows, QueryController } from "@waitron/dashboard-kit";
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
import { draftScopeFor, saveActionState, type DraftScope } from "@waitron/ui";
import { sameValue } from "../widgets/product-editor-model.js";
import { observeNavigation } from "@waitron/ui/src/navigation-guard.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-textarea.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-switch.js";
import "../widgets/image-upload.js";
import "./department-receipt-editor.js";
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

  #trimScope?: DraftScope<{ shown: Trim; body: ReceiptConfig }>;
  #trimConnection = 0;
  #languageScope?: DraftScope<string>;
  #descriptionScope?: DraftScope<string>;

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
  }

  #trimSnapshot(): { shown: Trim; body: ReceiptConfig } {
    return { shown: this.#shown(), body: this.#trim() };
  }

  #registerTrim(): void {
    if (this.#trimScope) return;
    this.#trimScope = draftScopeFor<{ shown: Trim; body: ReceiptConfig }>(this, {
      id: {},
      parent: this,
      current: () => this.#trimSnapshot(),
      snapshot: (value) => ({ shown: { ...value.shown }, body: { ...value.body } }),
      equal: (a, b) => sameValue(a.body, b.body),
      restore: (value) => {
        for (const field of TEXT_FIELDS) this[field] = value.shown[field];
        this.printAddress = value.shown.printAddress;
        this.logo = value.shown.logo;
        this.#schedulePreview();
      },
    }).scope;
  }

  /** Only called once the form is drawn, which waits for all three reads and so all three scopes. */
  #saveState() {
    return saveActionState({
      isDirty: () =>
        this.#trimScope!.isDirty() ||
        this.#languageScope!.isDirty() ||
        this.#descriptionScope!.isDirty(),
    });
  }

  #draft = new DraftRows<Trim & { id: string }>();
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
  @state() private languageSaving = false;
  @state() private descriptionSaving = false;
  @state() private languageSaved = false;
  @state() private descriptionSaved = false;
  @state() private descriptionAttempted = false;
  @state() private saved = false;

  @state() private preview: ReceiptPreview | null = null;
  @state() private departments: {
    id: string;
    name: string;
    active: boolean;
    isDefault: boolean;
  }[] = [];
  @state() private departmentLoadError = "";
  @state() private departmentDraft: DepartmentReceiptConfig | null = null;
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
    void this.#load();
    void this.#loadDepartments();
    void this.#loadContentLanguages();
    this.#stopNavigation = observeNavigation(window, this.#restorePreviewDepartment);
  }

  override disconnectedCallback(): void {
    this.#trimConnection++;
    this.#departmentGeneration++;
    this.#departmentsLoaded = false;
    this.#trimScope?.dispose();
    this.#trimScope = undefined;
    this.#languageScope?.dispose();
    this.#languageScope = undefined;
    this.#descriptionScope?.dispose();
    this.#descriptionScope = undefined;
    this.pickedLanguage = null;
    this.receiptLanguage = null;
    this.description = "";
    this.locationLoaded = false;
    this.#dirty = false;
    this.#draft = new DraftRows<Trim & { id: string }>();
    this.receiptLoaded = false;
    this.saving = false;
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
    const connection = this.#trimConnection;
    try {
      const departments = await (this.api.background ?? this.api).getVenueDepartments();
      if (connection !== this.#trimConnection) return;
      this.departments = departments;
      this.departmentLoadError = "";
    } catch (error) {
      if (connection !== this.#trimConnection) return;
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
    this.departmentDraft = structuredClone(event.detail.receipt);
    this.#schedulePreview();
  }

  #venueDefaults(): VenueReceiptSettings {
    const settings = this.#trim();
    delete settings.phone;
    delete settings.email;
    return settings;
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
          const wasClean = this.#languageScope !== undefined && !this.#languageScope.isDirty();
          const previousLanguage = this.receiptLanguage === null ? null : this.#shownLanguage();
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
          this.#registerLanguage();
          if (
            (wasClean && previousLanguage !== this.#shownLanguage()) ||
            (value.fixed !== null && this.#languageScope?.isDirty())
          )
            this.#languageScope?.commit(this.#shownLanguage());
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

  #changedLanguage(): string | null {
    const picked = this.pickedLanguage;
    return picked !== null && picked !== this.receiptLanguage?.language ? picked : null;
  }

  async #loadReceipt(): Promise<void> {
    try {
      await this.#receiptQueries.watch("getReceipt", [], ({ receipt, venueAddress }) => {
        const wasClean = this.#trimScope !== undefined && !this.#trimScope.isDirty();
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
          this.#registerTrim();
          this.#previewActive = true;
          void this.#sendPreview();
        } else if (moved) {
          // The address is not in what a preview asks for, so the same request must be sent again.
          this.#previewRequested = null;
          this.#schedulePreview();
        } else if (changed) this.#schedulePreview();
        this.#registerTrim();
        if (wasClean && changed) this.#trimScope?.commit(this.#trimSnapshot());
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
          const adopt =
            !this.#dirty && !this.saving && !this.descriptionSaving && saves === this.#saves;
          if (adopt) this.description = value.operationDescription;
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
    if (
      !this.receiptLoaded ||
      !this.#departmentsLoaded ||
      (this.previewDepartmentId !== null && this.departmentDraft === null)
    )
      return;
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
      const preview = await (departmentId !== null
        ? client.previewReceiptDraft({
            departmentId,
            receipt,
            settings: this.#venueDefaults(),
            ...(width === null ? {} : { paperWidth: width }),
            ...(language === null ? {} : { language }),
          })
        : language !== null
          ? client.previewReceipt(config, width ?? undefined, language)
          : width === null
            ? client.previewReceipt(config)
            : client.previewReceipt(config, width));
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
    this.#trimScope?.changed();
    this.#previewActive = true;
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
    this.#previewRequested = null;
    void this.#sendPreview();
  }

  #pickLanguage(language: string): void {
    this.pickedLanguage = language === this.receiptLanguage!.language ? null : language;
    this.languageRefusal = "";
    this.languageError = null;
    this.languageSaved = false;
    this.saved = false;
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
    const connection = this.#trimConnection;
    const scope = this.#languageScope;
    try {
      await this.api.putReceiptLanguage(language);
    } catch (error) {
      if (connection !== this.#trimConnection) return false;
      this.#languageRefused(error);
      return false;
    }
    if (connection !== this.#trimConnection) return false;
    const picked = this.pickedLanguage;
    this.receiptLanguage = { ...this.receiptLanguage!, language };
    this.#languageSaves += 1;
    if (this.chosenPreviewLanguage === null) {
      this.#previewActive = true;
      this.#redrawInSavedLanguage();
    }
    if (picked === language) this.pickedLanguage = null;
    if (scope === this.#languageScope) scope?.commit(language);
    return true;
  }

  async #saveLanguage(): Promise<void> {
    if (
      this.saving ||
      this.languageSaving ||
      !this.#languageScope ||
      saveActionState(this.#languageScope).unchanged
    )
      return;
    const connection = this.#trimConnection;
    const language = this.#shownLanguage();
    this.languageSaving = true;
    this.languageSaved = false;
    this.languageRefusal = "";
    this.languageError = null;
    const accepted = await this.#sendLanguage(language);
    if (connection !== this.#trimConnection) return;
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
      this.saving ||
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
    const connection = this.#trimConnection;
    const scope = this.#descriptionScope;
    const submitted = this.description;
    this.descriptionSaving = true;
    try {
      await this.api.putLocationSettings(submitted);
    } catch (error) {
      if (connection !== this.#trimConnection || scope !== this.#descriptionScope) return;
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
    if (connection !== this.#trimConnection || scope !== this.#descriptionScope) return;
    scope.commit(submitted);
    this.#dirty = scope.isDirty();
    this.#saves++;
    this.descriptionSaving = false;
    this.descriptionSaved = true;
    this.descriptionAttempted = false;
  }

  async #useFixedLanguage(locale: string): Promise<void> {
    if (this.saving || this.languageSaving) return;
    const connection = this.#trimConnection;
    this.languageSaving = true;
    this.saved = false;
    this.languageRefusal = "";
    this.languageError = null;
    await this.#sendLanguage(locale);
    if (connection === this.#trimConnection) this.languageSaving = false;
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
    return (this.attempted || this.descriptionAttempted ? this.#validate() : "") || this.refusal;
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
    if (this.saving || this.languageSaving || this.descriptionSaving || this.#saveState().unchanged)
      return;
    const trimConnection = this.#trimConnection;
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
      if (trimConnection !== this.#trimConnection) return;
      this.saving = false;
      await this.updateComplete;
      await focusFirstInvalid(this.#form());
      return;
    }
    if (trimConnection !== this.#trimConnection) return;
    const submittedTrim = this.#trimSnapshot();
    const trimScope = this.#trimScope;
    const description = this.description;
    const descriptionScope = this.#descriptionScope;
    const [trim, location] = await Promise.allSettled([
      this.api.putReceipt(submittedTrim.body).then(() => {
        if (trimConnection === this.#trimConnection && trimScope === this.#trimScope)
          trimScope?.commit(submittedTrim);
      }),
      this.api.putLocationSettings(description).then(() => {
        if (trimConnection !== this.#trimConnection || descriptionScope !== this.#descriptionScope)
          return;
        descriptionScope?.commit(description);
        this.#dirty = this.description !== description;
        this.#saves += 1;
      }),
    ]);
    if (trimConnection !== this.#trimConnection) return;
    this.saving = false;
    if (trim.status === "rejected") this.#receiptRefused(trim.reason);
    if (location.status === "rejected") this.#locationRefused(location.reason);
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
                  ?disabled=${this.saving || this.languageSaving}
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
        ?disabled=${this.saving || this.languageSaving}
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
    const saveAction = this.#saveState();
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
              ?disabled=${this.saving || this.languageSaving || saveActionState(this.#languageScope).unchanged}
              @click=${() => void this.#saveLanguage()}
              >${t("action.save")}</wt-button
            >
          </wt-form-actions>
        </div>
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
            ?disabled=${this.saving || this.descriptionSaving}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              this.description = event.detail.value;
              this.#descriptionScope?.changed();
              this.#dirty = this.#descriptionScope!.isDirty();
              this.refusal = "";
              this.descriptionSaved = false;
              this.saved = false;
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
              ?disabled=${this.saving || this.descriptionSaving || saveActionState(this.#descriptionScope).unchanged || (this.descriptionAttempted && this.#validate() !== "")}
              @click=${() => void this.#saveDescription()}
              >${t("action.save")}</wt-button
            >
          </wt-form-actions>
        </div>
      </section>
      ${this.saved ? html`<p role="status">${t("receipts.saved")}</p>` : nothing}
      <wt-form-actions data-test="combined-actions" .error=${bottom}
        ><wt-button
          data-test="save"
          variant=${saveAction.variant}
          ?loading=${this.saving}
          ?disabled=${saveAction.unchanged || this.saving || (this.attempted && this.#failsOwnChecks())}
          @click=${() => void this.#save()}
          >${t("action.save")}</wt-button
        ></wt-form-actions
      >
    </div>`;
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
        ? html`<div class="layout">
            <div class="form-column">
              <section class="department-settings">${this.#renderDepartment()}</section>
              ${this.#renderForm()}
            </div>
            ${this.#renderPreview()}
          </div>`
        : nothing
    }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-receipts-screen": ReceiptsScreen;
  }
}
