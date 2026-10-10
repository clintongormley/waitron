import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  automaticNames,
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
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import "@waitron/ui/src/components/wt-switch.js";
import { fill, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { wholeWithin } from "../widgets/form-fields.js";
import { MAX_SEATS, addTables, sendChange, type FloorPlanDraft } from "./floor-plan-draft.js";

const MAX_TABLES = 100;

interface AddForm {
  count: string;
  seats: string;
  naming: "automatic" | "custom";
  prefix: string;
  /** One per table of the last valid count, so a count typed through a blank keeps the names. */
  names: string[];
  fixed: boolean;
}

interface AddErrors {
  count: string;
  seats: string;
  names: string[];
}

const copyForm = (form: AddForm): AddForm => ({ ...form, names: [...form.names] });

function sameForm(a: AddForm, b: AddForm): boolean {
  return (
    a.count === b.count &&
    a.seats === b.seats &&
    a.naming === b.naming &&
    a.prefix === b.prefix &&
    a.fixed === b.fixed &&
    a.names.length === b.names.length &&
    a.names.every((name, i) => name === b.names[i])
  );
}

/** The editor's Add tables dialog. The page owns it, outside the side panel, which is re-created
 *  when the page crosses its narrow width and would take an open dialog with it. */
@customElement("floor-plan-add-tables")
export class FloorPlanAddTables extends LitElement {
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
      .preview {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  @property({ attribute: false }) draft!: FloorPlanDraft;
  @property() zoneName = "";
  @property({ attribute: false }) takenElsewhere: ReadonlySet<string> = new Set();
  @property({ attribute: false }) nextKey!: () => string;
  /** The page's draft scope, so a leave that asks about the page asks about Add tables too. */
  @property({ attribute: false }) draftParent: object | undefined;

  @state() private addForm: AddForm | null = null;
  /** Set by a refused Add; from then on the dialog shows its problems as they are fixed. */
  @state() private addChecked = false;

  readonly #addId = {};
  #addScope?: DraftScope<AddForm>;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override willUpdate(): void {
    if (this.addForm === null || this.#addScope || !this.isConnected) return;
    const opened = copyForm(this.addForm);
    this.#addScope = draftScopeFor<AddForm>(this, {
      id: this.#addId,
      parent: this.draftParent,
      current: () => this.addForm ?? opened,
      snapshot: copyForm,
      equal: sameForm,
      restore: (value) => {
        if (this.addForm !== null) this.addForm = value;
      },
    }).scope;
  }

  override disconnectedCallback(): void {
    this.#closeAdd();
    super.disconnectedCallback();
  }

  show(): void {
    if (this.addForm !== null) return;
    this.addChecked = false;
    this.addForm = {
      count: "1",
      seats: "4",
      naming: "automatic",
      prefix: this.zoneName,
      names: [""],
      fixed: false,
    };
  }

  #closeAdd(): void {
    this.#addScope?.dispose();
    this.#addScope = undefined;
    this.addForm = null;
    this.addChecked = false;
  }

  #modal(): WtModal | null {
    return this.renderRoot.querySelector<WtModal>("wt-modal[data-dialog=add-tables]");
  }

  readonly #beforeAddClose = async (reason: LeaveReason): Promise<boolean> => {
    const coordinator = leaveCoordinatorFor(this);
    if (coordinator === undefined) return true;
    return (
      (await coordinator.request({ scopes: [this.#addId], reason, proceed() {} })) === "proceeded"
    );
  };

  #edit(patch: Partial<AddForm>): void {
    const form = this.addForm;
    if (form === null) return;
    const next = { ...form, ...patch };
    const count = wholeWithin(next.count, 1, MAX_TABLES);
    if (count !== null && count !== next.names.length) {
      next.names = Array.from({ length: count }, (_, i) => next.names[i] ?? "");
    }
    this.addForm = next;
    this.#addScope?.changed();
  }

  #used(): Set<string> {
    return new Set([...this.draft.tables.map((t) => t.label.trim()), ...this.takenElsewhere]);
  }

  #automatic(form: AddForm, count: number): string[] {
    return automaticNames(form.prefix, this.#used(), count);
  }

  #errors(form: AddForm): AddErrors {
    const count = wholeWithin(form.count, 1, MAX_TABLES);
    const seatsValid = form.seats.trim() === "" || wholeWithin(form.seats, 0, MAX_SEATS) !== null;
    const errors: AddErrors = {
      count: count === null ? t("floor_plan_editor.count_invalid") : "",
      seats: seatsValid ? "" : t("floor_plan_editor.seats_invalid"),
      names: form.names.map(() => ""),
    };
    if (form.naming === "custom" && count !== null) {
      const used = this.#used();
      errors.names = form.names.map((name) => {
        const label = name.trim();
        if (label === "") return t("floor_plan_editor.name_missing");
        if (used.has(label)) return codeMessage("table.label_taken");
        used.add(label);
        return "";
      });
    }
    return errors;
  }

  #failing(errors: AddErrors): boolean {
    return errors.count !== "" || errors.seats !== "" || errors.names.some((e) => e !== "");
  }

  #add(): void {
    const form = this.addForm;
    if (form === null) return;
    if (this.#failing(this.#errors(form))) {
      this.addChecked = true;
      void this.updateComplete.then(() => {
        const modal = this.#modal();
        if (modal !== null) void focusFirstInvalid(modal);
      });
      return;
    }
    const count = wholeWithin(form.count, 1, MAX_TABLES)!;
    const labels =
      form.naming === "custom"
        ? form.names.map((name) => name.trim())
        : this.#automatic(form, count);
    const seats = form.seats.trim() === "" ? null : wholeWithin(form.seats, 0, MAX_SEATS);
    const draft = addTables(
      this.draft,
      labels.map((label) => ({ label, seats, fixed: form.fixed })),
      this.nextKey,
    );
    sendChange(this, draft);
    this.#addScope?.commit(copyForm(form));
    this.#modal()?.closeAfter("saved");
    this.#closeAdd();
  }

  #hint(form: AddForm): string {
    const count = wholeWithin(form.count, 1, MAX_TABLES);
    if (count === null) return "";
    const names = this.#automatic(form, count);
    return count === 1
      ? names[0]!
      : fill("floor_plan_editor.name_range", { first: names[0]!, last: names.at(-1)! });
  }

  override render() {
    const form = this.addForm;
    const errors = form === null ? null : this.#errors(form);
    const shown = this.addChecked ? errors : null;
    const failing = shown !== null && this.#failing(shown);
    const action = saveActionState(this.#addScope, { savableAtOpen: true });
    const value = (event: CustomEvent<{ value: string }>) => {
      event.stopPropagation();
      return event.detail.value;
    };
    return html`<wt-modal
      data-dialog="add-tables"
      size="standard"
      heading=${t("floor_plan_editor.add_tables")}
      .open=${form !== null}
      .beforeClose=${this.#beforeAddClose}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) this.#closeAdd();
      }}
    >
      ${
        form === null
          ? nothing
          : html`<div class="fields">
              <wt-number-stepper
                name="table-count"
                required
                label=${t("floor_plan_editor.table_count")}
                .min=${1}
                .max=${MAX_TABLES}
                .value=${form.count}
                .error=${shown?.count ?? ""}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#edit({ count: value(e) })}
              ></wt-number-stepper>
              <wt-number-stepper
                name="seats"
                clearable
                label=${t("floor_plan_editor.seats")}
                .min=${0}
                .max=${MAX_SEATS}
                .value=${form.seats}
                .error=${shown?.seats ?? ""}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#edit({ seats: value(e) })}
              ></wt-number-stepper>
              <wt-combobox
                name="naming"
                search="never"
                label=${t("floor_plan_editor.names")}
                .options=${[
                  { value: "automatic", label: t("floor_plan_editor.automatic") },
                  { value: "custom", label: t("floor_plan_editor.custom") },
                ]}
                .value=${form.naming}
                @wt-change=${(e: CustomEvent<{ value: string }>) =>
                  this.#edit({ naming: value(e) === "custom" ? "custom" : "automatic" })}
              ></wt-combobox>
              ${
                form.naming === "automatic"
                  ? html`<wt-input
                        name="prefix"
                        label=${t("floor_plan_editor.prefix")}
                        .value=${form.prefix}
                        @wt-change=${(e: CustomEvent<{ value: string }>) =>
                          this.#edit({ prefix: value(e) })}
                      ></wt-input>
                      <p class="preview" data-preview aria-live="polite">${this.#hint(form)}</p>`
                  : form.names.map(
                      (name, i) =>
                        html`<wt-input
                          name="table-name"
                          required
                          label=${fill("floor_plan_editor.name_n", { n: String(i + 1) })}
                          .value=${name}
                          .error=${shown?.names[i] ?? ""}
                          @wt-change=${(e: CustomEvent<{ value: string }>) =>
                            this.#edit({
                              names: form.names.map((n, j) => (j === i ? value(e) : n)),
                            })}
                        ></wt-input>`,
                    )
              }
              <wt-switch
                name="fixed"
                label=${t("floor_plan_editor.fixed_in_place")}
                .checked=${form.fixed}
                @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
                  e.stopPropagation();
                  this.#edit({ fixed: e.detail.checked });
                }}
              ></wt-switch>
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
          ?disabled=${failing}
          @click=${() => this.#add()}
          >${t("action.add")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "floor-plan-add-tables": FloorPlanAddTables;
  }
}
