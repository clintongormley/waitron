import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, queryAssignedElements, state } from "lit/decorators.js";
import { baseStyles, visuallyHiddenStyles } from "@waitron/ui";
// `baseStyles` pulls `@waitron/ui`'s module graph, which registers `wt-button` as a side effect.
import { countText, currentLocale, t } from "../i18n/t.js";
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

/** An item of the bar that can move into More; "transfers" is the count and its button together,
 * "operator" the name and Log out together. */
type BarItem =
  | "transfers"
  | "find-bill"
  | "station"
  | "expo"
  | "schedule"
  | "profile"
  | "equipment"
  | "allergens"
  | "operator";

/** First to leave the bar first: occasional tools, then service actions, then who is signed in. */
const LEAVE_ORDER: readonly BarItem[] = [
  "allergens",
  "equipment",
  "profile",
  "schedule",
  "expo",
  "station",
  "find-bill",
  "transfers",
  "operator",
];

/** Properties whose change can alter the bar's width, so may let items come back. A transfer count
 * is not one: a count changing while More is open must not rebuild the menu under the finger. */
const CONTENT_PROPERTIES: readonly PropertyKey[] = [
  "tabs",
  "affordances",
  "operatorName",
  "transferAvailable",
  "canSwitchProfile",
  "loadLocales",
  "phone",
  "kiosk",
];

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
        flex-wrap: nowrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding: var(--wt-space-3) var(--wt-space-4);
        border-bottom: 1px solid var(--wt-color-border);
      }

      .brand {
        flex: none;
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .tabs {
        display: flex;
        flex: 0 1 auto;
        min-width: 0;
        flex-wrap: nowrap;
        overflow-x: auto;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .tab {
        flex: none;
        white-space: nowrap;
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
        flex: none;
        flex-wrap: nowrap;
        white-space: nowrap;
        align-items: center;
        gap: var(--wt-space-3);
      }

      .operator {
        font-weight: var(--wt-font-weight-bold);
      }

      .head.phone {
        gap: var(--wt-space-2);
        padding: var(--wt-space-2) var(--wt-space-3);
      }

      .head.phone .tabs {
        flex: 1;
      }

      .head.phone .tab {
        padding: var(--wt-space-2) var(--wt-space-3);
      }

      .head.phone .session {
        gap: var(--wt-space-2);
      }

      wt-row-actions > span {
        padding: var(--wt-space-2) var(--wt-space-4);
      }

      /* wt-row-actions keeps its popup 8px from each viewport edge; what does not fit scrolls. */
      wt-row-actions::part(popup) {
        max-height: calc(100dvh - 2 * var(--wt-space-2));
        overflow-y: auto;
      }

      .visually-hidden {
        ${visuallyHiddenStyles}
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
    if (this.hasUpdated) this.#observe();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#phoneWidth?.removeEventListener("change", this.#onPhoneWidth);
    this.#phoneWidth = undefined;
    this.#observer?.disconnect();
    this.#observer = undefined;
    this.#observedChooser = undefined;
    this.#run += 1;
  }

  /** 0: everything on the bar; 1: the name hidden; n: the name hidden and the first n − 1 present
   * items of `LEAVE_ORDER` in More. */
  @state() private steps = 0;
  #run = 0;
  #stepBackOwed = false;
  #fittedWidth = 0;
  #fittedLocale?: string;
  #observer?: ResizeObserver;
  #observedChooser?: Element;
  #watchedPopup?: Element;
  readonly #onPopupToggle = () => {
    if (this.#stepBackOwed && !this.#menuOpen()) void this.#fit();
  };

  #present(): BarItem[] {
    const has: Record<BarItem, boolean> = {
      transfers: this.transferCount !== undefined || this.transferAvailable,
      "find-bill": this.affordances.includes("find-bill"),
      station: this.affordances.includes("station"),
      expo: this.affordances.includes("expo"),
      schedule: this.affordances.includes("schedule"),
      profile: this.canSwitchProfile,
      equipment: true,
      allergens: true,
      operator: true,
    };
    return LEAVE_ORDER.filter((item) => has[item]);
  }

  #moved(): ReadonlySet<BarItem> {
    const present = this.#present();
    return new Set(this.phone ? present : present.slice(0, Math.max(0, this.steps - 1)));
  }

  override updated(changed: PropertyValues): void {
    super.updated(changed);
    this.#observe();
    const contentChanged = CONTENT_PROPERTIES.some((key) => changed.has(key));
    if (contentChanged || currentLocale() !== this.#fittedLocale) {
      this.#stepBackOwed = true;
      void this.#fit();
    } else if (changed.has("transferCount")) {
      void this.#fit();
    }
  }

  /** Observes the host, not the header: its width comes from its container, so a fit does not
   * resize it ("reports no ResizeObserver loop", tab-shell.test.ts). The chooser is observed
   * because its label can change once its language list loads. */
  #observe(): void {
    if (this.#observer === undefined) {
      this.#observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === this) {
            if (entry.contentRect.width > this.#fittedWidth) this.#stepBackOwed = true;
            this.#fittedWidth = entry.contentRect.width;
          } else {
            this.#stepBackOwed = true;
          }
        }
        void this.#fit();
      });
      this.#observer.observe(this);
    }
    const chooser = this.renderRoot.querySelector(".head wt-language-chooser") ?? undefined;
    if (chooser !== this.#observedChooser) {
      if (this.#observedChooser) this.#observer.unobserve(this.#observedChooser);
      if (chooser) this.#observer.observe(chooser);
      this.#observedChooser = chooser;
    }
    const popup = this.#popup();
    if (popup !== this.#watchedPopup) {
      this.#watchedPopup?.removeEventListener("toggle", this.#onPopupToggle);
      popup?.addEventListener("toggle", this.#onPopupToggle);
      this.#watchedPopup = popup;
    }
  }

  #popup(): Element | undefined {
    return (
      this.renderRoot
        .querySelector('wt-row-actions[data-test="more-menu"]')
        ?.shadowRoot?.querySelector("[popover]") ?? undefined
    );
  }

  #menuOpen(): boolean {
    return this.#popup()?.matches(":popover-open") ?? false;
  }

  /** Resolves once this element and the Lit elements in its bar have rendered. */
  async #settled(): Promise<void> {
    await this.updateComplete;
    const children = this.renderRoot.querySelectorAll(
      ".head wt-button, .head wt-row-actions, .head wt-language-chooser, .head wt-count-badge",
    );
    await Promise.all([...children].map((child) => (child as Partial<LitElement>).updateComplete));
  }

  #wraps(): boolean {
    const head = this.renderRoot.querySelector<HTMLElement>(".head");
    const tabs = this.renderRoot.querySelector<HTMLElement>(".head .tabs");
    if (!head || !tabs) return false;
    return head.scrollWidth > head.clientWidth || tabs.scrollWidth > tabs.clientWidth;
  }

  /** Adds steps while the bar wraps. Takes steps away only when `#stepBackOwed`, and never while
   * More is open, which would rebuild it under the finger; the owed step-back runs when it closes. */
  async #fit(): Promise<void> {
    const run = ++this.#run;
    await this.#settled();
    if (run !== this.#run || this.kiosk || this.phone || !this.isConnected) return;
    this.#fittedLocale = currentLocale();
    const stale = async (): Promise<boolean> => {
      await this.#settled();
      return run !== this.#run;
    };
    if (this.#stepBackOwed && !this.#menuOpen()) {
      this.#stepBackOwed = false;
      while (this.steps > 0) {
        this.steps -= 1;
        if (await stale()) return;
        if (this.#wraps()) {
          this.steps += 1;
          if (await stale()) return;
          break;
        }
      }
    }
    const most = this.#present().length + 1;
    while (this.#wraps() && this.steps < most) {
      this.steps += 1;
      if (await stale()) return;
    }
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

  #transferText(): string {
    return this.transferCount === undefined
      ? ""
      : t("department_transfer.open").replace("{count}", String(this.transferCount));
  }

  /** While the transfers are in More the visible count sits in the closed menu, out of the
   * accessibility tree, so this region is the one a screen reader hears. */
  #transferStatus(): TemplateResult {
    return html`<span class="visually-hidden" role="status" data-test="department-transfers-status"
      >${this.#transferText()}</span
    >`;
  }

  /** The bar's items in the bar's order, those in More when `inMore`, else those on the bar. */
  #items(moved: ReadonlySet<BarItem>, inMore: boolean): TemplateResult {
    const variant: ActionVariant = inMore ? "ghost" : "secondary";
    const here = (item: BarItem) => moved.has(item) === inMore;
    const button = (
      cls: string | typeof nothing,
      type: string,
      label: string,
      opensTransfers = false,
    ): TemplateResult =>
      html`<wt-button
        class=${cls}
        ?data-open-transfers=${opensTransfers}
        variant=${variant}
        align=${inMore ? "start" : nothing}
        @click=${() => this.#emit(type)}
        >${label}</wt-button
      >`;
    const affordance = (item: ShellAffordance & BarItem, type: string, label: string) =>
      here(item) && this.affordances.includes(item) ? button(item, type, label) : nothing;
    return html`${
      here("transfers") && this.transferCount !== undefined
        ? html`<span data-test="department-transfers" role=${inMore ? nothing : "status"}
            >${this.#transferText()}</span
          >`
        : nothing
    }${
      here("transfers") && this.transferAvailable
        ? button(nothing, "open-transfers", t("department_transfer.title"), true)
        : nothing
    }${affordance("find-bill", "find-bill", t("find_bill.open"))}${affordance(
      "station",
      "show-station",
      t("station.open"),
    )}${affordance("expo", "show-expo", t("expo.open"))}${affordance(
      "schedule",
      "show-schedule",
      t("schedule.open"),
    )}${
      here("profile") && this.canSwitchProfile
        ? button("profile", "open-profile", t("profile.open"))
        : nothing
    }${here("equipment") ? button("equipment", "open-equipment", t("equipment.open")) : nothing}${
      here("allergens") ? button("allergens", "open-allergens", t("allergens.open")) : nothing
    }`;
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

  #menu(moved: ReadonlySet<BarItem>): TemplateResult {
    const pending =
      moved.has("transfers") && this.transferCount !== undefined && this.transferCount > 0;
    return html`<wt-row-actions
      icon="hamburger"
      align="end"
      data-test="more-menu"
      .iconSize=${"lg"}
      label=${
        pending
          ? countText(this.transferCount!, "shell.more_transfers", "shell.more_transfers_one")
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
      ${this.#items(moved, true)}${moved.has("operator") ? this.#operatorAndLogout("ghost") : nothing}
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
    const moved = this.#moved();
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
                  ${this.phone || this.steps > 0 ? nothing : html`<span class="brand">${BRAND}</span>`}
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
                    ${this.#items(moved, false)}${this.#chooser()}${
                      moved.has("operator") ? nothing : this.#operatorAndLogout("secondary")
                    }${moved.size > 0 ? this.#menu(moved) : nothing}
                  </div>
                  ${this.phone || moved.has("transfers") ? this.#transferStatus() : nothing}
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
