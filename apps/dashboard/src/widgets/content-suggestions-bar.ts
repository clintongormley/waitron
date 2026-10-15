import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import type { SuggestionRunView } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";

export type SuggestionService = "on" | "off" | "not_connected";

export function runActive(run: SuggestionRunView | null): boolean {
  return run?.state === "sending" || run?.state === "running";
}

@customElement("dashboard-content-suggestions-bar")
export class ContentSuggestionsBar extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-3);
      }
      .lines {
        display: grid;
        flex: 1;
        gap: var(--wt-space-1);
        min-width: min(100%, 24ch);
      }
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
      a {
        display: inline-flex;
        align-items: center;
        min-height: var(--wt-tap-min);
        color: var(--wt-color-primary-text);
      }
    `,
  ];

  /** Null until the first suggestion read answers. */
  @property({ attribute: false }) service: SuggestionService | null = null;
  @property({ attribute: false }) run: SuggestionRunView | null = null;
  @property({ attribute: false }) busy = false;
  @property({ attribute: false }) error = "";
  /** The last press was answered with no run: nothing was left to send. */
  @property({ attribute: false }) nothing = false;
  @property({ attribute: false }) cloudOrigin: string | null = null;

  #ready(): boolean {
    return this.service === "on" && !this.busy && !runActive(this.run);
  }

  #press(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.#ready()) return;
    this.dispatchEvent(new CustomEvent("translate-all", { bubbles: true, composed: true }));
  }

  #waiting(run: SuggestionRunView): TemplateResult {
    return html`<p>${fill("suggestions.waiting", { count: String(run.waiting) })}</p>`;
  }

  #refusal(run: SuggestionRunView, code: string): TemplateResult {
    const fits =
      code === "content.suggestion_limit_reached" && run.fits !== null && run.fits > 0
        ? ` ${fill("suggestions.fits", { fits: String(run.fits) })}`
        : "";
    const consent =
      code === "content.suggestion_consent_required" && this.cloudOrigin !== null
        ? html` <a
            data-test="suggestions-consent"
            href=${new URL("/account", this.cloudOrigin).href}
            target="_blank"
            rel="noopener noreferrer"
            >${t("suggestions.open_cloud")}</a
          >`
        : nothing;
    return html`<p>${codeMessage(code)}${fits}${consent}</p>`;
  }

  #lines(): TemplateResult[] {
    const run = this.run;
    if (this.service === null) return [];
    if (this.service === "not_connected")
      return [
        html`<p>
          ${t("suggestions.about")}
          <a data-test="suggestions-connect" href="/manage/cloud">${t("suggestions.connect")}</a>
        </p>`,
      ];
    if (this.service === "off") return [html`<p>${t("suggestions.off")}</p>`];
    if (run?.state === "sending") return [html`<p role="status">${t("suggestions.sending")}</p>`];
    if (run?.state === "running")
      return [
        html`<p role="status">
          ${fill("suggestions.progress", { progress: String(run.progress), total: String(run.total) })}
        </p>`,
      ];
    if (this.nothing) return [html`<p role="status">${t("suggestions.nothing")}</p>`];
    if (run === null) return [html`<p>${t("suggestions.about")}</p>`];
    if (run.state === "done") return [this.#waiting(run)];
    if (run.state === "partly_done")
      return [
        this.#waiting(run),
        html`<p>
          ${
            run.code === "content.suggestion_limit_reached"
              ? codeMessage(run.code)
              : fill("suggestions.partly", { failed: String(run.failed) })
          }
        </p>`,
      ];
    return run.code === null ? [] : [this.#refusal(run, run.code)];
  }

  override render(): TemplateResult {
    const ready = this.#ready();
    return html`<div class="bar">
      <div class="lines">
        ${this.#lines()}
        ${
          this.error
            ? html`<p role="alert" data-test="suggestions-error">${this.error}</p>`
            : nothing
        }
      </div>
      <wt-button
        data-test="translate-all"
        variant=${ready || this.busy ? "primary" : "secondary"}
        ?disabled=${!ready}
        ?loading=${this.busy}
        @click=${this.#press}
        >${t("suggestions.translate_all")}</wt-button
      >
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-content-suggestions-bar": ContentSuggestionsBar;
  }
}
