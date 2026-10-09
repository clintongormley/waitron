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
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { HoursModel } from "../hours-types.js";
import { repeatedTimes } from "../hours-occurrences.js";
import type { NamedDaysApi } from "./named-days-client.js";
import { isLocalDate } from "../hours-rules.js";
import { format, formatDate, isDefaultStation, keyOf, storedCells } from "./hours-view.js";
import { t } from "./strings.js";

@customElement("named-day-copy")
export class NamedDayCopy extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .form {
        display: grid;
        gap: var(--wt-space-3);
        padding-block: var(--wt-space-3);
      }
      .target {
        display: flex;
        align-items: end;
        gap: var(--wt-space-2);
      }
      wt-input {
        flex: 1;
        min-width: 0;
      }
      p {
        margin: 0;
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) day!: {
    id: string;
    name: string;
    date?: string;
    closeWholeVenue?: boolean;
  };
  @property({ attribute: false }) api?: NamedDaysApi;
  @state() private hours?: HoursModel;
  @state() private readError = "";
  private detach?: () => void;
  private watched?: object;
  @property({ attribute: false }) refusal?: { code: string; params?: Record<string, unknown> };
  @state() private dates = [""];
  @state() private attempted = false;
  private scope?: DraftScope<string[]>;
  private leave?: LeaveCoordinator;
  private identity?: object;
  private dayId?: string;
  private baseline = [""];
  private generation = {};
  private submittedGeneration?: object;
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.detach?.();
    this.detach = undefined;
    this.watched = undefined;
    this.scope?.dispose();
    this.scope = undefined;
    this.leave = undefined;
    this.generation = {};
    super.disconnectedCallback();
  }
  protected override willUpdate() {
    if (!this.open) {
      this.detach?.();
      this.detach = undefined;
      this.watched = undefined;
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.identity = undefined;
      this.generation = {};
      return;
    }
    if (!this.identity || this.dayId !== this.day?.id) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.detach?.();
      this.detach = undefined;
      this.watched = undefined;
      this.hours = undefined;
      this.readError = "";
      this.identity = {};
      this.generation = {};
      this.dayId = this.day?.id;
      this.dates = [""];
      this.baseline = [""];
      this.attempted = false;
      this.refusal = undefined;
    }
    if (this.isConnected && !this.scope) {
      const { scope, coordinator } = draftScopeFor(this, {
        id: this.identity,
        current: () => this.dates,
        snapshot: (v) => [...v],
        equal: (a, b) => a.length === b.length && a.every((value, index) => value === b[index]),
        restore: (value) => {
          this.dates = [...value];
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit(this.baseline);
    }
  }
  protected override updated() {
    if (
      !this.open ||
      !this.isConnected ||
      !this.api ||
      !this.day?.date ||
      this.watched === this.generation
    )
      return;
    const generation = this.generation;
    this.watched = generation;
    this.detach = this.api.watchDayHours(
      this.day.date,
      (model) => {
        if (!this.isConnected || generation !== this.generation) return;
        this.hours = model;
        this.readError = "";
      },
      () => {
        if (this.isConnected && generation === this.generation)
          this.readError = t("hours.load_error");
      },
    );
  }
  private repeatNotes(date: string) {
    const model = this.hours;
    if (!model || !model.clockReadable || this.day.closeWholeVenue || !isLocalDate(date))
      return nothing;
    const cells = storedCells(model, this.day.id);
    return model.subjects
      .filter((subject) => subject.active && !isDefaultStation(subject))
      .flatMap((subject) => {
        const cell = cells.find((entry) => keyOf(entry.subject) === keyOf(subject))?.cell;
        return cell?.mode === "periods"
          ? repeatedTimes(date, cell.periods, model.timeZone).map(
              (time) =>
                html`<p data-test="duplicate-repeat-note">
                  ${format("hours.duplicate_time_repeats", { subject: subject.name, date: formatDate(date), time })}
                </p>`,
            )
          : [];
      });
  }
  private errors() {
    return this.dates.map((date, index) =>
      !isLocalDate(date)
        ? t("named.date_required")
        : this.dates.indexOf(date) !== index
          ? t("named.duplicate_target")
          : "",
    );
  }
  private error(index: number) {
    if (
      this.refusal?.code === "special_date.date_taken" &&
      this.refusal.params?.date === this.dates[index]
    )
      return t("named.date_taken");
    if (this.refusal?.code === "hours.invalid" && this.refusal.params?.field === `dates.${index}`)
      return t("named.field_refused");
    return this.attempted ? this.errors()[index]! : "";
  }
  private changed(dates: string[]) {
    this.dates = dates;
    this.refusal = undefined;
    this.scope?.changed();
  }
  private save() {
    if (!this.open || !this.isConnected || this.busy || saveActionState(this.scope).unchanged)
      return;
    this.attempted = true;
    this.refusal = undefined;
    if (this.errors().some(Boolean)) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.submittedGeneration = this.generation;
    this.dispatchEvent(
      new CustomEvent("named-day-copy-save", {
        detail: { id: this.day.id, dates: [...this.dates] },
        bubbles: true,
        composed: true,
      }),
    );
  }
  commitSubmitted(dates: string[]): boolean {
    if (!this.open || !this.isConnected || this.submittedGeneration !== this.generation)
      return false;
    this.baseline = [...dates];
    this.scope?.commit(dates);
    return !this.scope?.isDirty();
  }
  private readonly beforeClose = async (reason: LeaveReason) => {
    if (!this.isConnected || this.busy) return false;
    if (!this.scope || !this.leave) return true;
    const generation = this.generation;
    const outcome = await this.leave.request({ scopes: [this.scope.id], reason, proceed() {} });
    return this.isConnected && generation === this.generation && outcome === "proceeded";
  };
  override render(): unknown {
    if (!this.open) return nothing;
    const generation = this.generation;
    const current = () =>
      this.isConnected && this.open && !this.busy && generation === this.generation;
    const action = saveActionState(this.scope);
    return keyed(
      generation,
      html`<wt-modal
        open
        size="compact"
        heading=${format("named.copy_heading", { name: this.day.name })}
        .dismissible=${!this.busy}
        .beforeClose=${this.beforeClose}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (current()) {
            this.open = false;
            this.dispatchEvent(
              new CustomEvent("named-day-copy-close", { bubbles: true, composed: true }),
            );
          }
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (current())
            submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save-copy]"));
        }}
      >
        <div class="form">
          <p>${t("named.copy_note")}</p>
          ${this.readError ? html`<p role="alert" data-test="copy-read-error">${this.readError}</p>` : nothing}
          ${this.dates.map(
            (date, index) =>
              html`<div class="target">
                  <wt-input
                    type="date"
                    required
                    name=${`dates.${index}`}
                    label=${format("hours.target_date", { n: String(index + 1) })}
                    .value=${date}
                    .error=${this.error(index)}
                    ?disabled=${this.busy}
                    @wt-change=${(event: CustomEvent<{ value: string }>) => {
                      event.stopPropagation();
                      if (current())
                        this.changed(
                          this.dates.map((v, i) => (i === index ? event.detail.value : v)),
                        );
                    }}
                  ></wt-input>
                  ${
                    this.dates.length > 1
                      ? html`<wt-button
                          variant="secondary"
                          data-test=${`remove-target-${index}`}
                          aria-label=${format("hours.remove_target", { n: String(index + 1) })}
                          ?disabled=${this.busy}
                          @click=${() => {
                            if (current()) this.changed(this.dates.filter((_, i) => i !== index));
                          }}
                          >${t("hours.remove")}</wt-button
                        >`
                      : nothing
                  }
                </div>
                ${this.repeatNotes(date)}`,
          )}
          <div>
            <wt-button
              variant="secondary"
              data-test="add-target"
              ?disabled=${this.busy}
              @click=${() => {
                if (current()) this.changed([...this.dates, ""]);
              }}
              >${t("hours.add_target")}</wt-button
            >
          </div>
        </div>
        <wt-form-actions
          slot="footer"
          .error=${this.refusal || this.dates.some((_, i) => this.error(i)) ? t(this.refusal ? "prep.save_error" : "prep.fix_fields") : ""}
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
            data-test="save-copy"
            variant=${action.variant}
            ?disabled=${action.unchanged || this.busy || (this.attempted && this.errors().some(Boolean))}
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
    "named-day-copy": NamedDayCopy;
  }
}
