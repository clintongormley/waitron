import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, queryAssignedElements } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
// `baseStyles` pulls `@waitron/ui`'s module graph, which registers `wt-button` as a side effect.
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import type { TabDef } from "../layout.js";
import "@waitron/ui/src/components/wt-language-chooser.js";
import { languageChooserStyles } from "./language-chooser-styles.js";

/** The product WORDMARK: a fixed name, never translated UI copy. */
const BRAND = "Waitron";

export type ShellAffordance = "station" | "expo" | "schedule" | "find-bill";

/**
 * Presentational: `till-app` owns data, active-tab state and the drill-in stack; the shell only emits
 * intent. While the `drill` slot has assigned nodes the body is `inert`, so nothing behind the overlay
 * is focusable or clickable.
 */
@customElement("till-tab-shell")
export class TillTabShell extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    languageChooserStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100dvh;
      }

      .shell {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
      }

      .head {
        display: flex;
        flex-wrap: wrap;
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
        flex-wrap: wrap;
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
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
      }

      .operator {
        font-weight: var(--wt-font-weight-bold);
      }

      .region {
        position: relative;
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
      }

      .body {
        flex: 1;
        min-height: 0;
        overflow: auto;
      }

      /* Stands in for the bar, so the chooser sits where the bar's trailing end would put it. */
      .language-corner {
        padding: var(--wt-space-3) var(--wt-space-4);
      }

      .drill {
        position: absolute;
        inset: 0;
        overflow: auto;
        background: var(--wt-color-bg);
      }
    `,
  ];

  @property({ attribute: false }) tabs: TabDef[] = [];
  @property() activeTabKey?: string;
  @property() operatorName = "";
  @property({ attribute: false }) transferCount?: number;
  @property({ attribute: false }) affordances: ShellAffordance[] = [];
  @property({ attribute: false }) loadLocales?: () => Promise<{ code: string; label: string }[]>;
  /** Suppresses the whole operator `<header>`: a kitchen display shows just its cards, no operator
   * chrome (owner decision 2026-09-04). */
  @property({ type: Boolean }) kiosk = false;
  /** The device is approved for more than one profile, so a signed-in person may switch it. */
  @property({ type: Boolean }) canSwitchProfile = false;

  @queryAssignedElements({ slot: "drill" }) private drillNodes!: HTMLElement[];

  #emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #chooser(): TemplateResult | typeof nothing {
    return this.loadLocales !== undefined
      ? html`<wt-language-chooser
          active=${currentLocale()}
          .loadLocales=${this.loadLocales}
        ></wt-language-chooser>`
      : nothing;
  }

  override render(): TemplateResult {
    const hasDrill = this.drillNodes?.length > 0;
    // Mirrors `till-app`'s `#activeTab()` fallback, so the tab marked selected matches the body rendered.
    const activeKey = this.tabs.some((tab) => tab.key === this.activeTabKey)
      ? this.activeTabKey
      : this.tabs[0]?.key;
    return html`
      <div class="shell">
        ${
          this.kiosk
            ? this.loadLocales !== undefined
              ? html`<div class="language-corner">${this.#chooser()}</div>`
              : nothing
            : html`
                <header class="head">
                  <span class="brand">${BRAND}</span>
                  <nav class="tabs" role="tablist">
                    ${this.tabs.map(
                      (tab) => html`
                        <button
                          type="button"
                          class="tab"
                          role="tab"
                          aria-selected=${tab.key === activeKey ? "true" : "false"}
                          @click=${() => this.#emit("tab-select", { key: tab.key })}
                        >
                          ${tab.title}
                        </button>
                      `,
                    )}
                  </nav>
                  <div class="session">
                    ${
                      this.transferCount === undefined
                        ? nothing
                        : html`<span data-test="department-transfers" role="status"
                            >${t("department_transfer.open").replace("{count}", String(this.transferCount))}</span
                          >`
                    }
                    ${
                      this.affordances.includes("find-bill")
                        ? html`<wt-button
                            class="find-bill"
                            variant="secondary"
                            @click=${() => this.#emit("find-bill")}
                            >${t("find_bill.open")}</wt-button
                          >`
                        : nothing
                    }
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
                    ${
                      this.canSwitchProfile
                        ? html`<wt-button
                            class="profile"
                            variant="secondary"
                            @click=${() => this.#emit("open-profile")}
                            >${t("profile.open")}</wt-button
                          >`
                        : nothing
                    }
                    <wt-button
                      class="equipment"
                      variant="secondary"
                      @click=${() => this.#emit("open-equipment")}
                      >${t("equipment.open")}</wt-button
                    >
                    <wt-button
                      class="allergens"
                      variant="secondary"
                      @click=${() => this.#emit("open-allergens")}
                      >${t("allergens.open")}</wt-button
                    >
                    ${this.#chooser()}
                    <span class="operator">${this.operatorName}</span>
                    <wt-button
                      class="logout"
                      variant="secondary"
                      @click=${() => this.#emit("logout")}
                      >${t("action.logout")}</wt-button
                    >
                  </div>
                </header>
              `
        }
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
