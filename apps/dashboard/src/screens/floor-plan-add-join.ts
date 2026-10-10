import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
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
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { addJoin, type FloorPlanDraft } from "./floor-plan-draft.js";
import type { FloorPlanChange } from "./floor-plan-editor.js";

const MIN_SEATS = 1;
const MAX_SEATS = 999;

interface JoinForm {
  tableKey: string;
  others: string[];
  seats: string;
}

const copyForm = (form: JoinForm): JoinForm => ({ ...form, others: [...form.others] });

function sameForm(a: JoinForm, b: JoinForm): boolean {
  return (
    a.tableKey === b.tableKey &&
    a.seats === b.seats &&
    a.others.length === b.others.length &&
    a.others.every((key) => b.others.includes(key))
  );
}

function seatsOf(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n < MIN_SEATS || n > MAX_SEATS ? null : n;
}

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
    this.form = { tableKey, others: [], seats: "" };
  }

  #close(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.form = null;
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
      .map((table) => ({
        value: table.key,
        label: table.label.trim() || t("floor_plan_editor.unnamed"),
      }));
  }

  #ready(form: JoinForm): boolean {
    return form.others.length > 0 && seatsOf(form.seats) !== null;
  }

  #add(): void {
    const form = this.form;
    if (form === null || !this.#ready(form) || saveActionState(this.#scope).unchanged) return;
    const draft = addJoin(
      this.draft,
      [form.tableKey, ...form.others],
      seatsOf(form.seats)!,
      this.nextJoinKey(),
    );
    this.dispatchEvent(
      new CustomEvent<FloorPlanChange>("floor-plan-change", {
        detail: { draft },
        bubbles: true,
        composed: true,
      }),
    );
    this.#scope?.commit(copyForm(form));
    this.#modal()?.closeAfter("saved");
    this.#close();
  }

  override render() {
    const form = this.form;
    const action = saveActionState(this.#scope);
    const ready = form !== null && this.#ready(form) && !action.unchanged;
    const seatsError =
      form !== null && form.seats !== "" && seatsOf(form.seats) === null
        ? t("floor_plan_editor.join_seats_invalid")
        : "";
    return html`<wt-modal
      data-dialog="add-join"
      size="standard"
      heading=${t("floor_plan_editor.add_join")}
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
                .values=${form.others}
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
                .error=${seatsError}
                @wt-change=${(e: CustomEvent<{ value: string }>) => {
                  e.stopPropagation();
                  this.#edit({ seats: e.detail.value });
                }}
              ></wt-number-stepper>
            </div>`
      }
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          variant="secondary"
          data-action="join-cancel"
          @click=${() => void this.#modal()?.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        ><wt-button
          data-action="join-confirm"
          variant=${ready ? action.variant : "secondary"}
          ?disabled=${!ready}
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
