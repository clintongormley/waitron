import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  leaveCoordinatorFor,
  saveActionState,
  type DraftScope,
  type LeaveReason,
  type WtModal,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import { fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { wholeWithin } from "../widgets/form-fields.js";
import {
  MAX_SEATS,
  addJoin,
  rekeyWith,
  sendChange,
  tableName,
  type FloorPlanDraft,
} from "./floor-plan-draft.js";

const MIN_SEATS = 1;

interface JoinForm {
  tableKey: string;
  others: string[];
  seats: string;
}

const copyForm = (form: JoinForm): JoinForm => ({ ...form, others: [...form.others] });

/** The anchor is not input: a save answer may re-key it while the dialog is open. */
function sameForm(a: JoinForm, b: JoinForm): boolean {
  return (
    a.seats === b.seats &&
    a.others.length === b.others.length &&
    a.others.every((key) => b.others.includes(key))
  );
}

interface JoinErrors {
  tables: string;
  seats: string;
}

const failing = (errors: JoinErrors): boolean => errors.tables !== "" || errors.seats !== "";

/** Add waits, drawn quiet, until a table and the seats are chosen. */
const complete = (form: JoinForm, present: readonly string[]): boolean =>
  present.length > 0 && form.seats !== "";

/** The editor's Add join dialog. The page owns it, outside the side panel, which is re-created
 *  when the page crosses its narrow width and would take an open dialog with it. */
@customElement("floor-plan-add-join")
export class FloorPlanAddJoin extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) draft!: FloorPlanDraft;
  /** The page's join keys, so a key never repeats one in the draft, its history or a save. */
  @property({ attribute: false }) nextJoinKey!: () => string;
  /** The page's draft scope, so a leave that asks about the page asks about Add join too. */
  @property({ attribute: false }) draftParent: object | undefined;

  @state() private form: JoinForm | null = null;
  /** Set by a refused Add; from then on the dialog shows its problems as they are fixed. */
  @state() private checked = false;

  readonly #id = {};
  #scope?: DraftScope<JoinForm>;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override willUpdate(): void {
    if (this.form === null || this.#scope || !this.isConnected) return;
    const opened = copyForm(this.form);
    this.#scope = draftScopeFor<JoinForm>(this, {
      id: this.#id,
      parent: this.draftParent,
      current: () => this.form ?? opened,
      snapshot: copyForm,
      equal: sameForm,
      restore: (value) => {
        if (this.form !== null) this.form = value;
      },
    }).scope;
  }

  override disconnectedCallback(): void {
    this.#close();
    super.disconnectedCallback();
  }

  show(tableKey: string): void {
    if (this.form !== null) return;
    this.checked = false;
    this.form = { tableKey, others: [], seats: "" };
  }

  /** Follows the page's re-keying of its draft after a save answer. */
  rekey(ids: Readonly<Record<string, string>>): void {
    const form = this.form;
    if (form === null) return;
    const rekey = rekeyWith(ids);
    this.form = { ...form, tableKey: rekey(form.tableKey), others: form.others.map(rekey) };
    this.#scope?.changed();
  }

  #close(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.form = null;
    this.checked = false;
  }

  #modal(): WtModal | null {
    return this.renderRoot.querySelector<WtModal>("wt-modal[data-dialog=add-join]");
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    const coordinator = leaveCoordinatorFor(this);
    if (coordinator === undefined) return true;
    return (
      (await coordinator.request({ scopes: [this.#id], reason, proceed() {} })) === "proceeded"
    );
  };

  #edit(patch: Partial<JoinForm>): void {
    if (this.form === null) return;
    this.form = { ...this.form, ...patch };
    this.#scope?.changed();
  }

  #options(form: JoinForm): { value: string; label: string }[] {
    return this.draft.tables
      .filter((table) => table.key !== form.tableKey)
      .map((table) => ({ value: table.key, label: tableName(table) }));
  }

  #heading(form: JoinForm): string {
    const name = tableName(this.draft.tables.find((table) => table.key === form.tableKey));
    return fill("floor_plan_editor.join_heading", { name });
  }

  /** The chosen tables the draft still holds. */
  #present(form: JoinForm): string[] {
    return form.others.filter((key) => this.draft.tables.some((t) => t.key === key));
  }

  #errors(form: JoinForm, present: readonly string[]): JoinErrors {
    const members = new Set([form.tableKey, ...present]);
    const joined = this.draft.joins.some(
      (join) =>
        join.tableKeys.length === members.size && join.tableKeys.every((key) => members.has(key)),
    );
    return {
      tables: joined ? t("floor_plan_editor.already_joined") : "",
      seats:
        wholeWithin(form.seats, MIN_SEATS, MAX_SEATS) === null
          ? t("floor_plan_editor.join_seats_invalid")
          : "",
    };
  }

  #add(): void {
    const form = this.form;
    if (form === null || saveActionState(this.#scope).unchanged) return;
    const present = this.#present(form);
    if (!complete(form, present)) return;
    if (failing(this.#errors(form, present))) {
      this.checked = true;
      void this.updateComplete.then(() => {
        const modal = this.#modal();
        if (modal !== null) void focusFirstInvalid(modal);
      });
      return;
    }
    if (!this.draft.tables.some((t) => t.key === form.tableKey)) {
      this.#scope?.commit(copyForm(form));
      this.#modal()?.closeAfter("saved");
      this.#close();
      return;
    }
    const draft = addJoin(
      this.draft,
      [form.tableKey, ...present],
      wholeWithin(form.seats, MIN_SEATS, MAX_SEATS)!,
      this.nextJoinKey(),
    );
    sendChange(this, draft);
    this.#scope?.commit(copyForm(form));
    this.#modal()?.closeAfter("saved");
    this.#close();
  }

  override render() {
    const form = this.form;
    const present = form === null ? [] : this.#present(form);
    const shown = form !== null && this.checked ? this.#errors(form, present) : null;
    const blocked = shown !== null && failing(shown);
    const action = saveActionState(this.#scope);
    const able = form !== null && complete(form, present) && !action.unchanged;
    return html`<wt-modal
      data-dialog="add-join"
      size="standard"
      heading=${form === null ? "" : this.#heading(form)}
      .open=${form !== null}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) this.#close();
      }}
    >
      ${
        form === null
          ? nothing
          : html`<div class="fields">
              <wt-combobox
                name="join-tables"
                multiple
                required
                label=${t("floor_plan_editor.tables")}
                .options=${this.#options(form)}
                .values=${present}
                .error=${shown?.tables ?? ""}
                @wt-change=${(e: CustomEvent<{ values: string[] }>) => {
                  e.stopPropagation();
                  this.#edit({ others: [...e.detail.values] });
                }}
              ></wt-combobox>
              <wt-number-stepper
                name="join-seats"
                required
                label=${t("floor_plan_editor.seats")}
                .min=${MIN_SEATS}
                .max=${MAX_SEATS}
                .value=${form.seats}
                .error=${shown?.seats ?? ""}
                @wt-change=${(e: CustomEvent<{ value: string }>) => {
                  e.stopPropagation();
                  this.#edit({ seats: e.detail.value });
                }}
              ></wt-number-stepper>
            </div>`
      }
      <wt-form-actions slot="footer" .error=${blocked ? t("form.fix_fields") : ""}
        ><wt-button
          slot="cancel"
          variant="secondary"
          data-action="join-cancel"
          @click=${() => void this.#modal()?.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        ><wt-button
          data-action="join-confirm"
          variant=${able ? action.variant : "secondary"}
          ?disabled=${!able || blocked}
          @click=${() => this.#add()}
          >${t("action.add")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "floor-plan-add-join": FloorPlanAddJoin;
  }
}
