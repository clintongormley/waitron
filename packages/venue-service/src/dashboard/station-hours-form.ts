import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import type { WeeklyInterval } from "../routing.js";
import { t } from "./strings.js";

type Row = { weekday: number; opensAt: string; closesAt: string };

@customElement("station-hours-form")
export class StationHoursForm extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .rows {
        display: grid;
        gap: var(--wt-space-4);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: var(--wt-space-2);
      }
      .row > wt-combobox,
      .row > div {
        flex: 1 1 145px;
        min-width: 145px;
        max-width: 170px;
      }
      label {
        display: grid;
        gap: var(--wt-space-1);
      }
      .error {
        color: var(--wt-color-danger);
      }
      .hint {
        color: var(--wt-color-text-muted);
      }
    `,
  ];
  @property({ attribute: false }) hours: readonly WeeklyInterval[] = [];
  @property({ attribute: false }) serverErrors: Record<number, string> = {};
  @property() saveError = "";
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) inDialog = false;
  @state() private rows: Row[] = [];
  @state() private attempted = false;
  private get invalid() {
    return this.rows.some((row) => !row.opensAt || !row.closesAt || row.opensAt === row.closesAt);
  }

  protected override willUpdate(changes: Map<PropertyKey, unknown>) {
    if (changes.has("hours")) this.rows = this.hours.map((row) => ({ ...row }));
  }
  private change(index: number, patch: Partial<Row>) {
    this.serverErrors = Object.fromEntries(
      Object.entries(this.serverErrors).filter(([key]) => Number(key) !== index),
    );
    this.saveError = "";
    this.rows = this.rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
  }
  private cancel() {
    if (!this.busy) this.dispatchEvent(new CustomEvent("hours-cancel"));
  }
  private save() {
    if (this.busy) return;
    this.attempted = true;
    if (this.invalid) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.dispatchEvent(
      new CustomEvent("hours-save", { detail: { hours: this.rows.map((row) => ({ ...row })) } }),
    );
  }
  override render() {
    const content = html`<div class="rows">
      ${this.rows.map((row, index) => {
        const equal = this.attempted && row.opensAt === row.closesAt;
        const message =
          this.serverErrors[index] ??
          (this.attempted && (!row.opensAt || !row.closesAt)
            ? t("prep.time_required")
            : equal
              ? t("venue.time_distinct")
              : "");
        return html`<div class="row" data-test="hours-row">
          <wt-combobox
            name=${`weekday-${index}`}
            data-test=${`weekday-${index}`}
            label=${t("prep.weekday")}
            .value=${String(row.weekday)}
            .options=${[0, 1, 2, 3, 4, 5, 6].map((day) => ({ value: String(day), label: t(`venue.day.${day}` as "venue.day.0") }))}
            @wt-change=${(event: CustomEvent<{ value: string }>) => this.change(index, { weekday: Number(event.detail.value) })}
          >
          </wt-combobox>
          <div>
            <wt-input
              name=${`opens-${index}`}
              data-test=${`opens-${index}`}
              type="time"
              label=${t("prep.opens_at")}
              required
              .value=${row.opensAt}
              aria-invalid=${message ? "true" : "false"}
              .invalid=${Boolean(message)}
              @wt-change=${(event: CustomEvent<{ value: string }>) => this.change(index, { opensAt: event.detail.value })}
            ></wt-input>
            ${message ? html`<span class="error" role="alert" data-field-error=${`hours.${index}`}>${message}</span>` : nothing}
          </div>
          <div>
            <wt-input
              name=${`closes-${index}`}
              data-test=${`closes-${index}`}
              type="time"
              label=${t("prep.closes_at")}
              required
              .value=${row.closesAt}
              aria-invalid=${message ? "true" : "false"}
              .invalid=${Boolean(message)}
              @wt-change=${(event: CustomEvent<{ value: string }>) => this.change(index, { closesAt: event.detail.value })}
            ></wt-input>
            ${message ? html`<span class="error" role="alert" data-field-error=${`hours.${index}`}>${message}</span>` : nothing}
          </div>
          ${row.closesAt && row.opensAt && row.closesAt < row.opensAt ? html`<span class="hint" data-test=${`next-day-${index}`}>${t("prep.until_next_day").replace("{time}", row.closesAt)}</span>` : nothing}
          <wt-button
            variant="secondary"
            aria-label=${`${t("prep.remove_hours")} ${index + 1}`}
            @click=${() => {
              this.rows = this.rows.filter((_, i) => i !== index);
            }}
            >${t("prep.remove_hours")}</wt-button
          >
        </div>`;
      })}
      <wt-button
        variant="secondary"
        data-test="add-hours"
        @click=${() => {
          this.rows = [...this.rows, { weekday: 0, opensAt: "09:00", closesAt: "17:00" }];
        }}
        >${t("prep.add_hours")}</wt-button
      >
      ${this.attempted && this.invalid ? html`<p class="error" role="alert">${t("prep.fix_fields")}</p>` : nothing}
      ${this.saveError ? html`<p class="error" role="alert">${this.saveError}</p>` : nothing}
    </div>`;
    const actions = html`<wt-form-actions slot=${this.inDialog ? "footer" : nothing}
      ><wt-button
        slot="cancel"
        variant="secondary"
        ?disabled=${this.busy}
        @click=${() => this.cancel()}
        >${t("prep.cancel")}</wt-button
      ><wt-button
        data-test="save-hours"
        ?disabled=${this.busy || (this.attempted && this.invalid)}
        @click=${() => this.save()}
        >${t("prep.save")}</wt-button
      ></wt-form-actions
    > `;
    return this.inDialog
      ? html`<wt-modal
          size="wide"
          open
          heading=${t("venue.hours")}
          .dismissible=${!this.busy}
          @wt-close=${() => this.cancel()}
          >${content}${actions}</wt-modal
        >`
      : html`${content}${actions}`;
  }
}
