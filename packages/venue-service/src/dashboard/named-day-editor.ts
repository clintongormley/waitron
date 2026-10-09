import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { NamedDay } from "../holiday-types.js";
import type { HolidayFact } from "../hours-types.js";
import { holidayDateName } from "../holiday-naming.js";
import { isLocalDate } from "../hours-rules.js";
import { NAMED_DAY_KINDS } from "../named-day-rules.js";
import { t } from "./strings.js";

export type NamedDayInput = Omit<NamedDay, "id" | "hasStationHours">;
type Field = keyof NamedDayInput;
const fields: Field[] = ["date", "name", "kind", "repeats", "ownHours", "closeWholeVenue"];
const copy = (value: NamedDayInput): NamedDayInput => ({ ...value });
const empty = (): NamedDayInput => ({
  date: "",
  name: "",
  kind: "working_day",
  repeats: false,
  ownHours: false,
  closeWholeVenue: false,
});

@customElement("named-day-editor")
export class NamedDayEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .form {
        display: grid;
        gap: var(--wt-space-4);
        padding-block: var(--wt-space-3);
      }
      p {
        margin: 0;
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) day?: NamedDay;
  @property() date = "";
  @property({ attribute: false }) holidays: readonly HolidayFact[] = [];
  @property({ type: Boolean }) ownHours = false;
  @property({ type: Boolean }) savableAtOpen = false;
  @property({ attribute: false }) refusal?: { code: string; params?: Record<string, unknown> };
  @state() private draft = empty();
  @state() private attempted = false;
  private scope?: DraftScope<NamedDayInput>;
  private leave?: LeaveCoordinator;
  private identity?: object;
  private dayId?: string;
  private baseline?: NamedDayInput;
  private suggestion?: string;
  private generation = {};
  private submittedGeneration?: object;

  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.scope?.dispose();
    this.scope = undefined;
    this.leave = undefined;
    this.generation = {};
    super.disconnectedCallback();
  }
  protected override willUpdate() {
    if (!this.open) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.identity = undefined;
      this.baseline = undefined;
      this.generation = {};
      return;
    }
    if (!this.identity || this.dayId !== this.day?.id) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.identity = {};
      this.generation = {};
      this.dayId = this.day?.id;
      const name = holidayDateName(this.holidays, this.date, "");
      this.draft = this.day
        ? {
            date: this.day.date,
            name: this.day.name,
            kind: this.day.kind,
            repeats: this.day.repeats,
            ownHours: this.ownHours || this.day.ownHours,
            closeWholeVenue: this.ownHours ? false : this.day.closeWholeVenue,
          }
        : {
            ...empty(),
            date: this.date,
            name,
            kind: name ? "holiday" : "working_day",
            ownHours: this.ownHours,
          };
      this.suggestion = this.day ? undefined : name;
      this.baseline = copy(this.input);
      this.attempted = false;
      this.refusal = undefined;
    }
    if (this.suggestion !== undefined) {
      const name = holidayDateName(this.holidays, this.draft.date, "");
      if (name !== this.suggestion) {
        this.draft = { ...this.draft, name };
        this.suggestion = name;
        this.scope?.changed();
      }
    }
    if (this.isConnected && !this.scope) {
      const { scope, coordinator } = draftScopeFor(this, {
        id: this.identity,
        current: () => this.input,
        snapshot: copy,
        equal: (a, b) => fields.every((field) => a[field] === b[field]),
        restore: (value) => {
          this.draft = copy(value);
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit(this.baseline!);
    }
  }
  private get input(): NamedDayInput {
    return {
      ...this.draft,
      name: this.draft.name.trim(),
      ownHours: this.draft.closeWholeVenue ? false : this.draft.ownHours,
    };
  }
  private get ownErrors(): Partial<Record<Field, string>> {
    const errors: Partial<Record<Field, string>> = {};
    if (!isLocalDate(this.draft.date)) errors.date = t("named.date_required");
    if (!this.input.name) errors.name = t("prep.name_required");
    if (!NAMED_DAY_KINDS.includes(this.draft.kind)) errors.kind = t("named.field_refused");
    return errors;
  }
  private refusalField(): Field | undefined {
    if (this.refusal?.code === "special_date.date_taken") return "date";
    const field = this.refusal?.params?.field;
    return this.refusal?.code === "hours.invalid" &&
      fields.includes(field as Field) &&
      !(field === "ownHours" && this.draft.closeWholeVenue)
      ? (field as Field)
      : undefined;
  }
  private error(field: Field): string {
    if (this.refusalField() === field) {
      if (this.refusal?.code === "special_date.date_taken") return t("named.date_taken");
      return t(field === "repeats" ? "named.station_hours" : "named.field_refused");
    }
    return this.attempted ? (this.ownErrors[field] ?? "") : "";
  }
  private changed(field: Field, value: NamedDayInput[Field]) {
    this.draft = { ...this.draft, [field]: value };
    if (field === "name") this.suggestion = undefined;
    if (field === "date" && this.suggestion !== undefined) {
      const name = holidayDateName(this.holidays, this.draft.date, "");
      this.draft = { ...this.draft, name };
      this.suggestion = name;
    }
    if (this.refusalField() === field) this.refusal = undefined;
    this.scope?.changed();
  }
  private actionState() {
    return saveActionState(this.scope, { savableAtOpen: this.savableAtOpen });
  }
  private save() {
    if (!this.open || !this.isConnected || this.busy || this.actionState().unchanged) return;
    this.attempted = true;
    this.refusal = undefined;
    if (Object.keys(this.ownErrors).length) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.submittedGeneration = this.generation;
    this.dispatchEvent(
      new CustomEvent("named-day-save", {
        detail: { id: this.day?.id ?? null, input: copy(this.input) },
        bubbles: true,
        composed: true,
      }),
    );
  }
  commitSubmitted(input: NamedDayInput): boolean {
    if (!this.open || !this.isConnected || this.submittedGeneration !== this.generation)
      return false;
    this.baseline = copy(input);
    this.scope?.commit(input);
    return !this.scope?.isDirty();
  }
  private readonly beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (!this.isConnected || this.busy) return false;
    if (!this.scope || !this.leave) return true;
    const generation = this.generation;
    const outcome = await this.leave.request({ scopes: [this.scope.id], reason, proceed() {} });
    return this.isConnected && generation === this.generation && outcome === "proceeded";
  };
  override render(): unknown {
    if (!this.open) return nothing;
    const action = this.actionState();
    const generation = this.generation;
    const current = () =>
      this.isConnected && this.open && !this.busy && generation === this.generation;
    const change =
      (field: Field, switched = false) =>
      (event: CustomEvent<{ value: string; checked: boolean }>) => {
        event.stopPropagation();
        if (current())
          this.changed(
            field,
            switched
              ? event.detail.checked
              : field === "ownHours"
                ? event.detail.value === "own"
                : event.detail.value,
          );
      };
    const leap = this.draft.repeats && this.draft.date.slice(5) === "02-29";
    const bottom = this.refusal && this.refusalField() === undefined ? t("prep.save_error") : "";
    return keyed(
      generation,
      html`<wt-modal
        open
        size="compact"
        heading=${t(this.day ? "named.edit" : "named.new")}
        .dismissible=${!this.busy}
        .beforeClose=${this.beforeClose}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (current()) {
            this.open = false;
            this.dispatchEvent(
              new CustomEvent("named-day-close", { bubbles: true, composed: true }),
            );
          }
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (current())
            submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save-named-day]"));
        }}
      >
        <div class="form">
          <wt-input
            name="date"
            type="date"
            label=${t("named.date")}
            required
            .value=${this.draft.date}
            .error=${this.error("date")}
            ?disabled=${this.busy}
            @wt-change=${change("date")}
          ></wt-input>
          <wt-input
            name="name"
            label=${t("prep.name")}
            required
            .value=${this.draft.name}
            .error=${this.error("name")}
            ?disabled=${this.busy}
            @wt-change=${change("name")}
          ></wt-input>
          <wt-combobox
            name="kind"
            label=${t("named.kind")}
            search="never"
            .value=${this.draft.kind}
            .error=${this.error("kind")}
            .options=${NAMED_DAY_KINDS.map((value) => ({ value, label: t(`named.${value}`) }))}
            ?disabled=${this.busy}
            @wt-change=${change("kind")}
          ></wt-combobox>
          <div>
            <wt-switch
              name="repeats"
              label=${t("named.repeats")}
              .checked=${this.draft.repeats}
              .description=${[leap ? t("named.leap") : "", this.error("repeats")].filter(Boolean).join(" ")}
              ?disabled=${this.busy}
              @wt-change=${change("repeats", true)}
            ></wt-switch>
            ${leap ? html`<p>${t("named.leap")}</p>` : nothing}
            ${this.error("repeats") ? html`<p class="error" role="alert" data-error="repeats">${this.error("repeats")}</p>` : nothing}
          </div>
          <div>
            <wt-switch
              name="closeWholeVenue"
              label=${t("named.close")}
              .checked=${this.draft.closeWholeVenue}
              .description=${this.error("closeWholeVenue")}
              ?disabled=${this.busy}
              @wt-change=${change("closeWholeVenue", true)}
            ></wt-switch>
            ${this.error("closeWholeVenue") ? html`<p class="error" role="alert" data-error="closeWholeVenue">${this.error("closeWholeVenue")}</p>` : nothing}
          </div>
          ${
            this.draft.closeWholeVenue
              ? nothing
              : html`<wt-combobox
                  name="ownHours"
                  label=${t("named.hours")}
                  search="never"
                  .value=${this.draft.ownHours ? "own" : "week"}
                  .error=${this.error("ownHours")}
                  .options=${[
                    { value: "week", label: t("named.week") },
                    { value: "own", label: t("named.own") },
                  ]}
                  ?disabled=${this.busy}
                  @wt-change=${change("ownHours")}
                ></wt-combobox>`
          }
          ${this.day?.repeats && this.ownHours ? html`<p>${t("named.every_year")}</p>` : nothing}
        </div>
        <wt-form-actions
          slot="footer"
          .error=${[bottom, fields.some((field) => this.error(field)) ? t("prep.fix_fields") : ""].filter(Boolean).join(" ")}
        >
          <wt-button
            slot="cancel"
            variant="secondary"
            ?disabled=${this.busy}
            @click=${() => {
              if (current())
                void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
            }}
            >${t("prep.cancel")}</wt-button
          >
          <wt-button
            data-test="save-named-day"
            variant=${action.variant}
            ?disabled=${action.unchanged || this.busy || (this.attempted && Object.keys(this.ownErrors).length > 0)}
            ?loading=${this.busy}
            @click=${() => {
              if (current()) this.save();
            }}
            >${t("prep.save")}</wt-button
          >
        </wt-form-actions>
      </wt-modal>`,
    );
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "named-day-editor": NamedDayEditor;
  }
}
