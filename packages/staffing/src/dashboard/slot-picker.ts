import type { WorkTimeRuleset } from "@waitron/workforce/roster-validation";
import { candidateWarnings, breachText } from "./rota-warnings.js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { Slot } from "../slots.js";
import type { RotaWeek } from "../staffing-types.js";
import { hours, shiftTime } from "./rota-format.js";
import { dateLabel } from "./format.js";
import { t, tf } from "./strings.js";
import "@waitron/ui/src/components/wt-button.js";

@customElement("slot-picker")
export class SlotPicker extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      section {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        padding: var(--wt-space-3);
      }
      h3 {
        font-size: var(--wt-font-size-md);
        margin: 0 0 var(--wt-space-2);
      }
      button {
        display: block;
        width: 100%;
        text-align: start;
        font: inherit;
        color: var(--wt-color-text);
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        padding: var(--wt-space-2);
        margin-block-end: var(--wt-space-2);
        cursor: pointer;
        overflow-wrap: anywhere;
      }
      button:hover {
        border-color: var(--wt-color-primary);
      }
      button:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: var(--wt-focus-offset);
      }
      button:disabled {
        cursor: wait;
      }
      small {
        display: block;
        color: var(--wt-color-text-muted);
      }
      p {
        margin: var(--wt-space-2) 0;
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) week!: RotaWeek;
  @property({ attribute: false }) pickedSlot!: Slot;
  @property({ attribute: false }) ruleset: WorkTimeRuleset | null = null;
  @property({ type: Boolean }) busy = false;
  @property() error = "";
  @state() private everyone = false;
  #status(personId: string) {
    if (
      this.week.absences.some(
        (a) =>
          a.personId === personId &&
          a.startsOn <= this.pickedSlot.businessDay &&
          a.endsOn >= this.pickedSlot.businessDay,
      )
    )
      return t("staffing.rota.leave");
    const cutover = this.week.days.find(
      (d) => d.businessDay === this.pickedSlot.businessDay,
    )!.cutover;
    const start =
      Date.parse(`${this.pickedSlot.businessDay}T${cutover}:00Z`) + this.pickedSlot.start * 60000;
    const end =
      Date.parse(`${this.pickedSlot.businessDay}T${cutover}:00Z`) + this.pickedSlot.end * 60000;
    const overlapping = this.week.shifts.filter(
      (s) =>
        s.personId === personId &&
        Date.parse(s.startsAt) + s.startsOffsetMinutes * 60000 < end &&
        Date.parse(s.endsAt) + s.endsOffsetMinutes * 60000 > start,
    );
    return overlapping.length
      ? tf("staffing.rota.working", { times: overlapping.map(shiftTime).join(", ") })
      : t("staffing.rota.free");
  }
  override render() {
    if (!this.week || !this.pickedSlot) return nothing;
    const holders = this.week.people.filter((p) =>
      p.staffRoleIds.includes(this.pickedSlot.staffRoleId),
    );
    const people = this.everyone
      ? [
          ...holders,
          ...this.week.people.filter((p) => !p.staffRoleIds.includes(this.pickedSlot.staffRoleId)),
        ]
      : holders;
    const role = this.week.staffRoles.find((r) => r.id === this.pickedSlot.staffRoleId)!;
    return html`<section aria-labelledby="heading">
      <h3 id="heading">
        ${dateLabel(this.pickedSlot.businessDay)} · ${role.name} ·
        ${this.pickedSlot.startsAt}–${this.pickedSlot.endsAt}
      </h3>
      ${!holders.length ? html`<p>${t("staffing.rota.no_holders")}</p>` : nothing}
      ${people.map(
        (p) =>
          html`<button
            data-person=${p.personId}
            ?disabled=${this.busy}
            @click=${() => {
              if (!this.busy)
                this.dispatchEvent(
                  new CustomEvent("choose", {
                    detail: { personId: p.personId },
                    bubbles: true,
                    composed: true,
                  }),
                );
            }}
          >
            <strong>${p.name}</strong> ·
            ${p.staffRoleIds.map((id) => this.week.staffRoles.find((r) => r.id === id)?.name).join(", ")}<small
              >${this.#status(p.personId)} · ${hours(p)}</small
            >
            ${candidateWarnings(this.week, this.pickedSlot, p.personId, this.ruleset).map((b) => html`<small>${breachText(b)}</small>`)}
          </button>`,
      )}
      ${
        this.everyone
          ? nothing
          : html`<wt-button
              variant="ghost"
              data-test="show-everyone"
              ?disabled=${this.busy}
              @click=${() => {
                this.everyone = true;
              }}
              >${t("staffing.rota.show_everyone")}</wt-button
            >`
      }
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      <wt-button
        variant="secondary"
        ?disabled=${this.busy}
        @click=${() => this.dispatchEvent(new CustomEvent("close-picker", { bubbles: true, composed: true }))}
        >${t("staffing.rota.close")}</wt-button
      >
    </section>`;
  }
}
