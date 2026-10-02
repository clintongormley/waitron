import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { live } from "lit/directives/live.js";
import { QueryController, codeMessage, codeOf, currentLocale } from "@waitron/dashboard-kit";
import { formatMoney } from "@waitron/shared";
import {
  baseStyles,
  ContentLanguageController,
  currentContentLanguages,
  focusFirstInvalid,
  submitOnEnter,
  type DataTableColumn,
} from "@waitron/ui";
import type {
  AdjustmentAction,
  AdjustmentReason,
  AdjustmentReasonInput,
  AdjustmentSettings,
  AdjustmentsApi,
  PersonRole,
} from "./client.js";
import { firstReadThenPassive } from "./first-read.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { perLocale } from "./per-locale.js";
import { actionChoice, actionName, roleName, t, tf, type StringKey } from "./strings.js";

const ACTIONS: readonly AdjustmentAction[] = [
  "cancel",
  "comp",
  "discount_percent",
  "discount_amount",
];
const ROLES_BY_SENIORITY: readonly PersonRole[] = ["staff", "supervisor", "manager", "admin"];
const PERCENT = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;
const AMOUNT = /^(\d{1,9})(?:[.,](\d{1,2}))?$/;

type Field =
  | "name"
  | "names"
  | "actions"
  | "maxPercent"
  | "maxAmount"
  | "applyRole"
  | "approverRole"
  | "noteRequired";
/** The field a `management.request_invalid` or `adjustment_reason.invalid` names, onto the editor
 * field that holds it. */
const SERVER_FIELDS: Record<string, Field> = {
  name: "name",
  names: "names",
  actions: "actions",
  maxPercentBp: "maxPercent",
  maxAmount: "maxAmount",
  applyRole: "applyRole",
  approverRole: "approverRole",
  noteRequired: "noteRequired",
};

interface Draft {
  name: string;
  names: Record<string, string>;
  actions: AdjustmentAction[];
  maxPercent: string;
  maxAmount: string;
  applyRole: PersonRole;
  approverRole: PersonRole;
  noteRequired: boolean;
}

type FieldErrors = Partial<Record<Field, string>>;

type Editor =
  { kind: "reason"; reason?: AdjustmentReason } | { kind: "deactivate"; reason: AdjustmentReason };

/** Basis points from a typed percentage; `null` for no limit, `undefined` when it cannot be one. */
function percentBp(text: string): number | null | undefined {
  const value = text.trim();
  if (value === "") return null;
  const match = PERCENT.exec(value);
  if (match === null) return undefined;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bp > 0 && bp <= 10000 ? bp : undefined;
}

/** The amount as the route reads it; `null` for no limit, `undefined` when it cannot be one. */
function amount(text: string): string | null | undefined {
  const value = text.trim();
  if (value === "") return null;
  const match = AMOUNT.exec(value);
  if (match === null) return undefined;
  const whole = String(Number(match[1]));
  if (whole === "0" && Number(match[2] ?? "0") === 0) return undefined;
  return match[2] === undefined ? whole : `${whole}.${match[2]}`;
}

const decimalMark = perLocale(
  (locale) =>
    new Intl.NumberFormat(locale).formatToParts(1.5).find((part) => part.type === "decimal")!.value,
);
const percentFormat = perLocale(
  (locale) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
);
const languageNames = perLocale(
  (locale) => new Intl.DisplayNames([locale], { type: "language", fallback: "code" }),
);

/** A decimal string written with the dashboard language's decimal mark, as the list shows it. */
function localDecimal(value: string): string {
  return value.replace(".", decimalMark(currentLocale()));
}

function languageName(code: string): string {
  return languageNames(currentLocale()).of(code)!;
}

