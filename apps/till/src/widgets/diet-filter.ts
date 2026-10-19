import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import {
  ALLERGEN_CODES,
  CEREAL_KINDS,
  NUT_KINDS,
  type AllergenCode,
  type Kind,
} from "@waitron/catalogue/src/allergens.js";
import { currentLocale, t } from "../i18n/t.js";
import { allergenLabel, allergenName } from "../i18n/allergen-names.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import {
  EMPTY_MENU_FILTERS,
  activeFilterCount,
  type DietPredicate,
  type MenuFilters,
} from "../menu-filter.js";
import { trackDialog } from "./track-dialog.js";

const OPTIONS = [
  { predicate: "vegan", key: "diet.vegan" },
  { predicate: "vegetarian", key: "diet.vegetarian" },
  { predicate: "no-meat", key: "diet.filter.no_meat" },
  { predicate: "no-fish", key: "diet.filter.no_fish" },
] as const;

@customElement("till-diet-filter")
export class TillDietFilter extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      button {
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        text-align: start;
        cursor: pointer;
        overflow-wrap: anywhere;
      }
      button[aria-pressed="true"] {
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }
      button:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      h3 {
        font-size: var(--wt-font-size-md);
        margin: var(--wt-space-4) 0 var(--wt-space-2);
      }
      .options {
        display: grid;
        grid-template-columns: repeat(
          auto-fit,
          minmax(min(100%, calc(var(--wt-tap-min) * 3)), 1fr)
        );
        gap: var(--wt-space-2);
      }
      [data-filter-count] {
        margin-inline-start: var(--wt-space-2);
      }
    `,
  ];
  @property({ attribute: false }) selected: MenuFilters = EMPTY_MENU_FILTERS;
  @state() private expanded = false;
  @state() private kindStep: "gluten" | "nuts" | null = null;

  #emit(filters: MenuFilters): void {
    this.dispatchEvent(
      new CustomEvent("menu-filters-selected", {
        detail: { filters },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #diet(predicate: DietPredicate): void {
    const diets = this.selected.diets.includes(predicate)
      ? this.selected.diets.filter((diet) => diet !== predicate)
      : [...this.selected.diets, predicate];
    this.#emit({ ...this.selected, diets });
  }
  #exclude(code: AllergenCode, value: "all" | readonly Kind[] | undefined): void {
    const exclude = { ...this.selected.exclude };
    if (value === undefined) delete exclude[code];
    else exclude[code] = value;
    this.#emit({ ...this.selected, exclude });
  }
  #kind(kind: Kind): void {
    const code = this.kindStep!;
    const current = this.selected.exclude[code];
    const kinds = current === "all" || current === undefined ? [] : current;
    const next = kinds.includes(kind) ? kinds.filter((each) => each !== kind) : [...kinds, kind];
    this.#exclude(code, next.length === 0 ? undefined : next);
  }
  #allergens() {
    return html`<h3>${t("menu.filter.exclude")}</h3>
      <div class="options" role="group" aria-label=${t("menu.filter.exclude")}>
        ${ALLERGEN_CODES.map(
          (code) =>
            html`<button
              type="button"
              data-allergen=${code}
              aria-pressed=${this.selected.exclude[code] !== undefined}
              @click=${() => {
                if (code === "nuts" || code === "gluten") this.kindStep = code;
                else this.#exclude(code, this.selected.exclude[code] ? undefined : "all");
              }}
            >
              ${allergenName(code, currentLocale())}
            </button>`,
        )}
      </div>`;
  }
  #kinds() {
    const code = this.kindStep!;
    const selected = this.selected.exclude[code];
    const kinds = code === "gluten" ? CEREAL_KINDS : NUT_KINDS;
    return html`<section data-kind-step>
      <button
        type="button"
        data-filter-back
        @click=${() => {
          this.kindStep = null;
        }}
      >
        ${t("action.back")}
      </button>
      <h3>${allergenName(code, currentLocale())}</h3>
      <div class="options" role="group" aria-label=${allergenName(code, currentLocale())}>
        <button
          type="button"
          data-test="kind-all"
          aria-pressed=${selected === "all"}
          @click=${() => this.#exclude(code, selected === "all" ? undefined : "all")}
        >
          ${t("menu.filter.all")}
        </button>
        ${kinds.map(
          (kind) =>
            html`<button
              type="button"
              data-test=${`kind-${kind}`}
              aria-pressed=${selected !== "all" && selected?.includes(kind) === true}
              @click=${() => this.#kind(kind)}
            >
              ${allergenLabel(code, { kinds: [kind] }, currentLocale())
                .replace(/^.*\(/, "")
                .replace(/\)$/, "")}
            </button>`,
        )}
      </div>
    </section>`;
  }
  override render() {
    const count = activeFilterCount(this.selected);
    return html`<button
        type="button"
        data-filter-open
        aria-haspopup="dialog"
        @click=${() => {
          this.kindStep = null;
          this.expanded = true;
        }}
      >
        ${t("menu.filter.title")}${count ? html`<span data-filter-count>${count}</span>` : nothing}
      </button>
      ${html`<wt-dialog
        ${trackDialog()}
        .open=${this.expanded}
        .heading=${t("menu.filter.title")}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          this.expanded = false;
        }}
      >
        ${
          this.kindStep
            ? this.#kinds()
            : html`<h3>${t("menu.filter.include")}</h3>
                <div class="options" role="group" aria-label=${t("menu.filter.include")}>
                  ${OPTIONS.map((opt) => html`<button type="button" data-test=${`diet-filter-${opt.predicate}`} aria-pressed=${this.selected.diets.includes(opt.predicate)} @click=${() => this.#diet(opt.predicate)}>${t(opt.key)}</button>`)}
                </div>
                ${this.#allergens()}`
        }
        <wt-button
          slot="footer"
          data-filter-clear
          variant="secondary"
          @click=${() => this.#emit(EMPTY_MENU_FILTERS)}
          >${t("menu.filter.clear")}</wt-button
        >
        <wt-button
          slot="footer"
          variant="secondary"
          @click=${() => {
            this.expanded = false;
          }}
          >${t("equipment.close")}</wt-button
        >
      </wt-dialog>`}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-diet-filter": TillDietFilter;
  }
}
