import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import {
  QueryController,
  codeMessage,
  codeOf,
  currentLocale,
  tableNoMatches,
} from "@waitron/dashboard-kit";
import { formatMoney, searchBy, type DeleteImpact } from "@waitron/shared";
import {
  baseStyles,
  ReorderController,
  reorder,
  type ReorderModel,
  parseDecimalInput,
  formatDecimalInput,
  ContentLanguageController,
  currentContentLanguages,
  focusFirstInvalid,
  draftScopeFor,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  submitOnEnter,
} from "@waitron/ui";
import type {
  AdjustmentAction,
  AdjustmentReason,
  AdjustmentReasonInput,
  AdjustmentSettings,
  AdjustmentsApi,
  PersonRole,
  ReasonKind,
} from "./client.js";
import { firstReadThenPassive } from "./first-read.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { perLocale } from "./per-locale.js";
import { reasonDeleteCopy } from "./reason-delete-copy.js";
import { actionChoice, kindName, roleName, t, tf, type StringKey } from "./strings.js";

/** What a Comp reason may offer, in the order the form and the request list them. */
const OFFERS: readonly AdjustmentAction[] = ["comp", "discount_percent", "discount_amount"];
const KINDS: readonly ReasonKind[] = ["void", "comp"];
const ROLES_BY_SENIORITY: readonly PersonRole[] = ["staff", "supervisor", "manager", "admin"];
const NEW_REASON_ROLES: readonly PersonRole[] = ["manager", "admin"];
const PERCENT = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;
const AMOUNT = /^(\d{1,9})(?:[.,](\d{1,2}))?$/;

type Field =
  | "kind"
  | "name"
  | "names"
  | "actions"
  | "maxPercent"
  | "maxAmount"
  | "applyRoles"
  | "approverRoles"
  | "noteRequired";
/** The field a `management.request_invalid` or `adjustment_reason.invalid` names, onto the editor
 * field that holds it. */
const SERVER_FIELDS: Record<string, Field> = {
  kind: "kind",
  name: "name",
  names: "names",
  actions: "actions",
  maxPercentBp: "maxPercent",
  maxAmount: "maxAmount",
  applyRoles: "applyRoles",
  approverRoles: "approverRoles",
  noteRequired: "noteRequired",
};

/** A Void draft keeps the Comp fields empty, so changing the kind clears them. */
interface Draft {
  kind: ReasonKind;
  name: string;
  names: Record<string, string>;
  /** A Comp reason's offers; a Void reason's one action is implied by its kind. */
  actions: AdjustmentAction[];
  maxPercent: string;
  maxAmount: string;
  applyRoles: PersonRole[];
  approverRoles: PersonRole[];
  noteRequired: boolean;
}

const COMP_FIELDS_CLEARED = {
  actions: [],
  maxPercent: "",
  maxAmount: "",
  applyRoles: [],
  approverRoles: [],
} satisfies Partial<Draft>;

function bySeniority(roles: readonly PersonRole[]): PersonRole[] {
  return ROLES_BY_SENIORITY.filter((role) => roles.includes(role));
}

/** The chosen roles by seniority, or Everyone once all four are chosen. */
function rolesText(roles: readonly PersonRole[]): string {
  const chosen = bySeniority(roles);
  return chosen.length === ROLES_BY_SENIORITY.length
    ? t("adjustments.everyone")
    : chosen.map((role) => roleName(role)).join(", ");
}

function copyDraft(value: Draft): Draft {
  return {
    ...value,
    names: { ...value.names },
    actions: [...value.actions],
    applyRoles: [...value.applyRoles],
    approverRoles: [...value.approverRoles],
  };
}

type FieldErrors = Partial<Record<Field, string>>;

/** The reason the editor edits; none for a new one. */
type Editor = { reason?: AdjustmentReason };

type Deletion = {
  reasonId: string;
  opener: HTMLElement;
  impact: DeleteImpact | null;
  loading: boolean;
  readError: string;
  actionError: string;
  busy: boolean;
};

/** Basis points from a typed percentage; `null` for no limit, `undefined` when it cannot be one. */
function percentBp(text: string): number | null | undefined {
  const value = text.trim();
  if (value === "") return null;
  const parsed = parseDecimalInput(value);
  const match = parsed === null ? null : PERCENT.exec(parsed);
  if (match === null) return undefined;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bp > 0 && bp <= 10000 ? bp : undefined;
}

/** The amount as the route reads it; `null` for no limit, `undefined` when it cannot be one. */
function amount(text: string): string | null | undefined {
  const value = text.trim();
  if (value === "") return null;
  const parsed = parseDecimalInput(value);
  const match = parsed === null ? null : AMOUNT.exec(parsed);
  if (match === null) return undefined;
  const whole = String(Number(match[1]));
  if (whole === "0" && Number(match[2] ?? "0") === 0) return undefined;
  return match[2] === undefined ? whole : `${whole}.${match[2]}`;
}

/** An amount at the route's two decimals; `null` for no limit, `undefined` when it cannot be one. */
function money(text: string): string | null | undefined {
  const value = amount(text);
  if (typeof value !== "string") return value;
  const [whole, cents = ""] = value.split(".");
  return `${whole}.${cents.padEnd(2, "0")}`;
}