@customElement("dashboard-adjustment-reasons-screen")
export class AdjustmentReasonsScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      h1 {
        margin-top: 0;
      }
      .intro {
        margin-top: 0;
        color: var(--wt-color-text-muted);
      }
      .toolbar {
        display: flex;
        justify-content: flex-end;
        margin-block: var(--wt-space-3);
      }
      .alert,
      .required,
      .field-error {
        color: var(--wt-color-danger);
      }
      .field-error {
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
      }
      .form {
        display: grid;
        gap: var(--wt-space-4);
      }
      fieldset {
        margin: 0;
        padding: 0;
        border: 0;
        display: grid;
        gap: var(--wt-space-2);
        min-width: 0;
      }
      legend {
        padding: 0;
        margin-bottom: var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }
      .required {
        margin-inline-start: var(--wt-space-1);
      }
      .choice {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
      }
      .choice input {
        width: var(--wt-space-5);
        height: var(--wt-space-5);
        margin: 0;
        accent-color: var(--wt-color-primary);
      }
      .limit {
        display: grid;
        gap: var(--wt-space-3);
        margin-top: var(--wt-space-6);
      }
      .limit h2,
      .limit p {
        margin: 0;
      }
      /* Cell markup lives in the table's shadow root, so only a part reaches it. */
      wt-data-table::part(manage) {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }
    `,
  ];

  @property({ attribute: false }) api!: AdjustmentsApi;
  @state() private reasons?: AdjustmentReason[];
  @state() private loadError?: string;
  @state() private orderError?: string;
  @state() private editor?: Editor;
  @state() private draft?: Draft;
  /** Save has been pressed since the editor opened, so the fields are checked on every change. */
  @state() private attempted = false;
  /** The server's refusal of a field, until the operator changes that field or saves again. */
  @state() private refusedFields: FieldErrors = {};
  /** A refusal that names no field the form shows, until the operator saves again. */
  @state() private editorError?: string;
  @state() private busy = false;
  @state() private settings?: AdjustmentSettings;
  @state() private limitLoadError?: string;
  /** What the operator typed; undefined until they change the field, so a refresh shows the saved
   * limit without replacing a value being typed. */
  @state() private limitDraft?: string;
  @state() private limitAttempted = false;
  /** The server refused the limit itself, until the operator changes it or saves again. */
  @state() private limitRefused = false;
  /** A refusal that names no field, until the operator saves again. */
  @state() private limitError?: string;
  @state() private limitSaving = false;
  @state() private limitSaved = false;
  #loaded = false;
  #settingsLoaded = false;
  #opener?: HTMLElement;
  /** The active reasons' ids in list order, and each one's place in it, kept in step with `reasons`. */
  #activeIds: readonly string[] = [];
  #activeIndex = new Map<string, number>();
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    () => {
      this.loadError = t("adjustments.load_error");
    },
  );

  readonly #settingsQueries = new QueryController(
    this,
    () => this.api.liveData,
    () => {
      this.limitLoadError = t("adjustments.limit.load_error");
    },
  );

  constructor() {
    super();
    new ContentLanguageController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
    void this.#loadSettings();
  }

  async #loadSettings(): Promise<void> {
    const initial = !this.#settingsLoaded;
    this.#settingsLoaded = true;
    try {
      await this.#settingsQueries.watch(
        "settings",
        {
          key: "adjustments:settings",
          dependencies: QUERY_DEPENDENCIES.settings.map((type) => ({ type })),
          refreshMs: 60_000,
          read: firstReadThenPassive(
            () => this.api,
            (api) => api.getSettings(),
            initial,
          ),
        },
        (settings) => {
          this.settings = settings;
          this.limitLoadError = undefined;
        },
      );
    } catch {
      this.limitLoadError = t("adjustments.limit.load_error");
    }
  }

  async #load(): Promise<void> {
    const initial = !this.#loaded;
    this.#loaded = true;
    try {
      await this.#queries.watch(
        "reasons",
        {
          key: "adjustments:reasons",
          dependencies: QUERY_DEPENDENCIES.reasons.map((type) => ({ type })),
          refreshMs: 60_000,
          read: firstReadThenPassive(
            () => this.api,
            (api) => api.listReasons(),
            initial,
          ),
        },
        (reasons) => {
          this.reasons = reasons;
          this.loadError = undefined;
        },
      );
    } catch {
      this.loadError = t("adjustments.load_error");
    }
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("reasons")) {
      this.#activeIds = this.reasons!.filter((reason) => reason.active).map((reason) => reason.id);
      this.#activeIndex = new Map(this.#activeIds.map((id, index) => [id, index]));
    }
  }

  async #move(reason: AdjustmentReason, step: -1 | 1): Promise<void> {
    if (this.busy) return;
    const ids = [...this.#activeIds];
    const from = ids.indexOf(reason.id);
    [ids[from], ids[from + step]] = [ids[from + step]!, ids[from]!];
    this.busy = true;
    this.orderError = undefined;
    try {
      await this.api.reorderReasons(ids);
    } catch {
      this.orderError = t("adjustments.reorder_error");
    } finally {
      this.busy = false;
    }
    // Also after a refusal: the route refuses a stale list whole, so a retry needs the current one.
    await this.#load();
    if (this.orderError) return;
    await this.updateComplete;
    // Rows are drawn by position, so the pressed button now belongs to another reason.
    const table = this.renderRoot.querySelector("wt-data-table");
    await table?.updateComplete;
    const button = (direction: string) =>
      table?.shadowRoot?.querySelector<HTMLElement & { disabled: boolean }>(
        `[data-test="move-${direction}-${reason.id}"]`,
      );
    const same = button(step < 0 ? "up" : "down");
    (same && !same.disabled ? same : button(step < 0 ? "down" : "up"))?.focus();
  }

  #open(editor: Editor, opener: HTMLElement): void {
    this.#opener = opener;
    this.editor = editor;
    this.#restart();
    if (editor.kind === "reason") {
      const reason = editor.reason;
      this.draft = {
        name: reason?.name ?? "",
        names: { ...reason?.names },
        actions: [...(reason?.actions ?? [])],
        maxPercent:
          reason?.maxPercentBp == null ? "" : localDecimal(String(reason.maxPercentBp / 100)),
        maxAmount: reason?.maxAmount == null ? "" : localDecimal(reason.maxAmount),
        applyRole: reason?.applyRole ?? "manager",
        approverRole: reason?.approverRole ?? "manager",
        noteRequired: reason?.noteRequired ?? false,
      };
    }
  }

  #close(): void {
    this.editor = undefined;
    this.draft = undefined;
    this.#restart();
    const opener = this.#opener;
    void this.updateComplete.then(() => {
      if (opener?.isConnected) opener.focus();
    });
  }

  #restart(): void {
    this.attempted = false;
    this.refusedFields = {};
    this.editorError = undefined;
  }

  /** A draft's keys are the fields they are entered in, so an edit clears those fields' refusals. */
  #edit(patch: Partial<Draft>): void {
    this.draft = { ...this.draft!, ...patch };
    const refused = { ...this.refusedFields };
    for (const key of Object.keys(patch)) delete refused[key as Field];
    this.refusedFields = refused;
  }

  #check(): FieldErrors {
    const draft = this.draft!;
    const errors: FieldErrors = {};
    if (draft.name.trim() === "") errors.name = t("adjustments.error.name");
    if (draft.actions.length === 0) errors.actions = t("adjustments.error.actions");
    if (percentBp(draft.maxPercent) === undefined) {
      errors.maxPercent = t("adjustments.error.maxPercent");
    }
    if (amount(draft.maxAmount) === undefined) errors.maxAmount = t("adjustments.error.maxAmount");
    if (
      ROLES_BY_SENIORITY.indexOf(draft.approverRole) < ROLES_BY_SENIORITY.indexOf(draft.applyRole)
    ) {
      errors.approverRole = t("adjustments.error.approverRole");
    }
    return errors;
  }

  /** The body to send; call it only once `#check` finds nothing. */
  #input(): AdjustmentReasonInput {
    const draft = this.draft!;
    const names = Object.fromEntries(
      Object.entries(draft.names)
        .map(([language, text]) => [language, text.trim()] as const)
        .filter(([, text]) => text !== ""),
    );
    return {
      name: draft.name.trim(),
      names,
      actions: ACTIONS.filter((action) => draft.actions.includes(action)),
      maxPercentBp: percentBp(draft.maxPercent)!,
      maxAmount: amount(draft.maxAmount)!,
      applyRole: draft.applyRole,
      approverRole: draft.approverRole,
      noteRequired: draft.noteRequired,
    };
  }

  #refused(error: unknown): void {
    const code = codeOf(error);
    const field = (error as { params?: { field?: unknown } }).params?.field;
    if (
      (code === "management.request_invalid" || code === "adjustment_reason.invalid") &&
      typeof field === "string" &&
      Object.hasOwn(SERVER_FIELDS, field)
    ) {
      const target = SERVER_FIELDS[field]!;
      this.refusedFields = { [target]: t(`adjustments.error.${target}` as StringKey) };
    } else if (code === "adjustment_reason.name_taken") {
      this.refusedFields = { name: codeMessage(code) };
    } else {
      this.editorError = codeMessage(code);
      return;
    }
    void this.#focusInvalid();
  }

  /** The screen's shadow root also holds the list, so only the editor is searched. */
  async #focusInvalid(): Promise<void> {
    await this.updateComplete;
    await focusFirstInvalid(this.renderRoot.querySelector("wt-modal")!);
  }

  /** A refresh that fails after a write succeeded is a load failure: the editor has already closed. */
  async #write(action: () => Promise<unknown>, after?: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await action();
    } catch (error) {
      this.#refused(error);
      return;
    } finally {
      this.busy = false;
    }
    this.#close();
    await this.#load();
    await after?.();
  }

  /** The Active filter drops the row, so focus goes to the row now in its place, or to Add reason. */
  #deactivate(reason: AdjustmentReason): void {
    const rows = () => [
      ...(this.renderRoot
        .querySelector("wt-data-table")
        ?.shadowRoot?.querySelectorAll<HTMLElement>("tbody tr[data-row-key]") ?? []),
    ];
    const index = rows().findIndex((row) => row.dataset.rowKey === reason.id);
    void this.#write(
      () => this.api.deactivateReason(reason.id),
      async () => {
        await this.updateComplete;
        await this.renderRoot.querySelector("wt-data-table")?.updateComplete;
        const remaining = rows();
        const row = remaining[Math.min(index, remaining.length - 1)];
        (
          row?.querySelector<HTMLElement>("wt-row-actions") ??
          this.renderRoot.querySelector<HTMLElement>('[data-test="add-reason"]')
        )?.focus();
      },
    );
  }

  #save(): void {
    const editor = this.editor as { kind: "reason"; reason?: AdjustmentReason };
    this.attempted = true;
    this.refusedFields = {};
    this.editorError = undefined;
    if (Object.keys(this.#check()).length > 0) {
      void this.#focusInvalid();
      return;
    }
    const input = this.#input();
    const reason = editor.reason;
    void this.#write(() =>
      reason ? this.api.updateReason(reason.id, input) : this.api.createReason(input),
    );
  }

  #limitText(): string {
    if (this.limitDraft !== undefined) return this.limitDraft;
    const bp = this.settings!.maxBillDiscountBp;
    return bp === null ? "" : localDecimal(String(bp / 100));
  }

  #limitCheck(): string | undefined {
    return percentBp(this.#limitText()) === undefined ? t("adjustments.limit.invalid") : undefined;
  }

  async #focusLimit(): Promise<void> {
    await this.updateComplete;
    await focusFirstInvalid(this.renderRoot.querySelector('[data-test="limit"]')!);
  }

  /** A refresh that fails after the save succeeded is a load failure, shown as one. */
  async #saveLimit(): Promise<void> {
    if (this.limitSaving) return;
    this.limitAttempted = true;
    this.limitRefused = false;
    this.limitError = undefined;
    this.limitSaved = false;
    if (this.#limitCheck() !== undefined) {
      await this.#focusLimit();
      return;
    }
    this.limitSaving = true;
    let settings: AdjustmentSettings;
    try {
      settings = await this.api.saveSettings({ maxBillDiscountBp: percentBp(this.#limitText())! });
    } catch (error) {
      const field = (error as { params?: { field?: unknown } }).params?.field;
      if (codeOf(error) === "management.request_invalid" && field === "maxBillDiscountBp") {
        this.limitRefused = true;
        void this.#focusLimit();
      } else {
        this.limitError = codeMessage(codeOf(error));
      }
      return;
    } finally {
      this.limitSaving = false;
    }
    this.settings = settings;
    this.limitDraft = undefined;
    this.limitAttempted = false;
    this.limitSaved = true;
    await this.#loadSettings();
  }

  #limitSection() {
    return html`<section class="limit" data-test="limit" aria-labelledby="limit-heading">
      <h2 id="limit-heading">${t("adjustments.limit.heading")}</h2>
      <p class="intro" data-test="limit-explained">${t("adjustments.limit.explained")}</p>
      ${
        this.limitLoadError
          ? html`<p class="alert" role="alert" data-test="limit-alert">${this.limitLoadError}</p>`
          : nothing
      }
      ${this.settings ? this.#limitForm() : nothing}
    </section>`;
  }

  #limitForm() {
    const own = this.limitAttempted ? this.#limitCheck() : undefined;
    const error = own ?? (this.limitRefused ? t("adjustments.limit.invalid") : undefined);
    const bottom = [
      ...(this.limitError ? [this.limitError] : []),
      ...(error ? [t("adjustments.fix_fields")] : []),
    ].join(" ");
    return html`<wt-price-input
        name="maxBillDiscount"
        unit="%"
        fixed-unit
        label=${t("adjustments.limit.field")}
        .value=${this.#limitText()}
        .error=${error ?? ""}
        .disabled=${this.limitSaving}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.limitDraft = event.detail.value;
          this.limitRefused = false;
          this.limitSaved = false;
        }}
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.renderRoot.querySelector('[data-test="save-limit"]'))}
      ></wt-price-input>
      ${
        this.limitSaved
          ? html`<p role="status" data-test="limit-saved">${t("adjustments.limit.saved")}</p>`
          : nothing
      }
      <wt-form-actions .error=${bottom}
        ><wt-button
          variant="primary"
          data-test="save-limit"
          ?disabled=${this.limitSaving || own !== undefined}
          @click=${() => void this.#saveLimit()}
          >${t("adjustments.limit.save")}</wt-button
        ></wt-form-actions
      >`;
  }

  #limits(reason: AdjustmentReason): string[] {
    const locale = currentLocale();
    const parts: string[] = [];
    if (reason.maxPercentBp !== null) {
      const percent = percentFormat(locale).format(reason.maxPercentBp / 100);
      parts.push(tf("adjustments.limit_percent", { percent }));
    }
    if (reason.maxAmount !== null) {
      parts.push(tf("adjustments.limit_amount", { amount: formatMoney(reason.maxAmount, locale) }));
    }
    if (parts.length === 0) parts.push(t("adjustments.no_limit"));
    if (reason.noteRequired) parts.push(t("adjustments.note_required"));
    return parts;
  }

  /** One line each: a table cell never wraps on its own, so a long cell would widen the table. */
  #lines(lines: readonly string[]) {
    return lines.map((line) => html`<div>${line}</div>`);
  }

  #manage(reason: AdjustmentReason) {
    return html`<div part="manage">${this.#moveButtons(reason)}${this.#rowMenu(reason)}</div>`;
  }

  #moveButtons(reason: AdjustmentReason) {
    if (!reason.active) return nothing;
    const index = this.#activeIndex.get(reason.id)!;
    const button = (direction: "up" | "down", step: -1 | 1, disabled: boolean) => {
      const label = t(direction === "up" ? "adjustments.move_up" : "adjustments.move_down");
      return html`<wt-button
        size="sm"
        variant="secondary"
        data-test=${`move-${direction}-${reason.id}`}
        aria-label=${`${label}: ${reason.name}`}
        ?disabled=${this.busy || disabled}
        @click=${() => void this.#move(reason, step)}
        >${label}</wt-button
      >`;
    };
    return html`${button("up", -1, index === 0)}${button("down", 1, index === this.#activeIds.length - 1)}`;
  }

  #rowMenu(reason: AdjustmentReason) {
    const item = (test: string, label: string, run: (opener: HTMLElement) => void) =>
      html`<wt-button
        variant="ghost"
        align="start"
        data-test=${test}
        ?disabled=${this.busy}
        @click=${(event: Event) => {
          const menu = (event.currentTarget as HTMLElement).closest("wt-row-actions")!;
          menu.hide();
          run(menu);
        }}
        >${label}</wt-button
      >`;
    return html`<wt-row-actions label=${`${t("adjustments.column.actions")}: ${reason.name}`}>
      ${item(`edit-${reason.id}`, t("adjustments.edit"), (opener) =>
        this.#open({ kind: "reason", reason }, opener),
      )}
      ${
        reason.active
          ? item(`deactivate-${reason.id}`, t("adjustments.deactivate"), (opener) =>
              this.#open({ kind: "deactivate", reason }, opener),
            )
          : nothing
      }
    </wt-row-actions>`;
  }

  #columns(): DataTableColumn<AdjustmentReason>[] {
    return [
      { key: "name", label: t("adjustments.column.name"), cell: (reason) => reason.name },
      {
        key: "allows",
        label: t("adjustments.column.allows"),
        choosable: "shown",
        cell: (reason) => this.#lines(reason.actions.map((action) => actionName(action))),
      },
      {
        key: "limits",
        label: t("adjustments.column.limits"),
        choosable: "shown",
        cell: (reason) => this.#lines(this.#limits(reason)),
      },
      {
        key: "roles",
        label: t("adjustments.column.roles"),
        choosable: "shown",
        cell: (reason) =>
          this.#lines([
            roleName(reason.applyRole),
            tf("adjustments.approves", { role: roleName(reason.approverRole) }),
          ]),
      },
      {
        key: "status",
        label: t("adjustments.column.status"),
        choosable: "shown",
        cell: (reason) => t(reason.active ? "adjustments.active" : "adjustments.inactive"),
        filter: {
          label: t("adjustments.column.status"),
          allLabel: t("adjustments.filter_all"),
          value: (reason) => (reason.active ? "active" : "inactive"),
          options: [
            { value: "active", label: t("adjustments.active") },
            { value: "inactive", label: t("adjustments.inactive") },
          ],
          initial: "active",
        },
      },
      {
        key: "actions",
        label: t("adjustments.column.actions"),
        pinned: "end",
        cell: (reason) => this.#manage(reason),
      },
    ];
  }

  #fieldError(errors: FieldErrors, field: Field) {
    const message = errors[field];
    return message
      ? html`<p id=${`error-${field}`} class="field-error" data-field-error=${field}>${message}</p>`
      : nothing;
  }

  #roleSelect(errors: FieldErrors, field: "applyRole" | "approverRole", label: string) {
    const draft = this.draft!;
    const locale = currentLocale();
    const collator = new Intl.Collator(locale, { sensitivity: "base" });
    const roles = [...ROLES_BY_SENIORITY].sort((a, b) =>
      collator.compare(roleName(a, locale), roleName(b, locale)),
    );
    return html`<wt-combobox
      name=${field}
      label=${label}
      search="auto"
      .options=${roles.map((role) => ({ value: role, label: roleName(role) }))}
      .value=${draft[field]}
      error=${errors[field] ?? ""}
      .disabled=${this.busy}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.#edit({ [field]: event.detail.value as PersonRole });
      }}
    ></wt-combobox>`;
  }

  #reasonForm(errors: FieldErrors) {
    const draft = this.draft!;
    const languages = currentContentLanguages().languages;
    const text = (field: "name" | "maxPercent" | "maxAmount") => ({
      value: draft[field],
      error: errors[field] ?? "",
      change: (event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.#edit({ [field]: event.detail.value });
      },
    });
    const name = text("name");
    const percent = text("maxPercent");
    const money = text("maxAmount");
    return html`<wt-input
        name="name"
        required
        label=${t("adjustments.field.name")}
        .value=${name.value}
        .error=${name.error}
        .disabled=${this.busy}
        @wt-change=${name.change}
      ></wt-input>
      <fieldset aria-describedby=${errors.names ? "error-names" : nothing}>
        <legend>${t("adjustments.field.names")}</legend>
        ${languages.map(
          (language) =>
            html`<wt-input
              name=${`names-${language}`}
              label=${tf("adjustments.field.name_in", { language: languageName(language) })}
              .invalid=${errors.names !== undefined}
              .value=${draft.names[language] ?? ""}
              .disabled=${this.busy}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                event.stopPropagation();
                this.#edit({ names: { ...this.draft!.names, [language]: event.detail.value } });
              }}
            ></wt-input>`,
        )}
        ${this.#fieldError(errors, "names")}
      </fieldset>
      <fieldset aria-describedby=${errors.actions ? "error-actions" : nothing}>
        <legend>
          ${t("adjustments.field.actions")}<span class="required" aria-hidden="true">*</span>
        </legend>
        ${ACTIONS.map(
          (action) =>
            html`<label class="choice"
              ><input
                type="checkbox"
                name="actions"
                value=${action}
                .checked=${live(draft.actions.includes(action))}
                aria-invalid=${errors.actions !== undefined}
                ?disabled=${this.busy}
                @change=${(event: Event) => {
                  const checked = (event.target as HTMLInputElement).checked;
                  const actions = this.draft!.actions.filter((each) => each !== action);
                  this.#edit({ actions: checked ? [...actions, action] : actions });
                }}
              />${actionChoice(action)}</label
            >`,
        )}
        ${this.#fieldError(errors, "actions")}
      </fieldset>
      <wt-input
        name="maxPercent"
        label=${t("adjustments.field.max_percent")}
        hint=${t("adjustments.field.max_percent_hint")}
        .value=${percent.value}
        .error=${percent.error}
        .disabled=${this.busy}
        @wt-change=${percent.change}
      ></wt-input>
      <wt-price-input
        name="maxAmount"
        fixed-unit
        locale=${currentLocale()}
        label=${t("adjustments.field.max_amount")}
        hint=${t("adjustments.field.max_amount_hint")}
        .value=${money.value}
        .error=${money.error}
        .disabled=${this.busy}
        @wt-change=${money.change}
      ></wt-price-input>
      ${this.#roleSelect(errors, "applyRole", t("adjustments.field.apply_role"))}
      ${this.#roleSelect(errors, "approverRole", t("adjustments.field.approver_role"))}
      <div>
        <wt-switch
          name="noteRequired"
          label=${t("adjustments.field.note_required")}
          .checked=${draft.noteRequired}
          .disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
            event.stopPropagation();
            this.#edit({ noteRequired: event.detail.checked });
          }}
        ></wt-switch>
        ${this.#fieldError(errors, "noteRequired")}
      </div>`;
  }

  #modal() {
    const editor = this.editor;
    if (editor === undefined) return nothing;
    const reason = editor.kind === "reason" ? editor.reason : undefined;
    const deactivating = editor.kind === "deactivate";
    const heading = deactivating
      ? t("adjustments.deactivate_heading")
      : t(reason ? "adjustments.edit_heading" : "adjustments.new");
    const checked = this.attempted ? this.#check() : {};
    const errors = { ...this.refusedFields, ...checked };
    const invalid = Object.keys(checked).length > 0;
    const bottom = [
      ...(this.editorError ? [this.editorError] : []),
      ...(Object.keys(errors).length > 0 ? [t("adjustments.fix_fields")] : []),
    ].join(" ");
    return keyed(
      editor,
      html`<wt-modal
        open
        heading=${heading}
        @wt-close=${() => {
          if (this.editor === editor) this.#close();
        }}
        .dismissible=${!this.busy}
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.renderRoot.querySelector('[data-test="save-editor"]'))}
      >
        <div class="form">
          ${
            deactivating
              ? html`<p>${tf("adjustments.deactivate_explained", { name: editor.reason.name })}</p>`
              : this.#reasonForm(errors)
          }
        </div>
        <wt-form-actions slot="footer" .error=${bottom}
          ><wt-button
            slot="cancel"
            variant="secondary"
            data-test="cancel-editor"
            ?disabled=${this.busy}
            @click=${() => this.#close()}
            >${t("adjustments.cancel")}</wt-button
          >${
            deactivating
              ? html`<wt-button
                  variant="danger"
                  data-test="confirm-deactivate"
                  ?disabled=${this.busy}
                  @click=${() => this.#deactivate(editor.reason)}
                  >${t("adjustments.deactivate")}</wt-button
                >`
              : html`<wt-button
                  variant="primary"
                  data-test="save-editor"
                  ?disabled=${this.busy || invalid}
                  @click=${() => this.#save()}
                  >${t("adjustments.save")}</wt-button
                >`
          }</wt-form-actions
        >
      </wt-modal>`,
    );
  }

  override render() {
    const alert = this.loadError ?? this.orderError;
    return html`<h1>${t("adjustments.title")}</h1>
      <p class="intro">${t("adjustments.intro")}</p>
      ${alert ? html`<p class="alert" role="alert" data-test="page-alert">${alert}</p>` : nothing}
      <div class="toolbar">
        <wt-button
          variant="primary"
          data-test="add-reason"
          ?disabled=${this.busy}
          @click=${(event: Event) =>
            this.#open({ kind: "reason" }, event.currentTarget as HTMLElement)}
          >${t("adjustments.add")}</wt-button
        >
      </div>
      ${
        this.reasons
          ? html`<wt-data-table
              filterSearchPlaceholder=${t("adjustments.combobox_search")}
              filterNoResultsLabel=${t("adjustments.combobox_no_results")}
              data-test="reasons"
              aria-label=${t("adjustments.title")}
              viewKey="waitron.adjustments.reasons.table"
              columnsLabel=${t("adjustments.columns")}
              .rows=${this.reasons}
              .columns=${this.#columns()}
              .rowKey=${(reason: AdjustmentReason) => reason.id}
              .emptyMessage=${t("adjustments.empty")}
            ></wt-data-table>`
          : nothing
      }
      ${this.#limitSection()} ${this.#modal()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-adjustment-reasons-screen": AdjustmentReasonsScreen;
  }
}
