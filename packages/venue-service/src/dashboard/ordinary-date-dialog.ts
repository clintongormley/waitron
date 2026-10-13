import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import type { LocalDate } from "../hours-types.js";
import { format, formatDayMonthYear, formatWeekday } from "./hours-view.js";
import { seasonTintStyles } from "./season-tint.js";
import { t } from "./strings.js";

/** A date with no special day: it says which season's week it follows and offers the three ways
 *  to change it. It writes nothing; each choice is an event the host acts on. */
@customElement("ordinary-date-dialog")
export class OrdinaryDateDialog extends LitElement {
  static override styles = [
    baseStyles,
    seasonTintStyles,
    css`
      :host {
        display: block;
      }
      .head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-3);
        margin-block-end: var(--wt-space-4);
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        overflow-wrap: anywhere;
      }
      .chip {
        padding: var(--wt-space-1) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full);
      }
      .chip[data-tint] {
        background: var(--season-tint);
        color: var(--season-on-tint);
        border-color: var(--season-tint-line);
      }
      p {
        margin: 0;
      }
      .body {
        display: grid;
        gap: var(--wt-space-4);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-3);
      }
      .muted {
        color: var(--wt-color-text-muted);
      }
      wt-combobox {
        min-width: 0;
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property() date: LocalDate | "" = "";
  /** The season whose week the date follows; absent, the dialog names none and offers no week. */
  @property({ attribute: false }) season?: { id: string; name: string };
  /** The season's tint as the month draws it (`seasonTints`), "1" to "4". */
  @property() tint = "";
  @property({ attribute: false }) specialDays: readonly { id: string; name: string }[] = [];
  /** Where focus goes once the dialog closes: the clicked date, or its redrawn button. */
  @property({ attribute: false }) returnTo?: () => HTMLElement | null;
  @state() private chosen = "";
  private generation = {};

  protected override willUpdate(changed: Map<PropertyKey, unknown>) {
    if (changed.has("open") || changed.has("date")) {
      this.chosen = "";
      this.generation = {};
    }
  }
  private emit(name: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  private async handBack() {
    await this.updateComplete;
    this.returnTo?.()?.focus();
  }
  /** The modal goes first so the page behind it is no longer inert and can take focus back
   *  before the host acts. */
  private async act(name: string, detail: unknown) {
    if (!this.open) return;
    this.open = false;
    await this.handBack();
    this.emit(name, detail);
  }
  private follows(season: string) {
    const [before, after = ""] = t("ordinary.follows").split("{season}");
    return html`<p data-test="follows">${before}<strong>${season}</strong>${after}</p>`;
  }
  private addRow() {
    if (this.specialDays.length === 0) return nothing;
    const chosen = this.specialDays.some((day) => day.id === this.chosen) ? this.chosen : "";
    return html`<div class="row" data-test="add-row">
      <span class="muted" data-test="add-label">${t("ordinary.add_to_existing")}</span>
      <wt-combobox
        name="specialDayId"
        label=${t("calendar.special_day")}
        hide-label
        search="auto"
        placeholder=${t("calendar.special_day")}
        .value=${chosen}
        .options=${this.specialDays.map((day) => ({ value: day.id, label: day.name }))}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.chosen = event.detail.value;
        }}
      ></wt-combobox>
      <wt-button
        data-test="add-to-special"
        variant=${chosen ? "primary" : "secondary"}
        ?disabled=${!chosen}
        @click=${() => {
          if (chosen)
            void this.act("ordinary-date-add-to-special", {
              date: this.date,
              specialDayId: chosen,
            });
        }}
        >${t("special.add")}</wt-button
      >
    </div>`;
  }
  override render(): unknown {
    if (!this.open || !this.date) return nothing;
    const title = format("ordinary.title", {
      weekday: formatWeekday(this.date, "long"),
      date: formatDayMonthYear(this.date),
    });
    const season = this.season;
    return keyed(
      this.generation,
      html`<wt-modal
        open
        size="compact"
        aria-label=${title}
        @wt-close=${() => {
          if (!this.open) return;
          this.open = false;
          void this.handBack();
        }}
      >
        <div class="head">
          <wt-button
            data-test="dismiss"
            variant="ghost"
            aria-label=${t("ordinary.close")}
            @click=${() => void this.shadowRoot!.querySelector("wt-modal")?.requestClose("cancel")}
            ><wt-icon name="close"></wt-icon
          ></wt-button>
          <h2 data-test="date">${title}</h2>
          ${
            season
              ? html`<span class="chip" data-test="season" data-tint=${this.tint || nothing}
                  >${season.name}</span
                >`
              : nothing
          }
        </div>
        <div class="body">
          ${season ? this.follows(season.name) : nothing}
          <div class="row">
            ${
              season
                ? html`<wt-button
                    data-test="edit-week"
                    variant="secondary"
                    @click=${() => void this.act("ordinary-date-edit-week", { seasonId: season.id })}
                    >${format("ordinary.edit_week", { season: season.name })}</wt-button
                  >`
                : nothing
            }
            <wt-button
              data-test="make-special"
              variant="primary"
              @click=${() => void this.act("ordinary-date-make-special", { date: this.date })}
              >${t("special.make")}</wt-button
            >
          </div>
          ${this.addRow()}
        </div>
      </wt-modal>`,
    );
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "ordinary-date-dialog": OrdinaryDateDialog;
  }
}
