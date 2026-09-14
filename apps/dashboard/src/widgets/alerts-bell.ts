import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, type WtRowActions } from "@waitron/ui";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-count-badge.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { alertMessage, hasAlertMessage } from "../i18n/alerts.js";
import type { AlertView } from "../api/client.js";
import {
  areaLabel,
  formatAlertTime,
  goToLabel,
  incidentIdOf,
  severityLabel,
} from "./alert-format.js";

export const PANEL_LIMIT = 5;

/** The banner's alerts bell: a count badge on a row-actions trigger whose popover lists the most
 * urgent open alerts. The shell owns the data and acts on this element's events. */
@customElement("dashboard-alerts-bell")
export class AlertsBell extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
      }
      wt-row-actions::part(popup) {
        width: 44ch;
        max-width: calc(100vw - 2 * var(--wt-space-2));
        max-height: 70vh;
        overflow-y: auto;
      }
      /* The shell's drawer breakpoint (DRAWER_BREAKPOINT in dashboard-app.ts): a media query cannot read a token. */
      @media (max-width: 48rem) {
        wt-row-actions::part(popup) {
          width: calc(100vw - 2 * var(--wt-space-2));
        }
      }
      h2 {
        margin: 0;
        padding: var(--wt-space-1) var(--wt-space-2);
        font-size: var(--wt-font-size-md);
      }
      ul {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      li {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--wt-space-1);
        padding: var(--wt-space-2);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-border);
      }
      li[data-severity="error"] {
        border-inline-start-color: var(--wt-color-danger);
      }
      li[data-severity="warning"] {
        border-inline-start-color: var(--wt-color-warning);
      }
      .meta {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .empty,
      .error {
        margin: 0;
        padding: var(--wt-space-2);
      }
    `,
  ];

  @property({ attribute: false }) alerts: AlertView[] = [];
  @property({ attribute: false }) canOpen: (screen: string) => boolean = () => false;
  @property({ attribute: false }) error: string | null = null;
  @property({ attribute: false }) busyKey: string | null = null;

  #menu(): WtRowActions | null {
    return this.renderRoot.querySelector<WtRowActions>("wt-row-actions");
  }

  open(): void {
    this.#menu()?.show();
  }

  /** Focuses the panel's first button. See all is always rendered, so there is always one. */
  focusPanel(): void {
    this.#menu()?.querySelector<HTMLElement>("wt-button:not([disabled])")?.focus();
  }

  #emit(name: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));
  }

  #onHandle(event: MouseEvent, alert: AlertView, incidentId: string): void {
    event.stopPropagation();
    this.#emit("wt-alert-handle", { incidentId, key: alert.key });
  }

  #onGoTo(event: MouseEvent, screen: string): void {
    event.stopPropagation();
    this.#menu()?.hide();
    this.#emit("wt-alert-go-to", { screen });
  }

  #onSeeAll(event: MouseEvent): void {
    event.stopPropagation();
    this.#menu()?.hide();
    this.#emit("wt-alerts-see-all", {});
  }

  #item(alert: AlertView): TemplateResult {
    const incidentId = incidentIdOf(alert);
    const screen =
      alert.kind === "ongoing" && alert.screen !== undefined && this.canOpen(alert.screen)
        ? alert.screen
        : null;
    const when = formatAlertTime(alert.since);
    return html`<li data-severity=${alert.severity} data-test="alert-item">
      <span>${alertMessage(alert.code, alert.params)}</span>
      ${hasAlertMessage(alert.code) ? nothing : html`<span class="meta">${alert.code}</span>`}
      <span class="meta"
        >${severityLabel(alert.severity)} ·
        ${areaLabel(alert.area)}${when ? ` · ${when}` : ""}</span
      >
      ${
        incidentId === null
          ? nothing
          : html`<wt-button
              size="sm"
              variant="secondary"
              data-test="alert-handle"
              ?loading=${this.busyKey === alert.key}
              @click=${(e: MouseEvent) => this.#onHandle(e, alert, incidentId)}
              >${t("alerts.mark_handled")}</wt-button
            >`
      }
      ${
        screen === null
          ? nothing
          : html`<wt-button
              size="sm"
              variant="secondary"
              data-test="alert-go-to"
              @click=${(e: MouseEvent) => this.#onGoTo(e, screen)}
              >${goToLabel(screen)}</wt-button
            >`
      }
    </li>`;
  }

  override render(): TemplateResult {
    const count = this.alerts.length;
    const label =
      count === 0 ? t("alerts.bell") : t("alerts.bell_count").replace("{count}", String(count));
    return html`<wt-row-actions
      icon="bell"
      align="end"
      .iconSize=${"lg"}
      label=${label}
      data-test="alerts-menu"
    >
      <wt-count-badge
        slot="badge"
        data-test="alerts-count"
        .count=${count}
        tone=${this.alerts.some((a) => a.severity === "error") ? "error" : "warning"}
      ></wt-count-badge>
      <h2>${t("alerts.title")}</h2>
      ${this.error === null ? nothing : html`<p class="error" role="alert">${codeMessage(this.error)}</p>`}
      ${
        count === 0
          ? html`<p class="empty" data-test="alerts-empty">${t("alerts.none")}</p>`
          : html`<ul>
              ${this.alerts.slice(0, PANEL_LIMIT).map((alert) => this.#item(alert))}
            </ul>`
      }
      <wt-button variant="ghost" align="start" data-test="alerts-see-all" @click=${this.#onSeeAll}
        >${t("alerts.see_all")}</wt-button
      >
    </wt-row-actions>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-alerts-bell": AlertsBell;
  }
}
