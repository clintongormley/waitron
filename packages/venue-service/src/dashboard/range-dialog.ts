import { LitElement, css, html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { customElement, property, state } from "lit/decorators.js";
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
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { ServiceRange } from "../service-day.js";
import { t } from "./strings.js";
import { format } from "./hours-view.js";
import { addDays } from "../hours-rules.js";
import { localTimeOccurrences } from "../hours-occurrences.js";

type Field = keyof ServiceRange;
const copy = (input: ServiceRange): ServiceRange => ({ ...input });
const equal = (a: ServiceRange, b: ServiceRange) =>
  a.startsAt === b.startsAt && a.endsAt === b.endsAt && a.periodId === b.periodId;
const clock = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const minute = (time: string, cutover: string) => (clock(time) - clock(cutover) + 1440) % 1440;
const span = (range: ServiceRange, cutover: string) => ({
  start: minute(range.startsAt, cutover),
  end: minute(range.endsAt, cutover) || 1440,
});

@customElement("range-dialog")
export class RangeDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .fields {
        display: grid;
        gap: var(--wt-space-4);
        padding-block: var(--wt-space-3);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) deletable = false;
  @property({ attribute: false }) businessDate?: string;
  @property({ attribute: false }) timeZone?: string;
  @property() dayCutover = "06:00";
  @property({ attribute: false }) range: ServiceRange = { startsAt: "", endsAt: "", periodId: "" };
  @property({ attribute: false }) periods: readonly { id: string; name: string }[] = [];
  @property({ attribute: false }) occupied: readonly ServiceRange[] = [];
  @state() private draft: ServiceRange = copy(this.range);
  @state() private attempted = false;
  private baseline?: ServiceRange;
  private scope?: DraftScope<ServiceRange>;
  private leave?: LeaveCoordinator;
  private identity?: object;
  private generation = {};
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
    if (!this.identity) {
      this.identity = {};
      this.generation = {};
      this.draft = copy(this.range);
      this.baseline = copy(this.range);
      this.attempted = false;
    }
    if (this.isConnected && !this.scope) {
      const { coordinator, scope } = draftScopeFor(this, {
        id: this.identity,
        current: () => this.draft,
        snapshot: copy,
        equal,
        restore: (value) => {
          this.draft = copy(value);
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit(this.baseline!);
    }
  }
  private get errors(): Partial<Record<Field, string>> {
    const errors: Partial<Record<Field, string>> = {};
    for (const field of ["startsAt", "endsAt"] as const) {
      const time = this.draft[field];
      if (!time)
        errors[field] = t(field === "startsAt" ? "opening.start_required" : "opening.end_required");
      else if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) errors[field] = t("opening.valid_time");
      else if (clock(time) % 15 !== 0) errors[field] = t("opening.time_step");
    }
    if (!errors.startsAt && !errors.endsAt) {
      const current = span(this.draft, this.dayCutover);
      if (current.end <= current.start) errors.endsAt = t("opening.range_order");
      else if (
        this.occupied.some((range) => {
          const neighbour = span(range, this.dayCutover);
          return current.start < neighbour.end && neighbour.start < current.end;
        })
      )
        errors.endsAt = t("menu.slot_overlap");
    }
    if (!this.periods.some((period) => period.id === this.draft.periodId))
      errors.periodId = t("menu.period_required");
    return errors;
  }
  private repeatedTimes(): string[] {
    if (!this.businessDate || !this.timeZone || this.errors.startsAt || this.errors.endsAt)
      return [];
    const times = new Set<string>();
    for (const field of ["startsAt", "endsAt"] as const) {
      const time = this.draft[field];
      const nextDay = time < this.dayCutover || (field === "endsAt" && time === this.dayCutover);
      const date = nextDay ? addDays(this.businessDate, 1) : this.businessDate;
      if (localTimeOccurrences(date, time, this.timeZone).length > 1) times.add(time);
    }
    return [...times];
  }
  private changed(field: Field, value: string) {
    this.draft = { ...this.draft, [field]: value };
    this.scope?.changed();
  }
  choosePeriod(id: string) {
    if (this.open && this.isConnected && this.periods.some((period) => period.id === id))
      this.changed("periodId", id);
  }
  private emit(name: string, detail: object) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  private save() {
    if (!this.open || !this.isConnected || this.busy || saveActionState(this.scope).unchanged)
      return;
    this.attempted = true;
    if (Object.keys(this.errors).length) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    const input = copy(this.draft);
    this.scope?.commit(input);
    this.open = false;
    this.emit("range-save", { input });
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
    const state = saveActionState(this.scope);
    const errors = this.attempted ? this.errors : {};
    const generation = this.generation;
    const current = () =>
      generation === this.generation && this.isConnected && this.open && !this.busy;
    return keyed(
      generation,
      html`<wt-modal
        open
        size="compact"
        heading=${t("opening.range_heading")}
        .dismissible=${!this.busy}
        .beforeClose=${this.beforeClose}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (current()) {
            this.open = false;
            this.emit("range-close", {});
          }
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (current())
            submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save-range]"));
        }}
      >
        <div class="fields">
          ${(["startsAt", "endsAt"] as const).map(
            (field) =>
              html`<wt-input
                name=${field}
                type="time"
                .step=${900}
                label=${t(field === "startsAt" ? "menu.starts" : "menu.ends")}
                required
                .value=${this.draft[field]}
                .error=${errors[field] ?? ""}
                ?disabled=${this.busy}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  if (current()) this.changed(field, event.detail.value);
                }}
              ></wt-input>`,
          )}
          <wt-combobox
            name="periodId"
            label=${t("menu.slot_period")}
            required
            search="never"
            .value=${this.draft.periodId}
            .options=${[...this.periods.map((period) => ({ value: period.id, label: period.name })), { value: "new", label: t("opening.new_period"), action: true as const }]}
            .error=${errors.periodId ?? ""}
            ?disabled=${this.busy}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              if (current()) this.changed("periodId", event.detail.value);
            }}
            @wt-combobox-action=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              if (current() && event.detail.value === "new")
                this.emit("range-new-period", { input: copy(this.draft) });
            }}
          ></wt-combobox>
          ${this.repeatedTimes().map((time) => html`<p data-test="repeat-note">${format("menu.time_repeats", { time })}</p>`)}
        </div>
        <wt-form-actions
          slot="footer"
          .error=${Object.keys(errors).length ? t("menu.fix_fields") : ""}
        >
          <wt-button
            slot="cancel"
            variant="secondary"
            ?disabled=${this.busy}
            @click=${() => {
              if (current())
                void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
            }}
            >${t("menu.cancel")}</wt-button
          >
          ${
            this.deletable
              ? html`<wt-button
                  data-test="delete-range"
                  variant="danger"
                  ?disabled=${this.busy}
                  @click=${() => {
                    if (current()) {
                      this.scope?.commit(this.draft);
                      this.open = false;
                      this.emit("range-delete", {});
                    }
                  }}
                  >${t("menu.delete")}</wt-button
                >`
              : nothing
          }
          <wt-button
            data-test="save-range"
            variant=${state.variant}
            ?disabled=${state.unchanged || this.busy || (this.attempted && Object.keys(this.errors).length > 0)}
            @click=${() => {
              if (current()) this.save();
            }}
            >${t("menu.save")}</wt-button
          >
        </wt-form-actions>
      </wt-modal>`,
    );
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "range-dialog": RangeDialog;
  }
}