/** The bill limit's two fields, as typed. */
interface LimitDraft {
  amount: string;
  roles: PersonRole[];
}
type LimitField = "maxBillComp" | "billApproverRoles";
type LimitErrors = Partial<Record<LimitField, string>>;
const LIMIT_MESSAGES: Record<LimitField, StringKey> = {
  maxBillComp: "adjustments.limit.invalid",
  billApproverRoles: "adjustments.error.approverRoles",
};

const percentFormat = perLocale(
  (locale) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
);
const languageNames = perLocale(
  (locale) => new Intl.DisplayNames([locale], { type: "language", fallback: "code" }),
);

/** A decimal string written with the dashboard language's decimal mark, as the list shows it. */
function localDecimal(value: string): string {
  return formatDecimalInput(value, currentLocale());
}

function languageName(code: string): string {
  return languageNames(currentLocale()).of(code)!;
}

@customElement("dashboard-adjustment-reasons-screen")
export class AdjustmentReasonsScreen extends LitElement {
  static override styles = [
    baseStyles,
    ReorderController.styles,
    ReorderController.tableStyles,
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
        flex-wrap: wrap;
        align-items: end;
        justify-content: space-between;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-3);
      }
      .empty {
        display: grid;
        justify-items: start;
        gap: var(--wt-space-3);
      }
      .empty p {
        margin: 0;
      }
      thead th {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .handle-cell,
      td.actions-cell {
        width: 1%;
        padding-inline: 0;
        white-space: nowrap;
      }
      td.actions-cell {
        text-align: end;
      }
      td.actions-cell,
      th.actions-cell {
        position: sticky;
        inset-inline-end: 0;
        background: var(--wt-color-surface);
      }
      tr[data-dragging] td.actions-cell {
        background: var(--wt-color-surface-lifted);
      }
      .reason-name {
        font-weight: var(--wt-font-weight-bold);
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
      .offer-choices {
        display: flex;
        flex-wrap: wrap;
        column-gap: var(--wt-space-4);
      }
      .hint {
        margin: var(--wt-space-1) 0 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
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
      .limit-fields {
        display: grid;
        grid-template-columns: repeat(
          auto-fit,
          minmax(min(100%, calc(var(--wt-form-max-width) / 2)), 1fr)
        );
        gap: var(--wt-space-4);
        align-items: start;
      }
    `,
  ];

  @property({ attribute: false }) api!: AdjustmentsApi;
  @state() private reasons?: AdjustmentReason[];
  @state() private search = "";
  @state() private loadError?: string;
  /** A refused save of a new order, until the next move or the editor opens. */
  @state() private actionError?: string;
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
  /** What the operator chose; undefined until they change a field, so a refresh shows the saved
   * limit without replacing a value being typed. */
  @state() private limitDraft?: LimitDraft;
  @state() private limitAttempted = false;
  /** The field the server refused, until the operator changes it or saves again. */
  @state() private limitRefused?: LimitField;
  /** A refusal that names no field, until the operator saves again. */
  @state() private limitError?: string;
  @state() private limitSaving = false;
  @state() private limitSaved = false;
  @state() private deleting?: Deletion;
  /** Replaced each time the delete question opens or closes, so a late answer finds it changed. */
  #deletion?: object;
  #loaded = false;
  #settingsLoaded = false;
  #opener?: HTMLElement;
  #reasonScope?: DraftScope<Draft>;
  #limitScope?: DraftScope<LimitDraft>;
  #limitGeneration = 0;
  #leave?: LeaveCoordinator;
  /** Restoring a draft rerenders; the pending close still needs this editor's same guard. */
  #closeGuard?: (reason: LeaveReason) => Promise<boolean>;
  /** Order saves not yet answered, the one in flight included. */
  #movesOut = 0;
  /** Where a pointer drag picked its row up, once it has moved it; null otherwise. */
  #dragFrom: number | null = null;
  /** A list read arrived while a move was unsaved, so it was not shown. */
  #readDropped = false;
  /** Order saves run one after another along this chain. */
  #saving: Promise<void> = Promise.resolve();
  /** Moved on by a refusal or a disconnect, so the saves still waiting are dropped unsent. */
  #moveGeneration = 0;

  readonly #reorder = new ReorderController(
    this,
    {
      order: () => (this.reasons ? this.#shown().map((reason) => reason.id) : []),
      move: (id, to, via) => this.#move(id, to, via),
      drop: (id) => this.#drop(id),
      label: (id) => this.reasons!.find((reason) => reason.id === id)!.name,
      // Never true for a save: that would disable the grip a keyboard user is on and drop their focus.
      busy: () => this.#searching,
      get reorderLabel(): string {
        return t("adjustments.reorder");
      },
    } satisfies ReorderModel,
    { announce: () => t("adjustments.reordered") },
  );

  /** While false the rows drawn are every reason, which is what lets a move send the whole order. */
  get #searching(): boolean {
    return this.search.trim() !== "";
  }

  #comparison(draft: Draft): string {
    const money = amount(draft.maxAmount);
    const normalizedMoney =
      typeof money === "string"
        ? `${money.split(".")[0]}.${(money.split(".")[1] ?? "").padEnd(2, "0")}`
        : money === null
          ? null
          : { invalid: draft.maxAmount };
    return JSON.stringify({
      kind: draft.kind,
      name: draft.name.trim(),
      names: Object.entries(draft.names)
        .map(([language, text]) => [language, text.trim()])
        .filter(([, text]) => text !== "")
        .sort(([a], [b]) => a!.localeCompare(b!)),
      actions: OFFERS.filter((action) => draft.actions.includes(action)),
      maxPercent:
        percentBp(draft.maxPercent) ??
        (draft.maxPercent.trim() === "" ? null : { invalid: draft.maxPercent }),
      maxAmount: normalizedMoney,
      applyRoles: bySeniority(draft.applyRoles),
      approverRoles: bySeniority(draft.approverRoles),
      noteRequired: draft.noteRequired,
    });
  }

  async #beforeClose(editor: Editor, reason: LeaveReason): Promise<boolean> {
    if (this.editor !== editor || this.busy || !this.isConnected) return false;
    if (!this.#leave) return true;
    const outcome = await this.#leave!.request({ scopes: [editor], reason, proceed() {} });
    return this.editor === editor && this.isConnected && outcome === "proceeded";
  }

  #cancel(editor: Editor): void {
    if (this.editor !== editor || this.busy || !this.isConnected) return;
    if (!this.#leave) this.#close();
    else void this.renderRoot.querySelector("wt-modal")!.requestClose("cancel");
  }
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

  /** Released whenever the delete question closes, so it reports only while one is open. */
  readonly #impactQueries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      const deletion = this.deleting!;
      if (codeOf(error) === "adjustment_reason.not_found") {
        if (!deletion.busy) this.#reasonGone();
        return;
      }
      this.deleting = {
        ...deletion,
        loading: false,
        readError: tf("adjustments.delete_load_error", { reason: codeMessage(codeOf(error)) }),
      };
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

  override disconnectedCallback(): void {
    this.#limitGeneration++;
    this.#limitScope?.dispose();
    this.#limitScope = undefined;
    this.settings = undefined;
    this.limitLoadError = undefined;
    this.limitDraft = undefined;
    this.limitSaving = false;
    this.limitAttempted = false;
    this.limitRefused = undefined;
    this.limitError = undefined;
    this.limitSaved = false;
    this.#reasonScope?.dispose();
    this.#reasonScope = undefined;
    this.#leave = undefined;
    this.#closeGuard = undefined;
    this.editor = undefined;
    this.draft = undefined;
    this.busy = false;
    this.#closeDelete();
    this.#restart();
    this.#moveGeneration++;
    this.#movesOut = 0;
    this.#dragFrom = null;
    this.#readDropped = false;
    super.disconnectedCallback();
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
          const dirty = this.#limitScope?.isDirty();
          this.settings = settings;
          if (!this.#limitScope) {
            this.#limitScope = draftScopeFor(this, {
              id: {},
              parent: this,
              current: () => this.#limitValue(),
              snapshot: (value) => ({ amount: value.amount, roles: [...value.roles] }),
              equal: (a, b) => this.#sameLimit(a, b),
              restore: (value) => {
                this.limitDraft = { amount: value.amount, roles: [...value.roles] };
                this.limitAttempted = false;
                this.limitRefused = undefined;
                this.limitError = undefined;
                this.limitSaved = false;
              },
            }).scope;
          } else if (!dirty) {
            this.limitDraft = undefined;
            this.#limitScope.commit(this.#limitValue());
          }
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
          // An older order would pull rows back under a drag or a keyboard that has moved on.
          if (this.#movesOut > 0 || this.#dragFrom !== null) {
            this.#readDropped = true;
            return;
          }
          this.reasons = reasons;
          this.loadError = undefined;
        },
      );
    } catch {
      this.loadError = t("adjustments.load_error");
    }
  }

  /** `to` indexes the rows drawn, which are every reason while a move is allowed. */
  #move(id: string, to: number, via: "key" | "pointer"): void {
    const from = this.reasons!.findIndex((reason) => reason.id === id);
    this.reasons = reorder(this.reasons!, from, to);
    if (via === "key") this.#saveOrder();
    else this.#dragFrom ??= from;
  }

  #drop(id: string): void {
    const from = this.#dragFrom;
    this.#dragFrom = null;
    const to = this.reasons!.findIndex((reason) => reason.id === id);
    if (from !== null && to !== from) this.#saveOrder();
    else if (this.#movesOut === 0 && this.#readDropped) this.#readAgain();
  }

  #saveOrder(): void {
    const ids = this.reasons!.map((reason) => reason.id);
    const generation = this.#moveGeneration;
    this.actionError = undefined;
    this.#movesOut += 1;
    this.#saving = this.#saving.then(async () => {
      if (generation !== this.#moveGeneration) return;
      try {
        await this.api.reorderReasons(ids);
      } catch {
        if (generation !== this.#moveGeneration) return;
        // Every save waiting behind a refused one names an order built on it.
        this.#moveGeneration++;
        this.#movesOut = 0;
        this.actionError = t("adjustments.reorder_error");
        this.#readAgain();
        return;
      }
      if (generation !== this.#moveGeneration) return;
      this.#movesOut -= 1;
      if (this.#movesOut === 0 && this.#readDropped) this.#readAgain();
    });
  }

  #readAgain(): void {
    this.#readDropped = false;
    void this.#load();
  }

  #open(editor: Editor, opener: HTMLElement): void {
    this.#reasonScope?.dispose();
    this.#reasonScope = undefined;
    this.#leave = undefined;
    this.#opener = opener;
    this.editor = editor;
    this.draft = undefined;
    this.#closeGuard = (reason) => this.#beforeClose(editor, reason);
    this.actionError = undefined;
    this.#restart();
    const reason = editor.reason;
    const kind = reason?.kind ?? "comp";
    this.draft = {
      kind,
      name: reason?.name ?? "",
      names: { ...reason?.names },
      actions: kind === "comp" ? [...(reason?.actions ?? [])] : [],
      maxPercent:
        reason?.maxPercentBp == null ? "" : localDecimal(String(reason.maxPercentBp / 100)),
      maxAmount: reason?.maxAmount == null ? "" : localDecimal(reason.maxAmount),
      applyRoles: [...(reason?.applyRoles ?? NEW_REASON_ROLES)],
      approverRoles: [...(reason?.approverRoles ?? NEW_REASON_ROLES)],
      noteRequired: reason?.noteRequired ?? false,
    };
    const draft = draftScopeFor(this, {
      id: editor,
      parent: this,
      current: () => this.draft!,
      snapshot: copyDraft,
      equal: (a, b) => this.#comparison(a) === this.#comparison(b),
      restore: (value) => {
        this.draft = copyDraft(value);
      },
    });
    this.#leave = draft.coordinator;
    this.#reasonScope = draft.scope;
  }

  #close(): void {
    this.#reasonScope?.dispose();
    this.#reasonScope = undefined;
    this.#leave = undefined;
    this.#closeGuard = undefined;
    this.editor = undefined;
    this.draft = undefined;
    this.#restart();
    const opener = this.#opener;
    void this.updateComplete.then(() => {
      if (this.editor === undefined && opener?.isConnected) opener.focus();
    });
  }

  #restart(): void {
    this.attempted = false;
    this.refusedFields = {};
    this.editorError = undefined;
  }

  #edit(patch: Partial<Draft>, editor: Editor): void {
    if (this.editor !== editor || !this.isConnected) return;
    this.draft = { ...this.draft!, ...patch };
    const refused = { ...this.refusedFields };
    for (const key of Object.keys(patch)) delete refused[key as Field];
    this.refusedFields = refused;
    this.#reasonScope?.changed();
  }

  #check(): FieldErrors {
    const draft = this.draft!;
    const errors: FieldErrors = {};
    if (draft.name.trim() === "") errors.name = t("adjustments.error.name");
    if (draft.kind === "void") return errors;
    if (draft.applyRoles.length === 0) errors.applyRoles = t("adjustments.error.applyRoles");
    if (draft.approverRoles.length === 0) {
      errors.approverRoles = t("adjustments.error.approverRoles");
    }
    if (draft.actions.length === 0) errors.actions = t("adjustments.error.actions");
    const percent = percentBp(draft.maxPercent);
    if (percent === undefined) {
      errors.maxPercent = t("adjustments.error.maxPercent");
    } else if (percent !== null && percent < 10000 && draft.actions.includes("comp")) {
      errors.maxPercent = t("adjustments.error.free_over_limit");
    }
    if (amount(draft.maxAmount) === undefined) errors.maxAmount = t("adjustments.error.maxAmount");
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
    const common = { name: draft.name.trim(), names, noteRequired: draft.noteRequired };
    if (draft.kind === "void") {
      return {
        ...common,
        kind: "void",
        actions: ["cancel"],
        maxPercentBp: null,
        maxAmount: null,
        applyRoles: [],
        approverRoles: [],
      };
    }
    return {
      ...common,
      kind: "comp",
      actions: OFFERS.filter((action) => draft.actions.includes(action)),
      maxPercentBp: percentBp(draft.maxPercent)!,
      maxAmount: amount(draft.maxAmount)!,
      applyRoles: bySeniority(draft.applyRoles),
      approverRoles: bySeniority(draft.approverRoles),
    };
  }

  #refused(error: unknown): void {
    const code = codeOf(error);
    const params = (error as { params?: { field?: unknown; withNote?: unknown } }).params;
    const field = params?.field;
    if (code === "adjustment_reason.void_required") {
      const withNote = params?.withNote === true;
      const message = t(
        withNote ? "adjustments.error.void_required_note" : "adjustments.error.void_required",
      );
      this.refusedFields = { [withNote ? "noteRequired" : "kind"]: message };
    } else if (
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

  async #write(action: () => Promise<unknown>): Promise<void> {
    if (this.busy) return;
    const editor = this.editor;
    const scope = this.#reasonScope!;
    const submitted = this.draft!;
    this.busy = true;
    try {
      await action();
    } catch (error) {
      if (this.editor === editor && this.isConnected) this.#refused(error);
      return;
    } finally {
      if (this.editor === editor) this.busy = false;
    }
    if (this.editor !== editor || !this.isConnected) return;
    scope.commit(submitted);
    if (!scope.isDirty()) {
      this.renderRoot.querySelector("wt-modal")?.closeAfter("saved");
      this.#close();
    }
    await this.#load();
    if (this.editor !== undefined || !this.isConnected) return;
    await this.updateComplete;
    if (this.#opener?.isConnected === false)
      this.renderRoot.querySelector<HTMLElement>('[data-test="add-reason"]')?.focus();
  }

  #save(editor: Editor): void {
    if (this.editor !== editor || !this.isConnected || this.busy) return;
    if (saveActionState(this.#reasonScope).unchanged) return;
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

  #openDelete(reason: AdjustmentReason, opener: HTMLElement): void {
    this.actionError = undefined;
    this.#closeDelete();
    this.#deletion = {};
    this.deleting = {
      reasonId: reason.id,
      opener,
      impact: null,
      loading: true,
      readError: "",
      actionError: "",
      busy: false,
    };
    this.#readImpact();
  }

  #closeDelete(): void {
    this.#impactQueries.release("delete-impact");
    this.#deletion = undefined;
    this.deleting = undefined;
  }

  /** Deleted elsewhere: the question closes, the page says so and the list is read again. */
  #reasonGone(): void {
    this.#closeDelete();
    this.actionError = codeMessage("adjustment_reason.not_found");
    void this.#load();
  }

  #readImpact(): void {
    const deletion = this.deleting!;
    this.deleting = { ...deletion, loading: true, readError: "" };
    this.api
      .watchReasonDeleteImpact(this.#impactQueries, deletion.reasonId, (impact) => {
        this.deleting = { ...this.deleting!, impact, loading: false, readError: "" };
      })
      .catch(() => undefined);
  }

  /** Words a refused delete as the impact read's refusal would be worded. */
  #deleteRefusal(error: unknown): string {
    const code = codeOf(error);
    if (code !== "adjustment_reason.void_required") return codeMessage(code);
    const withNote = (error as { params?: { withNote?: unknown } }).params?.withNote;
    return reasonDeleteCopy().refusal({
      code,
      params: { withNote: withNote ? 1 : 0 },
      targets: [],
    });
  }

  async #delete(reasonId: string): Promise<void> {
    const deletion = this.deleting!;
    if (deletion.busy) return;
    const current = this.#deletion;
    const shown = this.#shown();
    const at = shown.findIndex((reason) => reason.id === reasonId);
    const focusId = (shown[at + 1] ?? shown[at - 1])?.id;
    this.deleting = { ...deletion, busy: true, actionError: "" };
    try {
      await this.api.deleteReason(reasonId);
    } catch (error) {
      if (current !== this.#deletion) return;
      if (codeOf(error) === "adjustment_reason.not_found") {
        this.#reasonGone();
        return;
      }
      this.deleting = {
        ...this.deleting,
        busy: false,
        actionError: tf("adjustments.delete_error", { reason: this.#deleteRefusal(error) }),
      };
      return;
    }
    if (current !== this.#deletion) return;
    this.#closeDelete();
    await this.#load();
    await this.updateComplete;
    (
      this.renderRoot.querySelector<HTMLElement>(`tr[data-reason="${focusId}"] wt-row-actions`) ??
      this.renderRoot.querySelector<HTMLElement>('[data-test="add-reason"]')
    )?.focus();
  }

  #deleteDialog() {
    const deletion = this.deleting;
    if (!deletion) return nothing;
    const current = this.#deletion;
    return keyed(
      current,
      html`<wt-delete-dialog
        data-test="delete-reason"
        .open=${true}
        .impact=${deletion.impact}
        .loading=${deletion.loading}
        .submitting=${deletion.busy}
        .readError=${deletion.readError}
        .actionError=${deletion.actionError}
        .copy=${reasonDeleteCopy()}
        .opener=${deletion.opener}
        @wt-delete-confirm=${(event: CustomEvent<{ id: string }>) => {
          event.stopPropagation();
          if (current === this.#deletion) void this.#delete(event.detail.id);
        }}
        @wt-delete-retry=${(event: Event) => {
          event.stopPropagation();
          if (current === this.#deletion) this.#readImpact();
        }}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (current === this.#deletion && !this.deleting!.busy) this.#closeDelete();
        }}
      ></wt-delete-dialog>`,
    );
  }

  #limitValue(): LimitDraft {
    if (this.limitDraft !== undefined) return this.limitDraft;
    const saved = this.settings!.maxBillComp;
    return {
      amount: saved === null ? "" : localDecimal(saved),
      roles: [...this.settings!.billApproverRoles],
    };
  }

  #sameLimit(a: LimitDraft, b: LimitDraft): boolean {
    if (bySeniority(a.roles).join() !== bySeniority(b.roles).join()) return false;
    const left = money(a.amount);
    const right = money(b.amount);
    return left === undefined || right === undefined
      ? a.amount.trim() === b.amount.trim()
      : left === right;
  }

  #limitCheck(): LimitErrors {
    const value = this.#limitValue();
    const errors: LimitErrors = {};
    if (money(value.amount) === undefined) errors.maxBillComp = t(LIMIT_MESSAGES.maxBillComp);
    if (value.roles.length === 0) {
      errors.billApproverRoles = t(LIMIT_MESSAGES.billApproverRoles);
    }
    return errors;
  }

  #limitEdit(patch: Partial<LimitDraft>, field: LimitField): void {
    this.limitDraft = { ...this.#limitValue(), ...patch };
    this.#limitScope?.changed();
    if (this.limitRefused === field) this.limitRefused = undefined;
    this.limitSaved = false;
  }

  async #focusLimit(): Promise<void> {
    await this.updateComplete;
    await focusFirstInvalid(this.renderRoot.querySelector('[data-test="limit"]')!);
  }

  /** A refresh that fails after the save succeeded is a load failure, shown as one. */
  async #saveLimit(): Promise<void> {
    if (this.limitSaving || saveActionState(this.#limitScope).unchanged) return;
    this.limitAttempted = true;
    this.limitRefused = undefined;
    this.limitError = undefined;
    this.limitSaved = false;
    if (Object.keys(this.#limitCheck()).length > 0) {
      await this.#focusLimit();
      return;
    }
    this.limitSaving = true;
    const generation = this.#limitGeneration;
    const submitted = this.#limitValue();
    let settings: AdjustmentSettings;
    try {
      settings = await this.api.saveSettings({
        maxBillComp: money(submitted.amount)!,
        billApproverRoles: bySeniority(submitted.roles),
      });
    } catch (error) {
      if (generation !== this.#limitGeneration || !this.isConnected) return;
      const field = (error as { params?: { field?: unknown } }).params?.field;
      if (
        codeOf(error) === "management.request_invalid" &&
        typeof field === "string" &&
        Object.hasOwn(LIMIT_MESSAGES, field)
      ) {
        this.limitRefused = field as LimitField;
        void this.#focusLimit();
      } else {
        this.limitError = codeMessage(codeOf(error));
      }
      return;
    } finally {
      if (generation === this.#limitGeneration) this.limitSaving = false;
    }
    if (generation !== this.#limitGeneration || !this.isConnected) return;
    const unchanged = this.#sameLimit(this.#limitValue(), submitted);
    this.settings = settings;
    if (unchanged) this.limitDraft = undefined;
    this.#limitScope?.commit(submitted);
    this.limitAttempted = false;
    this.limitSaved = true;
    await this.#loadSettings();
  }

  #limitSection() {
    return html`<section class="limit" data-test="limit" aria-labelledby="limit-heading">
      <h2 id="limit-heading">${t("adjustments.limit.heading")}</h2>
      ${
        this.limitLoadError
          ? html`<p class="alert" role="alert" data-test="limit-alert">${this.limitLoadError}</p>`
          : nothing
      }
      ${this.settings ? this.#limitForm() : nothing}
    </section>`;
  }

  #limitForm() {
    const own = this.limitAttempted ? this.#limitCheck() : {};
    const errors: LimitErrors = { ...own };
    if (this.limitRefused && !errors[this.limitRefused]) {
      errors[this.limitRefused] = t(LIMIT_MESSAGES[this.limitRefused]);
    }
    const value = this.#limitValue();
    const bottom = [
      ...(this.limitError ? [this.limitError] : []),
      ...(Object.keys(errors).length > 0 ? [t("adjustments.fix_fields")] : []),
    ].join(" ");
    return html`<div class="limit-fields">
        <wt-price-input
          name="maxBillComp"
          fixed-unit
          locale=${currentLocale()}
          label=${t("adjustments.limit.field")}
          placeholder=${t("adjustments.no_limit")}
          hint=${t("adjustments.limit.hint")}
          .value=${value.amount}
          .error=${errors.maxBillComp ?? ""}
          .disabled=${this.limitSaving}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#limitEdit({ amount: event.detail.value }, "maxBillComp");
          }}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(event, this.renderRoot.querySelector('[data-test="save-limit"]'))}
        ></wt-price-input>
        ${this.#roleList({
          name: "billApproverRoles",
          label: t("adjustments.limit.approvers"),
          values: value.roles,
          current: () => (this.settings ? this.#limitValue().roles : []),
          error: errors.billApproverRoles ?? "",
          disabled: this.limitSaving,
          change: (roles) => this.#limitEdit({ roles }, "billApproverRoles"),
        })}
      </div>
      ${
        this.limitSaved
          ? html`<p role="status" data-test="limit-saved">${t("adjustments.limit.saved")}</p>`
          : nothing
      }
      <wt-form-actions .error=${bottom}
        ><wt-button
          variant=${saveActionState(this.#limitScope).variant}
          data-test="save-limit"
          ?disabled=${
            saveActionState(this.#limitScope).unchanged ||
            this.limitSaving ||
            Object.keys(own).length > 0
          }
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
    return parts;
  }

  /** One line each, or a dash for none. */
  #lines(lines: readonly string[]) {
    return lines.length === 0
      ? t("adjustments.none")
      : lines.map((line) => html`<div>${line}</div>`);
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
    return html`<wt-row-actions
      align="end"
      label=${`${t("adjustments.column.actions")}: ${reason.name}`}
    >
      ${item(`edit-${reason.id}`, t("adjustments.edit"), (opener) =>
        this.#open({ reason }, opener),
      )}
      ${item(`delete-${reason.id}`, t("adjustments.delete"), (opener) =>
        this.#openDelete(reason, opener),
      )}
    </wt-row-actions>`;
  }

  /** The rows drawn, in list order; called only once the reasons have loaded. */
  #shown(): AdjustmentReason[] {
    const found = new Set(
      searchBy(this.search, this.reasons!, (reason) => [
        reason.name,
        ...Object.values(reason.names),
      ]),
    );
    return this.reasons!.filter((reason) => found.has(reason));
  }

  #row(reason: AdjustmentReason) {
    const isVoid = reason.kind === "void";
    return html`<tr data-reason=${reason.id}>
      <td class="handle-cell">${this.#reorder.handle(reason.id)}</td>
      <td>
        <span class="reason-name">${reason.name}</span>
        ${
          reason.noteRequired
            ? html`<wt-lozenge>${t("adjustments.note_required")}</wt-lozenge>`
            : nothing
        }
      </td>
      <td><wt-lozenge>${kindName(reason.kind)}</wt-lozenge></td>
      <td>${isVoid ? t("adjustments.none") : rolesText(reason.applyRoles)}</td>
      <td>${isVoid ? t("adjustments.none") : rolesText(reason.approverRoles)}</td>
      <td>${this.#lines(this.#limits(reason))}</td>
      <td class="actions-cell">${this.#rowMenu(reason)}</td>
    </tr>`;
  }

  #table(rows: readonly AdjustmentReason[]) {
    const note = t(this.#searching ? "adjustments.order_note_searching" : "adjustments.order_note");
    if (rows.length === 0)
      return html`<p role="status" data-test="no-matches">${tableNoMatches()}</p>
        <p class="hint">${note}</p>`;
    return html`<div
        class="table-wrap"
        tabindex="0"
        role="region"
        aria-label=${t("adjustments.title")}
        data-test="reasons"
      >
        <table>
          <thead>
            <tr>
              <th scope="col" class="handle-cell">
                <span class="visually-hidden">${t("adjustments.reorder")}</span>
              </th>
              <th scope="col">${t("adjustments.column.name")}</th>
              <th scope="col">${t("adjustments.column.kind")}</th>
              <th scope="col">${t("adjustments.column.apply_roles")}</th>
              <th scope="col">${t("adjustments.column.approver_roles")}</th>
              <th scope="col">${t("adjustments.column.limits")}</th>
              <th scope="col" class="actions-cell">
                <span class="visually-hidden">${t("adjustments.column.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            ${repeat(
              rows,
              (reason) => reason.id,
              (reason) => this.#row(reason),
            )}
          </tbody>
        </table>
      </div>
      <p class="hint">${note}</p>`;
  }

  #fieldError(errors: FieldErrors, field: Field) {
    const message = errors[field];
    return message
      ? html`<p id=${`error-${field}`} class="field-error" data-field-error=${field}>${message}</p>`
      : nothing;
  }

  /** `current` names the chosen roles on the closed field: the combobox hands `countLabel` only the
   * count, and a closing editor's list still draws after its draft is gone. */
  #roleList(list: {
    name: string;
    label: string;
    hint?: string;
    values: readonly PersonRole[];
    current: () => readonly PersonRole[];
    error: string;
    disabled: boolean;
    change: (roles: PersonRole[]) => void;
  }) {
    const locale = currentLocale();
    const collator = new Intl.Collator(locale, { sensitivity: "base" });
    const roles = [...ROLES_BY_SENIORITY].sort((a, b) =>
      collator.compare(roleName(a, locale), roleName(b, locale)),
    );
    return html`<wt-combobox
      name=${list.name}
      multiple
      required
      label=${list.label}
      hint=${list.hint ?? ""}
      search="auto"
      .options=${roles.map((role) => ({ value: role, label: roleName(role) }))}
      .values=${list.values}
      .countLabel=${() => rolesText(list.current())}
      error=${list.error}
      .disabled=${list.disabled}
      @wt-change=${(event: CustomEvent<{ values: string[] }>) => {
        event.stopPropagation();
        list.change(event.detail.values as PersonRole[]);
      }}
    ></wt-combobox>`;
  }

  #reasonRoles(errors: FieldErrors, field: "applyRoles" | "approverRoles") {
    const editor = this.editor!;
    const words = field === "applyRoles" ? "apply_roles" : "approver_roles";
    return this.#roleList({
      name: field,
      label: t(`adjustments.field.${words}`),
      hint: t(`adjustments.field.${words}_hint`),
      values: this.draft![field],
      current: () => this.draft?.[field] ?? [],
      error: errors[field] ?? "",
      disabled: this.busy,
      change: (roles) => this.#edit({ [field]: roles }, editor),
    });
  }

  #compFields(errors: FieldErrors) {
    const draft = this.draft!;
    const editor = this.editor!;
    const text = (field: "maxPercent" | "maxAmount") => ({
      value: draft[field],
      error: errors[field] ?? "",
      change: (event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.#edit({ [field]: event.detail.value }, editor);
      },
    });
    const percent = text("maxPercent");
    const money = text("maxAmount");
    return html`${this.#reasonRoles(errors, "applyRoles")}
      ${this.#reasonRoles(errors, "approverRoles")}
      <fieldset class="offers" aria-describedby=${errors.actions ? "error-actions" : nothing}>
        <legend>
          ${t("adjustments.field.actions")}<span class="required" aria-hidden="true">*</span>
        </legend>
        <div class="offer-choices">
          ${OFFERS.map(
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
                    if (this.editor !== editor || !this.isConnected) return;
                    const checked = (event.target as HTMLInputElement).checked;
                    const actions = this.draft!.actions.filter((each) => each !== action);
                    this.#edit({ actions: checked ? [...actions, action] : actions }, editor);
                  }}
                />${actionChoice(action)}</label
              >`,
          )}
        </div>
        ${this.#fieldError(errors, "actions")}
      </fieldset>
      <wt-price-input
        name="maxPercent"
        decimal-locale=${currentLocale()}
        unit="%"
        fixed-unit
        label=${t("adjustments.field.max_percent")}
        placeholder=${t("adjustments.no_limit")}
        hint=${t("adjustments.field.max_percent_hint")}
        .value=${percent.value}
        .error=${percent.error}
        .disabled=${this.busy}
        @wt-change=${percent.change}
      ></wt-price-input>
      <wt-price-input
        name="maxAmount"
        fixed-unit
        locale=${currentLocale()}
        label=${t("adjustments.field.max_amount")}
        placeholder=${t("adjustments.no_limit")}
        hint=${t("adjustments.field.max_amount_hint")}
        .value=${money.value}
        .error=${money.error}
        .disabled=${this.busy}
        @wt-change=${money.change}
      ></wt-price-input>`;
  }

  #reasonForm(errors: FieldErrors) {
    const draft = this.draft!;
    const editor = this.editor!;
    const languages = currentContentLanguages().languages;
    const isVoid = draft.kind === "void";
    return html`<wt-segmented-control
        name="kind"
        label=${t("adjustments.field.kind")}
        .options=${KINDS.map((kind) => ({ value: kind, label: kindName(kind) }))}
        .value=${draft.kind}
        error=${errors.kind ?? ""}
        .disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          if (this.editor !== editor || !this.isConnected) return;
          this.#edit({ kind: event.detail.value as ReasonKind, ...COMP_FIELDS_CLEARED }, editor);
        }}
      ></wt-segmented-control>
      <wt-input
        name="name"
        required
        label=${t("adjustments.field.name")}
        .value=${draft.name}
        .error=${errors.name ?? ""}
        .disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.#edit({ name: event.detail.value }, editor);
        }}
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
                if (this.editor !== editor || !this.isConnected) return;
                this.#edit(
                  { names: { ...this.draft!.names, [language]: event.detail.value } },
                  editor,
                );
              }}
            ></wt-input>`,
        )}
        ${this.#fieldError(errors, "names")}
      </fieldset>
      ${isVoid ? nothing : this.#compFields(errors)}
      <div>
        <wt-switch
          name="noteRequired"
          label=${t("adjustments.field.note_required")}
          description=${isVoid ? t("adjustments.field.note_required_void_hint") : ""}
          aria-invalid=${errors.noteRequired ? "true" : nothing}
          .checked=${draft.noteRequired}
          .disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
            event.stopPropagation();
            this.#edit({ noteRequired: event.detail.checked }, editor);
          }}
        ></wt-switch>
        ${
          isVoid
            ? html`<p class="hint" data-test="note-hint">
                ${t("adjustments.field.note_required_void_hint")}
              </p>`
            : nothing
        }
        ${this.#fieldError(errors, "noteRequired")}
      </div>
      ${
        isVoid
          ? html`<p class="hint" data-test="void-rule">${t("adjustments.void_rule")}</p>`
          : nothing
      }`;
  }

  #modal() {
    const editor = this.editor;
    if (editor === undefined) return nothing;
    const heading = t(editor.reason ? "adjustments.edit_heading" : "adjustments.new");
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
        size="standard"
        open
        heading=${heading}
        .beforeClose=${this.#leave ? this.#closeGuard : undefined}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (event.target === event.currentTarget && this.editor === editor) this.#close();
        }}
        .dismissible=${!this.busy}
        @keydown=${(event: KeyboardEvent) => {
          if (this.editor === editor && this.isConnected)
            submitOnEnter(event, this.renderRoot.querySelector('[data-test="save-editor"]'));
        }}
      >
        <div class="form">${this.#reasonForm(errors)}</div>
        <wt-form-actions slot="footer" .error=${bottom}
          ><wt-button
            slot="cancel"
            variant="secondary"
            data-test="cancel-editor"
            ?disabled=${this.busy}
            @click=${() => this.#cancel(editor)}
            >${t("adjustments.cancel")}</wt-button
          ><wt-button
            variant=${saveActionState(this.#reasonScope).variant}
            data-test="save-editor"
            ?disabled=${saveActionState(this.#reasonScope).unchanged || this.busy || invalid}
            @click=${() => this.#save(editor)}
            >${t("adjustments.save")}</wt-button
          ></wt-form-actions
        >
      </wt-modal>`,
    );
  }

  #renderAdd() {
    return html`<wt-button
      variant="primary"
      data-test="add-reason"
      ?disabled=${this.busy}
      @click=${(event: Event) => this.#open({}, event.currentTarget as HTMLElement)}
      >${t("adjustments.add")}</wt-button
    >`;
  }

  #renderSearch() {
    return html`<wt-input
      data-test="search"
      name="search"
      type="search"
      autocomplete="off"
      label=${t("adjustments.search")}
      .value=${this.search}
      @wt-change=${(event: CustomEvent<{ value: string }>) => (this.search = event.detail.value)}
    ></wt-input>`;
  }

  override render() {
    // A read's failure never replaces an action's; a read's recovery clears only its own.
    const alert = this.actionError ?? this.loadError;
    return html`<h1>${t("adjustments.title")}</h1>
      <p class="intro">${t("adjustments.intro")}</p>
      ${alert ? html`<p class="alert" role="alert" data-test="page-alert">${alert}</p>` : nothing}
      ${
        this.reasons?.length === 0
          ? html`<div class="empty">
              <p data-test="empty">${t("adjustments.empty")}</p>
              ${this.#renderAdd()}
            </div>`
          : html`<div class="toolbar">${this.#renderSearch()} ${this.#renderAdd()}</div>
              ${this.reasons ? this.#table(this.#shown()) : nothing}`
      }
      ${this.#reorder.liveRegion()} ${this.#limitSection()} ${this.#modal()} ${this.#deleteDialog()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-adjustment-reasons-screen": AdjustmentReasonsScreen;
  }
}
