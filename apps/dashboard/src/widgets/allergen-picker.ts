import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles } from "@waitron/ui";
import { searchBy } from "@waitron/shared";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import { t } from "../i18n/t.js";
import {
  ALLERGEN_CHOICES,
  allergenChoices,
  allergensFromChoices,
  allergenChoiceName,
} from "./allergen-choices.js";
import type { AllergenDeclaration } from "../api/client.js";

/** Review is explicit: null is unreviewed, while {} is reviewed with none declared. */
@customElement("dashboard-allergen-picker")
export class AllergenPicker extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .grid,
      .choices {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
      }
      .name {
        flex: 1;
        font-size: var(--wt-font-size-sm);
      }
      .reviewed,
      .grid {
        margin-bottom: var(--wt-space-4);
      }
    `,
  ];

  @property({ attribute: false }) declaration: AllergenDeclaration = null;
  @state() private reviewed = false;
  @state() private choices: string[] = [];
  @state() private picking = false;
  @state() private search = "";
  private pickerGeneration = 0;

  override willUpdate(changed: PropertyValues): void {
    if (!changed.has("declaration")) return;
    this.reviewed = this.declaration !== null;
    this.choices = allergenChoices(this.declaration);
    this.picking = false;
    this.search = "";
  }

  get value(): AllergenDeclaration {
    if (!this.reviewed) return null;
    return allergensFromChoices(this.choices);
  }

  #emit(): void {
    this.dispatchEvent(
      new CustomEvent("wt-allergens-change", {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #onReviewed(event: CustomEvent<{ checked: boolean }>): void {
    event.stopPropagation();
    this.reviewed = event.detail.checked;
    this.#emit();
  }

  #remove(event: Event, code: string): void {
    event.stopPropagation();
    if (!this.reviewed) return;
    this.choices = this.choices.filter((choice) => choice !== code);
    this.#emit();
  }

  #setPicking(open: boolean): void {
    if (open) this.pickerGeneration++;
    this.picking = open;
    this.dispatchEvent(
      new CustomEvent("wt-picker-state", {
        detail: { open },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #closePicker(event: Event): void {
    event.stopPropagation();
    this.#setPicking(false);
    const generation = this.pickerGeneration;
    void this.updateComplete.then(async () => {
      await this.shadowRoot!.querySelector("wt-dialog")?.updateComplete;
      if (!this.picking && generation === this.pickerGeneration)
        this.shadowRoot!.querySelector<HTMLElement>("[data-test=add-allergen]")?.focus();
    });
  }

  #add(event: Event, code: string): void {
    event.stopPropagation();
    if (!this.reviewed || this.choices.includes(code)) return;
    this.choices = [...this.choices, code];
    this.#emit();
    this.#closePicker(event);
  }

  override render() {
    const generation = this.pickerGeneration;
    const selected = ALLERGEN_CHOICES.filter((choice) => this.choices.includes(choice));
    const unchosen = ALLERGEN_CHOICES.filter((choice) => !this.choices.includes(choice));
    const choices = searchBy(this.search, unchosen, (code) => allergenChoiceName(code));
    return html`
      <wt-switch
        class="reviewed"
        data-test="reviewed"
        name="allergens-reviewed"
        label=${t("allergen.reviewed")}
        .checked=${this.reviewed}
        @wt-change=${this.#onReviewed}
      ></wt-switch>
      <div class="grid">
        ${selected.map(
          (code) => html`
            <div class="row" role="group" aria-label=${allergenChoiceName(code)}>
              <span class="name" id=${`name-${code}`}>${allergenChoiceName(code)}</span>
              <wt-button
                variant="secondary"
                data-test=${`remove-${code}`}
                aria-label=${`${t("action.remove")}: ${allergenChoiceName(code)}`}
                ?disabled=${!this.reviewed}
                @click=${(event: Event) => this.#remove(event, code)}
              >
                ${t("action.remove")}
              </wt-button>
            </div>
          `,
        )}
      </div>
      <wt-button
        variant="secondary"
        data-test="add-allergen"
        ?disabled=${!this.reviewed || selected.length === ALLERGEN_CHOICES.length}
        @click=${(event: Event) => {
          event.stopPropagation();
          if (!this.reviewed) return;
          this.search = "";
          this.#setPicking(true);
        }}
        >${t("allergen.add")}</wt-button
      >
      ${keyed(
        generation,
        html`<wt-dialog
          .open=${this.picking}
          heading=${t("allergen.add")}
          @keydown=${(event: KeyboardEvent) => event.stopPropagation()}
          @wt-close=${(event: Event) => {
            if (event.target === event.currentTarget && generation === this.pickerGeneration)
              this.#closePicker(event);
          }}
        >
          ${
            this.picking
              ? html`
                  <wt-input
                    name="allergen-search"
                    data-test="allergen-search"
                    label=${t("allergen.search")}
                    .value=${this.search}
                    @wt-change=${(event: CustomEvent<{ value: string }>) => {
                      event.stopPropagation();
                      this.search = event.detail.value;
                    }}
                  ></wt-input>
                  <div class="choices">
                    ${choices.map(
                      (code) => html`
                        <wt-button
                          variant="secondary"
                          data-test=${`choose-${code}`}
                          @click=${(event: Event) => this.#add(event, code)}
                          >${allergenChoiceName(code)}</wt-button
                        >
                      `,
                    )}
                    ${choices.length ? nothing : html`<p>${t("allergen.no_matches")}</p>`}
                  </div>
                `
              : nothing
          }
          <wt-button
            slot="footer"
            variant="secondary"
            data-test="cancel-allergen"
            @click=${this.#closePicker}
            >${t("action.cancel")}</wt-button
          >
        </wt-dialog>`,
      )}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-allergen-picker": AllergenPicker;
  }
}
