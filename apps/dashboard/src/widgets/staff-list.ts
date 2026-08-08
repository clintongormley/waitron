import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-button.js";
import type { PersonSummary } from "../api/client.js";

/**
 * The management dashboard's STAFF LIST: one `wt-card` row per person, showing their display name,
 * role, active/suspended status and which login credentials they hold (a password, a TOTP second
 * factor), plus an Edit control per row.
 *
 * It is a PURE DISPLAY widget — it holds no state and never talks to the API (unlike the login
 * screen, which owns an injected `api`). The staff screen owns the list (`GET /management-api/staff`
 * → `DashboardApi.listStaff`) and hands it down as `people`; the Edit control emits a composed,
 * bubbling `edit-person` carrying only the `personId`, which the staff screen will turn into an edit
 * flow in a later slice (an unheard seam today — the screen wires no `@edit-person` yet). The widget
 * names no sibling and reaches for no store — the same shape as the till's `till-held-orders` view.
 *
 * Role and status render as their raw domain tokens (`manager`, `suspended`, …); a later i18n task
 * maps them to Spanish copy, exactly as the login screen defers its error keys. The credential badges
 * convey state by TEXT, never by colour alone (a11y): a badge is present only when the credential is
 * held, and it is labelled ("Contraseña", "TOTP"), so a screen-reader user and a colour-blind user
 * both get the same information a sighted one does.
 */
@customElement("dashboard-staff-list")
export class StaffList extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .list {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }

      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }

      .details {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
      }

      .name {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
      }

      .meta {
        display: flex;
        gap: var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .badges {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-1);
      }

      /* A bordered text pill: the label carries the meaning, so nothing here depends on colour to be
         understood. The wt-color-text token on the card surface is the highest-contrast pairing in
         both themes. The 1px hairline is a literal, matching wt-input/wt-card's own borders. */
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  /** The staff to list, straight from `GET /management-api/staff`. The app owns and refreshes it;
   * defaults to empty so the widget renders safely before the app assigns the list. */
  @property({ attribute: false }) people: PersonSummary[] = [];

  /**
   * Ask the staff screen to edit `personId`. `stopPropagation` keeps the button's own composed
   * `click` inside this widget's shadow boundary, so the consumer hears the semantic `edit-person`
   * and not a raw click as well (the house pattern — the till's field handlers stop their composed
   * events the same way).
   */
  #edit(event: Event, personId: string): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ personId: string }>("edit-person", {
        detail: { personId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <div class="list">
        ${this.people.map(
          (person) => html`
            <wt-card data-test="row">
              <div class="row">
                <div class="details">
                  <span class="name">${person.displayName}</span>
                  <span class="meta">
                    <span class="role">${person.role}</span>
                    <span class="status">${person.status}</span>
                  </span>
                  <span class="badges">
                    ${person.hasPassword ? html`<span class="badge">Contraseña</span>` : nothing}
                    ${person.hasTotp ? html`<span class="badge">TOTP</span>` : nothing}
                  </span>
                </div>
                <wt-button
                  variant="ghost"
                  data-test="edit-${person.personId}"
                  aria-label=${`Editar ${person.displayName}`}
                  @click=${(event: Event) => this.#edit(event, person.personId)}
                >
                  Editar
                </wt-button>
              </div>
            </wt-card>
          `,
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-staff-list": StaffList;
  }
}
