import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  isValidTelephone,
  untranslatedLanguages,
  type DepartmentReceiptWrite,
} from "@waitron/shared";
import { QueryController } from "@waitron/dashboard-kit";
import {
  baseStyles,
  draftScopeFor,
  saveActionState,
  submitOnEnter,
  focusFirstInvalid,
  type DraftScope,
} from "@waitron/ui";
import type { ReceiptPreview, PrintPaperWidth } from "../api/client.js";
import { sameValue } from "../widgets/product-editor-model.js";
import { PrintPaper, paperStrut, paperStyles } from "../widgets/print-paper.js";
import { columnsFor } from "@waitron/printing/src/layout.js";
import { receiptLanguageName } from "../widgets/receipt-language.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import "../widgets/image-upload.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-textarea.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";

import type {
  DepartmentReceiptModel,
  DepartmentReceiptClient,
} from "../api/department-receipts.js";
function comparableReceipt(value: DepartmentReceiptWrite): DepartmentReceiptWrite {
  return {
    ...value,
    receipt: { ...value.receipt, printAddress: value.receipt.printAddress === true },
  };
}
@customElement("dashboard-department-receipt-editor")
export class DepartmentReceiptEditor extends LitElement {
  static override styles = [
    baseStyles,
    paperStyles,
    css`
      :host {
        display: grid;
        gap: var(--wt-space-4);
      }
      .layout {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-6);
        align-items: flex-start;
      }
      .fields {
        display: grid;
        gap: var(--wt-space-4);
        flex: 1 1 calc(var(--wt-tap-min) * 7);
        min-width: 0;
      }
      .preview {
        display: grid;
        gap: var(--wt-space-3);
        flex: 0 1 auto;
        max-width: 100%;
        overflow: auto;
      }
      h3,
      p {
        margin: 0;
      }
      h3 {
        font-size: var(--wt-font-size-md);
      }
      .language-heading {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .note {
        color: var(--wt-color-text-muted);
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) api!: DepartmentReceiptClient;
  @property({ attribute: false }) subject?: { id: string; name: string };
  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("subject")) return;
    if (!this.subject) {
      this.#close();
      return;
    }
    if (this.department?.id === this.subject.id) {
      this.department = { ...this.department, name: this.subject.name };
      return;
    }
    this.#close();
    this.#open(this.subject);
  }
  @property({ type: Boolean }) canManagePolicy = true;
  @property({ type: Boolean }) requiresDescription = true;
  @state() private department: { id: string; name: string } | null = null;
  @state() private model?: DepartmentReceiptModel;
  @state() private draft: DepartmentReceiptWrite = {
    receipt: {},
    policy: { receiptPrintMode: "auto", printTradingName: true },
  };
  @state() private busy = false;
  @state() private attempted = false;
  @state() private errors: Record<string, string> = {};
  @state() private actionError = "";
  @state() private readError = "";
  @state() private previewError = "";
  @state() private preview?: ReceiptPreview;
  @state() private previewLanguage = "";
  @state() private previewWidth: PrintPaperWidth | undefined;
  @state() private focusedField = "";
  #scope?: DraftScope<DepartmentReceiptWrite>;
  #baseline?: DepartmentReceiptWrite;
  #opening = 0;
  #previewGeneration = 0;
  #explicitPreviewLanguage = false;
  #previewTimer?: ReturnType<typeof setTimeout>;
  #previewFlight?: object;
  #previewDue = false;
  #previewSource?: unknown;
  #paper = new PrintPaper();
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      if (codeOf(error) === "department.not_found") this.#close(true);
      else this.readError = codeMessage(codeOf(error));
    },
    () => {
      this.readError = "";
    },
  );

  get leaveScope(): object | undefined {
    return this.#scope?.id;
  }
  get hasUnsavedChanges(): boolean {
    return this.#scope?.isDirty() ?? false;
  }
  get saving(): boolean {
    return this.busy;
  }
  #open(department: { id: string; name: string }): void {
    this.#opening++;
    this.department = { ...department };
    this.model = undefined;
    this.#baseline = undefined;
    this.busy = false;
    this.attempted = false;
    this.errors = {};
    this.actionError = this.readError = this.previewError = "";
    this.preview = undefined;
    this.previewLanguage = "";
    this.#explicitPreviewLanguage = false;
    this.previewWidth = undefined;
    this.focusedField = "";
    void this.#load();
  }
  override connectedCallback(): void {
    super.connectedCallback();
    if (this.department) {
      this.requestUpdate();
      this.#registerDraft();
      void this.#load();
    }
  }
  override disconnectedCallback(): void {
    this.requestUpdate();
    this.#opening++;
    this.#release();
    this.busy = false;
    super.disconnectedCallback();
  }
  #close(notifyHost = false): void {
    const departmentId = this.department?.id;
    this.#opening++;
    this.#release();
    this.#baseline = undefined;
    this.department = null;
    this.busy = false;
    if (notifyHost && departmentId && this.isConnected)
      this.#notify("department-receipt-closed", departmentId);
  }
  #notify(
    type: "department-receipt-saved" | "department-receipt-cancel" | "department-receipt-closed",
    departmentId = this.department?.id,
  ): void {
    if (!departmentId) return;
    this.dispatchEvent(
      new CustomEvent(type, { detail: { departmentId }, bubbles: true, composed: true }),
    );
  }
  #release(): void {
    this.#previewGeneration++;
    clearTimeout(this.#previewTimer);
    this.#previewFlight = undefined;
    this.#previewDue = false;
    this.#previewSource = undefined;
    this.#queries.release("receipt");
    this.#scope?.dispose();
    this.#scope = undefined;
  }
  #registerDraft(): void {
    if (this.#scope || !this.#baseline) return;
    const { scope } = draftScopeFor<DepartmentReceiptWrite>(this, {
      id: {},
      current: () => this.#body(),
      snapshot: (value) => structuredClone(value),
      equal: (a, b) => sameValue(comparableReceipt(a), comparableReceipt(b)),
      restore: (value) => {
        this.draft = structuredClone(value);
        this.errors = {};
        this.actionError = "";
        this.attempted = false;
        this.#queuePreview();
      },
    });
    this.#scope = scope;
    scope.commit(this.#baseline);
  }
  async #load(): Promise<void> {
    const department = this.department;
    if (!department) return;
    const opening = this.#opening;
    let initialRead = true;
    await this.#queries
      .watch(
        "receipt",
        {
          key: `department-receipt-editor:${department.id}:${opening}`,
          dependencies: [
            { type: "department_receipts" },
            { type: "departments" },
            { type: "department_sale_policies" },
            { type: "locations" },
            { type: "content_languages" },
          ],
          read: () => {
            const client = initialRead ? this.api : (this.api.background ?? this.api);
            initialRead = false;
            return client.getDepartmentReceipt(department.id);
          },
        },
        (model) => {
          if (opening !== this.#opening) return;
          this.readError = "";
          const first = this.model === undefined;
          if (!first && !this.busy && this.#scope?.isDirty()) this.#adoptUntouched(model);
          this.model = model;
          this.requiresDescription = model.operationDescriptionRequired;
          if (first || (!this.busy && !this.#scope?.isDirty())) {
            const previous = this.#baseline;
            const registered = this.#scope !== undefined;
            this.draft = structuredClone({ receipt: model.receipt, policy: model.policy });
            this.#baseline = this.#body();
            this.#registerDraft();
            if (
              registered &&
              (!previous ||
                !sameValue(comparableReceipt(previous), comparableReceipt(this.#baseline)))
            )
              this.#scope!.commit(this.#baseline);
          }
          if (!this.#explicitPreviewLanguage || !model.languages.includes(this.previewLanguage)) {
            this.previewLanguage = model.receiptLanguage;
            this.#explicitPreviewLanguage = false;
          }
          this.#queuePreview();
        },
      )
      .catch(() => {});
  }
  #adoptUntouched(model: DepartmentReceiptModel): void {
    const current = comparableReceipt(this.#body());
    const baseline = comparableReceipt(this.#baseline!);
    const next = comparableReceipt({ receipt: model.receipt, policy: model.policy });
    const draft = structuredClone(this.draft);
    const saved = structuredClone(this.#baseline!);
    for (const field of [
      "logo",
      "phone",
      "email",
      "operationDescription",
      "printAddress",
    ] as const) {
      if (!sameValue(current.receipt[field], baseline.receipt[field])) continue;
      Object.assign(draft.receipt, { [field]: model.receipt[field] });
      Object.assign(saved.receipt, { [field]: model.receipt[field] });
      if (model.receipt[field] === undefined) {
        delete draft.receipt[field];
        delete saved.receipt[field];
      }
    }
    for (const field of ["headerSubtitle", "footerMessage"] as const) {
      const values = { ...draft.receipt[field] };
      const clean = { ...saved.receipt[field] };
      const languages = new Set([
        ...Object.keys(current.receipt[field] ?? {}),
        ...Object.keys(baseline.receipt[field] ?? {}),
        ...Object.keys(next.receipt[field] ?? {}),
      ]);
      for (const language of languages) {
        if (!sameValue(current.receipt[field]?.[language], baseline.receipt[field]?.[language]))
          continue;
        const value = next.receipt[field]?.[language];
        if (value === undefined) {
          delete values[language];
          delete clean[language];
        } else values[language] = clean[language] = value;
      }
      if (Object.keys(values).length) draft.receipt[field] = values;
      else delete draft.receipt[field];
      if (Object.keys(clean).length) saved.receipt[field] = clean;
      else delete saved.receipt[field];
    }
    for (const field of ["receiptPrintMode", "printTradingName"] as const) {
      if (!sameValue(current.policy[field], baseline.policy[field])) continue;
      Object.assign(draft.policy, { [field]: model.policy[field] });
      Object.assign(saved.policy, { [field]: model.policy[field] });
    }
    this.draft = draft;
    if (!sameValue(comparableReceipt(saved), baseline)) {
      this.#baseline = saved;
      this.#scope!.commit(saved);
    }
  }
  #body(): DepartmentReceiptWrite {
    const body = structuredClone(this.draft);
    for (const field of ["phone", "email"] as const) {
      const value = body.receipt[field]?.trim() ?? "";
      if (value) body.receipt[field] = value;
      else delete body.receipt[field];
    }
    for (const field of ["headerSubtitle", "footerMessage"] as const) {
      if (!body.receipt[field]) continue;
      const map = { ...body.receipt[field] };
      for (const language of this.model?.languages ?? []) {
        if (map[language] === undefined) continue;
        const value = map[language].trim();
        if (value || this.model?.receipt[field]?.[language] !== undefined) map[language] = value;
        else delete map[language];
      }
      if (Object.keys(map).length) body.receipt[field] = map;
      else delete body.receipt[field];
    }
    return body;
  }
  #edit(
    field: "phone" | "email" | "logo" | "operationDescription" | "headerSubtitle" | "footerMessage",
    value: string | null,
    language?: string,
  ): void {
    if (this.busy) return;
    const receipt = structuredClone(this.draft.receipt);
    if (field === "headerSubtitle" || field === "footerMessage") {
      const map = { ...receipt[field], [language!]: value ?? "" };
      if (!value && this.model?.receipt[field]?.[language!] === undefined) delete map[language!];
      if (Object.keys(map).length) receipt[field] = map;
      else delete receipt[field];
    } else if (value) receipt[field] = value;
    else delete receipt[field];
    this.draft = { ...this.draft, receipt };
    const key = language ? `${field}-${language}` : field;
    const errors = { ...this.errors };
    delete errors[key];
    this.errors = errors;
    this.#scope?.changed();
    this.#queuePreview();
  }
  #policy(field: "receiptPrintMode" | "printTradingName", checked: boolean): void {
    if (!this.canManagePolicy || this.busy) return;
    this.draft = {
      ...this.draft,
      policy: {
        ...this.draft.policy,
        [field]: field === "receiptPrintMode" ? (checked ? "auto" : "on_request") : checked,
      },
    };
    const errors = { ...this.errors };
    delete errors[field];
    this.errors = errors;
    this.#scope?.changed();
    if (saveActionState(this.#scope).unchanged) this.actionError = "";
    this.#queuePreview();
  }
  #problems(): Record<string, string> {
    const problems: Record<string, string> = {};
    const receipt = this.#body().receipt;
    for (const field of ["phone", "email"] as const) {
      const value = receipt[field] ?? "";
      const max = field === "phone" ? 30 : 254;
      if (value.length > max)
        problems[field] = t("receipts.trim_too_long").replace("{max}", String(max));
      else if (
        value &&
        !(field === "phone" ? isValidTelephone(value) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      )
        problems[field] = t(
          field === "phone" ? "receipts.invalid_phone" : "receipts.invalid_email",
        );
    }
    if (this.requiresDescription) {
      const value = receipt.operationDescription ?? "";
      if (!value.trim()) problems.operationDescription = t("location_settings.required");
      else if (
        value.length > 500 ||
        Array.from(value).some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        problems.operationDescription = t("location_settings.invalid");
    }
    return problems;
  }
  #previewBody() {
    const body = this.#body();
    const problems = this.#problems();
    for (const field of ["phone", "email"] as const) {
      if (problems[field]) delete body.receipt[field];
    }
    return {
      ...body,
      departmentId: this.department!.id,
      language: this.previewLanguage,
      ...(this.previewWidth ? { paperWidth: this.previewWidth } : {}),
    };
  }
  #queuePreview(immediate = false): void {
    if (!this.department || !this.model) return;
    const source = { body: this.#previewBody(), venueAddress: this.model.venueAddress };
    if (sameValue(source, this.#previewSource)) return;
    this.#previewSource = source;
    clearTimeout(this.#previewTimer);
    this.#previewDue = false;
    const generation = ++this.#previewGeneration;
    if (immediate) {
      this.#previewDue = true;
      void this.#drawPreview(generation);
      return;
    }
    this.#previewTimer = setTimeout(() => {
      this.#previewDue = true;
      void this.#drawPreview(generation);
    }, 300);
  }
  async #drawPreview(generation: number): Promise<void> {
    if (
      !this.department ||
      !this.model ||
      generation !== this.#previewGeneration ||
      this.#previewFlight
    )
      return;
    this.#previewDue = false;
    const flight = {};
    this.#previewFlight = flight;
    try {
      const answer = await this.api.previewReceiptDraft(this.#previewBody(), { passive: true });
      if (generation !== this.#previewGeneration) return;
      this.preview = answer;
      this.previewError = "";
    } catch {
      if (generation === this.#previewGeneration) this.previewError = t("receipts.preview_error");
    } finally {
      if (this.#previewFlight === flight) {
        this.#previewFlight = undefined;
        if (this.#previewDue) void this.#drawPreview(this.#previewGeneration);
      }
    }
  }
  async #save(): Promise<void> {
    if (this.busy || !this.department || !this.#scope || saveActionState(this.#scope).unchanged)
      return;
    this.attempted = true;
    this.errors = {};
    this.actionError = "";
    if (Object.keys(this.#problems()).length) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const submitted = this.#body();
    const opening = this.#opening;
    const scope = this.#scope;
    const id = this.department.id;
    this.busy = true;
    try {
      await this.api.putDepartmentReceipt(id, submitted);
    } catch (error) {
      if (opening !== this.#opening) return;
      this.busy = false;
      const params = (error as { params?: Record<string, unknown> } | null)?.params;
      const field =
        codeOf(error) === "image.invalid_file"
          ? "logo"
          : typeof params?.field === "string"
            ? params.field
            : "";
      const key = typeof params?.language === "string" ? `${field}-${params.language}` : field;
      const sentence =
        typeof params?.maxLength === "number"
          ? t("receipts.trim_too_long").replace("{max}", String(params.maxLength))
          : params?.reason === "invalid_phone"
            ? t("receipts.invalid_phone")
            : params?.reason === "invalid_email"
              ? t("receipts.invalid_email")
              : params?.reason === "image_not_found"
                ? t("receipts.logo_not_found")
                : params?.reason === "invalid_logo"
                  ? t("receipts.invalid_logo")
                  : field === "operationDescription"
                    ? t("location_settings.invalid")
                    : codeMessage(codeOf(error));
      if (
        Array.from(this.shadowRoot!.querySelectorAll("[name]")).some(
          (element) => element.getAttribute("name") === key,
        )
      )
        this.errors = { [key]: sentence };
      else this.actionError = sentence;
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    if (opening !== this.#opening || scope !== this.#scope) return;
    scope.commit(submitted);
    this.#baseline = submitted;
    this.draft = structuredClone(submitted);
    this.attempted = false;
    this.busy = false;
    this.#queuePreview();
    this.#notify("department-receipt-saved", id);
  }
  #text(field: "headerSubtitle" | "footerMessage", language: string) {
    const name = `${field}-${language}`;
    const label = t(field === "headerSubtitle" ? "receipts.subtitle" : "receipt.footer_message");
    const value = this.draft.receipt[field]?.[language] ?? "";
    const change = (event: CustomEvent<{ value: string }>) => {
      event.stopPropagation();
      this.#edit(field, event.detail.value, language);
    };
    return field === "headerSubtitle"
      ? html`<wt-input
          name=${name}
          label=${label}
          .value=${value}
          hint=${t("receipts.header_subtitle_hint")}
          error=${this.errors[name] ?? ""}
          ?disabled=${this.busy}
          @wt-change=${change}
        ></wt-input>`
      : html`<wt-textarea
          name=${name}
          label=${label}
          .value=${value}
          hint=${t("receipts.footer_message_hint")}
          error=${this.errors[name] ?? ""}
          ?disabled=${this.busy}
          @wt-change=${change}
        ></wt-textarea>`;
  }
  override render() {
    if (!this.department) return nothing;
    const action = saveActionState(this.#scope);
    const problems = this.attempted ? this.#problems() : {};
    const errors = { ...problems, ...this.errors };
    const hasErrors = Object.keys(errors).length > 0;
    const warnings = this.model
      ? untranslatedLanguages(
          [this.draft.receipt.headerSubtitle, this.draft.receipt.footerMessage],
          this.model.languages,
        )
      : [];
    const marks = this.preview
      ? Object.entries(this.preview.marks).flatMap(([name, range]) =>
          range
            ? [
                {
                  name,
                  range,
                  active:
                    name ===
                    (this.focusedField === "printAddress"
                      ? "address"
                      : this.focusedField.split("-")[0]),
                },
              ]
            : [],
        )
      : [];
    return html` ${
        this.readError
          ? html`<p class="error" role="alert">${this.readError}</p>
              <wt-button variant="secondary" @click=${() => void this.#load()}
                >${t("location_settings.retry")}</wt-button
              >`
          : nothing
      }
      ${
        this.model && this.department
          ? html`<div class="layout">
              <div
                class="fields"
                @keydown=${(event: KeyboardEvent) => submitOnEnter(event, receiptButton(this))}
                @focusin=${(event: FocusEvent) => {
                  this.focusedField =
                    (
                      event
                        .composedPath()
                        .find(
                          (node) => node instanceof HTMLElement && node.hasAttribute("name"),
                        ) as HTMLElement | undefined
                    )?.getAttribute("name") ?? "";
                }}
                @focusout=${() => {
                  this.focusedField = "";
                }}
              >
                <div>
                  <wt-switch
                    name="receiptPrintMode"
                    label=${t("receipts.print_receipt")}
                    .description=${errors.receiptPrintMode ?? ""}
                    .checked=${this.draft.policy.receiptPrintMode === "auto"}
                    ?disabled=${this.busy || !this.canManagePolicy}
                    @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                      event.stopPropagation();
                      this.#policy("receiptPrintMode", event.detail.checked);
                    }}
                  ></wt-switch
                  >${errors.receiptPrintMode ? html`<p class="error" data-field-error="receiptPrintMode">${errors.receiptPrintMode}</p>` : nothing}
                </div>
                <div>
                  <wt-switch
                    name="printTradingName"
                    label=${t("receipts.print_trading_name")}
                    .description=${errors.printTradingName ?? ""}
                    .checked=${this.draft.policy.printTradingName}
                    ?disabled=${this.busy || !this.canManagePolicy}
                    @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                      event.stopPropagation();
                      this.#policy("printTradingName", event.detail.checked);
                    }}
                  ></wt-switch
                  >${errors.printTradingName ? html`<p class="error" data-field-error="printTradingName">${errors.printTradingName}</p>` : nothing}
                </div>
                <div>
                  <wt-switch
                    name="printAddress"
                    label=${t("receipts.print_address")}
                    .description=${errors.printAddress ?? ""}
                    .checked=${this.draft.receipt.printAddress === true}
                    ?disabled=${this.busy}
                    @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                      event.stopPropagation();
                      if (this.busy) return;
                      this.draft = {
                        ...this.draft,
                        receipt: { ...this.draft.receipt, printAddress: event.detail.checked },
                      };
                      const remaining = { ...this.errors };
                      delete remaining.printAddress;
                      this.errors = remaining;
                      this.#scope?.changed();
                      this.#queuePreview();
                    }}
                  ></wt-switch
                  >${errors.printAddress ? html`<p class="error" data-field-error="printAddress">${errors.printAddress}</p>` : nothing}
                </div>
                ${this.model.venueAddress.length ? nothing : html`<p class="note" data-test="venue-address">${t("receipts.no_address")}</p>`}
                <dashboard-image-upload
                  name="logo"
                  logo
                  .api=${this.api}
                  .image=${this.draft.receipt.logo ?? null}
                  .draftParent=${this.#scope?.id}
                  .disabled=${this.busy}
                  .invalid=${!!errors.logo}
                  @image-changed=${(event: CustomEvent<{ image: string | null }>) => {
                    event.stopPropagation();
                    this.#edit("logo", event.detail.image);
                  }}
                ></dashboard-image-upload>
                ${errors.logo ? html`<p class="error">${errors.logo}</p>` : nothing}
                ${(["phone", "email"] as const).map(
                  (field) =>
                    html`<wt-input
                      name=${field}
                      type=${field === "phone" ? "tel" : "email"}
                      label=${t(field === "phone" ? "receipts.phone" : "receipts.email")}
                      .value=${this.draft.receipt[field] ?? ""}
                      hint=${t(field === "phone" ? "receipts.phone_hint" : "receipts.email_hint")}
                      error=${errors[field] ?? ""}
                      ?disabled=${this.busy}
                      @wt-change=${(event: CustomEvent<{ value: string }>) => {
                        event.stopPropagation();
                        this.#edit(field, event.detail.value);
                      }}
                    ></wt-input>`,
                )}
                ${
                  this.requiresDescription
                    ? html`<wt-input
                        name="operationDescription"
                        required
                        label=${t("location_settings.description")}
                        hint=${t("receipts.operation_description_hint")}
                        .value=${this.draft.receipt.operationDescription ?? ""}
                        error=${errors.operationDescription ?? ""}
                        ?disabled=${this.busy}
                        @wt-change=${(event: CustomEvent<{ value: string }>) => {
                          event.stopPropagation();
                          this.#edit("operationDescription", event.detail.value);
                        }}
                      ></wt-input>`
                    : nothing
                }
                ${warnings.length ? html`<p class="note" data-test="translation-warning" role="note">${t("receipts.translation_warning")}</p>` : nothing}
                ${this.model.languages.map(
                  (language) =>
                    html`<div class="language-heading">
                        <h3 lang=${language}>${receiptLanguageName(language)}</h3>
                        ${warnings.includes(language) ? html`<span aria-label=${t("receipts.translation_warning")}>⚠</span>` : nothing}
                      </div>
                      ${this.#text("headerSubtitle", language)}${this.#text("footerMessage", language)}`,
                )}
              </div>
              <section class="preview" aria-label=${t("receipts.preview")}>
                <h3>${t("receipts.preview")}</h3>
                <wt-combobox
                  name="previewLanguage"
                  label=${t("receipts.preview_language")}
                  .options=${this.model.languages.map((language) => ({ value: language, label: receiptLanguageName(language) }))}
                  .value=${this.previewLanguage}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    this.#explicitPreviewLanguage = true;
                    this.previewLanguage = event.detail.value;
                    this.#queuePreview(true);
                  }}
                ></wt-combobox>
                ${
                  this.preview && this.preview.paperWidths.length > 1
                    ? html`<wt-combobox
                        name="previewWidth"
                        label=${t("printers.paper_width")}
                        .options=${this.preview.paperWidths.map((width) => ({ value: width, label: t(width === "58mm" ? "printers.paper_width_58" : "printers.paper_width_80") }))}
                        .value=${this.previewWidth ?? this.preview.paperWidth}
                        @wt-change=${(event: CustomEvent<{ value: string }>) => {
                          event.stopPropagation();
                          this.previewWidth = event.detail.value as PrintPaperWidth;
                          this.#queuePreview(true);
                        }}
                      ></wt-combobox>`
                    : nothing
                }
                ${this.previewError ? html`<p class="error" role="alert">${this.previewError}</p>` : nothing}
                ${this.preview ? this.#paper.render(this.preview.preview, marks) : nothing}
                ${paperStrut(columnsFor("80mm"))}
              </section>
            </div>`
          : nothing
      }
      <wt-form-actions
        .error=${[hasErrors ? t("form.fix_fields") : "", this.actionError].filter(Boolean).join(" ")}
      >
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="cancel-receipt"
          ?disabled=${this.busy}
          @click=${() => this.#notify("department-receipt-cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="save-receipt"
          variant=${action.variant}
          ?loading=${this.busy}
          ?disabled=${action.unchanged || this.busy || Object.keys(problems).length > 0}
          @click=${() => void this.#save()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>`;
  }
}
function receiptButton(host: DepartmentReceiptEditor): HTMLElement | null {
  return host.shadowRoot!.querySelector("[data-test=save-receipt]");
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-department-receipt-editor": DepartmentReceiptEditor;
  }
}
