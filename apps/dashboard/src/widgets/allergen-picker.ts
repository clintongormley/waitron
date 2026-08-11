import { LitElement, type PropertyValues, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { allergenName } from "../i18n/domain.js";
import type { AllergenDeclaration, AllergenEntry, AllergenPresence } from "../api/client.js";
import { selectStyles } from "../select-styles.js";

/**
 * The 14 EU allergens (Regulation (EU) No 1169/2011, Annex II) in DISPLAY order, redefined LOCALLY
 * exactly as `apps/till/src/screens/till-allergen-screen.ts:24` and `api/client.ts` redefine catalogue
 * shapes: a runtime import from `@waitron/catalogue` would drag its barrel — and through it
 * `@waitron/db` and Node builtins — into the browser bundle (the #70 rule). These raw codes stay the
 * WIRE VALUES (the `data-test`/`id`/aria wiring and the emitted declaration keys); each renders its
 * localised display name at the render edge through `allergenName` (i18n/domain.ts), the same
 * render-edge translation `staff-list` uses for its role/status tokens.
 */
const ALLERGEN_DISPLAY_ORDER = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;

/** The per-code presence selection, including the empty "unset" state the value getter drops. */
type Presence = AllergenPresence | "unset";

/**
 * The management dashboard's ALLERGEN PICKER — the UI counterpart of the three declaration states the
 * till renders (`till-allergen-screen.ts:52-60`), and the reason "empty" must NEVER silently mean
 * "allergen-free". A top-level "Revisado" (reviewed) `wt-switch` gates the whole declaration:
 *
 *  - switch OFF → `value` is `null` (unreviewed / PENDING), regardless of any per-code entries; the
 *    per-code controls are disabled. Fourteen blank cells nobody has reviewed must not claim
 *    "contains none of them".
 *  - switch ON, no code set to contains/may_contain → `value` is `{}` (reviewed, none of the 14).
 *  - switch ON with entries → `value` is `{ code: { presence, source? } }`.
 *
 * Each of the 14 codes is a native token-styled `<select>` (unset / contains / may_contain) plus an
 * optional free-text `source` `wt-input` (the Annex II specificity, e.g. "trigo"). The picker holds no
 * API and validates nothing for shape client-side — the server's `validateAllergens` (`allergen.*`)
 * stays the authority; the picker only assembles the three-state map and announces every change with a
 * bubbling, composed `allergens-changed { value }` so the product form can read it without reaching
 * into this widget's internals. `value` is exposed as a getter so tests and the form read it directly.
 */
@customElement("dashboard-allergen-picker")
export class AllergenPicker extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .reviewed {
        margin-bottom: var(--wt-space-4);
      }
      .grid {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }
      .row {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: end;
        gap: var(--wt-space-3);
      }
      .name {
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  /**
   * The SEED declaration for edit mode — the product form sets this from a loaded product's allergens
   * so the picker opens pre-filled. It is an INPUT, distinct from the computed `value` getter (which
   * stays the live read of the internal state): assigning it reconstructs `reviewed`/`entries` once,
   * in `willUpdate`, after which the per-code controls drive the state as usual. `null` (the default,
   * and a CREATE) seeds the PENDING state, exactly as an untouched picker already holds. Bound only on
   * (re)seed by the form — never to the live value — so it does not fight the operator's edits.
   */
  @property({ attribute: false }) declaration: AllergenDeclaration = null;

  /** Whether the operator has reviewed this product's allergens — the null-vs-`{}` gate. */
  @state() private reviewed = false;

  /** Per-code presence + free-text source. A code absent here reads as `unset` with no source. */
  @state() private entries: Record<string, { presence: Presence; source: string }> = {};

  /**
   * Seed the internal three-state from a freshly-assigned `declaration` (edit-mode pre-fill). Runs only
   * when `declaration` actually changes — a user edit changes `reviewed`/`entries`, not `declaration`,
   * so it is never re-seeded out from under the operator. `null` → reviewed off (PENDING); `{}` →
   * reviewed on, nothing marked; `{ code: {…} }` → reviewed on with each code's presence + source
   * (an absent `source` becomes `""`, the empty the `value` getter drops). Does NOT emit
   * `allergens-changed` — seeding is not an operator change; the form reads the seed it just set.
   */
  override willUpdate(changed: PropertyValues): void {
    if (!changed.has("declaration")) return;
    const declaration = this.declaration;
    if (declaration === null) {
      this.reviewed = false;
      this.entries = {};
      return;
    }
    this.reviewed = true;
    const entries: Record<string, { presence: Presence; source: string }> = {};
    for (const [code, entry] of Object.entries(declaration)) {
      entries[code] = { presence: entry.presence, source: entry.source ?? "" };
    }
    this.entries = entries;
  }

  /**
   * The three-state declaration this picker currently holds (design §7): `null` while unreviewed,
   * `{}` when reviewed with nothing marked, else the declared `{ code: { presence, source? } }` map.
   * The optional `source` key is OMITTED (never emitted as `""`) so the shape matches `AllergenEntry`.
   */
  get value(): AllergenDeclaration {
    if (!this.reviewed) return null;
    const out: Record<string, AllergenEntry> = {};
    for (const code of ALLERGEN_DISPLAY_ORDER) {
      const entry = this.entries[code];
      if (!entry || entry.presence === "unset") continue;
      const source = entry.source.trim();
      out[code] = source ? { presence: entry.presence, source } : { presence: entry.presence };
    }
    return out;
  }

  /**
   * Announce the new value. `bubbles`+`composed` so it crosses this widget's shadow boundary to the
   * product form (a later task), which assembles the create/update body from it.
   */
  #emit(): void {
    this.dispatchEvent(
      new CustomEvent<{ value: AllergenDeclaration }>("allergens-changed", {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * The "Revisado" switch changed. `stopPropagation` keeps the wt-switch's own composed `wt-change`
   * inside this shadow boundary, so the form hears only the semantic `allergens-changed` (the house
   * pattern — the person-form field handlers stop their composed events the same way).
   */
  #onReviewed(event: CustomEvent<{ checked: boolean }>): void {
    event.stopPropagation();
    this.reviewed = event.detail.checked;
    this.#emit();
  }

  /** A code's presence `<select>` changed. Native `change` is `composed: false`, so `stopPropagation`
   * here is defensive consistency with the composed handlers, not a boundary guard. */
  #onPresence(event: Event, code: string): void {
    event.stopPropagation();
    const presence = (event.target as HTMLSelectElement).value as Presence;
    this.entries = {
      ...this.entries,
      [code]: { presence, source: this.entries[code]?.source ?? "" },
    };
    this.#emit();
  }

  /** A code's free-text source `wt-input` changed; stops its composed `wt-change` from leaking out. */
  #onSource(event: CustomEvent<{ value: string }>, code: string): void {
    event.stopPropagation();
    this.entries = {
      ...this.entries,
      [code]: { presence: this.entries[code]?.presence ?? "unset", source: event.detail.value },
    };
    this.#emit();
  }

  override render() {
    const disabled = !this.reviewed;
    return html`
      <wt-switch
        class="reviewed"
        data-test="reviewed"
        label=${t("allergen.reviewed")}
        .checked=${this.reviewed}
        @wt-change=${(e: CustomEvent<{ checked: boolean }>) => this.#onReviewed(e)}
      ></wt-switch>
      <div class="grid">
        ${ALLERGEN_DISPLAY_ORDER.map((code) => {
          const entry = this.entries[code];
          const presence = entry?.presence ?? "unset";
          return html`
            <div class="row" role="group" aria-label=${allergenName(code)}>
              <span class="name" id=${`name-${code}`}>${allergenName(code)}</span>
              <select
                data-test=${`presence-${code}`}
                aria-labelledby=${`name-${code}`}
                .value=${presence}
                ?disabled=${disabled}
                @change=${(e: Event) => this.#onPresence(e, code)}
              >
                <option value="unset">—</option>
                <option value="contains">${t("allergen.contains")}</option>
                <option value="may_contain">${t("allergen.may_contain")}</option>
              </select>
              <wt-input
                data-test=${`source-${code}`}
                label=${`${t("allergen.origin")} (${allergenName(code)})`}
                .value=${entry?.source ?? ""}
                ?disabled=${disabled || presence === "unset"}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onSource(e, code)}
              ></wt-input>
            </div>
          `;
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-allergen-picker": AllergenPicker;
  }
}
