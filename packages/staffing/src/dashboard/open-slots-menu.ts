import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { RotaWeek } from "../staffing-types.js";
import { dateLabel } from "./format.js";
import { openSlots, slotMinutes, type OpenSlot } from "./rota-model.js";
import { t, tf } from "./strings.js";
import "@waitron/ui/src/components/wt-button.js";

/** "Fri 4 Dec · Marc" */
export function openHeading(week: RotaWeek, personId: string, businessDay: string): string {
  return tf("staffing.rota.open_heading", {
    day: dateLabel(businessDay),
    name: week.people.find((p) => p.personId === personId)!.name,
  });
}

/** A person's day in Everyone: that day's open slots, theirs first, then Another shift. */
@customElement("rota-open-slots")
export class OpenSlotsMenu extends LitElement {
  static override styles = [
    baseStyles,
    css`
      /* The two foot buttons share the last row; everything else takes a row of its own. */
      :host {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0 var(--wt-space-2);
        min-width: 0;
        max-width: calc(var(--wt-tap-min) * 8);
      }
      :host([sheet]) {
        max-width: none;
      }
      .title,
      section,
      p {
        flex: 0 0 100%;
      }
      [data-test="cancel"] {
        margin-inline-start: auto;
      }
      /* A button drawn as a link: it changes the list, it does not navigate. */
      wt-button.link::part(button) {
        min-width: 0;
        padding-inline: 0;
        border-color: transparent;
        background: transparent;
        color: var(--wt-color-primary-text);
        font-weight: var(--wt-font-weight-normal);
        text-decoration: underline;
      }
      .title {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }
      h3 {
        margin: var(--wt-space-2) 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-medium);
      }
      button {
        display: block;
        width: 100%;
        text-align: start;
        font: inherit;
        color: var(--wt-color-text);
        background: var(--wt-color-surface);
        border: 1px dashed var(--wt-color-text-muted);
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
      strong {
        font-weight: var(--wt-font-weight-medium);
      }
      small {
        display: block;
        color: var(--wt-color-text-muted);
      }
      p {
        margin: var(--wt-space-2) 0;
      }
      .error,
      small.over {
        color: var(--wt-color-danger);
      }
      small.outside {
        color: var(--wt-color-warning);
      }
    `,
  ];
  @property({ attribute: false }) week!: RotaWeek;
  @property() personId = "";
  @property() businessDay = "";
  @property({ type: Boolean }) busy = false;
  @property() error = "";
  /** On a phone the menu is a sheet, which ends with Cancel. */
  @property({ type: Boolean, reflect: true }) sheet = false;
  #emit(name: string, detail: unknown) {
    if (!this.busy)
      this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  #row({ slot, areaName }: OpenSlot, outside: boolean) {
    const person = this.week.people.find((p) => p.personId === this.personId)!;
    const role = this.week.staffRoles.find((r) => r.id === slot.staffRoleId)!;
    const planned = person.plannedMinutes + slotMinutes(this.week, slot);
    return html`<button
      data-slot=${slot.key}
      ?disabled=${this.busy}
      @click=${() => this.#emit("choose-slot", { slot })}
    >
      <strong>${slot.startsAt}–${slot.endsAt} · ${areaName} · ${role.name}</strong>${
        outside ? html`<small class="outside">${t("staffing.rota.outside_role")}</small>` : nothing
      }${
        person.contractedMinutes !== null && planned > person.contractedMinutes
          ? html`<small class="over" data-test="would-make"
              >${tf("staffing.rota.would_make", { planned: String(planned / 60), contract: String(person.contractedMinutes / 60) })}</small
            >`
          : nothing
      }
    </button>`;
  }
  override render() {
    if (!this.week) return nothing;
    const { own, other } = openSlots(this.week, this.personId, this.businessDay);
    const name = this.week.people.find((p) => p.personId === this.personId)!.name;
    // The popup it sits in carries this text as its heading, which is what a screen reader hears.
    return html`<p class="title" data-test="open-title" aria-hidden="true">
        ${openHeading(this.week, this.personId, this.businessDay)}
      </p>
      ${
        own.length
          ? html`<section>
              <h3>${tf("staffing.rota.open_in_roles", { name })}</h3>
              ${own.map((o) => this.#row(o, false))}
            </section>`
          : nothing
      }
      ${
        other.length
          ? html`<section>
              <h3>${t("staffing.rota.open_other")}</h3>
              ${other.map((o) => this.#row(o, true))}
            </section>`
          : nothing
      }
      ${own.length + other.length === 0 ? html`<p>${t("staffing.rota.no_open")}</p>` : nothing}
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      <wt-button
        class="link"
        variant="ghost"
        data-test="another-shift"
        ?disabled=${this.busy}
        @click=${() =>
          this.#emit("another-shift", { personId: this.personId, businessDay: this.businessDay })}
        >${t("staffing.rota.another_shift")}</wt-button
      >
      ${
        this.sheet
          ? html`<wt-button
              variant="secondary"
              data-test="cancel"
              ?disabled=${this.busy}
              @click=${() => this.#emit("close-menu", {})}
              >${t("staffing.role.cancel")}</wt-button
            >`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rota-open-slots": OpenSlotsMenu;
  }
}
