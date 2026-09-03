import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, queryAssignedElements } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
// `baseStyles` pulls `@waitron/ui`'s module graph, which registers `wt-button` (its
// `@customElement("wt-button")`) as a side effect — the same way `till-counter-screen` gets it.
import { t } from "../i18n/t.js";
import type { TabDef } from "../layout.js";
// Side-effect import: registers the header's language chooser element (copied from
// `till-counter-screen.ts`). It only EMITS a composed `locale-selected`; the shell re-emits it.
import "./language-chooser.js";

/** The till's product WORDMARK — the brand label slot in the header. A fixed name, never translated
 * UI copy (same reason the counter screen keeps it a constant). */
const BRAND = "Waitron";

/**
 * The operator affordances the shell can offer beside the sale — the non-tab nav buttons relocated
 * off the counter screen. Each maps to one intent event (`show-station`/`show-expo`/`show-schedule`).
 */
export type ShellAffordance = "station" | "expo" | "schedule";

/**
 * SP-B2.1 tab shell: renders the tab bar (from `profile.tabs`), the operator header chrome relocated
 * off the counter screen, and slots for the active-tab body (default slot) + a drill-in overlay
 * (`drill`). Dumb + presentational — `till-app` (a later task) owns data, active-tab state, and the
 * drill-in stack; the shell only emits intent. Tokens only, no data logic.
 *
 * The drill-in mechanism is slot-driven: when the `drill` slot has assigned nodes the body slot is
 * marked `inert` (so nothing behind the overlay is focusable or clickable) and the drill overlay is
 * shown; a `slotchange` on either slot re-renders so the two stay in step with what `till-app` slots.
 */
@customElement("till-tab-shell")
export class TillTabShell extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .shell {
        display: flex;
        flex-direction: column;
        min-height: 100%;
      }

      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding: var(--wt-space-3) var(--wt-space-4);
        border-bottom: 1px solid var(--wt-color-border);
      }

      .brand {
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .tabs {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .tab {
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-4);
        border: 1px solid transparent;
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        cursor: pointer;
      }

      .tab:hover {
        background: var(--wt-color-surface-raised);
      }

      .tab[aria-selected="true"] {
        background: var(--wt-color-surface-raised);
        border-color: var(--wt-color-border);
      }

      .session {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
      }

      .operator {
        font-weight: var(--wt-font-weight-bold);
      }

      .region {
        position: relative;
        flex: 1;
      }

      .drill {
        position: absolute;
        inset: 0;
        overflow: auto;
        background: var(--wt-color-bg);
      }
    `,
  ];

  /** The profile's tabs, rendered one button each in the tab bar. Set by `till-app`. */
  @property({ attribute: false }) tabs: TabDef[] = [];
  /** The key of the tab currently shown — marks its button `aria-selected`. */
  @property() activeTabKey?: string;
  /** The logged-in operator's display name, shown in the header. Data, never translated. */
  @property() operatorName = "";
  /** Which operator affordance buttons to offer (see {@link ShellAffordance}). */
  @property({ attribute: false }) affordances: ShellAffordance[] = [];
  /** Fetch the offered languages for the header's language chooser — threaded straight through to
   * `till-language-chooser`'s own `loadLocales` (the app adapts `TillApi.getLocales`). */
  @property({ attribute: false }) loadLocales?: () => Promise<{ code: string; label: string }[]>;

  /** The nodes slotted into `drill` — when non-empty the body is inert and the overlay shows. */
  @queryAssignedElements({ slot: "drill" }) private drillNodes!: HTMLElement[];

  /** Emit a composed, bubbling intent event — the shell's only output; `till-app` acts on it. */
  #emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  override render(): TemplateResult {
    const hasDrill = this.drillNodes?.length > 0;
    return html`
      <div class="shell">
        <header class="head">
          <span class="brand">${BRAND}</span>
          <nav class="tabs" role="tablist">
            ${this.tabs.map(
              (tab) => html`
                <button
                  class="tab"
                  role="tab"
                  aria-selected=${tab.key === this.activeTabKey ? "true" : "false"}
                  @click=${() => this.#emit("tab-select", { key: tab.key })}
                >
                  ${tab.title}
                </button>
              `,
            )}
          </nav>
          <div class="session">
            ${
              this.affordances.includes("station")
                ? html`<wt-button
                    class="station"
                    variant="secondary"
                    @click=${() => this.#emit("show-station")}
                    >${t("station.open")}</wt-button
                  >`
                : nothing
            }
            ${
              this.affordances.includes("expo")
                ? html`<wt-button
                    class="expo"
                    variant="secondary"
                    @click=${() => this.#emit("show-expo")}
                    >${t("expo.open")}</wt-button
                  >`
                : nothing
            }
            ${
              this.affordances.includes("schedule")
                ? html`<wt-button
                    class="schedule"
                    variant="secondary"
                    @click=${() => this.#emit("show-schedule")}
                    >${t("schedule.open")}</wt-button
                  >`
                : nothing
            }
            <wt-button
              class="allergens"
              variant="secondary"
              @click=${() => this.#emit("open-allergens")}
              >${t("allergens.open")}</wt-button
            >
            <span class="operator">${this.operatorName}</span>
            ${
              this.loadLocales !== undefined
                ? html`<till-language-chooser
                    .loadLocales=${this.loadLocales}
                    @locale-selected=${(e: Event) => {
                      e.stopPropagation();
                      this.#emit("locale-selected", (e as CustomEvent).detail);
                    }}
                  ></till-language-chooser>`
                : nothing
            }
            <wt-button class="logout" variant="secondary" @click=${() => this.#emit("logout")}
              >${t("action.logout")}</wt-button
            >
          </div>
        </header>
        <div class="region">
          <main class="body" ?inert=${hasDrill}>
            <slot @slotchange=${() => this.requestUpdate()}></slot>
          </main>
          <div class="drill" ?hidden=${!hasDrill}>
            <slot name="drill" @slotchange=${() => this.requestUpdate()}></slot>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-tab-shell": TillTabShell;
  }
}
