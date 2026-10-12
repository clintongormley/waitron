import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  leaveCoordinatorFor,
  saveActionState,
  type ComboboxOption,
  type DraftScope,
  type LeaveReason,
  type WtModal,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import { fill, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { wholeWithin } from "../widgets/form-fields.js";
import {
  MAX_SEATS,
  addJoinedTable,
  freeTables,
  sendChange,
  tableName,
  type FloorPlanDraft,
} from "./floor-plan-draft.js";

interface JoinedForm {
  name: string;
  seats: string;
  parts: string[];
}

interface JoinedErrors {
  name: string;
  seats: string;
  parts: string;
}

const copyForm = (form: JoinedForm): JoinedForm => ({ ...form, parts: [...form.parts] });

function sameForm(a: JoinedForm, b: JoinedForm): boolean {
  return (
    a.name === b.name &&
    a.seats === b.seats &&
    a.parts.length === b.parts.length &&
    a.parts.every((key) => b.parts.includes(key))
  );
}

const seatCount = (seats: number) =>
  seats === 1
    ? t("floor_plan_editor.seat_count_one")
    : fill("floor_plan_editor.seat_count", { count: String(seats) });

const tablesChosen = (count: number) =>
  fill("floor_plan_editor.tables_chosen", { count: String(count) });

/** The editor's Add joined table dialog, owned by the page beside Add tables for the same reason. */
@customElement("floor-plan-add-joined-table")
export class FloorPlanAddJoinedTable extends LitElement {
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
  @property({ attribute: false }) takenElsewhere: ReadonlySet<string> = new Set();
  @property({ attribute: false }) nextKey!: () => string;
  @property({ attribute: false }) draftParent: object | undefined;

  @state() private form: JoinedForm | null = null;
  /** Set by a refused Add; from then on the dialog shows its problems as they are fixed. */
  @state() private checked = false;

  readonly #id = {};
  #scope?: DraftScope<JoinedForm>;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override willUpdate(): void {
    if (this.form === null || this.#scope || !this.isConnected) return;
    const opened = copyForm(this.form);
    this.#scope = draftScopeFor<JoinedForm>(this, {
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

  show(): void {
    if (this.form !== null) return;
    this.checked = false;
    this.form = { name: "", seats: "", parts: [] };
  }

  #close(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.form = null;
    this.checked = false;
  }

  #modal(): WtModal | null {
    return this.renderRoot.querySelector<WtModal>("wt-modal[data-dialog=add-joined-table]");
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    const coordinator = leaveCoordinatorFor(this);
    if (coordinator === undefined) return true;
    return (
      (await coordinator.request({ scopes: [this.#id], reason, proceed() {} })) === "proceeded"
    );
  };

  #edit(patch: Partial<JoinedForm>): void {
    if (this.form === null) return;
    this.form = { ...this.form, ...patch };
    this.#scope?.changed();
  }

  /** The chosen tables that are still free, in case the draft changed under the open dialog. */
  #parts(form: JoinedForm): string[] {
    const free = new Set(freeTables(this.draft).map((table) => table.key));
    return form.parts.filter((key) => free.has(key));
  }

  #errors(form: JoinedForm): JoinedErrors {
    const label = form.name.trim();
    const used = new Set([...this.draft.tables.map((t) => t.label.trim()), ...this.takenElsewhere]);
    return {
      name:
        label === ""
          ? t("floor_plan_editor.name_missing")
          : used.has(label)
            ? codeMessage("table.label_taken")
            : "",
      seats:
        wholeWithin(form.seats, 1, MAX_SEATS) === null
          ? t("floor_plan_editor.joined_seats_invalid")
          : "",
      parts: this.#parts(form).length < 2 ? t("floor_plan_editor.parts_too_few") : "",
    };
  }

  #failing(errors: JoinedErrors): boolean {
    return errors.name !== "" || errors.seats !== "" || errors.parts !== "";
  }

  #add(): void {
    const form = this.form;
    if (form === null || saveActionState(this.#scope).unchanged) return;
    if (this.#failing(this.#errors(form))) {
      this.checked = true;
      void this.updateComplete.then(() => {
        const modal = this.#modal();
        if (modal !== null) void focusFirstInvalid(modal);
      });
      return;
    }
    const draft = addJoinedTable(
      this.draft,
      {
        label: form.name.trim(),
        seats: wholeWithin(form.seats, 1, MAX_SEATS),
        parts: this.#parts(form),
      },
      this.nextKey,
    );
    sendChange(this, draft);
    this.#scope?.commit(copyForm(form));
    this.#modal()?.closeAfter("saved");
    this.#close();
  }

  #options(): ComboboxOption[] {
    return freeTables(this.draft).map((table) => ({
      value: table.key,
      label: tableName(table),
      ...(table.seats === null ? {} : { description: seatCount(table.seats) }),
    }));
  }

  override render() {
    const form = this.form;
    const shown = this.checked && form !== null ? this.#errors(form) : null;
    const failing = shown !== null && this.#failing(shown);
    const action = saveActionState(this.#scope);
    const options = form === null ? [] : this.#options();
    const value = (event: CustomEvent<{ value: string }>) => {
      event.stopPropagation();
      return event.detail.value;
    };
    return html`<wt-modal
      data-dialog="add-joined-table"
      size="standard"
      heading=${t("floor_plan_editor.add_joined_table")}
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
              <wt-input
                name="table-name"
                required
                label=${t("floor_plan_editor.name")}
                .value=${form.name}
                .error=${shown?.name ?? ""}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#edit({ name: value(e) })}
              ></wt-input>
              <wt-number-stepper
                name="seats"
                required
                label=${t("floor_plan_editor.seats")}
                .min=${1}
                .max=${MAX_SEATS}
                .value=${form.seats}
                .error=${shown?.seats ?? ""}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#edit({ seats: value(e) })}
              ></wt-number-stepper>
              <wt-combobox
                multiple
                required
                name="made-of"
                search="never"
                label=${t("floor_plan_editor.made_of")}
                placeholder=${options.length === 0 ? t("floor_plan_editor.no_free_tables") : ""}
                .countLabel=${tablesChosen}
                .options=${options}
                .values=${form.parts}
                .error=${shown?.parts ?? ""}
                @wt-change=${(e: CustomEvent<{ values: string[] }>) => {
                  e.stopPropagation();
                  this.#edit({ parts: [...e.detail.values] });
                }}
              ></wt-combobox>
            </div>`
      }
      <wt-form-actions slot="footer" .error=${failing ? t("form.fix_fields") : ""}
        ><wt-button
          slot="cancel"
          variant="secondary"
          data-action="add-cancel"
          @click=${() => void this.#modal()?.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        ><wt-button
          data-action="add-confirm"
          variant=${action.variant}
          ?disabled=${failing || action.unchanged}
          @click=${() => this.#add()}
          >${t("action.add")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "floor-plan-add-joined-table": FloorPlanAddJoinedTable;
  }
}
