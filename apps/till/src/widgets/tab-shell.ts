import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, queryAssignedElements, state } from "lit/decorators.js";
import { baseStyles, registerIcons } from "@waitron/ui";
// `baseStyles` pulls `@waitron/ui`'s module graph, which registers `wt-button` as a side effect.
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import type { TabDef } from "../layout.js";
import "@waitron/ui/src/components/wt-language-chooser.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-count-badge.js";
import { PHONE_WIDTH, languageChooserStyles } from "./language-chooser-styles.js";

/** The product WORDMARK: a fixed name, never translated UI copy. */
const BRAND = "Waitron";

export type ShellAffordance = "station" | "expo" | "schedule" | "find-bill";

type ActionVariant = "secondary" | "ghost";

registerIcons({
  kebab:
    "M6.7 3a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 8a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 13a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0",
});

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

      /* One row on a phone: the tabs scroll sideways rather than wrap, the rest sits in the menu. */
      .head.phone {
        flex-wrap: nowrap;
        gap: var(--wt-space-2);
        padding: var(--wt-space-2) var(--wt-space-3);
      }

      .head.phone .tabs {
        flex: 1;
        min-width: 0;
        flex-wrap: nowrap;
        overflow-x: auto;
      }

      .head.phone .tab {
        flex: none;
        padding: var(--wt-space-2) var(--wt-space-3);
        white-space: nowrap;
      }

      .head.phone .session {
        flex: none;
        flex-wrap: nowrap;
        gap: var(--wt-space-2);
      }

      wt-row-actions > span {
        padding: var(--wt-space-2) var(--wt-space-4);
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
  @property({ type: Boolean }) transferAvailable = false;
  @property({ attribute: false }) affordances: ShellAffordance[] = [];
  @property({ attribute: false }) loadLocales?: () => Promise<{ code: string; label: string }[]>;
  /** Suppresses the whole operator `<header>`: a kitchen display shows just its cards, no operator
   * chrome (owner decision 2026-09-04). */
  @property({ type: Boolean }) kiosk = false;
  /** The device is approved for more than one profile, so a signed-in person may switch it. */
  @property({ type: Boolean }) canSwitchProfile = false;

  @queryAssignedElements({ slot: "drill" }) private drillNodes!: HTMLElement[];

  @state() private phone = false;
  #phoneWidth?: MediaQueryList;
  readonly #onPhoneWidth = (event: MediaQueryListEvent) => {
    this.phone = event.matches;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.#phoneWidth = window.matchMedia(PHONE_WIDTH);
    this.phone = this.#phoneWidth.matches;
    this.#phoneWidth.addEventListener("change", this.#onPhoneWidth);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#phoneWidth?.removeEventListener("change", this.#onPhoneWidth);
    this.#phoneWidth = undefined;
  }

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

  #tools(variant: ActionVariant): TemplateResult {
    const action = (cls: string, type: string, label: string): TemplateResult =>
      html`<wt-button
        class=${cls}
        variant=${variant}
        align=${variant === "ghost" ? "start" : nothing}
        @click=${() => this.#emit(type)}
        >${label}</wt-button
      >`;
    return html`${
      this.transferCount === undefined
        ? nothing
        : html`<span data-test="department-transfers" role="status"
            >${t("department_transfer.open").replace("{count}", String(this.transferCount))}</span
          >`
    }${
      this.transferAvailable
        ? html`<wt-button
            data-open-transfers
            variant=${variant}
            align=${variant === "ghost" ? "start" : nothing}
            @click=${() => this.#emit("open-transfers")}
            >${t("department_transfer.title")}</wt-button
          >`
        : nothing
    }${this.affordances.includes("find-bill") ? action("find-bill", "find-bill", t("find_bill.open")) : nothing}${
      this.affordances.includes("station")
        ? action("station", "show-station", t("station.open"))
        : nothing
    }${this.affordances.includes("expo") ? action("expo", "show-expo", t("expo.open")) : nothing}${
      this.affordances.includes("schedule")
        ? action("schedule", "show-schedule", t("schedule.open"))
        : nothing
    }${this.canSwitchProfile ? action("profile", "open-profile", t("profile.open")) : nothing}${action(
      "equipment",
      "open-equipment",
      t("equipment.open"),
    )}${action("allergens", "open-allergens", t("allergens.open"))}`;
  }

  #operatorAndLogout(variant: ActionVariant): TemplateResult {
    return html`<span class="operator">${this.operatorName}</span
      ><wt-button
        class="logout"
        variant=${variant}
        align=${variant === "ghost" ? "start" : nothing}
        @click=${() => this.#emit("logout")}
        >${t("action.logout")}</wt-button
      >`;
  }

  #menu(): TemplateResult {
    const pending = this.transferCount !== undefined && this.transferCount > 0;
    return html`<wt-row-actions
      icon="kebab"
      align="end"
      label=${
        pending
          ? t("shell.more_transfers").replace("{count}", String(this.transferCount))
          : t("shell.more")
      }
    >
      ${
        pending
          ? html`<wt-count-badge
              slot="badge"
              tone="warning"
              .count=${this.transferCount!}
            ></wt-count-badge>`
          : nothing
      }
      ${this.#tools("ghost")}${this.#operatorAndLogout("ghost")}
    </wt-row-actions>`;
  }

  #tabTitle(tab: TabDef): string {
    // Only the standard key/title pairs are UI labels; a renamed tab remains the venue's text.
    switch (`${tab.key}:${tab.title}`) {
      case "counter:Counter":
        return t("tab.counter");
      case "floor:Floor":
        return t("tab.floor");
      case "order:Order":
        return t("tab.order");
      default:
        return tab.title;
    }
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
                <header class=${this.phone ? "head phone" : "head"}>
                  ${this.phone ? nothing : html`<span class="brand">${BRAND}</span>`}
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
                          ${this.#tabTitle(tab)}
                        </button>
                      `,
                    )}
                  </nav>
                  <div class="session">
                    ${this.phone ? nothing : this.#tools("secondary")}${this.#chooser()}${
                      this.phone ? this.#menu() : this.#operatorAndLogout("secondary")
                    }
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
