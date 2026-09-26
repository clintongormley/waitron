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
  selectStyles,
  submitOnEnter,
  type DataTableColumn,
} from "@waitron/ui";
import type {
  AdjustmentAction,
  AdjustmentReason,
  AdjustmentReasonInput,
  AdjustmentsApi,
  PersonRole,
} from "./client.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { actionChoice, actionName, roleName, t, tf, type StringKey } from "./strings.js";

const ACTIONS: readonly AdjustmentAction[] = [
  "cancel",
  "comp",
  "discount_percent",
  "discount_amount",
];
/** Lowest first, as the server's role ladder orders them. */
const ROLES: readonly PersonRole[] = ["staff", "supervisor", "manager", "admin"];
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
/** The body field a `management.request_invalid` names, onto the editor field that holds it. */
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

function languageName(code: string): string {
  return new Intl.DisplayNames([currentLocale()], { type: "language", fallback: "code" }).of(code)!;
}

@customElement("dashboard-adjustment-reasons-screen")
export class AdjustmentReasonsScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
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
      /* Matches the label wt-input draws, so every field in the form is labelled alike. */
      .select-label {
        margin-bottom: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
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
      .select-field {
        display: grid;
      }
      select {
        min-height: var(--wt-tap-min);
      }
      select[aria-invalid="true"] {
        border-color: var(--wt-color-danger);
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
  @state() private fieldErrors: Partial<Record<Field, string>> = {};
  @state() private editorError?: string;
  @state() private busy = false;
  #loaded = false;
  #opener?: HTMLElement;
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    () => {
      this.loadError = t("adjustments.load_error");
    },
  );

  constructor() {
    super();
    new ContentLanguageController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    let initial = !this.#loaded;
    this.#loaded = true;
    try {
      await this.#queries.watch(
        "reasons",
        {
          key: "adjustments:reasons",
          dependencies: QUERY_DEPENDENCIES.reasons.map((type) => ({ type })),
          refreshMs: 60_000,
          read: () => {
            const api = initial ? this.api : this.api.background;
            initial = false;
            return api.listReasons();
          },
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

  #active(): string[] {
    return this.reasons!.filter((reason) => reason.active).map((reason) => reason.id);
  }

  async #move(reason: AdjustmentReason, step: -1 | 1): Promise<void> {
    if (this.busy) return;
    const ids = this.#active();
    const from = ids.indexOf(reason.id);
    [ids[from], ids[from + step]] = [ids[from + step]!, ids[from]!];
    this.busy = true;
    this.orderError = undefined;
    try {
      await this.api.reorderReasons(ids);
    } catch {
      this.orderError = t("adjustments.reorder_error");
      return;
    } finally {
      this.busy = false;
    }
    await this.#load();
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
    this.fieldErrors = {};
    this.editorError = undefined;
    if (editor.kind === "reason") {
      const reason = editor.reason;
      this.draft = {
        name: reason?.name ?? "",
        names: { ...reason?.names },
        actions: [...(reason?.actions ?? [])],
        maxPercent: reason?.maxPercentBp == null ? "" : String(reason.maxPercentBp / 100),
        maxAmount: reason?.maxAmount ?? "",
        applyRole: reason?.applyRole ?? "manager",
        approverRole: reason?.approverRole ?? "manager",
        noteRequired: reason?.noteRequired ?? false,
      };
    }
  }

  #close(): void {
    this.editor = undefined;
    this.draft = undefined;
    this.fieldErrors = {};
    this.editorError = undefined;
    const opener = this.#opener;
    void this.updateComplete.then(() => {
      if (opener?.isConnected) opener.focus();
    });
  }

  #edit(patch: Partial<Draft>): void {
    this.draft = { ...this.draft!, ...patch };
  }

  /** The body to send, or `undefined` after marking every field that cannot be sent as it is. */
  #validated(): AdjustmentReasonInput | undefined {
    const draft = this.draft!;
    const errors: Partial<Record<Field, string>> = {};
    const name = draft.name.trim();
    if (name === "") errors.name = t("adjustments.error.name");
    if (draft.actions.length === 0) errors.actions = t("adjustments.error.actions");
    const maxPercentBp = percentBp(draft.maxPercent);
    if (maxPercentBp === undefined) errors.maxPercent = t("adjustments.error.maxPercent");
    const maxAmount = amount(draft.maxAmount);
    if (maxAmount === undefined) errors.maxAmount = t("adjustments.error.maxAmount");
    if (ROLES.indexOf(draft.approverRole) < ROLES.indexOf(draft.applyRole)) {
      errors.approverRole = t("adjustments.error.approverRole");
    }
    this.fieldErrors = errors;
    this.editorError = undefined;
    if (Object.keys(errors).length > 0) return undefined;
    const names = Object.fromEntries(
      Object.entries(draft.names)
        .map(([language, text]) => [language, text.trim()] as const)
        .filter(([, text]) => text !== ""),
    );
    return {
      name,
      names,
      actions: ACTIONS.filter((action) => draft.actions.includes(action)),
      maxPercentBp: maxPercentBp!,
      maxAmount: maxAmount!,
      applyRole: draft.applyRole,
      approverRole: draft.approverRole,
      noteRequired: draft.noteRequired,
    };
  }

  #refused(error: unknown): void {
    const code = codeOf(error);
    const field = (error as { params?: { field?: unknown } }).params?.field;
    if (
      code === "management.request_invalid" &&
      typeof field === "string" &&
      Object.hasOwn(SERVER_FIELDS, field)
    ) {
      const target = SERVER_FIELDS[field]!;
      this.fieldErrors = { [target]: t(`adjustments.error.${target}` as StringKey) };
    } else if (code === "adjustment_reason.name_taken") {
      this.fieldErrors = { name: codeMessage(code) };
    } else {
      this.editorError = codeMessage(code);
    }
  }

  /** A refresh that fails after a write succeeded is a load failure: the editor has already closed. */
  async #write(action: () => Promise<unknown>): Promise<void> {
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
  }

  #save(): void {
    const editor = this.editor as { kind: "reason"; reason?: AdjustmentReason };
    const input = this.#validated();
    if (input === undefined) return;
    const reason = editor.reason;
    void this.#write(() =>
      reason ? this.api.updateReason(reason.id, input) : this.api.createReason(input),
    );
  }

  #limits(reason: AdjustmentReason): string[] {
    const locale = currentLocale();
    const parts: string[] = [];
    if (reason.maxPercentBp !== null) {
      const percent = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
        reason.maxPercentBp / 100,
      );
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
    const ids = this.#active();
    const index = ids.indexOf(reason.id);
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
    return html`${button("up", -1, index === 0)}${button("down", 1, index === ids.length - 1)}`;
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
    return html`<wt-row-actions label=${`${t("adjustments.column.menu")}: ${reason.name}`}>
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
      // Straight after the name, so a phone reaches the controls without scrolling the table.
      {
        key: "manage",
        label: t("adjustments.column.menu"),
        cell: (reason) => this.#manage(reason),
      },
      {
        key: "actions",
        label: t("adjustments.column.actions"),
        cell: (reason) => this.#lines(reason.actions.map((action) => actionName(action))),
      },
      {
        key: "limits",
        label: t("adjustments.column.limits"),
        cell: (reason) => this.#lines(this.#limits(reason)),
      },
      {
        key: "roles",
        label: t("adjustments.column.roles"),
        cell: (reason) =>
          this.#lines([
            roleName(reason.applyRole),
            tf("adjustments.approves", { role: roleName(reason.approverRole) }),
          ]),
      },
      {
        key: "status",
        label: t("adjustments.column.status"),
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
    ];
  }

  #fieldError(field: Field) {
    const message = this.fieldErrors[field];
    return message
      ? html`<p id=${`error-${field}`} class="field-error" data-field-error=${field}>${message}</p>`
      : nothing;
  }

  #roleSelect(field: "applyRole" | "approverRole", label: string) {
    const draft = this.draft!;
    const invalid = this.fieldErrors[field] !== undefined;
    return html`<div class="select-field">
      <label class="select-label" for=${field}>${label}</label>
      <select
        id=${field}
        name=${field}
        ?disabled=${this.busy}
        aria-invalid=${invalid}
        aria-describedby=${invalid ? `error-${field}` : nothing}
        @change=${(event: Event) =>
          this.#edit({ [field]: (event.target as HTMLSelectElement).value as PersonRole })}
      >
        ${ROLES.map(
          (role) =>
            html`<option value=${role} .selected=${draft[field] === role}>
              ${roleName(role)}
            </option>`,
        )}
      </select>
      ${this.#fieldError(field)}
    </div>`;
  }

  #reasonForm() {
    const draft = this.draft!;
    const errors = this.fieldErrors;
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
              .value=${draft.names[language] ?? ""}
              .disabled=${this.busy}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                event.stopPropagation();
                this.#edit({ names: { ...this.draft!.names, [language]: event.detail.value } });
              }}
            ></wt-input>`,
        )}
        ${this.#fieldError("names")}
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
                ?disabled=${this.busy}
                @change=${(event: Event) => {
                  const checked = (event.target as HTMLInputElement).checked;
                  const actions = this.draft!.actions.filter((each) => each !== action);
                  this.#edit({ actions: checked ? [...actions, action] : actions });
                }}
              />${actionChoice(action)}</label
            >`,
        )}
        ${this.#fieldError("actions")}
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
      <wt-input
        name="maxAmount"
        label=${t("adjustments.field.max_amount")}
        hint=${t("adjustments.field.max_amount_hint")}
        .value=${money.value}
        .error=${money.error}
        .disabled=${this.busy}
        @wt-change=${money.change}
      ></wt-input>
      ${this.#roleSelect("applyRole", t("adjustments.field.apply_role"))}
      ${this.#roleSelect("approverRole", t("adjustments.field.approver_role"))}
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
        ${this.#fieldError("noteRequired")}
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
    return keyed(
      editor,
      html`<wt-modal
        open
        heading=${heading}
        @wt-close=${() => {
          if (this.editor === editor) this.#close();
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === "Escape" && this.busy) {
            event.preventDefault();
            event.stopPropagation();
          }
          submitOnEnter(event, this.renderRoot.querySelector('[data-test="save-editor"]'));
        }}
      >
        <wt-form-error-summary
          heading=${t("adjustments.form_error_heading")}
          .errors=${[
            ...Object.values(this.fieldErrors),
            ...(this.editorError ? [this.editorError] : []),
          ]}
        ></wt-form-error-summary>
        <div class="form">
          ${
            deactivating
              ? html`<p>${tf("adjustments.deactivate_explained", { name: editor.reason.name })}</p>`
              : this.#reasonForm()
          }
        </div>
        <wt-form-actions slot="footer"
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
                  @click=${() => void this.#write(() => this.api.deactivateReason(editor.reason.id))}
                  >${t("adjustments.deactivate")}</wt-button
                >`
              : html`<wt-button
                  variant="primary"
                  data-test="save-editor"
                  ?disabled=${this.busy}
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
              data-test="reasons"
              aria-label=${t("adjustments.title")}
              .rows=${this.reasons}
              .columns=${this.#columns()}
              .rowKey=${(reason: AdjustmentReason) => reason.id}
              .emptyMessage=${t("adjustments.empty")}
            ></wt-data-table>`
          : nothing
      }
      ${this.#modal()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-adjustment-reasons-screen": AdjustmentReasonsScreen;
  }
}
