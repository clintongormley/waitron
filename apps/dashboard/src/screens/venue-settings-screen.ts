import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, UrlStateController } from "@waitron/ui";
import "@waitron/ui/src/components/wt-tabs.js";
import { dashboardPath } from "../navigation.js";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

/** The page's tabs in the order they show; a module's panel names one of these keys. */
export const VENUE_SETTINGS_TABS = [
  "venue-details",
  "receipts",
  "tables",
  "adjustment-reasons",
  "kitchen",
] as const;
export type VenueSettingsTab = (typeof VENUE_SETTINGS_TABS)[number];

const TAB_LABELS: Record<VenueSettingsTab, StringKey> = {
  "venue-details": "venue_settings.tab.venue_details",
  receipts: "venue_settings.tab.receipts",
  tables: "venue_settings.tab.tables",
  "adjustment-reasons": "venue_settings.tab.adjustment_reasons",
  kitchen: "venue_settings.tab.kitchen",
};

export function isVenueSettingsTab(value: string | null): value is VenueSettingsTab {
  return (VENUE_SETTINGS_TABS as readonly string[]).includes(value ?? "");
}

/** A panel this session may see. The page owns the h1, so a panel renders none. */
export interface VenueSettingsPanel {
  key: string;
  tab: VenueSettingsTab;
  render(): TemplateResult;
}

@customElement("dashboard-venue-settings-screen")
export class VenueSettingsScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      h1 {
        margin-top: 0;
      }
    `,
  ];

  /** Already filtered to this session and ordered within each tab. */
  @property({ attribute: false }) panels: readonly VenueSettingsPanel[] = [];
  @state() private tab?: VenueSettingsTab;

  readonly #url = new UrlStateController(this, () => this.#restore(), dashboardPath);

  #tabs(): VenueSettingsTab[] {
    return VENUE_SETTINGS_TABS.filter((tab) => this.panels.some((panel) => panel.tab === tab));
  }

  #restore(): void {
    if (this.#url.read("dashboard") !== "venue-settings") return;
    const requested = this.#url.read("view");
    const tabs = this.#tabs();
    const tab = tabs.find((each) => each === requested) ?? tabs[0];
    this.tab = tab;
    if (tab !== undefined && tab !== requested)
      this.#url.write({ dashboard: "venue-settings", view: tab }, true);
  }

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("panels") && (this.tab === undefined || !this.#tabs().includes(this.tab)))
      this.#restore();
  }

  #select(event: CustomEvent<{ value: string }>): void {
    // A strip inside a panel sends the same composed event.
    if (event.target !== event.currentTarget) return;
    if (!isVenueSettingsTab(event.detail.value)) return;
    this.tab = event.detail.value;
    this.#url.write({ dashboard: "venue-settings", view: this.tab });
  }

  override render(): TemplateResult {
    const tabs = this.#tabs();
    return html`<h1>${t("venue_settings.title")}</h1>
      ${
        tabs.length === 0
          ? nothing
          : html`<wt-tabs
              label=${t("venue_settings.title")}
              .value=${this.tab ?? tabs[0]!}
              .items=${tabs.map((tab) => ({ key: tab, label: t(TAB_LABELS[tab]) }))}
              @wt-tab-change=${(event: CustomEvent<{ value: string }>) => this.#select(event)}
            >
              ${repeat(
                tabs,
                (tab) => tab,
                (tab) =>
                  html`<div slot=${tab} data-test=${`venue-settings-${tab}`}>
                    ${repeat(
                      this.panels.filter((panel) => panel.tab === tab),
                      (panel) => panel.key,
                      (panel) => panel.render(),
                    )}
                  </div>`,
              )}
            </wt-tabs>`
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-venue-settings-screen": VenueSettingsScreen;
  }
}
